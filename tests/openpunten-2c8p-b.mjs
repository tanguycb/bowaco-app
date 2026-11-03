// Open punten van 2c.2–2c.8, deel B: creditnota van een OA of leverancier, "Te betalen" voor alle aankoopfacturen (ook de OA-facturen
// van 2.11 met de stand betaald) en eigen schijven voor een aanvaarde meerwerkofferte (totaalrem M5, slot uit de min-meerstaat).
//   node tests/openpunten-2c8p-b.mjs <canister>
// B1 creditnota: geweigerd (negatief, te veel, andere firma, onbekende regel), wacht zolang ze niet goedgekeurd is, daarna Te betalen
//    omlaag (bedrag, korting en inhouding na de creditnota), de min-meerstaat omlaag (eigen sleutel, −hoeveelheid, niets dubbel),
//    verrekend bij de betaling; een creditnota na de betaling staat apart (negatief). Een voorschot vermindert; de factuur verbeteren of
//    intrekken kan niet meer zolang er een creditnota op staat.
// B2 2.11: een goedgekeurde OA-factuur (geen werfdeel) staat in Te betalen met haar vervaldag en inhouding; betaald markeren en terug.
// B3 meerwerkofferte: standaard één schijf van 100 % bij het akkoord, eigen schema, factuur, de slot uit de min-meerstaat trekt het
//    gefactureerde meerwerk af (Σ = aanneemsom + saldo), een meerwerkofferte die al in de slot zat: totaalrem blokkeert.
// B4 rechten per rol (werfleider, klant, OA, architect, VC, anoniem) en geen bedrag voor de werfleider.
// Enkel VERZONNEN gegevens: firma's "Proef … 2c8pb", gemeente Hoeveldam, postcode 9994.
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";

const cid = process.argv[2];
if (!cid) { console.log("geef een canister"); process.exit(1); }
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const kindOf = (v) => Object.keys(v)[0];
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const noMoney = (x) => ![...keysOf(x)].some((k) => /cents|price|cost|margin|amount|euro|total/i.test(k));
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const rd = (a, b) => (a >= 0n ? (2n * a + b) / (2n * b) : -((2n * -a + b) / (2n * b))); // half weg van nul (QuoteCalc.roundDiv)
const EXC = { exception: "Proef 2c8pb: verzonnen uitzondering voor de test" };

const [admin, calc, wl, arch, klant, vc, oa2] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc", "proef-oa2"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const vreemd = await freshBackend(cid);
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const today = (await admin.salesSettings()).today;

// ── Opzet: verkoopgegevens (als een vorige proef ze nog niet zette), firma's, een werf met getekende offerte, een afspraak ──
{
  const st = await admin.salesSettings();
  if (!st.issuer.name || !st.issuer.rpr) {
    const issuer = { name: "BOWACO (proef)", legalForm: "bv", address: { street: "Proefweg", number: "6", zip: "9994", city: "Hoeveldam", country: "BE" }, vat: "BE0123456749", kbo: "0123.456.749", rpr: "RPR Proefstad, afdeling Hoeveldam", email: "kantoor@proef.invalid", phone: "", website: "proef.invalid", iban: "BE49 9990 0000 0171", bic: "PROFBEBB" };
    ok(await admin.saveSalesSettings({ issuer, paymentDays: 15n, vat6Text: "", reverseText: "", creditText: "", paymentText: "", footerText: "Proef: algemene voorwaarden op aanvraag.", reminderText: "", reminderDays: 0n, issuerOnly: false, firstSeqF: 100n, firstSeqCN: 1n, planBp: [5000n, 2400n, 2600n], peppolScheme: "0208" }));
  }
}
const addr = { street: "Proefweg", number: "4", zip: "9994", city: "Hoeveldam", country: "BE" };
const KBO = (() => { const n = 10_000_000 + Math.floor(Math.random() * 89_999_999); const b = `0${String(n).slice(-7).padStart(7, "0")}`; return b.slice(0, 8) + String(97 - (Number(b.slice(0, 8)) % 97)).padStart(2, "0"); })();
const orgOf = async (name, kind = "subcontractor", kbo = []) => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo, vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proeffirma (2c8pb)" })).id;
const REIGER = await orgOf(`Proef Bouw Reiger 2c8pb ${sfx}`, "subcontractor", [KBO]);
const MEREL = await orgOf(`Proef Elektro Merel 2c8pb ${sfx}`);
const KLANTORG = await orgOf(`Proef Klant Spreeuw 2c8pb ${sfx}`, "client");
const WLID = (await wl.me()).person[0].id;
const W = ok(await admin.createWork({ code: `P-OB${sfx}`, name: "Proef open punten 2c8pb", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n })).id;
ok(await admin.setWorkStatus(W, { quoting: null }));
const price = (cost) => ({ cost, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null });
const q = ok(await calc.createQuote({ workId: W, number: `OB-${sfx}`, title: "Proef offerte 2c8pb" }));
{
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  M.setHeader(m, { clientOrgId: KLANTORG });
  const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
  M.addLine(m, c1.key, { title: "Proef afbraak 2c8pb", qtyMilli: 40_000n, unit: "m2", form: "fixed", price: price(2500n) });
  const c2 = M.addChapter(m, { code: "02", title: "Ruwbouw" });
  M.addLine(m, c2.key, { title: "Proef metselwerk 2c8pb", qtyMilli: 1_000n, unit: "sog", form: "fixed", price: price(800_000n) });
  const r = await saveAll(calc, m);
  if (r && "err" in r) throw new Error(errOf(r));
  const rq = ok(await calc.readQuoteVersion(q.versionId));
  ok(await calc.sendQuoteVersion(q.versionId, rq.version.rev, rq.totals.totalCents, "proef 2c8pb: waarschuwingen doorgezet"));
  ok(await calc.decideQuoteVersion(q.versionId, true, "proef 2c8pb: akkoord"));
}
const DEAL = ok(await calc.createDeal(W, REIGER)).id;
const FILE = ok(await calc.addFile("proef-aankoop-2c8pb.pdf", "application/pdf", 40_000n, fakeBlob("d"), [W], true));
check("(B0) opzet: firma's, werf met de klant en een getekende offerte, afspraak met Reiger, bijlage", typeof DEAL === "bigint" && typeof FILE === "bigint");

