# Baatcheet — chat, voice and video calls

A complete web app for real-time messaging, 1:1 voice and video calls (WebRTC) and group calls
(LiveKit SFU). Next.js + TypeScript + Tailwind on the front, Node.js + Express + Socket.IO + Prisma
+ PostgreSQL on the back, S3-compatible storage for files, coturn for TURN.

## What works

| Area | Implemented |
|---|---|
| Accounts | E-mail + password sign-up (argon2id), e-mail verification, login / logout, forgot + reset password, personal login code (sign in on any device with one unique code, no e-mail or password), onboarding, profile (name, unique username, about, picture), change password, device list with remote log-out, account deletion |
| Messaging | 1:1 and group chats, real-time delivery, persisted history with cursor pagination (infinite scroll), last-message previews, timestamps, sent / delivered / read ticks, typing, online / last seen, unread counters, reply, edit (48 h), delete for everyone, reactions, emoji, images / video / audio / documents / voice notes with type + size checks, message search (trigram index), chat search and filters, pin / archive / mute / clear, duplicate-safe re-sends after reconnects |
| Voice calls | Start from a chat, incoming-call window with ring tone, accept / decline, end, mute, timer, ringing → connecting → connected → ended states, busy, offline callee (push notification), missed calls (notification, history, chat line), ICE restarts on network changes, socket reconnect → resume, permission errors explained |
| Video calls | Everything above + local / remote video, camera on/off, switch camera, full screen, picture-in-picture, voice-only fallback when the camera is denied or missing |
| Groups | Create with name / picture, add / remove, owner / admin / member roles, admins-only posting, invite links (expiry, use limits), leave / ownership hand-over, delete, group calls via LiveKit with participant tiles, mute / camera, join a running call |
| Contacts | Username search, contact requests, accept / decline, remove, block / unblock, report users or messages, profile pages respecting privacy |
| Notifications | In-app toasts, notification centre, incoming-call window, missed-call / contact / group notifications, per-type preferences, Web Push (VAPID) when no tab is open |
| Admin | Role-based dashboard: stats, health, user search, suspend / restore, report queue, group management, audit log — no access to private chats |
| Security | See [docs/SECURITY.md](docs/SECURITY.md): CSRF origin check, rate limits, lockout, authorisation on every route and socket event, signed upload / download URLs, strict CORS, redacted logs, config validated at start |

Known limitations are at the end.

## Layout

```
Baatcheet/
  shared/      zod schemas, limits, API + Socket.IO event types (used by both sides)
  server/      Express API, Socket.IO, Prisma schema + migrations + seed, tests (vitest)
  web/         Next.js app (App Router), components, call engine (lib/calls.ts), e2e tests (Playwright)
  deploy/      Caddyfiles, LiveKit config example
  docs/        API.md, DEPLOYMENT.md, TESTING.md, TROUBLESHOOTING.md, SECURITY.md
  docker-compose.yml, docker-compose.prod.yml, .env.example
```

How a call works: the caller's browser asks the API (`call:start`) → the API checks membership,
blocks and busy state, stores a `Call`, and rings the callee's open tabs (and sends a push if none) →
the callee accepts (`call:accept`) → the caller creates a WebRTC offer; offer / answer / ICE
candidates go through Socket.IO only between those two connections → media flows peer-to-peer, or
through TURN when a direct path isn't possible. Group calls use a LiveKit room instead; the API rings
members and mints room tokens.

## Quick start with Docker (everything included)

Needs Docker with Compose v2.24+.

```bash
cd Baatcheet
cp .env.example .env
# put real random values into the CHANGE_ME_* entries
docker compose up --build
```

- App: <http://localhost:8080> (register, then open the e-mail in Mailpit to verify)
- E-mails: <http://localhost:8025>
- Files are kept in the Docker volume `uploads`. For S3 storage: `docker compose --profile s3 up` with `STORAGE_DRIVER=s3`.
- Seed fictional users: `docker compose exec server npx tsx prisma/seed.ts` → log in as `asha@example.test` / `Password123` (admin), `ravi@…`, `meera@…`, `kabir@…`.

Calls need a secure context: `localhost` works; another device on your LAN needs HTTPS (see
Troubleshooting).

## Host it on your own Linux PC

