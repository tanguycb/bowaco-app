// Externe weergaven (1.7) op een canister die al in gebruik is (een draft). Gebruikt de testidentiteiten, P-A/P-B,
// "Proef Dak NV" en het proefverslag van tests/verslag-draft.mjs. Laat enkel testdata achter: de rechten "planning en
// uren bevestigen" voor Proef Dak NV op P-A, een bevestiging van de proefuren, de contactpersoon "Proef Contact 1.7"
// (zonder login; zijn uitnodigingscode wordt meteen weer ingetrokken: de proef laat niets bruikbaars achter, O-16).
// Opnieuw draaien mag.
//   node tests/extern-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/extern-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const today = BigInt(Math.floor(Date.now() / 86_400_000));

const [admin, wl, calc, arch, oa2, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1.7 of later op de canister", /^1\.([7-9]|1\d)/.test(me.version), me.version);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
const B = works.find((w) => w.code === "P-B")?.id;
const orgDak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
if (A === undefined || B === undefined || !orgDak) throw new Error("P-A/P-B of Proef Dak NV ontbreken");

// Rechten van Proef Dak NV op P-A (lid als firma): planning en uren bevestigen aan.
const memA = (await wl.listMembers(A)).find((m) => m.orgId[0] === orgDak.id && "onderaannemer" in m.role && m.endedAt.length === 0);
check("Proef Dak NV is als firma lid van P-A", !!memA);
check("calculator en OA zetten geen rechten", (await rejects(calc.setMemberGrants(memA.id, []))) && (await rejects(oa2.setMemberGrants(memA.id, []))));
check("werfleider zet 'planning en uren bevestigen' voor Proef Dak NV op P-A", isOk(await wl.setMemberGrants(memA.id, [{ confirmPlanning: null }, { confirmHours: null }])));
// Mijn uren en bevestigen
const hrs = await oa2.myHours(today - 60n, today + 1n);
const line = hrs.find((h) => h.workId === A && h.reportFinal);
check("Mijn uren (OA Dak): de proefuren uit het afgesloten proefverslag", !!line && line.canConfirm, JSON.stringify(hrs.map((h) => [h.workCode, String(h.day), h.reportFinal, h.canConfirm])));
if (line) {
  check("OA Dak bevestigt", isOk(await oa2.confirmHours(line.attendanceId, true, "")));
  check("de bevestiging staat bij de regel", (await oa2.myHours(today - 60n, today + 1n)).find((h) => h.attendanceId === line.attendanceId).confirmations.some((c) => c.ok));
  check("architect en klant bevestigen niet", (await rejects(arch.confirmHours(line.attendanceId, true, ""))) && (await rejects(klant.confirmHours(line.attendanceId, true, ""))));
}
// Mijn werven
const mw = await oa2.myWorks();
check("Mijn werven (OA Dak): P-A en P-B", mw.some((w) => w.id === A) && mw.some((w) => w.id === B));
check("Mijn werven van de calculator: leeg", (await calc.myWorks()).length === 0);
// Bestaande contactpersoon uitnodigen
const oaFiche = await admin.getOa(orgDak.id);
let cp = oaFiche.ok.persons.find((p) => p.name === "Proef Contact 1.7");
if (!cp) {
  const r = await admin.saveOaPerson(orgDak.id, { id: [], name: "Proef Contact 1.7", shortCode: [], phone: [], email: [], jobTitle: "ploegbaas (proef)", note: "" });
  check("contactpersoon zonder login in de OA-database", isOk(r), errOf(r));
  cp = r.ok;
}
check("OA en calculator nodigen niemand uit", (await denied(oa2.inviteExistingPerson({ personId: cp.id, workIds: [A], validDays: 1n, tag: "" }))) && (await denied(calc.inviteExistingPerson({ personId: cp.id, workIds: [A], validDays: 1n, tag: "" }))));
const inv = await wl.inviteExistingPerson({ personId: cp.id, workIds: [A], validDays: 1n, tag: "proef 1.7" });
check("werfleider nodigt de bestaande contactpersoon uit voor P-A (geen nieuwe persoon)", isOk(inv) && inv.ok.personId === cp.id, errOf(inv));
if (isOk(inv)) check("de proefcode wordt meteen ingetrokken (niets bruikbaars achterlaten)", isOk(await admin.revokeInvite(inv.ok.inviteId)));
check("de admin kreeg een melding van de uitnodiging", (await admin.myNotifications(false)).some((n) => n.kind === "uitnodiging" && n.text.includes("Proef Contact 1.7")));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
