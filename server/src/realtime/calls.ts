// Call signalling and state. 1:1 calls are peer-to-peer WebRTC: the server only relays offers,
// answers and ICE candidates between the two accepted connections. Group calls use the LiveKit
// SFU: the server rings members and mints room tokens.
import type { Socket } from 'socket.io';
import type { CallStatus, CallType, ClientToServer, ServerToClient, SignalData } from '@baatcheet/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../logger.js';
import { livekitEnabled } from '../services/livekit.js';
import { assertCanPost, systemMessage } from '../services/messages.js';
import { notify } from '../services/notify.js';
import { isConnected, isOnline } from '../services/presence.js';
import { sendPush } from '../lib/push.js';
import { publicUser, withProfile } from '../services/users.js';
import { io, toUser } from './hub.js';

export const RING_MS = config.CALL_RING_SECONDS * 1000;
export const RECONNECT_GRACE_MS = 20_000;

interface Party {
  userId: string;
  /** Socket that accepted / started the call; signalling goes only there. */
  socketId: string | null;
  state: 'ringing' | 'joined' | 'left' | 'declined';
  dropTimer?: NodeJS.Timeout;
}

interface LiveCall {
  id: string;
  conversationId: string;
  type: CallType;
  group: boolean;
  initiatorId: string;
  parties: Map<string, Party>;
  ringTimer?: NodeJS.Timeout;
  answered: boolean;
  startedAt: number;
  /** What callees were sent, so a tab that connects while the call rings (opened from the notification) rings too. */
  incoming?: Parameters<ServerToClient['call:incoming']>[0];
}

const calls = new Map<string, LiveCall>();

type S = Socket<ClientToServer, ServerToClient, Record<string, never>, { userId: string; sessionId: string }>;

/** A user is busy while ringing someone, being rung, or in a call. */
function busy(userId: string): LiveCall | undefined {
  for (const c of calls.values()) {
    const p = c.parties.get(userId);
    if (p && (p.state === 'joined' || p.state === 'ringing')) return c;
  }
  return undefined;
}

function emitParties(c: LiveCall, fn: (userId: string) => void) {
  for (const id of c.parties.keys()) fn(id);
}

const joined = (c: LiveCall) => [...c.parties.values()].filter((p) => p.state === 'joined');

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

async function finish(c: LiveCall, status: CallStatus, by: string | null) {
  if (!calls.has(c.id)) return;
  calls.delete(c.id);
  clearTimeout(c.ringTimer);
  for (const p of c.parties.values()) clearTimeout(p.dropTimer);
  const now = new Date();
  await prisma.call.update({ where: { id: c.id }, data: { status, endedAt: now } });
  await prisma.callParticipant.updateMany({ where: { callId: c.id, leftAt: null, joinedAt: { not: null } }, data: { leftAt: now } });
  emitParties(c, (u) => toUser(u, 'call:ended', { callId: c.id, status, by }));

  const label = c.type === 'VIDEO' ? 'video call' : 'voice call';
  const caller = await prisma.userProfile.findUnique({ where: { userId: c.initiatorId } });
  if (status === 'ENDED' && c.answered) {
    const call = await prisma.call.findUnique({ where: { id: c.id } });
    const secs = call?.answeredAt ? Math.round((now.getTime() - call.answeredAt.getTime()) / 1000) : 0;
    await systemMessage(c.conversationId, `${c.type === 'VIDEO' ? '📹' : '📞'} ${label[0].toUpperCase()}${label.slice(1)} · ${fmt(secs)}`, 'CALL', c.initiatorId);
  } else if (status === 'MISSED' || status === 'BUSY' || (status === 'ENDED' && !c.answered)) {
    await systemMessage(c.conversationId, `${c.type === 'VIDEO' ? '📹' : '📞'} Missed ${label}`, 'CALL', c.initiatorId);
    for (const p of c.parties.values()) {
      if (p.userId === c.initiatorId || p.state === 'declined' || p.state === 'joined') continue;
      await prisma.callParticipant.update({ where: { callId_userId: { callId: c.id, userId: p.userId } }, data: { response: 'missed' } }).catch(() => {});
      await notify(p.userId, { type: 'missed_call', title: `Missed ${label}`, body: `${caller?.displayName ?? 'Someone'} called you`, link: `/chats/${c.conversationId}` }, 'notifyCalls');
    }
  }
  logger.info({ callId: c.id, status }, 'call finished');
}