// Een regel en een aankoop zoals de browser ze stuurt.
const L = (kind, description, qty, unit, o = {}) => ({ workId: [o.w ?? W], kind, root: [], description, persons: [], qtyMilli: qty, unit: o.u ?? "", unitCents: unit, amountCents: o.amount ?? (qty * unit) / 1000n, passOn: o.passOn ?? false, days: [], lineId: o.lineId === undefined ? [] : [o.lineId] });
const P = (n, lines, o = {}) => {
  const net = lines.reduce((a, l) => a + l.amountCents, 0n);
  return { id: [], orgId: REIGER, kind: { oa: null }, number: `PB-${sfx}-${n}`, invoiceDay: today, dueDay: [today + 30n], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [FILE], oaStatementFileId: [], oaStatementRef: "", note: "proef 2c8pb", netCents: net, vatCents: 0n, totalCents: net, lines, finalWorkIds: [], creditOf: [], ...o };
};
const read = async (id) => ok(await calc.readPurchase(id));
const lineOf = (v, kind) => v.lines.find((l) => l.kind === kind);
const payRows = async () => ok(await calc.listPurchasesToPay());
const payOf = (rows, id) => rows.find((r) => un(r.brief)?.id === id);
const readMM = async () => ok(await calc.readMinMeer(W));
const rowOf = (v, key) => v.rows.find((r) => r.key === key);

// ── B1. Een OA-factuur, haar creditnota, Te betalen en de min-meerstaat ──
// Reiger: container 2 ton × € 95 en transport 4 u × € 55 (doorrekenen), regie 6 u × € 42; betaalkorting 1,5 % binnen 7 dagen.
const PA = ok(await calc.savePurchase(P("1", [L("container", "Proef container 2c8pb", 2_000n, 9500n, { u: "ton", passOn: true }), L("transport", "Proef transport 2c8pb", 4_000n, 5500n, { u: "uur", passOn: true }), L("regie", "Proef regie 2c8pb", 6_000n, 4200n, { u: "u" })], { discountUntil: [today + 7n], discountBp: [150n] }), 0n));
const NET = 19_000n + 22_000n + 25_200n;
// De raadpleging van de inhoudingsplicht is rood (RSZ): inhouding 35 % op het bedrag excl. btw.
const ref = `PROEF-ROOD-2C8PB-${sfx}`;
ok(await calc.recordWithholdingCheck(REIGER, { result: { social: null }, consultedOn: today, reference: ref, note: "proef 2c8pb", workId: [W] }));
const CHK = (await calc.withholdingHistory(REIGER)).filter((c) => c.reference === ref).reduce((a, c) => (c.id > a ? c.id : a), 0n);
let va = await read(PA);
{
  const part = ok(await calc.readOaInvoice(un(va.brief.works[0].partId)));
  ok(await calc.approveOaInvoice(part.brief.id, part.brief.rev, { check: CHK }, "proef 2c8pb: markeringen gezien"));
}
va = await read(PA);
const TR = lineOf(va, "transport");
const CO = lineOf(va, "container");
check("(B1) OA-factuur goedgekeurd (één werfdeel), inhouding RSZ 35 % = € 231,70", "approved" in va.brief.status && va.withholdSocialCents === rd(NET * 3500n, 10_000n), S([va.brief.status, va.withholdSocialCents]));
let rows = await payRows();
let ra = payOf(rows, PA);
const disc0 = rd(NET * 150n, 10_000n);
check("(B1) Te betalen vóór de creditnota: € 662 − 1,5 % korting − inhouding", !!ra && ra.payCents === NET - disc0 - rd(NET * 3500n, 10_000n) && ra.creditCents === 0n, S(ra));
const mm0 = await readMM();
const trRow = rowOf(mm0, `kost:${PA}:${TR.lineId}`);
const coRow = rowOf(mm0, `kost:${PA}:${CO.lineId}`);
check("(B1) min-meerstaat vóór de creditnota: transport en container doorgerekend (geteld)", !!trRow && !!coRow && trRow.counted && coRow.counted && trRow.extraCents > 0n, S([trRow?.extraCents, coRow?.extraCents]));

// Geweigerd: negatief, meer dan op de regel, onbekende regel, andere firma, regel twee keer, aftrek, meer dan de factuur.
const C = (n, lines, o = {}) => P(n, lines, { dueDay: [], creditOf: [PA], ...o });
const cTR = (qty, unit, o = {}) => L("transport", "Proef transport crediteren 2c8pb", qty, unit, { u: "uur", lineId: TR.lineId, ...o });
const cCO = (qty, unit, o = {}) => L("container", "Proef container crediteren 2c8pb", qty, unit, { u: "ton", lineId: CO.lineId, ...o });
check("(B1) creditnota met een negatieve regel of prijs: geweigerd (het teken volgt uit de creditnota)", /positieve/.test(errOf(await calc.savePurchase(C("CX1", [cTR(4_000n, -5500n)], { netCents: 22_000n, totalCents: 22_000n }), 0n))) && /positieve/.test(errOf(await calc.savePurchase(C("CX2", [cTR(-4_000n, 5500n)], { netCents: 22_000n, totalCents: 22_000n }), 0n))));
check("(B1) creditnota met negatieve bedragen in de kop: geweigerd", /positieve bedragen/.test(errOf(await calc.savePurchase(C("CX3", [cTR(1_000n, 5500n)], { netCents: -5_500n, totalCents: -5_500n }), 0n))));
check("(B1) meer crediteren dan op de regel staat: geweigerd", /hoogstens/.test(errOf(await calc.savePurchase(C("CX4", [cTR(5_000n, 5500n)]), 0n))));
check("(B1) een regel die niet op de factuur staat, of zonder regel-id: geweigerd", /niet op de factuur/.test(errOf(await calc.savePurchase(C("CX5", [cTR(1_000n, 5500n, { lineId: 999n })]), 0n))) && /crediteert een regel/.test(errOf(await calc.savePurchase(C("CX6", [L("transport", "x", 1_000n, 5500n, { u: "uur" })]), 0n))));
check("(B1) andere firma of een andere werf/soort dan de regel: geweigerd", /zelfde firma/.test(errOf(await calc.savePurchase(C("CX7", [cTR(1_000n, 5500n)], { orgId: MEREL }), 0n))) && /volgt werf, soort/.test(errOf(await calc.savePurchase(C("CX8", [{ ...cTR(1_000n, 5500n), kind: "diesel" }]), 0n))));
check("(B1) dezelfde regel twee keer, of een betaalkorting op een creditnota: geweigerd", /twee keer/.test(errOf(await calc.savePurchase(C("CX9", [cTR(1_000n, 5500n), cTR(1_000n, 5500n)]), 0n))) && /betaalkorting/.test(errOf(await calc.savePurchase(C("CXA", [cTR(1_000n, 5500n)], { discountUntil: [today + 3n], discountBp: [100n] }), 0n))));
check("(B1) een creditnota op een onbekende factuur of op een creditnota: geweigerd", /Onbekende factuur/.test(errOf(await calc.savePurchase(C("CXB", [cTR(1_000n, 5500n)], { creditOf: [999_999n] }), 0n))));

