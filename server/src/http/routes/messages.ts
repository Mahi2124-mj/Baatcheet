import { Router } from 'express';
import { z } from 'zod';
import { LIMITS } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { badRequest, forbidden, h, notFound, parse } from '../../lib/errors.js';
import { deleteObject } from '../../lib/storage.js';
import { toConversation } from '../../realtime/hub.js';
import { activeMember, anyMember, historyWindow } from '../../services/access.js';
import { loadMessage, messageInclude, toMessage } from '../../services/messages.js';
import { me } from '../session.js';

export const messages = Router();

const EDIT_WINDOW_MS = 48 * 3600_000;

async function ownMessage(userId: string, id: string) {
  const msg = await prisma.message.findUnique({ where: { id } });
  if (!msg) throw notFound('Message not found');
  const member = await activeMember(userId, msg.conversationId);
  return { msg, member };
}

messages.get('/search', h(async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(2).max(100), conversationId: z.string().max(40).optional() }), req.query);
  const self = me(req).id;
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: self, ...(q.conversationId ? { conversationId: q.conversationId } : {}) },
    include: { conversation: { select: { type: true } } },
  });
  if (!memberships.length) return res.json([]);
  // Each chat only within what this member may see. The trigram index makes ILIKE fast.
  const rows = await prisma.message.findMany({
    where: {
      deletedAt: null,
      kind: 'TEXT',
      body: { contains: q.q, mode: 'insensitive' },
      hiddenBy: { none: { userId: self } },
      OR: memberships.map((m) => ({ conversationId: m.conversationId, createdAt: historyWindow(m, m.conversation.type === 'GROUP') })),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: messageInclude,
  });
  res.json(await Promise.all(rows.map(toMessage)));
}));

messages.patch('/:id', h(async (req, res) => {
  const { body } = parse(z.object({ body: z.string().trim().min(1).max(LIMITS.messageLength) }), req.body);
  const { msg } = await ownMessage(me(req).id, req.params.id);
  if (msg.senderId !== me(req).id || msg.kind !== 'TEXT') throw forbidden('You can only edit your own messages');
  if (msg.deletedAt) throw badRequest('This message was deleted');
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw badRequest('Messages can be edited for 48 hours');
  await prisma.message.update({ where: { id: msg.id }, data: { body, editedAt: new Date() } });
  const out = await loadMessage(msg.id);
  toConversation(msg.conversationId, 'message:updated', out);
  res.json(out);
}));

/** "Delete for me": hides a message (any kind, anyone's) from this user's view of the chat only. */
messages.post('/:id/hide', h(async (req, res) => {
  const self = me(req).id;
  const msg = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!msg) throw notFound('Message not found');
  const member = await anyMember(self, msg.conversationId);
  const w = historyWindow(member, member.conversation.type === 'GROUP');
  // Only messages this member could see.
  if ((w.gt && msg.createdAt <= w.gt) || (w.lte && msg.createdAt > w.lte)) throw notFound('Message not found');
  await prisma.hiddenMessage.createMany({ data: [{ userId: self, messageId: msg.id }], skipDuplicates: true });
  res.json({ ok: true });
}));

messages.delete('/:id', h(async (req, res) => {
  const self = me(req).id;
  const { msg, member } = await ownMessage(self, req.params.id);
  const mine = msg.senderId === self;
  const moderator = member.conversation.type === 'GROUP' && member.role !== 'MEMBER';
  if (!mine && !moderator) throw forbidden('You can only delete your own messages');
  if (msg.kind !== 'TEXT') throw forbidden('This message can’t be deleted');
  const files = await prisma.messageAttachment.findMany({ where: { messageId: msg.id } });
  await prisma.$transaction([
    prisma.messageAttachment.deleteMany({ where: { messageId: msg.id } }),
    prisma.messageReaction.deleteMany({ where: { messageId: msg.id } }),
    prisma.message.update({ where: { id: msg.id }, data: { body: null, deletedAt: new Date() } }),
  ]);
  await Promise.all(files.map((f) => deleteObject(f.key)));
  const out = await loadMessage(msg.id);
  toConversation(msg.conversationId, 'message:updated', out);
  res.json(out);
}));

const emoji = z.string().min(1).max(16).refine((e) => /\p{Extended_Pictographic}/u.test(e), 'Not an emoji');

messages.post('/:id/reactions', h(async (req, res) => {
  const input = parse(z.object({ emoji }), req.body);
  const self = me(req).id;
  const { msg } = await ownMessage(self, req.params.id);
  if (msg.deletedAt || msg.kind !== 'TEXT') throw badRequest('Can’t react to this message');
  // One reaction per person: a new one replaces the old.
  await prisma.$transaction([
    prisma.messageReaction.deleteMany({ where: { messageId: msg.id, userId: self } }),
    prisma.messageReaction.create({ data: { messageId: msg.id, userId: self, emoji: input.emoji } }),
  ]);
  const out = await loadMessage(msg.id);
  toConversation(msg.conversationId, 'message:updated', out);
  res.json(out);
}));

messages.delete('/:id/reactions', h(async (req, res) => {
  const self = me(req).id;
  const { msg } = await ownMessage(self, req.params.id);
  await prisma.messageReaction.deleteMany({ where: { messageId: msg.id, userId: self } });
  const out = await loadMessage(msg.id);
  toConversation(msg.conversationId, 'message:updated', out);
  res.json(out);
}));
