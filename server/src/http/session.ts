import type { NextFunction, Request, Response } from 'express';
import type { Session, User } from '@prisma/client';
import { parseCookie } from 'cookie';
import { allowedOrigins, config, isProd } from '../config.js';
import { prisma } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export const COOKIE = isProd ? '__Host-bc_session' : 'bc_session';

export async function createSession(res: Response, req: Request, userId: string) {
  const token = randomToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
      ip: req.ip,
      expiresAt: new Date(Date.now() + config.SESSION_DAYS * 86400_000),
    },
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_DAYS * 86400_000,
  });
  return session;
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });
}

/** Finds a live session from a raw Cookie header (used by HTTP and Socket.IO). */
export async function sessionFromCookie(cookieHeader: string | undefined) {
  const token = cookieHeader ? parseCookie(cookieHeader)[COOKIE] : undefined;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.suspendedAt) return null;
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return session;
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const s = await sessionFromCookie(req.headers.cookie);
    if (s) {
      const { user, ...session } = s;
      req.user = user;
      req.session = session;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Messaging, calls and contact requests need a verified e-mail (anti-spam). */
export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (!req.user.emailVerifiedAt) return next(forbidden('Please verify your e-mail address first'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') return next(forbidden());
  next();
}

/**
 * CSRF protection: the session cookie is SameSite=Lax, and every state-changing request must
 * come from one of our own origins.
 */
export function checkOrigin(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || origin === config.API_URL)) return next();
  // Upload PUTs are authorised by their signed URL, not the cookie.
  if (req.path.startsWith('/files/')) return next();
  next(forbidden('Request origin not allowed'));
}

export const me = (req: Request) => req.user!;