// De creditnota: transport volledig (€ 220) en 1 ton container (€ 95), positief zoals op het document.
const CN1 = ok(await calc.savePurchase(C("CN1", [cTR(4_000n, 5500n), cCO(1_000n, 9500n)]), 0n));
const CRED = 22_000n + 9_500n;
let vc1 = await read(CN1);
va = await read(PA);
check("(B1) creditnota geregistreerd: geen werfdelen (goedkeuren in de aankoop zelf), verwijst naar de factuur, regels positief", "registered" in vc1.brief.status && un(vc1.brief.creditOf) === PA && vc1.brief.creditOfNumber === va.brief.number && vc1.brief.works.every((w) => un(w.partId) === null) && vc1.canDecide && vc1.lines.every((l) => l.amountCents > 0n && l.qtyMilli > 0n), S(vc1.brief));
check("(B1) de factuur toont de creditnota en per regel wat gecrediteerd is; verbeteren kan niet meer", va.credits.length === 1 && va.credits[0].id === CN1 && lineOf(va, "transport").creditedCents === 22_000n && lineOf(va, "container").creditedCents === 9_500n && !va.canEdit, S(va.credits));
check("(B1) een tweede creditnota op het al gecrediteerde transport: geweigerd (hoogstens € 0,00)", /hoogstens € 0,00/.test(errOf(await calc.savePurchase(C("CX10", [cTR(1_000n, 5500n)]), 0n))));
{
  const mm = await readMM();
  const c1 = rowOf(mm, `kost:${CN1}:${TR.lineId}`);
  check("(B1) zolang de creditnota niet goedgekeurd is: in de min-meerstaat 'wacht' (telt niet), totalen ongewijzigd", !!c1 && !c1.counted && c1.flags.includes("factuur-niet-goedgekeurd") && mm.totals.extraCents === mm0.totals.extraCents, S([c1?.flags, mm.totals.extraCents, mm0.totals.extraCents]));
  ra = payOf(await payRows(), PA);
  check("(B1) Te betalen: nog het volle bedrag, gemarkeerd 'creditnota nog niet goedgekeurd'", ra.payCents === NET - disc0 - rd(NET * 3500n, 10_000n) && ra.warnings.includes("creditnota-open"), S(ra.warnings));
}
ok(await calc.approvePurchase(CN1, vc1.brief.rev, "proef 2c8pb: creditnota van Reiger"));
vc1 = await read(CN1);
va = await read(PA);
{
  const rest = NET - CRED;
  const wh = rd(rest * 3500n, 10_000n);
  const dsc = rd(rest * 150n, 10_000n);
  rows = await payRows();
  ra = payOf(rows, PA);
  check("(B1) creditnota goedgekeurd: Te betalen gaat omlaag (excl. btw € 662 − € 315; korting en inhouding op het rest)", !!ra && ra.creditCents === CRED && ra.netCents === rest && ra.discountCents[0] === dsc && ra.withholdCents === wh && ra.payCents === NET - CRED - dsc - wh && ra.credits.includes(vc1.brief.number) && /creditnota/.test(ra.text), S(ra));
  check("(B1) de creditnota staat niet apart in Te betalen zolang haar factuur open is (ze gaat er af)", !payOf(rows, CN1));
  check("(B1) de inhouding van de factuur volgt het bedrag na de creditnota (35 % van € 347)", va.withholdSocialCents === wh, S(va.withholdSocialCents));
  const mm = await readMM();
  const c1 = rowOf(mm, `kost:${CN1}:${TR.lineId}`);
  const c2 = rowOf(mm, `kost:${CN1}:${CO.lineId}`);
  const t0 = rowOf(mm, `kost:${PA}:${TR.lineId}`);
  const k0 = rowOf(mm, `kost:${PA}:${CO.lineId}`);
  check("(B1) min-meerstaat: de creditnota als eigen regels (−hoeveelheid, prijs positief), geteld", !!c1 && !!c2 && c1.counted && c2.counted && c1.qtyMilli === -4_000n && c1.unitCents > 0n && c2.qtyMilli === -1_000n, S([c1?.qtyMilli, c1?.unitCents, c2?.qtyMilli]));
  check("(B1) transport volledig gecrediteerd: factuur + creditnota = 0; container voor de helft", c1.extraCents === -t0.extraCents && 2n * c2.extraCents === -k0.extraCents, S([c1.extraCents, t0.extraCents, c2.extraCents, k0.extraCents]));
  check("(B1) het meerwerk gaat exact zoveel omlaag als de creditnota doorrekent (niets dubbel, geen sleutel twee keer)", mm.totals.extraCents === mm0.totals.extraCents + c1.extraCents + c2.extraCents && new Set(mm.rows.map((r) => r.key)).size === mm.rows.length, S([mm.totals.extraCents, mm0.totals.extraCents]));
  const costs = ok(await calc.purchaseCosts(W));
  check("(B1) Doorrekenen aan de klant: de regels van de creditnota negatief", costs.some((x) => x.purchaseId === CN1 && x.costCents === -22_000n) && costs.some((x) => x.purchaseId === CN1 && x.costCents === -9_500n), S(costs.filter((x) => x.purchaseId === CN1).map((x) => x.costCents)));
}
// Betaald: de creditnota is verrekend (dezelfde dag); niet betaald → terug open.
check("(B1) de creditnota apart betaald markeren zolang de factuur open is: geweigerd", /markeer die factuur/.test(errOf(await calc.markPurchasePaid(CN1, vc1.brief.rev, [today], []))));
ok(await calc.markPurchasePaid(PA, va.brief.rev, [today], []));
vc1 = await read(CN1);
check("(B1) factuur betaald: de creditnota is verrekend (betaald op dezelfde dag)", un(vc1.brief.paidDay) === today, S(vc1.brief.paidDay));
va = await read(PA);
ok(await calc.markPurchasePaid(PA, va.brief.rev, [], []));
vc1 = await read(CN1);
check("(B1) de betaling ongedaan: de verrekende creditnota staat terug open", un(vc1.brief.paidDay) === null);
va = await read(PA);
ok(await calc.markPurchasePaid(PA, va.brief.rev, [today], [today]));
check("(B1) betaald en inhouding doorgestort: factuur en creditnota uit Te betalen", !payOf(await payRows(), PA) && !payOf(await payRows(), CN1));
// Een creditnota NA de betaling: apart, negatief (te verrekenen of terug te krijgen), dan betaald markeren.
const CN2 = ok(await calc.savePurchase(C("CN2", [cCO(1_000n, 9500n)]), 0n));
ok(await calc.approvePurchase(CN2, (await read(CN2)).brief.rev, "proef 2c8pb"));
{
  const r2 = payOf(await payRows(), CN2);
  check("(B1) creditnota op een betaalde factuur: apart in Te betalen, negatief (€ −95), gemarkeerd 'creditnota'", !!r2 && r2.payCents === -9_500n && r2.warnings.includes("creditnota") && /al betaald/.test(r2.text), S(r2));
  ok(await calc.markPurchasePaid(CN2, (await read(CN2)).brief.rev, [today], []));
  check("(B1) de creditnota verrekend markeren: uit Te betalen", !payOf(await payRows(), CN2));
  check("(B1) alles gecrediteerd wat kon: een creditnota op de container (rest € 0) geweigerd", /hoogstens € 0,00/.test(errOf(await calc.savePurchase(C("CX11", [cCO(1_000n, 1n, { amount: 1n })]), 0n))));
}
// Een voorschotfactuur en haar creditnota: het voorschot vermindert; de voorschotfactuur verbeteren of intrekken kan niet meer.
const PV = ok(await calc.savePurchase(P("V", [L("voorschot", "Proef voorschot 2c8pb", 1_000n, 50_000n)]), 0n));
check("(B1) review M3: een creditnota op een nog niet goedgekeurde factuur: geweigerd", /goedgekeurde factuur/.test(errOf(await calc.savePurchase(P("CNV0", [L("voorschot", "x", 1_000n, 1_000n, { lineId: lineOf(await read(PV), "voorschot").lineId })], { dueDay: [], creditOf: [PV] }), 0n))));
{
  const part = ok(await calc.readOaInvoice(un((await read(PV)).brief.works[0].partId)));
  ok(await calc.approveOaInvoice(part.brief.id, part.brief.rev, { check: CHK }, "proef 2c8pb: voorschot goedgekeurd"));
}
const vv = await read(PV);
const advW = (v) => v.advances.find((a) => a.workId === W);
check("(B1) voorschotfactuur: voorschot € 500 op de werf", advW(vv)?.advancedCents === 50_000n, S(vv.advances));
const CN3 = ok(await calc.savePurchase(P("CN3", [L("voorschot", "Proef voorschot crediteren 2c8pb", 1_000n, 20_000n, { lineId: lineOf(vv, "voorschot").lineId })], { dueDay: [], creditOf: [PV] }), 0n));
check("(B1) creditnota op het voorschot (€ 200): het voorschot wordt € 300", advW(await read(PV))?.advancedCents === 30_000n && advW(await read(PV))?.restCents === 30_000n, S((await read(PV)).advances));
check("(B1) de voorschotfactuur verbeteren of intrekken met een creditnota erop: geweigerd", /creditnota/.test(errOf(await calc.savePurchase({ ...P("V", [L("voorschot", "x", 1_000n, 50_000n)]), id: [PV] }, vv.brief.rev))) && /trek eerst de creditnota in/.test(errOf(await calc.withdrawPurchase(PV, vv.brief.rev, "proef 2c8pb: intrekken"))));
{
  // Review L2: een volgende factuur trekt de rest van het voorschot af (€ 300); daarna is er niets meer te crediteren op het voorschot.
  const PD = ok(await calc.savePurchase(P("D", [L("transport", "Proef transport na voorschot 2c8pb", 1_000n, 40_000n, { u: "uur" }), L("aftrek-voorschot", "Proef aftrek voorschot 2c8pb", 1_000n, -30_000n)]), 0n));
  check("(B1) review L2: voorschot volledig afgetrokken: een creditnota op het voorschot (€ 1) geweigerd (de rest is al afgetrokken)", /al afgetrokken/.test(errOf(await calc.savePurchase(P("CN4", [L("voorschot", "x", 1_000n, 100n, { lineId: lineOf(vv, "voorschot").lineId })], { dueDay: [], creditOf: [PV] }), 0n))), S((await read(PV)).advances));
  ok(await calc.withdrawPurchase(PD, (await read(PD)).brief.rev, "proef 2c8pb: aftrek weg"));
}
ok(await calc.withdrawPurchase(CN3, (await read(CN3)).brief.rev, "proef 2c8pb: creditnota weg"));
check("(B1) de creditnota ingetrokken: het voorschot is terug € 500", advW(await read(PV))?.advancedCents === 50_000n);

