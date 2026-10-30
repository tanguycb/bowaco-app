// De offerte zoals Alexis ze maakt (stap 2c.1, ontwerp 2c §4.1 en §10): QuoteCalc versie 2 en de zijtabellen van quoteForms.
//   node tests/offerte-2c1.mjs                A: de rekenregels zelf (calc.ts en het model), zonder netwerk
//   node tests/offerte-2c1.mjs <canister>     + B: door de backend (eigen net of draft): voorrang van de marges, regietarief,
//                                             korting (bedrag en %), subgroepen, tekstblokken, posten met 0 die de klant niet
//                                             ziet, schadedossier aan 0 %, doorlopend nummer, vastleggen bij het versturen,
//                                             rechten en lek, en N willekeurige offertes browser = server (REKEN_N, standaard 40,
//                                             op een draft 5).
// Enkel VERZONNEN gegevens: offertes "Proef 2c1 …", klassen "Proef …", een verzonnen leverancier en verzekeraar. De koppelingen
// die de test legt, haalt hij op het einde weer weg (andere proeven rekenen met de standaardmarge).
import { backend, freshBackend } from "../tools/lib.mjs";
import { C, M, ensureProofClientAddress, formArgs, fromRead, opt, saveAll, unopt } from "./offerte-lib.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const L = (chapter, qtyMilli, cost, rule = null, extra = {}) => ({ chapter, kind: "item", qtyMilli, cost, rule, ...extra });
const STD = 2000n;

// ── A. De rekenregels zelf ──────────────────────────────────────────────
check("(A1) regietarief: € 45 / 0,8 = € 56,25; € 42 → € 52,50; € 47,50 → € 59,38 (op de cent)", M.regieSell(4500n) === 5625n && M.regieSell(4200n) === 5250n && M.regieSell(4750n) === 5938n);
check("(A2) basismarge van de klasse: 100,00 aan 10 % → 111,11; zonder klasse de standaard 20 % → 125,00", C.calcLine(L("a", 1000n, 10_000n, null, { baseBp: 1000n }), STD).unitSell === 11_111n && C.calcLine(L("a", 1000n, 10_000n), STD).unitSell === 12_500n);
check("(A2) een eigen marge gaat voor op de klasse (25 % → 133,33) en telt als afwijkend; de klasse zelf niet", C.calcLine(L("a", 1000n, 10_000n, { margin: 2500n }, { baseBp: 1000n }), STD).unitSell === 13_333n && C.calcLine(L("a", 1000n, 10_000n, { margin: 2500n }, { baseBp: 1000n }), STD).deviates && !C.calcLine(L("a", 1000n, 10_000n, null, { baseBp: 1000n }), STD).deviates);
check("(A2) eigen marge gelijk aan de klasse = niet afwijkend", !C.calcLine(L("a", 1000n, 10_000n, { margin: 1000n }, { baseBp: 1000n }), STD).deviates);
const rg = C.calcLine(L("a", 8000n, null, null, { regie: { cost: 4500n, sell: 5625n } }), STD);
check("(A3) regiepost zonder eigen regel: 8 u × 56,25 = 450,00; aankoop 360,00; marge 20 %; niet afwijkend", rg.unitSell === 5625n && rg.lineSell === 45_000n && rg.lineCost === 36_000n && rg.marginBp === 2000n && !rg.deviates, S(rg));
check("(A3) regiepost met een eigen vaste prijs: het regietarief telt niet", C.calcLine(L("a", 8000n, null, { price: 6000n }, { regie: { cost: 4500n, sell: 5625n } }), STD).unitSell === 6000n);
const lines = [L("h1", 1000n, 98_765n), L("h1", 2500n, 1234n), L("h2", 3000n, null, { price: 4321n })];
const t0 = C.calcTotals(["h1", "h2"], lines, 2100n, STD);
const tA = C.calcTotals(["h1", "h2"], lines, 2100n, STD, { amount: 10_000n });
check("(A4) korting als bedrag: bruto blijft, subtotaal = bruto − 100,00, btw op het subtotaal", tA.gross === t0.subtotal && tA.discount === 10_000n && tA.subtotal === t0.subtotal - 10_000n && tA.vat === C.roundDiv(tA.subtotal * 2100n, 10_000n) && tA.total === tA.subtotal + tA.vat, S(tA));
const tP = C.calcTotals(["h1", "h2"], lines, 600n, STD, { percent: 750n });
check("(A4) korting als %: 7,5 % van het bruto, op de cent (half weg van nul); btw 6 % op het rest", tP.discount === C.roundDiv(t0.subtotal * 750n, 10_000n) && tP.subtotal === t0.subtotal - tP.discount && tP.vat === C.roundDiv(tP.subtotal * 600n, 10_000n), S(tP));
check("(A4) zonder klasse, regie en korting = de oude regels (bruto = subtotaal, korting 0)", t0.gross === t0.subtotal && t0.discount === 0n);
const t0v = C.calcTotals(["h1"], [L("h1", 1000n, 10_000n)], 0n, STD);
check("(A5) btw 0 % (schadedossier, verlegd): btw 0, totaal = subtotaal", t0v.vat === 0n && t0v.total === t0v.subtotal);

