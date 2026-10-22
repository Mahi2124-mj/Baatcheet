# Testing Baatcheet

## Automated

```bash
cd Baatcheet
npm ci
# Postgres must be running; the tests use the database baatcheet_test (created automatically)
export TEST_DATABASE_URL=postgresql://baatcheet:baatcheet@localhost:5432/baatcheet_test
npm test                         # API: 55 tests
npm run build -w web && npm run e2e   # browser end-to-end: 3 tests
```

| Suite | What it proves |
|---|---|
| `server/test/auth.test.ts` | Registration (argon2id hash), duplicates and weak passwords refused, lockout after 5 wrong passwords, same answer for unknown e-mails, e-mail verification (single use), password reset revokes all sessions, device list / revoke, logout, account deletion, 401 on every private route, CSRF origin check, unverified users can't start chats, sockets need a valid session, admin-only API, quick-login PIN (set / change / remove, weak PINs refused, username + PIN on a new device, PIN off after 5 wrong tries, suspended accounts refused), IP rate limit. |
| `server/test/messaging.test.ts` | Real-time delivery over Socket.IO + persistence, duplicate `clientId` ignored, cursor pagination, outsiders get 404 on read / write / edit / delete / react / search and over sockets, edit / delete only own messages, replies, reactions, search, read receipts, typing, presence, hidden read receipts, blocking both ways, "contacts only" messaging, per-user pin / archive / mute, last-seen privacy, contact requests. |
| `server/test/groups.test.ts` | Group creation with contacts only, delivery to all members, admin-only member management and promotion, removed members can't post or read new messages, admins-only posting, invite links with use limits, ownership hand-over, owner-only delete. |
| `server/test/uploads.test.ts` | Signed upload → message → only members download; tampered or foreign signatures refused; keys can't be reused by others; type / size / declared-size / content-type validation; profile picture. |
| `server/test/calls.test.ts` | TURN credentials (coturn REST scheme, expiring, per user), ring → accept → offer / answer / ICE relayed only between the two parties, outsiders can't inject signals or accept, decline, busy, missed call → notification + history + chat line, deleting calls from one person’s history only (single + clear all), reconnect and resume within the grace period, group calls refuse without LiveKit; with LiveKit configured: members are rung, only joined members get a room token (JWT grants checked), running call can be joined. |
| `server/test/admin.test.ts` | Report (only by people who could see the message) → admin queue with evidence → suspend (sessions revoked, login refused) → audit log → restore; stats without private content. |
| `web/e2e/app.spec.ts` | In Chromium: two users register, verify via the e-mail link, onboard, find each other, chat in real time, read receipt, upload + download a file, reload keeps history, **a real WebRTC video call** (Chromium's fake camera/microphone; the test waits until each side plays the other's video), mute, hang up, call history, a declined voice call; logged-out access redirects / 401; mobile layout has no horizontal scroll. Screenshots in `web/test-results/shots/`. |

The e2e call test runs both browsers on one machine, so it doesn't prove NAT traversal. Use the
manual checklist below with two real devices on different networks before going live.

## Manual two-device checklist (audio + video)

Use two devices with different accounts, **on different networks** (e.g. laptop on Wi-Fi, phone on
mobile data), over HTTPS (browsers only allow camera / mic on https or localhost).

Setup
- [ ] Both accounts verified, both online (green dot), they are contacts.
- [ ] `GET /api/calls/ice-servers` (in the browser while logged in) lists your TURN server with a username like `1761100000:<user id>`.

Voice call
- [ ] A calls B from the chat header → A sees "Ringing…", B gets the incoming-call window with a ring tone.
- [ ] B declines → A sees "Call declined"; the call is listed in both Calls pages as declined.
- [ ] A calls again, B accepts → both hear each other within ~3 s; timer counts on both.
- [ ] Mute on A → B can't hear A; B sees "A is muted". Unmute works.
- [ ] Switch A's phone from Wi-Fi to mobile data during the call → "Reconnecting…" then audio resumes (ICE restart), or the call ends after 30 s with "Connection lost".
- [ ] Android Chrome: the voice call is heard on the earpiece (phone at the ear), not the loudspeaker. The speaker button switches to loudspeaker and back.
- [ ] Connect Bluetooth earbuds before the call → the call uses them; the speaker button opens Phone / Speaker / Bluetooth. Connect them during a call → audio moves to them; disconnect → back to the earpiece.
- [ ] During a voice call A taps the video button → A's camera starts, B sees A's video without a new ring, both move to the loudspeaker; B can turn on its camera too. The call shows as a video call in history.
- [ ] A hangs up → B sees "Call ended"; both chats get "📞 Voice call · m:ss"; both Calls pages list it.
- [ ] A calls while B is in another call → A sees "Busy on another call".
- [ ] A calls, nobody answers for 45 s → A sees "No answer"; B gets a "Missed voice call" notification and it's in Calls → Missed.
- [ ] B has the site closed with push enabled → B's phone shows "Incoming voice call" notification; tapping opens the chat.

Video call
- [ ] Both see each other; the small preview shows your own camera (mirrored).
- [ ] Camera off on A → B sees A's avatar / "Camera is off"; on again works.
- [ ] Switch camera on a phone (front ↔ back) — button appears only with 2+ cameras.
- [ ] Full screen and picture-in-picture (desktop Chrome / Safari) work.
- [ ] Deny camera permission on B, then accept → B joins with audio only ("your camera is off (no access)"); A still sends video.
- [ ] Deny microphone → clear message "Allow microphone access…", no stuck call.
- [ ] Minimise the call → green bar at the top; chatting still works; tap returns to the call.

Relay-only test (proves TURN)
- [ ] In Chrome, open `chrome://webrtc-internals` during a call → the selected candidate pair is `relay` when one side is on a strict network (or temporarily remove STUN and block UDP on one side).

Group call (LiveKit configured)
- [ ] Start a video call in a group → members get the incoming window; 3+ people join and see each other's tiles; the speaking tile is highlighted.
- [ ] A member who missed the ring sees "A group call is running — tap to join" in the chat.
- [ ] Leave / rejoin; the call ends when the last person leaves.

Browsers to cover: Chrome (Android, desktop), Safari (iPhone 15+/iOS 17+, macOS), Firefox, Edge.