// ── B2. Een OA-factuur van 2.11 (geen werfdeel) in Te betalen, met de stand betaald ──
const oaIn = (n, cents) => ({ id: [], orgId: MEREL, workId: W, number: `PF-${sfx}-${n}`, invoiceDay: today, dueDay: [today + 20n], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [FILE], note: "proef 2c8pb", netCents: cents, vatCents: 0n, totalCents: cents, lines: [{ kind: { other: null }, root: [], description: "Proef andere kost 2c8pb", qtyMilli: 1_000n, unitCents: cents, amountCents: cents }] });
const F1 = ok(await calc.saveOaInvoice(oaIn("1", 30_000n), 0n));
const oaRow = (rs, id) => rs.find((r) => un(r.oaInvoice)?.id === id);
check("(B2) een geregistreerde (niet goedgekeurde) OA-factuur van 2.11 staat niet in Te betalen", !oaRow(await payRows(), F1));
{
  const f = ok(await calc.readOaInvoice(F1));
  ok(await calc.approveOaInvoice(F1, f.brief.rev, EXC, "proef 2c8pb: goedgekeurd"));
}
rows = await payRows();
let r1 = oaRow(rows, F1);
check("(B2) goedgekeurd: in Te betalen met de vervaldag, het bedrag en zonder inhouding (uitzondering)", !!r1 && r1.payCents === 30_000n && un(r1.dueDay) === today + 20n && r1.withholdCents === 0n && /vervalt op/.test(r1.text) && un(r1.brief) === null, S(r1));
check("(B2) een werfdeel van een aankoopfactuur staat er niet als OA-factuur van 2.11 (geen dubbel)", !rows.some((r) => un(r.oaInvoice)?.purchaseId?.length));
check("(B2) betaald markeren in de toekomst, met een inhouding die er niet is, of een werfdeel: geweigerd", /Betaaldag/.test(errOf(await calc.markOaInvoicePaid(F1, un(r1.oaInvoice).rev, [today + 10n], []))) && /geen inhouding/.test(errOf(await calc.markOaInvoicePaid(F1, un(r1.oaInvoice).rev, [today], [today]))) && /werfdeel/.test(errOf(await calc.markOaInvoicePaid(un(va.brief.works[0].partId), 0n, [today], []))));
ok(await calc.markOaInvoicePaid(F1, un(r1.oaInvoice).rev, [today], []));
check("(B2) betaald: uit Te betalen; auditregel oa-factuur-betaald", !oaRow(await payRows(), F1) && (await admin.auditLog(0n, 20n)).some((a) => a.action === "oa-factuur-betaald"));
{
  const f = ok(await calc.readOaInvoice(F1));
  ok(await calc.markOaInvoicePaid(F1, f.brief.rev, [], []));
  check("(B2) niet meer betaald: terug in Te betalen", !!oaRow(await payRows(), F1));
  check("(B2) een oude versie (rev) betaald markeren: geweigerd", /laad opnieuw/.test(errOf(await calc.markOaInvoicePaid(F1, f.brief.rev, [today], []))));
}
// Met de inhoudingsplicht (rood): te betalen zonder de inhouding, gemarkeerd tot ze doorgestort is.
const F2 = ok(await calc.saveOaInvoice({ ...oaIn("2", 40_000n), orgId: REIGER }, 0n));
ok(await calc.approveOaInvoice(F2, ok(await calc.readOaInvoice(F2)).brief.rev, { check: CHK }, "proef 2c8pb: inhoudingsplicht rood"));
let r2 = oaRow(await payRows(), F2);
check("(B2) met inhouding (RSZ 35 % van € 400 = € 140): te betalen € 260, gemarkeerd 'inhouding'", !!r2 && r2.withholdCents === 14_000n && r2.payCents === 26_000n && r2.warnings.includes("inhouding"), S(r2));
ok(await calc.markOaInvoicePaid(F2, un(r2.oaInvoice).rev, [today], []));
r2 = oaRow(await payRows(), F2);
check("(B2) betaald, inhouding nog niet doorgestort: blijft in de lijst", !!r2 && un(r2.paidDay) === today && /betaald op/.test(r2.text));
ok(await calc.markOaInvoicePaid(F2, un(r2.oaInvoice).rev, [today], [today]));
check("(B2) inhouding doorgestort: uit de lijst", !oaRow(await payRows(), F2));
{
  const f = ok(await calc.readOaInvoice(F1));
  ok(await calc.markOaInvoicePaid(F1, f.brief.rev, [today], []));
}

