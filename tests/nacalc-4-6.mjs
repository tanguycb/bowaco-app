// Nacalculatie (stap 4.6): gepland (getekende offerte) tegenover werkelijk (min-meerstaat, goedgekeurde aankoopfacturen) op een canister
// die al in gebruik is (het eigen net, na tests/rollen.mjs). Bewijst:
//   (1) rechten: enkel admin en calculator lezen readNacalc, nacalcOverview en de drempel; werfleider, architect, OA, klant, veiligheids-
//       coördinator en anoniem krijgen niets; de drempel zetten kan enkel de beheerder; elk lezen laat een auditregel na;
//   (2) rekentest: de browser (src/frontend/src/nacalc/calc.ts) = een EIGEN berekening uit de gewone oproepen (readQuoteVersion,
//       readPurchase, readMinMeer), per werf, per OA, per hoofdstuk en per posttype, en de vaste verwachte bedragen;
//   (3) afwijkingen en drempel: meer dan gepland valt op, niet-gepland, wachtende kosten tellen niet mee, voorschotten niet; de drempel
//       (instelbaar) verandert de vlag; "minder" enkel bij een opgeleverde werf;
//   (4) het overzicht: werven met een getekende offerte, niet de werf zonder; zelfde totalen als het werfscherm.
// Enkel VERZONNEN gegevens: firma's "Proef … 46", gemeente Lindegem, postcode 9993.
//   node tests/nacalc-4-6.mjs <canister-id>
import { backend, freshBackend } from "../tools/lib.mjs";
import { M, saveAll, fromRead } from "./offerte-lib.mjs";
import * as NC from "../src/frontend/src/nacalc/calc.ts";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/nacalc-4-6.mjs <canister-id>");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const errOf = (r) => (r && typeof r === "object" && "err" in r ? r.err : "");
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject|Unauthorized/i.test(String(e)); } };
const un = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64));
const EXC = { exception: "Proef 4.6: verzonnen uitzondering voor de test" };

