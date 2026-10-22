import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { h, parse } from '../../lib/errors.js';
import { pushEnabled } from '../../lib/push.js';
import { me } from '../session.js';

export const notifications = Router();

notifications.get('/', h(async (req, res) => {
  const q = parse(z.object({ before: z.string().max(40).optional() }), req.query);
  const rows = await prisma.notification.findMany({
    where: { userId: me(req).id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 31,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
  });
  const unread = await prisma.notification.count({ where: { userId: me(req).id, readAt: null } });
  res.json({ items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null, unread });
}));

notifications.post('/read', h(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().max(40)).max(200).optional() }), req.body ?? {});
  await prisma.notification.updateMany({ where: { userId: me(req).id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
}));

notifications.delete('/', h(async (req, res) => {
  await prisma.notification.deleteMany({ where: { userId: me(req).id } });
  res.json({ ok: true });
}));

export const push = Router();

push.get('/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled, key: pushEnabled ? config.VAPID_PUBLIC_KEY : null });
});

const sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

push.post('/subscribe', h(async (req, res) => {
  const s = parse(sub, req.body);
  await prisma.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { userId: me(req).id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth },
    update: { userId: me(req).id, p256dh: s.keys.p256dh, auth: s.keys.auth },
  });
  res.status(201).json({ ok: true });
}));

push.post('/unsubscribe', h(async (req, res) => {
  const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: me(req).id } });
  res.json({ ok: true });
}));
