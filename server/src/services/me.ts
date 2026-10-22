import { prisma } from '../db.js';
import { avatarUrl } from './users.js';

/** The logged-in user's own account data. */
export async function mePayload(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  const p = u.profile!;
  return {
    id: u.id,
    email: u.email,
    emailVerified: Boolean(u.emailVerifiedAt),
    role: u.role,
    username: p.username,
    displayName: p.displayName,
    bio: p.bio,
    avatarUrl: await avatarUrl(p.avatarKey),
    onboarded: p.onboarded,
    settings: {
      lastSeenVisibility: p.lastSeenVisibility,
      profileVisibility: p.profileVisibility,
      allowMessagesFrom: p.allowMessagesFrom,
      readReceipts: p.readReceipts,
      notifyMessages: p.notifyMessages,
      notifyCalls: p.notifyCalls,
      notifyGroups: p.notifyGroups,
    },
    createdAt: u.createdAt,
  };
}
export type MePayload = Awaited<ReturnType<typeof mePayload>>;
