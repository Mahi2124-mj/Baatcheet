import type { ConversationSummary } from '@baatcheet/shared';
import { prisma } from '../db.js';
import { historyWindow } from './access.js';
import { messageInclude, toMessage } from './messages.js';
import { avatarUrl, publicUsers, withProfile } from './users.js';

/** Conversation list entries as `userId` sees them. */
export async function summaries(userId: string, conversationIds?: string[]): Promise<(ConversationSummary & { left: boolean })[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, ...(conversationIds ? { conversationId: { in: conversationIds } } : {}) },
    include: {
      conversation: {
        include: { members: { where: { leftAt: null }, include: { user: { include: withProfile } } } },
      },
    },
    orderBy: { conversation: { lastMessageAt: 'desc' } },
    take: 500,
  });
  const me = await prisma.userProfile.findUnique({ where: { userId }, select: { readReceipts: true } });
  const allUsers = new Map(memberships.flatMap((m) => m.conversation.members.map((x) => [x.userId, x.user] as const)));
  const people = await publicUsers([...allUsers.values()], userId);

  return Promise.all(
    memberships.map(async (mem) => {
      const c = mem.conversation;
      const group = c.type === 'GROUP';
      const window = historyWindow(mem, group);
      const [last, unread] = await Promise.all([
        prisma.message.findFirst({
          where: { conversationId: c.id, createdAt: window, hiddenBy: { none: { userId } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: messageInclude,
        }),
        prisma.message.count({
          where: {
            conversationId: c.id,
            deletedAt: null,
            senderId: { not: userId },
            hiddenBy: { none: { userId } },
            createdAt: { ...window, ...(mem.lastReadAt && (!window.gt || mem.lastReadAt > window.gt) ? { gt: mem.lastReadAt } : {}) },
          },
        }),
      ]);
      const members = c.members.map((m) => ({ ...people.get(m.userId)!, role: m.role }));
      const other = !group ? members.find((m) => m.id !== userId) : undefined;
      const receipts: ConversationSummary['receipts'] = {};
      for (const m of c.members) {
        const readHidden = m.userId !== userId && (me?.readReceipts === false || m.user.profile?.readReceipts === false);
        receipts[m.userId] = {
          deliveredAt: m.lastDeliveredAt?.toISOString() ?? null,
          readAt: readHidden ? null : m.lastReadAt?.toISOString() ?? null,
        };
      }
      return {
        id: c.id,
        type: c.type,
        name: group ? c.name ?? 'Group' : other?.displayName ?? 'Deleted user',
        avatarUrl: group ? await avatarUrl(c.avatarKey) : other?.avatarUrl ?? null,
        members,
        lastMessage: last ? await toMessage(last) : null,
        unread,
        pinned: Boolean(mem.pinnedAt),
        archived: Boolean(mem.archivedAt),
        muted: Boolean(mem.mutedUntil && mem.mutedUntil > new Date()),
        myRole: mem.role,
        adminsOnlyPost: c.adminsOnlyPost,
        receipts,
        left: Boolean(mem.leftAt),
        updatedAt: c.lastMessageAt.toISOString(),
      };
    }),
  );
}

export async function summary(userId: string, conversationId: string) {
  const [s] = await summaries(userId, [conversationId]);
  return s;
}

export function directKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