export async function startCall(userId: string, socketId: string, conversationId: string, type: CallType) {
  if (type !== 'AUDIO' && type !== 'VIDEO') throw new HttpError(400, 'Unknown call type');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.emailVerifiedAt) throw forbidden('Please verify your e-mail address first');
  const { member } = await assertCanPost(userId, conversationId);
  const conv = member.conversation;
  const group = conv.type === 'GROUP';
  if (group && !livekitEnabled()) throw new HttpError(501, 'Group calls need a LiveKit server (see README → Group calls)');
  if (busy(userId)) throw new HttpError(409, 'You are already in a call');

  // Joining a group call that is already running is "accept", not a second call.
  if (group) {
    const running = [...calls.values()].find((c) => c.conversationId === conversationId);
    if (running) throw new HttpError(409, 'A call is already running in this group — join it');
  }

  const calleeIds = conv.members.map((m) => m.userId).filter((id) => id !== userId);
  const call = await prisma.call.create({
    data: {
      conversationId,
      initiatorId: userId,
      type,
      sfuRoom: group ? `call-${conversationId}-${Date.now()}` : null,
      participants: { create: [{ userId, joinedAt: new Date() }, ...calleeIds.map((id) => ({ userId: id }))] },
    },
  });
  const live: LiveCall = {
    id: call.id,
    conversationId,
    type,
    group,
    initiatorId: userId,
    parties: new Map([[userId, { userId, socketId, state: 'joined' }]]),
    answered: false,
    startedAt: Date.now(),
  };

  const from = await publicUser(await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: withProfile }), null);
  live.incoming = { callId: call.id, conversationId, type, from: { ...from, online: true }, group, groupName: group ? conv.name : null };
  // Registered before anyone is rung, so a quick "accept" finds the call.
  calls.set(call.id, live);
  let reachable = false;
  for (const id of calleeIds) {
    const other = busy(id);
    if (other && !group) {
      calls.set(call.id, live);
      live.parties.set(id, { userId: id, socketId: null, state: 'ringing' });
      await finish(live, 'BUSY', null);
      throw new HttpError(409, 'User is busy on another call', 'busy');
    }
    if (other) continue;
    live.parties.set(id, { userId: id, socketId: null, state: 'ringing' });
    // A connected tab rings even in the background; the push covers a closed or hidden app too.
    if (isConnected(id)) reachable = true;
    toUser(id, 'call:incoming', live.incoming);
    const prefs = await prisma.userProfile.findUnique({ where: { userId: id }, select: { notifyCalls: true } });
    // App not on screen (closed, background, screen off): ring the phone with a notification.
    if (!isOnline(id) && prefs?.notifyCalls !== false) {
      void sendPush(id, { title: `Incoming ${type === 'VIDEO' ? 'video' : 'voice'} call`, body: `${from.displayName} is calling you`, link: `/chats/${conversationId}?call=${call.id}`, tag: `call-${call.id}`, call: true, callId: call.id });
    }
  }
  live.ringTimer = setTimeout(() => void ringTimeout(live), RING_MS);
  return { callId: call.id, calleeIds, reachable, sfu: group };
}

async function ringTimeout(c: LiveCall) {
  if (!calls.has(c.id)) return;
  if (!c.answered) return finish(c, 'MISSED', null);
  // Group call: people who never answered get a missed call; the call itself goes on.
  const caller = await prisma.userProfile.findUnique({ where: { userId: c.initiatorId } });
  for (const p of c.parties.values()) {
    if (p.state !== 'ringing') continue;
    p.state = 'left';
    toUser(p.userId, 'call:ended', { callId: c.id, status: 'MISSED', by: null });
    await prisma.callParticipant.update({ where: { callId_userId: { callId: c.id, userId: p.userId } }, data: { response: 'missed' } });
    await notify(p.userId, { type: 'missed_call', title: `Missed group ${c.type === 'VIDEO' ? 'video' : 'voice'} call`, body: `${caller?.displayName ?? 'Someone'} started a call`, link: `/chats/${c.conversationId}` }, 'notifyCalls');
  }
}

