// Personal login codes: every user has one unique code (e.g. "K7QM-3XRP-9WTD") that signs them in on any
// device without e-mail or password. The database keeps a SHA-256 hash for lookup and an AES-GCM
// encrypted copy, so the owner can see their code again in Settings. A new code replaces the old one.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sha256 } from '../lib/crypto.js';

// No 0/O, 1/I/L or U/V lookalikes, so codes are easy to read out and type on a phone.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
const LENGTH = 12; // 29^12 ≈ 3.5e17 (~58 bits): can't be guessed, even without the rate limit.

/** Uppercases and strips spaces / dashes, so "k7qm 3xrp-9wtd" works too. */
export function normalizeCode(input: string) {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatCode(code: string) {
  return code.match(/.{1,4}/g)!.join('-');
}

export const codeHash = (code: string) => sha256(`login-code:${normalizeCode(code)}`);

const key = () => createHash('sha256').update(`login-code-key:${config.SESSION_SECRET}`).digest();

function encrypt(code: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(code, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

function decrypt(value: string): string | null {
  try {
    const [iv, tag, data] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    // SESSION_SECRET was changed: the old code can't be shown any more; a new one is made.
    return null;
  }
}

function generate() {
  let s = '';
  for (let i = 0; i < LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Makes a new code for the user (the old one stops working) and returns it formatted. */
export async function newLoginCode(userId: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const code = generate();
    try {
      await prisma.user.update({ where: { id: userId }, data: { loginCodeHash: codeHash(code), loginCodeEnc: encrypt(code) } });
      return formatCode(code);
    } catch (e) {
      // A clash on the unique hash is practically impossible; retry a couple of times anyway.
      if ((e as { code?: string }).code === 'P2002' && attempt < 3) continue;
      throw e;
    }
  }
}

/** The user's current code, creating one if they have none yet. */
export async function getLoginCode(userId: string): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { loginCodeEnc: true } });
  const code = u.loginCodeEnc ? decrypt(u.loginCodeEnc) : null;
  return code ? formatCode(code) : newLoginCode(userId);
}

export function findByLoginCode(code: string) {
  const n = normalizeCode(code);
  if (n.length !== LENGTH) return Promise.resolve(null);
  return prisma.user.findUnique({ where: { loginCodeHash: codeHash(n) } });
}
