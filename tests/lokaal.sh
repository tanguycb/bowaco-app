#!/bin/zsh
# Alles lokaal op het EIGEN testnet (tests/net, poort 8041; raakt het gedeelde :8000 nooit):
# bouwen → lege canister (reinstall) + nep-maildienst → rollentest → lektestrobot → review → posten → offertes → rekentests → mailproef → gateway.
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
# ALLEEN_OPZET=1: enkel bouwen en een lege canister installeren (voor een losse proef op dit eigen net), geen tests.
if [[ -n "$ALLEEN_OPZET" ]]; then echo "$cid" > "$net/canister.txt"; exit 0; fi
node tests/rollen.mjs "$cid"
node tests/lek.mjs "$cid"
# 1.9: de aanvallen uit de securityreview (externen, bestanden, robot, grenzen, herstelpoort, opruiming van tellers).
node tests/review.mjs "$cid"
# 2.2: de draftproef van de postenbibliotheek (verzonnen proefposten), en de ENIGE echte offerte enkel hier op het eigen
# net (als tools/posten-analyse.py ze al las): proefronde, echt, nog eens (geen dubbels). Nooit naar een draft.
node tests/posten-draft.mjs "$cid"
posten=$HOME/.bowaco/posten/posten-2026-231.json
if [[ -f "$posten" ]]; then
  node tools/posten-import.mjs --plan "$posten" --canister "$cid"
  node tools/posten-import.mjs --plan "$posten" --canister "$cid" --echt
  node tools/posten-import.mjs --plan "$posten" --canister "$cid" --echt
fi
# 2.4: de draftproef van de offerte-editor (verzonnen proefofferte op P-A; gebruikt de proefpost van posten-draft).
node tests/offerte-draft.mjs "$cid"
# 2.5: de rekentests (rekenmodule zelf, de fouten van 2026/231 met verzonnen posten, browser = server op 200 willekeurige
# offertes). De ECHTE offerte enkel hier en enkel als ze er is: rapport buiten git (~/.bowaco/posten/rekentest-*.md).
node tests/rekentest.mjs "$cid"
# 2.8: aanvaarde offerte → werf (voorstel, bevestigen, idempotent, meerwerk, afwijzen, nieuwe werf).
node tests/werfstart-draft.mjs "$cid"
echte=$(ls "$HOME"/Desktop/Split/bowaco-docs/bowaco/2026-231_Offerte_*.xlsx 2>/dev/null | head -1)
if [[ -n "$echte" ]]; then
  python3 -I tools/rekentest-echt.py "$echte"
  node tests/rekentest-echt.mjs "$HOME/.bowaco/posten/rekentest-2026-231.json"
fi
# mail-caffeine: de app verstuurt zelf (nep-maildienst); de gateway (fase 3) enkel nog eenheidstesten.
node tests/mail-proef.mjs "$cid"
( cd gateway && node --test test/*.test.ts )