// ── B5. Herstel na de review (M1 override, M2 inhouding en verrekenen, M3 vastlopen, L1) ──
const approveParts = async (id, why) => { for (const w of (await read(id)).brief.works) { const pt = ok(await calc.readOaInvoice(un(w.partId))); ok(await calc.approveOaInvoice(pt.brief.id, pt.brief.rev, { check: CHK }, why)); } };
const CR = (n, orig, lines, o = {}) => P(n, lines, { dueDay: [], creditOf: [orig], ...o });
// M2: factuur € 10.000 (inhouding RSZ 35 % = € 3.500), betaald; daarna een creditnota van € 2.000.
const PM2 = ok(await calc.savePurchase(P("M2", [L("container", "Proef container M2 2c8pb", 1_000n, 1_000_000n, { u: "ton" })]), 0n));
await approveParts(PM2, "proef 2c8pb: M2");
let vm2 = await read(PM2);
const X2 = lineOf(vm2, "container");
ok(await calc.markPurchasePaid(PM2, vm2.brief.rev, [today], []));
const CM2 = ok(await calc.savePurchase(CR("CM2", PM2, [L("container", "Proef container M2 crediteren", 1_000n, 200_000n, { u: "ton", lineId: X2.lineId })]), 0n));
ok(await calc.approvePurchase(CM2, (await read(CM2)).brief.rev, "proef 2c8pb: creditnota M2"));
{
  const rs = await payRows();
  const ro = payOf(rs, PM2);
  const rc = payOf(rs, CM2);
  vm2 = await read(PM2);
  check("(B5) review M2: betaald, daarna een creditnota van € 2.000: de factuur trekt ze niet af (€ 10.000), ze staat apart (€ −2.000): één keer", !!ro && !!rc && ro.creditCents === 0n && ro.totalCents === 1_000_000n && rc.payCents === -200_000n, S([ro, rc]));
  check("(B5) review M2: de inhouding blijft die van bij de betaling (€ 3.500), in Te betalen en op de factuur", ro.withholdCents === 350_000n && vm2.withholdSocialCents === 350_000n, S([ro.withholdCents, vm2.withholdSocialCents]));
  ok(await calc.markPurchasePaid(CM2, (await read(CM2)).brief.rev, [today], []));
  vm2 = await read(PM2);
  ok(await calc.markPurchasePaid(PM2, vm2.brief.rev, [], []));
  const ro2 = payOf(await payRows(), PM2);
  check("(B5) review M2: de betaling ongedaan: de apart verrekende creditnota gaat er niet opnieuw af (nog € 10.000), ze blijft verrekend", !!ro2 && ro2.creditCents === 0n && ro2.totalCents === 1_000_000n && un((await read(CM2)).brief.paidDay) === today, S(ro2));
  check("(B5) review M2: een creditnota die met de betaling verrekend werd, markeer je niet apart", /verrekend met de betaling/.test(errOf(await calc.markPurchasePaid(CN1, (await read(CN1)).brief.rev, [], []))));
}
// M3: betwisten met een creditnota erop geweigerd; een goedgekeurde, niet verrekende creditnota intrekken mag; een verrekende niet.
{
  const part = un((await read(PM2)).brief.works[0].partId);
  check("(B5) review M3: de factuur (werfdeel) betwisten met een creditnota erop: 'trek eerst de creditnota in'", /trek eerst de creditnota in/.test(errOf(await calc.disputeOaInvoice(part, 0n, "proef 2c8pb: betwisten"))));
  check("(B5) review M3: een creditnota die verrekend is (met de betaling of apart): intrekken geweigerd", /al verrekend/.test(errOf(await calc.withdrawPurchase(CN1, (await read(CN1)).brief.rev, "proef 2c8pb"))) && /al verrekend/.test(errOf(await calc.withdrawPurchase(CM2, (await read(CM2)).brief.rev, "proef 2c8pb"))));
  const CM3 = ok(await calc.savePurchase(CR("CM3", PM2, [L("container", "Proef container M3 crediteren", 1_000n, 50_000n, { u: "ton", lineId: X2.lineId })]), 0n));
  ok(await calc.approvePurchase(CM3, (await read(CM3)).brief.rev, "proef 2c8pb: creditnota M3"));
  const w3 = await calc.withdrawPurchase(CM3, (await read(CM3)).brief.rev, "proef 2c8pb: creditnota fout");
  check("(B5) review M3: een goedgekeurde creditnota die nog niet verrekend is: intrekken kan", isOk(w3) && "withdrawn" in (await read(CM3)).brief.status, errOf(w3));
}
{
  const PL = ok(await calc.savePurchase(P("L1", [L("container", "Proef container L1 2c8pb", 1_000n, 50_000n, { u: "ton" }), L("materiaal", "Proef korting L1 2c8pb", -1_000n, 5_000n, { u: "st" })]), 0n));
  await approveParts(PL, "proef 2c8pb: L1");
  const ml = lineOf(await read(PL), "materiaal");
  check("(B5) review L1: een regel met een bedrag van 0 of minder (korting) crediteren: geweigerd", ml.amountCents === -5_000n && /geen positief bedrag/.test(errOf(await calc.savePurchase(CR("CL1", PL, [L("materiaal", "x", 1_000n, 5_000n, { u: "st", lineId: ml.lineId })]), 0n))), S(ml.amountCents));
}

