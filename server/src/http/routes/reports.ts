import { Router } from 'express';
import { reportInput } from '@baatcheet/shared';
import { prisma } from '../../db.js';
import { badRequest, h, notFound, parse } from '../../lib/errors.js';
import { limit } from '../../lib/rate.js';
import { anyMember } from '../../services/access.js';
import { me } from '../session.js';

export const reports = Router();

reports.post('/', limit(60 * 60_000, 20), h(async (req, res) => {
  const input = parse(reportInput, req.body);
  const self = me(req).id;
  if (!input.userId && !input.messageId && !input.conversationId) throw badRequest('Say what you are reporting');
  let evidence: string | null = null;
  let reportedUserId = input.userId ?? null;
  let conversationId = input.conversationId ?? null;
  if (input.messageId) {
    const msg = await prisma.message.findUnique({ where: { id: input.messageId } });
    if (!msg) throw notFound('Message not found');
    // Only someone who could read the message can report it; the reported text is copied as evidence.
    await anyMember(self, msg.conversationId);
    evidence = msg.body;
    reportedUserId ??= msg.senderId;
    conversationId = msg.conversationId;
  } else if (conversationId) {
    await anyMember(self, conversationId);
  }
  if (reportedUserId === self) throw badRequest('You can’t report yourself');
  const r = await prisma.userReport.create({
    data: { reporterId: self, reportedUserId, messageId: input.messageId, conversationId, reason: input.reason, details: input.details, evidence },
  });
  res.status(201).json({ id: r.id });
}));
