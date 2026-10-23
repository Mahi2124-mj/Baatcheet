import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { api, connect, cookieFrom, lastMail, register, resetDb, startServer, type TestServer } from './helpers.js';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.close();
});
beforeEach(resetDb);

describe('registration and login', () => {
  it('registers, stores an argon2 hash and logs in', async () => {
    const u = await register(srv, { verify: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(u.password);
    const me = await u.agent.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ username: u.username, emailVerified: false });
    expect(me.body.passwordHash).toBeUndefined();

    const login = await api(srv.http).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
    expect(cookieFrom(login)).toMatch(/^bc_session=/);
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(login.headers['set-cookie'])).toMatch(/SameSite=Lax/);
  });

  it('signs up and logs in with just a username and password', async () => {
    const res = await api(srv.http).post('/api/auth/register').send({ username: 'Solo.User', password: 'Password123' }).expect(201);
    expect(res.body).toMatchObject({ username: 'solo.user', displayName: 'solo.user', email: null, emailVerified: true });
    expect(await prisma.authToken.count({ where: { userId: res.body.id } })).toBe(0);

    const login = await api(srv.http).post('/api/auth/login').send({ username: 'SOLO.user', password: 'Password123' }).expect(200);
    expect(login.body.id).toBe(res.body.id);
    const wrong = await api(srv.http).post('/api/auth/login').send({ username: 'solo.user', password: 'Wrong12345' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('Wrong username or password');
    // A second account without e-mail is fine (NULL doesn't clash with the unique index).
    await api(srv.http).post('/api/auth/register').send({ username: 'solo_two', password: 'Password123' }).expect(201);
  });

  it('lets an account made without e-mail delete itself', async () => {
    const res = await api(srv.http).post('/api/auth/register').send({ username: 'leaving', password: 'Password123' }).expect(201);
    const agent = api(srv.http, cookieFrom(res));
    await agent.post('/api/auth/delete-account').send({ password: 'Password123' }).expect(200);
    await api(srv.http).post('/api/auth/login').send({ username: 'leaving', password: 'Password123' }).expect(401);
    // The username is free again.
    await api(srv.http).post('/api/auth/register').send({ username: 'leaving', password: 'Password123' }).expect(201);
  });

  it('logs in by username or e-mail for accounts that have one', async () => {
    const u = await register(srv);
    await api(srv.http).post('/api/auth/login').send({ username: u.username, password: u.password }).expect(200);
    await api(srv.http).post('/api/auth/login').send({ username: u.email, password: u.password }).expect(200);
  });

  it('rejects duplicates, weak passwords and bad usernames', async () => {
    const u = await register(srv);
    await api(srv.http).post('/api/auth/register').send({ email: u.email, password: 'Password123', username: 'other_name', displayName: 'X' }).expect(409);
    await api(srv.http).post('/api/auth/register').send({ email: 'new@test.local', password: 'Password123', username: u.username, displayName: 'X' }).expect(409);
    await api(srv.http).post('/api/auth/register').send({ email: 'a@test.local', password: 'short', username: 'abcdef', displayName: 'X' }).expect(400);
    await api(srv.http).post('/api/auth/register').send({ email: 'b@test.local', password: 'Password123', username: 'no spaces!', displayName: 'X' }).expect(400);
  });

  it('locks the account after 5 wrong passwords', async () => {
    const u = await register(srv);
    for (let i = 0; i < 5; i++) await api(srv.http).post('/api/auth/login').send({ email: u.email, password: 'Wrong12345' }).expect(401);
    const locked = await api(srv.http).post('/api/auth/login').send({ email: u.email, password: u.password });
    expect(locked.status).toBe(429);
  });

  it('gives the same answer for unknown e-mails', async () => {
    const r = await api(srv.http).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Password123' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Wrong username or password');
    await api(srv.http).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' }).expect(200);
  });

  it('verifies the e-mail with the link token, only once', async () => {
    const u = await register(srv, { verify: false });
    const token = decodeURIComponent(/token=(\S+)/.exec(lastMail(u.email).text)![1]);
    await api(srv.http).post('/api/auth/verify-email').send({ token }).expect(200);
    await api(srv.http).post('/api/auth/verify-email').send({ token }).expect(400);
    expect((await u.agent.get('/api/auth/me')).body.emailVerified).toBe(true);
  });

  it('resets the password and logs out every session', async () => {
    const u = await register(srv);
    await api(srv.http).post('/api/auth/forgot-password').send({ email: u.email }).expect(200);
    const token = decodeURIComponent(/token=(\S+)/.exec(lastMail(u.email).text)![1]);
    await api(srv.http).post('/api/auth/reset-password').send({ token, password: 'NewPassword9' }).expect(200);
    await u.agent.get('/api/auth/me').expect(401);
    await api(srv.http).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(401);
    await api(srv.http).post('/api/auth/login').send({ email: u.email, password: 'NewPassword9' }).expect(200);
  });

  it('lists and revokes sessions (devices)', async () => {
    const u = await register(srv);
    const second = cookieFrom(await api(srv.http).post('/api/auth/login').send({ email: u.email, password: u.password }));
    const list = await u.agent.get('/api/auth/sessions').expect(200);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await u.agent.delete(`/api/auth/sessions/${other.id}`).expect(200);
    await api(srv.http, second).get('/api/auth/me').expect(401);
    await u.agent.get('/api/auth/me').expect(200);
  });

  it('logs out', async () => {
    const u = await register(srv);
    await u.agent.post('/api/auth/logout').expect(200);
    await u.agent.get('/api/auth/me').expect(401);
  });

  it('deletes the account', async () => {
    const u = await register(srv);
    await u.agent.post('/api/auth/delete-account').send({ password: 'nope' }).expect(400);
    await u.agent.post('/api/auth/delete-account').send({ password: u.password }).expect(200);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    await api(srv.http).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(401);
  });
});

