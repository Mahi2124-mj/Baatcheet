import { Router } from 'express';
import { z } from 'zod';
import { email as emailSchema, loginInput, password as passwordSchema, registerInput, resetInput } from '@baatcheet/shared';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { dummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { HttpError, badRequest, conflict, h, notFound, parse, unauthorized } from '../../lib/errors.js';
import { sendMail } from '../../lib/mail.js';
import { limit } from '../../lib/rate.js';
import { deleteObject } from '../../lib/storage.js';
import { disconnectSession, disconnectUser } from '../../realtime/hub.js';
import { audit } from '../../services/audit.js';
import { mePayload } from '../../services/me.js';
import { findByLoginCode, getLoginCode, newLoginCode } from '../../services/loginCode.js';
import { clearSessionCookie, createSession, me, requireAuth } from '../session.js';

export const auth = Router();

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const strict = limit(15 * 60_000, 20);
const loginLimit = limit(60_000, 10);

async function issueToken(userId: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', hours: number) {
  await prisma.authToken.deleteMany({ where: { userId, purpose, usedAt: null } });
  const token = randomToken();
  await prisma.authToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return token;
}

async function useToken(token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw badRequest('This link is invalid or has expired');
  await prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row.userId;
}

async function sendVerification(userId: string, to: string) {
  const token = await issueToken(userId, 'VERIFY_EMAIL', 48);
  const link = `${config.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail(to, 'Verify your Baatcheet e-mail', `Welcome to Baatcheet!\n\nConfirm your e-mail address:\n${link}\n\nThe link works for 48 hours.`);
}

const listed = (list: string, value?: string) => !!value && list.split(',').map((s) => s.trim().toLowerCase()).includes(value);
const isAdmin = (email: string | undefined, username: string) => listed(config.ADMIN_EMAILS, email) || listed(config.ADMIN_USERNAMES, username);

auth.post('/register', strict, h(async (req, res) => {
  const input = parse(registerInput, req.body);
  if (await prisma.userProfile.findUnique({ where: { username: input.username } })) throw conflict('That username is taken');
  if (input.email && await prisma.user.findUnique({ where: { email: input.email } })) throw conflict('An account with this e-mail already exists');
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: isAdmin(input.email, input.username) ? 'ADMIN' : 'USER',
      // Without an e-mail there is nothing to verify, so the account is ready straight away.
      emailVerifiedAt: !input.email || config.AUTO_VERIFY_EMAIL ? new Date() : null,
      profile: { create: { username: input.username, displayName: input.displayName ?? input.username } },
    },
  }).catch((e: { code?: string }) => {
    if (e.code === 'P2002') throw conflict('That e-mail or username is taken');
    throw e;
  });
  // A mail server that is down must not break sign-up: the account exists, the user can resend later.
  const verificationEmailSent = config.AUTO_VERIFY_EMAIL || (user.email !== null && await sendVerification(user.id, user.email).then(
    () => true,
    (err) => {
      req.log?.error({ err }, 'verification e-mail failed');
      return false;
    },
  ));
  const loginCode = await newLoginCode(user.id);
  await createSession(res, req, user.id);
  res.status(201).json({ ...(await mePayload(user.id)), verificationEmailSent, loginCode });
}));

auth.post('/login', loginLimit, h(async (req, res) => {
  const input = parse(loginInput, req.body);
  const name = (input.email ?? input.username)!;
  const user = name.includes('@')
    ? await prisma.user.findUnique({ where: { email: name } })
    : (await prisma.userProfile.findUnique({ where: { username: name }, include: { user: true } }))?.user ?? null;
  if (!user) {
    await verifyPassword(await dummyHash(), input.password);
    throw unauthorized('Wrong username or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes or reset your password.', 'locked');
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const fails = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: fails },
    });
    throw unauthorized('Wrong username or password');
  }
  if (user.suspendedAt) throw new HttpError(403, 'This account is suspended', 'suspended');
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await createSession(res, req, user.id);
  res.json(await mePayload(user.id));
}));

auth.post('/logout', h(async (req, res) => {
  if (req.session) {
    await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
    disconnectSession(req.session.id);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

auth.get('/me', requireAuth, h(async (req, res) => {
  res.json(await mePayload(me(req).id));
}));

auth.post('/verify-email', strict, h(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  const userId = await useToken(token, 'VERIFY_EMAIL');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  res.json({ ok: true });
}));

auth.post('/resend-verification', requireAuth, limit(60 * 60_000, 5), h(async (req, res) => {
  const user = me(req);
  if (user.emailVerifiedAt || !user.email) return res.json({ ok: true, alreadyVerified: true });
  try {
    await sendVerification(user.id, user.email);
  } catch (err) {
    req.log?.error({ err }, 'verification e-mail failed');
    throw new HttpError(502, 'Couldn’t send the e-mail right now. Please try again in a few minutes.', 'mail_failed');
  }
  res.json({ ok: true });
}));

auth.post('/forgot-password', strict, h(async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.suspendedAt) {
    const token = await issueToken(user.id, 'RESET_PASSWORD', 1);
    const link = `${config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail(email, 'Reset your Baatcheet password', `Someone asked to reset your password.\n\nSet a new one here (valid for 1 hour):\n${link}\n\nIf it wasn't you, ignore this e-mail.`).catch((err) =>
      req.log?.error({ err }, 'reset e-mail failed'),
    );
  }
  // Same answer either way, so this can't be used to find accounts.
  res.json({ ok: true });
}));

