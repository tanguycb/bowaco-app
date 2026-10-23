#!/bin/zsh
# Alles lokaal op het EIGEN testnet (tests/net, poort 8041; raakt het gedeelde :8000 nooit):
# bouwen → lege canister (reinstall) → rollentest → lektestrobot.
#   zsh tests/lokaal.sh            (start het net als het nog niet draait)
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
# Lokale testbouw met de hash van de TEST-opstartcode (de echte code kent enkel de eigenaar). Config.mo
# wordt na de bouw altijd teruggezet; de upload (tools/push.sh) bouwt uit een schone kopie van git.
cfg=src/backend/lib/Config.mo
testhash=$(node -e 'const c=require("fs").readFileSync(process.env.HOME+"/.bowaco/test-opstartcode.txt","utf8").trim().toUpperCase().replace(/[\s-]/g,"");const b=c.length===19&&c.startsWith("BOW")?c.slice(3):c;console.log(require("crypto").createHash("sha256").update("bowaco-code-v1|"+b).digest("hex"))')
cp "$cfg" "$cfg.echt"
trap 'mv "$repo/$cfg.echt" "$repo/$cfg" 2>/dev/null || true' EXIT
sed -i '' -E "s/(public let bootstrapHashHex = \")[0-9a-f]{64}/\1$testhash/" "$cfg"
mops build --output src/backend/dist
mv "$cfg.echt" "$cfg"
./node_modules/.bin/caffeine-bindgen --did-file ./src/backend/dist/backend.did --out-dir ./src/frontend/src --actor-interface-file --force >/dev/null
# Het net draait in ~/.bowaco/net (buiten iCloud: de Desktop wordt gesynchroniseerd en iCloud maakt
# kopieën als "descriptor 2.json", waarna icp-cli zijn eigen net niet meer terugvindt).
# BOWACO_PORT en BOWACO_NET: een eigen net naast dat van een andere sessie (standaard poort 8041 in ~/.bowaco/net).
port=${BOWACO_PORT:-8041}
net=${BOWACO_NET:-$HOME/.bowaco/net}
mkdir -p "$net"
sed "s/port: 8041/port: $port/" tests/net/icp.yaml > "$net/icp.yaml"
export WASM="$repo/src/backend/dist/backend.wasm"
cd "$net"
# De rollentest verzet de klok van dit net; daarom elke ronde een vers net. Alleen het EIGEN net
# (dit project, poort 8041) wordt gestopt; nooit een ander proces.
icp network stop >/dev/null 2>&1 || true
icp network start local -d >/dev/null
icp deploy backend >/dev/null
cid=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['backend'])")
cd "$repo"
echo "canister $cid"
export ICP_HOST=http://localhost:$port
node tests/rollen.mjs "$cid"
node tests/lek.mjs "$cid"
