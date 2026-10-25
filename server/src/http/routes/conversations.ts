import { Router } from 'express';
import { z } from 'zod';
import { LIMITS, createGroupInput } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, forbidden, h, notFound, parse } from '../../lib/errors.js';
import { deleteObject } from '../../lib/storage.js';
import { joinRoom, leaveRoom, toConversation, toUser } from '../../realtime/hub.js';
import { activeMember, anyMember, groupAdmin, historyWindow } from '../../services/access.js';
import { directKey, summaries, summary } from '../../services/conversations.js';
import { messageInclude, purgeMessages, sendMessage, setReceipt, systemMessage, toMessage } from '../../services/messages.js';
import { notify } from '../../services/notify.js';
import { blockedEither } from '../../services/users.js';
import { me, requireVerified } from '../session.js';
import { claimUpload } from './users.js';

export const conversations = Router();

const name = async (userId: string) => (await prisma.userProfile.findUnique({ where: { userId } }))?.displayName ?? 'Someone';

conversations.get('/', h(async (req, res) => {
  res.json(await summaries(me(req).id));
}));

conversations.get('/:id', h(async (req, res) => {
  await anyMember(me(req).id, req.params.id);
  res.json(await summary(me(req).id, req.params.id));
}));

conversations.post('/direct', requireVerified, h(async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string().min(1).max(40) }), req.body);
  const self = me(req).id;
  if (userId === self) throw badRequest('Pick someone else');
  const other = await prisma.user.findUnique({ where: { id: userId } });
  if (!other || other.suspendedAt) throw notFound('User not found');
  if (await blockedEither(self, userId)) throw forbidden('You can’t message this user');
  const key = directKey(self, userId);
  const conv = await prisma.conversation.upsert({
    where: { directKey: key },
    create: { type: 'DIRECT', directKey: key, createdById: self, members: { create: [{ userId: self }, { userId }] } },
    update: {},
  });
  // Someone who left / cleared still gets the same chat back.
  await prisma.conversationMember.updateMany({ where: { conversationId: conv.id, userId: self }, data: { archivedAt: null } });
  joinRoom(self, conv.id);
  joinRoom(userId, conv.id);
  res.json(await summary(self, conv.id));
}));

conversations.post('/group', requireVerified, h(async (req, res) => {
  const input = parse(createGroupInput, req.body);
  const self = me(req).id;
  const ids = [...new Set(input.memberIds.filter((x) => x !== self))];
  // Only people who have you in their contacts can be added directly (others get an invite link).
  const allowed = await prisma.contact.findMany({ where: { ownerId: { in: ids }, contactId: self }, select: { ownerId: true } });
  const ok = new Set(allowed.map((a) => a.ownerId));
  const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: self, blockedId: { in: ids } }, { blockedId: self, blockerId: { in: ids } }] } });
  blocked.forEach((b) => ok.delete(b.blockerId === self ? b.blockedId : b.blockerId));
  const members = ids.filter((x) => ok.has(x));
  if (input.avatarKey) await claimUpload(self, input.avatarKey, 'group-avatar');
  const conv = await prisma.conversation.create({
    data: {
      type: 'GROUP',
      name: input.name,
      avatarKey: input.avatarKey,
      createdById: self,
      members: { create: [{ userId: self, role: 'OWNER' }, ...members.map((userId) => ({ userId }))] },
    },
  });
  for (const u of [self, ...members]) joinRoom(u, conv.id);
  await systemMessage(conv.id, `${await name(self)} created the group “${input.name}”`);
  for (const u of members) {
    toUser(u, 'conversation:updated', { conversationId: conv.id });
    await notify(u, { type: 'group_added', title: input.name, body: `${await name(self)} added you to the group`, link: `/chats/${conv.id}` }, 'notifyGroups');
  }
  res.status(201).json({ ...(await summary(self, conv.id)), skipped: ids.filter((x) => !ok.has(x)) });
}));