// Het model: voorrang leverancier > hoofdstuk > standaard, koppelingen enkel in een ontwerp, wat de klant ziet.
const loaded = (live) => ({
  versionId: 1n, rev: 0n,
  header: { title: "x", vatBp: 2100n, clientOrgId: null, validDays: 30n, intro: "", note: "", standardMarginBp: STD },
  chapters: [{ id: 10n, code: "01", title: "Buiten", order: 10n, libChapterId: 5n }, { id: 11n, code: "02", title: "Binnen", order: 20n, libChapterId: null }],
  lines: [
    { id: 100n, chapterId: 10n, order: 10n, kind: "item", code: "", title: "a", text: "", specRef: "", qtyMilli: 1000n, unit: "st", form: "vh", libItemId: null, libItemVersion: null, price: { cost: 10_000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } },
    { id: 101n, chapterId: 10n, order: 20n, kind: "item", code: "", title: "b", text: "", specRef: "", qtyMilli: 1000n, unit: "st", form: "vh", libItemId: null, libItemVersion: null, price: { cost: 10_000n, rule: null, reason: "", orgId: 7n, source: "eigen", libCostId: null } },
    { id: 102n, chapterId: 11n, order: 10n, kind: "item", code: "", title: "c", text: "", specRef: "", qtyMilli: 0n, unit: "st", form: "vh", libItemId: null, libItemVersion: null, price: { cost: 10_000n, rule: null, reason: "", orgId: null, source: "eigen", libCostId: null } },
  ],
  form: { hideZeroLines: true, regieText: false, textBlockKeys: [], subgroups: [], lineForms: [], chapterMargins: [], orgMargins: [], links: [{ key: "ch:5", classId: 1n, marginBp: 1000n }, { key: "org:7", classId: 2n, marginBp: 4000n }], regie: null, discount: null, discountText: "", live },
});
const mm = M.load(loaded(true));
const ln = (k) => mm.lines.find((l) => l.key === k);
check("(A6) model: leverancier 40 % > hoofdstuk 10 % > standaard 20 %", M.lineOut(mm, ln("i101")).unitSell === 16_667n && M.lineOut(mm, ln("i100")).unitSell === 11_111n && M.lineOut(mm, ln("i102")).unitSell === 12_500n && M.lineBase(mm, ln("i101")).source === "leverancier" && M.lineBase(mm, ln("i100")).source === "hoofdstuk");
mm.form.chapterMargins.set("i10", { classId: null, marginBp: 1500n });
check("(A6) een marge die de versie vastlegt, gaat voor op de koppeling van het hoofdstuk (15 % → 117,65)", M.lineOut(mm, ln("i100")).unitSell === 11_765n && M.formDirty(mm));
const ms = M.load(loaded(false));
check("(A6) een verzonden versie gebruikt geen koppeling (enkel wat vastligt)", M.lineOut(ms, ms.lines.find((l) => l.key === "i100")).unitSell === 12_500n);
check("(A7) een post met hoeveelheid 0 is verborgen; 'toon toch' toont hem; een post met een hoeveelheid altijd zichtbaar", !M.shown(mm, ln("i102")) && M.shown(mm, ln("i100")) && (M.setLineShow(mm, "i102", true), M.shown(mm, ln("i102"))));

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const host = process.env.ICP_HOST || "";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const N = Number(process.env.REKEN_N || (local ? 40 : 5));

const [admin, calc, wl, klant, oa2, arch, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-klant", "proef-oa2", "proef-architect", "proef-vc"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A");
if (!A) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs (lokaal) of tools/draft-opbouw.mjs (draft)");
await ensureProofClientAddress(admin);
const orgs0 = await admin.listOrgs(true);
const familie = orgs0.find((o) => o.name === "Familie Proef");
const orgIn = (kind, name) => ({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "Verzonnen proeffirma (2c.1)" });
const orgOf = async (kind, name) => orgs0.find((o) => o.name === name)?.id ?? ok(await admin.createOrg(orgIn(kind, name))).id;
const LEV = await orgOf("supplier", "Proef Leverancier 2c1 NV");
const VERZ = await orgOf("other", "Proef Verzekeraar 2c1 NV");
const libChs = await calc.libraryChapters(false);
if (!libChs.length) throw new Error("geen hoofdstukken in de bibliotheek: eerst tests/posten-draft.mjs");
const LIBCH = libChs[0].id;

