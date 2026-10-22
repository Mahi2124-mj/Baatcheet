import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, register, resetDb, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

describe('admin and moderation', () => {
  it('report → review → suspend → audit log', async () => {
    const admin = await register(srv, { email: 'admin@test.local' });
    const a = await register(srv);
    const spammer = await register(srv);
    const conv = await spammer.agent.post('/api/conversations/direct').send({ userId: a.id }).expect(200);
    const m = await spammer.agent.post(`/api/conversations/${conv.body.id}/messages`).send({ clientId: randomUUID(), body: 'buy crypto now!!!' }).expect(201);

    // Outsiders can't report messages they can't see.
    const eve = await register(srv);
    await eve.agent.post('/api/reports').send({ messageId: m.body.id, reason: 'SPAM' }).expect(404);
    await a.agent.post('/api/reports').send({ messageId: m.body.id, reason: 'SPAM', details: 'scam link' }).expect(201);

    const queue = await admin.agent.get('/api/admin/reports').expect(200);
    expect(queue.body[0]).toMatchObject({ reason: 'SPAM', evidence: 'buy crypto now!!!', reported: { id: spammer.id } });

    await admin.agent.post(`/api/admin/users/${spammer.id}/suspend`).send({ reason: 'spam' }).expect(200);
    await spammer.agent.get('/api/auth/me').expect(401);
    const login = await api(srv.http).post('/api/auth/login').send({ email: spammer.email, password: spammer.password });
    expect(login.status).toBe(403);
    await admin.agent.patch(`/api/admin/reports/${queue.body[0].id}`).send({ status: 'ACTIONED', resolution: 'suspended' }).expect(200);

    const log = await admin.agent.get('/api/admin/audit').expect(200);
    expect(log.body.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['user.suspend', 'report.update']));

    await admin.agent.post(`/api/admin/users/${spammer.id}/restore`).expect(200);
    await api(srv.http).post('/api/auth/login').send({ email: spammer.email, password: spammer.password }).expect(200);
  });

  it('stats contain counts but no private content', async () => {
    const admin = await register(srv, { email: 'admin@test.local' });
    const s = await admin.agent.get('/api/admin/stats').expect(200);
    expect(s.body).toMatchObject({ users: 1, messages: 0, openReports: 0 });
    const users = await admin.agent.get('/api/admin/users').expect(200);
    expect(users.body.items[0].passwordHash).toBeUndefined();
    await admin.agent.get('/api/admin/health').expect(200);
  });
});
