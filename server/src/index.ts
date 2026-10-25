import { createServer } from 'node:http';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { ensureBucket } from './lib/storage.js';
import { createApp } from './app.js';
import { endAllCalls } from './realtime/calls.js';
import { createSocketServer } from './realtime/socket.js';
import { purgeOrphanFiles } from './services/messages.js';

async function main() {
  await prisma.$connect();
  await ensureBucket();
  // Promote configured admins that already have an account.
  const admins = config.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (admins.length) await prisma.user.updateMany({ where: { email: { in: admins } }, data: { role: 'ADMIN' } });
  const adminNames = config.ADMIN_USERNAMES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (adminNames.length) await prisma.user.updateMany({ where: { profile: { username: { in: adminNames } } }, data: { role: 'ADMIN' } });

  // Files of messages deleted for good (also those removed by the database migration) are wiped.
  void purgeOrphanFiles().catch((err) => logger.warn({ err }, 'file cleanup failed'));

  const http = createServer(createApp());
  const io = createSocketServer(http);
  http.listen(config.PORT, () => logger.info(`Baatcheet API listening on :${config.PORT}`));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    http.close();
    await endAllCalls();
    io.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  // Configuration errors are printed plainly so they're easy to fix.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
