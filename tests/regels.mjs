// Controleregels vóór verzending (stap 2.6, bouwplan §9 rij 2.6): de regels van de browser (src/frontend/src/quote/rules.ts) en
// dezelfde regels in de backend (src/backend/lib/QuoteRules.mo) naast elkaar, met VERZONNEN offertes.
//   node tests/regels.mjs                 A: de regels zelf (elke regel, de standaardposten, de drempel, woordgrenzen)
//   node tests/regels.mjs <canister>      + B: browser = server op N willekeurige offertes (REGEL_N, standaard lokaal 150 /
//                                         draft 25); C: versturen (blokkering, waarschuwing met reden, auditlog, onwijzigbaar);
//                                         D: de instellingen van de beheerder (aan/uit, ernst, drempel, standaardposten) en
//                                         wie ze mag zien of wijzigen. Eindigt met de standaardinstellingen terug.
// Gebruikt de testidentiteiten en P-A van tests/rollen.mjs (of tools/draft-opbouw.mjs). Zet enkel verzonnen gegevens: een offerte
// "PROEF-REGELS" op P-A (nooit een echte prijs of klant) en twee proefklanten.
import { backend } from "../tools/lib.mjs";
import { M, fromRead, saveAll, opt, unopt } from "./offerte-lib.mjs";
import * as R from "../src/frontend/src/quote/rules.ts";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);

// ── De standaardinstellingen (gelijk aan Config.quoteRuleDefaults en quoteStdPostDefaults) ──
const DEF = [
  ["no-posts", "Er staat nog geen enkele post in deze versie", true, "block", null],
  ["no-price", "Posten zonder prijs", true, "block", null],
  ["total-zero", "Het totaal is nul of negatief", true, "block", null],
  ["client-missing", "De offerte heeft geen klant", false, "block", null],
  ["client-address", "De klant heeft geen volledig adres", false, "block", null],
  ["vat-ground", "Btw 6 % zonder grond bij de werf", false, "warn", null],
  ["vat-differs", "Het btw-tarief wijkt af van dat van de werf", false, "warn", null],
  ["qty-zero", "Posten met hoeveelheid 0", false, "warn", null],
  ["qty-negative", "Posten met een negatieve hoeveelheid (minwerk)", false, "warn", null],
  ["margin-unknown", "Vaste prijs zonder aankoopprijs: marge onbekend", false, "warn", null],
  ["margin-low", "Marge onder de drempel", false, "warn", 1000n],
  ["below-cost", "Verkoop onder de aankoopprijs", false, "block", null],
  ["no-reason", "Afwijkende marge of vaste prijs zonder reden", false, "block", null],
  ["chapter-empty", "Hoofdstukken zonder posten", false, "warn", null],
];
const defRules = () => DEF.map(([key, name, fixed, severity, thr]) => ({ key, name, fixed, enabled: true, severity, thresholdBp: thr }));
const STD = [
  ["vergunning", "Vergunning of inname openbaar domein", ["vergunning", "openbaar domein", "inname", "signalisatie"]],
  ["epb", "EPB-verslaggeving", ["epb", "peb", "energieprestatie"]],
  ["pid", "Postinterventiedossier (PID)", ["pid", "postinterventiedossier", "post interventiedossier"]],
  ["opkuis", "Opkuis en afvoer", ["opkuis", "opkuisen", "afval", "puin", "werfopruiming"]],
];
const defStd = () => STD.map(([key, name, keywords]) => ({ key, name, keywords, enabled: true, severity: "warn", archived: false }));

// ── Hulp voor deel A: een offerte in de vorm van RuleInput ──
let nid = 0;
const ch = (title, code = "00") => ({ id: `c${++nid}`, code, title });
const ln = (c, over = {}) => ({ id: `l${++nid}`, chapter: c.id, kind: "item", code: "", title: "Post", qtyMilli: 1000n, cost: 1000n, rule: null, reason: "", ...over });
const base = (chapters, lines, over = {}) => ({ chapters, lines, standardBp: 2000n, vatBp: 2100n, workVatBp: 2100n, vatNote: "", clientSet: true, clientAddressOk: true, ...over });
const keys = (fs) => fs.map((f) => f.rule).join(",");
const only = (fs, ...skip) => fs.filter((f) => !f.rule.startsWith("std:") && !skip.includes(f.rule));
const NOSTD = [];