conversations.patch('/:id', h(async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(1).max(LIMITS.groupName).optional(),
      avatarKey: z.string().max(300).nullable().optional(),
      adminsOnlyPost: z.boolean().optional(),
      adminsOnlyEdit: z.boolean().optional(),
    }),
    req.body,
  );
  const self = me(req).id;
  const m = await activeMember(self, req.params.id);
  if (m.conversation.type !== 'GROUP') throw notFound('Group not found');
  const editingInfo = input.name !== undefined || input.avatarKey !== undefined;
  const editingRules = input.adminsOnlyPost !== undefined || input.adminsOnlyEdit !== undefined;
  if (m.role === 'MEMBER' && (editingRules || (editingInfo && m.conversation.adminsOnlyEdit))) throw forbidden('Only group admins can do that');
  if (input.avatarKey) await claimUpload(self, input.avatarKey, 'group-avatar');
  await prisma.conversation.update({ where: { id: m.conversationId }, data: input });
  if (input.avatarKey !== undefined && m.conversation.avatarKey && m.conversation.avatarKey !== input.avatarKey) await deleteObject(m.conversation.avatarKey);
  if (input.name && input.name !== m.conversation.name) await systemMessage(m.conversationId, `${await name(self)} renamed the group to “${input.name}”`);
  toConversation(m.conversationId, 'conversation:updated', { conversationId: m.conversationId });
  res.json(await summary(self, m.conversationId));
}));

conversations.post('/:id/members', h(async (req, res) => {
  const { userIds } = parse(z.object({ userIds: z.array(z.string().max(40)).min(1).max(50) }), req.body);
  const self = me(req).id;
  const admin = await groupAdmin(self, req.params.id);
  const current = await prisma.conversationMember.count({ where: { conversationId: admin.conversationId, leftAt: null } });
  if (current + userIds.length > LIMITS.groupMembers) throw badRequest(`Groups can have at most ${LIMITS.groupMembers} members`);
  const allowed = new Set((await prisma.contact.findMany({ where: { ownerId: { in: userIds }, contactId: self } })).map((c) => c.ownerId));
  const added: string[] = [];
  for (const u of userIds) {
    if (!allowed.has(u) || (await blockedEither(self, u))) continue;
    const existing = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: admin.conversationId, userId: u } } });
    if (existing && !existing.leftAt) continue;
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: admin.conversationId, userId: u } },
      create: { conversationId: admin.conversationId, userId: u },
      update: { leftAt: null, role: 'MEMBER', joinedAt: new Date(), clearedAt: null },
    });
    joinRoom(u, admin.conversationId);
    added.push(u);
    await systemMessage(admin.conversationId, `${await name(self)} added ${await name(u)}`);
    toUser(u, 'conversation:updated', { conversationId: admin.conversationId });
    await notify(u, { type: 'group_added', title: admin.conversation.name ?? 'Group', body: `${await name(self)} added you to the group`, link: `/chats/${admin.conversationId}` }, 'notifyGroups');
  }
  toConversation(admin.conversationId, 'conversation:updated', { conversationId: admin.conversationId });
  res.json({ added, skipped: userIds.filter((u) => !added.includes(u)) });
}));

conversations.delete('/:id/members/:userId', h(async (req, res) => {
  const self = me(req).id;
  const target = req.params.userId;
  const m = await activeMember(self, req.params.id);
  if (m.conversation.type !== 'GROUP') throw badRequest('You can’t leave a direct chat; archive or clear it instead');
  const t = m.conversation.members.find((x) => x.userId === target);
  if (!t) throw notFound('Member not found');
  if (target !== self) {
    if (m.role === 'MEMBER') throw forbidden('Only group admins can remove members');
    if (t.role === 'OWNER' || (t.role === 'ADMIN' && m.role !== 'OWNER')) throw forbidden('You can’t remove this member');
  }
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: m.conversationId, userId: target } }, data: { leftAt: new Date(), role: 'MEMBER' } });
  // An owner who leaves hands the group to the longest-standing admin (or member).
  if (t.role === 'OWNER') {
    const next = await prisma.conversationMember.findFirst({ where: { conversationId: m.conversationId, leftAt: null }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] });
    if (next) await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: m.conversationId, userId: next.userId } }, data: { role: 'OWNER' } });
  }
  await systemMessage(m.conversationId, target === self ? `${await name(self)} left` : `${await name(self)} removed ${await name(target)}`);
  leaveRoom(target, m.conversationId);
  toUser(target, 'conversation:updated', { conversationId: m.conversationId });
  toConversation(m.conversationId, 'conversation:updated', { conversationId: m.conversationId });
  res.json({ ok: true });
}));

