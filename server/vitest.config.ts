import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://baatcheet:baatcheet@localhost:5432/baatcheet_test';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests share one database; run files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    globalSetup: './test/global-setup.ts',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DB,
      SESSION_SECRET: 'test-secret-0123456789abcdef0123456789',
      APP_URL: 'http://localhost:3000',
      API_URL: 'http://localhost:4999',
      STORAGE_DRIVER: 'local',
      LOCAL_UPLOAD_DIR: './test-uploads',
      TURN_URLS: 'turn:turn.example.test:3478?transport=udp',
      TURN_SECRET: 'turn-test-secret',
      ADMIN_EMAILS: 'admin@test.local',
      CALL_RING_SECONDS: '5',
      DISABLE_RATE_LIMIT: 'true',
    },
  },
});
