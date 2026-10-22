import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Message } from '@baatcheet/shared';
import { befriend, connect, once, register, resetDb, startServer, type TestServer, type TestUser } from './helpers.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

const send = (u: TestUser, convId: string, body: string) => u.agent.post(`/api/conversations/${convId}/messages`).send({ clientId: randomUUID(), body });

async function group() {
  const owner = await register(srv, { name: 'owner' });
  const m1 = await register(srv, { name: 'meera' });
  const m2 = await register(srv, { name: 'kabir' });
  const stranger = await register(srv, { name: 'stranger' });
  await befriend(owner, m1);
  await befriend(owner, m2);
  const g = await owner.agent.post('/api/conversations/group').send({ name: 'Family', memberIds: [m1.id, m2.id, stranger.id] }).expect(201);
  return { owner, m1, m2, stranger, id: g.body.id as string, body: g.body };
}

describe('groups', () => {
  it('creates a group with contacts only; strangers are skipped', async () => {
    const { id, body, stranger, m1 } = await group();
    expect(body.members).toHaveLength(3);
    expect(body.skipped).toEqual([stranger.id]);
    expect(body.myRole).toBe('OWNER');
    await stranger.agent.get(`/api/conversations/${id}`).expect(404);
    const s = await m1.agent.get(`/api/conversations/${id}`).expect(200);
    expect(s.body).toMatchObject({ type: 'GROUP', name: 'Family', myRole: 'MEMBER' });
  });

  it('delivers group messages to every member', async () => {
    const { owner, m1, m2, id } = await group();
    const s1 = await connect(srv, m1);
    const s2 = await connect(srv, m2);
    await new Promise((r) => setTimeout(r, 100));
    const [g1, g2] = [once(s1, 'message:new'), once(s2, 'message:new')];
    await send(owner, id, 'Dinner at 8').expect(201);
    expect((await g1).body).toBe('Dinner at 8');
    expect((await g2).body).toBe('Dinner at 8');
    s1.disconnect();
    s2.disconnect();
  });

  it('only admins manage members; owner can promote', async () => {
    const { owner, m1, m2, id } = await group();
    await m1.agent.delete(`/api/conversations/${id}/members/${m2.id}`).expect(403);
    await m1.agent.post(`/api/conversations/${id}/invites`).send({}).expect(403);
    await owner.agent.patch(`/api/conversations/${id}/members/${m1.id}`).send({ role: 'ADMIN' }).expect(200);
    await m1.agent.delete(`/api/conversations/${id}/members/${owner.id}`).expect(403);
    await m1.agent.delete(`/api/conversations/${id}/members/${m2.id}`).expect(200);
    // Removed member keeps old history but can't post or read new messages.
    await send(m2, id, 'still here?').expect(404);
    await send(owner, id, 'after removal').expect(201);
    const hist = await m2.agent.get(`/api/conversations/${id}/messages`).expect(200);
    expect(hist.body.messages.map((m: Message) => m.body)).not.toContain('after removal');
  });

  it('admins-only posting', async () => {
    const { owner, m1, id } = await group();
    await m1.agent.patch(`/api/conversations/${id}`).send({ adminsOnlyPost: true }).expect(403);
    await owner.agent.patch(`/api/conversations/${id}`).send({ adminsOnlyPost: true }).expect(200);
    await send(m1, id, 'hi').expect(403);
    await send(owner, id, 'announcement').expect(201);
  });

  it('invite links let people join, and can expire by use count', async () => {
    const { owner, stranger, id } = await group();
    const inv = await owner.agent.post(`/api/conversations/${id}/invites`).send({ maxUses: 1 }).expect(201);
    const preview = await stranger.agent.get(`/api/invites/${inv.body.code}`).expect(200);
    expect(preview.body).toMatchObject({ name: 'Family', members: 3 });
    await stranger.agent.post(`/api/invites/${inv.body.code}/join`).expect(200);
    await send(stranger, id, 'hello all').expect(201);
    const late = await register(srv);
    await late.agent.post(`/api/invites/${inv.body.code}/join`).expect(404);
  });

  it('owner leaving hands the group over; only the owner deletes it', async () => {
    const { owner, m1, m2, id } = await group();
    await m1.agent.delete(`/api/conversations/${id}`).expect(403);
    await owner.agent.delete(`/api/conversations/${id}/members/${owner.id}`).expect(200);
    const roles = (await m1.agent.get(`/api/conversations/${id}`)).body.members.map((m: { role: string }) => m.role);
    expect(roles).toContain('OWNER');
    const s = await m1.agent.get(`/api/conversations/${id}`);
    const ownerUser = s.body.members.find((m: { role: string }) => m.role === 'OWNER').id;
    const who = ownerUser === m1.id ? m1 : m2;
    await who.agent.delete(`/api/conversations/${id}`).expect(200);
    await m1.agent.get(`/api/conversations/${id}`).expect(404);
  });
});
