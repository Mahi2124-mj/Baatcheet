import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { badRequest, h, notFound, parse } from '../../lib/errors.js';
import { activeCallCount } from '../../realtime/calls.js';
import { disconnectUser, toUser } from '../../realtime/hub.js';
import { audit } from '../../services/audit.js';
import { onlineCount } from '../../services/presence.js';
import { me } from '../session.js';

// Admins see account data, metadata and reported content only. They can't read private chats,
// see passwords / tokens, or listen to calls (media never touches the server).
export const admin = Router();

const day = 86400_000;

admin.get('/stats', h(async (_req, res) => {
  const since = new Date(Date.now() - 30 * day);
  const [users, verified, suspended, newUsers, conversations, groups, messages, messages24h, calls, calls24h, openReports, callStatus] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.conversation.count(),
    prisma.conversation.count({ where: { type: 'GROUP' } }),
    prisma.message.count(),
    prisma.message.count({ where: { createdAt: { gte: new Date(Date.now() - day) } } }),
    prisma.call.count(),
    prisma.call.count({ where: { startedAt: { gte: new Date(Date.now() - day) } } }),
    prisma.userReport.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
    prisma.call.groupBy({ by: ['status', 'type'], _count: true, where: { startedAt: { gte: since } } }),
  ]);
  const daily = await prisma.$queryRaw<{ d: Date; messages: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS d, count(*) AS messages FROM "Message"
    WHERE "createdAt" >= ${new Date(Date.now() - 14 * day)} GROUP BY 1 ORDER BY 1`;
  res.json({
    users, verified, suspended, newUsers30d: newUsers, online: onlineCount(),
    conversations, groups, messages, messages24h, calls, calls24h, activeCalls: activeCallCount(), openReports,
    calls30d: callStatus.map((c) => ({ status: c.status, type: c.type, count: c._count })),
    messagesPerDay: daily.map((r) => ({ day: r.d.toISOString().slice(0, 10), count: Number(r.messages) })),
  });
}));

admin.get('/health', h(async (_req, res) => {
  const t = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const mem = process.memoryUsage();
  res.json({ db: { ok: true, ms: Date.now() - t }, uptimeSec: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), node: process.version, online: onlineCount(), activeCalls: activeCallCount() });
}));

admin.get('/users', h(async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(100).optional(), before: z.string().max(40).optional(), status: z.enum(['all', 'suspended', 'admin']).default('all') }), req.query);
  const rows = await prisma.user.findMany({
    where: {
      ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { profile: { username: { contains: q.q.toLowerCase() } } }, { profile: { displayName: { contains: q.q, mode: 'insensitive' } } }] } : {}),
      ...(q.status === 'suspended' ? { suspendedAt: { not: null } } : q.status === 'admin' ? { role: 'ADMIN' } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 51,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
    include: { profile: true, _count: { select: { messages: true, reportsAgainst: true } } },
  });
  res.json({
    items: rows.slice(0, 50).map((u) => ({
      id: u.id, email: u.email, emailVerified: Boolean(u.emailVerifiedAt), role: u.role,
      username: u.profile?.username, displayName: u.profile?.displayName,
      suspendedAt: u.suspendedAt, suspendReason: u.suspendReason, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
      messages: u._count.messages, reports: u._count.reportsAgainst,
    })),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  });
}));

admin.post('/users/:id/suspend', h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw notFound('User not found');
  if (target.id === me(req).id) throw badRequest('You can’t suspend yourself');
  if (target.role === 'ADMIN') throw badRequest('Remove admin rights first');
  await prisma.user.update({ where: { id: target.id }, data: { suspendedAt: new Date(), suspendReason: reason } });
  await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  disconnectUser(target.id);
  await audit(me(req).id, 'user.suspend', 'user', target.id, req.ip, { reason });
  res.json({ ok: true });
}));

admin.post('/users/:id/restore', h(async (req, res) => {
  const r = await prisma.user.updateMany({ where: { id: req.params.id }, data: { suspendedAt: null, suspendReason: null } });
  if (!r.count) throw notFound('User not found');
  await audit(me(req).id, 'user.restore', 'user', req.params.id, req.ip);
  res.json({ ok: true });
}));

admin.post('/users/:id/role', h(async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['USER', 'ADMIN']) }), req.body);
  if (req.params.id === me(req).id) throw badRequest('You can’t change your own role');
  const r = await prisma.user.updateMany({ where: { id: req.params.id }, data: { role } });
  if (!r.count) throw notFound('User not found');
  await audit(me(req).id, 'user.role', 'user', req.params.id, req.ip, { role });
  res.json({ ok: true });
}));

admin.get('/reports', h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'all']).default('OPEN') }), req.query);
  const rows = await prisma.userReport.findMany({
    where: q.status === 'all' ? {} : { status: q.status },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { reporter: { include: { profile: true } }, reportedUser: { include: { profile: true } } },
  });
  res.json(rows.map((r) => ({
    id: r.id, reason: r.reason, details: r.details, evidence: r.evidence, status: r.status, resolution: r.resolution,
    createdAt: r.createdAt, resolvedAt: r.resolvedAt, messageId: r.messageId, conversationId: r.conversationId,
    reporter: r.reporter ? { id: r.reporter.id, username: r.reporter.profile?.username } : null,
    reported: r.reportedUser ? { id: r.reportedUser.id, username: r.reportedUser.profile?.username, suspended: Boolean(r.reportedUser.suspendedAt) } : null,
  })));
}));

admin.patch('/reports/:id', h(async (req, res) => {
  const input = parse(z.object({ status: z.enum(['REVIEWING', 'ACTIONED', 'DISMISSED']), resolution: z.string().trim().max(500).optional() }), req.body);
  const r = await prisma.userReport.findUnique({ where: { id: req.params.id } });
  if (!r) throw notFound('Report not found');
  await prisma.userReport.update({ where: { id: r.id }, data: { status: input.status, resolution: input.resolution, resolvedAt: input.status === 'REVIEWING' ? null : new Date() } });
  await audit(me(req).id, 'report.update', 'report', r.id, req.ip, input);
  if (input.status === 'ACTIONED' && r.reporterId) toUser(r.reporterId, 'notification', { id: r.id, type: 'report', title: 'Report reviewed', body: 'Thanks — we took action on your report.', link: null });
  res.json({ ok: true });
}));

admin.get('/groups', h(async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
  const rows = await prisma.conversation.findMany({
    where: { type: 'GROUP', ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: { _count: { select: { members: { where: { leftAt: null } }, messages: true } } },
  });
  res.json(rows.map((g) => ({ id: g.id, name: g.name, members: g._count.members, messages: g._count.messages, createdAt: g.createdAt, lastMessageAt: g.lastMessageAt })));
}));

admin.delete('/groups/:id', h(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const g = await prisma.conversation.findUnique({ where: { id: req.params.id }, include: { members: true } });
  if (!g || g.type !== 'GROUP') throw notFound('Group not found');
  await prisma.conversation.delete({ where: { id: g.id } });
  for (const m of g.members) toUser(m.userId, 'conversation:removed', { conversationId: g.id });
  await audit(me(req).id, 'group.delete', 'conversation', g.id, req.ip, { reason, name: g.name });
  res.json({ ok: true });
}));

admin.get('/audit', h(async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { actor: { include: { profile: true } } } });
  res.json(rows.map((a) => ({ id: a.id, action: a.action, targetType: a.targetType, targetId: a.targetId, meta: a.meta, ip: a.ip, createdAt: a.createdAt, actor: a.actor?.profile?.username ?? null })));
}));
