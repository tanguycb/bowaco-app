#!/bin/zsh
# De import van de planning (1.5) lokaal proberen met de ECHTE Excel, op een verse canister van het EIGEN net
# (BOWACO_PORT/BOWACO_NET zoals tests/lokaal.sh; de echte data komt nooit op een draft). Neemt het wasm van de
# laatste lokale bouw (tests/lokaal.sh), claimt als proef-admin, importeert de OA's uit een beslissingenbestand
# (verzonnen, buiten git), draait dan de planning: proefronde → echt → nog eens (geen dubbels) en schrijft het rapport.
#   zsh tests/import-lokaal.sh PLAN.json OA-BESLISSINGEN.csv RAPPORTMAP [BESLUITEN-INFO]
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
plan=$1; oacsv=$2; rapport=$3
[ -f "$plan" ] && [ -f "$oacsv" ] && [ -n "$rapport" ] || { echo "gebruik: zsh tests/import-lokaal.sh PLAN.json OA.csv RAPPORTMAP"; exit 1; }
port=${BOWACO_PORT:-8041}
net=${BOWACO_NET:-$HOME/.bowaco/net}
mkdir -p "$net"
sed "s/port: 8041/port: $port/" "$repo/tests/net/icp.yaml" > "$net/icp.yaml"
export WASM="$repo/src/backend/dist/backend.wasm"
cd "$net"
icp network stop >/dev/null 2>&1 || true
icp network start local -d >/dev/null
icp deploy backend >/dev/null
cid=$(python3 -c "import json;print(json.load(open('.icp/cache/mappings/local.ids.json'))['backend'])")
cd "$repo"
export ICP_HOST=http://localhost:$port
echo "canister $cid"
node -e '
import("./tools/lib.mjs").then(async ({ backend }) => {
  const fs = await import("node:fs"); const os = await import("node:os");
  const code = fs.readFileSync(os.homedir() + "/.bowaco/test-opstartcode.txt", "utf8").trim();
  const a = await backend("proef-admin", process.argv[1]);
  const r = await a.claimBootstrap(code, "Proef Admin");
  console.log("claim:", "ok" in r ? "ok" : r.err);
});' "$cid"
echo "── OA-database (beslissingen buiten git)"
node tools/oa-import.mjs --csv "$oacsv" --canister "$cid" --echt | tail -4
echo "── planning: proefronde"
node tools/plan-import.mjs --plan "$plan" --canister "$cid" --rapport "$rapport" | tail -11
echo "── planning: echt"
node tools/plan-import.mjs --plan "$plan" --canister "$cid" --echt | tail -9
echo "── planning: nog eens (geen dubbels)"
node tools/plan-import.mjs --plan "$plan" --canister "$cid" --echt | tail -9
echo "$cid" > "$HOME/.bowaco/plan/lokaal-cid.txt"