function liveFor(userId: string, callId: string) {
  const c = calls.get(callId);
  if (!c) throw notFound('This call has ended');
  const p = c.parties.get(userId);
  if (!p) throw notFound('This call has ended');
  return { c, p };
}

export async function acceptCall(userId: string, socketId: string, callId: string) {
  let c = calls.get(callId);
  if (!c) throw notFound('This call has ended');
  let p = c.parties.get(userId);
  if (!p && c.group) {
    // A group member joining a running call from the chat.
    const m = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: c.conversationId, userId } } });
    if (!m || m.leftAt) throw notFound('This call has ended');
    await prisma.callParticipant.upsert({ where: { callId_userId: { callId, userId } }, create: { callId, userId }, update: {} });
    p = { userId, socketId: null, state: 'ringing' };
    c.parties.set(userId, p);
  }
  if (!p || (p.state !== 'ringing' && !(c.group && p.state === 'left'))) throw notFound('This call has ended');
  const other = busy(userId);
  if (other && other !== c) throw new HttpError(409, 'Finish your other call first');
  p.state = 'joined';
  p.socketId = socketId;
  const now = new Date();
  if (!c.answered) {
    c.answered = true;
    await prisma.call.update({ where: { id: callId }, data: { status: 'ONGOING', answeredAt: now } });
    if (!c.group) clearTimeout(c.ringTimer);
  }
  await prisma.callParticipant.update({ where: { callId_userId: { callId, userId } }, data: { joinedAt: now, leftAt: null, response: 'accepted' } });
  emitParties(c, (u) => toUser(u, 'call:accepted', { callId, userId }));
  c = calls.get(callId)!;
  return { type: c.type, sfu: c.group, peers: joined(c).map((x) => x.userId).filter((x) => x !== userId) };
}

export async function rejectCall(userId: string, callId: string, reason: 'declined' | 'busy' = 'declined') {
  const { c, p } = liveFor(userId, callId);
  if (p.state !== 'ringing') return;
  p.state = 'declined';
  await prisma.callParticipant.update({ where: { callId_userId: { callId, userId } }, data: { response: reason } });
  emitParties(c, (u) => toUser(u, 'call:rejected', { callId, userId, reason }));
  if (!c.group) return finish(c, reason === 'busy' ? 'BUSY' : 'REJECTED', userId);
  // Group: the call only stops ringing when nobody is left to answer and nobody joined besides the caller.
  const pending = [...c.parties.values()].some((x) => x.state === 'ringing');
  if (!pending && joined(c).length <= 1 && !c.answered) return finish(c, 'REJECTED', userId);
}

export async function leaveCall(userId: string, callId: string) {
  const c = calls.get(callId);
  const p = c?.parties.get(userId);
  if (!c || !p) return;
  if (!c.group) {
    // In a 1:1 call either side hanging up ends it; the caller cancelling while ringing is a missed call.
    return finish(c, c.answered ? 'ENDED' : 'MISSED', userId);
  }
  if (p.state === 'ringing') return rejectCall(userId, callId);
  p.state = 'left';
  clearTimeout(p.dropTimer);
  await prisma.callParticipant.update({ where: { callId_userId: { callId, userId } }, data: { leftAt: new Date() } });
  emitParties(c, (u) => toUser(u, 'call:left', { callId, userId }));
  toUser(userId, 'call:ended', { callId, status: 'ENDED', by: userId });
  if (joined(c).length === 0) await finish(c, c.answered ? 'ENDED' : 'MISSED', userId);
}

export function relaySignal(userId: string, callId: string, to: string, data: SignalData) {
  const { c, p } = liveFor(userId, callId);
  const target = c.parties.get(to);
  if (p.state !== 'joined' || !target || target.state !== 'joined' || !target.socketId || to === userId) throw forbidden('Not in this call');
  if (c.group) throw forbidden('Group calls use the media server');
  io()?.to(target.socketId).emit('call:signal', { callId, from: userId, data });
}

