#!/usr/bin/env bash
# Baatcheet one-command installer for a fresh Ubuntu 22.04/24.04 server (e.g. Oracle Cloud Always Free).
#
#   curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/deploy/install.sh | sudo bash
#
# It installs Docker, opens the firewall, downloads Baatcheet to /opt/baatcheet, creates .env with new
# random secrets (kept on later runs), and starts everything with HTTPS for your domain.
# Run it again any time to update to the newest code.
set -euo pipefail

REPO="${REPO:-https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/baatcheet}"
APP="$DIR"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { # ask VAR "Question" [default]
  local v; read -r -p "$2${3:+ [$3]}: " v </dev/tty || true; printf -v "$1" '%s' "${v:-${3:-}}"
}
asks() { local v; read -r -s -p "$2: " v </dev/tty || true; echo >/dev/tty; printf -v "$1" '%s' "$v"; }

[ "$(id -u)" = 0 ] || die "Run with sudo:  curl -fsSL … | sudo bash"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Warning: tested on Ubuntu; this is ${PRETTY_NAME:-unknown}."

say "Installing Docker, git and firewall tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y ca-certificates curl git openssl python3 iptables-persistent >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null
systemctl enable --now docker >/dev/null

say "Opening the firewall (web, calls, TURN, group calls)"
open_port() { iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || iptables -I INPUT -p "$1" --dport "$2" -j ACCEPT; }
open_port tcp 80; open_port tcp 443; open_port udp 443
open_port tcp 3478; open_port udp 3478; open_port udp 49160:49999
open_port tcp 7881; open_port udp 50000:60000
netfilter-persistent save >/dev/null 2>&1 || true

say "Downloading Baatcheet ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$APP"

PUBLIC_IP="$(curl -fsS4 https://ifconfig.me || curl -fsS4 https://api.ipify.org)"
PRIVATE_IP="$(hostname -I | awk '{print $1}')"

if [ ! -f .env ]; then
  say "First-time setup"
  echo "Public IP of this server: $PUBLIC_IP"
  ask DOMAIN "Your domain (its DNS A record must point to $PUBLIC_IP), e.g. chat.example.com"
  [ -n "$DOMAIN" ] || die "A domain is needed for HTTPS (browsers only allow calls on https)."
  ask ADMIN_EMAIL "Your e-mail (becomes the admin account)"
  echo "E-mail sending (verification / password reset). Free option: Brevo → SMTP & API → SMTP."
  ask SMTP_HOST "SMTP server" "smtp-relay.brevo.com"
  ask SMTP_PORT "SMTP port" "587"
  ask SMTP_USER "SMTP login"
  asks SMTP_PASS "SMTP password / key (hidden)"
  ask MAIL_FROM_ADDR "Send e-mails from (an address your SMTP provider verified)" "$ADMIN_EMAIL"
  SMTP_URL="$(python3 -c 'import sys,urllib.parse as u; h,p,us,pw=sys.argv[1:]; print(("smtps" if p=="465" else "smtp")+"://"+u.quote(us,safe="")+":"+u.quote(pw,safe="")+"@"+h+":"+p)' "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASS")"
  rnd() { openssl rand -hex "${1:-24}"; }
  DB_PASS="$(rnd 18)"
  LK_KEY="API$(rnd 8)"; LK_SECRET="$(rnd 32)"
  VAPID="$(docker run --rm node:22-alpine npx -y web-push@3.6.7 generate-vapid-keys --json 2>/dev/null || true)"
  VAPID_PUB="$(printf '%s' "$VAPID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["publicKey"])' 2>/dev/null || true)"
  VAPID_PRIV="$(printf '%s' "$VAPID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["privateKey"])' 2>/dev/null || true)"
  umask 077
  cat > .env <<ENV
NODE_ENV=production
PORT=4000
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$DB_PASS
DATABASE_URL=postgresql://baatcheet:$DB_PASS@postgres:5432/baatcheet
SESSION_SECRET=$(rnd 48)
SESSION_DAYS=30
APP_URL=https://$DOMAIN
API_URL=https://$DOMAIN
CORS_ORIGINS=
TRUST_PROXY=true
ADMIN_EMAILS=$ADMIN_EMAIL
LOG_LEVEL=info
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=/data/uploads
STUN_URLS=stun:stun.l.google.com:19302,stun:$DOMAIN:3478
TURN_URLS=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
TURN_SECRET=$(rnd 32)
TURN_EXTERNAL_IP=$PUBLIC_IP/$PRIVATE_IP
TURN_TTL_SECONDS=3600
CALL_RING_SECONDS=45
LIVEKIT_URL=wss://$DOMAIN
LIVEKIT_API_KEY=$LK_KEY
LIVEKIT_API_SECRET=$LK_SECRET
SMTP_URL=$SMTP_URL
MAIL_FROM=Baatcheet <$MAIL_FROM_ADDR>
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
VAPID_PUBLIC_KEY=$VAPID_PUB
VAPID_PRIVATE_KEY=$VAPID_PRIV
VAPID_SUBJECT=mailto:$ADMIN_EMAIL
NEXT_PUBLIC_SOCKET_URL=
ENV
  cat > deploy/livekit.yaml <<LK
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  $LK_KEY: $LK_SECRET
LK
  umask 022
  echo "Saved settings in $APP/.env (keep it private; it is not in git)."
else
  say "Keeping existing settings ($APP/.env)"
  DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2-)"
fi

RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo
  echo "Warning: $DOMAIN points to '${RESOLVED:-nothing}', not to this server ($PUBLIC_IP)."
  echo "Add an A record  $DOMAIN → $PUBLIC_IP  at your domain provider. HTTPS starts working once it does."
fi

say "Building and starting (first time takes 5–15 minutes)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans

say "Waiting for the API"
for _ in $(seq 1 60); do
  if docker compose exec -T server node -e "fetch('http://localhost:4000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    printf '\n\033[1;32mBaatcheet is running:  https://%s\033[0m\n' "$DOMAIN"
    echo "Sign up with $(grep '^ADMIN_EMAILS=' .env | cut -d= -f2-) to get the Admin page."
    echo "Update later:  re-run the same install command.   Logs:  cd $APP && docker compose logs -f server"
    exit 0
  fi
  sleep 5
done
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose logs --tail=80 server
die "The API didn't come up. The log above says why."