conversations.patch('/:id/members/:userId', h(async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['ADMIN', 'MEMBER', 'OWNER']) }), req.body);
  const self = me(req).id;
  const m = await groupAdmin(self, req.params.id);
  const t = m.conversation.members.find((x) => x.userId === req.params.userId);
  if (!t || t.userId === self) throw notFound('Member not found');
  if (t.role === 'OWNER') throw forbidden('You can’t change the owner');
  if (role === 'OWNER' && m.role !== 'OWNER') throw forbidden('Only the owner can hand over the group');
  if (t.role === 'ADMIN' && m.role !== 'OWNER') throw forbidden('Only the owner can change admins');
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: m.conversationId, userId: t.userId } }, data: { role } });
  if (role === 'OWNER') await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: m.conversationId, userId: self } }, data: { role: 'ADMIN' } });
  await systemMessage(m.conversationId, role === 'MEMBER' ? `${await name(t.userId)} is no longer an admin` : `${await name(t.userId)} is now ${role === 'OWNER' ? 'the owner' : 'an admin'}`);
  toConversation(m.conversationId, 'conversation:updated', { conversationId: m.conversationId });
  res.json({ ok: true });
}));

conversations.patch('/:id/me', h(async (req, res) => {
  const input = parse(z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), mutedForSeconds: z.number().int().min(0).max(10 * 365 * 86400).nullable().optional() }), req.body);
  const self = me(req).id;
  const m = await anyMember(self, req.params.id);
  const now = new Date();
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId: m.conversationId, userId: self } },
    data: {
      ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? now : null } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
      ...(input.mutedForSeconds !== undefined ? { mutedUntil: input.mutedForSeconds ? new Date(now.getTime() + input.mutedForSeconds * 1000) : null } : {}),
    },
  });
  res.json(await summary(self, m.conversationId));
}));

/**
 * Clear chat: deletes every message of the chat that you can see, for good (database and files), so the
 * chat is empty for everyone in it.
 */
async function clearChat(m: Awaited<ReturnType<typeof anyMember>>) {
  const before = new Date();
  const w = historyWindow(m, m.conversation.type === 'GROUP');
  const count = await purgeMessages({ conversationId: m.conversationId, createdAt: { ...w, lte: w.lte && w.lte < before ? w.lte : before } });
  toConversation(m.conversationId, 'chat:cleared', { conversationId: m.conversationId, before: before.toISOString() });
  return count;
}

/** Clear all chats: every chat you are in, as above. */
conversations.post('/clear-all', h(async (req, res) => {
  const self = me(req).id;
  const members = await prisma.conversationMember.findMany({ where: { userId: self }, include: { conversation: true } });
  let count = 0;
  for (const m of members) count += await clearChat(m);
  res.json({ ok: true, count, chats: members.length });
}));

conversations.post('/:id/clear', h(async (req, res) => {
  const self = me(req).id;
  const m = await anyMember(self, req.params.id);
  res.json({ ok: true, count: await clearChat(m) });
}));

conversations.delete('/:id', h(async (req, res) => {
  const self = me(req).id;
  const m = await activeMember(self, req.params.id);
  if (m.conversation.type !== 'GROUP' || m.role !== 'OWNER') throw forbidden('Only the group owner can delete the group');
  const ids = m.conversation.members.map((x) => x.userId);
  const files = await prisma.messageAttachment.findMany({ where: { message: { conversationId: m.conversationId } }, select: { key: true } });
  await prisma.conversation.delete({ where: { id: m.conversationId } });
  await Promise.all(files.map((f) => deleteObject(f.key)));
  for (const u of ids) toUser(u, 'conversation:removed', { conversationId: m.conversationId });
  res.json({ ok: true });
}));

