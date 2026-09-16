/**
 * ZaloAccountPool — singleton that manages live Zalo SDK instances.
 * Handles QR login, session reconnect, message listener lifecycle,
 * and credential persistence to the database.
 *
 * Note: zca-js is imported via createRequire because its TypeScript
 * declarations don't expose named exports in ESM mode.
 */
import { createRequire } from 'module';
import type { Server } from 'socket.io';
import { emitAccountEvent } from '../../shared/realtime/socket-event-delivery.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';
import { encryptData, decryptData } from '../../shared/utils/crypto.js';
import { attachZaloListener, type UserInfoCacheEntry } from './zalo-listener-factory.js';
import { emitWebhook } from '../api/webhook-service.js';

// zca-js has no reliable ESM type exports — load via CJS interop
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Zalo } = require('zca-js') as { Zalo: new (opts: { logging: boolean; selfListen?: boolean }) => any };

interface ZaloCredentials {
  cookie: any;
  imei: string;
  userAgent: string;
}

interface ZaloInstance {
  zalo: any;
  api: any;
  status: 'connected' | 'disconnected' | 'qr_pending' | 'connecting';
  displayName?: string;
  zaloUid?: string;
  send2meId?: string;
  orgId?: string;
  lastActivity: Date;
  drainListener?: () => Promise<void>;
}

class ZaloAccountPool {
  private instances = new Map<string, ZaloInstance>();
  private io: Server | null = null;
  // Shared user-info cache passed into each listener context
  private userInfoCache = new Map<string, UserInfoCacheEntry>();
  // Circuit breaker: track disconnect timestamps per account
  private disconnectHistory = new Map<string, number[]>();

  private connectionAttempts = new Map<string, object>();
  private drainingListeners = new Set<Promise<void>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  setIO(io: Server): void {
    this.io = io;
  }

  private async emitForAccount(accountId: string, event: string, payload: unknown): Promise<void> {
    if (this.io) await emitAccountEvent(this.io, accountId, event, payload);
  }

