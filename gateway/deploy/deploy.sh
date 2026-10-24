#!/bin/zsh
# Deploy van de BOWACO-postbode naar de EU-server van de eigenaar (stap 1b.3). Draai dit op je EIGEN Mac, in de repo:
#   zsh gateway/deploy/deploy.sh eerste-keer <ssh-host> <domein>   # éénmalig: gebruiker, mappen, Node, Caddy, firewall, sleutel
#   zsh gateway/deploy/deploy.sh update <ssh-host>                  # nieuwe code + herstart + gezondheidscontrole
#   zsh gateway/deploy/deploy.sh status <ssh-host>                  # dienst, laatste logregels, /health
# <ssh-host> = wat je in `ssh <ssh-host>` typt (bv. root@1.2.3.4 of een naam uit ~/.ssh/config).
# Het script kopieert ENKEL de code (geen geheimen) en vraagt nooit een sleutel: de API-sleutel van de maildienst
# zet je zelf op de server in /etc/bowaco-postbode/postbode.env (zie docs/postbode-installatie.md).
set -euo pipefail
cmd=${1:-}
host=${2:-}
if [[ -z "$cmd" || -z "$host" ]]; then
  sed -n '2,9p' "$0"
  exit 2
fi
here=$(cd "$(dirname "$0")/.." && pwd)
NODE_VERSION=v24.17.0 # dezelfde versie als bij het testen; type-stripping zit erin (geen bouwstap)

remote() { ssh -o BatchMode=yes "$host" "$@"; }

copy_code() {
  echo "→ code kopiëren naar /opt/bowaco-postbode (zonder node_modules, geheimen of logboeken)"
  remote "mkdir -p /opt/bowaco-postbode"
  rsync -az --delete \
    --exclude node_modules --exclude '*.env' --exclude 'robot*.json' --exclude 'journaal*.jsonl' --exclude mails --exclude test \
    "$here/package.json" "$here/package-lock.json" "$here/src" "$here/deploy" "$host:/opt/bowaco-postbode/"
  remote "cd /opt/bowaco-postbode && /opt/node/bin/npm ci --omit=dev --no-audit --no-fund >/dev/null && chown -R root:root /opt/bowaco-postbode && chmod -R go-w /opt/bowaco-postbode"
}

health() {
  echo "→ gezondheid"
  remote "sleep 3; systemctl is-active bowaco-postbode && curl -fsS http://127.0.0.1:8787/health && echo"
}

case "$cmd" in
  eerste-keer)
    domain=${3:-}
    if [[ -z "$domain" ]]; then echo "gebruik: deploy.sh eerste-keer <ssh-host> <domein, bv. postbode.bowaco.eu>"; exit 2; fi
    echo "→ systeem bijwerken, Caddy, firewall"
    remote "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get -y -qq upgrade && apt-get -y -qq install caddy ufw rsync curl xz-utils unattended-upgrades >/dev/null"
    remote "ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw --force enable >/dev/null && ufw status | head -5"
    echo "→ Node $NODE_VERSION (officiële release, sha256 nagekeken)"
    remote "set -e; if [ ! -x /opt/node/bin/node ] || [ \"\$(/opt/node/bin/node -v)\" != '$NODE_VERSION' ]; then cd /tmp && f=node-$NODE_VERSION-linux-x64.tar.xz && curl -fsSLO https://nodejs.org/dist/$NODE_VERSION/\$f && curl -fsSLO https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt && grep \" \$f\$\" SHASUMS256.txt | sha256sum -c - && rm -rf /opt/node && mkdir -p /opt/node && tar -xJf \$f -C /opt/node --strip-components=1 && rm -f \$f SHASUMS256.txt; fi; /opt/node/bin/node -v"
    echo "→ gebruiker en mappen"
    remote "id postbode >/dev/null 2>&1 || useradd --system --home /var/lib/bowaco-postbode --shell /usr/sbin/nologin postbode; mkdir -p /etc/bowaco-postbode /var/lib/bowaco-postbode && chown root:postbode /etc/bowaco-postbode && chmod 0750 /etc/bowaco-postbode && chown postbode:postbode /var/lib/bowaco-postbode && chmod 0700 /var/lib/bowaco-postbode"
    copy_code
    echo "→ robotsleutel (enkel als ze nog niet bestaat; de principal komt hieronder)"
    remote "cd /opt/bowaco-postbode && install -o postbode -g postbode -m 0700 -d /var/lib/bowaco-postbode && if [ ! -f /etc/bowaco-postbode/robot.json ]; then /opt/node/bin/node src/sleutel.ts /tmp/robot.json && install -o postbode -g postbode -m 0600 /tmp/robot.json /etc/bowaco-postbode/robot.json && shred -u /tmp/robot.json; else /opt/node/bin/node src/sleutel.ts /etc/bowaco-postbode/robot.json; fi"
    echo "→ omgevingsbestand (voorbeeld, enkel als er nog geen is)"
    remote "[ -f /etc/bowaco-postbode/postbode.env ] || install -o root -g postbode -m 0640 /opt/bowaco-postbode/deploy/postbode.env.voorbeeld /etc/bowaco-postbode/postbode.env"
    echo "→ systemd en Caddy ($domain)"
    remote "install -m 0644 /opt/bowaco-postbode/deploy/bowaco-postbode.service /etc/systemd/system/bowaco-postbode.service && systemctl daemon-reload && systemctl enable bowaco-postbode >/dev/null"
    remote "sed 's/POSTBODE_DOMEIN/$domain/' /opt/bowaco-postbode/deploy/Caddyfile > /etc/caddy/Caddyfile && systemctl reload caddy || systemctl restart caddy"
    cat <<EOF

Klaar met de eerste installatie. Nog te doen (docs/postbode-installatie.md, stap 5–7):
  1. Op de server: sudo nano /etc/bowaco-postbode/postbode.env  → BREVO_API_KEY en MAIL_FROM invullen (BREVO_SANDBOX=1 laten)
  2. In de app (admin): Instellingen → Postbode → robot toevoegen met de principal hierboven, soort "mail"
  3. zsh gateway/deploy/deploy.sh update $host
EOF
    ;;
  update)
    copy_code
    remote "systemctl restart bowaco-postbode"
    health
    ;;
  status)
    remote "systemctl --no-pager status bowaco-postbode | head -12; journalctl -u bowaco-postbode -n 20 --no-pager"
    health
    ;;
  *)
    echo "onbekend: $cmd (eerste-keer | update | status)"
    exit 2
    ;;
esac
