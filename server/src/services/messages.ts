import type { Prisma } from '@prisma/client';
import { LIMITS, kindOf, sendMessageInput, type Message } from '@baatcheet/shared';
import type { z } from 'zod';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { HttpError, badRequest, forbidden } from '../lib/errors.js';
import { sendPush } from '../lib/push.js';
import { downloadUrl, objectSize } from '../lib/storage.js';
import { toConversation, toUser } from '../realtime/hub.js';
import { activeMember } from './access.js';
import { isOnline } from './presence.js';
import { blockedEither, hasContact } from './users.js';

export const messageInclude = {
  attachments: true,
  reactions: { select: { emoji: true, userId: true } },
  replyTo: { select: { id: true, body: true, senderId: true, deletedAt: true } },
} satisfies Prisma.MessageInclude;

export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export async function toMessage(m: MessageRow): Promise<Message> {
  const deleted = Boolean(m.deletedAt);
  const reactions = new Map<string, string[]>();
  if (!deleted) for (const r of m.reactions) reactions.set(r.emoji, [...(reactions.get(r.emoji) ?? []), r.userId]);
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    clientId: m.clientId,
    body: deleted ? null : m.body,
    kind: m.kind,
    replyTo: m.replyTo && !deleted ? { id: m.replyTo.id, body: m.replyTo.deletedAt ? null : m.replyTo.body, senderId: m.replyTo.senderId } : null,
    attachments: deleted
      ? []
      : await Promise.all(
          m.attachments.map(async (a) => ({
            id: a.id,
            kind: a.kind as Message['attachments'][number]['kind'],
            name: a.name,
            size: a.size,
            mime: a.mime,
            url: await downloadUrl(a.key, a.name),
          })),
        ),
    reactions: [...reactions].map(([emoji, userIds]) => ({ emoji, userIds })),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function loadMessage(id: string): Promise<Message> {
  return toMessage(await prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude }));
}

/** Throws when `senderId` may not post in this conversation right now. */
export async function assertCanPost(senderId: string, conversationId: string) {
  const member = await activeMember(senderId, conversationId);
  const conv = member.conversation;
  if (conv.type === 'GROUP') {
    if (conv.adminsOnlyPost && member.role === 'MEMBER') throw forbidden('Only admins can send messages in this group');
    return { member, others: [] as string[] };
  }
  const other = conv.members.find((m) => m.userId !== senderId);
  if (!other) throw forbidden('This chat has no other member');
  if (await blockedEither(senderId, other.userId)) throw forbidden('You can’t message this user');
  const prefs = await prisma.userProfile.findUnique({ where: { userId: other.userId }, select: { allowMessagesFrom: true } });
  if (prefs?.allowMessagesFrom === 'CONTACTS' && !(await hasContact(other.userId, senderId))) {
    // Replies are always allowed once the other person wrote first.
    const wrote = await prisma.message.count({ where: { conversationId, senderId: other.userId } });
    if (!wrote) throw forbidden('This user only accepts messages from their contacts');
  }
  return { member, others: [other.userId] };
}

