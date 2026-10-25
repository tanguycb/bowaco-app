// De testbeheerder (~/.bowaco/proef-admin.json) koppelen aan een NIEUWE draft, nadat de eigenaar de draft claimde met
// zijn eigen opstartcode. DE EIGENAAR draait dit in zijn eigen Terminal; de code komt nooit in een Claude-sessie.
//   1. Eigenaar: draft openen → inloggen met zijn Internet Identity → "Opstartcode" → eigen code (hij is beheerder).
//   2. Eigenaar: in de app Team → "Persoon uitnodigen" → rol Beheerder, naam "Testbeheerder" → code kopiëren.
//   3. Eigenaar: node tools/proef-admin-koppelen.mjs <backend-canister>     (vraagt de code onzichtbaar)
//   4. Eigenaar: in de app Team → de wachtende koppeling "Testbeheerder" bevestigen.
// Het script doet niets anders dan redeemCode(<code>) met de testsleutel; het bewaart of toont de code niet.
// Enkel op een draft: weigert elke canister die in Config.mo bij mailLiveBackends staat (de echte omgeving).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { backend, identity, ok } from "./lib.mjs";

const cid = process.argv[2];
if (!cid || !/^[a-z0-9-]{27}$/.test(cid)) {
  console.error("gebruik: node tools/proef-admin-koppelen.mjs <backend-canister>");
  process.exit(2);
}
const cfg = readFileSync(fileURLToPath(new URL("../src/backend/lib/Config.mo", import.meta.url)), "utf8");
const live = (cfg.match(/mailLiveBackends\(\)[^{]*\{\s*\[([^\]]*)\]/)?.[1] ?? "").includes(cid);
if (live) {
  console.error("Geweigerd: dit is een live-canister (Config.mailLiveBackends).");
  process.exit(1);
}
let code = process.env.UITNODIGING_CODE; // enkel voor een test; normaal onzichtbaar getypt
if (!code) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  console.log(`Draft ${cid}: plak hier de uitnodigingscode van "Testbeheerder" en druk op Enter.`);
  console.log("(Je ziet geen tekens verschijnen terwijl je plakt: dat is bewust. De code wordt niet bewaard of getoond.)");
  code = await new Promise((res) => rl.question("", (c) => { rl.close(); res(c); }));
  console.log("");
}
const admin = await backend("proef-admin", cid);
const me = ok(await admin.redeemCode(code.trim()));
console.log(`✓ ${me.person?.[0]?.name ?? "testbeheerder"}: status ${Object.keys(me.status)[0]} (${identity("proef-admin").getPrincipal().toText()})`);
if ("pending" in me.status) console.log("Bevestig nu de koppeling in de app (Team → wachtende koppelingen).");