  private scheduleReconnect(accountId: string, delay: number): void {
    clearTimeout(this.reconnectTimers.get(accountId));
    const owner = this.instances.get(accountId);
    if (!owner) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(accountId);
      if (this.instances.get(accountId) === owner) void this.autoReconnect(accountId);
    }, delay);
    timer.unref();
    this.reconnectTimers.set(accountId, timer);
  }

  // Initiate QR-based login; emits QR events to frontend via Socket.IO
  async loginQR(accountId: string): Promise<void> {
    this.disconnect(accountId);
    const attempt = {};
    this.connectionAttempts.set(accountId, attempt);
    try {
      const accountRec = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { orgId: true, displayName: true },
      });
      if (this.connectionAttempts.get(accountId) !== attempt) return;
      if (!accountRec) throw new Error('Zalo account not found');
      const orgId = accountRec.orgId;

      const zalo = new Zalo({ logging: false, selfListen: true });
      const pending: ZaloInstance = { zalo, api: null, status: 'qr_pending', orgId, lastActivity: new Date() };
      this.instances.set(accountId, pending);

      try {
        const api = await zalo.loginQR({}, (event: any) => {
          if (this.instances.get(accountId) !== pending) return;
          switch (event.type) {
            case 0: // QRCodeGenerated
              void this.emitForAccount(accountId, 'zalo:qr', { accountId, qrImage: event.data.image });
              break;
            case 1: // QRCodeExpired
              void this.emitForAccount(accountId, 'zalo:qr-expired', { accountId });
              event.actions?.retry();
              break;
            case 2: // QRCodeScanned
              void this.emitForAccount(accountId, 'zalo:scanned', {
                accountId,
                displayName: event.data.display_name,
                avatar: event.data.avatar,
              });
              break;
            case 4: // GotLoginInfo
              this.saveCredentials(accountId, {
                cookie: event.data.cookie,
                imei: event.data.imei,
                userAgent: event.data.userAgent,
              });
              break;
          }
        });

        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        const instance = pending;
        instance.api = api;
        instance.status = 'connected';
        instance.lastActivity = new Date();
        const send2meId = api.getContext?.()?.loginInfo?.send2me_id;
        if (send2meId) instance.send2meId = send2meId;

        const ownId = await api.getOwnId();
        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        instance.zaloUid = ownId;

        // Fetch own profile info for avatar
        try {
          const userInfo = await api.getUserInfo(ownId);
          const profiles = userInfo?.changed_profiles || {};
          const profile = profiles[ownId] || profiles[`${ownId}_0`];
          if (profile?.avatar) {
            await prisma.zaloAccount.update({
              where: { id: accountId },
              data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
            });
          }
        } catch {}

        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        this.attachListener(accountId, api, orgId, instance.displayName || accountRec.displayName || undefined);
        await this.emitForAccount(accountId, 'zalo:connected', { accountId, zaloUid: ownId });
        await this.emitForAccount(accountId, 'zalo:status-changed', { accountId, status: 'connected' });
        await this.updateAccountDB(accountId, 'connected', ownId);

        if (orgId) {
          emitWebhook(orgId, 'zalo.connected', { accountId }).catch(() => {});
        }
      } catch (err) {
        const instance = this.instances.get(accountId);
        if (instance !== pending) return;
        instance.status = 'disconnected';
        await this.emitForAccount(accountId, 'zalo:status-changed', { accountId, status: 'disconnected' });
        await this.emitForAccount(accountId, 'zalo:error', { accountId, error: String(err) });
        throw err;
      }
    } finally {
      if (this.connectionAttempts.get(accountId) === attempt) this.connectionAttempts.delete(accountId);
    }
  }

  // Reconnect using previously saved session credentials
  async reconnect(accountId: string, credentials: ZaloCredentials): Promise<void> {
    this.disconnect(accountId);
    const attempt = {};
    this.connectionAttempts.set(accountId, attempt);
    try {
      const accountRec = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { orgId: true, displayName: true },
      });
      if (this.connectionAttempts.get(accountId) !== attempt) return;
      if (!accountRec) throw new Error('Zalo account not found');
      const orgId = accountRec.orgId;

      const zalo = new Zalo({ logging: false, selfListen: true });
      const pending: ZaloInstance = { zalo, api: null, status: 'connecting', orgId, lastActivity: new Date() };
      this.instances.set(accountId, pending);

      try {
        const api = await zalo.login({
          cookie: credentials.cookie,
          imei: credentials.imei,
          userAgent: credentials.userAgent,
        });

        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        const instance = pending;
        instance.api = api;
        instance.status = 'connected';
        instance.lastActivity = new Date();
        const send2meId = api.getContext?.()?.loginInfo?.send2me_id;
        if (send2meId) instance.send2meId = send2meId;

        const ownId = await api.getOwnId();
        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        instance.zaloUid = ownId;

        // Fetch own profile info for avatar
        try {
          const userInfo = await api.getUserInfo(ownId);
          const profiles = userInfo?.changed_profiles || {};
          const profile = profiles[ownId] || profiles[`${ownId}_0`];
          if (profile?.avatar) {
            await prisma.zaloAccount.update({
              where: { id: accountId },
              data: { avatarUrl: profile.avatar, displayName: profile.zaloName || profile.zalo_name || profile.displayName || instance.displayName },
            });
          }
        } catch {}

        if (this.instances.get(accountId) !== pending) { api.listener?.stop(); return; }
        this.attachListener(accountId, api, orgId, instance.displayName || accountRec.displayName || undefined);
        await this.updateAccountDB(accountId, 'connected', ownId);
        await this.emitForAccount(accountId, 'zalo:connected', { accountId, zaloUid: ownId });
        await this.emitForAccount(accountId, 'zalo:status-changed', { accountId, status: 'connected' });

        if (orgId) {
          emitWebhook(orgId, 'zalo.connected', { accountId }).catch(() => {});
        }
      } catch (err) {
        const instance = this.instances.get(accountId);
        if (instance !== pending) return;
        instance.status = 'disconnected';
        await this.emitForAccount(accountId, 'zalo:status-changed', { accountId, status: 'disconnected' });
        await this.updateAccountDB(accountId, 'qr_pending', null);
        await this.emitForAccount(accountId, 'zalo:reconnect-failed', { accountId, error: String(err) });
      }
    } finally {
      if (this.connectionAttempts.get(accountId) === attempt) this.connectionAttempts.delete(accountId);
    }
  }

  // Delegate listener setup to zalo-listener-factory
  private attachListener(accountId: string, api: any, orgId?: string, displayName?: string): void {
    const drainListener = attachZaloListener({
      accountId,
      accountDisplayName: displayName,
      orgId,
      api,
      io: this.io,
      userInfoCache: this.userInfoCache,
      onDisconnected: (id) => {
        const inst = this.instances.get(id);
        if (!inst || inst.api !== api) return;
        inst.status = 'disconnected';
        void this.emitForAccount(id, 'zalo:status-changed', { accountId: id, status: 'disconnected' });
        this.updateAccountDB(id, 'disconnected', null);

        if (orgId) {
          emitWebhook(orgId, 'zalo.disconnected', { accountId: id }).catch(() => {});
        }

        // Circuit breaker: track disconnect count per account
        const now = Date.now();
        const key = `dc_${id}`;
        const history = (this.disconnectHistory.get(key) || []).filter(t => now - t < 5 * 60_000);
        history.push(now);
        this.disconnectHistory.set(key, history);

        if (history.length >= 5) {
          // >5 disconnects in 5 min → stop reconnecting, require QR re-login
          logger.error(`[zalo:${id}] Circuit breaker: ${history.length} disconnects in 5 min — stopping auto-reconnect. QR re-login required.`);
          this.updateAccountDB(id, 'qr_pending', null);
          void this.emitForAccount(id, 'zalo:reconnect-failed', { accountId: id, error: 'Session không ổn định, cần đăng nhập QR lại' });
          this.disconnectHistory.delete(key);
          return; // DON'T reconnect
        }

        // Normal auto-reconnect after 30 seconds
        this.scheduleReconnect(id, 30_000);
      },
    });
    const instance = this.instances.get(accountId);
    if (instance && instance.api === api) instance.drainListener = drainListener;
  }

  // Persist session credentials to DB (encrypted with AES-256)
  private saveCredentials(accountId: string, credentials: ZaloCredentials): void {
    const encrypted = encryptData(credentials, config.encryptionKey);
    prisma.zaloAccount
      .update({ where: { id: accountId }, data: { sessionData: encrypted as any } })
      .catch((err) => logger.error(`[zalo:${accountId}] saveCredentials error:`, err));
  }

  // Sync account status and zaloUid to DB
  private async updateAccountDB(accountId: string, status: string, zaloUid: string | null): Promise<void> {
    try {
      await prisma.zaloAccount.update({
        where: { id: accountId },
        data: {
          status,
          ...(zaloUid !== null ? { zaloUid } : {}),
          ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}),
        },
      });
    } catch (err) {
      logger.error(`[zalo:${accountId}] updateAccountDB error:`, err);
    }
  }

  // Auto-reconnect using saved session from DB (supports encrypted and legacy sessions)
  private async autoReconnect(accountId: string): Promise<void> {
    const inst = this.instances.get(accountId);
    // Skip if already reconnected or manually disconnected
    if (!inst || inst.status === 'connected') return;

    try {
      const account = await prisma.zaloAccount.findUnique({
        where: { id: accountId },
        select: { sessionData: true, orgId: true },
      });

      if (this.instances.get(accountId) !== inst) return;
      const session = decryptData<ZaloCredentials>(account?.sessionData, config.encryptionKey);
      if (session?.imei) {
        logger.info(`[zalo:${accountId}] Auto-reconnecting...`);
        await this.reconnect(accountId, session);
      } else {
        logger.warn(`[zalo:${accountId}] No saved session, cannot auto-reconnect`);
        await this.emitForAccount(accountId, 'zalo:reconnect-failed', { accountId, error: 'No saved session' });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Auto-reconnect failed:`, err);
      // Retry again in 2 minutes
      this.scheduleReconnect(accountId, 120_000);
    }
  }

  // Stop listener and remove from pool
  disconnect(accountId: string): void {
    this.connectionAttempts.delete(accountId);
    clearTimeout(this.reconnectTimers.get(accountId));
    this.reconnectTimers.delete(accountId);
    const instance = this.instances.get(accountId);
    this.instances.delete(accountId);
    if (instance?.drainListener) {
      const drain = instance.drainListener().finally(() => this.drainingListeners.delete(drain));
      this.drainingListeners.add(drain);
    }
    if (instance?.api?.listener) {
      try { instance.api.listener.stop(); } catch (err) {
        logger.warn(`[zalo:${accountId}] Error stopping listener:`, err);
      }
    }
    this.instances.delete(accountId);
    void this.emitForAccount(accountId, 'zalo:status-changed', { accountId, status: 'disconnected' });
  }

  disconnectAll(): void {
    for (const accountId of new Set([...this.instances.keys(), ...this.connectionAttempts.keys()])) this.disconnect(accountId);
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.drainingListeners);
  }

  getStatus(accountId: string): string {
    return this.instances.get(accountId)?.status ?? 'disconnected';
  }

  getAllStatuses(): Record<string, string> {
    const statuses: Record<string, string> = {};
    for (const [id, inst] of this.instances) statuses[id] = inst.status;
    return statuses;
  }

  // Return raw API instance for direct SDK calls (e.g. public API send message)
  getApi(accountId: string): any | null {
    const inst = this.instances.get(accountId);
    return inst?.status === 'connected' ? inst.api : null;
  }

  getSend2MeId(accountId: string): string | undefined {
    const inst = this.instances.get(accountId);
    return inst?.send2meId || inst?.api?.getContext?.()?.loginInfo?.send2me_id;
  }

  getInstance(accountId: string): ZaloInstance | undefined {
    return this.instances.get(accountId);
  }
}

export const zaloPool = new ZaloAccountPool();
