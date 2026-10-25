import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Message } from '@baatcheet/shared';
import { befriend, connect, emitAck, once, register, resetDb, sleep, startServer, type TestServer, type TestUser } from './helpers.js';
import { prisma } from '../src/db.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

async function pair() {
  const a = await register(srv, { name: 'asha' });
  const b = await register(srv, { name: 'ravi' });
  const conv = await a.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(200);
  return { a, b, convId: conv.body.id as string };
}

const send = (u: TestUser, convId: string, body: string, extra: Record<string, unknown> = {}) =>
  u.agent.post(`/api/conversations/${convId}/messages`).send({ clientId: randomUUID(), body, ...extra });

describe('direct messages', () => {
  it('delivers in real time over sockets and persists', async () => {
    const { a, b, convId } = await pair();
    const sa = await connect(srv, a);
    const sb = await connect(srv, b);
    const got = once(sb, 'message:new');
    const res = await emitAck<Message>(sa, 'message:send', { conversationId: convId, clientId: randomUUID(), body: 'Namaste 👋' });
    expect(res.ok).toBe(true);
    const m = await got;
    expect(m.body).toBe('Namaste 👋');
    expect(m.senderId).toBe(a.id);

    // After a "refresh": history comes from the database.
    const hist = await b.agent.get(`/api/conversations/${convId}/messages`).expect(200);
    expect(hist.body.messages.map((x: Message) => x.body)).toEqual(['Namaste 👋']);
    const list = await b.agent.get('/api/conversations').expect(200);
    expect(list.body[0]).toMatchObject({ id: convId, unread: 1, name: expect.stringContaining('asha') });
    sa.disconnect();
    sb.disconnect();
  });

  it('ignores a duplicate send with the same clientId', async () => {
    const { a, convId } = await pair();
    const clientId = randomUUID();
    const r1 = await a.agent.post(`/api/conversations/${convId}/messages`).send({ clientId, body: 'once' }).expect(201);
    const r2 = await a.agent.post(`/api/conversations/${convId}/messages`).send({ clientId, body: 'once' }).expect(200);
    expect(r2.body.id).toBe(r1.body.id);
    const hist = await a.agent.get(`/api/conversations/${convId}/messages`).expect(200);
    expect(hist.body.messages).toHaveLength(1);
  });

  it('paginates with a cursor, oldest first within a page', async () => {
    const { a, convId } = await pair();
    for (let i = 0; i < 7; i++) await send(a, convId, `m${i}`).expect(201);
    const p1 = await a.agent.get(`/api/conversations/${convId}/messages?limit=3`).expect(200);
    expect(p1.body.messages.map((m: Message) => m.body)).toEqual(['m4', 'm5', 'm6']);
    const p2 = await a.agent.get(`/api/conversations/${convId}/messages?limit=3&before=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.messages.map((m: Message) => m.body)).toEqual(['m1', 'm2', 'm3']);
    const p3 = await a.agent.get(`/api/conversations/${convId}/messages?limit=3&before=${p2.body.nextCursor}`).expect(200);
    expect(p3.body.messages.map((m: Message) => m.body)).toEqual(['m0']);
    expect(p3.body.nextCursor).toBeNull();
  });

  it('keeps other people out of the conversation', async () => {
    const { a, convId } = await pair();
    const msg = await send(a, convId, 'private').expect(201);
    const eve = await register(srv, { name: 'eve' });
    await eve.agent.get(`/api/conversations/${convId}`).expect(404);
    await eve.agent.get(`/api/conversations/${convId}/messages`).expect(404);
    await send(eve, convId, 'hi').expect(404);
    await eve.agent.patch(`/api/messages/${msg.body.id}`).send({ body: 'hacked' }).expect(404);
    await eve.agent.delete(`/api/messages/${msg.body.id}`).expect(404);
    await eve.agent.post(`/api/messages/${msg.body.id}/reactions`).send({ emoji: '😂' }).expect(404);
    const search = await eve.agent.get('/api/messages/search?q=private').expect(200);
    expect(search.body).toEqual([]);
    // Socket: an outsider can't post either, and gets no events.
    const se = await connect(srv, eve);
    const r = await emitAck(se, 'message:send', { conversationId: convId, clientId: randomUUID(), body: 'x' });
    expect(r.ok).toBe(false);
    se.disconnect();
  });

  it('edits and deletes only own messages', async () => {
    const { a, b, convId } = await pair();
    const m = await send(a, convId, 'helo').expect(201);
    await b.agent.patch(`/api/messages/${m.body.id}`).send({ body: 'nope' }).expect(403);
    const edited = await a.agent.patch(`/api/messages/${m.body.id}`).send({ body: 'hello' }).expect(200);
    expect(edited.body).toMatchObject({ body: 'hello', editedAt: expect.any(String) });
    await b.agent.delete(`/api/messages/${m.body.id}`).expect(403);
    await a.agent.delete(`/api/messages/${m.body.id}`).expect(200);
    // Deleted means deleted: no row left, not even a "This message was deleted" placeholder.
    expect(await prisma.message.findUnique({ where: { id: m.body.id } })).toBeNull();
    await a.agent.delete(`/api/messages/${m.body.id}`).expect(404);
  });

  it('replies, reactions and search', async () => {
    const { a, b, convId } = await pair();
    const m = await send(a, convId, 'Kal chai pe milte hain').expect(201);
    const r = await send(b, convId, 'Pakka!', { replyToId: m.body.id }).expect(201);
    expect(r.body.replyTo).toMatchObject({ id: m.body.id, body: 'Kal chai pe milte hain' });
    const re = await b.agent.post(`/api/messages/${m.body.id}/reactions`).send({ emoji: '❤️' }).expect(200);
    expect(re.body.reactions).toEqual([{ emoji: '❤️', userIds: [b.id] }]);
    await b.agent.post(`/api/messages/${m.body.id}/reactions`).send({ emoji: 'not emoji' }).expect(400);
    const found = await a.agent.get('/api/messages/search?q=CHAI').expect(200);
    expect(found.body.map((x: Message) => x.id)).toEqual([m.body.id]);
  });

  it('"delete for me" deletes the message for good, for everyone', async () => {
    const { a, b, convId } = await pair();
    const first = (await send(a, convId, 'one').expect(201)).body;
    const second = (await send(a, convId, 'two').expect(201)).body;
    const list = async (u: TestUser) => (await u.agent.get(`/api/conversations/${convId}/messages`).expect(200)).body.messages.map((m: { id: string }) => m.id);
    const sa = await connect(srv, a);
    // b deletes a's message (someone else's); outsiders can't.
    const c = await register(srv);
    await c.agent.post(`/api/messages/${second.id}/hide`).expect(404);
    const removed = once(sa, 'message:removed');
    await b.agent.post(`/api/messages/${second.id}/hide`).expect(200);
    expect(await removed).toEqual({ conversationId: convId, messageIds: [second.id] });
    await b.agent.post(`/api/messages/${second.id}/hide`).expect(404);
    expect(await prisma.message.findUnique({ where: { id: second.id } })).toBeNull();
    expect(await list(b)).toEqual([first.id]);
    expect(await list(a)).toEqual([first.id]);
    const convs = (await b.agent.get('/api/conversations').expect(200)).body;
    expect(convs.find((x: { id: string }) => x.id === convId).lastMessage.id).toBe(first.id);
    sa.disconnect();
  });

  it('clear chat / clear all chats delete the messages for good, for everyone', async () => {
    const { a, b, convId } = await pair();
    await send(a, convId, 'hello').expect(201);
    const list = async (u: TestUser) => (await u.agent.get(`/api/conversations/${convId}/messages`).expect(200)).body.messages.length;
    const sa = await connect(srv, a);
    const cleared = once(sa, 'chat:cleared');
    await b.agent.post(`/api/conversations/${convId}/clear`).expect(200);
    expect((await cleared).conversationId).toBe(convId);
    expect(await list(b)).toBe(0);
    expect(await list(a)).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(0);
    await send(a, convId, 'again').expect(201);
    expect(await list(b)).toBe(1);
    const r = await b.agent.post('/api/conversations/clear-all').expect(200);
    expect(r.body.count).toBe(1);
    expect(await list(a)).toBe(0);
    sa.disconnect();
  });

  it('read receipts, typing and presence', async () => {
    const { a, b, convId } = await pair();
    const sa = await connect(srv, a);
    const sb = await connect(srv, b);
    const m = await send(a, convId, 'seen?').expect(201);
    const receipt = once(sa, 'receipt');
    sb.emit('message:read', { conversationId: convId, messageId: m.body.id });
    expect(await receipt).toMatchObject({ userId: b.id, readAt: m.body.createdAt });
    const list = await b.agent.get('/api/conversations').expect(200);
    expect(list.body[0].unread).toBe(0);

    const typing = once(sa, 'typing');
    sb.emit('typing', { conversationId: convId, typing: true });
    expect(await typing).toEqual({ conversationId: convId, userId: b.id, typing: true });

    const offline = once(sa, 'presence');
    sb.disconnect();
    expect(await offline).toMatchObject({ userId: b.id, online: false, lastSeenAt: expect.any(String) });
    sa.disconnect();
  });

  it('hides read receipts when the reader turned them off', async () => {
    const { a, b, convId } = await pair();
    await b.agent.patch('/api/users/me/settings').send({ readReceipts: false }).expect(200);
    const m = await send(a, convId, 'x').expect(201);
    await b.agent.post(`/api/conversations/${convId}/read`).send({ messageId: m.body.id }).expect(200);
    const s = await a.agent.get(`/api/conversations/${convId}`).expect(200);
    expect(s.body.receipts[b.id]).toEqual({ deliveredAt: m.body.createdAt, readAt: null });
  });

  it('blocking stops messages both ways', async () => {
    const { a, b, convId } = await pair();
    await b.agent.post(`/api/users/${a.id}/block`).expect(200);
    await send(a, convId, 'hello?').expect(403);
    await send(b, convId, 'hello?').expect(403);
    await a.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(403);
    await a.agent.post('/api/contacts/requests').send({ userId: b.id }).expect(403);
    const search = await a.agent.get(`/api/users/search?q=${b.username}`).expect(200);
    expect(search.body).toEqual([]);
    await b.agent.delete(`/api/users/${a.id}/block`).expect(200);
    await send(a, convId, 'hello again').expect(201);
  });

  it('“contacts only” stops strangers until they are contacts', async () => {
    const a = await register(srv);
    const b = await register(srv);
    await b.agent.patch('/api/users/me/settings').send({ allowMessagesFrom: 'CONTACTS' }).expect(200);
    const conv = await a.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(200);
    await send(a, conv.body.id, 'hi').expect(403);
    await befriend(a, b);
    await send(a, conv.body.id, 'hi').expect(201);
  });

  it('pin, archive and mute are per user', async () => {
    const { a, b, convId } = await pair();
    const r = await a.agent.patch(`/api/conversations/${convId}/me`).send({ pinned: true, archived: true, mutedForSeconds: 3600 }).expect(200);
    expect(r.body).toMatchObject({ pinned: true, archived: true, muted: true });
    const other = await b.agent.get(`/api/conversations/${convId}`).expect(200);
    expect(other.body).toMatchObject({ pinned: false, archived: false, muted: false });
  });

  it('privacy hides last seen from non-contacts', async () => {
    const { a, b } = await pair();
    await b.agent.patch('/api/users/me/settings').send({ lastSeenVisibility: 'CONTACTS' }).expect(200);
    const sb = await connect(srv, b);
    await sleep(50);
    const p = await a.agent.get(`/api/users/by-name/${b.username}`).expect(200);
    expect(p.body.user.online).toBeUndefined();
    await befriend(a, b);
    const p2 = await a.agent.get(`/api/users/by-name/${b.username}`).expect(200);
    expect(p2.body.user.online).toBe(true);
    sb.disconnect();
  });
});

describe('contacts', () => {
  it('request, accept, list, remove', async () => {
    const a = await register(srv);
    const b = await register(srv);
    const sb = await connect(srv, b);
    const note = once(sb, 'notification');
    await a.agent.post('/api/contacts/requests').send({ userId: b.id }).expect(201);
    expect((await note).type).toBe('contact_request');
    const list = await b.agent.get('/api/contacts').expect(200);
    expect(list.body.incoming).toHaveLength(1);
    await b.agent.post(`/api/contacts/requests/${list.body.incoming[0].id}/accept`).expect(200);
    expect((await a.agent.get('/api/contacts')).body.contacts.map((c: { id: string }) => c.id)).toEqual([b.id]);
    expect((await b.agent.get('/api/contacts')).body.contacts.map((c: { id: string }) => c.id)).toEqual([a.id]);
    await a.agent.delete(`/api/contacts/${b.id}`).expect(200);
    expect((await b.agent.get('/api/contacts')).body.contacts).toEqual([]);
    sb.disconnect();
  });

  it('finds users by username', async () => {
    const a = await register(srv);
    const b = await register(srv, { name: 'zoya' });
    const r = await a.agent.get(`/api/users/search?q=${b.username.slice(0, 4)}`).expect(200);
    expect(r.body[0]).toMatchObject({ id: b.id, username: b.username });
    expect(r.body[0].email).toBeUndefined();
  });
});
