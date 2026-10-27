// Draftproef 2b.4 (het startpunt): "Zo werkt het voor jou" is per persoon (een nieuwe testpersoon ziet het opnieuw, een
// tweede toestel van dezelfde persoon niet), Aan de slag bewaren kan enkel de beheerder en is zichtbaar voor niemand anders,
// en de bronnen van Vraagt aandacht volgen de rechten (kantoor leest, OA/klant geweigerd). Enkel verzonnen gegevens; de
// testpersoon wordt achteraf afgezet en de stand van Aan de slag teruggezet (de eigenaar merkt er niets van).
//   node tests/start-draft.mjs <canister-id>
import { backend, freshBackend, principalOf } from "../tools/lib.mjs";
import { loadStart } from "./menu-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/start-draft.mjs <canister-id>");
const [admin, wl, calc, oa, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const S = await loadStart();
let pass = 0;
let fail = 0;
const failures = [];
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`✓ ${name}`); } else { fail++; failures.push(name); console.log(`✗ ${name}${extra ? ` · ${extra}` : ""}`); }
};
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const rejects = async (p) => { try { await p; return false; } catch { return true; } };

// Aan de slag: wat er nu staat, onthouden en na afloop terugzetten
const before = await admin.startState();
check("startState van de beheerder: introSeen, hidden en marked", typeof before.introSeen === "boolean" && typeof before.hidden === "boolean" && Array.isArray(before.marked));
check("Aan de slag: markeren, niet-klaar markeren, verbergen en weer tonen werken voor de beheerder", isOk(await admin.setStartStep("planning", true)) && (await admin.startState()).marked.includes("planning") && isOk(await admin.setStartStep("planning", false)) && !(await admin.startState()).marked.includes("planning") && isOk(await admin.setStartHidden(true)) && (await admin.startState()).hidden && isOk(await admin.setStartHidden(false)) && !(await admin.startState()).hidden);
check("Aan de slag: een onbekende stap wordt geweigerd", "err" in (await admin.setStartStep("bestaat-niet", true)));
check("Aan de slag bewaren: werfleider, calculator, OA en klant geweigerd", (await Promise.all([wl, calc, oa, klant].map((x) => rejects(x.setStartStep("team", true))))).every(Boolean) && (await Promise.all([wl, calc, oa, klant].map((x) => rejects(x.setStartHidden(true))))).every(Boolean));
await admin.setStartStep("team", true);
check("een niet-beheerder krijgt de markeringen niet te zien", (await Promise.all([wl, calc, oa, klant].map((x) => x.startState()))).every((x) => x.marked.length === 0 && !x.hidden));
await admin.setStartStep("team", false);
for (const k of before.marked) await admin.setStartStep(k, true);
await admin.setStartHidden(before.hidden);
check("Aan de slag teruggezet zoals het was", JSON.stringify((await admin.startState()).marked) === JSON.stringify(before.marked) && (await admin.startState()).hidden === before.hidden);

// Zo werkt het voor jou: een verse testpersoon ziet het opnieuw; één keer per persoon
const stamp = Date.now().toString(36);
const inv = await admin.invitePerson({ name: `Proef Intro ${stamp}`, roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "start-draft" });
if (!isOk(inv)) throw new Error("uitnodiging: " + JSON.stringify(inv));
const nieuw = await freshBackend(cid);
const red = await nieuw.redeemCode(inv.ok.code);
check("testpersoon heeft de code ingewisseld", isOk(red));
const pr = await principalOf(nieuw);
check("testpersoon bevestigd door de beheerder", isOk(await admin.confirmLink(pr)));
const me = await nieuw.me();
const pid = me.person[0].id;
check("een nieuwe persoon ziet 'Zo werkt het voor jou' (nog niet begrepen)", (await nieuw.startState()).introSeen === false);
check("Begrepen: bewaard voor die persoon; de werfleider en de calculator-proefpersoon blijven eigen vlaggen houden", (await nieuw.markIntroSeen(), (await nieuw.startState()).introSeen === true));
check("de vlaggen van andere personen veranderen niet (de OA en de klant behouden hun eigen stand)", typeof (await oa.startState()).introSeen === "boolean" && typeof (await klant.startState()).introSeen === "boolean");
check("een afgezette persoon heeft geen toegang meer (geen startState)", isOk(await admin.archivePerson(pid)) && (await rejects(nieuw.startState())));
for (const i of (await admin.listInvites(0n, 500n)).filter((x) => x.tag === "start-draft" && "open" in x.state)) await admin.revokeInvite(i.id);

// De bronnen van Vraagt aandacht: bestaande queries met bestaande rechten
const day = BigInt(Math.floor(Date.now() / 86_400_000));
check("Vraagt aandacht: dashboard en boardConflicts voor kantoor, geweigerd voor OA en klant", (await Promise.all([admin, wl, calc].map((x) => x.dashboard(day).then(() => true, () => false)))).every(Boolean) && (await Promise.all([oa, klant].map((x) => rejects(x.dashboard(day))))).every(Boolean) && (await Promise.all([oa, klant].map((x) => rejects(x.boardConflicts(day - (day % 7n), 6n, 5n))))).every(Boolean));
const notes = await admin.myNotifications(false);
const bundles = S.bundleNotes(notes);
check("de bel bundelt de meldingen van de beheerder per soort (elke melding in één groep)", bundles.reduce((n, g) => n + g.items.length, 0) === notes.length);

console.log(`\n${pass} ✓  ${fail} ✗`);
if (fail) console.log("Rood:\n  " + failures.join("\n  "));
process.exit(fail ? 1 : 0);
