// II-test punt 6 in de browser: een proef-OA met een eigen testsleutel (~/.bowaco/proef-afzet.json) die afgezet wordt
// terwijl de app openstaat, en daarna een #code-link krijgt zonder herladen. Enkel proefgegevens (Proef Dak NV, P-A).
//   node tests/afzet-proef.mjs <canister-id> start      → uitnodigen + code inwisselen (actief)
//   node tests/afzet-proef.mjs <canister-id> afzetten   → login intrekken (de app staat nog open)
//   node tests/afzet-proef.mjs <canister-id> code       → herstelcode; drukt de #code-link af
//   node tests/afzet-proef.mjs <canister-id> opruimen   → persoon afzetten
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, identity, KEYDIR, ok } from "../tools/lib.mjs";

const [cid, stap] = process.argv.slice(2);
const state = join(KEYDIR, "afzet-proef-state.json");
const st = existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : {};
const admin = await backend("proef-admin", cid);
const me = await backend("proef-afzet", cid);
const A = (await admin.listWorks()).find((w) => w.code === "P-A").id;
if (stap === "start") {
  const dak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
  const inv = ok(await admin.invitePerson({ name: "Proef Afzet (II-test)", roles: [{ onderaannemer: null }], orgId: [dak.id], shortCode: [], lang: [], phone: [], workIds: [A], validDays: 1n, tag: "II-test punt 6" }));
  ok(await me.redeemCode(inv.code));
  st.personId = String(inv.personId);
  writeFileSync(state, JSON.stringify(st));
  console.log("actief:", Object.keys((await me.me()).status)[0], "principal", identity("proef-afzet").getPrincipal().toText());
} else if (stap === "afzetten") {
  ok(await admin.revokeLink(identity("proef-afzet").getPrincipal()));
  console.log("login ingetrokken; status nu:", Object.keys((await me.me()).status)[0]);
} else if (stap === "code") {
  const c = ok(await admin.createRecoveryCode(BigInt(st.personId), 1n, "II-test punt 6"));
  console.log(`#code=${c.code}`);
} else if (stap === "opruimen") {
  console.log(await admin.archivePerson(BigInt(st.personId)));
} else throw new Error("stap: start | afzetten | code | opruimen");
