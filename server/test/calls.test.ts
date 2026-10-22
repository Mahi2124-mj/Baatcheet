import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { befriend, connect, emitAck, once, register, resetDb, sleep, startServer, type TestServer } from './helpers.js';
import { prisma } from '../src/db.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

async function setup() {
  const a = await register(srv, { name: 'caller' });
  const b = await register(srv, { name: 'callee' });
  const conv = await a.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(200);
  const sa = await connect(srv, a);
  const sb = await connect(srv, b);
  return { a, b, sa, sb, convId: conv.body.id as string };
}

describe('calls', () => {
  it('hands out STUN + expiring TURN credentials (coturn REST scheme)', async () => {
    const a = await register(srv);
    const r = await a.agent.get('/api/calls/ice-servers').expect(200);
    const turn = r.body.iceServers.find((s: { urls: string[] }) => String(s.urls).startsWith('turn:'));
    const [exp, uid] = turn.username.split(':');
    expect(uid).toBe(a.id);
    expect(Number(exp)).toBeGreaterThan(Date.now() / 1000);
    expect(turn.credential).toBe(createHmac('sha1', 'turn-test-secret').update(turn.username).digest('base64'));
  });

  it('uses a fixed login for a hosted TURN service when there is no TURN_SECRET', async () => {
    const { config, loadConfig } = await import('../src/config.js');
    const saved = { TURN_SECRET: config.TURN_SECRET, TURN_URLS: config.TURN_URLS };
    Object.assign(config, { TURN_SECRET: undefined, TURN_URLS: 'turn:relay.example.test:80', TURN_USERNAME: 'hosted-user', TURN_CREDENTIAL: 'hosted-pass' });
    try {
      const a = await register(srv);
      const r = await a.agent.get('/api/calls/ice-servers').expect(200);
      expect(r.body.iceServers).toContainEqual({ urls: ['turn:relay.example.test:80'], username: 'hosted-user', credential: 'hosted-pass' });
    } finally {
      Object.assign(config, saved, { TURN_USERNAME: undefined, TURN_CREDENTIAL: undefined });
    }
    // TURN without any credentials is a configuration error.
    const base = { DATABASE_URL: 'postgresql://x@localhost/x', SESSION_SECRET: 'x'.repeat(40), TURN_URLS: 'turn:x:3478' };
    expect(() => loadConfig(base)).toThrow(/TURN_USERNAME/);
    expect(() => loadConfig({ ...base, TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' })).not.toThrow();
  });

  it('rings, accepts, relays offer/answer/ICE only between the two parties, and ends', async () => {
    const { a, b, sa, sb, convId } = await setup();
    const incoming = once(sb, 'call:incoming');
    const start = await emitAck<{ callId: string; reachable: boolean }>(sa, 'call:start', { conversationId: convId, type: 'VIDEO' });
    expect(start).toMatchObject({ ok: true, data: { reachable: true } });
    const callId = start.data!.callId;
    expect(await incoming).toMatchObject({ callId, type: 'VIDEO', from: { id: a.id } });

    const accepted = once(sa, 'call:accepted');
    const acc = await emitAck(sb, 'call:accept', { callId });
    expect(acc).toMatchObject({ ok: true, data: { type: 'VIDEO', peers: [a.id] } });
    expect(await accepted).toEqual({ callId, userId: b.id });

    const offer = once(sb, 'call:signal');
    sa.emit('call:signal', { callId, to: b.id, data: { type: 'offer', sdp: 'v=0 offer' } });
    expect(await offer).toEqual({ callId, from: a.id, data: { type: 'offer', sdp: 'v=0 offer' } });
    const answer = once(sa, 'call:signal');
    sb.emit('call:signal', { callId, to: a.id, data: { type: 'answer', sdp: 'v=0 answer' } });
    expect((await answer).data).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    const ice = once(sa, 'call:signal');
    sb.emit('call:signal', { callId, to: a.id, data: { type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } } });
    expect((await ice).data.type).toBe('candidate');

    // An outsider can't inject signals into the call.
    const eve = await register(srv);
    const se = await connect(srv, eve);
    let leaked = false;
    sa.once('call:signal', () => (leaked = true));
    se.emit('call:signal', { callId, to: a.id, data: { type: 'offer', sdp: 'evil' } });
    const accEve = await emitAck(se, 'call:accept', { callId });
    expect(accEve.ok).toBe(false);
    await sleep(200);
    expect(leaked).toBe(false);

    const ended = once(sb, 'call:ended');
    sa.emit('call:end', { callId });
    expect(await ended).toMatchObject({ callId, status: 'ENDED' });
    const row = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(row).toMatchObject({ status: 'ENDED', type: 'VIDEO' });
    expect(row.answeredAt).not.toBeNull();

    const hist = await b.agent.get('/api/calls').expect(200);
    expect(hist.body.items[0]).toMatchObject({ id: callId, status: 'ENDED', outgoing: false, missed: false });
    [sa, sb, se].forEach((s) => s.disconnect());
  });

  it('declined calls end for the caller', async () => {
    const { sa, sb, convId } = await setup();
    const incoming = once(sb, 'call:incoming');
    const start = await emitAck<{ callId: string }>(sa, 'call:start', { conversationId: convId, type: 'AUDIO' });
    await incoming;
    const rejected = once(sa, 'call:rejected');
    const ended = once(sa, 'call:ended');
    sb.emit('call:reject', { callId: start.data!.callId });
    expect((await rejected).reason).toBe('declined');
    expect((await ended).status).toBe('REJECTED');
    sa.disconnect();
    sb.disconnect();
  });

  it('says busy when the other person is in a call', async () => {
    const { b, sa, sb, convId } = await setup();
    const c = await register(srv);
    const sc = await connect(srv, c);
    const conv2 = await c.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(200);
    const first = await emitAck<{ callId: string }>(sa, 'call:start', { conversationId: convId, type: 'AUDIO' });
    await emitAck(sb, 'call:accept', { callId: first.data!.callId });
    const second = await emitAck(sc, 'call:start', { conversationId: conv2.body.id, type: 'AUDIO' });
    expect(second).toMatchObject({ ok: false, error: 'User is busy on another call' });
    sa.emit('call:end', { callId: first.data!.callId });
    [sa, sb, sc].forEach((s) => s.disconnect());
  });

  it('unanswered calls become missed calls with a notification', async () => {
    const { b, sa, sb, convId } = await setup();
    const note = once(sb, 'notification', 9000);
    const start = await emitAck<{ callId: string }>(sa, 'call:start', { conversationId: convId, type: 'AUDIO' });
    const ended = once(sa, 'call:ended', 9000);
    expect((await ended).status).toBe('MISSED');
    expect(await note).toMatchObject({ type: 'missed_call', title: 'Missed voice call' });
    const hist = await b.agent.get('/api/calls?missed=1').expect(200);
    expect(hist.body.items.map((c: { id: string }) => c.id)).toEqual([start.data!.callId]);
    const msgs = await b.agent.get(`/api/conversations/${convId}/messages`).expect(200);
    expect(msgs.body.messages.at(-1)).toMatchObject({ kind: 'CALL', body: '📞 Missed voice call' });
    sa.disconnect();
    sb.disconnect();
  }, 15000);

  it('a dropped connection can resume the call within the grace period', async () => {
    const { a, b, sa, sb, convId } = await setup();
    const start = await emitAck<{ callId: string }>(sa, 'call:start', { conversationId: convId, type: 'AUDIO' });
    const callId = start.data!.callId;
    await emitAck(sb, 'call:accept', { callId });
    sb.disconnect();
    await sleep(200);
    const sb2 = await connect(srv, b);
    const resumed = once(sa, 'call:resumed');
    const r = await emitAck(sb2, 'call:resume', { callId });
    expect(r).toMatchObject({ ok: true, data: { peers: [a.id] } });
    expect(await resumed).toEqual({ callId, userId: b.id });
    // Signals now reach the new connection.
    const sig = once(sb2, 'call:signal');
    sa.emit('call:signal', { callId, to: b.id, data: { type: 'offer', sdp: 'restart' } });
    expect((await sig).data).toEqual({ type: 'offer', sdp: 'restart' });
    sa.emit('call:end', { callId });
    sa.disconnect();
    sb2.disconnect();
  });

  it('group calls need LiveKit', async () => {
    const a = await register(srv);
    const sa = await connect(srv, a);
    const g = await a.agent.post('/api/conversations/group').send({ name: 'G', memberIds: ['x'] }).expect(201);
    const r = await emitAck(sa, 'call:start', { conversationId: g.body.id, type: 'VIDEO' });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('LiveKit') });
    sa.disconnect();
  });
});

