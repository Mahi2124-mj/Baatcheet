import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { badRequest, forbidden, h, notFound, parse } from '../../lib/errors.js';
import { limit } from '../../lib/rate.js';
import { notify } from '../../services/notify.js';
import { blockedEither, publicUsers, withProfile } from '../../services/users.js';
import { me, requireVerified } from '../session.js';

export const contacts = Router();

contacts.get('/', h(async (req, res) => {
  const id = me(req).id;
  const [list, incoming, outgoing] = await Promise.all([
    prisma.contact.findMany({ where: { ownerId: id }, include: { contact: { include: withProfile } } }),
    prisma.contactRequest.findMany({ where: { toId: id, status: 'PENDING' }, include: { from: { include: withProfile } }, orderBy: { createdAt: 'desc' } }),
    prisma.contactRequest.findMany({ where: { fromId: id, status: 'PENDING' }, include: { to: { include: withProfile } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const people = await publicUsers([...list.map((c) => c.contact), ...incoming.map((r) => r.from), ...outgoing.map((r) => r.to)], id);
  res.json({
    contacts: list.map((c) => ({ ...people.get(c.contactId)!, nickname: c.nickname })).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    incoming: incoming.map((r) => ({ id: r.id, user: people.get(r.fromId)!, createdAt: r.createdAt })),
    outgoing: outgoing.map((r) => ({ id: r.id, user: people.get(r.toId)!, createdAt: r.createdAt })),
  });
}));

async function connect(a: string, b: string) {
  await prisma.$transaction([
    prisma.contact.upsert({ where: { ownerId_contactId: { ownerId: a, contactId: b } }, create: { ownerId: a, contactId: b }, update: {} }),
    prisma.contact.upsert({ where: { ownerId_contactId: { ownerId: b, contactId: a } }, create: { ownerId: b, contactId: a }, update: {} }),
  ]);
}

contacts.post('/requests', requireVerified, limit(60 * 60_000, 60), h(async (req, res) => {
  const { userId } = parse(z.object({ userId: z.string().min(1).max(40) }), req.body);
  const from = me(req).id;
  if (userId === from) throw badRequest('That’s you');
  const target = await prisma.user.findUnique({ where: { id: userId }, include: withProfile });
  if (!target || target.suspendedAt) throw notFound('User not found');
  if (await blockedEither(from, userId)) throw forbidden('You can’t add this user');
  // They asked first: this accepts their request.
  const theirs = await prisma.contactRequest.findUnique({ where: { fromId_toId: { fromId: userId, toId: from } } });
  if (theirs?.status === 'PENDING') {
    await prisma.contactRequest.update({ where: { id: theirs.id }, data: { status: 'ACCEPTED' } });
    await connect(from, userId);
    return res.json({ status: 'ACCEPTED' });
  }
  const existing = await prisma.contactRequest.findUnique({ where: { fromId_toId: { fromId: from, toId: userId } } });
  if (existing?.status === 'ACCEPTED' && (await prisma.contact.count({ where: { ownerId: from, contactId: userId } }))) return res.json({ status: 'ACCEPTED' });
  const r = await prisma.contactRequest.upsert({
    where: { fromId_toId: { fromId: from, toId: userId } },
    create: { fromId: from, toId: userId },
    update: { status: 'PENDING' },
  });
  const p = await prisma.userProfile.findUnique({ where: { userId: from } });
  await notify(userId, { type: 'contact_request', title: 'Contact request', body: `${p?.displayName} (@${p?.username}) wants to add you`, link: '/contacts' });
  res.status(201).json({ status: 'PENDING', id: r.id });
}));

contacts.post('/requests/:id/:action(accept|decline)', h(async (req, res) => {
  const r = await prisma.contactRequest.findUnique({ where: { id: req.params.id } });
  if (!r || r.toId !== me(req).id || r.status !== 'PENDING') throw notFound('Request not found');
  if (req.params.action === 'accept') {
    if (await blockedEither(r.fromId, r.toId)) throw forbidden('You can’t add this user');
    await prisma.contactRequest.update({ where: { id: r.id }, data: { status: 'ACCEPTED' } });
    await connect(r.fromId, r.toId);
    const p = await prisma.userProfile.findUnique({ where: { userId: r.toId } });
    await notify(r.fromId, { type: 'contact_accepted', title: 'Request accepted', body: `${p?.displayName} accepted your contact request`, link: `/u/${p?.username}` });
  } else {
    await prisma.contactRequest.update({ where: { id: r.id }, data: { status: 'DECLINED' } });
  }
  res.json({ ok: true });
}));

contacts.delete('/requests/:id', h(async (req, res) => {
  const r = await prisma.contactRequest.findUnique({ where: { id: req.params.id } });
  if (!r || r.fromId !== me(req).id) throw notFound('Request not found');
  await prisma.contactRequest.delete({ where: { id: r.id } });
  res.json({ ok: true });
}));

contacts.patch('/:userId', h(async (req, res) => {
  const { nickname } = parse(z.object({ nickname: z.string().trim().max(60).nullable() }), req.body);
  const r = await prisma.contact.updateMany({ where: { ownerId: me(req).id, contactId: req.params.userId }, data: { nickname: nickname || null } });
  if (!r.count) throw notFound('Contact not found');
  res.json({ ok: true });
}));

contacts.delete('/:userId', h(async (req, res) => {
  const a = me(req).id;
  const b = req.params.userId;
  await prisma.contact.deleteMany({ where: { OR: [{ ownerId: a, contactId: b }, { ownerId: b, contactId: a }] } });
  await prisma.contactRequest.deleteMany({ where: { OR: [{ fromId: a, toId: b }, { fromId: b, toId: a }] } });
  res.json({ ok: true });
}));
