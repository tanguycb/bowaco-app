#!/bin/zsh
# Alles lokaal op het EIGEN testnet (tests/net, poort 8041; raakt het gedeelde :8000 nooit):
# bouwen → lege canister (reinstall) + nep-maildienst → rollentest → lektestrobot → review → mailproef → gateway.
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
# 1b.5: in de testbouw telt elke canister als live (pad "testmodus uit → echte adressen" in de rollentest); de upload
# houdt false (tools/meetlat.mjs weigert anders): echte mail enkel vanaf Config.mailLiveBackends.
sed -i '' -E "s/(public let mailLiveAnyCanister : Bool = )false/\1true/" "$cfg"
mops build --output src/backend/dist
mv "$cfg.echt" "$cfg"
# mail-caffeine: de nep-maildienst (speelt de integratiecanister van Caffeine na; enkel op dit eigen net).
moc=$(mops toolchain bin moc)
"$moc" --package core .mops/core@2.6.2/src --default-persistent-actors -o "$HOME/.bowaco/nepmail.wasm" tests/net/nepmail.mo 2>/dev/null
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
icp deploy >/dev/null
cid=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['backend'])")
# Zoals Caffeine: de backend vindt de maildienst via INTEGRATIONS_CANISTER_ID (hier de nep-maildienst).
export NEPMAIL=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['nepmail'])")
icp canister settings update backend -e local --add-environment-variable "INTEGRATIONS_CANISTER_ID=$NEPMAIL" >/dev/null
# 1b.5 (review D9): de testbeheerder wordt controller van de backend op dit EIGEN net, zodat tests/review.mjs de
# maildienst even onbereikbaar kan maken (omgevingsvariabele via de beheercanister). Nooit op een draft of live.
admin_principal=$(cd "$repo/tools" && node --input-type=module -e "const m = await import('./lib.mjs'); console.log(m.identity('proef-admin').getPrincipal().toText())")
icp canister settings update backend -e local --add-controller "$admin_principal" >/dev/null
cd "$repo"
echo "canister $cid"
export ICP_HOST=http://localhost:$port
node tests/rollen.mjs "$cid"
node tests/lek.mjs "$cid"
# 1.9: de aanvallen uit de securityreview (externen, bestanden, robot, grenzen, herstelpoort, opruiming van tellers).
node tests/review.mjs "$cid"
# mail-caffeine: de app verstuurt zelf (nep-maildienst); de gateway (fase 3) enkel nog eenheidstesten.
node tests/mail-proef.mjs "$cid"
( cd gateway && node --test test/*.test.ts )
