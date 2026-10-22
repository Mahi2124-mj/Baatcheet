# Security, privacy and moderation

## What protects what

| Area | How |
|---|---|
| Passwords | Argon2id (19 MiB, t=2), never logged or returned. Unknown e-mails take the same time and give the same answer. |
| Brute force | 10 logins / min / IP, 20 sensitive auth actions / 15 min / IP, account lock for 15 min after 5 wrong passwords. |
| Sessions | 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production, `__Host-` prefix) cookie; only its SHA-256 is stored. Listed and revocable per device; password change / reset and suspension revoke them and disconnect their sockets. |
| CSRF | SameSite cookie + every state-changing request must carry an allowed `Origin`. |
| XSS | React escapes all text; no user HTML is rendered. Uploaded files are served with `Content-Security-Policy: sandbox` and `nosniff` (local driver) or from the storage domain (S3). |
| SQL injection | Prisma parameterised queries only; the two raw queries use tagged templates. |
| Authorisation | Every route checks membership / ownership on the server; foreign resources answer 404. Socket events re-check membership, call participation and roles. |
| Input validation | zod schemas shared by client and server; message, name, bio and file limits in `shared/src/index.ts`. |
| Uploads | Allow-list of MIME types, per-kind size limits, signed one-object upload URLs (10 min, exact size and type), server-chosen keys, existence and size re-checked before use, a key can be used once and only by its uploader. Downloads are signed URLs (1 h) given only to chat members. |
| WebSockets | Same session cookie, origin check, per-user rate limits (sending, typing, receipts), payload size limit 256 KB, rooms joined only for real memberships. |
| Calls | Only members can call; blocked users and (for "contacts only") strangers can't; signals are relayed only between the two accepted connections; TURN credentials are per user and expire (`TURN_TTL_SECONDS`). |
| Transport | HTTPS (Caddy, HSTS) for the site and API; WebRTC media is always encrypted with DTLS-SRTP; TURN relays encrypted packets it can't read. |
| Secrets | Only from environment variables, validated at start. Nothing secret reaches the browser bundle (only `NEXT_PUBLIC_SOCKET_URL`). |
| Logging | pino with redaction of cookies, auth headers, passwords and tokens. |

## Encryption — what is and isn't claimed

- **In transit:** yes (TLS for HTTP/WebSocket, DTLS-SRTP for call media).
- **At rest:** whatever your database / disk / bucket provides (enable disk and bucket encryption at your host).
- **End-to-end:** **no.** Messages and files are stored on the server in readable form so they sync to every device and can be searched. 1:1 call media is not readable by the server (peer-to-peer or TURN relay), but group calls pass through the LiveKit SFU, which can access the media. Adding E2EE would need a reviewed protocol (e.g. MLS / Signal) with key management — not implemented.

## Privacy controls for users

Last seen / online (everyone, contacts, nobody), profile photo and about (same), who can message and
call you (everyone or contacts), read receipts on/off, block (stops messages, calls, contact
requests, presence and profile both ways), per-chat mute / archive / clear, device list.

## Moderation access policy

- Admins **can** see: account e-mail, username, sign-up date, verified / suspended state, message
  and report counts, group names and sizes, call / message volumes, and reported content.
- Admins **cannot** see in the app: passwords or hashes, session tokens, private chats, files, or
  call media. There is no "read user's chats" feature.
- A report copies the reported message text into the report (evidence). Only someone who could read
  the message can report it.
- Every admin action (suspend, restore, role change, report decision, group deletion, account
  deletion) is written to the audit log with actor, target, reason and IP.
- Database operators with direct server access can technically read stored messages; restrict who
  has shell / database access and log it.

## Data retention and deletion

- Messages, files and call records are kept until the sender / group deletes them, a member clears
  a chat (hidden for them), or the account is deleted.
- "Delete for everyone" removes the text and deletes attached files from storage.
- Deleting an account removes the profile, contacts, requests, blocks, sessions, push
  subscriptions, notifications, uploads (files deleted from storage) and memberships; messages the
  user sent stay in others' chats as "This message was deleted" with no text or files.
- Used verification / reset tokens are kept for audit until the account is deleted. Expired
  sessions are refused immediately; you can prune old rows with a periodic
  `DELETE FROM "Session" WHERE "expiresAt" < now() - interval '30 days'`.
- Backups contain everything above; set a backup retention period (e.g. 14–30 days) so deletions
  disappear from backups too.