// A. de regels zelf
{
  const c1 = ch("Dakwerken");
  const ok = base([c1], [ln(c1)]);
  check("(A) een gewone offerte: geen enkele bevinding (zonder standaardposten)", R.evaluate(ok, defRules(), NOSTD).length === 0, keys(R.evaluate(ok, defRules(), NOSTD)));
  check("(A) geen post: 'no-posts' blokkeert (vast)", keys(R.evaluate(base([c1], [ln(c1, { kind: "text" })]), defRules(), NOSTD)).startsWith("no-posts"));
  const np = R.evaluate(base([c1], [ln(c1, { cost: null }), ln(c1, { cost: null, kind: "option" }), ln(c1)]), defRules(), NOSTD);
  check("(A) posten zonder prijs: 2 lijnen (post en optie), blokkeert", np.length === 1 && np[0].rule === "no-price" && np[0].count === 2 && np[0].severity === "block", S(np));
  const tz = R.evaluate(base([c1], [ln(c1, { qtyMilli: -1000n })]), defRules(), NOSTD);
  check("(A) totaal negatief: 'total-zero' blokkeert; ook de negatieve hoeveelheid waarschuwt", keys(tz) === "total-zero,qty-negative", keys(tz));
  check("(A) geen klant: blokkeert; geen volledig adres: blokkeert", keys(R.evaluate(base([c1], [ln(c1)], { clientSet: false, clientAddressOk: false }), defRules(), NOSTD)) === "client-missing" && keys(R.evaluate(base([c1], [ln(c1)], { clientAddressOk: false }), defRules(), NOSTD)) === "client-address");
  check("(A) btw 6 % zonder grond: waarschuwing; met grond of bij 21 %: niets", keys(R.evaluate(base([c1], [ln(c1)], { vatBp: 600n, workVatBp: 600n }), defRules(), NOSTD)) === "vat-ground" && keys(R.evaluate(base([c1], [ln(c1)], { vatBp: 600n, workVatBp: 600n, vatNote: "woning ouder dan 10 jaar" }), defRules(), NOSTD)) === "" && keys(R.evaluate(ok, defRules(), NOSTD)) === "");
  check("(A) btw 6 % met enkel spaties als grond telt als leeg", keys(R.evaluate(base([c1], [ln(c1)], { vatBp: 600n, workVatBp: 600n, vatNote: "   " }), defRules(), NOSTD)) === "vat-ground");
  check("(A) btw anders dan de werf: waarschuwing", keys(R.evaluate(base([c1], [ln(c1)], { vatBp: 2100n, workVatBp: 600n }), defRules(), NOSTD)) === "vat-differs");
  const qz = R.evaluate(base([c1], [ln(c1, { qtyMilli: 0n }), ln(c1, { qtyMilli: 0n, kind: "option" }), ln(c1, { qtyMilli: 0n, kind: "text" }), ln(c1)]), defRules(), NOSTD);
  check("(A) hoeveelheid 0: post en optie, niet de tekstregel", qz.length === 1 && qz[0].rule === "qty-zero" && qz[0].count === 2, S(qz));
  const mu = R.evaluate(base([c1], [ln(c1, { cost: null, rule: { price: 5000n }, reason: "vast" }), ln(c1)]), defRules(), NOSTD);
  check("(A) vaste prijs zonder aankoopprijs: marge onbekend (waarschuwing)", keys(mu) === "margin-unknown", keys(mu));
  const ml = R.evaluate(base([c1], [ln(c1, { rule: { margin: 500n }, reason: "klant" }), ln(c1, { rule: { margin: 1000n }, reason: "x" }), ln(c1, { rule: { margin: 0n }, reason: "x" })]), defRules(), NOSTD);
  check("(A) marge onder de drempel (10 %): 5 % en 0 % ja, 10 % niet (de drempel zelf is in orde)", ml.length === 1 && ml[0].rule === "margin-low" && ml[0].count === 2, S(ml));
  const bc = R.evaluate(base([c1], [ln(c1, { cost: 2000n, rule: { price: 1500n }, reason: "geste" })]), defRules(), NOSTD);
  check("(A) verkoop onder aankoop: blokkeert, en telt niet ook als 'marge laag'", keys(bc) === "below-cost", keys(bc));
  const nr = R.evaluate(base([c1], [ln(c1, { rule: { margin: 3000n }, reason: "" }), ln(c1, { rule: { margin: 3000n }, reason: "ok" }), ln(c1, { rule: { margin: 2000n } })]), defRules(), NOSTD);
  check("(A) afwijkende marge zonder reden: blokkeert; de standaardmarge als 'eigen' marge is niet afwijkend", nr.length === 1 && nr[0].rule === "no-reason" && nr[0].count === 1, S(nr));
  const c2 = ch("Leeg"), c3 = ch("Alleen tekst");
  const ce = R.evaluate(base([c1, c2, c3], [ln(c1), ln(c3, { kind: "text" }), ln(c3, { kind: "option" })]), defRules(), NOSTD);
  check("(A) hoofdstukken zonder posten: leeg, enkel tekst of enkel opties", ce.length === 1 && ce[0].rule === "chapter-empty" && ce[0].count === 2 && ce[0].chapterIds.join() === `${c2.id},${c3.id}`, S(ce));
  const many = R.evaluate(base([c1], Array.from({ length: 30 }, () => ln(c1, { qtyMilli: 0n }))), defRules(), NOSTD);
  const qzm = many.find((f) => f.rule === "qty-zero");
  check("(A) 30 lijnen met VH 0: count 30, maar hoogstens 20 ids", qzm.count === 30 && qzm.lineIds.length === 20 && many.some((f) => f.rule === "total-zero"));
}
{
  const c = ch("Algemeen");
  const std = defStd();
  const only1 = (title, chTitle = "Algemeen", code = "") => { const cc = ch(chTitle); return R.evaluate(base([cc], [ln(cc, { title, code })]), defRules(), std).map((f) => f.rule); };
  check("(A) standaardposten: een gewone offerte mist alle vier", only1("Dakgoot vervangen").join() === "std:vergunning,std:epb,std:pid,std:opkuis");
  check("(A) 'pid' is een heel woord: 'rapid' of 'pidgin' tellen niet, 'PID-dossier' wel", only1("Rapid test").includes("std:pid") && only1("Pidgin").includes("std:pid") && !only1("PID-dossier opmaken").includes("std:pid"));
  check("(A) 'afval' mag het begin zijn: 'afvalcontainer' en 'Afvoer van puin' tellen; hoofdstuk 'Opkuis' ook", !only1("Afvalcontainer plaatsen").includes("std:opkuis") && !only1("Afvoer van puin").includes("std:opkuis") && !only1("Iets", "Opkuis en afvoer").includes("std:opkuis"));
  check("(A) een woord van meer woorden: 'openbaar domein' (ook met hoofdletters en leestekens)", !only1("Inname Openbaar-Domein aanvragen").includes("std:vergunning") && !only1("Vergunning aanvragen").includes("std:vergunning"));
  check("(A) de code telt ook mee (EPB in de code)", !only1("Verslag", "Algemeen", "EPB.1").includes("std:epb"));
  check("(A) accenten blijven letters: 'Energieprestatiecertificaat' (begin van een lang woord) telt", !only1("Energieprestatiecertificaat opmaken").includes("std:epb"));
  const cc = ch("Algemeen");
  const optOnly = R.evaluate(base([cc], [ln(cc), ln(cc, { kind: "option", title: "EPB-verslag" }), ln(cc, { kind: "text", title: "PID" })]), defRules(), std).map((f) => f.rule);
  check("(A) een optie of tekstregel met het woord telt NIET als aanwezig", optOnly.includes("std:epb") && optOnly.includes("std:pid"));
  const off = R.evaluate(base([c], [ln(c)]), defRules(), std.map((s) => ({ ...s, enabled: s.key === "pid" })));
  check("(A) een uitgezette of gearchiveerde standaardpost zoekt niemand", off.map((f) => f.rule).join() === "std:pid" && R.evaluate(base([c], [ln(c)]), defRules(), std.map((s) => ({ ...s, archived: true }))).length === 0);
  const blockStd = R.evaluate(base([c], [ln(c)]), defRules(), [{ ...std[0], severity: "block" }]);
  check("(A) een standaardpost kan blokkeren", blockStd.length === 1 && blockStd[0].severity === "block");
  const rules = defRules().map((r) => (r.key === "qty-zero" ? { ...r, enabled: false } : r.key === "margin-low" ? { ...r, thresholdBp: 2200n } : r));
  const c9 = ch("A");
  const set = R.evaluate(base([c9], [ln(c9, { qtyMilli: 0n }), ln(c9, { rule: { margin: 2500n }, reason: "x" })]), rules, NOSTD);
  check("(A) een regel uit: geen bevinding; drempel 22 %: de standaardmarge (20 %) valt eronder, 25 % niet", keys(set) === "margin-low" && set[0].count === 1, S(set));
  const sev = R.evaluate(base([c9], [ln(c9, { qtyMilli: 0n })]), defRules().map((r) => (r.key === "qty-zero" ? { ...r, severity: "block" } : r)), NOSTD);
  check("(A) een waarschuwing kan als blokkering gezet worden", sev.find((f) => f.rule === "qty-zero").severity === "block" && R.warnings(sev).length === 0);
}

