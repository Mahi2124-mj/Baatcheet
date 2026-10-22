import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@baatcheet/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { sentMail } from '../src/lib/mail.js';
import { createSocketServer } from '../src/realtime/socket.js';
import { resetPresence } from '../src/services/presence.js';

export const ORIGIN = 'http://localhost:3000';

export interface TestServer {
  http: Server;
  url: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const http = createServer(createApp());
  const io = createSocketServer(http);
  await new Promise<void>((r) => http.listen(0, r));
  const url = `http://localhost:${(http.address() as AddressInfo).port}`;
  return {
    http,
    url,
    async close() {
      io.close();
      await new Promise((r) => http.close(r));
      resetPresence();
    },
  };
}

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
  sentMail.length = 0;
}

let n = 0;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  cookie: string;
  agent: ReturnType<typeof api>;
}

/** Thin wrapper that always sends our Origin (CSRF check) and the user's cookie. */
export function api(app: Server | string, cookie?: string) {
  const r = request(app as never);
  const wrap = (m: 'get' | 'post' | 'patch' | 'delete' | 'put') => (path: string) => {
    const t = r[m](path).set('Origin', ORIGIN);
    return cookie ? t.set('Cookie', cookie) : t;
  };
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), delete: wrap('delete'), put: wrap('put') };
}

export function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'] as string[] | undefined;
  const c = set?.find((x) => x.startsWith('bc_session='));
  if (!c) throw new Error('no session cookie');
  return c.split(';')[0];
}

export async function register(srv: TestServer, opts: { verify?: boolean; name?: string; email?: string } = {}): Promise<TestUser> {
  n += 1;
  const username = `${opts.name ?? 'user'}${n}`.toLowerCase();
  const email = opts.email ?? `${username}@test.local`;
  const password = 'Password123';
  const res = await api(srv.http).post('/api/auth/register').send({ email, password, username, displayName: `${opts.name ?? 'User'} ${n}` });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = cookieFrom(res);
  if (opts.verify !== false) {
    const token = verifyToken(email);
    const v = await api(srv.http).post('/api/auth/verify-email').send({ token });
    if (v.status !== 200) throw new Error('verify failed');
  }
  return { id: res.body.id, email, username, password, cookie, agent: api(srv.http, cookie) };
}

export function lastMail(to: string) {
  const m = [...sentMail].reverse().find((x) => x.to === to);
  if (!m) throw new Error(`no mail to ${to}`);
  return m;
}

export function verifyToken(email: string) {
  return decodeURIComponent(/token=([^\s]+)/.exec(lastMail(email).text)![1]);
}

export async function befriend(a: TestUser, b: TestUser) {
  await a.agent.post('/api/contacts/requests').send({ userId: b.id }).expect(201);
  const list = await b.agent.get('/api/contacts').expect(200);
  await b.agent.post(`/api/contacts/requests/${list.body.incoming[0].id}/accept`).expect(200);
}

export type ClientSocket = Socket<ServerToClient, ClientToServer>;

export async function connect(srv: TestServer, user: TestUser): Promise<ClientSocket> {
  const s: ClientSocket = ioClient(srv.url, { transports: ['websocket'], extraHeaders: { Cookie: user.cookie, Origin: ORIGIN }, reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

export function once<E extends keyof ServerToClient>(s: ClientSocket, event: E, ms = 5000): Promise<Parameters<ServerToClient[E]>[0]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${String(event)}`)), ms);
    (s as unknown as { once: (e: string, f: (x: unknown) => void) => void }).once(event as string, (x: unknown) => {
      clearTimeout(t);
      resolve(x as Parameters<ServerToClient[E]>[0]);
    });
  });
}

export function emitAck<T = unknown>(s: ClientSocket, event: keyof ClientToServer, payload: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((resolve) => (s as unknown as { emit: (...a: unknown[]) => void }).emit(event, payload, resolve));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