describe('group calls with LiveKit configured', () => {
  it('rings members and gives joined members a room token', async () => {
    const { config } = await import('../src/config.js');
    Object.assign(config, { LIVEKIT_URL: 'ws://livekit.test:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'secret-secret-secret-secret-secret' });
    try {
      const a = await register(srv);
      const b = await register(srv);
      const outsider = await register(srv);
      await befriend(a, b);
      const g = await a.agent.post('/api/conversations/group').send({ name: 'Team', memberIds: [b.id] }).expect(201);
      const sa = await connect(srv, a);
      const sb = await connect(srv, b);
      const ring = once(sb, 'call:incoming');
      const start = await emitAck<{ callId: string; sfu: boolean }>(sa, 'call:start', { conversationId: g.body.id, type: 'VIDEO' });
      expect(start).toMatchObject({ ok: true, data: { sfu: true } });
      expect(await ring).toMatchObject({ group: true, groupName: 'Team' });
      const callId = start.data!.callId;

      const tok = await a.agent.post(`/api/calls/${callId}/token`).expect(200);
      expect(tok.body.url).toBe('ws://livekit.test:7880');
      const claims = JSON.parse(Buffer.from(tok.body.token.split('.')[1], 'base64url').toString());
      expect(claims).toMatchObject({ sub: a.id, video: { roomJoin: true, canPublish: true } });

      // Not joined yet / not a member → no token.
      await b.agent.post(`/api/calls/${callId}/token`).expect(404);
      await outsider.agent.post(`/api/calls/${callId}/token`).expect(404);
      await emitAck(sb, 'call:accept', { callId });
      await b.agent.post(`/api/calls/${callId}/token`).expect(200);
      const active = await b.agent.get(`/api/calls/active/${g.body.id}`).expect(200);
      expect(active.body.id).toBe(callId);

      const ended = once(sb, 'call:ended');
      sa.emit('call:end', { callId });
      sb.emit('call:end', { callId });
      expect((await ended).callId).toBe(callId);
      sa.disconnect();
      sb.disconnect();
    } finally {
      Object.assign(config, { LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined });
    }
  });
});
