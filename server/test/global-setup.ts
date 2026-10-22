import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Applies all migrations to the test database (tests empty the tables themselves, see resetDb). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://baatcheet:baatcheet@localhost:5432/baatcheet_test';
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  return () => rmSync('./test-uploads', { recursive: true, force: true });
}
