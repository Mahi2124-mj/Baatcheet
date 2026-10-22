# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| API exits with "Invalid configuration…" | A required environment variable is missing or wrong | The message lists each variable; fix `.env` (see `.env.example`). |
| `P1001: Can't reach database server` | Postgres not running / wrong `DATABASE_URL` | `docker compose ps postgres`; check host, port, password. |
| Verification / reset e-mails don't arrive | `SMTP_URL` empty or wrong | Development: e-mails are printed in the API log (or Mailpit at :8025 with Docker). Production: check provider credentials and that `MAIL_FROM` is a verified sender. |
| "Request origin not allowed" (403) | The site's address isn't `APP_URL` / `CORS_ORIGINS` | Set `APP_URL` to exactly what's in the browser bar (scheme + host + port). |
| Logged out on every refresh in production | Cookie is `Secure` but the site runs on http, or a proxy strips cookies | Serve over https; keep `/api` and the site on the same domain (bundled Caddy does). |
| Socket keeps reconnecting ("Connecting…") | Proxy doesn't forward WebSockets or `/socket.io` | The bundled Caddyfile does. For nginx add `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`. In local dev set `NEXT_PUBLIC_SOCKET_URL=http://localhost:4000`. |
| Uploads fail with a CORS error | Bucket CORS doesn't allow your site | Allow `PUT, GET` from `APP_URL` with header `Content-Type` on the bucket. |
| Uploaded files 403 / 404 | `S3_PUBLIC_ENDPOINT` points somewhere the browser can't reach | Use the public bucket endpoint (not the docker service name). |
| Camera / mic never asked, "can't make calls here" | Page not in a secure context | Use https (or `localhost`). Opening `http://192.168.x.x:3000` from a phone won't allow calls — use a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) or HTTPS. |
| "Allow microphone access…" | Permission denied earlier | Browser site settings → allow camera + microphone → reload. iPhone: Settings → Safari → Camera / Microphone. |
| Call rings, is accepted, but stays "Connecting…" / no audio | Direct connection blocked and no working TURN | Configure coturn and `TURN_URLS` / `TURN_SECRET`; open UDP relay ports; set `--external-ip`; test with Trickle ICE (see DEPLOYMENT.md). Add `turns:` on 5349 for networks that block UDP. |
| Works on Wi-Fi, fails on mobile data | Carrier-grade NAT; TURN missing or only UDP | Same as above; add TCP/TLS TURN. |
| "Group calls need a LiveKit server" | `LIVEKIT_*` not set | Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (dev: the bundled `--dev` server uses `devkey` / `secret`). |
| Group call connects then drops | LiveKit's UDP ports blocked / wrong external IP | Open 7881/tcp and the RTC UDP range; `use_external_ip: true`. |
| No incoming call when the site is closed | Browser limitation | Ordinary web pages can't ring while closed or while a phone sleeps. With push enabled you get a notification instead. Keep a tab open / install to the home screen; a native app with VoIP push would be needed for true ringing. |
| Push toggle says "not supported" on iPhone | iOS only allows Web Push for sites added to the Home Screen (iOS 16.4+) | Safari → Share → Add to Home Screen, open from there, enable push in Settings. |
| "Too many requests" | Rate limit (per IP) | Wait a minute. Behind a proxy make sure `TRUST_PROXY=true`, otherwise everyone shares the proxy's IP. |
| Account locked after wrong passwords | Brute-force protection (5 tries → 15 min) | Wait or reset the password. |
| `next build` fails with "Cannot read properties of undefined (reading 'fileExists')" | TypeScript 7 installed | The repo pins TypeScript 5.9; run `npm ci`. |