// ── B0. Controleregels: EPB en veiligheidscoördinatie standaard uit ──
const rules = await admin.getQuoteRules();
const sp = (k) => rules.stdPosts.find((s) => s.key === k);
if (local && sp("vc")) check("(B0) standaardposten: EPB en veiligheidscoördinatie standaard uit, vergunning/PID/opkuis aan", !sp("epb").enabled && !sp("vc").enabled && sp("vergunning").enabled && sp("pid").enabled && sp("opkuis").enabled, S(rules.stdPosts.map((s) => [s.key, s.enabled])));
else console.log("· (B0) standaardposten al door de beheerder ingesteld op deze canister: niet nagekeken");

// ── B1. Margeklassen en koppelingen ──
const classes = async () => ok(await admin.listMarginClasses());
const classId = async (name, bp) => {
  const c = (await classes()).classes.find((x) => x.name === name);
  if (c) { if (c.archived || c.marginBp !== bp) ok(await admin.setMarginClass({ id: [c.id], name, marginBp: bp, note: "", archived: false })); return c.id; }
  return ok(await admin.setMarginClass({ id: [], name, marginBp: bp, note: "Verzonnen proefklasse", archived: false }));
};
const K10 = await classId("Proef Buitenschrijnwerk 2c1", 1000n);
const K40 = await classId("Proef Kleine aankopen 2c1", 4000n);
const KEY_CH = `ch:${LIBCH}`;
const KEY_ORG = `org:${LEV}`;
const linkBefore = (await classes()).links.find((l) => l.key === KEY_CH);
check("(B1) beheerder: klassen 10 % en 40 %, standaardklasse voor een hoofdstuk en een leverancier", isOk(await admin.setMarginClassLink(KEY_CH, [K10])) && isOk(await admin.setMarginClassLink(KEY_ORG, [K40])));
check("(B1) een koppeling naar iets anders dan een bibliotheekhoofdstuk of OA/leverancier: geweigerd", /Kies een hoofdstuk/.test(errOf(await admin.setMarginClassLink(`org:${VERZ}`, [K10]))) && /Kies een hoofdstuk/.test(errOf(await admin.setMarginClassLink("x:1", [K10]))));
check("(B1) een klasse boven 90 %: geweigerd", /0 tot 90/.test(errOf(await admin.setMarginClass({ id: [], name: "Proef te hoog", marginBp: 9500n, note: "", archived: false }))));
check("(B1) klassen lezen: werfleider, OA, klant, architect, VC en een onbekende login geweigerd; de calculator mag", (await Promise.all([wl, oa2, klant, arch, vc, vreemd].map((x) => denied(x.listMarginClasses())))).every(Boolean) && isOk(await calc.listMarginClasses()));
check("(B1) klassen en koppelingen wijzigen: werfleider, OA, klant geweigerd", (await Promise.all([wl, oa2, klant].flatMap((x) => [denied(x.setMarginClass({ id: [], name: "x", marginBp: 1n, note: "", archived: false })), denied(x.setMarginClassLink(KEY_CH, []))]))).every(Boolean));
check("(B1) export van klassen en versievoorwaarden: enkel de beheerder", isOk(await admin.exportChunk("marginClasses", 0n, 5n)) && isOk(await admin.exportChunk("quoteVersionTerms", 0n, 5n)) && (await Promise.all([calc, wl].map((x) => denied(x.exportChunk("marginClasses", 0n, 5n))))).every(Boolean));

// ── B2. Tekstblokken ──
const block = (key, title, text, place, defaultOn) => admin.setTextBlock({ key, title, text, defaultOn, place: { [place]: null }, order: 10n, archived: false });
ok(await block("proef-water-2c1", "Water en elektriciteit (proef)", "Water en elektriciteit worden door de bouwheer ter beschikking gesteld (verzonnen proeftekst).", "top", true));
ok(await block("proef-afk-2c1", "Afkortingen (proef)", "VH = vermoedelijke hoeveelheid; FF = forfait (verzonnen proeftekst).", "end", false));
check("(B2) tekstblokken: de calculator leest ze; werfleider, OA en klant niet; enkel wie de bibliotheek beheert, wijzigt", (await calc.listTextBlocks(false)).some((b) => b.key === "proef-water-2c1") && (await Promise.all([wl, oa2, klant].map((x) => denied(x.listTextBlocks(false))))).every(Boolean) && (await Promise.all([wl, klant].map((x) => denied(x.setTextBlock({ key: "x", title: "x", text: "x", defaultOn: false, place: { top: null }, order: 0n, archived: false }))))).every(Boolean));

