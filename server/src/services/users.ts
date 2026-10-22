import type { Prisma, User, UserProfile } from '@prisma/client';
import type { PublicUser } from '@baatcheet/shared';
import { prisma } from '../db.js';
import { downloadUrl } from '../lib/storage.js';
import { isOnline } from './presence.js';

export type UserWithProfile = User & { profile: UserProfile | null };
export const withProfile = { profile: true } satisfies Prisma.UserInclude;

export async function avatarUrl(key: string | null | undefined): Promise<string | null> {
  return key ? downloadUrl(key, undefined, 24 * 3600) : null;
}

/** Does `ownerId` have `otherId` in their contacts? */
export async function hasContact(ownerId: string, otherId: string): Promise<boolean> {
  if (ownerId === otherId) return true;
  return (await prisma.contact.count({ where: { ownerId, contactId: otherId } })) > 0;
}

export async function blockedEither(a: string, b: string): Promise<boolean> {
  return (await prisma.blockedUser.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
}

/**
 * What `viewerId` may see of `u`. Online / last seen follow the user's "last seen" setting,
 * bio follows "profile" visibility. Blocked users see neither.
 */
export async function publicUser(u: UserWithProfile, viewerId: string | null, known?: { contact?: boolean; blocked?: boolean }): Promise<PublicUser> {
  const p = u.profile;
  const self = viewerId === u.id;
  let contact = known?.contact;
  let blocked = known?.blocked;
  if (!self && viewerId) {
    contact ??= await hasContact(u.id, viewerId);
    blocked ??= await blockedEither(u.id, viewerId);
  }
  const allowed = (v: string | undefined) => self || (!blocked && (v === 'EVERYONE' || (v === 'CONTACTS' && contact)));
  const showSeen = allowed(p?.lastSeenVisibility);
  const showProfile = allowed(p?.profileVisibility);
  return {
    id: u.id,
    username: p?.username ?? 'deleted',
    displayName: p?.displayName ?? 'Deleted user',
    avatarUrl: showProfile ? await avatarUrl(p?.avatarKey) : null,
    bio: showProfile ? p?.bio ?? null : null,
    online: showSeen ? isOnline(u.id) : undefined,
    lastSeenAt: showSeen ? u.lastSeenAt?.toISOString() ?? null : null,
  };
}

/** Same as publicUser for many users, with two queries for contacts / blocks. */
export async function publicUsers(users: UserWithProfile[], viewerId: string): Promise<Map<string, PublicUser>> {
  const ids = users.map((u) => u.id);
  const [contacts, blocks] = await Promise.all([
    prisma.contact.findMany({ where: { ownerId: { in: ids }, contactId: viewerId }, select: { ownerId: true } }),
    prisma.blockedUser.findMany({
      where: { OR: [{ blockerId: viewerId, blockedId: { in: ids } }, { blockedId: viewerId, blockerId: { in: ids } }] },
    }),
  ]);
  const c = new Set(contacts.map((x) => x.ownerId));
  const b = new Set(blocks.flatMap((x) => [x.blockerId, x.blockedId]));
  const out = new Map<string, PublicUser>();
  await Promise.all(users.map(async (u) => out.set(u.id, await publicUser(u, viewerId, { contact: c.has(u.id), blocked: b.has(u.id) }))));
  return out;
}
