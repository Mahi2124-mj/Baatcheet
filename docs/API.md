# Baatcheet API

Base path: `/api`. JSON in, JSON out. Authentication is an `HttpOnly` session cookie
(`bc_session`, or `__Host-bc_session` in production) set by register / login.

- Every state-changing request (POST/PATCH/PUT/DELETE) must come from an allowed origin
  (`Origin` header = `APP_URL` or one of `CORS_ORIGINS`). This is the CSRF protection.
- Errors: `{ "error": "Human message", "code": "machine_code" }` with the HTTP status
  (400 validation, 401 not logged in, 403 not allowed, 404 not found / not yours, 409 conflict, 413 too large, 429 rate limited, 501 not configured).
- Resources you're not allowed to see answer **404**, so their existence isn't revealed.
- Lists use cursor pagination: pass `before=<id from nextCursor>`.

## Auth — `/api/auth`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `{email, password, username, displayName}` | 201 + cookie. Sends the verification e-mail. |
| POST | `/login` | `{email, password}` | 5 wrong passwords lock the account for 15 min; 10/min per IP. |
| POST | `/logout` | – | Revokes this session. |
| GET | `/me` | – | Your account + settings. |
| POST | `/verify-email` | `{token}` | Token from the e-mail link (48 h, single use). |
| POST | `/resend-verification` | – | |
| POST | `/forgot-password` | `{email}` | Always 200 (no account discovery). Link valid 1 h. |
| POST | `/reset-password` | `{token, password}` | Logs out every session. |
| POST | `/change-password` | `{current, password}` | Logs out other sessions. |
| POST | `/code-login` | `{code}` | Log in with the personal login code (dashes / spaces / case ignored). 401 wrong code, 403 suspended. |
| GET | `/login-code` | | Logged in: your login code (created on first use). |
| POST | `/login-code/regenerate` | | Logged in: new code; the old one stops working. |
| GET | `/sessions` | – | Devices: `[{id, userAgent, ip, lastUsedAt, current}]` |
| DELETE | `/sessions/:id` | – | Log a device out (its socket is disconnected too). |
| POST | `/sessions/revoke-others` | – | |
| POST | `/delete-account` | `{password}` | Deletes profile, files, contacts, sessions; sent messages become "deleted". |

```bash
curl -i -c jar -H 'Origin: http://localhost:8080' -H 'Content-Type: application/json' \
  -d '{"email":"asha@example.test","password":"Password123"}' http://localhost:8080/api/auth/login
curl -b jar http://localhost:8080/api/conversations
```

## Users — `/api/users`

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=` | Username prefix or display name. Hides you, blocked and suspended users. |
| GET | `/by-name/:username` | `{user, self, contact, mutual, outgoingRequest, incomingRequest, blocked}`; privacy rules applied. |
| PATCH | `/me` | `{displayName?, username?, bio?, avatarKey?, onboarded?}` (`avatarKey` from an `avatar` upload) |
| PATCH | `/me/settings` | `{lastSeenVisibility?, profileVisibility?, allowMessagesFrom?, readReceipts?, notifyMessages?, notifyCalls?, notifyGroups?}` |
| GET | `/blocks/list` | People you blocked. |
| POST / DELETE | `/:id/block` | Block / unblock. Blocking removes the contact and pending requests both ways. |

## Contacts — `/api/contacts`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{contacts, incoming, outgoing}` |
| POST | `/requests` | `{userId}`. If they already asked you, this accepts. Needs a verified e-mail. |
| POST | `/requests/:id/accept` · `/requests/:id/decline` | Only the receiver. |
| DELETE | `/requests/:id` | Cancel your request. |
| PATCH | `/:userId` | `{nickname}` |
| DELETE | `/:userId` | Remove contact (both ways). |