// ── B3. Doorlopend offertenummer ──
const year = new Date().getUTCFullYear();
if (local) ok(await admin.setQuoteSequence(BigInt(year), (await admin.quoteSequence(BigInt(year))) + 50n));
const last = await admin.quoteSequence(BigInt(year));
const pad = (n) => String(n).padStart(3, "0");
const q1c = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 2c1 offerte zoals Alexis" }));
const q2c = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 2c1 schadedossier" }));
check("(B3) doorlopend nummer: laatste + 1, dan + 2 (het jaar van vandaag ervoor)", q1c.number === `${year}/${pad(last + 1n)}` && q2c.number === `${year}/${pad(last + 2n)}` && (await admin.quoteSequence(BigInt(year))) === last + 2n, `${q1c.number} ${q2c.number} na ${last}`);

// ── B4. Een offerte met klassen, regie, korting, subgroepen, tekstblokken en een post met 0 ──
const rd = async (vid, who = calc) => ok(await who.readQuoteVersion(vid));
let m = fromRead(await rd(q1c.versionId));
check("(B4) een nieuwe versie rekent met de nieuwe regels en kent de standaardtekstblokken", m.v2 && m.form.textBlockKeys.includes("proef-water-2c1") && !m.form.textBlockKeys.includes("proef-afk-2c1") && m.form.hideZeroLines);
M.setHeader(m, { clientOrgId: familie?.id ?? null });
const price = (cost, rule = null, orgId = null, reason = "") => ({ cost, rule, reason, orgId, source: cost === null ? "" : "eigen", libCostId: null });
const k1 = M.addChapter(m, { code: "01", title: "Proef buitenschrijnwerk", libChapterId: LIBCH });
const k2 = M.addChapter(m, { code: "02", title: "Proef binnen" });
M.addLine(m, k1.key, { title: "Proef raam (klasse hoofdstuk)", qtyMilli: 1000n, unit: "st", form: "vh", price: price(10_000n) });
M.addLine(m, k1.key, { title: "Proef beslag (klasse leverancier)", qtyMilli: 1000n, unit: "st", form: "vh", price: price(10_000n, null, LEV) });
M.addLine(m, k1.key, { title: "Proef dorpel (eigen marge)", qtyMilli: 1000n, unit: "st", form: "vh", price: price(10_000n, { margin: 2500n }, null, "proef: eigen marge") });
M.addLine(m, k1.key, { title: "Proef regie-uren", qtyMilli: 8000n, unit: "u", form: "regie", price: price(null) });
M.addLine(m, k1.key, { title: "Proef mogelijke post", qtyMilli: 0n, unit: "st", form: "vh", price: price(5000n) });
M.addLine(m, k2.key, { title: "Proef binnendeur (standaard)", qtyMilli: 1000n, unit: "st", form: "vh", price: price(10_000n) });
M.addLine(m, k2.key, { title: "Proef vergunning en opkuis", qtyMilli: 1000n, unit: "st", form: "fixed", price: price(null, { price: 20_000n }, null, "proef: vaste prijs") });
let s = await saveAll(calc, m);
check("(B4) bewaren met de klassen: de backend rekent hetzelfde als de browser", isOk(s), errOf(s).slice(0, 200));
let r = await rd(q1c.versionId);
const sellOf = (title) => { const l = r.lines.find((x) => x.title === title); return r.sell.find((x) => x.lineId === l.id)?.unitSellCents[0]; };
check("(B4) voorrang: eigen marge 133,33 > leverancier 40 % 166,67 > hoofdstuk 10 % 111,11 > standaard 20 % 125,00", sellOf("Proef dorpel (eigen marge)") === 13_333n && sellOf("Proef beslag (klasse leverancier)") === 16_667n && sellOf("Proef raam (klasse hoofdstuk)") === 11_111n && sellOf("Proef binnendeur (standaard)") === 12_500n, S([sellOf("Proef dorpel (eigen marge)"), sellOf("Proef beslag (klasse leverancier)"), sellOf("Proef raam (klasse hoofdstuk)"), sellOf("Proef binnendeur (standaard)")]));
const tm = unopt(r.terms);
const baseOf = (title) => tm.lineBases.find((b) => b.lineId === r.lines.find((x) => x.title === title).id);
check("(B4) per post waar de marge vandaan komt (leverancier · hoofdstuk · standaard · eigen)", baseOf("Proef beslag (klasse leverancier)").source === "leverancier" && baseOf("Proef raam (klasse hoofdstuk)").source === "hoofdstuk" && baseOf("Proef binnendeur (standaard)").source === "standaard" && baseOf("Proef dorpel (eigen marge)").source === "eigen");
check("(B4) regiepost zonder regietarief: geen prijs (de controle houdt het versturen tegen)", sellOf("Proef regie-uren") === undefined);

