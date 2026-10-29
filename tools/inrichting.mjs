// Stap 2b.6: de inrichting met de gegevens van BOWACO, in zeven stappen (BOWACO_analyse_documenten.md §4):
//   1 bedrijf en tellers · 2 firma's (OA's, leveranciers) · 3 werven en planning · 4 postenbibliotheek (oude offertes)
//   5 prijslijsten · 6 vergunningskennisbank · 7 documenten van de actieve werven
// De lezers (tools/inrichting/lees-*.py, offerte-lezer.py; samen via tools/inrichting/lees-alles.sh) maken per stap een
// plan in ~/.bowaco/inrichting/plan (buiten git). Dit script zet de plannen in de app.
//
//   ICP_HOST=http://localhost:8061 node tools/inrichting.mjs --canister <id>                       (droogloop, alle stappen)
//   ICP_HOST=http://localhost:8061 node tools/inrichting.mjs --canister <id> --stap 1,2 --echt     (bewaren)
//
// Opties: --plan <map>        de plannen (standaard ~/.bowaco/inrichting/plan)
//         --identity <naam>   sleutel in ~/.bowaco (standaard proef-admin; enkel de beheerder mag inrichten)
//         --verslag <pad.md>  het verslag van deze run (standaard ~/.bowaco/inrichting/verslag/run-<tijd>.md, + .csv)
//         --gelijktijdig <n>  oproepen tegelijk (standaard 8 lokaal, 3 elders)
// Herhaalbaar: elke stap vindt wat er al staat terug (sleutel, code, naam, verwijzing) en maakt niets dubbel.
// GRENS: een plan met echte gegevens gaat enkel naar het eigen lokale net, ook in een droogloop (tools/inrichting/lib.mjs).
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { backend, isLiveCanister, LIVE_ID } from "./lib.mjs";
import { leesPlan, Verslag, isLocal } from "./inrichting/lib.mjs";
import { stap1 } from "./inrichting/stap1-bedrijf.mjs";
import { stap2 } from "./inrichting/stap2-firmas.mjs";
import { stap3 } from "./inrichting/stap3-werven.mjs";
import { stap4 } from "./inrichting/stap4-posten.mjs";
import { stap5 } from "./inrichting/stap5-prijzen.mjs";
import { stap6 } from "./inrichting/stap6-vergunningen.mjs";
import { stap7 } from "./inrichting/stap7-documenten.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const cid = arg("canister");
if (!cid) throw new Error("gebruik: node tools/inrichting.mjs --canister <id> [--stap 1,2,…] [--echt] [--plan map] [--verslag pad.md]");
const echt = process.argv.includes("--echt");
const map = arg("plan", join(homedir(), ".bowaco", "inrichting", "plan"));
const stappen = String(arg("stap", "1,2,3,4,5,6,7")).split(",").map((s) => Number(s.trim()));
const gelijktijdig = Number(arg("gelijktijdig", isLocal() ? 8 : 3));
const verslagPad = arg("verslag", join(homedir(), ".bowaco", "inrichting", "verslag", `run-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));

const STAPPEN = {
  1: { naam: "bedrijf en tellers", plan: "stap1-bedrijf.json", fn: stap1 },
  2: { naam: "firma's", plan: "stap2-firmas.json", fn: stap2 },
  3: { naam: "werven en planning", plan: "stap3-werven.json", fn: stap3 },
  4: { naam: "postenbibliotheek", plan: "stap4-posten.json", fn: stap4 },
  5: { naam: "prijslijsten", plan: "stap5-prijzen.json", fn: stap5 },
  6: { naam: "vergunningskennisbank", plan: "stap6-vergunningen.json", fn: stap6 },
  7: { naam: "documenten van de actieve werven", plan: "stap7-documenten.json", fn: stap7 },
};

// Eerst ALLE plannen lezen: de grens (echte gegevens enkel lokaal) geldt vóór de eerste oproep.
const plannen = {};
for (const s of stappen) {
  if (!STAPPEN[s]) throw new Error(`onbekende stap ${s}`);
  plannen[s] = leesPlan(join(map, STAPPEN[s].plan));
}
// Het planningsplan waar stap 3 naar verwijst, gaat vóór de eerste oproep ook door de grens.
const pp = plannen[3]?.planning?.plan;
if (pp) leesPlan(isAbsolute(pp) ? pp : join(map, pp));
// Op live enkel de inrichtingsidentiteit (een testsleutel komt nooit op live; lib.mjs weigert ze daar).
const actor = await backend(arg("identity", isLiveCanister(cid) ? LIVE_ID : "proef-admin"), cid);
const verslag = new Verslag(echt);
// Wat een droogloop in een vorige stap zou aanmaken (eenheden, hoofdstukken, werven): de volgende stappen tellen het mee.
const zou = { eenheden: new Set(), hoofdstukken: new Set(), werven: new Set() };
let fouten = 0;
for (const s of stappen) {
  const { naam, fn } = STAPPEN[s];
  if (!plannen[s]) { verslag.noteer(s, `geen plan (${STAPPEN[s].plan}): stap overgeslagen`); console.log(`── stap ${s} ${naam}: geen plan, overgeslagen`); continue; }
  const t0 = Date.now();
  try {
    await fn({ actor, plan: plannen[s], echt, verslag, gelijktijdig, map, cid, zou });
  } catch (e) {
    fouten++;
    verslag.add(s, "stap", s, naam, "fout", String(e.message ?? e).slice(0, 300));
  }
  console.log(`── stap ${s} ${naam} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n${verslag.samenvatting(s)}`);
}
verslag.schrijf(verslagPad, `Inrichting 2b.6: ${echt ? "echte run" : "droogloop"} op ${cid}`);
const prob = verslag.problemen();
console.log(`\n${echt ? "ECHT BEWAARD" : "DROOGLOOP (niets bewaard)"} · conflicten en fouten: ${prob.length} · verslag: ${verslagPad}`);
for (const p of prob.slice(0, 15)) console.log(`  ✗ stap ${p.stap} ${p.soort} ${p.sleutel}: ${p.uitkomst}: ${p.waarom}`);
process.exit(fouten ? 1 : 0);
