import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config.js';

/** Per-IP rate limit (in memory; use a shared store such as Redis when running several API servers). */
export function limit(windowMs: number, max: number, opts: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.DISABLE_RATE_LIMIT,
    message: { error: 'Too many requests, please wait a bit and try again', code: 'rate_limited' },
    ...opts,
  });
}

/** Small token bucket for socket events, per user. */
export class Bucket {
  private tokens = new Map<string, { n: number; at: number }>();
  constructor(private perSecond: number, private burst: number) {}
  take(id: string): boolean {
    if (config.DISABLE_RATE_LIMIT) return true;
    const now = Date.now();
    const b = this.tokens.get(id) ?? { n: this.burst, at: now };
    b.n = Math.min(this.burst, b.n + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    if (b.n < 1) {
      this.tokens.set(id, b);
      return false;
    }
    b.n -= 1;
    this.tokens.set(id, b);
    return true;
  }
}