if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

// ── Vanaf hier met een canister ──────────────────────────────────────────
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const errOf = (r) => (r && "err" in r ? r.err : "");
const isOk = (r) => r && typeof r === "object" && "ok" in r;
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch { return true; } };
const host = process.env.ICP_HOST || "";
const local = host.includes("localhost") || host.includes("127.0.0.1");
const N = Number(process.env.REGEL_N || (local ? 150 : 25));

const [admin, wl, calc, arch, oa2, klant, vc] = await Promise.all(["proef-admin", "proef-werfleider", "proef-calculator", "proef-architect", "proef-oa2", "proef-klant", "proef-vc"].map((n) => backend(n, cid)));
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A");
if (!A) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs (lokaal) of tools/draft-opbouw.mjs (draft)");
const T = (r) => r;

// Twee proefklanten: één zonder en één met een volledig adres.
const orgs = await admin.listOrgs(true);
const mkClient = async (name, address) => {
  const found = orgs.find((o) => o.name === name);
  if (found) return found.id;
  return ok(await admin.createOrg({ kind: { client: null }, name, kbo: [], vat: [], aliases: [], trades: [], address: opt(address), notes: "" })).id;
};
const clientBare = await mkClient("Proef Klant Zonder Adres", null);
const clientFull = await mkClient("Proef Klant Compleet", { street: "Proefstraat", number: "1", zip: "8670", city: "Koksijde", country: "BE" });
// De grond voor het btw-tarief van P-A wisselt per geval: via updateWork (de rest van de werf blijft zoals ze is).
const w0 = await admin.getWork(A.id);
const setVatNote = async (note) => {
  const r = await admin.updateWork(A.id, { code: w0.code, name: w0.name, address: w0.address, parentId: w0.parentId, clientOrgId: w0.clientOrgId, architectOrgId: w0.architectOrgId, leaderPersonId: w0.leaderPersonId, vatBp: w0.vatBp, plannedStart: w0.plannedStart, plannedEnd: w0.plannedEnd, analyticCode: w0.analyticCode, vatNote: note });
  if ("err" in r) throw new Error(r.err);
};
const oldNote = w0.vatNote;

