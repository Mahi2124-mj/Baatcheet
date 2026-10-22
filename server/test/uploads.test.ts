import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { register, resetDb, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

/** The test server's API_URL is fixed; send signed URLs to the real port instead. */
const local = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

describe('attachments', () => {
  it('upload → send → only members can download', async () => {
    const a = await register(srv);
    const b = await register(srv);
    const conv = await a.agent.post('/api/conversations/direct').send({ userId: b.id }).expect(200);
    const file = Buffer.from('%PDF-1.4 hello');
    const up = await a.agent.post('/api/uploads').send({ name: 'notes.pdf', size: file.length, mime: 'application/pdf', purpose: 'attachment' }).expect(201);
    expect(up.body.key).toMatch(new RegExp(`^att/${a.id}/.+\\.pdf$`));

    // Sending before the file is uploaded fails.
    await a.agent.post(`/api/conversations/${conv.body.id}/messages`).send({ clientId: randomUUID(), attachments: [{ key: up.body.key, name: 'notes.pdf', size: file.length, mime: 'application/pdf' }] }).expect(400);

    await request(srv.http).put(local(up.body.upload.url)).set('Content-Type', 'application/pdf').send(file).expect(200);
    const msg = await a.agent
      .post(`/api/conversations/${conv.body.id}/messages`)
      .send({ clientId: randomUUID(), attachments: [{ key: up.body.key, name: 'notes.pdf', size: file.length, mime: 'application/pdf' }] })
      .expect(201);
    expect(msg.body.attachments[0]).toMatchObject({ kind: 'document', name: 'notes.pdf', size: file.length });

    // b (a member) gets a signed URL that works.
    const hist = await b.agent.get(`/api/conversations/${conv.body.id}/messages`).expect(200);
    const url = hist.body.messages[0].attachments[0].url as string;
    const dl = await request(srv.http).get(local(url)).expect(200);
    expect(Buffer.from(dl.body).toString()).toBe(file.toString());
    expect(dl.headers['content-security-policy']).toContain('sandbox');

    // A tampered signature or a different key is refused.
    await request(srv.http).get(local(url).replace(/sig=[^&]+/, 'sig=AAAA')).expect(403);
    await request(srv.http).get(local(url).replace(/key=[^&]+/, `key=${encodeURIComponent(`att/${b.id}/x.pdf`)}`)).expect(403);

    // The key can't be reused by someone else.
    const eve = await register(srv);
    const c2 = await eve.agent.post('/api/conversations/direct').send({ userId: a.id }).expect(200);
    await eve.agent.post(`/api/conversations/${c2.body.id}/messages`).send({ clientId: randomUUID(), attachments: [{ key: up.body.key, name: 'x', size: 1, mime: 'application/pdf' }] }).expect(400);
  });

  it('validates type and size', async () => {
    const a = await register(srv);
    await a.agent.post('/api/uploads').send({ name: 'x.exe', size: 10, mime: 'application/x-msdownload', purpose: 'attachment' }).expect(400);
    await a.agent.post('/api/uploads').send({ name: 'big.png', size: 50 * 1024 * 1024, mime: 'image/png', purpose: 'attachment' }).expect(413);
    await a.agent.post('/api/uploads').send({ name: 'me.pdf', size: 10, mime: 'application/pdf', purpose: 'avatar' }).expect(400);
    // Uploading more bytes than announced fails.
    const up = await a.agent.post('/api/uploads').send({ name: 'a.txt', size: 3, mime: 'text/plain', purpose: 'attachment' }).expect(201);
    await request(srv.http).put(local(up.body.upload.url)).set('Content-Type', 'text/plain').send('too long').expect(413);
    // Wrong content type for the signed URL fails.
    await request(srv.http).put(local(up.body.upload.url)).set('Content-Type', 'text/html').send('abc').expect(400);
  });

  it('sets a profile picture from an upload', async () => {
    const a = await register(srv);
    const img = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const up = await a.agent.post('/api/uploads').send({ name: 'me.png', size: img.length, mime: 'image/png', purpose: 'avatar' }).expect(201);
    await request(srv.http).put(local(up.body.upload.url)).set('Content-Type', 'image/png').send(img).expect(200);
    const me = await a.agent.patch('/api/users/me').send({ avatarKey: up.body.key }).expect(200);
    expect(me.body.avatarUrl).toContain('/files/get?');
    const b = await register(srv);
    await b.agent.patch('/api/users/me').send({ avatarKey: up.body.key }).expect(400);
  });
});