// M1: de creditnota volgt de aanpassing van de gecrediteerde regel in de min-meerstaat (uitsluiten, hoofdstuk, doorrekenen).
{
  const PMM = ok(await calc.savePurchase(P("M1", [L("container", "Proef container M1 2c8pb", 1_000n, 10_000n, { u: "ton", passOn: true }), L("transport", "Proef transport M1 2c8pb", 2_000n, 5_000n, { u: "uur" })]), 0n));
  await approveParts(PMM, "proef 2c8pb: M1");
  const vm = await read(PMM);
  const X = lineOf(vm, "container");
  const Y = lineOf(vm, "transport");
  const KX = `kost:${PMM}:${X.lineId}`;
  const KY = `kost:${PMM}:${Y.lineId}`;
  let m = await readMM();
  check("(B5) review M1: een kost die niet doorgerekend wordt, staat in de min-meerstaat als 'niet doorgerekend' (telt niet)", !!rowOf(m, KY) && !rowOf(m, KY).counted && rowOf(m, KY).flags.includes("niet-doorgerekend") && rowOf(m, KX)?.counted, S(rowOf(m, KY)?.flags));
  ok(await calc.setMinMeerOverride(W, { key: KX, exclude: true, chapter: [], passOn: false, reason: "proef 2c8pb: container niet voor de klant" }));
  ok(await calc.setMinMeerOverride(W, { key: KY, exclude: false, chapter: ["Proef kosten 2c8pb"], passOn: true, reason: "proef 2c8pb: transport toch voor de klant" }));
  m = await readMM();
  const before = m.totals.extraCents;
  const yRow = rowOf(m, KY);
  check("(B5) review M1: X uitgesloten, Y doorgerekend naar een eigen hoofdstuk", rowOf(m, KX).excluded && !rowOf(m, KX).counted && yRow.counted && yRow.chapter === "Proef kosten 2c8pb", S([rowOf(m, KX).flags, yRow.chapter]));
  const CMM = ok(await calc.savePurchase(CR("CM1", PMM, [L("container", "Proef container M1 crediteren", 1_000n, 10_000n, { u: "ton", lineId: X.lineId }), L("transport", "Proef transport M1 crediteren", 1_000n, 5_000n, { u: "uur", lineId: Y.lineId })]), 0n));
  ok(await calc.approvePurchase(CMM, (await read(CMM)).brief.rev, "proef 2c8pb: creditnota M1"));
  m = await readMM();
  const cx = rowOf(m, `kost:${CMM}:${X.lineId}`);
  const cy = rowOf(m, `kost:${CMM}:${Y.lineId}`);
  check("(B5) review M1: creditnota op de uitgesloten regel X: ook uitgesloten, de min-meerstaat verandert daardoor niet", !!cx && cx.excluded && !cx.counted && !cx.inVersion, S(cx?.flags));
  check("(B5) review M1: creditnota op Y (kantoor zette doorrekenen aan): ook doorgerekend, in hetzelfde hoofdstuk, de helft van Y eraf", !!cy && cy.counted && cy.passOn && cy.chapter === "Proef kosten 2c8pb" && 2n * cy.extraCents === -yRow.extraCents && m.totals.extraCents === before + cy.extraCents, S([cy?.extraCents, yRow.extraCents, m.totals.extraCents, before]));
  check("(B5) review M1: een regel van een creditnota pas je niet zelf aan (ze volgt de gecrediteerde regel)", /kan niet aangepast/.test(errOf(await calc.setMinMeerOverride(W, { key: `kost:${CMM}:${Y.lineId}`, exclude: true, chapter: [], passOn: false, reason: "proef 2c8pb" }))) && !cy.overridable);
  ok(await calc.setMinMeerOverride(W, { key: KX, exclude: false, chapter: [], passOn: false, reason: "proef 2c8pb: terug" }));
  m = await readMM();
  check("(B5) review M1: de uitsluiting van X weg: X en zijn creditnota tellen weer (samen 0)", rowOf(m, KX).counted && rowOf(m, `kost:${CMM}:${X.lineId}`).counted && rowOf(m, KX).extraCents + rowOf(m, `kost:${CMM}:${X.lineId}`).extraCents === 0n);
}

