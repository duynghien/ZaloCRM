import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from '../../config/index.js';
import { registerSessionRevocationListener, validateSessionUser, type JwtPayload } from '../../modules/auth/auth-service.js';
import { pruneSocketAccountRooms, registerZaloSocketHandlers } from '../../modules/zalo/zalo-socket.js';
import { closeSocketEventDelivery } from './socket-event-delivery.js';
import { currentSocketIdentity } from './socket-authorization.js';

declare module 'fastify' { interface FastifyInstance { io: Server } }

export function initializeSocketServer(app: FastifyInstance): Server {
  const io = new Server(app.server, { cors: { origin: config.isProduction ? config.appOrigin : '*', credentials: true } });
  app.decorate('io', io);
  const authenticating = new Set<Socket>();
  const timers = new Map<Socket, ReturnType<typeof setTimeout>>();
  let closed = false;
  const unregister = registerSessionRevocationListener((sessionIds) => {
    const revoked = new Set(sessionIds);
    for (const socket of [...authenticating, ...io.sockets.sockets.values()]) {
      if (!revoked.has(socket.data.sessionId)) continue;
      socket.data.sessionInvalidated = true;
      socket.disconnect(true);
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('Token required');
      const claims = app.jwt.verify<JwtPayload & { exp: number }>(token);
      if (!claims.sessionId || !Number.isFinite(claims.exp)) throw new Error('Invalid token');
      socket.data.sessionId = claims.sessionId;
      socket.data.accessExpiresAt = claims.exp * 1000;
      authenticating.add(socket);
      socket.conn.once('close', () => {
        socket.data.sessionInvalidated = true;
        authenticating.delete(socket);
      });
      const user = await validateSessionUser(claims.sessionId, claims.id);
      if (closed || socket.data.sessionInvalidated || Date.now() >= socket.data.accessExpiresAt) throw new Error('Session revoked');
      socket.data.user = { ...user, sessionId: claims.sessionId };
      next();
    } catch {
      authenticating.delete(socket);
      next(new Error('Authentication error: Invalid, expired, or revoked token'));
    }
  });

  io.on('connection', (socket) => {
    authenticating.delete(socket);
    if (closed || socket.data.sessionInvalidated || Date.now() >= socket.data.accessExpiresAt) { socket.disconnect(true); return; }
    void socket.join(`org:${socket.data.user.orgId}`);
    void socket.join(`user:${socket.data.user.id}`);
    const expire = () => {
      const remaining = socket.data.accessExpiresAt - Date.now();
      if (remaining <= 0) { socket.data.sessionInvalidated = true; socket.disconnect(true); return; }
      const timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      timer.unref();
      timers.set(socket, timer);
    };
    expire();
    socket.use((packet, next) => {
      // Cancellation has no ACL requirement and must beat a pending subscribe read.
      if (packet[0] === 'zalo:unsubscribe' || packet[0] === 'zalo:subscribe') { next(); return; }
      void currentSocketIdentity(socket).then(() => next()).catch(() => {
        socket.data.sessionInvalidated = true;
        socket.disconnect(true);
        next(new Error('Authentication error: Session is no longer valid'));
      });
    });
    socket.on('disconnect', () => {
      clearTimeout(timers.get(socket));
      timers.delete(socket);
    });
  });
  registerZaloSocketHandlers(io);
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void Promise.all([...io.sockets.sockets.values()].map(async (socket) => {
      try { await currentSocketIdentity(socket); await pruneSocketAccountRooms(socket); }
      catch { socket.disconnect(true); }
    })).finally(() => { sweeping = false; });
  }, 15_000);
  sweep.unref();
  app.addHook('onClose', async () => {
    closed = true;
    unregister();
    clearInterval(sweep);
    for (const socket of authenticating) socket.data.sessionInvalidated = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    closeSocketEventDelivery(io);
    io.disconnectSockets(true);
    await io.close();
  });
  return io;
}
