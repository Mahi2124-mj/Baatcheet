import webpush from 'web-push';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { logger } from '../logger.js';

export const pushEnabled = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);

/** Sends a Web Push message to every browser the user subscribed. Expired subscriptions are removed. */
export async function sendPush(userId: string, payload: { title: string; body: string; link?: string | null; tag?: string }) {
  if (!pushEnabled || config.NODE_ENV === 'test') return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 },
        );
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        else logger.warn({ status }, 'push failed');
      }
    }),
  );
}