// ── B3. Eigen schijven voor een aanvaarde meerwerkofferte ──
const rawEntry = (o) => ({ kind: { extra: null }, chapter: "02 Ruwbouw", root: [], description: "Proef regel 2c8pb", unit: "st", qtyMilli: 1000n, pctBp: [], day: [], approval: { pending: null }, photoFileId: [], note: "", price: [{ unitCents: [], costCents: [], marginBp: [], orgId: [], ...o.p }], ...o.e });
const extraQuote = async (desc, cents) => {
  const E = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ e: { description: desc }, p: { unitCents: [cents] } })));
  const MQ = ok(await calc.makeExtraWorkQuote(W, [E], `Proef meerwerk 2c8pb ${desc}`));
  const rq = ok(await calc.readQuoteVersion(MQ.versionId));
  ok(await calc.sendQuoteVersion(MQ.versionId, rq.version.rev, rq.totals.totalCents, "proef 2c8pb: meerwerkofferte"));
  return MQ;
};
const MQ1 = await extraQuote("Proef extra trap 2c8pb", 150_000n);
check("(B3) een verstuurde, nog niet aanvaarde meerwerkofferte: nog geen eigen schijven", ok(await calc.readSalesPlan(W)).extraWork.length === 0);
const due0 = (await calc.listWorkStages()).find((s) => s.workId === W)?.next?.salesDue ?? 0n;
ok(await calc.decideQuoteVersion(MQ1.versionId, true, "proef 2c8pb: akkoord meerwerk"));
let pl = ok(await calc.readSalesPlan(W));
let x1 = pl.extraWork.find((x) => x.quoteId === MQ1.quoteId);
const K1 = `mw${MQ1.quoteId}-akkoord`;
check("(B3) aanvaard: standaard één schijf van 100 % op de dag van het akkoord van de klant, op het subtotaal van de meerwerkofferte (€ 1.500)", !!x1 && !x1.stored && x1.steps.length === 1 && x1.steps[0].key === K1 && x1.steps[0].pctBp === 10_000n && kindOf(x1.steps[0].when) === "onDay" && x1.steps[0].when.onDay === x1.acceptedDay && x1.steps[0].stepCents === 150_000n && x1.contractCents === 150_000n && un(x1.steps[0].dueDay) === x1.acceptedDay && x1.baseOk, S(x1));
check("(B3) het schema van de getekende offerte blijft 50/24/26 (zonder de meerwerkschijf)", pl.steps.map((s) => s.pctBp).join() === "5000,2400,2600" && !pl.steps.some((s) => s.key.startsWith("mw")));
{
  const wk = ok(await calc.salesWorklist());
  check("(B3) Te factureren (werklijst): de meerwerkschijf staat er, nu te factureren", wk.due.some((d) => d.workId === W && d.stepKey === K1 && d.now && d.stepCents === 150_000n), S(wk.due.filter((d) => d.workId === W).map((d) => d.stepKey)));
  const nx = (await calc.listWorkStages()).find((s) => s.workId === W)?.next;
  const nw = (await wl.listWorkStages()).find((s) => s.workId === W)?.next;
  check("(B3) kaart Volgende stap: de meerwerkschijf telt mee bij de schijven te factureren (kantoor); de werfleider ziet er geen", !!nx && nx.salesDue === due0 + 1n && (!nw || nw.salesDue === 0n), S([due0, nx?.salesDue, nw?.salesDue]));
}
// Eigen schema bewaren: geweigerd zonder het voorvoegsel, met een schijf vóór de start of samen ≠ 100 %.
const stp = (key, title, pctBp, when) => ({ key, title, pctBp, when, chapterPct: [] });
check("(B3) eigen schijven: sleutel zonder mw<offerte>-, 'vóór de start' of samen 90 %: geweigerd", /begint met/.test(errOf(await calc.saveSalesExtraPlan(W, MQ1.quoteId, pl.version, [stp("schijf-1", "Meerwerk", 10_000n, { onDay: x1.acceptedDay })]))) && /op een dag \(standaard de dag van het akkoord\) of met de hand/.test(errOf(await calc.saveSalesExtraPlan(W, MQ1.quoteId, pl.version, [stp(K1, "Meerwerk", 10_000n, { beforeStart: null })]))) && /in plaats van 100 %/.test(errOf(await calc.saveSalesExtraPlan(W, MQ1.quoteId, pl.version, [stp(K1, "Meerwerk", 9_000n, { onDay: x1.acceptedDay })]))));
check("(B3) een sleutel mw… in het schema van de getekende offerte: geweigerd", /meerwerkofferte/.test(errOf(await calc.saveSalesPlan(W, pl.version, [...pl.steps.map((s) => ({ key: s.key, title: s.title, pctBp: s.pctBp, when: s.when, chapterPct: s.chapterPct })).slice(0, 2), stp("mw1-x", "Slot", 2_600n, { final: null })]))));
pl = ok(await calc.saveSalesExtraPlan(W, MQ1.quoteId, pl.version, [stp(K1, "Meerwerk bij akkoord", 3_000n, { onDay: x1.acceptedDay }), stp(`mw${MQ1.quoteId}-rest`, "Meerwerk rest", 7_000n, { byHand: null })]));
x1 = pl.extraWork.find((x) => x.quoteId === MQ1.quoteId);
check("(B3) twee eigen schijven 30/70: bewaard, de laatste neemt de rest (Σ = € 1.500)", x1.stored && x1.steps.length === 2 && x1.steps[0].stepCents + x1.steps[1].stepCents === 150_000n && x1.steps[0].stepCents === 45_000n, S(x1.steps.map((s) => s.stepCents)));
{
  // Review L4: het eerste meerwerkschema bevriest het standaardschema niet: dat volgt de instellingen tot kantoor het zelf bewaart.
  const st = await admin.salesSettings();
  const inp = (bp) => ({ issuer: st.issuer, paymentDays: st.paymentDays, vat6Text: st.vat6Text, reverseText: st.reverseText, creditText: st.creditText, paymentText: st.paymentText, footerText: st.footerText, reminderText: st.reminderText, reminderDays: st.reminderDays, issuerOnly: st.issuerOnly, firstSeqF: st.firstSeqF, firstSeqCN: st.firstSeqCN, planBp: bp, peppolScheme: st.peppolScheme });
  ok(await admin.saveSalesSettings(inp([4_000n, 3_000n, 3_000n])));
  const p2 = ok(await calc.readSalesPlan(W));
  ok(await admin.saveSalesSettings(inp(st.planBp)));
  const p3 = ok(await calc.readSalesPlan(W));
  check("(B3) review L4: na een eigen meerwerkschema volgt het schema van de getekende offerte nog de instellingen (40/30/30, terug 50/24/26)", p2.steps.map((s) => s.pctBp).join() === "4000,3000,3000" && p3.steps.map((s) => s.pctBp).join() === st.planBp.join() && p3.extraWork.find((x) => x.quoteId === MQ1.quoteId)?.steps.length === 2, S([p2.steps.map((s) => s.pctBp), p3.steps.map((s) => s.pctBp)]));
  pl = p3;
}
pl = ok(await calc.saveSalesExtraPlan(W, MQ1.quoteId, pl.version, [stp(K1, "Meerwerk bij akkoord", 10_000n, { onDay: x1.acceptedDay })]));
pl = ok(await calc.saveSalesPlan(W, pl.version, pl.steps.map((s) => ({ key: s.key, title: s.title, pctBp: s.pctBp, when: s.when, chapterPct: s.chapterPct }))));
x1 = pl.extraWork.find((x) => x.quoteId === MQ1.quoteId);
check("(B3) terug naar één schijf van 100 %; het schema van de getekende offerte bewaren laat de meerwerkschijf staan", x1.stored && x1.steps.length === 1 && x1.steps[0].pctBp === 10_000n && pl.steps.length === 3, S(x1.steps));
// Een tweede meerwerkofferte (€ 200) die NIET apart gefactureerd wordt: ze komt in de slot uit de min-meerstaat.
const MQ2 = await extraQuote("Proef extra deur 2c8pb", 20_000n);
ok(await calc.decideQuoteVersion(MQ2.versionId, true, "proef 2c8pb: akkoord meerwerk 2"));
const K2 = `mw${MQ2.quoteId}-akkoord`;
// De factuur uit de meerwerkschijf (100 %).
const readInv = async (id) => ok(await calc.readSalesInvoice(id));
const issue = async (id) => { const f = await readInv(id); return await calc.issueSalesInvoice(id, f.brief.rev, f.totals.totalCents); };
const S1 = ok(await calc.newSalesInvoice(W, { step: { key: K1, minMeerVersionId: [] } }));
let d1 = await readInv(S1);
check("(B3) factuur uit de meerwerkschijf: soort meerwerk, netto € 1.500 (100 %), regels per hoofdstuk van de meerwerkofferte", d1.brief.kind === "meerwerk" && d1.totals.netCents === 150_000n && un(d1.brief.planStepKey) === K1 && d1.lines.every((l) => "work" in l.kind) && new RegExp(MQ1.number).test(d1.brief.title), S([d1.brief.kind, d1.totals.netCents, d1.brief.title]));
check("(B3) totaalrem: de meerwerkschijf past (aanneemsom + saldo min-meer telt de aanvaarde meerwerkofferte)", !d1.findings.some((f) => f.key === "totaal-boven-aanneemsom"), S(d1.findings.map((f) => f.key)));
check("(B3) een tweede factuur voor dezelfde schijf: geweigerd", /bestaat al een factuur/.test(errOf(await calc.newSalesInvoice(W, { step: { key: K1, minMeerVersionId: [] } }))));
const iss1 = await issue(S1);
check("(B3) uitgereikt met een nummer; de schijf staat op uitgereikt", isOk(iss1) && ok(await calc.readSalesPlan(W)).extraWork.find((x) => x.quoteId === MQ1.quoteId).steps[0].status === "uitgereikt", errOf(iss1));
// De min-meerstaat: reeds gefactureerd = de meerwerkfactuur; de slot trekt ze af.
let mm = await readMM();
const NR1 = ok(iss1);
check("(B3) min-meerstaat: de meerwerkofferte telt in het saldo; de meerwerkfactuur staat bij 'reeds gefactureerd' (€ 1.500)", mm.totals.invoicedCents === 150_000n && mm.rows.some((r) => r.source === "meerwerkofferte" && r.extraCents === 150_000n && r.counted), S([mm.totals.invoicedCents, mm.totals.contractCents]));
const V1 = ok(await calc.makeMinMeerVersion(W, "proef 2c8pb", { balanceCents: mm.totals.balanceCents, toInvoiceCents: mm.totals.toInvoiceCents }));
const SL = ok(await calc.newSalesInvoice(W, { step: { key: "slot", minMeerVersionId: [V1] } }));
const dsl = await readInv(SL);
const ded = dsl.lines.filter((l) => "deduct" in l.kind);
check("(B3) slot uit de min-meerversie: netto = nog te factureren (aanneemsom + saldo − € 1.500); aftrek 'Reeds gefactureerd' van de meerwerkfactuur", dsl.totals.netCents === mm.totals.toInvoiceCents && mm.totals.toInvoiceCents === mm.totals.contractCents - 150_000n && ded.length === 1 && ded[0].amountCents === -150_000n && ded[0].description.includes(NR1), S([dsl.totals.netCents, mm.totals.toInvoiceCents, ded.map((l) => l.description)]));
ok(await issue(SL));
{
  const all = (await calc.listSales(W)).filter((b) => b.status === "uitgereikt");
  let sum = 0n;
  for (const b of all) sum += (await readInv(b.id)).totals.netCents;
  check("(B3) geen dubbel meerwerk: Σ uitgereikte facturen = aanneemsom + saldo min-meer (meerwerkfactuur + slot)", sum === mm.totals.contractCents && all.length === 2, S([sum, mm.totals.contractCents, all.length]));
}
// De tweede meerwerkofferte zat in de slot: haar eigen schijf factureren zou dubbel zijn → de totaalrem blokkeert.
const S2 = ok(await calc.newSalesInvoice(W, { step: { key: K2, minMeerVersionId: [] } }));
const d2 = await readInv(S2);
const rem = d2.findings.find((f) => f.key === "totaal-boven-aanneemsom");
check("(B3) totaalrem: de schijf van een meerwerkofferte die al in de slot zat, blokkeert (meer dan aanneemsom + saldo)", !!rem && rem.block, S(d2.findings));
check("(B3) uitreiken van die schijf: geweigerd, geen nummer verbruikt", !isOk(await issue(S2)));
ok(await calc.cancelSalesDraft(S2, "proef 2c8pb: al in de slot"));

