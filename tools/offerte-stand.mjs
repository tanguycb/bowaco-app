// De stand van alle offertes, vorderingsstaten, prijsvragen (2c.2) en rechten op een canister, als JSON (migratiecheck 2c.1, ontwerp 2c §9).
//   node tools/offerte-stand.mjs <canister> <uit.json>           met de .did van DEZE map (oude kopie of nieuwe code)
//   node tools/offerte-stand.mjs vergelijk <voor.json> <na.json>   elk veld van "voor" moet in "na" gelijk zijn (nieuwe velden
//                                                                   en nieuwe offertes tellen niet); geeft de verschillen
// Enkel op een EIGEN lokaal net met de proefidentiteiten van tests/rollen.mjs (nooit live: tools/lib.mjs weigert daar).
// Leest als beheerder, calculator, werfleider, architect, OA, klant en VC; elke lezing met bedragen schrijft een auditregel
// (de auditlog telt daarom niet mee). De uitvoer bevat enkel verzonnen proefgegevens, maar blijft buiten git.
import { readFileSync, writeFileSync } from "node:fs";
import { backend } from "./lib.mjs";

const big = (_, v) => (typeof v === "bigint" ? `${v}n` : v && typeof v === "object" && typeof v.toText === "function" && v._isPrincipal ? v.toText() : v);

if (process.argv[2] === "vergelijk") {
  const voor = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const na = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const diffs = [];
  // Projectie: enkel wat "voor" kent. Een veld dat erbij kwam (2c.1: grossCents, form, terms …) telt niet.
  const walk = (a, b, path) => {
    if (diffs.length > 200) return;
    if (a === null || typeof a !== "object") { if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return; }
    if (b === null || typeof b !== "object") { diffs.push(`${path}: ontbreekt na de upgrade`); return; }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) { diffs.push(`${path}: lengte ${a.length} → ${Array.isArray(b) ? b.length : "?"}`); return; }
      a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
      return;
    }
    for (const k of Object.keys(a)) walk(a[k], b[k], `${path}.${k}`);
  };
  const skip = new Set((process.env.VERWACHT ?? "").split(",").filter(Boolean));
  for (const k of Object.keys(voor)) if (!skip.has(k)) walk(voor[k], na[k], k);
  const expected = [...skip].map((k) => { const before = diffs.length; walk(voor[k], na[k], k); const n = diffs.length - before; diffs.length = before; return `${k}: ${n === 0 ? "gelijk" : `${n} verschil(len), verwacht`}`; });
  console.log(`vergelijking ${process.argv[3]} → ${process.argv[4]}: ${diffs.length === 0 ? "GELIJK" : `${diffs.length} VERSCHIL(LEN)`}`);
  for (const e of expected) console.log(`  · ${e}`);
  for (const d of diffs.slice(0, 60)) console.log(`  ✗ ${d}`);
  process.exit(diffs.length ? 1 : 0);
}

const [cid, out] = process.argv.slice(2);
if (!cid || !out) throw new Error("gebruik: node tools/offerte-stand.mjs <canister> <uit.json>");
const names = { admin: "proef-admin", calculator: "proef-calculator", werfleider: "proef-werfleider", architect: "proef-architect", oa: "proef-oa2", klant: "proef-klant", vc: "proef-vc" };
const who = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k, n]) => [k, await backend(n, cid)])));
const res = async (p) => { try { const r = await p; return r && typeof r === "object" && "err" in r ? { err: r.err } : r && typeof r === "object" && "ok" in r ? { ok: r.ok } : { ok: r }; } catch (e) { return { trap: /Geen toegang/.test(String(e)) ? "Geen toegang" : String(e).slice(0, 80) }; } };
const allowed = (r) => ("ok" in r ? "ja" : "err" in r ? `fout: ${String(r.err).slice(0, 40)}` : "nee");