describe('protection', () => {
  it('rejects requests without a session', async () => {
    for (const path of ['/api/conversations', '/api/contacts', '/api/calls', '/api/notifications', '/api/users/search?q=a']) {
      await api(srv.http).get(path).expect(401);
    }
  });

  it('rejects state changes from foreign origins (CSRF)', async () => {
    const u = await register(srv);
    const r = await u.agent.post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(r.status).toBe(403);
    // A foreign page can't pass by pointing Host somewhere else either.
    await u.agent.post('/api/auth/logout').set('Origin', 'https://evil.example').set('Host', 'chat.example.com').expect(403);
  });

  it('accepts the page’s own address even when APP_URL is stale (new tunnel link, LAN IP)', async () => {
    const u = await register(srv);
    // Origin host == the host the request was sent to → same site.
    await u.agent.get('/api/auth/me').expect(200);
    const r = await u.agent.post('/api/auth/logout').set('Origin', 'https://new-link.trycloudflare.com').set('Host', 'new-link.trycloudflare.com');
    expect(r.status).toBe(200);
    // Trailing slash / upper case in the configured origin don't matter.
    await api(srv.http).post('/api/auth/logout').set('Origin', 'HTTP://LOCALHOST:3000/').expect(200);
  });

  it('requires a verified e-mail to start chats', async () => {
    const a = await register(srv, { verify: false });
    const b = await register(srv);
    const r = await a.agent.post('/api/conversations/direct').send({ userId: b.id });
    expect(r.status).toBe(403);
  });

  it('refuses sockets without a valid session', async () => {
    const u = await register(srv);
    await expect(connect(srv, { ...u, cookie: 'bc_session=forged' })).rejects.toThrow(/unauthorized/);
  });

  it('only admins reach the admin API', async () => {
    const u = await register(srv);
    await u.agent.get('/api/admin/stats').expect(403);
    const admin = await register(srv, { email: 'admin@test.local' });
    await admin.agent.get('/api/admin/stats').expect(200);
  });

  it('sets a PIN after logging in, then logs in on another device with username + PIN', async () => {
    const u = await register(srv);
    expect((await u.agent.get('/api/auth/me').expect(200)).body.hasPin).toBe(false);
    await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '4826' }).expect(401);
    await u.agent.put('/api/auth/pin').send({ pin: '12' }).expect(400);
    await u.agent.put('/api/auth/pin').send({ pin: '1111' }).expect(400);
    await u.agent.put('/api/auth/pin').send({ pin: '1234' }).expect(400);
    const set = await u.agent.put('/api/auth/pin').send({ pin: '4826' }).expect(200);
    expect(set.body.hasPin).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    // A fresh device (no cookie); the username is case-insensitive.
    const r = await api(srv.http).post('/api/auth/pin-login').send({ username: u.username.toUpperCase(), pin: '4826' }).expect(200);
    expect(r.body.id).toBe(u.id);
    await api(srv.http, cookieFrom(r)).get('/api/auth/me').expect(200);
    // Removing the PIN turns PIN login off.
    await u.agent.delete('/api/auth/pin').expect(200);
    await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '4826' }).expect(401);
  });

  it('turns PIN login off after 5 wrong PINs', async () => {
    const u = await register(srv);
    await u.agent.put('/api/auth/pin').send({ pin: '4826' }).expect(200);
    for (let i = 0; i < 4; i++) await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '0000' }).expect(401);
    // One wrong guess left; a correct PIN resets the counter.
    await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '4826' }).expect(200);
    for (let i = 0; i < 4; i++) await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '0000' }).expect(401);
    const last = await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '0000' }).expect(401);
    expect(last.body.code).toBe('pin_locked');
    await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '4826' }).expect(401);
    // The password still works.
    await api(srv.http).post('/api/auth/login').send({ username: u.username, password: u.password }).expect(200);
  });

  it('unlocks a logged-in device with the PIN; 5 wrong PINs log the device out', async () => {
    const u = await register(srv);
    // No PIN set: nothing to unlock.
    expect((await u.agent.post('/api/auth/pin/verify').send({ pin: '0000' }).expect(200)).body).toEqual({ ok: true, hasPin: false });
    await u.agent.put('/api/auth/pin').send({ pin: '4826' }).expect(200);
    await api(srv.http).post('/api/auth/pin/verify').send({ pin: '4826' }).expect(401);
    expect((await u.agent.post('/api/auth/pin/verify').send({ pin: '4826' }).expect(200)).body.hasPin).toBe(true);
    for (let i = 0; i < 4; i++) await u.agent.post('/api/auth/pin/verify').send({ pin: '1357' }).expect(401);
    const last = await u.agent.post('/api/auth/pin/verify').send({ pin: '1357' }).expect(401);
    expect(last.body.code).toBe('pin_locked');
    // This device is logged out and the PIN is gone; the password still works.
    await u.agent.get('/api/auth/me').expect(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).pinHash).toBeNull();
    await api(srv.http).post('/api/auth/login').send({ username: u.username, password: u.password }).expect(200);
  });

  it('refuses the PIN of a suspended account', async () => {
    const u = await register(srv);
    await u.agent.put('/api/auth/pin').send({ pin: '4826' }).expect(200);
    await prisma.user.update({ where: { id: u.id }, data: { suspendedAt: new Date() } });
    await api(srv.http).post('/api/auth/pin-login').send({ username: u.username, pin: '4826' }).expect(403);
  });
});

