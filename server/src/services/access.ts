import { prisma } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

/** The caller's membership in a conversation they currently belong to; 404 otherwise (no hint it exists). */
export async function activeMember(userId: string, conversationId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: { include: { members: { where: { leftAt: null } } } } },
  });
  if (!member || member.leftAt) throw notFound('Conversation not found');
  return member;
}

/** Membership including chats the user left (they keep read-only history up to leaving). */
export async function anyMember(userId: string, conversationId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: true },
  });
  if (!member) throw notFound('Conversation not found');
  return member;
}

export async function groupAdmin(userId: string, conversationId: string) {
  const member = await activeMember(userId, conversationId);
  if (member.conversation.type !== 'GROUP') throw notFound('Group not found');
  if (member.role === 'MEMBER') throw forbidden('Only group admins can do that');
  return member;
}

/** Visible window of a conversation's history for one member. */
export function historyWindow(m: { leftAt: Date | null; clearedAt: Date | null; joinedAt: Date }, group: boolean) {
  return {
    ...(m.leftAt ? { lte: m.leftAt } : {}),
    // Group members see messages from when they joined; direct chats show everything.
    ...(m.clearedAt || group ? { gt: maxDate(m.clearedAt, group ? new Date(m.joinedAt.getTime() - 1) : null) } : {}),
  };
}

function maxDate(a: Date | null, b: Date | null): Date {
  if (!a) return b!;
  if (!b) return a;
  return a > b ? a : b;
}