const stand = { rechten: {}, offertes: {}, versies: {}, perRol: {}, klant: {}, vorderingen: {}, regels: null, controle: {}, telling: {} };
for (const [k, b] of Object.entries(who)) {
  const me = await b.me();
  stand.rechten[k] = { status: me.status, rollen: me.person[0]?.roles ?? null, caps: me.caps[0] ?? null };
}
const quotes = await who.admin.listQuotes([], true);
for (const q of quotes) {
  stand.offertes[String(q.id)] = { number: q.number, title: q.title, workId: q.workId, archived: q.archived, versies: q.versions.map((v) => ({ id: v.id, version: v.version, status: v.status, lines: v.lines })) };
  for (const v of q.versions) {
    const r = await res(who.admin.readQuoteVersion(v.id));
    if (r.ok) {
      const x = r.ok;
      // De velden van vóór 2c.1 (een nieuw veld telt bij de vergelijking toch niet; dit houdt het bestand klein).
      stand.versies[String(v.id)] = { scope: x.scope, version: x.version, chapters: x.chapters, lines: x.lines, totals: x.totals, sell: x.sell, costs: x.costs, margins: x.margins, check: x.check, vatNote: x.vatNote, doc: x.doc };
    } else stand.versies[String(v.id)] = r;
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) {
      const y = await res(who[rol].readQuoteVersion(v.id));
      per[rol] = y.ok ? { scope: y.ok.scope, totals: y.ok.totals, sell: y.ok.sell, costs: y.ok.costs.length } : allowed(y);
    }
    stand.perRol[String(v.id)] = per;
    if ("draft" in v.status) stand.controle[String(v.id)] = await res(who.admin.checkQuoteVersion(v.id));
  }
}
const mine = await res(who.klant.listMyQuotes());
if (mine.ok) for (const x of mine.ok) stand.klant[String(x.versionId)] = { kort: x, lezen: await res(who.klant.readMyQuote(x.versionId)) };
else stand.klant.fout = mine;
stand.regels = await res(who.admin.getQuoteRules());
for (const w of await who.admin.listWorks()) {
  const list = await res(who.admin.listProgress(w.id));
  if (!list.ok || list.ok.length === 0) continue;
  stand.vorderingen[String(w.id)] = list.ok;
  for (const p of list.ok) stand.vorderingen[`staat-${p.id}`] = await res(who.admin.readProgressStatement(p.id));
}
// 2c.2: de prijsvragen (enkel als de code ze kent): de prijsvraag zelf (kantoor), de stand per rol, wat de OA van zijn eigen
// uitnodiging ziet en de bedragen van elke OA-offerte (update-call met auditregel). Een oudere code kent geen prijsvragen: dan
// staat de sleutel er niet, en telt hij bij de vergelijking niet mee.
if (typeof who.admin.listTenders === "function") {
  stand.prijsvragen = {};
  stand.prijsvraagRechten = {};
  stand.oaOffertes = {};
  stand.mijnPrijsvragen = {};
  for (const w of await who.admin.listWorks()) {
    const list = await res(who.admin.listTenders([w.id]));
    if (!list.ok || list.ok.length === 0) continue;
    const per = {};
    for (const rol of ["calculator", "werfleider", "architect", "oa", "klant", "vc"]) per[rol] = allowed(await res(who[rol].listTenders([w.id])));
    stand.prijsvraagRechten[String(w.id)] = per;
    for (const t of list.ok) {
      const full = await res(who.admin.readTender(t.id));
      stand.prijsvragen[String(t.id)] = { status: t, full, werfleider: allowed(await res(who.werfleider.readTender(t.id))) };
      if (full.ok) for (const i of full.ok.invites) for (const q of i.oaQuotes) stand.oaOffertes[String(q.id)] = await res(who.admin.readOaQuote(q.id));
    }
  }
  const mine = await res(who.oa.listMyTenders());
  stand.mijnPrijsvragen.lijst = mine;
  if (mine.ok) for (const b of mine.ok) stand.mijnPrijsvragen[b.ref] = await res(who.oa.readMyTender(b.ref));
}
const ex = await who.admin.exportIntern();
for (const [k, v] of Object.entries(ex)) if (Array.isArray(v)) stand.telling[k] = v.length;
delete stand.telling.notifications; // leesacties kunnen meldingen maken
writeFileSync(out, JSON.stringify(stand, big, 1), { mode: 0o600 });
console.log(`stand van ${cid} → ${out}: ${quotes.length} offertes, ${Object.keys(stand.versies).length} versies, ${Object.keys(stand.vorderingen).filter((k) => !k.startsWith("staat-")).length} werven met vorderingsstaten`);