auth.post('/reset-password', strict, h(async (req, res) => {
  const input = parse(resetInput, req.body);
  const userId = await useToken(input.token, 'RESET_PASSWORD');
  await prisma.user.update({
    where: { id: userId },
    // Reaching the link proves the mailbox too.
    data: { passwordHash: await hashPassword(input.password), failedLogins: 0, lockedUntil: null, emailVerifiedAt: new Date() },
  });
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  disconnectUser(userId);
  res.json({ ok: true });
}));

auth.post('/change-password', requireAuth, strict, h(async (req, res) => {
  const input = parse(z.object({ current: z.string().min(1).max(128), password: passwordSchema }), req.body);
  const user = me(req);
  if (!(await verifyPassword(user.passwordHash, input.current))) throw badRequest('Current password is wrong');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } });
  // Log out every other device.
  const others = await prisma.session.findMany({ where: { userId: user.id, revokedAt: null, id: { not: req.session!.id } } });
  await prisma.session.updateMany({ where: { id: { in: others.map((s) => s.id) } }, data: { revokedAt: new Date() } });
  others.forEach((s) => disconnectSession(s.id));
  res.json({ ok: true });
}));

// ----- personal login code (sign in on any device without e-mail or password) -----

auth.post('/code-login', limit(15 * 60_000, 10), h(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(1).max(40) }), req.body);
  const user = await findByLoginCode(code);
  if (!user) throw unauthorized('Wrong code. Check it in Settings → Login code on a device where you are logged in.');
  if (user.suspendedAt) throw new HttpError(403, 'This account is suspended', 'suspended');
  await createSession(res, req, user.id);
  res.json(await mePayload(user.id));
}));

auth.get('/login-code', requireAuth, h(async (req, res) => {
  res.json({ code: await getLoginCode(me(req).id) });
}));

auth.post('/login-code/regenerate', requireAuth, strict, h(async (req, res) => {
  const code = await newLoginCode(me(req).id);
  await audit(me(req).id, 'login_code.regenerate', 'user', me(req).id, req.ip);
  res.json({ code });
}));

// ----- sessions / devices -----

auth.get('/sessions', requireAuth, h(async (req, res) => {
  const rows = await prisma.session.findMany({
    where: { userId: me(req).id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  res.json(rows.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s.id === req.session!.id })));
}));

auth.delete('/sessions/:id', requireAuth, h(async (req, res) => {
  const s = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!s || s.userId !== me(req).id) throw notFound('Session not found');
  await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  disconnectSession(s.id);
  res.json({ ok: true });
}));

auth.post('/sessions/revoke-others', requireAuth, h(async (req, res) => {
  const others = await prisma.session.findMany({ where: { userId: me(req).id, revokedAt: null, id: { not: req.session!.id } } });
  await prisma.session.updateMany({ where: { id: { in: others.map((s) => s.id) } }, data: { revokedAt: new Date() } });
  others.forEach((s) => disconnectSession(s.id));
  res.json({ ok: true, count: others.length });
}));

// ----- account deletion -----

auth.post('/delete-account', requireAuth, strict, h(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
  const user = me(req);
  if (!(await verifyPassword(user.passwordHash, password))) throw badRequest('Password is wrong');
  const uploads = await prisma.upload.findMany({ where: { userId: user.id }, select: { key: true } });
  // Messages stay in other people's chats as "Deleted user" (sender set to null by the database);
  // the user's files, profile, contacts, sessions and memberships are removed.
  await prisma.messageAttachment.deleteMany({ where: { message: { senderId: user.id } } });
  await prisma.message.updateMany({ where: { senderId: user.id }, data: { body: null, deletedAt: new Date() } });
  await audit(user.id, 'account.delete', 'user', user.id, req.ip);
  await prisma.user.delete({ where: { id: user.id } });
  await Promise.all(uploads.map((u) => deleteObject(u.key)));
  disconnectUser(user.id);
  clearSessionCookie(res);
  res.json({ ok: true });
}));
