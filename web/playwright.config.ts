import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the real API (with a throw-away database) and the production web build.
// Chromium's fake camera / microphone produce real media streams, so calls are real WebRTC
// connections between two browser contexts.
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://baatcheet:baatcheet@localhost:5432/baatcheet_e2e';
// Set PW_CHROMIUM_PATH to use an already installed Chromium instead of Playwright's download.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    permissions: ['camera', 'microphone', 'notifications'],
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args } } },
  ],
  webServer: [
    {
      command: 'npx prisma migrate deploy && npx tsx src/index.ts',
      cwd: '../server',
      url: 'http://localhost:4000/healthz',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: DB,
        SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789',
        APP_URL: 'http://localhost:3000',
        API_URL: 'http://localhost:3000',
        STORAGE_DRIVER: 'local',
        LOCAL_UPLOAD_DIR: './e2e-uploads',
        DISABLE_RATE_LIMIT: 'true',
        CALL_RING_SECONDS: '30',
      },
    },
    {
      command: 'npx next start -p 3000',
      url: 'http://localhost:3000',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_INTERNAL_URL: 'http://localhost:4000' },
    },
  ],
});