m = fromRead(r);
M.setLineShow(m, m.lines.find((l) => l.title === "Proef mogelijke post").key, null);
m.form.regie = { orgId: null, cost: 4500n, sell: M.regieSell(4500n) };
m.form.regieText = true;
m.form.discount = { amount: 10_000n };
m.form.discountText = "Proef korting bij uitvoering in één fase";
m.form.textBlockKeys = [...m.form.textBlockKeys, "proef-afk-2c1"];
const kk1 = m.chapters.find((c) => c.code === "01").key;
const g1 = M.addSubgroup(m, kk1, "Proef gelijkvloers");
const g2 = M.addSubgroup(m, kk1, "Proef verdiep +1");
M.setLineSubgroup(m, m.lines.find((l) => l.title === "Proef raam (klasse hoofdstuk)").key, g1.key);
M.setLineSubgroup(m, m.lines.find((l) => l.title === "Proef beslag (klasse leverancier)").key, g2.key);
M.setLineSubgroup(m, m.lines.find((l) => l.title === "Proef dorpel (eigen marge)").key, g2.key);
// Eerst een vervalste verwachting: de server bewaart niets.
const fs0 = M.formSave(m);
const bad = formArgs(m, { ...fs0, expect: { ...fs0.expect, total: fs0.expect.total + 1n } });
check("(B5) vorm met een totaal dat 1 cent afwijkt: geweigerd, niets bewaard", /verschillen/.test(errOf(await calc.saveQuoteForm(...bad))) && (await rd(q1c.versionId)).version.rev === m.rev);
check("(B5) de vorm bewaren: werfleider, OA, klant geweigerd", (await Promise.all([wl, oa2, klant].map((x) => denied(x.saveQuoteForm(...formArgs(m, fs0)))))).every(Boolean));
s = await saveAll(calc, m);
check("(B5) regietarief, korting (bedrag), subgroepen, tekstblokken bewaard: backend = browser", isOk(s), errOf(s).slice(0, 200));
r = await rd(q1c.versionId);
const mt = M.totals(m);
check("(B5) regiepost: 8 u × € 56,25 = € 450,00 (uurloon € 45 / 0,8)", sellOf("Proef regie-uren") === 5625n && r.sell.find((x) => x.lineId === r.lines.find((l) => l.title === "Proef regie-uren").id).lineSellCents === 45_000n);
check("(B5) korting € 100: bruto − 100 = subtotaal; btw op het subtotaal; zelfde als de browser", r.totals.discountCents === 10_000n && r.totals.subtotalCents === r.totals.grossCents - 10_000n && r.totals.grossCents === mt.gross && r.totals.totalCents === mt.total, S([r.totals.grossCents, r.totals.subtotalCents, mt.gross, mt.total]));
const f1 = unopt(r.form);
check("(B5) subgroepen in de versie, de posten erin; de post met 0 verborgen voor de klant", f1.subgroups.length === 2 && f1.lineForms.filter((x) => x.subgroupId.length).length === 3 && !f1.lineForms.find((x) => x.lineId === r.lines.find((l) => l.title === "Proef mogelijke post").id).shown);
m = fromRead(r);
m.form.discount = { percent: 750n };
s = await saveAll(calc, m);
r = await rd(q1c.versionId);
check("(B6) korting als %: 7,5 % van het bruto op de cent", isOk(s) && r.totals.discountCents === C.roundDiv(r.totals.grossCents * 750n, 10_000n) && r.totals.totalCents === M.totals(m).total, errOf(s));
const rawIn = (discount) => ({ input: { hideZeroLines: true, regieText: false, textBlockKeys: [], subgroupOps: [], lineOps: [], chapterMargins: [], regie: null, discount, discountText: "" }, expect: { subtotal: 0n, discount: 0n, total: 0n } });
check("(B6) een korting boven 100 % of groter dan het totaal: geweigerd", /0 tot 100/.test(errOf(await calc.saveQuoteForm(...formArgs(m, rawIn({ percent: 12_000n }))))) && /groter dan het totaal/.test(errOf(await calc.saveQuoteForm(...formArgs(m, rawIn({ amount: r.totals.grossCents + 1n }))))));

// Wat de werfleider ziet: hoeveelheden, subgroepen, hoofdstuktotalen; nooit klasse, marge, regietarief.
const rw = await rd(q1c.versionId, wl);
check("(B7) werfleider: geen marges, klassen, regietarief of prijs per post; wel de subgroepen", Object.keys(rw.scope)[0] === "totals" && rw.terms.length === 0 && rw.costs.length === 0 && rw.sell.length === 0 && rw.margins.length === 0 && unopt(rw.form).subgroups.length === 2 && !/marginBp|costCents|classId|regie[A-Z]?\w*Cents/.test(S(rw)), S(Object.keys(rw)));
check("(B7) OA, klant en VC lezen de offerte van kantoor niet", (await Promise.all([oa2, klant, vc].map((x) => denied(x.readQuoteVersion(q1c.versionId))))).every(Boolean));

