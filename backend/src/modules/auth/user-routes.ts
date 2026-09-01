/** Organization user management with Owner > Admin > Member target controls. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { authMiddleware } from './auth-middleware.js';
import { revokeUserSessions, validatePassword } from './auth-service.js';

type CurrentUser = { id: string; email: string; role: string; orgId: string };
const forbidden = (reply: FastifyReply) => reply.status(403).send({ error: 'Không có quyền' });

async function targetUser(currentUser: CurrentUser, id: string, reply: FastifyReply) {
  const target = await prisma.user.findFirst({ where: { id, orgId: currentUser.orgId } });
  if (!target) { reply.status(404).send({ error: 'Không tìm thấy người dùng' }); return null; }
  if (target.role === 'owner' && currentUser.role !== 'owner') { forbidden(reply); return null; }
  return target;
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/users', async (request) => ({ users: await prisma.user.findMany({ where: { orgId: request.user.orgId }, select: { id: true, email: true, fullName: true, role: true, isActive: true, teamId: true, createdAt: true, team: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }) }));

  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as CurrentUser;
    if (!['owner', 'admin'].includes(currentUser.role)) return forbidden(reply);
    const { email, fullName, password, role = 'member', teamId } = request.body as { email?: string; fullName?: string; password?: string; role?: string; teamId?: string };
    if (!email || !fullName || !password) return reply.status(400).send({ error: 'Email, họ tên, mật khẩu là bắt buộc' });
    if (!['member', 'admin'].includes(role) || (role === 'admin' && currentUser.role !== 'owner')) return forbidden(reply);
    validatePassword(password);
    if (await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })) return reply.status(400).send({ error: 'Email đã tồn tại' });
    const user = await prisma.user.create({ data: { orgId: currentUser.orgId, email: email.toLowerCase().trim(), fullName: fullName.trim(), passwordHash: await bcrypt.hash(password, 12), role, teamId: teamId || null }, select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true } });
    logger.info(`User created: ${user.id} by ${currentUser.id}`);
    return user;
  });

  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as CurrentUser; const { id } = request.params as { id: string };
    const target = await targetUser(currentUser, id, reply); if (!target) return;
    const body = request.body as { fullName?: string; email?: string; role?: string; teamId?: string | null; isActive?: boolean };
    const managesTarget = ['owner', 'admin'].includes(currentUser.role) && currentUser.id !== id;
    if (currentUser.id !== id && !managesTarget) return forbidden(reply);
    if (currentUser.role === 'admin' && target.role !== 'member' && currentUser.id !== id) return forbidden(reply);
    if (target.role === 'owner' && (body.role !== undefined || body.isActive !== undefined)) return reply.status(400).send({ error: 'Owner phải quản lý bảo mật bằng quy trình tự phục vụ' });
    if (body.role !== undefined && (currentUser.role !== 'owner' || !['admin', 'member'].includes(body.role) || currentUser.id === id)) return forbidden(reply);
    if (body.isActive !== undefined && (currentUser.role !== 'owner' || currentUser.id === id)) return forbidden(reply);
    const data: Record<string, unknown> = {};
    if (body.fullName !== undefined) data.fullName = body.fullName.trim();
    if (body.email !== undefined) data.email = body.email.toLowerCase().trim();
    if (managesTarget && body.teamId !== undefined) data.teamId = body.teamId || null;
    if (body.role !== undefined) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const user = await prisma.user.update({ where: { id }, data, select: { id: true, email: true, fullName: true, role: true, isActive: true, teamId: true } });
    if (body.role !== undefined || body.isActive !== undefined) await revokeUserSessions(id, 'security_state_changed');
    return user;
  });

  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as CurrentUser; const { id } = request.params as { id: string };
    if (!['owner', 'admin'].includes(currentUser.role)) return forbidden(reply);
    const target = await targetUser(currentUser, id, reply); if (!target) return;
    if (target.role === 'owner' || (currentUser.role === 'admin' && target.role !== 'member')) return forbidden(reply);
    const { password } = request.body as { password?: string }; if (!password) return reply.status(400).send({ error: 'Mật khẩu là bắt buộc' });
    validatePassword(password);
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    await revokeUserSessions(id, 'password_reset');
    return { success: true };
  });

  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as CurrentUser; if (currentUser.role !== 'owner') return forbidden(reply);
    const { id } = request.params as { id: string }; const target = await targetUser(currentUser, id, reply); if (!target) return;
    if (id === currentUser.id || target.role === 'owner') return reply.status(400).send({ error: 'Không thể vô hiệu hóa owner' });
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await revokeUserSessions(id, 'user_deactivated');
    return { success: true };
  });
}