export async function sendMessage(senderId: string, raw: z.input<typeof sendMessageInput>): Promise<{ message: Message; duplicate: boolean }> {
  const input = sendMessageInput.safeParse(raw);
  if (!input.success) throw badRequest(input.error.issues[0]?.message ?? 'Invalid message');
  const { conversationId, clientId, replyToId, attachments = [] } = input.data;

  // A re-send after a reconnect returns the stored copy instead of a second message.
  const existing = await prisma.message.findUnique({ where: { senderId_clientId: { senderId, clientId } }, include: messageInclude });
  if (existing) {
    if (existing.conversationId !== conversationId) throw badRequest('clientId already used');
    return { message: await toMessage(existing), duplicate: true };
  }

  await assertCanPost(senderId, conversationId);

  if (replyToId) {
    const target = await prisma.message.findUnique({ where: { id: replyToId }, select: { conversationId: true } });
    if (target?.conversationId !== conversationId) throw badRequest('Replied message is not in this chat');
  }

  const uploads = attachments.length
    ? await prisma.upload.findMany({ where: { key: { in: attachments.map((a) => a.key) }, userId: senderId, purpose: 'attachment', usedAt: null } })
    : [];
  for (const a of attachments) {
    const u = uploads.find((x) => x.key === a.key);
    if (!u) throw badRequest('Attachment not found or already used');
    const size = await objectSize(u.key);
    if (size === null) throw badRequest(`“${u.name}” was not uploaded`);
    if (size !== u.size || size > LIMITS.fileSize[kindOf(u.mime) ?? 'document']) throw badRequest(`“${u.name}” has the wrong size`);
  }

  const body = input.data.body?.trim() || null;
  const created = await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: {
        conversationId,
        senderId,
        clientId,
        body,
        replyToId: replyToId ?? null,
        attachments: { create: uploads.map((u) => ({ key: u.key, kind: kindOf(u.mime) ?? 'document', name: u.name, size: u.size, mime: u.mime })) },
      },
      include: messageInclude,
    });
    if (uploads.length) await tx.upload.updateMany({ where: { key: { in: uploads.map((u) => u.key) } }, data: { usedAt: new Date() } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
    await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: senderId } },
      data: { lastReadAt: m.createdAt, lastDeliveredAt: m.createdAt },
    });
    return m;
  }).catch(async (e: { code?: string }) => {
    // Two re-sends raced: the other one won.
    if (e.code === 'P2002') return prisma.message.findUniqueOrThrow({ where: { senderId_clientId: { senderId, clientId } }, include: messageInclude });
    throw e;
  });

  const message = await toMessage(created);
  toConversation(conversationId, 'message:new', message);
  void pushToOffline(senderId, conversationId, message).catch((e) => logger.warn({ err: e }, 'push to offline members failed'));
  return { message, duplicate: false };
}

async function pushToOffline(senderId: string, conversationId: string, m: Message) {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null, userId: { not: senderId } },
    include: { user: { include: { profile: true } }, conversation: { select: { type: true, name: true } } },
  });
  const sender = await prisma.userProfile.findUnique({ where: { userId: senderId }, select: { displayName: true } });
  const now = new Date();
  for (const mem of members) {
    if (isOnline(mem.userId)) continue;
    if (mem.mutedUntil && mem.mutedUntil > now) continue;
    if (mem.user.profile && !mem.user.profile.notifyMessages) continue;
    if (await blockedEither(senderId, mem.userId)) continue;
    const group = mem.conversation.type === 'GROUP';
    const preview = m.body ? m.body.slice(0, 120) : m.attachments.length ? '📎 Attachment' : 'New message';
    await sendPush(mem.userId, {
      title: group ? `${sender?.displayName ?? 'Someone'} · ${mem.conversation.name ?? 'Group'}` : sender?.displayName ?? 'New message',
      body: preview,
      link: `/chats/${conversationId}`,
      tag: `conv-${conversationId}`,
    });
  }
}

/** Posts a SYSTEM line (“Asha added Ravi”) into a conversation. */
export async function systemMessage(conversationId: string, body: string, kind: 'SYSTEM' | 'CALL' = 'SYSTEM', senderId: string | null = null) {
  const m = await prisma.message.create({ data: { conversationId, body, kind, senderId }, include: messageInclude });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: m.createdAt } });
  const out = await toMessage(m);
  toConversation(conversationId, 'message:new', out);
  return out;
}

export async function setReceipt(userId: string, conversationId: string, messageId: string, kind: 'read' | 'delivered') {
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!member || member.leftAt) throw new HttpError(404, 'Conversation not found');
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, createdAt: true } });
  if (!msg || msg.conversationId !== conversationId) throw new HttpError(404, 'Message not found');
  const at = msg.createdAt;
  const data: Prisma.ConversationMemberUpdateInput = {};
  if (!member.lastDeliveredAt || member.lastDeliveredAt < at) data.lastDeliveredAt = at;
  if (kind === 'read' && (!member.lastReadAt || member.lastReadAt < at)) data.lastReadAt = at;
  if (!Object.keys(data).length) return;
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data });
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { readReceipts: true } });
  // With read receipts off, others only learn "delivered".
  const readAt = data.lastReadAt && profile?.readReceipts !== false ? at.toISOString() : undefined;
  const deliveredAt = data.lastDeliveredAt ? at.toISOString() : undefined;
  if (readAt || deliveredAt) toConversation(conversationId, 'receipt', { conversationId, userId, readAt, deliveredAt });
  if (data.lastReadAt) toUser(userId, 'conversation:updated', { conversationId });
}
