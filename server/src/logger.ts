import pino from 'pino';
import { config } from './config.js';

// Never log cookies, auth headers, passwords or tokens.
export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.token', '*.passwordHash'],
    censor: '[redacted]',
  },
});
