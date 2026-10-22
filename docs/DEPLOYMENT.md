# Deploying Baatcheet

The repo ships everything for one server (a VPS with 2 vCPU / 4 GB RAM handles a few hundred
concurrent users): PostgreSQL, the API, the web app, Caddy (HTTPS), coturn (TURN), LiveKit (group
calls) and file storage (a Docker volume, or S3 / the optional MinIO). For larger setups use managed Postgres and S3 and see "Scaling".

## Try it first: a temporary trial from GitHub Actions

Actions → **Trial** → Run workflow (1–5 hours). The run's summary shows a
`https://….trycloudflare.com` address. It is for testing only: e-mail verification is skipped
(`AUTO_VERIFY_EMAIL=true`, so password reset doesn't work), there is no TURN, and everything is deleted when
the run ends.

## On your own Linux PC (free, no public IP needed)

A PC that stays on (4 GB+ RAM) can host Baatcheet. A Cloudflare Tunnel puts it online without opening
ports on the router, so it also works behind Jio / Airtel CGNAT:

```bash
curl -fsSL https://raw.githubusercontent.com/Mahi2124-mj/Baatcheet/main/deploy/install-home.sh | sudo bash
```

- Option **a**: your domain on a free Cloudflare account → a tunnel token (Zero Trust → Networks → Tunnels),
  public hostname `your domain → HTTP caddy:80`. The address never changes.
- Option **b**: no domain → a free random `https://….trycloudflare.com` address. It changes when the PC
  restarts; the current one is written to `/opt/baatcheet/SITE-ADDRESS.txt`. Fine for trying it out.
- Calls: add a free Metered TURN login (dashboard.metered.ca) so calls also connect on mobile data.
- Group calls are off in this mode (LiveKit needs a public IP).
- **No source code on the PC.** GitHub Actions publishes the images `ghcr.io/mahi2124-mj/baatcheet-server`
  and `baatcheet-web` (amd64 + arm64) after every green run on `main`. The PC keeps only the compose files,
  `.env` (settings and secrets) and the data (database and uploaded files in Docker volumes) in `/opt/baatcheet`.
- **Controlled from GitHub.** A `baatcheet-update` timer fetches the newest run files and images every
  15 minutes, so whatever is merged to `main` goes live by itself. Pin a version with `BAATCHEET_TAG=<commit sha>`
  in `.env`.
- A `baatcheet` systemd service starts everything on boot. Logs: `cd /opt/baatcheet && docker compose -f docker-compose.yml -f docker-compose.home.yml -f docker-compose.release.yml logs -f server`.
- Back up the data: `docker run --rm -v baatcheet_pgdata:/d:ro -v $PWD:/b alpine tar czf /b/db.tgz -C /d .` (and the same for `baatcheet_uploads`), or use `pg_dump` as below.
- Rate limits see each visitor's real IP through the tunnel (`CLIENT_IP_HEADER=cf-connecting-ip`).
- CI runs this exact mode with a real trycloudflare tunnel (job `home` in `.github/workflows/ci.yml`).

## Quickest way on a cloud server: one-command installer

On a fresh Ubuntu server (Oracle Cloud Always Free works) with your domain's A record pointing at it:

```bash
curl -fsSL https://raw.githubusercontent.com/Mahi2124-mj/Baatcheet/main/deploy/install.sh | sudo bash
```

It asks for the domain, your admin e-mail and SMTP details, then installs Docker, opens the server's
firewall, generates every secret (`.env`, `deploy/livekit.yaml`, VAPID keys), and starts the full
stack with HTTPS, TURN and LiveKit group calls. Run the same command again to update.

On Oracle Cloud also open the ports in the VCN: Networking → Virtual cloud networks → your VCN →
Security Lists → Default → Add Ingress Rules (source `0.0.0.0/0`): TCP 80, 443, 3478, 7881 and
UDP 443, 3478, 49160-49999, 50000-60000.

The rest of this page is the manual way.

## 1. Server and DNS

1. A Linux VPS with Docker Engine + Compose v2.24 or newer (`docker compose version`).
2. DNS `A` records pointing to the server: `chat.example.com` (site), optionally `rtc.example.com` (LiveKit)
   and `turn.example.com` (TURN). Open ports: 80, 443 (TCP+UDP), 3478 (TCP+UDP), 5349 (TCP),
   49160–49999 (UDP, TURN relay), 7881 (TCP) and 50000–60000 (UDP) for LiveKit.

## 2. Configuration

```bash
cd Baatcheet
cp .env.example .env
```

Edit `.env`:

- `NODE_ENV=production`, `APP_URL=https://chat.example.com`, `API_URL=https://chat.example.com`, `TRUST_PROXY=true`.
- New secrets: `SESSION_SECRET` (`openssl rand -base64 48`), `POSTGRES_PASSWORD`, `S3_SECRET_ACCESS_KEY`, `TURN_SECRET` (`openssl rand -hex 32`).
- `SMTP_URL` from your e-mail provider, e.g. `smtps://USER:PASSWORD@smtp.provider.com:465` (required in production).
- `ADMIN_EMAILS=you@example.com`.
- Files: the default `STORAGE_DRIVER=local` keeps them in the `uploads` volume (back it up). For S3 set `STORAGE_DRIVER=s3` and a managed S3 (or MinIO with `--profile s3`) (`S3_ENDPOINT` empty for AWS, `S3_PUBLIC_ENDPOINT` = public bucket endpoint, `S3_FORCE_PATH_STYLE=false` for AWS). The bucket must stay **private**; the app hands out signed URLs. Allow CORS `PUT, GET` from your `APP_URL` on the bucket.
- TURN: `TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp`, `TURN_EXTERNAL_IP=<server public IP>`, and TLS files in `deploy/turn-certs/` (`fullchain.pem`, `privkey.pem`, e.g. from certbot for turn.example.com).
- Group calls: copy `deploy/livekit.example.yaml` to `deploy/livekit.yaml`, set keys, set `LIVEKIT_URL=wss://rtc.example.com` and the same `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Add a Caddy site `rtc.example.com { reverse_proxy localhost:7880 }` (LiveKit runs on the host network). Leave the `LIVEKIT_*` values empty to turn group calls off.
- Push notifications: `npm run vapid -w server` (or `npx web-push generate-vapid-keys`) → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:you@example.com`.

Replace `chat.example.com` in `deploy/Caddyfile.production`.

## 3. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f server   # "Baatcheet API listening on :4000"
```

The API applies database migrations on start (`prisma migrate deploy`). If a required setting is
missing it stops and prints exactly which one.

Check: `https://chat.example.com/readyz` → `{"ok":true}`. Register with an `ADMIN_EMAILS` address
and open **Admin**.

## 4. Verify TURN

Open <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>, add
`turn:turn.example.com:3478` with a username/password from `GET /api/calls/ice-servers`
(logged in, in the browser), and "Gather candidates". You must see a `relay` candidate.
Then do the two-device checklist in `docs/TESTING.md` with one phone on mobile data.

## Backups and recovery

```bash
# Nightly database dump (cron), keep 14 days
docker compose exec -T postgres pg_dump -U baatcheet -Fc baatcheet > backups/baatcheet-$(date +%F).dump
find backups -name '*.dump' -mtime +14 -delete

# Files (local driver): copy the uploads volume
docker run --rm -v baatcheet_uploads:/data:ro -v $PWD/backups:/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
# Files (S3): use your provider's versioning / replication, or `aws s3 sync s3://BUCKET backups/files`

# Restore
docker compose exec -T postgres pg_restore -U baatcheet -d baatcheet --clean --if-exists < backups/baatcheet-2026-10-21.dump
```

Test a restore on a spare machine every few months. Use managed backups (point-in-time recovery)
if you move to a managed Postgres.

## Updating

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The API shuts down gracefully on SIGTERM (stops accepting, ends calls cleanly, closes the database).

## Scaling

- One API process keeps presence and ringing calls in memory. To run several, add Redis and the
  Socket.IO Redis adapter (`@socket.io/redis-adapter`), move `services/presence.ts` and the call map in
  `realtime/calls.ts` to Redis, use sticky sessions at the load balancer, and replace the in-memory
  rate limiter with `rate-limit-redis`.
- Postgres: add a connection pooler (PgBouncer) and read replicas for search-heavy loads.
- TURN: run coturn on several regions and list them all in `TURN_URLS`.
- Group calls: LiveKit scales horizontally with Redis (see LiveKit docs) or use LiveKit Cloud.

## Monitoring hooks

- Health: `/healthz` (liveness) and `/readyz` (database) for your uptime checker / orchestrator.
- Logs are JSON (pino) on stdout without cookies, tokens or passwords — ship them to Loki / CloudWatch / Datadog.
- Admin → Overview shows users online, active calls, DB latency and memory.
