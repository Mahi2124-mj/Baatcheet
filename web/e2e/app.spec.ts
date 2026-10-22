import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'http://localhost:4000';
const stamp = Date.now().toString(36);

async function signUp(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const username = `${name.toLowerCase()}_${stamp}`;
  const email = `${username}@e2e.test`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill('Password123');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();
  // Follow the link from the "sent" e-mail (test mode keeps e-mails in memory).
  const mails = await (await page.request.get(`${API}/api/test/mail?to=${encodeURIComponent(email)}`)).json();
  const link = /http:\/\/localhost:3000\/verify-email\?token=\S+/.exec(mails[0].text)![0];
  await page.goto(link.replace('http://localhost:3000', ''));
  await expect(page.getByText('E-mail verified')).toBeVisible();
  await page.getByRole('link', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await expect(page).toHaveURL(/\/chats$/);
  return { page, username, email };
}

async function remoteVideoPlaying(page: Page) {
  return page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => !v.muted && v.videoWidth > 0 && !v.paused), undefined, { timeout: 30_000 });
}

test('register → chat in real time → persists → real video call', async ({ browser }) => {
  const asha = await signUp(browser, 'Asha');
  const ravi = await signUp(browser, 'Ravi');

  // Asha finds Ravi by username and starts a chat.
  await asha.page.getByRole('button', { name: 'New chat' }).click();
  await asha.page.getByLabel('Search people').fill(ravi.username);
  await asha.page.getByRole('button', { name: new RegExp(`@${ravi.username}`) }).click();
  await expect(asha.page).toHaveURL(/\/chats\/\w+/);
  const chatUrl = asha.page.url();

  await asha.page.getByRole('textbox', { name: 'Message' }).fill('Namaste Ravi! 👋');
  await asha.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(asha.page.getByRole('log').getByText('Namaste Ravi! 👋')).toBeVisible();

  // Ravi gets it live: the chat appears in the list without reloading.
  await expect(ravi.page.getByRole('link', { name: /Asha/ })).toBeVisible();
  await ravi.page.getByRole('link', { name: /Asha/ }).click();
  await expect(ravi.page.getByRole('log').getByText('Namaste Ravi! 👋')).toBeVisible();
  await ravi.page.getByRole('textbox', { name: 'Message' }).fill('Hi Asha, kaise ho?');
  await ravi.page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(asha.page.getByRole('log').getByText('Hi Asha, kaise ho?')).toBeVisible();
  // Read receipt reaches the sender.
  await expect(asha.page.getByRole('log').getByLabel('Read').first()).toBeVisible();

  // Attachment upload and download.
  const dir = path.join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'notes.txt');
  writeFileSync(file, 'train at 7:15');
  await asha.page.locator('input[type=file]').setInputFiles(file);
  await expect(asha.page.getByText('13 B')).toBeVisible();
  await asha.page.getByRole('button', { name: 'Send' }).click();
  const link = ravi.page.getByRole('log').getByRole('link', { name: /notes\.txt/ });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(await (await ravi.page.request.get(href!)).text()).toBe('train at 7:15');

  await asha.page.screenshot({ path: 'test-results/shots/chat-desktop.png' });

  // Messages persist after a reload.
  await asha.page.goto(chatUrl);
  await expect(asha.page.getByRole('log').getByText('Hi Asha, kaise ho?')).toBeVisible();

  // Video call: Asha calls, Ravi accepts, both see each other's (fake) camera over WebRTC.
  await asha.page.getByRole('button', { name: 'Video call' }).click();
  const incoming = ravi.page.getByRole('alertdialog', { name: /Incoming call from Asha/ });
  await expect(incoming).toBeVisible();
  await incoming.getByRole('button', { name: 'Accept' }).click();
  await remoteVideoPlaying(asha.page);
  await remoteVideoPlaying(ravi.page);
  await expect(asha.page.getByText(/^0:0\d$/)).toBeVisible();
  await ravi.page.screenshot({ path: 'test-results/shots/video-call.png' });
  // Mute toggles and is shown to the other side.
  await ravi.page.getByRole('button', { name: 'Mute microphone' }).click();
  await expect(ravi.page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
  await asha.page.waitForTimeout(1500);
  await asha.page.getByRole('button', { name: 'End call' }).click();
  await expect(ravi.page.getByText('Call ended').first()).toBeVisible();

  // The call is in both histories and in the chat.
  await ravi.page.goto('/calls');
  await expect(ravi.page.getByText(/Video · /)).toBeVisible();
  await expect(asha.page.getByRole('log').getByText(/📹 Video call · 0:0\d/)).toBeVisible();

  // Voice call that gets declined.
  await asha.page.getByRole('button', { name: 'Voice call' }).click();
  await ravi.page.getByRole('alertdialog').getByRole('button', { name: 'Decline' }).click();
  await expect(asha.page.getByText('Call declined').first()).toBeVisible();
});

test('private pages and APIs need a login', async ({ page, request }) => {
  await page.goto('/chats');
  await expect(page).toHaveURL(/\/login/);
  expect((await request.get('/api/conversations')).status()).toBe(401);
  expect((await request.get('/api/admin/stats')).status()).toBe(401);
});

test('mobile layout: list first, then a full-screen chat', async ({ browser }) => {
  const u = await signUp(browser, 'Meera');
  await u.page.setViewportSize({ width: 390, height: 844 });
  await u.page.goto('/chats');
  await expect(u.page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  await expect(u.page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await u.page.screenshot({ path: 'test-results/shots/mobile-list.png' });
  const overflow = await u.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
