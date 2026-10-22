import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { allowedOrigins, config } from './config.js';
import { prisma } from './db.js';
import { errorMessage, h } from './lib/errors.js';
import { sentMail } from './lib/mail.js';
import { limit } from './lib/rate.js';
import { handleLocalDownload, handleLocalUpload } from './lib/storage.js';
import { logger } from './logger.js';
import { admin } from './http/routes/admin.js';
import { auth } from './http/routes/auth.js';
import { calls } from './http/routes/calls.js';
import { contacts } from './http/routes/contacts.js';
import { conversations, invites } from './http/routes/conversations.js';
import { messages } from './http/routes/messages.js';
import { notifications, push } from './http/routes/notifications.js';
import { reports } from './http/routes/reports.js';
import { uploads } from './http/routes/uploads.js';
import { users } from './http/routes/users.js';
import { checkOrigin, loadSession, requireAdmin, requireAuth } from './http/session.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
  if (config.CLIENT_IP_HEADER) {
    const header = config.CLIENT_IP_HEADER;
    app.use((req, _res, next) => {
      const ip = req.headers[header];
      if (typeof ip === 'string' && ip.length <= 64) Object.defineProperty(req, 'ip', { value: ip.trim(), configurable: true });
      next();
    });
  }
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));

  // CORS for the web app's origin(s); cookies are allowed only for these.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    }
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', h(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  }));

  // Local file storage (only when STORAGE_DRIVER=local). Raw body, authorised by the signed URL.
  if (config.STORAGE_DRIVER === 'local') {
    app.put('/files/upload', h(handleLocalUpload));
    app.get('/files/get', h(handleLocalDownload));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(checkOrigin);
  app.use(loadSession);
  app.use('/api', limit(60_000, 600));

  app.use('/api/auth', auth);
  app.use('/api/users', requireAuth, users);
  app.use('/api/contacts', requireAuth, contacts);
  app.use('/api/conversations', requireAuth, conversations);
  app.use('/api/invites', requireAuth, invites);
  app.use('/api/messages', requireAuth, messages);
  app.use('/api/uploads', requireAuth, uploads);
  app.use('/api/calls', requireAuth, calls);
  app.use('/api/notifications', requireAuth, notifications);
  app.use('/api/push', requireAuth, push);
  app.use('/api/reports', requireAuth, reports);
  app.use('/api/admin', requireAdmin, admin);

  // Test-only: lets end-to-end tests read the e-mails the server "sent".
  if (config.NODE_ENV === 'test') {
    app.get('/api/test/mail', (req, res) => res.json(sentMail.filter((m) => m.to === req.query.to)));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const { status, body } = errorMessage(err);
    if (status >= 500) req.log?.error({ err }, 'request failed');
    if (res.headersSent) return res.end();
    res.status(status).json(body);
  });
  return app;
}
