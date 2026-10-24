import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { allowedOrigins, originAllowed } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { Bucket } from '../lib/rate.js';
import { logger } from '../logger.js';
import { sessionFromCookie } from '../http/session.js';
import { sendMessage, setReceipt } from '../services/messages.js';
import { addSocket, isOnline, removeSocket, setVisible } from '../services/presence.js';
import { attachCallHandlers, socketGone } from './calls.js';
import { convRoom, setIo, toUser, userRoom, type IO } from './hub.js';

const typingBucket = new Bucket(3, 10);
const sendBucket = new Bucket(5, 20);
const receiptBucket = new Bucket(10, 40);

/** People allowed to see this user's online status right now. */
async function presenceAudience(userId: string): Promise<string[]> {
  const p = await prisma.userProfile.findUnique({ where: { userId }, select: { lastSeenVisibility: true } });
  if (!p || p.lastSeenVisibility === 'NOBODY') return [];
  const mine = await prisma.conversationMember.findMany({ where: { userId, leftAt: null }, select: { conversationId: true } });
  const co = await prisma.conversationMember.findMany({
    where: { conversationId: { in: mine.map((m) => m.conversationId) }, leftAt: null, userId: { not: userId } },
    select: { userId: true },
    distinct: ['userId'],
  });
  let ids = co.map((c) => c.userId);
  const contacts = await prisma.contact.findMany({ where: { ownerId: userId }, select: { contactId: true } });
  if (p.lastSeenVisibility === 'CONTACTS') {
    const ok = new Set(contacts.map((c) => c.contactId));
    ids = ids.filter((i) => ok.has(i));
  }
  ids = [...new Set([...ids, ...contacts.map((c) => c.contactId)])];
  const blocks = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
  const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  return ids.filter((i) => !blocked.has(i));
}

async function broadcastPresence(userId: string, online: boolean, lastSeenAt: Date | null) {
  for (const id of await presenceAudience(userId)) toUser(id, 'presence', { userId, online, lastSeenAt: lastSeenAt?.toISOString() ?? null });
}

// Going away is announced after a short pause, so switching apps for a moment or a socket reconnect
// doesn't flash "last seen" to others. Last seen is the moment the app was hidden.
const AWAY_DELAY_MS = process.env.NODE_ENV === 'test' ? 50 : 4000;
const awayTimers = new Map<string, ReturnType<typeof setTimeout>>();
const announcedOnline = new Set<string>();

function wentOnline(uid: string) {
  clearTimeout(awayTimers.get(uid));
  awayTimers.delete(uid);
  if (announcedOnline.has(uid)) return;
  announcedOnline.add(uid);
  void broadcastPresence(uid, true, null).catch((e) => logger.warn(e, 'presence'));
}

function wentAway(uid: string) {
  const at = new Date();
  clearTimeout(awayTimers.get(uid));
  awayTimers.set(
    uid,
    setTimeout(async () => {
      awayTimers.delete(uid);
      if (isOnline(uid)) return;
      announcedOnline.delete(uid);
      await prisma.user.update({ where: { id: uid }, data: { lastSeenAt: at } }).catch(() => {});
      // Came back while the database was written: don't announce a stale "away".
      if (isOnline(uid)) return;
      void broadcastPresence(uid, false, at).catch(() => {});
    }, AWAY_DELAY_MS),
  );
}

const fail = (e: unknown) => ({ ok: false as const, error: e instanceof HttpError ? e.message : 'Something went wrong' });

export function createSocketServer(http: HttpServer): IO {
  const io: IO = new Server(http, {
    // Cross-origin browsers: only the configured origins (same-address pages need no CORS).
    cors: { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin.replace(/\/+$/, '').toLowerCase())), credentials: true },
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: false },
  });
  setIo(io);

  // Same cookie session as the REST API. Browsers send the Origin header on WebSocket upgrades.
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !originAllowed(origin, socket.handshake.headers.host)) return next(new Error('origin not allowed'));
      const s = await sessionFromCookie(socket.handshake.headers.cookie);
      if (!s) return next(new Error('unauthorized'));
      socket.data.userId = s.userId;
      socket.data.sessionId = s.id;
      next();
    } catch (e) {
      next(e as Error);
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    socket.join(userRoom(uid));
    // Handlers are attached synchronously below; joining rooms runs alongside so no early event is lost.
    void prisma.conversationMember
      .findMany({ where: { userId: uid, leftAt: null }, select: { conversationId: true } })
      .then((convs) => socket.join(convs.map((c) => convRoom(c.conversationId))))
      .catch((e) => logger.warn(e, 'join rooms'));
    // Older clients don't say; treat them as visible.
    const visible = (socket.handshake.auth as { visible?: unknown } | undefined)?.visible !== false;
    if (addSocket(uid, socket.id, visible) === 'up') wentOnline(uid);
    socket.on('presence:visible', (input) => {
      const change = setVisible(uid, socket.id, Boolean(input?.visible));
      if (change === 'up') wentOnline(uid);
      else if (change === 'down') wentAway(uid);
    });

    socket.on('message:send', async (input, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!sendBucket.take(uid)) return reply({ ok: false, error: 'You are sending too fast' });
      try {
        const user = await prisma.user.findUnique({ where: { id: uid }, select: { emailVerifiedAt: true } });
        if (!user?.emailVerifiedAt) throw new HttpError(403, 'Please verify your e-mail address first');
        const { message } = await sendMessage(uid, input);
        reply({ ok: true, data: message });
      } catch (e) {
        reply(fail(e));
      }
    });

    const receipt = (kind: 'read' | 'delivered') => (input: { conversationId: string; messageId: string }) => {
      if (!receiptBucket.take(uid)) return;
      setReceipt(uid, String(input?.conversationId ?? ''), String(input?.messageId ?? ''), kind).catch(() => {});
    };
    socket.on('message:read', receipt('read'));
    socket.on('message:delivered', receipt('delivered'));

    socket.on('typing', async (input) => {
      if (!typingBucket.take(uid)) return;
      const conversationId = String(input?.conversationId ?? '');
      // Only to rooms this socket is really in (membership is checked when joining rooms).
      if (!socket.rooms.has(convRoom(conversationId))) return;
      socket.to(convRoom(conversationId)).emit('typing', { conversationId, userId: uid, typing: Boolean(input?.typing) });
    });

    socket.on('presence:query', async (input, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const ids = Array.isArray(input?.userIds) ? input.userIds.slice(0, 200).map(String) : [];
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, include: { profile: true } });
        const contactsOf = new Set((await prisma.contact.findMany({ where: { ownerId: { in: ids }, contactId: uid } })).map((c) => c.ownerId));
        const blocks = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: uid, blockedId: { in: ids } }, { blockedId: uid, blockerId: { in: ids } }] } });
        const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
        const out: Record<string, { online: boolean; lastSeenAt: string | null }> = {};
        for (const u of users) {
          if (blocked.has(u.id)) continue;
          const v = u.profile?.lastSeenVisibility;
          if (v === 'EVERYONE' || (v === 'CONTACTS' && contactsOf.has(u.id))) out[u.id] = { online: isOnline(u.id), lastSeenAt: u.lastSeenAt?.toISOString() ?? null };
        }
        reply({ ok: true, data: out });
      } catch (e) {
        reply(fail(e));
      }
    });

    attachCallHandlers(socket);

    socket.on('disconnect', async () => {
      socketGone(uid, socket.id);
      if (removeSocket(uid, socket.id) === 'down') wentAway(uid);
    });
  });

  return io;
}