// Instellingen eerst op de standaard (een vorige run kan ze verzet hebben).
const resetRules = async () => {
  for (const [key, , fixed, severity, thr] of DEF) {
    if (fixed) continue;
    ok(await admin.setQuoteRule({ key, enabled: true, severity: { [severity]: null }, thresholdBp: thr === null ? [] : [thr] }));
  }
};
await resetRules();
{
  const cfg = await admin.getQuoteRules();
  if (cfg.stdPosts.length === 0) throw new Error("geen standaardposten");
  // Staat er al een Map (vorige run of de beheerder), dan terugzetten naar de vier standaarden.
  for (const [i, [key, name, keywords]] of STD.entries()) ok(await admin.setQuoteStdPost({ key, name, keywords, enabled: true, severity: { warn: null }, order: BigInt((i + 1) * 10), archived: false }));
  for (const s of cfg.stdPosts) if (!STD.some(([k]) => k === s.key) && !s.archived) ok(await admin.setQuoteStdPost({ key: s.key, name: s.name, keywords: s.keywords, enabled: s.enabled, severity: s.severity, order: s.order, archived: true }));
}

// De proefofferte
const NR = "PROEF-REGELS";
let q = (await admin.listQuotes([A.id], true)).find((x) => x.number === NR);
if (!q) {
  const c = ok(await calc.createQuote({ workId: A.id, number: NR, title: "Proef controleregels (draftproef 2.6)" }));
  q = (await admin.listQuotes([A.id], true)).find((x) => x.id === c.quoteId);
}
if (q.archived) ok(await calc.setQuoteArchived(q.id, false, ""));
const newDraft = async () => {
  const cur = (await admin.listQuotes([A.id], true)).find((x) => x.number === NR);
  let d = cur.versions.find((v) => "draft" in v.status);
  if (!d) { ok(await calc.newQuoteVersion(q.id, [])); d = (await admin.listQuotes([A.id], true)).find((x) => x.number === NR).versions[0]; }
  return d.id;
};
const units = ["st", "m2", "lm", "m3", "sog", "u"];
const toRules = (cfg) => ({
  rules: cfg.rules.map((r) => ({ key: r.key, name: r.name, fixed: r.fixed, enabled: r.enabled, severity: Object.keys(r.severity)[0], thresholdBp: unopt(r.thresholdBp) })),
  std: cfg.stdPosts.map((s) => ({ key: s.key, name: s.name, keywords: s.keywords, enabled: s.enabled, severity: Object.keys(s.severity)[0], archived: s.archived })),
});
// Het model → RuleInput, zoals de editor het doet (screens/Offertes.tsx findingsFor).
const inputOf = (m, read, orgList, note) => {
  const client = m.header.clientOrgId === null ? undefined : orgList.find((o) => o.id === m.header.clientOrgId);
  return {
    chapters: M.activeChapters(m).map((c) => ({ id: c.key, code: c.code, title: c.title })),
    lines: M.activeLines(m).map((l) => ({ id: l.key, chapter: l.chapter, kind: l.kind, code: l.code, title: l.title, qtyMilli: l.qtyMilli, cost: l.price.cost, rule: l.price.rule, reason: l.price.rule === null ? "" : l.price.reason.replace(/^ +| +$/g, "") })),
    standardBp: m.header.standardMarginBp,
    vatBp: m.header.vatBp,
    workVatBp: read.version.workVatBp,
    vatNote: note,
    clientSet: m.header.clientOrgId !== null && !!client,
    clientAddressOk: R.addressOk(unopt(client?.address ?? [])),
  };
};
const idOf = (m, key) => (m.lines.find((l) => l.key === key) ?? m.chapters.find((c) => c.key === key))?.id ?? null;
const simple = (fs) => fs.map((f) => `${f.rule}|${f.severity}|${f.count}`).join(";");
const fill = async (vid, { chapters, lines, vatBp, std, client }) => {
  const m = fromRead(ok(await calc.readQuoteVersion(vid)));
  for (const l of [...m.lines]) M.removeLine(m, l.key);
  for (const c of [...m.chapters]) M.removeChapter(m, c.key);
  M.setHeader(m, { vatBp, standardMarginBp: std, clientOrgId: client });
  const keysOf = new Map();
  for (const [i, c] of chapters.entries()) keysOf.set(c.id, M.addChapter(m, { code: String(i).padStart(2, "0"), title: c.title }).key);
  for (const [i, l] of lines.entries()) M.addLine(m, keysOf.get(l.chapter), { kind: l.kind, title: l.title, code: l.code ?? "", qtyMilli: l.qtyMilli, unit: l.kind === "text" ? "" : units[i % units.length], form: "vh", price: { cost: l.kind === "text" ? null : l.cost, rule: l.kind === "text" ? null : l.rule, reason: l.reason, orgId: null, source: l.cost === null ? "" : "eigen", libCostId: null } });
  const r = await saveAll(calc, m);
  return { m, r };
};
const orgList = await admin.listOrgs(true);

