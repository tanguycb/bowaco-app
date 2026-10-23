// De eigenaar beheerder maken op een DRAFT. Op een draft claimt de rollentest de (test)opstartcode met de
// testbeheerder; deze opdrachten draait de eigenaar zelf in zijn eigen Terminal, zodat de code alleen daar staat.
//   node tools/draft-eigenaar.mjs uitnodigen <backend-canister> "Tanguy"   → beheerderscode (één keer getoond)
//   (code inwisselen in de app: inloggen met je eigen Internet Identity → code invoeren → "wacht op bevestiging")
//   node tools/draft-eigenaar.mjs bevestig <backend-canister>              → bevestigt de wachtende koppelingen
// Werkt enkel waar de testbeheerder (sleutel ~/.bowaco/proef-admin.json) beheerder is: nooit op live.
import { backend, ok } from "./lib.mjs";

const [cmd, cid, name] = process.argv.slice(2);
if (!cmd || !cid) {
  console.error('gebruik: node tools/draft-eigenaar.mjs uitnodigen <canister> "Naam" | bevestig <canister>');
  process.exit(2);
}
const admin = await backend("proef-admin", cid);
if (cmd === "uitnodigen") {
  const r = ok(await admin.invitePerson({ name: name || "Eigenaar", roles: [{ admin: null }], orgId: [], shortCode: [], lang: ["nl"], phone: [], workIds: [], validDays: 2n, tag: "eigenaar draft" }));
  console.log(`\nBeheerderscode voor ${name || "Eigenaar"} (2 dagen geldig, één keer bruikbaar):\n\n    ${r.code}\n`);
  console.log("Log in op de draft met je eigen Internet Identity, vul de code in, en draai daarna:");
  console.log(`    node tools/draft-eigenaar.mjs bevestig ${cid}\n`);
} else if (cmd === "bevestig") {
  const pending = (await admin.listLinks()).filter((l) => "pending" in l.status);
  if (pending.length === 0) console.log("Geen koppelingen die wachten.");
  for (const l of pending) {
    ok(await admin.confirmLink(l.principal));
    console.log(`✓ bevestigd: ${l.personName} (${l.principal.toText()})`);
  }
} else {
  console.error(`onbekende opdracht: ${cmd}`);
  process.exit(2);
}
