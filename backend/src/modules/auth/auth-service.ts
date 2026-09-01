/** Auth identity and server-side refresh-session operations. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

export interface JwtPayload { id: string; email: string; role: string; orgId: string; sessionId: string; }
export interface AuthIdentity { id: string; email: string; role: string; orgId: string; }
export interface SessionTokens { accessToken: string; refreshToken: string; expiresAt: Date; }
type RefreshLookup = { id: string; familyId: string; refreshTokenHash: string; expiresAt: Date; revokedAt: Date | null; replacedBySessionId: string | null; user: AuthIdentity & { isActive: boolean }; };
type SessionRevocationListener = (sessionIds: string[]) => void;

let sessionRevocationListener: SessionRevocationListener | undefined;

const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/;
const authError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const refreshTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const makeRefreshToken = (sessionId: string) => `${sessionId}.${randomBytes(48).toString('base64url')}`;

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left); const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isConsumedRefreshSession(session: RefreshLookup & { revokedReason?: string | null; rotatedAt?: Date | null; lastUsedAt?: Date | null }): boolean {
  return Boolean(
    session.replacedBySessionId ||
    session.rotatedAt ||
    session.lastUsedAt ||
    (session.revokedAt && session.revokedReason === 'rotated'),
  );
}

export function validatePassword(password: string): void {
  if (!passwordPolicy.test(password)) throw authError('Password must be at least 12 characters and include upper-case, lower-case, and a number', 400);
}

function identityOf(user: AuthIdentity): AuthIdentity { return { id: user.id, email: user.email, role: user.role, orgId: user.orgId }; }

export function registerSessionRevocationListener(listener: SessionRevocationListener): void {
  sessionRevocationListener = listener;
}

function notifySessionRevocations(sessionIds: string[]): void {
  if (sessionIds.length) sessionRevocationListener?.(sessionIds);
}

export async function checkSetupStatus(): Promise<{ needsSetup: boolean }> { return { needsSetup: (await prisma.user.count()) === 0 }; }

// A transaction-level advisory lock makes concurrent first-run setup attempts deterministic.
export async function setup(orgName: string, fullName: string, email: string, password: string): Promise<AuthIdentity> {
  validatePassword(password);
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(84732611)`;
    if (await tx.user.count()) throw authError('Setup already completed', 400);
    const org = await tx.organization.create({ data: { name: orgName.trim() } });
    const user = await tx.user.create({ data: { orgId: org.id, email: email.toLowerCase().trim(), passwordHash, fullName: fullName.trim(), role: 'owner' } });
    return { org, user };
  });
  logger.info(`Setup complete — org=${result.org.id}, user=${result.user.id}`);
  return identityOf(result.user);
}

export async function login(email: string, password: string): Promise<AuthIdentity> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) throw authError('Invalid email or password', 401);
  return identityOf(user);
}

export async function createSession(app: FastifyInstance, identity: AuthIdentity, familyId = randomUUID()): Promise<SessionTokens> {
  const id = randomUUID(); const refreshToken = makeRefreshToken(id); const expiresAt = new Date(Date.now() + config.refreshSessionTtlMs);
  await prisma.authSession.create({ data: { id, userId: identity.id, familyId, refreshTokenHash: refreshTokenHash(refreshToken), expiresAt } });
  return { accessToken: app.jwt.sign({ ...identity, sessionId: id } as never, { expiresIn: config.accessTokenTtl }), refreshToken, expiresAt };
}

export async function rotateSession(app: FastifyInstance, opaqueToken: string): Promise<{ tokens: SessionTokens; identity: AuthIdentity }> {
  const tokenHash = refreshTokenHash(opaqueToken); const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.authSession.findUnique({ where: { refreshTokenHash: tokenHash }, include: { user: { select: { id: true, email: true, role: true, orgId: true, isActive: true } } } }) as (RefreshLookup & { revokedReason?: string | null; rotatedAt?: Date | null; lastUsedAt?: Date | null }) | null;
    if (!session || !safeTokenEquals(session.refreshTokenHash, tokenHash)) return { kind: 'invalid' as const };
    if (isConsumedRefreshSession(session) || session.revokedAt) return { kind: 'reused' as const, familyId: session.familyId };
    if (session.expiresAt <= now || !session.user.isActive) {
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now, revokedReason: session.user.isActive ? 'expired' : 'user_inactive' } });
      return { kind: 'invalid' as const, revokedSessionIds: [session.id] };
    }
    const identity = identityOf(session.user); const replacementId = randomUUID(); const refreshToken = makeRefreshToken(replacementId); const expiresAt = new Date(Date.now() + config.refreshSessionTtlMs);
    // Claim the presented credential before minting its replacement. Any loser
    // of this compare-and-rotate race is treated as a replay and revokes the
    // whole family, so a copied refresh token cannot stay usable.
    const consumed = await tx.authSession.updateMany({ where: { id: session.id, revokedAt: null, replacedBySessionId: null, rotatedAt: null, lastUsedAt: null }, data: { rotatedAt: now, lastUsedAt: now, replacedBySessionId: replacementId, revokedAt: now, revokedReason: 'rotated' } });
    if (consumed.count !== 1) return { kind: 'reused' as const, familyId: session.familyId };
    await tx.authSession.create({ data: { id: replacementId, userId: identity.id, familyId: session.familyId, refreshTokenHash: refreshTokenHash(refreshToken), expiresAt } });
    return { kind: 'rotated' as const, revokedSessionId: session.id, tokens: { accessToken: app.jwt.sign({ ...identity, sessionId: replacementId } as never, { expiresIn: config.accessTokenTtl }), refreshToken, expiresAt }, identity };
  });

  if (result.kind === 'rotated') {
    notifySessionRevocations([result.revokedSessionId]);
    return { tokens: result.tokens, identity: result.identity };
  }
  if (result.kind === 'reused') await revokeSessionFamily(result.familyId, 'refresh_token_reuse');
  else notifySessionRevocations(result.revokedSessionIds ?? []);
  throw authError('Invalid refresh session', 401);
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  const revoked = await prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  if (revoked.count) notifySessionRevocations([sessionId]);
}

export async function revokeUserSessions(userId: string, reason: string): Promise<void> {
  const sessionIds = await prisma.$transaction(async (tx) => {
    const sessions = await tx.authSession.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    return sessions.map((session) => session.id);
  });
  notifySessionRevocations(sessionIds);
}

export async function revokeSessionFamily(familyId: string, reason: string): Promise<void> {
  const sessionIds = await prisma.$transaction(async (tx) => {
    const sessions = await tx.authSession.findMany({ where: { familyId, revokedAt: null }, select: { id: true } });
    await tx.authSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    return sessions.map((session) => session.id);
  });
  notifySessionRevocations(sessionIds);
}

export async function validateSessionUser(sessionId: string, userId: string): Promise<AuthIdentity> {
  const session = await prisma.authSession.findFirst({ where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { id: true, email: true, role: true, orgId: true, isActive: true } } } });
  if (!session || !session.user.isActive) throw authError('Session is no longer valid', 401);
  return identityOf(session.user);
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, role: true, orgId: true, teamId: true, isActive: true, createdAt: true, org: { select: { id: true, name: true } } } });
  if (!user) throw authError('User not found', 404);
  return user;
}