// ── B. Browser = server op willekeurige offertes ──
{
  const cfg = toRules(await admin.getQuoteRules());
  check("(B) de standaardinstellingen van de server = die van de test (14 regels, 4 standaardposten, drempel 10 %)", S(cfg.rules.map((r) => [r.key, r.name, r.fixed, r.enabled, r.severity, r.thresholdBp])) === S(defRules().map((r) => [r.key, r.name, r.fixed, r.enabled, r.severity, r.thresholdBp])) && S(cfg.std.filter((x) => !x.archived)) === S(defStd()), S(cfg.std).slice(0, 120));
  const vid = await newDraft();
  let seed = Number(process.env.REGEL_SEED || 20261026);
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = (xs) => xs[rnd(xs.length)];
  const TITLES = ["Dakgoot vervangen", "Chape storten", "Vergunning aanvragen", "EPB-verslag", "PID opmaken", "Opkuis en afvoer puin", "Rapid test", "Afvalcontainer", "Inname openbaar domein", "Tegels leggen", "Pidgin", "Energieprestatiecertificaat", "Werfopruiming", "Schilderwerk"];
  let bad = 0;
  let firstBad = "";
  let withBlock = 0;
  let withWarn = 0;
  let clean = 0;
  const t0 = Date.now();
  for (let k = 0; k < N; k++) {
    const chapters = Array.from({ length: 1 + rnd(4) }, (_, i) => ({ id: `c${i}`, title: pick(["Algemeen", "Opkuis", "Dak", "Tegels", "Technieken", "Leeg"]) }));
    const tidy = rnd(10) < 5; // de helft: bijna niets mis, zodat ook "enkel waarschuwingen" en "helemaal in orde" voorkomen
    const lines = Array.from({ length: rnd(14) }, () => {
      const kind = pick(["item", "item", "item", "item", "option", "text"]);
      const rule = pick([null, null, null, { margin: BigInt(pick([0, 500, 1000, 1500, 2000, 3500])) }, { price: BigInt(pick([1000, 4500, 90_000])) }]);
      return {
        chapter: pick(chapters).id,
        kind,
        title: pick(TITLES),
        code: pick(["", "", "7.01", "EPB.1", "pid"]),
        qtyMilli: BigInt(tidy ? pick([1000, 1250, 3333, 100000]) : pick([0, 1000, 1000, 1250, 3333, -1000, 100000])),
        cost: tidy ? pick([1234n, 4500n, 33_333n]) : pick([null, 0n, 1234n, 4500n, 4500n, 33_333n]),
        rule: tidy && rule && "price" in rule ? null : rule,
        reason: tidy ? "reden" : pick(["", "", "reden"]),
      };
    });
    const vatBp = BigInt(pick([600, 2100]));
    const std = BigInt(pick([2000, 2000, 1500]));
    const client = tidy ? clientFull : pick([null, clientBare, clientFull, clientFull]);
    const note = pick(["", "woning ouder dan 10 jaar"]);
    await setVatNote(note);
    const { m, r } = await fill(vid, { chapters, lines, vatBp, std, client });
    if (!("ok" in r)) { bad++; if (!firstBad) firstBad = `geval ${k}: bewaren mislukte: ${errOf(r)}`; continue; }
    const read = ok(await calc.readQuoteVersion(vid));
    const mine = R.evaluate(inputOf(m, read, orgList, read.vatNote), cfg.rules, cfg.std);
    const theirs = ok(await calc.checkQuoteVersion(vid));
    const theirsSimple = theirs.map((f) => ({ rule: f.rule, severity: Object.keys(f.severity)[0], count: Number(f.count) }));
    const same = simple(mine) === simple(theirsSimple) && mine.every((f, i) => f.name === theirs[i].name
      && f.lineIds.map((x) => idOf(m, x)).join() === theirs[i].lineIds.join() && f.chapterIds.map((x) => idOf(m, x)).join() === theirs[i].chapterIds.join());
    if (R.blocks(mine).length) withBlock++; else if (R.warnings(mine).length) withWarn++; else clean++;
    if (!same) { bad++; if (!firstBad) firstBad = `geval ${k}: browser ${simple(mine)} ≠ server ${simple(theirsSimple)}`; }
  }
  check(`(B) ${N} willekeurige offertes (6 hoofdstuktitels, 14 posttitels, VH 0/negatief, marges, vaste prijzen, reden, btw 6/21 %, 3 soorten klant, btw-grond): bevindingen van de browser = die van de server (regel, ernst, aantal, ids)`, bad === 0, bad ? `${bad} verschillen; ${firstBad}` : `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  check("(B) de willekeurige gevallen dekken alles: met blokkering en enkel met waarschuwing", withBlock > 0 && (N < 30 || withWarn > 0), `blokkering ${withBlock}, waarschuwing ${withWarn}, in orde ${clean}`);
  await setVatNote(oldNote);
}

// ── C. Versturen ──
{
  const vid = await newDraft();
  const good = [{ id: "c0", title: "Dakwerken" }];
  const eplus = { chapters: good, vatBp: A.vatBp, std: 2000n, client: clientFull };
  const item = (title, over = {}) => ({ chapter: "c0", kind: "item", title, qtyMilli: 1000n, cost: 1000n, rule: null, reason: "", ...over });
  const full = [item("Dakgoot vervangen"), item("Vergunning inname openbaar domein"), item("EPB-verslaggeving"), item("PID opstellen"), item("Opkuis en afvoer van puin")];
  const total = async () => ok(await calc.readQuoteVersion(vid));
  const sendWith = async (reason) => { const r0 = await total(); return calc.sendQuoteVersion(vid, r0.version.rev, r0.totals.totalCents, reason); };

  await fill(vid, { ...eplus, lines: [], std: 2000n });
  check("(C) lege offerte: geblokkeerd met de reden", /Niet verstuurd: .*geen enkele post/.test(errOf(await sendWith(""))));
  await fill(vid, { ...eplus, lines: [item("Dakgoot", { cost: null })] });
  check("(C) een post zonder prijs: geblokkeerd; een reden helpt niet", /Niet verstuurd: .*zonder prijs/.test(errOf(await sendWith("ik wil toch"))));
  await fill(vid, { ...eplus, client: null, lines: full });
  check("(C) geen klant: geblokkeerd, ook met een reden", /Niet verstuurd: .*geen klant/.test(errOf(await sendWith("ik wil toch"))));
  await fill(vid, { ...eplus, client: clientBare, lines: full });
  check("(C) klant zonder adres: geblokkeerd", /Niet verstuurd: .*adres/.test(errOf(await sendWith("ik wil toch"))));
  await fill(vid, { ...eplus, lines: [...full, item("Eigen marge", { rule: { margin: 3000n }, reason: "" })] });
  check("(C) afwijkende marge zonder reden: geblokkeerd; met een reden bij de lijn: door", /Niet verstuurd: .*zonder reden/.test(errOf(await sendWith(""))));
  await fill(vid, { ...eplus, lines: [...full, item("Onder aankoop", { cost: 2000n, rule: { price: 1500n }, reason: "geste" })] });
  check("(C) verkoop onder aankoop: geblokkeerd", /Niet verstuurd: .*onder de aankoopprijs/.test(errOf(await sendWith("geste"))));
  const r1 = await fill(vid, { ...eplus, lines: [...full, item("Pro memorie", { qtyMilli: 0n })] });
  check("(C) enkel een waarschuwing (hoeveelheid 0) zonder reden: geweigerd met de waarschuwing erbij", isOk(r1.r) && /Waarschuwingen: .*hoeveelheid 0.*Geef een reden/.test(errOf(await sendWith(""))), errOf(await sendWith("")).slice(0, 160));
  check("(C) … een reden van 4 tekens is te kort", /Geef een reden/.test(errOf(await sendWith("nee"))));
  check("(C) … en van meer dan 300 tekens te lang", /hoogstens 300/.test(errOf(await sendWith("x".repeat(301)))));
  const why = "proef: pro memorie is bedoeld, de klant beslist zelf";
  const sent = await sendWith(why);
  check("(C) met een reden: verstuurd (hash)", isOk(sent) && /^[0-9a-f]{64}$/.test(sent.ok), errOf(sent));
  const rs = await total();
  check("(C) de versie toont wie de waarschuwingen doorzette, welke en waarom", unopt(rs.check)?.reason === why && unopt(rs.check).warned.length === 1 && unopt(rs.check).warned[0].name === "Posten met hoeveelheid 0" && unopt(rs.check).byName.length > 0, S(unopt(rs.check)));
  const log = await admin.auditLog(0n, 400n);
  const entry = log.find((e) => e.action === "offerte-waarschuwingen-doorgezet" && e.detail.includes(why));
  check("(C) auditlog: 'offerte-waarschuwingen-doorgezet' met de regels en de reden, zonder bedrag", !!entry && entry.detail.includes("Posten met hoeveelheid 0") && !/€|\d+[,.]\d{2}\b/.test(entry.detail), entry?.detail);
  check("(C) auditlog: ook gewoon 'offerte-verstuurd'", log.some((e) => e.action === "offerte-verstuurd" && e.detail.includes(NR)));
  check("(C) verzonden = onwijzigbaar en niet opnieuw te versturen", /kan niet meer veranderen/.test(errOf(await calc.saveQuoteDraft(vid, rs.version.rev, [], [], [], { subtotalCents: 0n, vatCents: 0n, totalCents: 0n, optionsPlusCents: 0n, optionsMinusCents: 0n, costCents: 0n, marginCents: 0n, chapters: [] }))) && /al verstuurd/.test(errOf(await sendWith(why))));
  check("(C) de controle op een verzonden versie kan nog (voor de rekentest) maar verandert niets", isOk(await calc.checkQuoteVersion(vid)));
  // Een versie zonder waarschuwingen heeft geen reden nodig
  ok(await calc.newQuoteVersion(q.id, []));
  const v2 = (await admin.listQuotes([A.id], true)).find((x) => x.number === NR).versions[0].id;
  const m2 = fromRead(ok(await calc.readQuoteVersion(v2)));
  for (const l of m2.lines.filter((l) => l.qtyMilli === 0n)) M.updateLine(m2, l.key, { qtyMilli: 1000n });
  check("(C) v2: de pro-memorie-post krijgt een hoeveelheid; bewaard", isOk(await saveAll(calc, m2)));
  const r2 = ok(await calc.readQuoteVersion(v2));
  check("(C) v2 zonder bevindingen: de controle is leeg", ok(await calc.checkQuoteVersion(v2)).length === 0, S(ok(await calc.checkQuoteVersion(v2)).map((f) => f.rule)));
  const s2 = await calc.sendQuoteVersion(v2, r2.version.rev, r2.totals.totalCents, "");
  check("(C) v2 versturen zonder reden: kan (geen waarschuwingen) en v1 wordt 'vervangen'", isOk(s2) && unopt((ok(await calc.readQuoteVersion(v2))).check) === null, errOf(s2));
  check("(C) het controlerecord van v1 blijft bij v1", unopt((ok(await calc.readQuoteVersion(vid))).check)?.reason === why);
  // Wie mag de controle zien
  const roles = [["werfleider", wl], ["architect", arch], ["OA", oa2], ["klant", klant], ["veiligheid", vc]];
  for (const [n, x] of roles) check(`(C) ${n}: de controle en de regels niet te zien (geweigerd)`, (await Promise.all([x.checkQuoteVersion(vid), x.getQuoteRules().then(() => ({ ok: 1 }), () => ({ err: "Geen toegang" }))].map(denied))).every(Boolean));
  const rw = ok(await wl.readQuoteVersion(v2));
  check("(C) werfleider ziet in zijn lezing geen controlerecord (met reden) en geen btw-grond", unopt(rw.check) === null && rw.vatNote === "");
}

// ── D. De instellingen ──
{
  const vid = await newDraft();
  const item = (title, over = {}) => ({ chapter: "c0", kind: "item", title, qtyMilli: 1000n, cost: 1000n, rule: null, reason: "", ...over });
  const base4 = [item("Vergunning inname openbaar domein"), item("EPB-verslaggeving"), item("PID opstellen"), item("Opkuis en afvoer van puin")];
  const mk = (extra = []) => fill(vid, { chapters: [{ id: "c0", title: "Dakwerken" }], lines: [...base4, ...extra], vatBp: A.vatBp, std: 2000n, client: clientFull });
  const codes = async () => ok(await calc.checkQuoteVersion(vid)).map((f) => f.rule).join();
  await mk([item("Pro memorie", { qtyMilli: 0n })]);
  check("(D) standaard: VH 0 waarschuwt", (await codes()) === "qty-zero");
  check("(D) calculator mag de regels lezen maar niet wijzigen", (await calc.getQuoteRules()).rules.length === 14 && await denied(calc.setQuoteRule({ key: "qty-zero", enabled: false, severity: { warn: null }, thresholdBp: [] })) && await denied(calc.setQuoteStdPost({ key: "x", name: "X", keywords: ["x"], enabled: true, severity: { warn: null }, order: 1n, archived: false })));
  check("(D) admin zet 'hoeveelheid 0' uit: geen bevinding meer", isOk(await admin.setQuoteRule({ key: "qty-zero", enabled: false, severity: { warn: null }, thresholdBp: [] })) && (await codes()) === "");
  check("(D) … en als blokkering: de verzending is dicht", isOk(await admin.setQuoteRule({ key: "qty-zero", enabled: true, severity: { block: null }, thresholdBp: [] })) && (await codes()) === "qty-zero" && /Niet verstuurd: Posten met hoeveelheid 0/.test(errOf(await calc.sendQuoteVersion(vid, (await calc.readQuoteVersion(vid)).ok.version.rev, ok(await calc.readQuoteVersion(vid)).totals.totalCents, "reden genoeg"))));
  ok(await admin.setQuoteRule({ key: "qty-zero", enabled: true, severity: { warn: null }, thresholdBp: [] }));
  check("(D) de vaste regels zijn niet te wijzigen", /vast/.test(errOf(await admin.setQuoteRule({ key: "no-price", enabled: false, severity: { warn: null }, thresholdBp: [] }))) && /vast/.test(errOf(await admin.setQuoteRule({ key: "no-posts", enabled: true, severity: { warn: null }, thresholdBp: [] }))));
  check("(D) een onbekende regel, een drempel bij een regel zonder drempel en een drempel boven 90 % worden geweigerd", /Onbekende regel/.test(errOf(await admin.setQuoteRule({ key: "bestaat-niet", enabled: true, severity: { warn: null }, thresholdBp: [] }))) && /geen drempel/.test(errOf(await admin.setQuoteRule({ key: "qty-zero", enabled: true, severity: { warn: null }, thresholdBp: [500n] }))) && /Drempel/.test(errOf(await admin.setQuoteRule({ key: "margin-low", enabled: true, severity: { warn: null }, thresholdBp: [9100n] }))));
  await mk([item("Marge 12 procent", { rule: { margin: 1200n }, reason: "proef" })]);
  check("(D) drempel 10 %: 12 % is in orde", (await codes()) === "");
  check("(D) drempel 15 %: 12 % valt eronder", isOk(await admin.setQuoteRule({ key: "margin-low", enabled: true, severity: { warn: null }, thresholdBp: [1500n] })) && (await codes()) === "margin-low");
  ok(await admin.setQuoteRule({ key: "margin-low", enabled: true, severity: { warn: null }, thresholdBp: [1000n] }));
  // Standaardposten
  await mk([]);
  check("(D) de vier standaardposten staan in de offerte: niets ontbreekt", (await codes()) === "");
  check("(D) admin voegt een standaardpost toe ('Werfbord'): ontbreekt, waarschuwt", isOk(await admin.setQuoteStdPost({ key: "proef-werfbord", name: "Werfbord", keywords: ["werfbord", " ", "bord"], enabled: true, severity: { warn: null }, order: 50n, archived: false })) && (await codes()) === "std:proef-werfbord");
  check("(D) … met een lege lijst woorden of een slechte sleutel geweigerd", /woorden/.test(errOf(await admin.setQuoteStdPost({ key: "proef-x", name: "X", keywords: [" ", ","], enabled: true, severity: { warn: null }, order: 1n, archived: false }))) && /Sleutel/.test(errOf(await admin.setQuoteStdPost({ key: "Fout Sleutel", name: "X", keywords: ["x"], enabled: true, severity: { warn: null }, order: 1n, archived: false }))));
  await mk([item("Werfbord plaatsen")]);
  check("(D) staat het werfbord erin, dan is de waarschuwing weg", (await codes()) === "");
  check("(D) archiveren: nooit wissen; de regel zoekt niet meer", isOk(await admin.setQuoteStdPost({ key: "proef-werfbord", name: "Werfbord", keywords: ["werfbord"], enabled: true, severity: { warn: null }, order: 50n, archived: true })) && (await admin.getQuoteRules()).stdPosts.find((s) => s.key === "proef-werfbord")?.archived === true);
  await mk([]);
  check("(D) een gearchiveerde standaardpost telt niet meer", (await codes()) === "");
  const audit = await admin.auditLog(0n, 400n);
  check("(D) auditlog: 'offerteregel-gezet' en 'offertestandaardpost-gezet'", audit.some((e) => e.action === "offerteregel-gezet" && e.detail.startsWith("qty-zero")) && audit.some((e) => e.action === "offertestandaardpost-gezet" && e.detail.startsWith("proef-werfbord")));
}

// ── Opruimen: de standaardinstellingen terug, de proefofferte gearchiveerd ──
await resetRules();
{
  const cfg = await admin.getQuoteRules();
  for (const s of cfg.stdPosts) if (!STD.some(([k]) => k === s.key) && !s.archived) ok(await admin.setQuoteStdPost({ key: s.key, name: s.name, keywords: s.keywords, enabled: s.enabled, severity: s.severity, order: s.order, archived: true }));
  const now = toRules(await admin.getQuoteRules());
  check("(opruimen) de regels staan weer op de standaard", S(now.rules.map((r) => [r.key, r.enabled, r.severity, r.thresholdBp])) === S(defRules().map((r) => [r.key, r.enabled, r.severity, r.thresholdBp])) && now.std.filter((s) => !s.archived).length === 4);
}
await setVatNote(oldNote);
ok(await calc.setQuoteArchived(q.id, true, "proef 2.6 klaar"));

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
