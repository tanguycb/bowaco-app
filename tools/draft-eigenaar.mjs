// De eigenaar beheerder maken op een DRAFT. Op een draft claimt de rollentest de (test)opstartcode met de
// testbeheerder; deze opdrachten draait de eigenaar zelf in zijn eigen Terminal, zodat de code alleen daar staat.
//   node tools/draft-eigenaar.mjs uitnodigen <backend-canister> "Tanguy"   → beheerderscode (één keer getoond)
//   (code inwisselen in de app: inloggen met je eigen Internet Identity → code invoeren → "wacht op bevestiging")
//   node tools/draft-eigenaar.mjs bevestig <backend-canister> [persoons-id]
// `bevestig` toont eerst ALLE wachtende koppelingen en bevestigt daarna enkel die van de persoon voor wie de
// code gemaakt is (onthouden in ~/.bowaco/draft-eigenaar-<canister>.json, of het persoons-id als argument).
// Niets wordt bevestigd als die persoon geen of meer dan één wachtende koppeling heeft.
// Werkt enkel waar de testbeheerder (sleutel ~/.bowaco/proef-admin.json) beheerder is: nooit op live.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, KEYDIR, ok } from "./lib.mjs";

const [cmd, cid, arg] = process.argv.slice(2);
if (!cmd || !cid) {
  console.error('gebruik: node tools/draft-eigenaar.mjs uitnodigen <canister> "Naam" | bevestig <canister> [persoons-id]');
  process.exit(2);
}
const memo = join(KEYDIR, `draft-eigenaar-${cid}.json`);
const admin = await backend("proef-admin", cid);

if (cmd === "uitnodigen") {
  const name = arg || "Eigenaar";
  const r = ok(await admin.invitePerson({ name, roles: [{ admin: null }], orgId: [], shortCode: [], lang: ["nl"], phone: [], workIds: [], validDays: 2n, tag: "eigenaar draft" }));
  writeFileSync(memo, JSON.stringify({ personId: String(r.personId), inviteId: String(r.inviteId), name }), { mode: 0o600 });
  console.log(`\nBeheerderscode voor ${name} (persoon #${r.personId}; 2 dagen geldig, één keer bruikbaar):\n\n    ${r.code}\n`);
  console.log("Log in op de draft met je eigen Internet Identity, vul de code in (je ziet 'Wacht op bevestiging'), en draai daarna:");
  console.log(`    node tools/draft-eigenaar.mjs bevestig ${cid}\n`);
} else if (cmd === "bevestig") {
  const saved = existsSync(memo) ? JSON.parse(readFileSync(memo, "utf8")) : null;
  const target = arg ?? saved?.personId;
  if (!target || !/^\d+$/.test(target)) {
    console.error("Voor wie? Geef het persoons-id mee (uitnodigen toont het), of maak de code met 'uitnodigen'.");
    process.exit(2);
  }
  const pending = (await admin.listLinks()).filter((l) => "pending" in l.status);
  console.log(`Wachtende koppelingen (${pending.length}):`);
  for (const l of pending) console.log(`  persoon #${l.personId} ${l.personName} · ${l.principal.toText()} · gekoppeld ${new Date(Number(l.linkedAt / 1_000_000n)).toLocaleString("nl-BE")}`);
  const mine = pending.filter((l) => String(l.personId) === target);
  const who = saved && saved.personId === target ? `${saved.name} (#${target})` : `persoon #${target}`;
  if (mine.length === 0) {
    console.log(`\nNiets bevestigd: van ${who} wacht nog geen koppeling. Heb je de code al ingevuld in de app?`);
    process.exit(1);
  }
  if (mine.length > 1) {
    console.log(`\nNiets bevestigd: ${who} heeft ${mine.length} wachtende koppelingen; dat is niet eenduidig. Bekijk ze in de app (Team).`);
    process.exit(1);
  }
  ok(await admin.confirmLink(mine[0].principal));
  console.log(`\n✓ bevestigd: ${mine[0].personName} (#${target}) · ${mine[0].principal.toText()}`);
} else {
  console.error(`onbekende opdracht: ${cmd}`);
  process.exit(2);
}
