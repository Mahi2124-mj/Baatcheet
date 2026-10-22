import { prisma } from '../db.js';
import { sendPush } from '../lib/push.js';
import { toUser } from '../realtime/hub.js';
import { isOnline } from './presence.js';

type Pref = 'notifyMessages' | 'notifyCalls' | 'notifyGroups' | null;

/**
 * Saves a notification for the notification centre, shows it live in open tabs, and sends a
 * browser push when the user has no tab open. `pref` is the setting that can turn it off.
 */
export async function notify(userId: string, n: { type: string; title: string; body: string; link?: string | null }, pref: Pref = null) {
  if (pref) {
    const p = await prisma.userProfile.findUnique({ where: { userId }, select: { [pref]: true } as Record<string, true> });
    if (p && (p as Record<string, unknown>)[pref] === false) return null;
  }
  const row = await prisma.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null } });
  toUser(userId, 'notification', { id: row.id, type: row.type, title: row.title, body: row.body, link: row.link });
  if (!isOnline(userId)) await sendPush(userId, { title: n.title, body: n.body, link: n.link, tag: n.type });
  return row;
}