// ── B8. Versturen: alles ligt vast ──
const send = async (vid, who = calc) => { const x = await rd(vid); return who.sendQuoteVersion(vid, x.version.rev, x.totals.totalCents, "proef 2c1: waarschuwingen doorgezet"); };
const s1 = await send(q1c.versionId);
check("(B8) versturen", isOk(s1), errOf(s1));
const r1 = await rd(q1c.versionId);
const tm1 = unopt(r1.terms);
check("(B8) bij het versturen liggen de marges van hoofdstuk en leverancier in de versie vast", tm1.chapterMargins.some((c) => c.fixed && c.marginBp === 1000n) && tm1.orgMargins.some((o) => o.fixed && o.id === LEV && o.marginBp === 4000n), S(tm1.chapterMargins));
ok(await admin.setMarginClass({ id: [K10], name: "Proef Buitenschrijnwerk 2c1", marginBp: 1200n, note: "", archived: false }));
ok(await block("proef-water-2c1", "Water en elektriciteit (proef)", "GEWIJZIGDE proeftekst na het versturen.", "top", true));
const r1b = await rd(q1c.versionId);
check("(B8) klasse en tekstblok later gewijzigd: de verzonden versie rekent en toont hetzelfde, controlecode klopt", r1b.totals.totalCents === r1.totals.totalCents && r1b.version.intact && unopt(r1b.form).blocks.find((b) => b.key === "proef-water-2c1").text !== "GEWIJZIGDE proeftekst na het versturen.");

// De klant
const mq = ok(await klant.readMyQuote(q1c.versionId));
const mf = unopt(mq.form);
check("(B9) klant: de post met hoeveelheid 0 ziet hij niet; de andere posten wel", !mq.lines.some((l) => l.title === "Proef mogelijke post") && mq.lines.some((l) => l.title === "Proef raam (klasse hoofdstuk)") && mq.intact);
check("(B9) klant: subgroepen, korting, regietekst (€ 56,25/u) en beide tekstblokken (zoals verstuurd)", mf.subgroups.length === 2 && mf.lineSubgroups.length === 3 && mf.discountCents === r1.totals.discountCents && mf.discountText.startsWith("Proef korting") && unopt(mf.regieSellCents) === 5625n && mf.blocks.map((b) => b.key).sort().join() === "proef-afk-2c1,proef-water-2c1" && !mf.blocks.some((b) => /GEWIJZIGDE/.test(b.text)));
check("(B9) klant: nooit een klasse, marge, aankoopprijs of uurloon van de OA", !/marginBp|costCents|classId|className|costCents|orgMargins|chapterMargins/.test(S(mq)) && !S(mq).includes('"4500"'));
check("(B9) klant: totaal = wat kantoor verstuurde", mq.totalCents === r1.totals.totalCents && mq.subtotalCents === r1.totals.subtotalCents);

// Een nieuwe versie neemt alles mee (ook de vastgelegde marges, niet de nieuwe 12 %).
const v2 = ok(await calc.newQuoteVersion(q1c.quoteId, []));
const r2 = await rd(v2);
const sell2 = (title) => { const l = r2.lines.find((x) => x.title === title); return r2.sell.find((x) => x.lineId === l.id)?.unitSellCents[0]; };
check("(B10) nieuwe versie: subgroepen, tekstblokken, regie, korting en marges mee; totaal gelijk", unopt(r2.form).subgroups.length === 2 && unopt(r2.terms).regie.length === 1 && unopt(unopt(r2.terms).discount)?.percent === 750n && sell2("Proef raam (klasse hoofdstuk)") === 11_111n && r2.totals.totalCents === r1.totals.totalCents, S([sell2("Proef raam (klasse hoofdstuk)"), r2.totals.totalCents, r1.totals.totalCents]));
let m2 = fromRead(r2);
M.setLineShow(m2, m2.lines.find((l) => l.title === "Proef mogelijke post").key, true);
s = await saveAll(calc, m2);
check("(B10) 'toon toch' voor de post met 0: de klant zou hem zien", isOk(s) && unopt((await rd(v2)).form).lineForms.find((x) => x.lineId === m2.lines.find((l) => l.title === "Proef mogelijke post").id).shown, errOf(s));
const hv = await rd(v2);
check("(B10) btw 0 % op een gewone offerte: geweigerd", /0 % enkel bij een schadedossier/.test(errOf(await calc.saveQuoteDraft(v2, hv.version.rev, [{ title: hv.version.title, vatBp: 0n, clientOrgId: hv.version.clientOrgId, validDays: hv.version.validDays, intro: "", note: "", standardMarginBp: STD }], [], [], { subtotalCents: 0n, vatCents: 0n, totalCents: 0n, optionsPlusCents: 0n, optionsMinusCents: 0n, costCents: 0n, marginCents: 0n, chapters: [] }))));

