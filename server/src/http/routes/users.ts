import { Router } from 'express';
import { z } from 'zod';
import { privacyInput, profileInput } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { badRequest, conflict, h, notFound, parse } from '../../lib/errors.js';
import { deleteObject, objectSize } from '../../lib/storage.js';
import { mePayload } from '../../services/me.js';
import { blockedEither, publicUser, publicUsers, withProfile } from '../../services/users.js';
import { me } from '../session.js';

export const users = Router();

users.get('/search', h(async (req, res) => {
  const q = parse(z.string().trim().min(1).max(60), req.query.q).toLowerCase().replace(/^@/, '');
  const viewer = me(req).id;
  const blocked = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: viewer }, { blockedId: viewer }] } });
  const hidden = [viewer, ...blocked.flatMap((b) => [b.blockerId, b.blockedId])];
  const rows = await prisma.user.findMany({
    where: {
      id: { notIn: hidden },
      suspendedAt: null,
      profile: { OR: [{ username: { startsWith: q } }, { displayName: { contains: q, mode: 'insensitive' } }] },
    },
    include: withProfile,
    take: 20,
  });
  const people = await publicUsers(rows, viewer);
  // Exact username first, then username prefix.
  const out = rows.map((r) => people.get(r.id)!).sort((a, b) => Number(b.username === q) - Number(a.username === q) || Number(b.username.startsWith(q)) - Number(a.username.startsWith(q)));
  res.json(out);
}));

users.get('/by-name/:username', h(async (req, res) => {
  const viewer = me(req).id;
  const profile = await prisma.userProfile.findUnique({ where: { username: req.params.username.toLowerCase() }, include: { user: { include: withProfile } } });
  if (!profile || profile.user.suspendedAt) throw notFound('User not found');
  const target = profile.user;
  const [user, contact, theirContact, outgoing, incoming, iBlocked, theyBlocked] = await Promise.all([
    publicUser(target, viewer),
    prisma.contact.findUnique({ where: { ownerId_contactId: { ownerId: viewer, contactId: target.id } } }),
    prisma.contact.findUnique({ where: { ownerId_contactId: { ownerId: target.id, contactId: viewer } } }),
    prisma.contactRequest.findUnique({ where: { fromId_toId: { fromId: viewer, toId: target.id } } }),
    prisma.contactRequest.findUnique({ where: { fromId_toId: { fromId: target.id, toId: viewer } } }),
    prisma.blockedUser.findUnique({ where: { blockerId_blockedId: { blockerId: viewer, blockedId: target.id } } }),
    prisma.blockedUser.findUnique({ where: { blockerId_blockedId: { blockerId: target.id, blockedId: viewer } } }),
  ]);
  if (theyBlocked) throw notFound('User not found');
  res.json({
    user,
    self: viewer === target.id,
    contact: Boolean(contact),
    mutual: Boolean(contact && theirContact),
    outgoingRequest: outgoing?.status === 'PENDING' ? outgoing.id : null,
    incomingRequest: incoming?.status === 'PENDING' ? incoming.id : null,
    blocked: Boolean(iBlocked),
  });
}));

users.patch('/me', h(async (req, res) => {
  const input = parse(profileInput, req.body);
  const user = me(req);
  const old = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
  if (input.username && input.username !== old.username) {
    if (await prisma.userProfile.findUnique({ where: { username: input.username } })) throw conflict('That username is taken');
  }
  if (input.avatarKey) await claimUpload(user.id, input.avatarKey, 'avatar');
  await prisma.userProfile.update({ where: { userId: user.id }, data: input }).catch((e: { code?: string }) => {
    if (e.code === 'P2002') throw conflict('That username is taken');
    throw e;
  });
  if (input.avatarKey !== undefined && old.avatarKey && old.avatarKey !== input.avatarKey) await deleteObject(old.avatarKey);
  res.json(await mePayload(user.id));
}));

users.patch('/me/settings', h(async (req, res) => {
  const input = parse(privacyInput, req.body);
  await prisma.userProfile.update({ where: { userId: me(req).id }, data: input });
  res.json(await mePayload(me(req).id));
}));

/** A profile / group picture must be a finished upload of the caller, made for that purpose. */
export async function claimUpload(userId: string, key: string, purpose: 'avatar' | 'group-avatar') {
  const up = await prisma.upload.findUnique({ where: { key } });
  if (!up || up.userId !== userId || up.purpose !== purpose) throw badRequest('Picture not found');
  const size = await objectSize(key);
  if (size === null || size !== up.size) throw badRequest('Picture was not uploaded');
  await prisma.upload.update({ where: { key }, data: { usedAt: new Date() } });
}

// Blocks
users.get('/blocks/list', h(async (req, res) => {
  const rows = await prisma.blockedUser.findMany({ where: { blockerId: me(req).id }, include: { blocked: { include: withProfile } } });
  const people = await publicUsers(rows.map((r) => r.blocked), me(req).id);
  res.json(rows.map((r) => people.get(r.blockedId)));
}));

users.post('/:id/block', h(async (req, res) => {
  const viewer = me(req).id;
  const target = req.params.id;
  if (target === viewer) throw badRequest('You can’t block yourself');
  if (!(await prisma.user.findUnique({ where: { id: target } }))) throw notFound('User not found');
  await prisma.$transaction([
    prisma.blockedUser.upsert({ where: { blockerId_blockedId: { blockerId: viewer, blockedId: target } }, create: { blockerId: viewer, blockedId: target }, update: {} }),
    prisma.contact.deleteMany({ where: { OR: [{ ownerId: viewer, contactId: target }, { ownerId: target, contactId: viewer }] } }),
    prisma.contactRequest.deleteMany({ where: { OR: [{ fromId: viewer, toId: target }, { fromId: target, toId: viewer }] } }),
  ]);
  res.json({ ok: true, blocked: await blockedEither(viewer, target) });
}));

users.delete('/:id/block', h(async (req, res) => {
  await prisma.blockedUser.deleteMany({ where: { blockerId: me(req).id, blockedId: req.params.id } });
  res.json({ ok: true });
}));