describe('rate limits', () => {
  it('blocks bursts of logins from one IP', async () => {
    const { config } = await import('../src/config.js');
    config.DISABLE_RATE_LIMIT = false;
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) codes.push((await api(srv.http).post('/api/auth/login').send({ email: `x${i}@test.local`, password: 'Password123' })).status);
      expect(codes).toContain(429);
    } finally {
      config.DISABLE_RATE_LIMIT = true;
    }
  });
});

describe('mail server down', () => {
  it('sign-up still works; resend says so; reset answers the same', async () => {
    const { testMail } = await import('../src/lib/mail.js');
    testMail.fail = true;
    try {
      const res = await api(srv.http).post('/api/auth/register').send({ email: 'down@test.local', password: 'Password123', username: 'mail_down', displayName: 'Down' });
      expect(res.status).toBe(201);
      expect(res.body.verificationEmailSent).toBe(false);
      const agent = api(srv.http, cookieFrom(res));
      await agent.get('/api/auth/me').expect(200);
      const again = await agent.post('/api/auth/resend-verification');
      expect(again.status).toBe(502);
      await api(srv.http).post('/api/auth/forgot-password').send({ email: 'down@test.local' }).expect(200);
    } finally {
      testMail.fail = false;
    }
  });
});

describe('client IP behind a tunnel', () => {
  it('rate limits per visitor using the tunnel header', async () => {
    const { config } = await import('../src/config.js');
    // The header is read when the app is built, so start a separate server for this test.
    Object.assign(config, { CLIENT_IP_HEADER: 'cf-connecting-ip', DISABLE_RATE_LIMIT: false });
    const tunnel = await startServer();
    try {
      const hit = (ip: string) => api(tunnel.http).post('/api/auth/login').set('CF-Connecting-IP', ip).send({ email: 'x@test.local', password: 'Password123' });
      const first: number[] = [];
      for (let i = 0; i < 11; i++) first.push((await hit('203.0.113.1')).status);
      expect(first).toContain(429);
      // Another visitor isn't blocked by the first one.
      expect((await hit('203.0.113.2')).status).toBe(401);
    } finally {
      Object.assign(config, { CLIENT_IP_HEADER: undefined, DISABLE_RATE_LIMIT: true });
      await tunnel.close();
    }
  });
});

describe('trial mode', () => {
  it('AUTO_VERIFY_EMAIL makes new accounts verified without any e-mail', async () => {
    const { config, loadConfig } = await import('../src/config.js');
    const { sentMail } = await import('../src/lib/mail.js');
    config.AUTO_VERIFY_EMAIL = true;
    try {
      const res = await api(srv.http).post('/api/auth/register').send({ email: 'trial@test.local', password: 'Password123', username: 'trial_user', displayName: 'Trial' }).expect(201);
      expect(res.body.emailVerified).toBe(true);
      expect(sentMail.filter((m) => m.to === 'trial@test.local')).toHaveLength(0);
    } finally {
      config.AUTO_VERIFY_EMAIL = false;
    }
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x@localhost/x', SESSION_SECRET: 'x'.repeat(40), APP_URL: 'https://chat.example.com' };
    expect(() => loadConfig(prod)).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...prod, AUTO_VERIFY_EMAIL: 'true' })).not.toThrow();
  });
});