// ── B11. Schadedossier aan 0 % ──
check("(B11) verzekeraar moet een firma van de soort andere of klant zijn", /verzekeraar/i.test(errOf(await calc.setQuoteInfo(q2c.quoteId, { kind: { damage: null }, insurerOrgId: [LEV], claimRef: "PROEF-1" }))));
check("(B11) soort schadedossier met verzekeraar en dossiernummer", isOk(await calc.setQuoteInfo(q2c.quoteId, { kind: { damage: null }, insurerOrgId: [VERZ], claimRef: "PROEF-SCHADE-2C1" })));
check("(B11) soort wijzigen: werfleider, OA, klant geweigerd", (await Promise.all([wl, oa2, klant].map((x) => denied(x.setQuoteInfo(q2c.quoteId, { kind: { standard: null }, insurerOrgId: [], claimRef: "" }))))).every(Boolean));
let md = fromRead(await rd(q2c.versionId));
M.setHeader(md, { clientOrgId: familie?.id ?? null, vatBp: 0n });
const kd = M.addChapter(md, { code: "01", title: "Proef herstel waterschade" });
M.addLine(md, kd.key, { title: "Proef plafond herstellen", qtyMilli: 12_000n, unit: "m2", form: "vh", price: price(3000n) });
s = await saveAll(calc, md);
check("(B11) btw 0 % bij een schadedossier: bewaard", isOk(s), errOf(s));
const sd = await send(q2c.versionId);
const rdd = await rd(q2c.versionId);
check("(B11) verstuurd: btw 0, totaal = subtotaal; soort, verzekeraar en dossiernummer vast", isOk(sd) && rdd.totals.vatCents === 0n && rdd.totals.totalCents === rdd.totals.subtotalCents && Object.keys(unopt(rdd.form).kind)[0] === "damage" && unopt(rdd.form).claimRef === "PROEF-SCHADE-2C1", errOf(sd));
const mqd = ok(await klant.readMyQuote(q2c.versionId));
check("(B11) de klant ziet btw 0 %, schadedossier en dossiernummer", mqd.vatBp === 0n && mqd.vatCents === 0n && Object.keys(unopt(mqd.form).kind)[0] === "damage" && unopt(mqd.form).claimRef === "PROEF-SCHADE-2C1");
ok(await calc.setQuoteInfo(q2c.quoteId, { kind: { standard: null }, insurerOrgId: [], claimRef: "" }));
check("(B11) de soort later wijzigen verandert de verzonden versie niet (controlecode klopt)", (await rd(q2c.versionId)).version.intact && Object.keys(unopt((await rd(q2c.versionId)).form).kind)[0] === "damage");

// ── B12. Een versie die nog met de oude regels rekent, blijft intact ──
let olds = 0;
let oldOk = 0;
for (const q of await admin.listQuotes([], true)) {
  for (const v of q.versions) {
    if (!("draft" in v.status)) {
      const x = await admin.readQuoteVersion(v.id);
      if (isOk(x) && x.ok.version.calcVersion === 1n) { olds++; if (x.ok.version.intact && x.ok.form.length === 0) oldOk++; }
    }
  }
}
check(`(B12) versies met de oude rekenregels: intact en zonder vorm (${olds})`, olds === oldOk);

// ── B14. De .did: wat de werfleider van de vorm krijgt, draagt geen bedrag, marge of klasse ──
{
  const { readFileSync } = await import("node:fs");
  const did = readFileSync(new URL("../src/backend/dist/backend.did", import.meta.url), "utf8");
  const types = new Map([...did.matchAll(/^type (\w+) =([\s\S]*?);\n(?=type |service|$)/gm)].map((x) => [x[1], x[2]]));
  const fieldsOf = (n) => [...(types.get(n) ?? "").matchAll(/^\s+(\w+)\s*:/gm)].map((x) => x[1]);
  const fTypes = ["QuoteFormView", "QuoteSubgroupView", "QuoteLineFormView", "QuoteBlockView", "TextBlockView"];
  const badF = fTypes.flatMap((n) => fieldsOf(n).filter((f) => /cents|cost|margin|marg|price|prijs|amount|bedrag|class|regie(?!Text)|discount/i.test(f)).map((f) => `${n}.${f}`));
  check("(B14) de interne vormtypen bestaan en dragen geen bedrag, marge, klasse, regietarief of korting", fTypes.every((n) => types.has(n)) && badF.length === 0, badF.join(", "));
}

