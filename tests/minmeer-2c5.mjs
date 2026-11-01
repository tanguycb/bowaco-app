// Min-meerstaat (stap 2c.5, ontwerp 2c §4.5, §8 R41, §10; ⚖3, AC-5, AC-18, AC-19).
//   node tests/minmeer-2c5.mjs                A: de rekenmodule (minmeer/calc.ts: afronding, kolommen, deel van een post, korting,
//                                               in afwachting, totalen) en de PDF van een versie, zonder netwerk
//   node tests/minmeer-2c5.mjs <canister>     + B: door de backend: de getekende offerte met haar korting op het totaal (kolom
//                                               offerte = aanneemsom), opmeting (gemeten − VH), regie-uren aan het regietarief van
//                                               de werf met datum, uren binnen de raming tot ze afgerekend is, kosten van een OA
//                                               aan kostprijs / 0,8, regels van kantoor met akkoord, korting, reeds gefactureerd,
//                                               meerwerk < en ≥ € 1.000 (meerwerkofferte met eigen akkoord), voorstel van de
//                                               werfleider zonder prijs, werfleider van een andere werf, versies onder een
//                                               controlecode, delen met de klant (zonder kostprijs of OA-naam), akkoord, andere
//                                               klant en architect, gearchiveerde persoon, vorderingsstaat, export, .did-controle,
//                                               en de rekentest browser = server (MM_RONDES, standaard 40).
// Enkel VERZONNEN gegevens: firma's "Proef … 2c5", gemeente Lindegem, postcode 9993.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead, ensureProofClientAddress } from "./offerte-lib.mjs";
import * as MC from "../src/frontend/src/minmeer/calc.ts";
import { minMeerPdf } from "../src/frontend/src/pdf/minmeer.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── A. De rekenmodule en de PDF ─────────────────────────────────────────
{
  const L = (o) => ({ chapter: "01", col: "auto", qtyMilli: 1000n, unitCents: 0n, pctBp: null, counted: true, ...o });
  check("(A1) afronding half weg van nul: 1,5 × € 0,03 = € 0,05; −1,5 × € 0,03 = −€ 0,05", MC.amount(L({ qtyMilli: 1500n, unitCents: 3n })) === 5n && MC.amount(L({ qtyMilli: -1500n, unitCents: 3n })) === -5n);
  check("(A1) deel van een post: 30 % van 1 × € 10.000,00 = € 3.000,00; 33,33 % van € 0,10 = € 0,03", MC.amount(L({ unitCents: 1_000_000n, pctBp: 3000n })) === 300_000n && MC.amount(L({ unitCents: 10n, pctBp: 3333n })) === 3n);
  const o1 = MC.line(L({ col: "less", qtyMilli: 2000n, unitCents: 500n }));
  const o2 = MC.line(L({ col: "extra", qtyMilli: -2000n, unitCents: 500n }));
  const o3 = MC.line(L({ col: "auto", qtyMilli: -2000n, unitCents: 500n }));
  const o4 = MC.line(L({ col: "offer", qtyMilli: 1000n, unitCents: -2500n }));
  check("(A1) kolommen: minwerk altijd negatief, meerwerk altijd positief, auto volgt het teken, offerte ongewijzigd (ook een korting −)", o1.lessCents === -1000n && o2.extraCents === 1000n && o3.lessCents === -1000n && o3.extraCents === 0n && o4.offerCents === -2500n);
  const t = MC.totals(
    [L({ chapter: "01", col: "offer", qtyMilli: 10_000n, unitCents: 10_000n }), L({ chapter: "01", col: "extra", qtyMilli: 2000n, unitCents: 5000n }), L({ chapter: "02", col: "extra", qtyMilli: 1000n, unitCents: 30_000n }), L({ chapter: "02", col: "less", qtyMilli: 1000n, unitCents: 7_000n }), L({ chapter: "02", col: "extra", qtyMilli: 1000n, unitCents: 150_000n, counted: false })],
    [{ chapter: "02", pctBp: 1000n, amountCents: 0n, counted: true }, { chapter: "", pctBp: null, amountCents: 2_500n, counted: true }, { chapter: "", pctBp: 500n, amountCents: 0n, counted: false }],
    40_000n, 2100n,
  );
  // offerte 1.000,00; meer 100,00 + 300,00 = 400,00; min −70,00 − 30,00 (10 % van 300) − 25,00 = −125,00; saldo 275,00
  check("(A1) totalen: offerte 1.000, meer 400, min −125 (korting 10 % op het meerwerk van 02 en € 25 op het totaal), saldo 275", t.offerCents === 100_000n && t.extraCents === 40_000n && t.lessCents === -12_500n && t.balanceCents === 27_500n, S([t.offerCents, t.extraCents, t.lessCents]));
  check("(A1) aanneemsom + saldo 1.275, reeds gefactureerd 400, nog te factureren 875; in afwachting 1.500 + 5 % van 400 = −20 → 1.480", t.contractCents === 127_500n && t.toInvoiceCents === 87_500n && t.pendingCents === 150_000n - 2_000n, S([t.contractCents, t.toInvoiceCents, t.pendingCents]));
  check("(A1) per hoofdstuk: 01 offerte 1.000 meer 100; 02 meer 300 min −100 saldo 200; '' min −25", t.chapters.length === 3 && t.chapters[0].offerCents === 100_000n && t.chapters[0].extraCents === 10_000n && t.chapters[1].balanceCents === 20_000n && t.chapters[2].chapter === "" && t.chapters[2].lessCents === -2_500n, S(t.chapters));
  const e = MC.totals([], [], 0n, 600n);
  check("(A1) leeg: alles 0", e.balanceCents === 0n && e.contractCents === 0n && e.chapters.length === 0);

  const { PDFDocument } = createRequire(join(import.meta.dirname, "../src/frontend/package.json"))("pdf-lib");
  const line = (i) => ({ chapter: `0${i % 4} Proefhoofdstuk`, source: i % 3 ? "opmeting 1" : "kantoor", day: 20_400n + BigInt(i), description: i === 7 ? "w".repeat(500) : `Proefregel ${i}`, unit: "st", qtyMilli: 1500n * BigInt(i), unitCents: 1234n, offerCents: i % 5 === 0 ? 50_000n : 0n, lessCents: i % 4 === 1 ? -1234n : 0n, extraCents: i % 4 === 2 ? 2_222n : 0n, counted: i !== 9, approval: i === 9 ? "wacht" : "niet nodig", note: i === 11 ? "Verzonnen opmerking. ".repeat(30) : "" });
  const data = { number: 3n, day: 20_400n, hash: "cd".repeat(32), issuer: "BOWACO bv (proef)", clientName: "Proef Klant Lijster 2c5", workCode: "P-MM", workName: "Proef min-meer", workAddress: { street: "Proefweg", number: "3", zip: "9993", city: "Lindegem", country: "BE" }, quoteRefs: ["2026/412 v1", "2026/412-M1 v1"], note: "", lines: Array.from({ length: 140 }, (_, i) => line(i)), chapters: [{ chapter: "01 Proefhoofdstuk", offerCents: 1n, lessCents: -2n, extraCents: 3n, balanceCents: 1n }], invoiced: [{ title: "vorderingsstaat VS P-MM/1", day: 20_390n, cents: 500_000n }], totals: { offerCents: 1_192_250n, lessCents: -355_000n, extraCents: 334_000n, balanceCents: -21_000n, contractCents: 1_171_250n, invoicedCents: 500_000n, toInvoiceCents: 671_250n, pendingCents: 150_000n, vatBp: 2100n }, changes: [{ kind: "nieuw", chapter: "01", description: "Proef", balanceDeltaCents: 1000n }], client: true };
  const bytes = await minMeerPdf(data, fonts());
  const d = await PDFDocument.load(bytes);
  check("(A2) PDF van een versie: 140 regels, lange omschrijving en opmerking over meerdere bladzijden, geldig PDF", d.getPageCount() >= 3 && bytes.length > 10_000, `${d.getPageCount()} blz.`);
  const small = await minMeerPdf({ ...data, lines: data.lines.slice(1, 4).map((l) => ({ ...l, chapter: "01 Proefhoofdstuk", note: "" })), changes: [], invoiced: [] }, fonts());
  check("(A2) korte versie: één bladzijde", (await PDFDocument.load(small)).getPageCount() === 1);
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (enkel A; geef een canister voor B)`);
  process.exit(fail ? 1 : 0);
}

// ── B. Door de backend ──────────────────────────────────────────────────
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r.ok; };
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang|^Onbekende (versie|regel)/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|reject/i.test(String(e)); } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const uid = () => crypto.randomUUID();
const keysOf = (x, out = new Set()) => { if (Array.isArray(x)) x.forEach((y) => keysOf(y, out)); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { out.add(k); keysOf(v, out); } return out; };
const MONEY = /cents|price|cost|margin|amount|euro|total/i;
const noMoney = (x) => ![...keysOf(x)].some((k) => MONEY.test(k));

const [admin, calc, wl, oa2, klant, arch] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-oa2", "proef-klant", "proef-architect"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const suffix = Date.now().toString(36).slice(-5).toUpperCase();
// De dag van de canister (de rollentest verzet de klok van het eigen net).
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;
const nextWd = (d) => { let x = BigInt(d); while (wd(x) > 4) x++; return x; };

// B0. Opzet: een werf met de klant (de firma van proef-klant), een getekende offerte met 5 % korting en een regiepost, werf gestart.
await ensureProofClientAddress(admin);
const KLANT = (await klant.me()).person[0];
const KLANTORG = un(KLANT.orgId);
const WLID = (await wl.me()).person[0].id;
const dak = (await admin.listOrgs(false)).find((o) => o.name === "Proef Dak NV");
const addr = { street: "Proefweg", number: "3", zip: "9993", city: "Lindegem", country: "BE" };
const W = ok(await admin.createWork({ code: `P-MM${suffix}`, name: "Proef min-meer 2c5", address: addr, parentId: [], clientOrgId: opt(KLANTORG), architectOrgId: [], leaderPersonId: [WLID], vatBp: 2100n })).id;
ok(await admin.setWorkStatus(W, { quoting: null }));
const NR = `MM-${suffix}`;
const q1 = ok(await calc.createQuote({ workId: W, number: NR, title: "Proef offerte min-meer 2c5" }));
const price = (cost, orgId = null) => ({ cost, rule: null, reason: "", orgId, source: "eigen", libCostId: null });
{
  const m = fromRead(ok(await calc.readQuoteVersion(q1.versionId)));
  M.setHeader(m, { clientOrgId: KLANTORG });
  const c1 = M.addChapter(m, { code: "01", title: "Afbraak" });
  M.addLine(m, c1.key, { title: "Proef afbraak 2c5", qtyMilli: 40_000n, unit: "m2", form: "vh", price: price(2500n) });
  M.addLine(m, c1.key, { title: "Proef container 2c5", qtyMilli: 2_000n, unit: "st", form: "fixed", price: price(32_000n) });
  const c2 = M.addChapter(m, { code: "02", title: "Ruwbouw" });
  M.addLine(m, c2.key, { title: "Proef metselwerk 2c5", qtyMilli: 1_000n, unit: "sog", form: "fixed", price: price(800_000n) });
  const c3 = M.addChapter(m, { code: "03", title: "Regie" });
  M.addLine(m, c3.key, { title: "Proef regie 2c5", qtyMilli: 10_000n, unit: "u", form: "regie", price: price(4000n, dak.id) });
  m.form.discount = { percent: 500n };
  m.form.discountText = "proef: korting bij uitvoering in één fase";
  const r = await saveAll(calc, m);
  if (!isOk(r)) throw new Error(errOf(r));
}
const rd1 = ok(await calc.readQuoteVersion(q1.versionId));
ok(await calc.sendQuoteVersion(q1.versionId, rd1.version.rev, rd1.totals.totalCents, "proef 2c5: waarschuwingen doorgezet"));
ok(await calc.decideQuoteVersion(q1.versionId, true, "proef 2c5: akkoord"));
const rd = ok(await calc.readQuoteVersion(q1.versionId));
const root = (t) => rd.lines.find((l) => l.title === t).id;
const R = { afbraak: root("Proef afbraak 2c5"), metsel: root("Proef metselwerk 2c5"), regie: root("Proef regie 2c5") };
const wsIn = (startDay) => ({ target: { existing: null }, startDay, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false });
const st0 = nextWd(cDay - 20n);
const pv = ok(await wl.workStartPreview(q1.versionId, wsIn(st0)));
ok(await wl.startWorkFromQuote(q1.versionId, wsIn(st0), pv.planVersion));
const regieTask = (await wl.getPlan(W)).tasks.find((t) => t.quoteLineIds.some((x) => x === R.regie));
const sent = { subtotalCents: rd.totals.subtotalCents, at: un(rd.version.sentAt) };
check("(B0) opzet: werf met de klant, offerte verstuurd en aanvaard (subtotaal na 5 % korting € 11.922,50), werf gestart met een regietaak", !!regieTask && sent.at !== null && sent.subtotalCents === 1_192_250n, S(rd.totals));

const readMM = async (who = calc) => ok(await who.readMinMeer(W));
const rowOf = (v, key) => v.rows.find((r) => r.key === key);
const recheck = (v) => MC.recheck(v);

// B1. De getekende offerte: kolom offerte = de aanneemsom, de korting op het totaal als regel (zoals 2c.6 de schijven rekent).
{
  const v = await readMM();
  const korting = v.rows.find((r) => r.key.startsWith("korting:"));
  check("(B1) kolom offerte: 4 posten (1.250 + 800 + 10.000 + 500) en de korting −627,50 als regel; totaal = het verzonden subtotaal € 11.922,50", v.rows.filter((r) => r.source === "offerte" && r.key.startsWith("offerte:")).length === 4 && korting && korting.offerCents === -62_750n && v.totals.offerCents === sent.subtotalCents, S(v.totals));
  check("(B1) nog niets min of meer: saldo 0, aanneemsom + saldo = nog te factureren = € 11.922,50; de getekende offerte genoemd", v.totals.balanceCents === 0n && v.totals.contractCents === 1_192_250n && v.totals.toInvoiceCents === 1_192_250n && v.baseQuote === `${NR} v1`);
  check("(B1) browser = server (minmeer/calc.ts rekent de view na)", recheck(v).ok);
  check("(B1) auditregel bekeek:min-meer", (await admin.auditLog(0n, 20n)).some((a) => a.action === "bekeek:min-meer"));
}

// B2. De opmeting: afbraak 42 m² gemeten (VH 40) → +2 m² × € 31,25 = € 62,50 meerwerk.
{
  const KM = uid();
  const msync = (op) => wl.measureSync([{ opId: uid(), clientKey: KM, op }]);
  await msync({ open: { workId: W } });
  const [e1] = await msync({ entry: { lineId: R.afbraak, qtyMilli: 42_000n, day: cDay, complete: true, note: "proef 2c5", files: [], corrects: [], reason: "" } });
  const [c1] = await msync({ close: { note: "proef 2c5" } });
  const v = await readMM();
  const r = rowOf(v, `opmeting:${R.afbraak}`);
  check("(B2) opmeting afgesloten; regel 'opmeting': +2 m² × € 31,25 = € 62,50 meerwerk", "done" in e1.outcome && "done" in c1.outcome && r && r.qtyMilli === 2_000n && r.unitCents === 3125n && r.extraCents === 6_250n && r.counted && v.totals.extraCents === 6_250n, S(r));
}

// B3. Regie-uren van het werfverslag: eigen mensen zonder tarief → geen regietarief; dan het tarief van de werf met datum
// (€ 52,50 vanaf 10 dagen geleden, € 57,50 vanaf gisteren); uren op de regiepost van de offerte tellen niet (binnen de raming).
const oaP = (await oa2.me()).person[0].id;
ok(await admin.addMembership(W, [oaP], [], { onderaannemer: null }, [{ confirmHours: null }, { confirmPlanning: null }]));
const report = async (day, atts) => {
  const KR = uid();
  const rsync = (op) => wl.reportSync([{ opId: uid(), clientKey: KR, op }]);
  await rsync({ ensure: { workId: W, day } });
  const out = [];
  for (const a of atts) { const [x] = await rsync({ attendance: { orgId: opt(a.org), personId: [], names: a.names, headcount: a.n, slots: a.slots, regie: true, taskId: opt(a.task), note: "", replaces: [] } }); out.push(x.outcome.done.entityId[0]); }
  await rsync({ finalize: null });
  return out;
};
const [A1] = await report(cDay - 3n, [{ org: null, names: "Proef eigen ploeg", n: 1n, slots: [{ fromMin: 480n, toMin: 660n }] }]); // 3 u
const [A2, A3, A4] = await report(cDay, [
  { org: null, names: "Proef eigen ploeg", n: 1n, slots: [{ fromMin: 480n, toMin: 720n }] }, // 4 u
  { org: dak.id, names: "Proef ploeg Dak", n: 2n, slots: [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }], task: regieTask.id }, // 2 × 8 u = 16 u op de regiepost
  { org: dak.id, names: "Proef Dak los", n: 1n, slots: [{ fromMin: 780n, toMin: 900n }] }, // 2 u, niet bevestigd
]);
ok(await oa2.confirmHours(A3, true, ""));
{
  const v = await readMM();
  const r1 = rowOf(v, `uren:${A1}`);
  check("(B3) eigen mensen zonder regietarief (geen werftarief, geen regiepost, geen tarief in de offerte): gemarkeerd, telt niet", r1 && r1.qtyMilli === 3_000n && r1.flags.includes("geen-regietarief") && !r1.counted, S(r1?.flags));
}
ok(await calc.saveMinMeerRegieRates(W, [{ fromDay: cDay - 10n, sellCents: 5250n, note: "vanaf de start" }, { fromDay: cDay - 1n, sellCents: 5750n, note: "nieuw tarief" }]));
check("(B3) regietarief van de werf: twee tarieven op dezelfde dag of € 0 geweigerd; werfleider en klant zetten geen tarief", /dezelfde dag/.test(errOf(await calc.saveMinMeerRegieRates(W, [{ fromDay: cDay, sellCents: 1n, note: "" }, { fromDay: cDay, sellCents: 2n, note: "" }]))) && /meer dan € 0/.test(errOf(await calc.saveMinMeerRegieRates(W, [{ fromDay: cDay, sellCents: 0n, note: "" }]))) && (await denied(wl.saveMinMeerRegieRates(W, []))) && (await denied(klant.saveMinMeerRegieRates(W, []))));
{
  const v = await readMM();
  const r1 = rowOf(v, `uren:${A1}`), r2 = rowOf(v, `uren:${A2}`), r3 = rowOf(v, `uren:${A3}`), r4 = rowOf(v, `uren:${A4}`);
  check("(B3) regie aan het tarief van de werf op die dag: 3 u × € 52,50 = € 157,50 (3 dagen geleden), 4 u × € 57,50 = € 230,00 (vandaag)", r1.unitCents === 5250n && r1.extraCents === 15_750n && r1.counted && r2.unitCents === 5750n && r2.extraCents === 23_000n && r2.counted, S([r1.unitCents, r2.unitCents]));
  check("(B3) 16 u op de regiepost van de offerte: binnen de raming, telt niet (en komt niet in een versie)", r3 && r3.qtyMilli === 16_000n && r3.flags.includes("binnen-raming") && !r3.counted && !r3.inVersion, S(r3?.flags));
  check("(B3) 2 u van een OA, nog niet bevestigd: telt (zoals de vorderingsstaat) met de markering 'uren-open'", r4 && r4.counted && r4.extraCents === 11_500n && r4.flags.includes("uren-open"), S(r4?.flags));
  check("(B3) de klant ziet geen OA-naam in de omschrijving voor de klant; kantoor wel", r4.description.includes("Proef Dak NV") && !r4.descriptionClient.includes("Dak"), r4.descriptionClient);
}

// B4. De raming afrekenen: de regiepost gaat −100 % (min), de uren erop tellen (meer) aan het werftarief.
const rawEntry = (o) => ({ kind: { extra: null }, chapter: "", root: [], description: "Proef regel 2c5", unit: "st", qtyMilli: 1000n, pctBp: [], day: [], approval: { notNeeded: null }, photoFileId: [], note: "", price: [], ...o });
const SETTLE = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { settle: null }, root: [R.regie], description: "Proef raming regie afgerekend 2c5" })));
check("(B4) een tweede afrekening van dezelfde raming, of een vaste post afrekenen: geweigerd", /al afgerekend/.test(errOf(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { settle: null }, root: [R.regie] })))) && /raming, budget of regiepost/.test(errOf(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { settle: null }, root: [R.metsel] })))));
{
  const v = await readMM();
  const s = rowOf(v, `regel:${SETTLE}`);
  const r3 = rowOf(v, `uren:${A3}`);
  check("(B4) afrekening: −10 u × € 50,00 = −€ 500,00 minwerk; de 16 u tellen nu: 16 × € 57,50 = € 920,00", s && s.lessCents === -50_000n && s.counted && r3.counted && r3.extraCents === 92_000n && !r3.flags.includes("binnen-raming"), S([s?.lessCents, r3.extraCents]));
}

// B5. Regels van kantoor met akkoord: meerwerk onder € 1.000 met "mail op <dag>", een post die voor 30 % vervalt, meerwerk vanaf
// € 1.000 (enkel met een meerwerkofferte), een korting van € 50, reeds gefactureerd vóór de app.
const pr = (o) => [{ unitCents: [], costCents: [], marginBp: [], orgId: [], ...o }];
const E1 = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ chapter: "01 Afbraak", description: "Proef extra stopcontact keuken 2c5", qtyMilli: 2000n, approval: { recorded: { how: "mail", day: cDay } }, price: pr({ unitCents: [8500n] }) })));
const E2 = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { less: null }, root: [R.metsel], description: "Proef metselwerk vervalt deels 2c5", pctBp: [3000n] })));
const bigIn = rawEntry({ chapter: "02 Ruwbouw", description: "Proef extra trap 2c5", approval: { recorded: { how: "mondeling", day: cDay } }, price: pr({ unitCents: [150_000n] }) });
check("(B5) meerwerk van € 1.500 met een mondeling akkoord: geweigerd (vanaf € 1.000 een meerwerkofferte met akkoord vooraf)", /meerwerkofferte met akkoord vooraf/.test(errOf(await calc.saveMinMeerEntry(W, [], 0n, bigIn))));
check("(B5) ook 'niet nodig' volstaat niet vanaf € 1.000; een akkoord met een dag in de toekomst: geweigerd", /meerwerkofferte/.test(errOf(await calc.saveMinMeerEntry(W, [], 0n, { ...bigIn, approval: { notNeeded: null } }))) && /toekomst/.test(errOf(await calc.saveMinMeerEntry(W, [], 0n, { ...bigIn, price: pr({ unitCents: [100n] }), approval: { recorded: { how: "mail", day: cDay + 5n } } }))));
const E3 = ok(await calc.saveMinMeerEntry(W, [], 0n, { ...bigIn, approval: { pending: null } }));
const E4 = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { discount: null }, description: "Proef korting op het meerwerk 2c5", price: pr({ unitCents: [5000n] }) })));
const E5 = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { invoiced: null }, description: "Proef factuur vóór de app 2026-090", day: [cDay - 30n], price: pr({ unitCents: [200_000n] }) })));
{
  const v = await readMM();
  const r1 = rowOf(v, `regel:${E1}`), r2 = rowOf(v, `regel:${E2}`), r3 = rowOf(v, `regel:${E3}`);
  check("(B5) 2 × € 85,00 = € 170,00 meerwerk, akkoord 'mail op <dag>', telt", r1.extraCents === 17_000n && r1.counted && /^mail op /.test(r1.approval));
  check("(B5) de post metselwerk vervalt voor 30 %: −€ 3.000,00 (aan de prijs van de offerte)", r2.lessCents === -300_000n && r2.unitCents === 1_000_000n && un(r2.pctBp) === 3000n && r2.counted, S(r2));
  check("(B5) meerwerk van € 1.500 'wacht': telt niet, gemarkeerd 'meerwerkofferte nodig', in afwachting € 1.500", !r3.counted && r3.flags.includes("meerwerkofferte-nodig") && v.totals.pendingCents === 150_000n, S([r3.flags, v.totals.pendingCents]));
  const d4 = v.discs.find((d) => d.entryId === E4);
  check("(B5) korting € 50 op het totaal = minwerk; reeds gefactureerd vóór de app € 2.000", d4 && d4.lessCents === -5_000n && v.invoiced.some((i) => i.cents === 200_000n && i.title.includes("2026-090")), S(d4));
  check("(B5) een regel wijzigen met een oude stand: geweigerd; met de juiste stand: bewaard", /intussen/.test(errOf(await calc.saveMinMeerEntry(W, [E1], 7n, rawEntry({ chapter: "01 Afbraak", description: "Proef extra stopcontact keuken 2c5", qtyMilli: 2000n, approval: { recorded: { how: "mail", day: cDay } }, price: pr({ unitCents: [8500n] }) })))) && isOk(await calc.saveMinMeerEntry(W, [E1], 0n, rawEntry({ chapter: "01 Afbraak", description: "Proef extra stopcontact keuken 2c5", qtyMilli: 2000n, approval: { recorded: { how: "mail", day: cDay } }, price: pr({ unitCents: [8500n] }), note: "proef: in de keuken" }))));
}

// B6. Kosten van een OA (2.11): een regel "andere" op een OA-factuur; doorrekenen aan kostprijs / 0,8 (kantoor zet het per regel).
const INV = ok(await calc.saveOaInvoice({ id: [], orgId: dak.id, workId: W, number: `MM-${suffix}-1`, invoiceDay: cDay, dueDay: [], periodFrom: [], periodTo: [cDay], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "proef 2c5", netCents: 24_000n, vatCents: 0n, totalCents: 24_000n, lines: [{ kind: { other: null }, root: [], description: "Proef container afvoer 2c5", qtyMilli: 1000n, unitCents: 24_000n, amountCents: 24_000n }] }, 0n));
const KOST = `kost:oa:${INV}:0`;
{
  const v = await readMM();
  const k = rowOf(v, KOST);
  check("(B6) de kost staat er, niet doorgerekend (telt niet, niet in een versie); kostprijs € 240 en marge 20 % enkel voor kantoor", k && !k.counted && !k.inVersion && k.flags.includes("niet-doorgerekend") && un(k.costCents) === 24_000n && un(k.marginBp) === 2000n && k.unitCents === 30_000n, S(k));
}
check("(B6) doorrekenen zonder reden, of een regel van de offerte aanpassen: geweigerd", /reden/.test(errOf(await calc.setMinMeerOverride(W, { key: KOST, exclude: false, chapter: [], passOn: true, reason: "" }))) && /Enkel een regel uit/.test(errOf(await calc.setMinMeerOverride(W, { key: `offerte:${R.afbraak}`, exclude: true, chapter: [], passOn: false, reason: "proef 2c5" }))));
ok(await calc.setMinMeerOverride(W, { key: KOST, exclude: false, chapter: [], passOn: true, reason: "proef: afvoer voor rekening van de klant" }));
{
  const v = await readMM();
  const k = rowOf(v, KOST);
  check("(B6) doorgerekend: € 240,00 / 0,8 = € 300,00 meerwerk", k.counted && k.inVersion && k.extraCents === 30_000n);
}
ok(await calc.setMinMeerOverride(W, { key: `opmeting:${R.afbraak}`, exclude: true, chapter: [], passOn: false, reason: "proef: meting wordt herdaan" }));
{
  const v = await readMM();
  const o = rowOf(v, `opmeting:${R.afbraak}`);
  check("(B6) een opmetingsregel uitsluiten (met reden): telt niet, niet in een versie", o.excluded && !o.counted && !o.inVersion && o.note.includes("herdaan"));
}
ok(await calc.setMinMeerOverride(W, { key: `opmeting:${R.afbraak}`, exclude: false, chapter: ["01 Afbraak (meting)"], passOn: false, reason: "proef: ander hoofdstuk" }));
{
  const v = await readMM();
  const o = rowOf(v, `opmeting:${R.afbraak}`);
  check("(B6) dezelfde regel naar een ander hoofdstuk: telt weer, chapterFrom = het oude hoofdstuk", !o.excluded && o.counted && o.chapter === "01 Afbraak (meting)" && o.chapterFrom === "01 Afbraak");
}

// B7. De werfleider: hoeveelheden en uren zonder één bedrag; een voorstel zonder prijs; geen kostenregels; geen prijzen of versies.
{
  check("(B7) werfleider: een voorstel met prijs, van een andere soort of met 'niet nodig': geweigerd", /De prijs zet kantoor/.test(errOf(await wl.saveMinMeerEntry(W, [], 0n, rawEntry({ approval: { pending: null }, price: pr({ unitCents: [1n] }) })))) && /meerwerk of minwerk/.test(errOf(await wl.saveMinMeerEntry(W, [], 0n, rawEntry({ kind: { cost: null }, approval: { pending: null } })))) && /wacht op kantoor/.test(errOf(await wl.saveMinMeerEntry(W, [], 0n, rawEntry({}))))) ;
}
const P1 = ok(await wl.saveMinMeerEntry(W, [], 0n, rawEntry({ chapter: "01 Afbraak", description: "Proef extra lichtpunt 2c5", qtyMilli: 3000n, approval: { pending: null } })));
{
  const q = await wl.minMeerQty(W);
  const p = q.rows.find((r) => r.entryId.length && r.entryId[0] === P1);
  check("(B7) het voorstel staat in de staat van de werfleider (van hem, 'te prijzen', telt niet); kantoor krijgt een melding", p && p.mine && p.flags.includes("te-prijzen") && !p.counted && (await calc.myNotifications(true)).some((n) => n.text.includes("Proef extra lichtpunt 2c5")), S(p));
  check("(B7) minMeerQty: geen enkel veld met een bedrag, geen kostenregels, geen korting van de offerte, wel uren en hoeveelheden", noMoney(q) && !q.rows.some((r) => r.key.startsWith("kost:") || r.key.startsWith("korting:")) && q.rows.some((r) => r.key === `uren:${A3}` && r.qtyMilli === 16_000n) && q.scope === "qty" && q.canPropose);
  check("(B7) werfleider: readMinMeer, prijzen, uitsluiten, versie maken en een meerwerkofferte geweigerd", (await denied(wl.readMinMeer(W))) && (await denied(wl.setMinMeerOverride(W, { key: KOST, exclude: true, chapter: [], passOn: false, reason: "proef" }))) && (await denied(wl.makeMinMeerVersion(W, "", { balanceCents: 0n, toInvoiceCents: 0n }))) && (await denied(wl.makeExtraWorkQuote(W, [], "x"))) && /past kantoor aan/.test(errOf(await wl.saveMinMeerEntry(W, [P1], 0n, rawEntry({ approval: { pending: null } })))));
  check("(B7) de werfleider haalt zijn eigen voorstel (zonder prijs) weg; een regel van kantoor niet", (await denied(wl.archiveMinMeerEntry(E1, "proef 2c5"))) && isOk(await wl.archiveMinMeerEntry(ok(await wl.saveMinMeerEntry(W, [], 0n, rawEntry({ description: "Proef weg 2c5", approval: { pending: null } }))), "proef: vergissing")));
  check("(B7) OA, klant, architect, VC en een onbekende login: de staat en voorstellen geweigerd", (await Promise.all([oa2, klant, arch, vreemd].flatMap((x) => [denied(x.minMeerQty(W)), denied(x.saveMinMeerEntry(W, [], 0n, rawEntry({ approval: { pending: null } }))), denied(x.readMinMeer(W))]))).every(Boolean));
}
// Kantoor prijst het voorstel: 3 × € 45,00 = € 135,00 met akkoord mondeling.
ok(await calc.saveMinMeerEntry(W, [P1], 0n, rawEntry({ chapter: "01 Afbraak", description: "Proef extra lichtpunt 2c5", qtyMilli: 3000n, approval: { recorded: { how: "mondeling", day: cDay } }, price: pr({ costCents: [3600n] }) })));
{
  const v = await readMM();
  const p = rowOf(v, `regel:${P1}`);
  check("(B7) kantoor prijst het voorstel uit kostprijs € 36 / 0,8 = € 45,00: 3 × 45 = € 135,00, telt; het blijft 'voorstel werfleider'", p.unitCents === 4500n && p.extraCents === 13_500n && p.counted && p.source === "voorstel", S(p));
}

// B8. De totalen (met de hand nagerekend) en browser = server.
// offerte 11.922,50 · meer 62,50 + 157,50 + 230 + 920 + 115 + 170 + 300 + 135 = 2.090,00 · min −3.000 − 500 − 50 = −3.550,00
const T1 = { offer: 1_192_250n, extra: 209_000n, less: -355_000n };
let v1view = await readMM();
{
  const t = v1view.totals;
  check("(B8) totalen: offerte € 11.922,50, meerwerk € 2.090,00, minwerk −€ 3.550,00, saldo −€ 1.460,00, in afwachting € 1.500", t.offerCents === T1.offer && t.extraCents === T1.extra && t.lessCents === T1.less && t.balanceCents === T1.extra + T1.less && t.pendingCents === 150_000n, S(t));
  check("(B8) aanneemsom + saldo € 10.462,50; reeds gefactureerd € 2.000; nog te factureren € 8.462,50", t.contractCents === 1_046_250n && t.invoicedCents === 200_000n && t.toInvoiceCents === 846_250n, S(t));
  const rc = recheck(v1view);
  check("(B8) browser = server: dezelfde totalen; per regel dezelfde bedragen", rc.ok && v1view.rows.every((r) => { const o = MC.line(MC.lineOf(r)); return o.offerCents === r.offerCents && o.lessCents === r.lessCents && o.extraCents === r.extraCents; }), S(rc.totals.balanceCents));
  check("(B8) wat aandacht vraagt: meerwerkofferte nodig, uren open", v1view.findings.some((f) => f.key === "meerwerkofferte-nodig") && v1view.findings.some((f) => f.key === "uren-open"), S(v1view.findings.map((f) => f.key)));
}

// B9. Versie 1 onder een controlecode.
check("(B9) versie met een ander saldo dan de server (de staat veranderde): geweigerd", /veranderde intussen/.test(errOf(await calc.makeMinMeerVersion(W, "", { balanceCents: 1n, toInvoiceCents: v1view.totals.toInvoiceCents }))));
const V1 = ok(await calc.makeMinMeerVersion(W, "proef: eerste afrekening", { balanceCents: v1view.totals.balanceCents, toInvoiceCents: v1view.totals.toInvoiceCents }));
const rv1 = ok(await calc.readMinMeerVersion(V1));
{
  const f = rv1.frozen;
  check("(B9) versie 1: nummer 1, controlecode (64 tekens), intact, totalen = de levende staat", rv1.brief.number === 1n && /^[0-9a-f]{64}$/.test(rv1.hash) && rv1.intact && f.totals.balanceCents === v1view.totals.balanceCents && f.totals.toInvoiceCents === v1view.totals.toInvoiceCents, rv1.hash);
  check("(B9) in de versie: geen kostprijs, geen marge, geen OA-naam; de niet doorgerekende en uitgesloten regels niet", noMoney(f.lines.map((l) => ({ d: l.description, s: l.source, a: l.approval, n: l.note }))) && !S(f).includes("Proef Dak NV") && !S(f).includes("Proef ploeg Dak") && !f.lines.some((l) => l.key === `uren:${A3}` && !l.counted) && f.lines.some((l) => l.key === KOST && l.source === "kost"), S(f.lines.filter((l) => l.key.startsWith("kost")).map((l) => l.description)));
  check("(B9) klant en werfleider zien de versie (nog) niet; de werfleider ziet ze in de lijst zonder bedrag", (await denied(klant.readMyMinMeer(V1))) && (await denied(wl.readMinMeerVersion(V1))) && (await wl.minMeerQty(W)).versions.some((x) => x.id === V1 && !x.isShared));
}

// B10. De meerwerkofferte (⚖3): uit de regel van € 1.500 → "<offerte>-M1", een gewone offerte van de soort meerwerk; zolang ze niet
// aanvaard is, telt niets; aanvaard tellen haar posten als meerwerk (met haar eigen akkoord). Ook onder € 1.000 kan het (niet verplicht).
const NOPRICE = ok(await calc.saveMinMeerEntry(W, [], 0n, rawEntry({ description: "Proef zonder prijs 2c5", approval: { pending: null } })));
check("(B10) een meerwerkofferte met een regel zonder prijs, een korting of een onbekende regel: geweigerd", /nog geen prijs/.test(errOf(await calc.makeExtraWorkQuote(W, [NOPRICE], "Proef"))) && /enkel meerwerk/.test(errOf(await calc.makeExtraWorkQuote(W, [E4], "Proef"))) && /Onbekende regel/.test(errOf(await calc.makeExtraWorkQuote(W, [999_999n], "Proef"))));
ok(await calc.archiveMinMeerEntry(NOPRICE, "proef: enkel voor de weigering"));
const MQ = ok(await calc.makeExtraWorkQuote(W, [E3], "Proef meerwerk trap 2c5"));
{
  const r = ok(await calc.readQuoteVersion(MQ.versionId));
  const f = un(r.form);
  check("(B10) meerwerkofferte: nummer <offerte>-M1, soort meerwerk bij de getekende offerte, één post € 1.500 (vaste prijs), ontwerp", MQ.number === `${NR}-M1` && f && "extraWork" in f.kind && f.baseNumber === NR && r.lines.length === 1 && r.totals.subtotalCents === 150_000n, S([MQ.number, f?.baseNumber, r.totals.subtotalCents]));
  check("(B10) de soort van een meerwerkofferte verandert niet; een gewone offerte wordt geen meerwerkofferte via de soort", /blijft een meerwerkofferte/.test(errOf(await calc.setQuoteInfo(MQ.quoteId, { kind: { standard: null }, insurerOrgId: [], claimRef: "" }))) && /maakt u in/.test(errOf(await calc.setQuoteInfo(q1.quoteId, { kind: { extraWork: null }, insurerOrgId: [], claimRef: "" }))));
  const v = await readMM();
  const e3 = rowOf(v, `regel:${E3}`);
  check("(B10) de regel wacht nu op de meerwerkofferte (telt niet; in afwachting € 1.500); dezelfde regel kan niet in een tweede meerwerkofferte", !e3.counted && e3.flags.includes("wacht-op-meerwerkofferte") && /meerwerkofferte .*-M1/.test(e3.approval) && /zit al in een meerwerkofferte/.test(errOf(await calc.makeExtraWorkQuote(W, [E3], "Proef"))), S(e3));
  check("(B10) een regel die bij een meerwerkofferte hoort, past men niet aan in de min-meerstaat", /hoort bij een meerwerkofferte/.test(errOf(await calc.saveMinMeerEntry(W, [E3], 1n, { ...bigIn, approval: { pending: null } }))));
  const rq = ok(await calc.readQuoteVersion(MQ.versionId));
  ok(await calc.sendQuoteVersion(MQ.versionId, rq.version.rev, rq.totals.totalCents, "proef 2c5: meerwerkofferte"));
}
// De klant aanvaardt de meerwerkofferte zelf (2.7): lid van de werf als klant.
ok(await admin.addMembership(W, [KLANT.id], [], { klant: null }, []));
{
  const mine = await klant.listMyQuotes();
  const mq = mine.find((x) => x.versionId === MQ.versionId);
  const rq = ok(await klant.readMyQuote(MQ.versionId));
  check("(B10) de klant ziet de meerwerkofferte (soort meerwerk, bij offerte …) en aanvaardt ze met zijn eigen akkoord", !!mq && un(rq.form) && "extraWork" in un(rq.form).kind && un(rq.form).baseNumber === NR && isOk(await klant.acceptMyQuote(MQ.versionId, rq.hash)), S(mq));
}
const MROOT = ok(await calc.readQuoteVersion(MQ.versionId)).lines[0].id;
{
  const v = await readMM();
  const m = rowOf(v, `offerte:${MROOT}`);
  const e3 = rowOf(v, `regel:${E3}`);
  check("(B10) aanvaard: de post van de meerwerkofferte telt als meerwerk € 1.500 ('meerwerkofferte … aanvaard op …'); de regel zelf komt niet meer in een versie", m && m.source === "meerwerkofferte" && m.extraCents === 150_000n && m.counted && /aanvaard op/.test(m.approval) && !e3.inVersion && v.totals.pendingCents === 0n && v.totals.extraCents === T1.extra + 150_000n, S([m?.approval, v.totals.extraCents]));
  check("(B10) onder € 1.000: een meerwerkofferte kan ook (niet verplicht); de regel van € 170 telde al met het akkoord per mail", rowOf(v, `regel:${E1}`).counted && isOk(await calc.makeExtraWorkQuote(W, [P1], "Proef meerwerk lichtpunten 2c5")));
  v1view = v;
}
// De vorderingsstaat (2.10) kent de post van de meerwerkofferte als meerwerk.
{
  const n = ok(await calc.newProgress(W));
  const q = await calc.progressQty(n);
  const ln = q.lines.find((l) => l.root === MROOT);
  check("(B10) de vorderingsstaat neemt de post van de aanvaarde meerwerkofferte op als meerwerk", ln && "extra" in ln.section, S(ln?.section));
  const f = ok(await calc.readProgressStatement(n));
  ok(await calc.sendProgress(n, f.brief.rev, f.totals.totalCents, "proef 2c5: waarschuwingen doorgezet"));
  const v = await readMM();
  const vs = ok(await calc.readProgressStatement(n));
  check("(B10) reeds gefactureerd: ook de verzonden vorderingsstaat (excl. btw)", v.invoiced.some((i) => i.title.startsWith("vorderingsstaat") && i.cents === vs.totals.subtotalCents) && v.totals.invoicedCents === 200_000n + vs.totals.subtotalCents, S(v.invoiced));
  v1view = v;
}

// B11. Versie 2 toont wat veranderde; delen met de klant; akkoord op de exacte versie.
const V2 = ok(await calc.makeMinMeerVersion(W, "", { balanceCents: v1view.totals.balanceCents, toInvoiceCents: v1view.totals.toInvoiceCents }));
const rv2 = ok(await calc.readMinMeerVersion(V2));
check("(B11) versie 2: nummer 2 (teller per werf), andere controlecode; tegenover versie 1: de post van de meerwerkofferte nieuw (+€ 1.500)", rv2.brief.number === 2n && rv2.hash !== rv1.hash && un(rv2.prevNumber) === 1n && rv2.changes.some((c) => c.kind === "nieuw" && c.description === "Proef extra trap 2c5" && c.balanceDeltaCents === 150_000n), S(rv2.changes));
check("(B11) versie 1 verandert niet: dezelfde controlecode en inhoud", (ok(await calc.readMinMeerVersion(V1))).hash === rv1.hash && ok(await calc.readMinMeerVersion(V1)).intact);
check("(B11) vóór het delen: de klant ziet niets", (await klant.listMyMinMeer()).every((x) => x.workId !== W));
check("(B11) delen: werfleider en klant geweigerd", (await denied(wl.shareMinMeerVersion(V2))) && (await denied(klant.shareMinMeerVersion(V2))));
ok(await calc.shareMinMeerVersion(V2));
check("(B11) twee keer delen: geweigerd", /al gedeeld/.test(errOf(await calc.shareMinMeerVersion(V2))));
{
  const mine = (await klant.listMyMinMeer()).filter((x) => x.workId === W);
  const r = ok(await klant.readMyMinMeer(V2));
  check("(B11) de klant ziet enkel de gedeelde versie 2 (niet versie 1) en kreeg een melding", mine.length === 1 && mine[0].id === V2 && mine[0].canAnswer && (await klant.myNotifications(true)).some((n) => n.text.includes("Min-meerstaat versie 2")), S(mine));
  check("(B11) zijn versie: verkoopbedragen, geen sleutel, kostprijs, marge of OA-naam; totalen = die van kantoor", !keysOf(r).has("key") && !keysOf(r).has("costCents") && !keysOf(r).has("marginBp") && !keysOf(r).has("orgName") && !S(r).includes("Proef Dak NV") && r.totals.toInvoiceCents === rv2.frozen.totals.toInvoiceCents && r.lines.length === rv2.frozen.lines.length, S(Object.keys(r)));
  check("(B11) de vorige versie is niet gedeeld: geen 'wat veranderde'", r.changes.length === 0);
  check("(B11) akkoord met een verkeerde controlecode: geweigerd; opmerking zonder tekst: geweigerd", /laad opnieuw/.test(errOf(await klant.answerMyMinMeer(V2, "x".repeat(64), true, ""))) && /Schrijf wat/.test(errOf(await klant.answerMyMinMeer(V2, r.hash, false, ""))));
  ok(await klant.answerMyMinMeer(V2, r.hash, true, ""));
  check("(B11) akkoord bewaard (één keer); kantoor ziet het en kreeg een melding", /antwoordde al/.test(errOf(await klant.answerMyMinMeer(V2, r.hash, true, ""))) && un(ok(await calc.readMinMeerVersion(V2)).answer)?.ok === true && (await calc.myNotifications(true)).some((n) => n.text.includes("Akkoord van de klant op min-meerstaat versie 2")));
}
ok(await calc.shareMinMeerVersion(V1));
check("(B11) versie 1 ook gedeeld: de klant ziet bij versie 2 wat veranderde tegenover versie 1", ok(await klant.readMyMinMeer(V2)).changes.some((c) => c.kind === "nieuw" && c.balanceDeltaCents === 150_000n));

// B12. Een andere klant op dezelfde werf, de architect met en zonder de grant vorderingsstaten, een gearchiveerde persoon.
{
  const KLANT2 = ok(await admin.createOrg({ kind: { client: null }, name: `Proef Klant Merel 2c5 ${suffix}`, kbo: [], vat: [], aliases: [], trades: [], address: [{ street: "Proefdreef", number: "9", zip: "9993", city: "Lindegem", country: "BE" }], notes: "Verzonnen proefklant (2c.5)" })).id;
  const k2 = await freshBackend(cid);
  const inv = ok(await admin.invitePerson({ name: `Proef Klant Twee ${suffix}`, roles: [{ klant: null }], orgId: [KLANT2], shortCode: [], lang: [], phone: [], workIds: [W], validDays: 1n, tag: "proef 2c5" }));
  ok(await k2.redeemCode(inv.code));
  check("(B12) een klant van een andere firma op dezelfde werf: geen versies, lezen en antwoorden geweigerd", (await k2.listMyMinMeer()).length === 0 && (await denied(k2.readMyMinMeer(V2))) && (await denied(k2.answerMyMinMeer(V2, rv2.hash, true, ""))));
  const archP = (await arch.me()).person[0].id;
  const memId = ok(await admin.addMembership(W, [archP], [], { architect: null }, []));
  check("(B12) architect zonder de grant vorderingsstaten: niets", (await arch.listMyMinMeer()).every((x) => x.workId !== W) && (await denied(arch.readMyMinMeer(V2))));
  ok(await admin.setMemberGrants(memId, [{ readProgress: null }]));
  const ar = await arch.readMyMinMeer(V2);
  check("(B12) architect met de grant: leest de gedeelde versies, zonder kostprijs of OA-naam; antwoorden niet", isOk(ar) && !S(ar).includes("Proef Dak NV") && !ar.ok.canAnswer && (await denied(arch.answerMyMinMeer(V2, rv2.hash, true, ""))), errOf(ar));
  const k3 = await freshBackend(cid);
  const inv3 = ok(await admin.invitePerson({ name: `Proef Klant Weg ${suffix}`, roles: [{ klant: null }], orgId: opt(KLANTORG), shortCode: [], lang: [], phone: [], workIds: [W], validDays: 1n, tag: "proef 2c5" }));
  const me3 = ok(await k3.redeemCode(inv3.code));
  const before = (await k3.listMyMinMeer()).some((x) => x.id === V2);
  ok(await admin.archivePerson(me3.person[0].id));
  check("(B12) een tweede persoon van de klant ziet de versie; gearchiveerd: niets meer", before && (await denied(k3.listMyMinMeer())) && (await denied(k3.readMyMinMeer(V2))));
}

// B13. De werfleider van een andere werf ("werfleider ziet alles" uit) en een gearchiveerde calculator.
{
  const W2 = ok(await admin.createWork({ code: `P-MN${suffix}`, name: "Proef andere werf 2c5", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n })).id;
  const s0 = await admin.getSettings();
  const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
  try {
    ok(await admin.setSettings(setIn(false)));
    check("(B13) werfleider van een andere werf: de staat en een voorstel daar geweigerd; op zijn eigen werf wel", (await denied(wl.minMeerQty(W2))) && (await denied(wl.saveMinMeerEntry(W2, [], 0n, rawEntry({ approval: { pending: null } })))) && (await wl.minMeerQty(W)).rows.length > 0);
  } finally { ok(await admin.setSettings(setIn(s0.werfleiderZietAlles))); }
  const gone = await freshBackend(cid);
  const inv = ok(await admin.invitePerson({ name: `Proef Calculator Weg 2c5 ${suffix}`, roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "proef 2c5" }));
  const me = ok(await gone.redeemCode(inv.code));
  if (!("active" in me.status)) ok(await admin.confirmLink(me.principal));
  const okBefore = isOk(await gone.readMinMeer(W));
  ok(await admin.archivePerson(me.person[0].id));
  check("(B13) een tweede calculator leest de staat; gearchiveerd: lezen, regels, versies geweigerd", okBefore && (await denied(gone.readMinMeer(W))) && (await denied(gone.saveMinMeerEntry(W, [], 0n, rawEntry({})))) && (await denied(gone.readMinMeerVersion(V2))));
}

// B14. Export (intern zonder bedragen, vertrouwelijk apart) en de instellingen.
{
  const ei = await admin.exportIntern();
  const ec = await admin.exportConfidential();
  check("(B14) export intern: regels, aanpassingen, versies, akkoorden (zonder bedragen); vertrouwelijk: prijzen, regietarief, inhoud van de versies", ei.mmEntries.some((e) => e.id === E1) && ei.mmOverrides.some((o) => o.key === KOST) && ei.mmVersions.some((x) => x.id === V2) && ei.mmAnswers.some((a) => a.versionId === V2) && noMoney(ei.mmEntries) && ec.mmPrices.some(([id]) => id === E1) && ec.mmRegieRates.some(([w]) => w === W) && ec.mmFrozen.some(([id]) => id === V2));
  check("(B14) export in stukken: mmFrozen vraagt de rechten van kantoor (calculator geweigerd)", (await denied(calc.exportChunk("mmFrozen", 0n, 10n))) && isOk(await admin.exportChunk("mmFrozen", 0n, 10n)));
  const s0 = ok(await calc.minMeerSettings());
  check("(B14) instellingen: meerwerkofferte vanaf € 1.000, doorrekenen 20 %, klantakkoord mogelijk; werfleider en klant lezen ze niet", s0.quoteFromCents === 100_000n && s0.passOnBp === 2000n && s0.client === "mogelijk" && (await denied(wl.minMeerSettings())) && (await denied(klant.minMeerSettings())));
  check("(B14) instellingen zetten: enkel de beheerder; een onbekende kostensoort geweigerd", (await denied(calc.saveMinMeerSettings({ quoteFromCents: 100_000n, passOnBp: 2000n, passOnByKind: [], client: "mogelijk" }))) && /Onbekende kostensoort/.test(errOf(await admin.saveMinMeerSettings({ quoteFromCents: 100_000n, passOnBp: 2000n, passOnByKind: [["x", 1n]], client: "mogelijk" }))));
  ok(await admin.saveMinMeerSettings({ quoteFromCents: 100_000n, passOnBp: 2000n, passOnByKind: [["andere", 4000n]], client: "mogelijk" }));
  const k = rowOf(await readMM(), KOST);
  check("(B14) een andere marge voor de kostensoort 'andere' (40 %): € 240 / 0,6 = € 400,00", k.extraCents === 40_000n && un(k.marginBp) === 4000n, S(k.extraCents));
  ok(await admin.saveMinMeerSettings({ quoteFromCents: 100_000n, passOnBp: 2000n, passOnByKind: [], client: "mogelijk" }));
}

// B15. .did-controle: wat de werfleider, de klant (lijst) en de versielijst krijgen, draagt geen enkel bedragveld.
{
  const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
  const typeBody = (name) => { const m = did.match(new RegExp(`^type ${name} =\\s*(record \\{[\\s\\S]*?\\n \\});`, "m")); return m ? m[1] : null; };
  const names = ["MinMeerQtyView", "MmQtyRow", "MmVersionBrief", "MyMinMeerBrief", "MmPostRef"];
  const bad = names.filter((n) => { const b = typeBody(n); return b === null || /cents|cost|price|margin|amount/i.test(b); });
  check("(B15) .did: MinMeerQtyView, MmQtyRow, MmVersionBrief, MyMinMeerBrief, MmPostRef zonder bedragveld", bad.length === 0, bad.join(", "));
}

// B16. Rekentest (§10): browser = server op willekeurige regels (meer- en minwerk, kosten met marge, korting % en bedrag, deel van een
// post, wachtend), elke ronde nagerekend met minmeer/calc.ts en daarna weggehaald. MM_RONDES=n voor meer of minder.
{
  let seed = 20261101;
  const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
  const N = Number(process.env.MM_RONDES ?? 40);
  const chs = ["01 Afbraak", "02 Ruwbouw", "", "04 Proef"];
  let same = 0;
  let rounds = 0;
  let firstBad = "";
  for (let i = 0; i < N; i++) {
    const made = [];
    const k = 1 + rnd(4);
    for (let j = 0; j < k; j++) {
      const t = rnd(6);
      const qty = BigInt(rnd(9000) + 1) * (rnd(3) === 0 ? 1n : 10n);
      const unit = BigInt(rnd(90_000) + 1);
      const ch = chs[rnd(chs.length)];
      const appr = rnd(4) === 0 ? { pending: null } : { notNeeded: null };
      const small = (q, u) => (q * u) / 1000n < 99_000n; // onder de drempel
      let inp;
      if (t === 0 && small(qty, unit)) inp = rawEntry({ chapter: ch, description: `Proef rekentest meer ${i}.${j}`, qtyMilli: qty, approval: appr, price: pr({ unitCents: [unit] }) });
      else if (t === 1) inp = rawEntry({ kind: { less: null }, chapter: ch, description: `Proef rekentest min ${i}.${j}`, qtyMilli: qty, approval: appr, price: pr({ unitCents: [unit] }) });
      else if (t === 2 && small(qty, unit)) inp = rawEntry({ kind: { cost: null }, chapter: ch, description: `Proef rekentest kost ${i}.${j}`, qtyMilli: qty, approval: appr, price: pr({ costCents: [unit], marginBp: [BigInt(rnd(5000))] }) });
      else if (t === 3) inp = rawEntry({ kind: { discount: null }, chapter: ch, description: `Proef rekentest korting ${i}.${j}`, pctBp: [BigInt(rnd(3000) + 1)], approval: appr });
      else if (t === 4) inp = rawEntry({ kind: { discount: null }, chapter: ch, description: `Proef rekentest korting € ${i}.${j}`, approval: appr, price: pr({ unitCents: [unit] }) });
      else inp = rawEntry({ kind: { less: null }, root: [R.metsel], description: `Proef rekentest deel ${i}.${j}`, pctBp: [BigInt(rnd(10_000) + 1)], approval: appr });
      const r = await calc.saveMinMeerEntry(W, [], 0n, inp);
      if (isOk(r)) made.push(r.ok); else if (!firstBad) firstBad = errOf(r);
    }
    const v = await readMM();
    rounds++;
    const rc = MC.recheck(v);
    const per = v.rows.every((r) => { const o = MC.line(MC.lineOf(r)); return o.amountCents === r.amountCents && o.lessCents === r.lessCents && o.extraCents === r.extraCents && o.offerCents === r.offerCents; }) && v.discs.every((d, x) => rc.totals.discs[x].lessCents === d.lessCents);
    if (rc.ok && per) same++; else if (!firstBad) firstBad = `ronde ${i}: ${S([rc.totals.balanceCents, v.totals.balanceCents])}`;
    for (const id of made) await calc.archiveMinMeerEntry(id, "proef: rekentest");
  }
  check(`(B16) rekentest: browser = server op ${rounds} willekeurige rondes (regels per ronde 1–4)`, same === rounds && rounds === N, firstBad);
  const back = await readMM();
  check("(B16) na de rekentest: dezelfde totalen als vóór (alle proefregels weggehaald)", back.totals.balanceCents === v1view.totals.balanceCents && back.totals.toInvoiceCents === v1view.totals.toInvoiceCents, S([back.totals.balanceCents, v1view.totals.balanceCents]));
}

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