// ----- invite links -----

conversations.post('/:id/invites', h(async (req, res) => {
  const input = parse(z.object({ maxUses: z.number().int().min(1).max(1000).optional(), expiresInHours: z.number().int().min(1).max(24 * 30).default(72) }), req.body ?? {});
  const self = me(req).id;
  const m = await groupAdmin(self, req.params.id);
  const inv = await prisma.groupInvitation.create({
    data: { conversationId: m.conversationId, createdById: self, code: randomToken(9), maxUses: input.maxUses, expiresAt: new Date(Date.now() + input.expiresInHours * 3600_000) },
  });
  res.status(201).json({ code: inv.code, expiresAt: inv.expiresAt });
}));

conversations.delete('/:id/invites/:code', h(async (req, res) => {
  const m = await groupAdmin(me(req).id, req.params.id);
  await prisma.groupInvitation.updateMany({ where: { conversationId: m.conversationId, code: req.params.code }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
}));

// ----- messages -----

conversations.get('/:id/messages', h(async (req, res) => {
  const q = parse(z.object({ before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.pageSize) }), req.query);
  const self = me(req).id;
  const m = await anyMember(self, req.params.id);
  const rows = await prisma.message.findMany({
    where: { conversationId: m.conversationId, createdAt: historyWindow(m, m.conversation.type === 'GROUP'), hiddenBy: { none: { userId: self } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
    include: messageInclude,
  });
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  res.json({ messages: (await Promise.all(page.map(toMessage))).reverse(), nextCursor: more ? page[page.length - 1].id : null });
}));

conversations.post('/:id/messages', requireVerified, h(async (req, res) => {
  const { message, duplicate } = await sendMessage(me(req).id, { ...req.body, conversationId: req.params.id });
  res.status(duplicate ? 200 : 201).json(message);
}));

conversations.post('/:id/read', h(async (req, res) => {
  const { messageId } = parse(z.object({ messageId: z.string().max(40) }), req.body);
  await setReceipt(me(req).id, req.params.id, messageId, 'read');
  res.json({ ok: true });
}));

export const invites = Router();

async function validInvite(code: string) {
  const inv = await prisma.groupInvitation.findUnique({ where: { code }, include: { conversation: true } });
  if (!inv || inv.revokedAt || (inv.expiresAt && inv.expiresAt < new Date()) || (inv.maxUses && inv.uses >= inv.maxUses)) throw notFound('This invite link is invalid or has expired');
  return inv;
}

invites.get('/:code', h(async (req, res) => {
  const inv = await validInvite(req.params.code);
  const count = await prisma.conversationMember.count({ where: { conversationId: inv.conversationId, leftAt: null } });
  res.json({ name: inv.conversation.name, members: count });
}));

invites.post('/:code/join', requireVerified, h(async (req, res) => {
  const inv = await validInvite(req.params.code);
  const self = me(req).id;
  const existing = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: inv.conversationId, userId: self } } });
  if (!existing || existing.leftAt) {
    const count = await prisma.conversationMember.count({ where: { conversationId: inv.conversationId, leftAt: null } });
    if (count >= LIMITS.groupMembers) throw badRequest('This group is full');
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: inv.conversationId, userId: self } },
      create: { conversationId: inv.conversationId, userId: self },
      update: { leftAt: null, role: 'MEMBER', joinedAt: new Date(), clearedAt: null },
    });
    await prisma.groupInvitation.update({ where: { id: inv.id }, data: { uses: { increment: 1 } } });
    joinRoom(self, inv.conversationId);
    await systemMessage(inv.conversationId, `${await name(self)} joined using an invite link`);
    toConversation(inv.conversationId, 'conversation:updated', { conversationId: inv.conversationId });
  }
  res.json(await summary(self, inv.conversationId));
}));