// ── B13. Willekeurige offertes: browser = server ──
let seed = 20261030;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const qr = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 2c1 willekeurig" }));
let vid = qr.versionId;
let same = 0;
let sent = 0;
let firstErr = "";
for (let i = 0; i < N; i++) {
  // Versturen legt de marges vast (freeze); een blokkering (bv. een regiepost zonder prijs) is geen fout: dan verder in hetzelfde ontwerp.
  if (i > 0) { const sv = await send(vid); if (isOk(sv)) { sent++; vid = ok(await calc.newQuoteVersion(qr.quoteId, [])); } }
  let x = fromRead(await rd(vid));
  for (const l of [...x.lines]) M.removeLine(x, l.key);
  for (const c of [...x.chapters]) M.removeChapter(x, c.key);
  M.setHeader(x, { clientOrgId: familie?.id ?? null, vatBp: rand(2) ? 600n : 2100n, standardMarginBp: BigInt(1000 + rand(3000)) });
  const nch = 1 + rand(3);
  for (let c = 0; c < nch; c++) {
    const ch = M.addChapter(x, { code: `0${c + 1}`, title: `Proef hoofdstuk ${c + 1}`, libChapterId: rand(2) ? LIBCH : null });
    for (let k = 0, n = 1 + rand(5); k < n; k++) {
      const regie = rand(5) === 0;
      const rule = rand(4) === 0 ? { margin: BigInt(rand(6000)) } : rand(6) === 0 ? { price: BigInt(100 + rand(99_999)) } : null;
      M.addLine(x, ch.key, { title: `Proef post ${c}.${k}`, qtyMilli: BigInt(rand(40_000) - (rand(8) === 0 ? 20_000 : 0)), unit: "st", form: regie ? "regie" : "vh", price: { cost: regie && rand(2) ? null : BigInt(1 + rand(250_000)), rule, reason: rule ? "proef: willekeurig" : "", orgId: rand(3) === 0 ? LEV : null, source: "eigen", libCostId: null } });
    }
  }
  let sv = await saveAll(calc, x);
  if (!isOk(sv)) { firstErr ||= `bewaren ${i}: ${errOf(sv)}`; continue; }
  x = fromRead(await rd(vid));
  x.form.regie = rand(2) ? { orgId: null, cost: BigInt(2000 + rand(6000)), sell: 0n } : null;
  if (x.form.regie) x.form.regie.sell = M.regieSell(x.form.regie.cost);
  const gross = M.totals(x).gross;
  x.form.discount = rand(3) === 0 ? null : rand(2) ? { percent: BigInt(rand(2500)) } : { amount: gross > 0n ? BigInt(rand(Number(gross > 1_000_000n ? 1_000_000n : gross))) : 0n };
  x.form.discountText = x.form.discount ? "Proef korting" : "";
  for (const c of M.activeChapters(x)) if (rand(3) === 0) x.form.chapterMargins.set(c.key, { classId: rand(2) ? K40 : null, marginBp: rand(2) ? 4000n : BigInt(rand(5000)) });
  for (const [k, p] of [...x.form.chapterMargins]) if (p.classId !== null) x.form.chapterMargins.set(k, { classId: p.classId, marginBp: 4000n });
  sv = await saveAll(calc, x);
  if (!isOk(sv)) { firstErr ||= `vorm ${i}: ${errOf(sv)}`; continue; }
  const back = await rd(vid);
  const t = M.totals(x);
  const sells = new Map(back.sell.map((y) => [String(y.lineId), y.unitSellCents[0] ?? null]));
  const lineSame = M.activeLines(x).every((l) => (M.lineOut(x, l).unitSell ?? null) === sells.get(String(l.id)));
  if (back.totals.totalCents === t.total && back.totals.discountCents === t.discount && back.totals.grossCents === t.gross && lineSame) same++;
  else firstErr ||= `verschil ${i}: ${S([back.totals.totalCents, t.total, back.totals.discountCents, t.discount])}`;
}
check(`(B13) ${N} willekeurige offertes (klassen, regie, korting, eigen marges, minwerk): browser = server per post en in totaal (${sent} verstuurd en verder als nieuwe versie)`, same === N, firstErr);
ok(await calc.setQuoteArchived(qr.quoteId, true, "proef 2c1 afgerond"));

// ── Opruimen: koppelingen weg, klasse terug, tekstblokken archiveren (andere proeven rekenen met de standaard) ──
ok(await admin.setMarginClass({ id: [K10], name: "Proef Buitenschrijnwerk 2c1", marginBp: 1000n, note: "", archived: false }));
ok(await admin.setMarginClassLink(KEY_CH, linkBefore ? [linkBefore.classId] : []));
ok(await admin.setMarginClassLink(KEY_ORG, []));
for (const k of ["proef-water-2c1", "proef-afk-2c1"]) {
  const b = (await admin.listTextBlocks(true)).find((x) => x.key === k);
  ok(await admin.setTextBlock({ key: k, title: b.title, text: b.text, defaultOn: false, place: b.place, order: b.order, archived: true }));
}
check("opgeruimd: geen koppeling meer naar de proefleverancier", !(await classes()).links.some((l) => l.key === KEY_ORG));

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