## Conversations — `/api/conversations`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Your chats with last message, unread count, members, receipts, pinned / archived / muted. |
| GET | `/:id` | One chat (members only). |
| POST | `/direct` | `{userId}` → the one chat for that pair (created if needed). |
| POST | `/group` | `{name, memberIds, avatarKey?}`. Only people who have you as a contact are added; the rest come back in `skipped`. |
| PATCH | `/:id` | Group: `{name?, avatarKey?, adminsOnlyPost?, adminsOnlyEdit?}` (admins). |
| POST | `/:id/members` | `{userIds}` (admins). |
| DELETE | `/:id/members/:userId` | Remove (admins; admins can't remove the owner; only the owner removes admins) or leave (your own id). |
| PATCH | `/:id/members/:userId` | `{role: ADMIN|MEMBER|OWNER}` (OWNER hands over ownership). |
| PATCH | `/:id/me` | `{pinned?, archived?, mutedForSeconds?}` — only for you. |
| POST | `/:id/clear` | Hide earlier messages for you. |
| DELETE | `/:id` | Delete a group (owner). |
| POST | `/:id/invites` | `{maxUses?, expiresInHours?}` → `{code}` (admins). |
| DELETE | `/:id/invites/:code` | Revoke. |
| GET | `/:id/messages?before=&limit=` | Newest page first; each page is oldest → newest. `{messages, nextCursor}` |
| POST | `/:id/messages` | `{clientId, body?, replyToId?, attachments?}` — REST fallback for sending. Same `clientId` twice returns the first message (200). |
| POST | `/:id/read` | `{messageId}` read receipt. |

Invites: `GET /api/invites/:code` (preview), `POST /api/invites/:code/join`.

## Messages — `/api/messages`

| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&conversationId=` | Text search in chats you're in (trigram index). |
| PATCH | `/:id` | `{body}` — your own text messages, within 48 h. |
| DELETE | `/:id` | Delete for everyone: sender, or a group admin. Files are deleted from storage. |
| POST | `/:id/reactions` | `{emoji}` (one per person; replaces yours). |
| DELETE | `/:id/reactions` | Remove yours. |

## Uploads — `/api/uploads`

1. `POST /api/uploads` `{name, size, mime, purpose: attachment|avatar|group-avatar}` → `{key, upload: {url, method: "PUT", headers}}`.
   Allowed types and limits are in `shared/src/index.ts` (`MIME_KINDS`, `LIMITS.fileSize`).
2. `PUT` the bytes to `upload.url` with the given headers (signed, 10 minutes, exact size and type).
3. Use the key in a message (`attachments`) or profile (`avatarKey`). The server checks the object exists with that size and was uploaded by you.

Downloads are signed URLs (1 h) handed only to members of the chat.

## Calls — `/api/calls`

| Method | Path | Notes |
|---|---|---|
| GET | `/ice-servers` | `{iceServers, ttl}` — STUN + TURN with per-user credentials that expire. |
| GET | `/config` | `{groupCalls: boolean}` (LiveKit configured). |
| GET | `/?before=&missed=1` | Call history `{items: [{id, type, status, startedAt, answeredAt, endedAt, participants, outgoing, missed}], nextCursor}` |
| POST | `/:id/token` | LiveKit `{url, token}` for a group call you joined. |
| GET | `/active/:conversationId` | Running group call in a chat, or `null`. |

## Notifications

- `GET /api/notifications?before=` → `{items, nextCursor, unread}`; `POST /api/notifications/read` `{ids?}`; `DELETE /api/notifications`.
- Web Push: `GET /api/push/public-key`, `POST /api/push/subscribe` (the browser's `PushSubscription.toJSON()`), `POST /api/push/unsubscribe` `{endpoint}`.

## Reports — `POST /api/reports`

`{reason: SPAM|HARASSMENT|HATE|VIOLENCE|NUDITY|SCAM|OTHER, userId?, messageId?, conversationId?, details?}`.
A reported message's text is copied into the report as evidence (only messages you could read).

## Admin — `/api/admin` (role ADMIN)

`GET /stats`, `GET /health`, `GET /users?q=&status=`, `POST /users/:id/suspend {reason}`, `POST /users/:id/restore`,
`POST /users/:id/role {role}`, `GET /reports?status=`, `PATCH /reports/:id {status, resolution?}`,
`GET /groups?q=`, `DELETE /groups/:id {reason}`, `GET /audit`. Every change writes an audit-log row.

## Health

`GET /healthz` (process up), `GET /readyz` (database reachable).

## Socket.IO events

Connect to the site's origin (path `/socket.io`) with cookies. Unauthenticated connections are refused.
Types: `ClientToServer` / `ServerToClient` in `shared/src/index.ts`.

**Client → server** (with acknowledgement callback `(res) => res.ok ? res.data : res.error` where noted)

| Event | Payload | Ack |
|---|---|---|
| `message:send` | `{conversationId, clientId, body?, replyToId?, attachments?}` | `Message` |
| `message:delivered` / `message:read` | `{conversationId, messageId}` | – |
| `typing` | `{conversationId, typing}` | – |
| `presence:query` | `{userIds}` | `{[id]: {online, lastSeenAt}}` (privacy applied) |
| `call:start` | `{conversationId, type: AUDIO|VIDEO}` | `{callId, calleeIds, reachable, sfu}` |
| `call:accept` | `{callId}` | `{type, sfu, peers}` |
| `call:reject` | `{callId, reason?: declined|busy}` | – |
| `call:end` | `{callId}` | – |
| `call:signal` | `{callId, to, data: {type: offer|answer, sdp} | {type: candidate, candidate}}` | – |
| `call:media` | `{callId, audio, video}` | – |
| `call:resume` | `{callId}` after a reconnect | `{peers}` |

**Server → client**: `message:new`, `message:updated`, `receipt`, `typing`, `presence`,
`conversation:updated`, `conversation:removed`, `notification`, `call:incoming`, `call:accepted`,
`call:rejected`, `call:ended {status}`, `call:signal`, `call:media`, `call:resumed`, `call:left`, `session:revoked`.

Rules enforced on the server: you only receive events for chats you belong to; signals are relayed
only between the two accepted connections of a 1:1 call; a call can't be started by unverified,
blocked or (for "contacts only" users) non-contact users; a busy user answers `busy`; unanswered
calls become `MISSED` after `CALL_RING_SECONDS`; a dropped connection has 20 s to `call:resume`.
