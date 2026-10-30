// Werfadministratie (1b.4) op een canister die al in gebruik is (een draft). Gebruikt de testidentiteiten en P-B. Raakt
// enkel proeffirma's ("Proef …") en P-B: de inhoudingsplicht wordt enkel vastgelegd voor een proeffirma met een
// (verzonnen) KBO-nummer, nooit voor de echte firma's (E-0). Laat achter: de aangifte van P-B op "gedaan" met nummer
// PROEF-30BIS (+ het document in de checklist) en raadplegingen voor die proeffirma. Opnieuw draaien mag.
//   node tests/wadm-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/wadm-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const today = BigInt(Math.floor(Date.now() / 86_400_000));

const [admin, wl, calc, oa2, klant] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-oa2", "proef-klant"].map((n) => backend(n, cid)));
const me = await admin.me();
check("versie 1b.4 of later op de canister (ook 1b.3c = mail via Caffeine, na 1b.4)", /^1b\.([4-9]|3c)|^[2-9][b-z]?\./.test(me.version), me.version);
const A = (await admin.listWorks()).find((w) => w.code === "P-A")?.id;
const B = (await admin.listWorks()).find((w) => w.code === "P-B")?.id;
if (A === undefined || B === undefined) throw new Error("P-A/P-B ontbreken");
check("OA en klant lezen de werfadministratie niet", (await rejects(oa2.workAdmin(B))) && (await rejects(klant.workAdmin(A))));
const wa = await wl.workAdmin(B);
check("P-B: 30bis met reden, onderaannemers geteld, databank bijgewerkt", wa.reason.length > 0 && wa.oaCount >= 1n && wa.dbUpdated > 20_000n, JSON.stringify({ a: wa.art30bis, r: wa.reason, n: wa.oaCount }, big));
const dr = await wl.declarationDraft(B);
check("aangifte klaarzetten (werfleider): zonder bedrag, met portaal", isOk(dr) && dr.ok.amountCents.length === 0 && dr.ok.portal.includes("formica"), errOf(dr));
check("calculator zet de status niet", await denied(calc.saveDeclaration(B, { status: { todo: null }, nature: "eenmalig", asbestos: false, note: "" })));
const sd = await wl.saveDeclaration(B, { status: { done: { on: today, number: "PROEF-30BIS" } }, nature: "eenmalig", asbestos: false, note: "draftproef" });
check("aangifte P-B gedaan (proefnummer)", isOk(sd), errOf(sd));
check("checklist: document aangifte-30bis ontvangen", (await wl.getDossier(B)).documents.some((d) => d.kind === "aangifte-30bis" && "received" in d.status));
// Inhoudingsplicht: enkel een proeffirma met KBO
const proef = (await admin.listOrgs(false)).find((o) => o.name.startsWith("Proef") && o.kbo.length === 1 && "subcontractor" in o.kind);
if (proef) {
  const c = await wl.recordWithholdingCheck(proef.id, { result: { clear: null }, consultedOn: today, reference: "PROEF-REF", note: "draftproef", workId: [B] });
  check(`inhoudingsplicht vastgelegd voor ${proef.name} (proef): ok + link met KBO`, isOk(c) && c.ok.state === "ok" && c.ok.link[0].includes(proef.kbo[0]), errOf(c));
  check("OA legt niets vast", await denied(oa2.recordWithholdingCheck(proef.id, { result: { clear: null }, consultedOn: today, reference: "", note: "", workId: [] })));
} else {
  check("geen proeffirma met KBO op deze canister (inhoudingsplicht niet geproefd)", true);
}
const ce = await wl.checkinatworkExport(A, today - 60n, today);
check("Checkinatwork-export van P-A (aanwezigheden uit de verslagen van de proeven)", isOk(ce) && ce.ok.workCode === "P-A", `${ce.ok?.rows.length} regels`);
const ov = await calc.wadmOverview();
check("overzicht (calculator): P-B niet meer bij de openstaande aangiftes", !ov.declarations.some((d) => d.workId === B), `${ov.declarations.length} werven, ${ov.oas.length} OA's`);
check("regels (calculator leest): standaard", (await calc.wadmRules()).oaCountAlways >= 1n);
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
