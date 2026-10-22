import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().url(),
    /** Public URL of the web app (links in e-mails, CORS origin). */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /** Public URL of this API (for local-storage upload links). */
    API_URL: z.string().url().default('http://localhost:4000'),
    /** Extra allowed browser origins, comma separated. */
    CORS_ORIGINS: z.string().default(''),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
    COOKIE_DOMAIN: z.string().optional(),
    /** Header that carries the visitor's IP, set by a tunnel the API is only reachable through
     *  (e.g. cf-connecting-ip behind Cloudflare Tunnel). Overrides TRUST_PROXY for req.ip. */
    CLIENT_IP_HEADER: z.string().toLowerCase().optional(),
    /** Reverse proxies in front of the API: true = 1, or a number (2 behind Cloudflare Tunnel + Caddy). */
    TRUST_PROXY: z
      .string()
      .regex(/^(true|false|\d)$/, 'TRUST_PROXY must be true, false or a number of proxies')
      .default('false')
      .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v))),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    LOCAL_UPLOAD_DIR: z.string().default('./uploads'),
    S3_ENDPOINT: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default('true'),

    STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
    TURN_URLS: z.string().default(''),
    /** coturn `static-auth-secret` (use-auth-secret). Credentials are minted per user and expire. */
    TURN_SECRET: z.string().optional(),
    /** Fixed TURN login from a hosted TURN service (e.g. Metered), used when there is no TURN_SECRET. */
    TURN_USERNAME: z.string().optional(),
    TURN_CREDENTIAL: z.string().optional(),
    TURN_TTL_SECONDS: z.coerce.number().int().default(3600),
    /** How long a call rings before it counts as missed. */
    CALL_RING_SECONDS: z.coerce.number().int().min(5).max(120).default(45),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('Baatcheet <no-reply@localhost>'),


    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

    LIVEKIT_URL: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),

    /** Comma-separated e-mails that become ADMIN when they register (or on start if they exist). */
    ADMIN_EMAILS: z.string().default(''),
    /** Same, by username (for accounts made without an e-mail). */
    ADMIN_USERNAMES: z.string().default(''),
    LOG_LEVEL: z.string().default('info'),
    /** Disables rate limits in automated tests only. */
    DISABLE_RATE_LIMIT: bool.default('false'),
    /** Trial runs only: new accounts count as verified and no e-mail is needed. Password reset then can't work. */
    AUTO_VERIFY_EMAIL: bool.default('false'),
  })
  .superRefine((c, ctx) => {
    if (c.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!c[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when STORAGE_DRIVER=s3` });
      }
    }
    if (c.TURN_URLS && !c.TURN_SECRET && !(c.TURN_USERNAME && c.TURN_CREDENTIAL)) {
      ctx.addIssue({ code: 'custom', path: ['TURN_SECRET'], message: 'TURN_URLS needs TURN_SECRET (own coturn) or TURN_USERNAME + TURN_CREDENTIAL (hosted TURN)' });
    }
    if (c.NODE_ENV === 'production') {
      if (!c.SMTP_URL && !c.AUTO_VERIFY_EMAIL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'SMTP_URL is required in production (verification and reset e-mails)' });
      if (c.DISABLE_RATE_LIMIT) ctx.addIssue({ code: 'custom', path: ['DISABLE_RATE_LIMIT'], message: 'Rate limits cannot be disabled in production' });
      if (!c.APP_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must be https in production' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration. Fix these environment variables (see .env.example):\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
const normOrigin = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();
export const allowedOrigins = [config.APP_URL, ...config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)].map(normOrigin);

/**
 * Whether a browser Origin may use the API (CSRF check for requests and sockets).
 * Allowed: APP_URL / CORS_ORIGINS / API_URL (trailing slash and case ignored), and any origin whose host
 * is the host the request was sent to — the page and the API share one address behind Caddy, so this keeps
 * working when the address changes (new trycloudflare link, LAN IP, localhost). Another site can't fake it:
 * the browser sets Origin to the page that made the request.
 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  const o = normOrigin(origin);
  if (allowedOrigins.includes(o) || o === normOrigin(config.API_URL)) return true;
  if (!host) return false;
  try {
    return new URL(o).host === host.trim().toLowerCase();
  } catch {
    return false;
  }
}
