// Rechten van stap 1.1 op een canister die al in gebruik is (een draft): de volledige rollentest vraagt
// een LEGE canister (opstartcode), deze proef niet. Gebruikt de testidentiteiten en werven (P-A, P-B)
// die tests/rollen.mjs daar eerder maakte, en laat testdata achter die met "Proef" begint (geen echte
// gegevens; bestandsverwijzingen zijn nepverwijzingen, zoals in de rollentest). Daarna: tests/lek.mjs.
//   node tests/werf-draft.mjs <canister-id>
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/werf-draft.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && "err" in r ? r.err : "");
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const opt = (v) => (v === undefined ? [] : [v]);

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A")?.id;
if (A === undefined) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs op deze canister");
check("versie 1.1 op de canister", (await admin.me()).version.startsWith("1.1"), (await admin.me()).version);

const cur = await calc.readContract(A);
check("calculator leest het contract van P-A (update-call)", isOk(cur), errOf(cur));
const v = isOk(cur) && cur.ok.inheritedFrom.length === 0 ? cur.ok.version : 0n;
const amount = 4_500_000n;
const input = { contract: { estimatedAmountCents: opt(amount), priceRevision: { none: null }, guarantee: { retention: null }, guaranteeBp: 500n, paymentTermDays: 30n, invoicingRhythm: { perProgress: null }, signedQuoteVersionId: [], note: "" }, clientContact: [], notes: "Proef" };
const s = await calc.setContract(A, input, v);
check("calculator bewaart contractparameters", isOk(s) || errOf(s) === "", errOf(s));
check("werfleider (zonder calculatorrol): contract geweigerd", await rejects(wl.readContract(A)));
check("werfleider: contract wijzigen geweigerd", await rejects(wl.setContract(A, input, 0n)));
for (const [n, x] of [["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc]]) {
  check(`${n}: contract geweigerd`, await rejects(x.readContract(A)));
}
const wA = await wl.getWork(A);
check("werfleider ziet de feiten (30bis ja), geen bedrag", wA.facts[0]?.art30bis[0] === true && !JSON.stringify(wA, big).includes(String(amount)), JSON.stringify(wA.facts, big));
check("externen: geen feiten", (await Promise.all([arch, oa2, klant, vc].map((x) => x.getWork(A)))).every((w) => w.facts.length === 0));

const ref = (h) => new TextEncoder().encode("!caf!sha256:" + h.repeat(64));
const fVg = await vc.addFile("proef-vgplan.pdf", "application/pdf", 2000n, ref("7"), [A], false);
const dVg = isOk(fVg) ? await vc.attachDocumentFile(A, "vgplan", [], fVg.ok) : fVg;
check("veiligheidscoördinator levert het VG-plan", isOk(dVg), errOf(dVg));
check("VC kan geen btw-attest leveren", await denied(vc.attachDocumentFile(A, "btw6-attest", [], fVg.ok)));
check("werfleider keurt het VG-plan goed", isOk(await wl.setDocumentStatus(dVg.ok, { approved: null }, "")));
check("klant ziet het VG-plan niet", !(await klant.getDossier(A)).documents.some((d) => d.kind === "vgplan"));
check("OA ziet het VG-plan wel", (await oa2.getDossier(A)).documents.some((d) => d.kind === "vgplan"));
const fCt = await calc.addFile("proef-contract.pdf", "application/pdf", 3000n, ref("8"), [A], true);
const dCt = await calc.attachDocumentFile(A, "contract", [], fCt.ok);
check("calculator hangt een vertrouwelijk contract aan de checklist", isOk(dCt), errOf(dCt));
check("werfleider ziet het contractdocument en -bestand niet", !(await wl.getDossier(A)).documents.some((d) => d.kind === "contract") && !(await wl.listFiles([A])).some((f) => f.id === fCt.ok));
const dAnd = await wl.saveDocument(A, { id: [], kind: "andere", title: "Proef weg", dueDay: [], validUntil: [], note: "", ownerOrgId: [] });
check("werfleider zet een document op de lijst en archiveert het", isOk(dAnd) && isOk(await wl.archiveDocument(dAnd.ok)));
check("OA kan geen documentstatus zetten", await rejects(oa2.setDocumentStatus(dVg.ok, { missing: null }, "")));
const log = await admin.auditLog(0n, 100n);
const chg = log.filter((e) => e.action === "vertrouwelijk-gewijzigd" && e.detail.startsWith("contract"));
check("auditlog: 'bekeek:contract' en wijziging zonder bedragen", log.some((e) => e.action === "bekeek:contract") && chg.every((e) => !e.detail.includes("4500000") && !e.detail.includes("45.000")));
check("auditlog zonder opslagverwijzing", !log.some((e) => e.detail.includes("!caf!")));
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