// ── B4. Rechten per rol ──
const others = [["werfleider", wl], ["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon], ["onbekende login", vreemd]];
for (const [n, x] of others) {
  check(`(B4) ${n}: geen creditnota, geen Te betalen, geen OA-factuur betaald markeren`, (await denied(x.savePurchase(C("RX", [cCO(1_000n, 1n, { amount: 1n })]), 0n))) && (await denied(x.listPurchasesToPay())) && (await denied(x.markOaInvoicePaid(F1, 0n, [today], []))) && (await denied(x.markPurchasePaid(CN1, 0n, [today], []))));
  check(`(B4) ${n}: geen schema (met de meerwerkschijven) lezen of bewaren`, (await denied(x.readSalesPlan(W))) && (await denied(x.saveSalesExtraPlan(W, MQ1.quoteId, 0n, []))));
}
{
  const f = await wl.salesFacts(W);
  check("(B4) werfleider: enkel het feit 'voorschot betaald', geen bedrag", noMoney(f) && typeof f.advance === "string", S(f));
  check("(B4) admin: creditnota lezen en Te betalen (update-calls met auditregel)", isOk(await admin.readPurchase(CN1)) && isOk(await admin.listPurchasesToPay()) && (await admin.auditLog(0n, 30n)).some((a) => a.action === "bekeek:te-betalen"));
  check("(B4) auditregels: aankoop-creditnota en facturatieschema-meerwerk", (await admin.auditLog(0n, 300n)).some((a) => a.action === "aankoop-creditnota") && (await admin.auditLog(0n, 300n)).some((a) => a.action === "facturatieschema-meerwerk"));
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
