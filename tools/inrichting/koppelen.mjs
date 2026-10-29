// Stap 2b.6 (live): de inrichtingsidentiteit (~/.bowaco/inrichting-live.json, NIET de testsleutel) koppelen aan de echte
// omgeving, enkel voor de duur van de import. DE EIGENAAR draait dit in zijn eigen Terminal; de code komt nooit in een
// Claude-sessie.
//   1. Eigenaar: in de app Team → "Persoon uitnodigen" → rol Beheerder, naam "Inrichting" → code kopiëren.
//   2. Eigenaar: node tools/inrichting/koppelen.mjs <backend-canister>     (vraagt de code onzichtbaar)
//   3. Eigenaar: in de app Team → de wachtende koppeling "Inrichting" bevestigen.
//   … import, steekproef, lekcontrole (docs/inrichting.md) …
//   4. Eigenaar: Team → Logins → de toegang van "Inrichting" intrekken. Het script bewaart of toont de code niet.
import { createInterface } from "node:readline";
import { backend, identity, isLiveCanister, LIVE_ID, ok } from "../lib.mjs";

const cid = process.argv[2];
if (!cid || !/^[a-z0-9-]{27}$/.test(cid)) {
  console.error("gebruik: node tools/inrichting/koppelen.mjs <backend-canister>");
  process.exit(2);
}
if (!isLiveCanister(cid)) {
  console.error("Eerst het live-id in tools/live-canisters.json zetten: dan weigeren alle tests en testsleutels deze canister.");
  process.exit(1);
}
let code = process.env.UITNODIGING_CODE; // enkel voor een test; normaal onzichtbaar getypt
if (!code) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  console.log(`Live ${cid}: plak hier de uitnodigingscode van "Inrichting" en druk op Enter.`);
  console.log("(Je ziet geen tekens verschijnen terwijl je plakt: dat is bewust. De code wordt niet bewaard of getoond.)");
  code = await new Promise((res) => rl.question("", (c) => { rl.close(); res(c); }));
  console.log("");
}
const a = await backend(LIVE_ID, cid);
const me = ok(await a.redeemCode(code.trim()));
console.log(`✓ ${me.person?.[0]?.name ?? "Inrichting"}: status ${Object.keys(me.status)[0]} (${identity(LIVE_ID).getPrincipal().toText()})`);
if ("pending" in me.status) console.log("Bevestig nu de koppeling in de app (Team → wachtende koppelingen). Trek ze na de import weer in (Team → Logins).");