One command sets up a PC that stays on, puts it online with a free Cloudflare Tunnel and starts on boot —
see [docs/DEPLOYMENT.md → On your own Linux PC](docs/DEPLOYMENT.md#on-your-own-linux-pc-free-no-public-ip-needed).

## Run locally without Docker

Needs Node.js 20+ and PostgreSQL 14+.

```bash
cd Baatcheet
npm install
createdb baatcheet            # or any Postgres database
cp server/.env.example server/.env      # adjust DATABASE_URL
cp web/.env.example web/.env.local
npm run db:migrate            # applies migrations (prisma migrate dev)
npm run db:seed               # optional demo users
npm run dev                   # API on :4000, web on :3000
```

Open <http://localhost:3000>. Without `SMTP_URL` the verification / reset e-mails are printed in the
API terminal — open the link from there. Files are stored in `server/uploads`.

### Commands

| Command | What |
|---|---|
| `npm run dev` | API (tsx watch) + web (next dev) |
| `npm test` | API tests against `TEST_DATABASE_URL` (default `postgresql://baatcheet:baatcheet@localhost:5432/baatcheet_test`) |
| `npm run e2e` | Browser tests (build the web app first: `npm run build -w web`) |
| `npm run typecheck` | Both projects |
| `npm run build` | Production builds |
| `npm run db:migrate` / `npm run db:deploy -w server` | Create + apply migrations (dev) / apply only (prod) |
| `npm run db:seed` | Fictional users and chats |
| `npm run vapid -w server` | Generate Web Push keys |

## Configuration

All settings are environment variables — see [`.env.example`](.env.example) for every one with
comments. The API validates them on start and refuses to run with a clear list of what's wrong
(e.g. `TURN_SECRET is required when TURN_URLS is set`, `SMTP_URL is required in production`).
No secret is hard-coded or sent to the browser.

### STUN / TURN

- `STUN_URLS` (default Google's public STUN) lets most home networks connect directly.
- About 10–20% of calls (mobile carriers, offices) need **TURN**. Run coturn (included in compose)
  with `use-auth-secret` and the same secret as `TURN_SECRET`; list it in `TURN_URLS`
  (`turn:` UDP + TCP, and `turns:` on 5349 for networks that only allow TLS).
- The API mints per-user credentials that expire (`GET /api/calls/ice-servers`, coturn REST scheme).
- Production details, firewall ports and a TURN test: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### E-mail

`SMTP_URL` in nodemailer format, e.g. `smtps://user:pass@smtp.example.com:465`. Mailpit catches all
e-mail in development.

### Login code

Every account gets a unique code like `K7QM-3XRP-9WTD` (shown after sign-up and in Settings → Login
code). On any device, "Log in with code" signs straight in, without e-mail or password. Users can make a
new code at any time; the old one stops working. Sessions last `SESSION_DAYS` (default 365), so a device
stays logged in.

### Push notifications (optional)

Generate VAPID keys (`npm run vapid -w server`) into `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Users
enable push in Settings → Notifications.

### Group calls (optional)

Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Compose runs a LiveKit dev server
(`devkey` / `secret`). Without LiveKit, group chats work but group calls say they're not available.
Full-mesh WebRTC was deliberately not used for groups: it doesn't scale past 3–4 people.

## Tests

55 API tests + 3 browser end-to-end tests, including a real WebRTC video call between two
browsers. What each covers and the **manual two-device checklist** (needed before launch — an
automated run on one machine doesn't prove NAT traversal): [docs/TESTING.md](docs/TESTING.md).
CI: `.github/workflows/ci.yml` runs typecheck, API tests, builds, Playwright, and builds
and starts the Docker stack.

## Docs

- [API reference (REST + Socket.IO)](docs/API.md)
- [Deployment, backups, scaling](docs/DEPLOYMENT.md)
- [Testing + manual call checklist](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security, privacy, moderation, data retention](docs/SECURITY.md)

## Known limitations

- **Not end-to-end encrypted.** Encrypted in transit (TLS, DTLS-SRTP); stored readable on the server.
- **Browsers can't ring when closed.** With the tab closed or a phone asleep, a Web Push notification
  is shown instead of a ringing call (iPhone: only for sites added to the Home Screen). Real
  background ringing needs native apps with VoIP push (CallKit / ConnectionService).
- One API instance keeps presence and ringing calls in memory; for several instances add Redis (see
  DEPLOYMENT.md → Scaling).
- Group calls need a LiveKit server. Ringing, membership checks and room-token minting are tested; media through a live LiveKit server is not part of CI (use the manual checklist).
- Rate limits are in-memory per instance.
- The Docker stack is built and started in CI; production TURN / LiveKit setups must be verified on
  your own servers with the manual checklist.
