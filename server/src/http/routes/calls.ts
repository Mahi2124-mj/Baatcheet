import { Router } from 'express';
import { z } from 'zod';
import type { CallRecord } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { h, notFound, parse } from '../../lib/errors.js';
import { iceConfigFor } from '../../lib/turn.js';
import { callForUser } from '../../realtime/calls.js';
import { livekitEnabled, livekitToken } from '../../services/livekit.js';
import { publicUsers, withProfile } from '../../services/users.js';
import { me } from '../session.js';

export const calls = Router();

calls.get('/ice-servers', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(iceConfigFor(me(req).id));
});

calls.get('/config', (_req, res) => {
  res.json({ groupCalls: livekitEnabled() });
});

calls.get('/', h(async (req, res) => {
  const q = parse(z.object({ before: z.string().max(40).optional(), missed: z.enum(['1', '0']).optional() }), req.query);
  const self = me(req).id;
  const rows = await prisma.call.findMany({
    where: {
      participants: { some: { userId: self, ...(q.missed === '1' ? { response: 'missed' } : {}) } },
      status: { not: 'RINGING' },
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: 31,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
    include: { participants: { include: { user: { include: withProfile } } } },
  });
  const page = rows.slice(0, 30);
  const people = await publicUsers(page.flatMap((c) => c.participants.map((p) => p.user)), self);
  const items: (CallRecord & { missed: boolean; outgoing: boolean })[] = page.map((c) => ({
    id: c.id,
    type: c.type,
    status: c.status,
    conversationId: c.conversationId,
    initiatorId: c.initiatorId,
    startedAt: c.startedAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    participants: c.participants.map((p) => people.get(p.userId)!),
    outgoing: c.initiatorId === self,
    missed: c.participants.find((p) => p.userId === self)?.response === 'missed',
  }));
  res.json({ items, nextCursor: rows.length > 30 ? page[29].id : null });
}));

/** LiveKit token for a group call the caller has joined. */
calls.post('/:id/token', h(async (req, res) => {
  const self = me(req);
  const live = callForUser(self.id, req.params.id);
  const call = live ? await prisma.call.findUnique({ where: { id: live.id } }) : null;
  if (!call?.sfuRoom) throw notFound('This call has ended');
  const p = await prisma.userProfile.findUnique({ where: { userId: self.id } });
  res.json(await livekitToken(call.sfuRoom, self.id, p?.displayName ?? 'Guest'));
}));

/** Running group call in a conversation, so members can join it. */
calls.get('/active/:conversationId', h(async (req, res) => {
  const self = me(req).id;
  const member = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: req.params.conversationId, userId: self } } });
  if (!member || member.leftAt) throw notFound('Conversation not found');
  const call = await prisma.call.findFirst({ where: { conversationId: req.params.conversationId, status: { in: ['RINGING', 'ONGOING'] }, sfuRoom: { not: null } }, orderBy: { startedAt: 'desc' } });
  res.json(call ? { id: call.id, type: call.type, startedAt: call.startedAt } : null);
}));