const [admin, calc, wl, arch, klant, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const anon = await backend(null, cid);
const oaR = await freshBackend(cid);
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const wd = (d) => (Number(d) + 3) % 7;
const nextWd = (d) => { let x = BigInt(d); while (wd(x) > 4) x++; return x; };
const s0 = await admin.getSettings();
const setIn = (z) => ({ werfleiderZietAlles: z, inviteDays: s0.inviteDays, threshold30bisCents: s0.threshold30bisCents, thresholdCheckinatworkCents: s0.thresholdCheckinatworkCents });
const oi0 = await admin.oaInvoiceSettings();
const ps0 = await admin.purchaseSettings();
const nc0 = await calc.nacalcSettings();
ok(await admin.setSettings(setIn(false)));
ok(await admin.saveOaInvoiceSettings({ thresholdBp: 200n, thresholdCents: 1_000n, oaView: false, disputeNotice: "melding" }));
ok(await admin.savePurchaseSettings({ askHours: "verschil", passOn: true }));
ok(await admin.saveNacalcSettings({ pctBp: 1_000n, minCents: 25_000n }));
try {

// ── B0. Opzet: een OA, een leverancier, een klant; W1 (getekende offerte + facturen), W2 (enkel getekende offerte), W3 (geen offerte) ──
const addr = { street: "Proefweg", number: "7", zip: "9993", city: "Lindegem", country: "BE" };
const orgOf = async (name, kind = "subcontractor") => ok(await admin.createOrg({ kind: { [kind]: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: [addr], notes: "Verzonnen proeffirma (4.6)" })).id;
const REIGER = await orgOf(`Proef Bouw Reiger 46 ${sfx}`);
const KWARTEL = await orgOf(`Proef Bouwstoffen Kwartel 46 ${sfx}`, "supplier");
const KLANTORG = await orgOf(`Proef Klant Vink 46 ${sfx}`, "client");
{ const c = ok(await admin.invitePerson({ name: `Proef OA Reiger ${sfx}`, roles: [{ onderaannemer: null }], orgId: [REIGER], shortCode: [], lang: [], phone: [], workIds: [], validDays: 0n, tag: "proef 4.6" })); ok(await oaR.redeemCode(c.code)); }
const WLID = (await wl.me()).person[0].id;
const mkWork = async (code, leader = true) => ok(await admin.createWork({ code, name: "Proef nacalculatie 46", address: addr, parentId: [], clientOrgId: [KLANTORG], architectOrgId: [], leaderPersonId: leader ? [WLID] : [], vatBp: 2100n, plannedStart: [], plannedEnd: [], estimatedAmountCents: [] })).id;
const W1 = await mkWork(`P-NC1${sfx}`);
const W2 = await mkWork(`P-NC2${sfx}`);
const W3 = await mkWork(`P-NC3${sfx}`);
ok(await admin.addMembership(W1, [(await oaR.me()).person[0].id], [], { onderaannemer: null }, []));
const price = (cost, orgId = null) => ({ cost, rule: null, reason: "", orgId, source: orgId ? "oa-offerte" : "eigen", libCostId: null });
const fileW = ok(await calc.addFile("proef-nacalculatie-46.pdf", "application/pdf", 40_000n, fakeBlob("a"), [W1], true));
const inp = (startDay) => ({ target: { existing: null }, startDay, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: false });
const sign = async (workId, build) => {
  const q = ok(await calc.createQuote({ workId, number: "", title: "Proef offerte 46" }));
  const m = fromRead(ok(await calc.readQuoteVersion(q.versionId)));
  build(m);
  ok(await saveAll(calc, m));
  const r = ok(await calc.readQuoteVersion(q.versionId));
  ok(await calc.sendQuoteVersion(q.versionId, r.version.rev, r.totals.totalCents, "proef 4.6: waarschuwingen doorgezet"));
  ok(await calc.decideQuoteVersion(q.versionId, true, "proef 4.6: akkoord"));
  const startDay = nextWd(cDay - 20n);
  const pv = ok(await wl.workStartPreview(q.versionId, inp(startDay)));
  ok(await wl.startWorkFromQuote(q.versionId, inp(startDay), pv.planVersion));
  return q;
};
// W1: hoofdstuk 01 post A (100 st, aankoop € 10 van Reiger → verkoop € 12,50), hoofdstuk 02 post B (50 st, aankoop € 4 van Kwartel) en
// post C (10 st zonder aankoopprijs: eigen prestatie, vaste verkoopprijs).
const q1 = await sign(W1, (m) => {
  const c1 = M.addChapter(m, { code: "01", title: "Proef ruwbouw 46" });
  M.addLine(m, c1.key, { title: "Proef muur 46", qtyMilli: 100_000n, unit: "st", form: "fixed", price: price(1000n, REIGER) });
  const c2 = M.addChapter(m, { code: "02", title: "Proef afwerking 46" });
  M.addLine(m, c2.key, { title: "Proef pleister 46", qtyMilli: 50_000n, unit: "st", form: "vh", price: price(400n, REIGER) });
  M.addLine(m, c2.key, { title: "Proef regiepost 46", qtyMilli: 10_000n, unit: "u", form: "regie", price: price(4000n, REIGER) });
});
const q2 = await sign(W2, (m) => {
  const c1 = M.addChapter(m, { code: "01", title: "Proef ruwbouw 46" });
  M.addLine(m, c1.key, { title: "Proef vloer 46", qtyMilli: 20_000n, unit: "m2", form: "fixed", price: price(2000n, REIGER) });
});
const r1 = ok(await calc.readQuoteVersion(q1.versionId));
const lineId = (title) => r1.lines.find((l) => l.title === title).id;
const A = lineId("Proef muur 46");
const B = lineId("Proef pleister 46");
check("(B0) opzet: firma's, OA-login, drie werven, twee getekende offertes en gestarte werven", typeof W1 === "bigint" && typeof q1.versionId === "bigint" && typeof q2.versionId === "bigint" && r1.lines.length === 3);

// Facturen op W1. Reiger (OA): post A 100 st × € 15 = € 1.500 (gepland € 1.000); Kwartel (leverancier): post B 50 × € 4 = € 200 (gepland € 200,
// goedgekeurd), een container 4 ton × € 80 = € 320 zonder offertepost (goedgekeurd) en een tweede factuur van € 50 die nog wacht.
const L = (workId, kind, description, qty, unit, o = {}) => ({ workId: [workId], kind, root: o.root === undefined ? [] : [o.root], description, persons: [], qtyMilli: qty, unit: o.u ?? "", unitCents: unit, amountCents: (qty * unit + 500n) / 1000n, passOn: o.passOn ?? false, days: [], lineId: [] });
const P = (n, org, kind, lines, o = {}) => { const net = lines.reduce((a, l) => a + l.amountCents, 0n); const oa = "oa" in kind; return { id: [], orgId: org, kind, number: `PN-${sfx}-${n}`, invoiceDay: cDay, dueDay: [cDay + 30n], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: oa ? { reverse: null } : { normal: 2100n }, reverseMention: oa, fileId: [fileW], oaStatementFileId: [], oaStatementRef: "", note: "proef 4.6", netCents: net, vatCents: oa ? 0n : (net * 2100n + 5000n) / 10_000n, totalCents: oa ? net : net + (net * 2100n + 5000n) / 10_000n, lines, finalWorkIds: [], creditOf: [], ...o }; };
const read = async (id) => ok(await calc.readPurchase(id));
const PR = ok(await calc.savePurchase(P("R1", REIGER, { oa: null }, [L(W1, "post", "Proef muur 46", 100_000n, 1500n, { root: A, u: "st" }), L(W1, "post", "Proef pleister 46", 50_000n, 400n, { root: B, u: "st" })]), 0n));
const vR = await read(PR);
const partR = vR.brief.works.find((x) => x.workId === W1);
const partView = ok(await calc.readOaInvoice(un(partR.partId)));
ok(await calc.approveOaInvoice(un(partR.partId), partView.brief.rev, EXC, "proef 4.6: markeringen gezien"));
const PK = ok(await calc.savePurchase(P("K1", KWARTEL, { supplier: null }, [L(W1, "container", "Proef container 4 ton", 4_000n, 8000n, { u: "ton" })]), 0n));
ok(await calc.approvePurchase(PK, (await read(PK)).brief.rev, ""));
const PW = ok(await calc.savePurchase(P("K2", KWARTEL, { supplier: null }, [L(W1, "materiaal", "Proef kleinmateriaal", 1_000n, 5000n, { u: "st" })]), 0n)); // wacht
check("(B0) facturen: OA € 1.700 (goedgekeurd), leverancier € 320 (goedgekeurd), € 50 wacht", (await read(PR)).brief.status.approved !== undefined || "approved" in (await read(PR)).brief.status, S((await read(PR)).brief.status));

// Min-meer: meerwerk € 400 in hoofdstuk 02 (akkoord per mail).
const rawEntry = (o) => ({ kind: { extra: null }, chapter: "", root: [], description: "Proef regel 46", unit: "st", qtyMilli: 1000n, pctBp: [], day: [], approval: { notNeeded: null }, photoFileId: [], note: "", price: [], ...o });
const pr = (o) => [{ unitCents: [], costCents: [], marginBp: [], orgId: [], ...o }];
ok(await calc.saveMinMeerEntry(W1, [], 0n, rawEntry({ chapter: "02 Proef afwerking 46", description: "Proef extra stopcontact 46", qtyMilli: 4000n, approval: { recorded: { how: "mail", day: cDay } }, price: pr({ unitCents: [10_000n] }) })));

// ── B1. Rechten ──
for (const [n, x] of [["werfleider", wl], ["architect", arch], ["OA", oaR], ["klant", klant], ["veiligheidscoördinator", vc], ["anoniem", anon]]) {
  const rs = await Promise.all([x.readNacalc(W1), x.nacalcOverview(), x.nacalcSettings(), x.saveNacalcSettings({ pctBp: 1n, minCents: 1n })].map(denied));
  check(`(B1) ${n}: nacalculatie, overzicht, drempel lezen en zetten geweigerd`, rs.every(Boolean), rs.map((r) => (r ? "·" : "✗")).join(""));
}
check("(B1) de calculator mag de drempel lezen maar niet zetten; de beheerder zet hem", (await calc.nacalcSettings()).pctBp === 1_000n && (await denied(calc.saveNacalcSettings({ pctBp: 1_000n, minCents: 25_000n }))) && (await admin.saveNacalcSettings({ pctBp: 1_000n, minCents: 25_000n })) !== undefined);
check("(B1) drempel: percentage boven 1000 % of bedrag boven € 10 mln geweigerd", /hoogstens/.test(errOf(await admin.saveNacalcSettings({ pctBp: 100_001n, minCents: 0n }))) && /hoogstens/.test(errOf(await admin.saveNacalcSettings({ pctBp: 0n, minCents: 1_000_000_001n }))));
const a0 = (await admin.auditLog(0n, 1n))[0].at;
const f1 = un(ok(await calc.readNacalc(W1)));
const aud = (await admin.auditLog(0n, 20n)).filter((x) => x.at >= a0);
check("(B1) elk lezen laat een auditregel na (bekeek:nacalculatie)", aud.some((x) => /nacalculatie/.test(x.action)), S(aud.map((x) => x.action)));
check("(B1) W3 zonder getekende offerte: geen feiten; onbekende werf: geweigerd", un(ok(await calc.readNacalc(W3))) === null && (await denied(calc.readNacalc(99_999_999n))) || /Geen toegang/.test(errOf(await calc.readNacalc(99_999_999n))));

// ── B2. Rekentest: de browser = een EIGEN berekening uit de gewone oproepen ──
const Q = ok(await calc.readQuoteVersion(q1.versionId));
const mm = ok(await calc.readMinMeer(W1));
// Eigen berekening: gepland uit de offerte (verkoop per lijn, aankoop per lijn), werkelijk uit de aankopen (goedgekeurd, geen voorschotten).
const sellOf = new Map(Q.sell.map((s) => [s.lineId, s.lineSellCents]));
const costOf = new Map(Q.costs.map((c) => [c.lineId, c.lineCostCents]));
let ownPS = 0n; let ownPC = 0n;
for (const l of Q.lines) { if ("item" in l.kind) { ownPS += sellOf.get(l.id); const c = un(costOf.get(l.id) ?? []); if (c !== null) ownPC += c; } }
ownPS -= Q.totals.discountCents;
let ownAC = 0n; let ownPend = 0n;
const own = new Map();
for (const id of [PR, PK, PW]) {
  const v = await read(id);
  const approved = "approved" in v.brief.status;
  for (const l of v.lines) { if (un(l.workId) === W1 && !["voorschot", "aftrek-voorschot"].includes(l.kind)) { if (approved) { ownAC += l.amountCents; own.set(v.brief.orgName, (own.get(v.brief.orgName) ?? 0n) + l.amountCents); } else ownPend += l.amountCents; } }
}
const R = NC.compute(f1);
check("(B2) gepland: verkoop = som van de posten (€ 2.000); kost = som van de aankoopprijzen (eigen telling = module)", R.plannedSellCents === ownPS && R.plannedCostCents === ownPC, `${R.plannedSellCents}/${ownPS} ${R.plannedCostCents}/${ownPC}`);
check("(B2) werkelijk: kost = goedgekeurde regels (€ 1.500 + € 200 + € 320 = € 2.020); € 50 wacht apart; eigen telling = module", R.actualCostCents === ownAC && R.actualCostCents === 202_000n && R.pendingCostCents === ownPend && R.pendingCostCents === 5_000n, `${R.actualCostCents}/${ownAC} ${R.pendingCostCents}/${ownPend}`);
check("(B2) werkelijk verkoop = aanneemsom + saldo min-meer volgens de min-meerstaat (met het meerwerk van € 400)", R.actualSellCents === mm.totals.contractCents && mm.totals.extraCents === 40_000n && R.actualSellCents === R.plannedSellCents + 40_000n, `${R.actualSellCents} ${mm.totals.contractCents}`);
check("(B2) marges: gepland = verkoop − kost; werkelijk = aanneemsom + saldo − goedgekeurde kost; verschil in marge klopt", R.plannedMarginCents === R.plannedSellCents - R.plannedCostCents && R.actualMarginCents === R.actualSellCents - R.actualCostCents && R.marginDeltaCents === R.actualMarginCents - R.plannedMarginCents);
const byL = (gs, label) => gs.find((g) => g.label === label || g.key === label);
const gR = R.byOrg.find((g) => g.label.startsWith("Proef Bouw Reiger 46"));
const gK = R.byOrg.find((g) => g.label.startsWith("Proef Bouwstoffen Kwartel 46"));
check("(B2) per OA: Reiger gepland € 1.600 (muur, pleister, regiepost), werkelijk € 1.700; Kwartel (niet gepland) werkelijk € 320 (+ € 50 wacht)", gR && gK && gR.plannedCostCents === 160_000n && gR.actualCostCents === 170_000n && gK.plannedCostCents === 0n && gK.actualCostCents === 32_000n && gK.pendingCostCents === 5_000n, S([gR, gK]));
check("(B2) per OA: de eigen telling per firma = de module", [...own].every(([name, cents]) => R.byOrg.find((g) => g.label === name)?.actualCostCents === cents), S([...own]));
const ch1 = byL(R.byChapter, "01 Proef ruwbouw 46");
const ch2 = byL(R.byChapter, "02 Proef afwerking 46");
const chX = byL(R.byChapter, NC.NO_CHAPTER);
check("(B2) per hoofdstuk: 01 gepland € 1.000 → werkelijk € 1.500; 02 gepland € 600 (pleister € 200 + regiepost € 400) → werkelijk € 200 (regiepost nog niet gefactureerd)", ch1.plannedCostCents === 100_000n && ch1.actualCostCents === 150_000n && ch2.plannedCostCents === 60_000n && ch2.actualCostCents === 20_000n, S([ch1, ch2]));
check("(B2) per hoofdstuk: verkoop werkelijk = offerte + saldo (02: € 750 + € 100 regie + € 400 meerwerk)", ch2.actualSellCents === ch2.plannedSellCents + 40_000n && ch1.actualSellCents === ch1.plannedSellCents, S([ch1.plannedSellCents, ch1.actualSellCents, ch2.plannedSellCents, ch2.actualSellCents]));
check("(B2) niet toe te wijzen: container € 320 telt als werkelijk, € 50 wacht", chX && chX.actualCostCents === 32_000n && chX.pendingCostCents === 5_000n && chX.plannedCostCents === 0n, S(chX));
const tV = byL(R.byType, "vast"); const tVh = byL(R.byType, "vermoedelijk"); const tRg = byL(R.byType, "regie"); const tKo = byL(R.byType, "kosten");
check("(B2) per posttype: vast € 1.000 → € 1.500; vermoedelijk € 200 → € 200; regie € 400 → € 0; kosten € 0 → € 370 (container + wachtend)", tV.plannedCostCents === 100_000n && tV.actualCostCents === 150_000n && tVh.actualCostCents === 20_000n && tRg.plannedCostCents === 40_000n && tRg.actualCostCents === 0n && tKo.actualCostCents === 32_000n && tKo.plannedCostCents === 0n, S(R.byType.map((g) => [g.key, g.plannedCostCents, g.actualCostCents])));
check("(B2) som van de groepen = totaal (per OA, hoofdstuk en type)", [R.byOrg, R.byChapter, R.byType].every((gs) => gs.reduce((a, g) => a + g.actualCostCents, 0n) === R.actualCostCents && gs.reduce((a, g) => a + g.pendingCostCents, 0n) === R.pendingCostCents && gs.reduce((a, g) => a + g.plannedCostCents, 0n) === R.plannedCostCents));

// ── B3. Afwijkingen en drempel ──
check("(B3) drempel 10 % en € 250: Reiger (+ € 100 op € 1.600 = 6 %) ok; hoofdstuk 01 (+ 50 %) meer dan gepland; container ongepland; werf als geheel (+ € 420 op € 1.600)", gR.flag === "ok" && gK.flag === "ongepland" && ch1.flag === "meer" && chX.flag === "ongepland" && byL(R.byType, "kosten").flag === "ongepland" && R.flag === "meer" && R.diffCents === 42_000n, S([gR.flag, ch1.flag, chX.flag, R.flag, R.diffCents]));
check("(B3) minder dan gepland (hoofdstuk 02, regiepost nog niet gefactureerd) valt niet op zolang de werf loopt", ch2.flag === "ok" && !R.finished && ch2.diffCents < 0n, S([ch2.flag, ch2.diffCents]));
const done = NC.compute({ ...f1, status: "opgeleverd" });
check("(B3) dezelfde werf opgeleverd: hoofdstuk 02 'minder dan gepland'", byL(done.byChapter, "02 Proef afwerking 46").flag === "minder" && done.finished);
check("(B3) flagOf: onder het bedrag of onder het percentage = ok; precies op de grens = valt op; zonder geplande kost enkel het bedrag", NC.flagOf(100_000n, 124_999n, { pctBp: 1000n, minCents: 25_000n }, false) === "ok" && NC.flagOf(1_000_000n, 1_100_000n, { pctBp: 1000n, minCents: 25_000n }, false) === "meer" && NC.flagOf(1_000_000n, 1_024_999n, { pctBp: 1000n, minCents: 25_000n }, false) === "ok" && NC.flagOf(100_000n, 125_000n, { pctBp: 1000n, minCents: 25_000n }, false) === "meer" && NC.flagOf(0n, 24_999n, { pctBp: 1000n, minCents: 25_000n }, false) === "ok" && NC.flagOf(0n, 25_000n, { pctBp: 1000n, minCents: 25_000n }, false) === "ongepland");
ok(await admin.saveNacalcSettings({ pctBp: 6_000n, minCents: 1_000_000n }));
const f1b = un(ok(await calc.readNacalc(W1)));
check("(B3) drempel opgetrokken (60 % en € 10.000) in Beheer: de backend geeft hem mee en niets valt nog op", f1b.settings.pctBp === 6_000n && NC.compute(f1b).flag === "ok" && NC.compute(f1b).byChapter.every((g) => g.flag === "ok"));
ok(await admin.saveNacalcSettings({ pctBp: 1_000n, minCents: 25_000n }));

// ── B4. Overzicht over alle werven ──
const ov = ok(await calc.nacalcOverview());
const b1 = ov.rows.find((b) => b.workId === W1);
const b2 = ov.rows.find((b) => b.workId === W2);
check("(B4) overzicht: W1 en W2 (getekende offerte) staan erin, W3 (geen offerte) niet", !!b1 && !!b2 && !ov.rows.some((b) => b.workId === W3), `${ov.rows.length} werven`);
const bo = NC.computeBrief(b1, ov.settings);
check("(B4) overzicht W1 = werfscherm: gepland verkoop/kost, werkelijk (goedgekeurd), wachtend, aanneemsom + saldo, afwijking en vlag", b1.plannedSellCents === R.plannedSellCents && b1.plannedCostCents === R.plannedCostCents && b1.actualCents === R.actualCostCents && b1.pendingCents === R.pendingCostCents && b1.contractCents === R.actualSellCents && bo.diffCents === R.diffCents && bo.flag === R.flag && bo.actualMarginCents === R.actualMarginCents && bo.marginDeltaCents === R.marginDeltaCents, S(bo));
const bo2 = NC.computeBrief(b2, ov.settings);
check("(B4) overzicht W2 (nog geen facturen): kost 0, geen afwijking, gepland € 400 kost op € 500 verkoop", b2.actualCents === 0n && b2.plannedCostCents === 40_000n && b2.plannedSellCents === 50_000n && bo2.flag === "ok", S(b2));
check("(B4) geen onverwerkte werf boven de grens (skipped = 0 op dit net) en de drempel zit bij het overzicht", ov.skipped === 0n && ov.settings.pctBp === 1_000n);
check("(B4) W2 zonder aankopen: marge gepland € 100 (20 %), werkelijk € 500 (nog geen kosten)", bo2.plannedMarginCents === 10_000n && bo2.actualMarginCents === 50_000n && bo2.plannedMarginBp === 2000n);

} catch (e) {
  check("geen onverwachte fout", false, String(e?.stack ?? e).slice(0, 500));
} finally {
  try { ok(await admin.saveNacalcSettings(nc0)); } catch {}
  ok(await admin.setSettings(setIn(s0.werfleiderZietAlles)));
  ok(await admin.savePurchaseSettings(ps0));
  ok(await admin.saveOaInvoiceSettings({ ...oi0 }));
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
