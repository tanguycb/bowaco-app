#!/bin/zsh
# Alles lokaal op het EIGEN testnet (tests/net, poort 8041; raakt het gedeelde :8000 nooit):
# bouwen → lege canister (reinstall) → rollentest → lektestrobot.
#   zsh tests/lokaal.sh            (start het net als het nog niet draait)
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo"
mops build --output src/backend/dist
./node_modules/.bin/caffeine-bindgen --did-file ./src/backend/dist/backend.did --out-dir ./src/frontend/src --actor-interface-file --force >/dev/null
# Het net draait in ~/.bowaco/net (buiten iCloud: de Desktop wordt gesynchroniseerd en iCloud maakt
# kopieën als "descriptor 2.json", waarna icp-cli zijn eigen net niet meer terugvindt).
net=$HOME/.bowaco/net
mkdir -p "$net"
cp tests/net/icp.yaml "$net/icp.yaml"
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
export ICP_HOST=http://localhost:8041
node tests/rollen.mjs "$cid"
node tests/lek.mjs "$cid"