export function relayMedia(userId: string, callId: string, audio: boolean, video: boolean) {
  const { c, p } = liveFor(userId, callId);
  if (p.state !== 'joined') return;
  // A voice call where someone turned the camera on is a video call from now on (history, chat line).
  if (video && c.type === 'AUDIO') {
    c.type = 'VIDEO';
    void prisma.call.update({ where: { id: c.id }, data: { type: 'VIDEO' } }).catch(() => {});
  }
  for (const x of joined(c)) if (x.userId !== userId && x.socketId) io()?.to(x.socketId).emit('call:media', { callId, userId, audio, video });
}

/** The socket that carries a call went away: give it a short grace period to come back. */
export function socketGone(userId: string, socketId: string) {
  for (const c of calls.values()) {
    const p = c.parties.get(userId);
    if (!p || p.socketId !== socketId || p.state !== 'joined') continue;
    p.socketId = null;
    p.dropTimer = setTimeout(() => void leaveCall(userId, c.id), RECONNECT_GRACE_MS);
  }
}

export function resumeCall(userId: string, socketId: string, callId: string) {
  const { c, p } = liveFor(userId, callId);
  if (p.state !== 'joined') throw notFound('This call has ended');
  clearTimeout(p.dropTimer);
  p.socketId = socketId;
  for (const x of joined(c)) if (x.userId !== userId && x.socketId) io()?.to(x.socketId).emit('call:resumed', { callId, userId });
  return { peers: joined(c).map((x) => x.userId).filter((x) => x !== userId) };
}

export function callForUser(userId: string, callId: string) {
  const c = calls.get(callId);
  const p = c?.parties.get(userId);
  return c && p && p.state === 'joined' ? c : null;
}

/** Ends everything (server shutdown / tests). */
export async function endAllCalls() {
  for (const c of [...calls.values()]) await finish(c, c.answered ? 'ENDED' : 'FAILED', null).catch(() => {});
}

export function activeCallCount() {
  return calls.size;
}

export function attachCallHandlers(socket: S) {
  const uid = socket.data.userId;
  // Opened from an incoming-call notification (or a tab that just reconnected): ring here too.
  for (const c of calls.values()) {
    if (c.incoming && c.parties.get(uid)?.state === 'ringing') socket.emit('call:incoming', c.incoming);
  }
  const fail = (e: unknown) => ({ ok: false as const, error: e instanceof HttpError ? e.message : 'Something went wrong' });
  const safeAck = <T,>(ack: unknown): ((r: T) => void) => (typeof ack === 'function' ? (ack as (r: T) => void) : () => {});

  socket.on('call:start', async (input, ack) => {
    const reply = safeAck(ack);
    try {
      reply({ ok: true, data: await startCall(uid, socket.id, String(input?.conversationId ?? ''), input?.type) });
    } catch (e) {
      reply(fail(e));
    }
  });
  socket.on('call:accept', async (input, ack) => {
    const reply = safeAck(ack);
    try {
      reply({ ok: true, data: await acceptCall(uid, socket.id, String(input?.callId ?? '')) });
    } catch (e) {
      reply(fail(e));
    }
  });
  socket.on('call:resume', (input, ack) => {
    const reply = safeAck(ack);
    try {
      reply({ ok: true, data: resumeCall(uid, socket.id, String(input?.callId ?? '')) });
    } catch (e) {
      reply(fail(e));
    }
  });
  socket.on('call:reject', (input) => {
    rejectCall(uid, String(input?.callId ?? ''), input?.reason === 'busy' ? 'busy' : 'declined').catch(() => {});
  });
  socket.on('call:end', (input) => {
    leaveCall(uid, String(input?.callId ?? '')).catch(() => {});
  });
  socket.on('call:signal', (input) => {
    try {
      const d = input?.data;
      const okData =
        d && ((d.type === 'offer' || d.type === 'answer') ? typeof d.sdp === 'string' && d.sdp.length < 100_000 : d.type === 'candidate' && typeof d.candidate?.candidate === 'string' && d.candidate.candidate.length < 2000);
      if (!okData) return;
      relaySignal(uid, String(input.callId), String(input.to), d);
    } catch {
      // Signals for calls that just ended are dropped.
    }
  });
  socket.on('call:media', (input) => {
    try {
      relayMedia(uid, String(input?.callId ?? ''), Boolean(input?.audio), Boolean(input?.video));
    } catch {
      // ignore
    }
  });
}
