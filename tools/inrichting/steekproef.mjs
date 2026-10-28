// Stap 2b.6: steekproef na de inrichting. Neemt willekeurige rijen uit de plannen en zoekt ze terug in de app: komt wat
// gelezen werd, volledig en ongewijzigd binnen (titel, eenheid, hoofdstuk, aankoopprijs met datum, marge, adres, KBO,
// doorlooptijd …)? Leest enkel; schrijft niets in de app. Zelfde grens als de inrichting (echte gegevens enkel lokaal).
//   ICP_HOST=http://localhost:8061 node tools/inrichting/steekproef.mjs --canister <id> [--n 25] [--plan map] [--seed 7]
//                                                                        [--verslag run.csv]  (rijen met een conflict overslaan)
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { backend } from "../lib.mjs";
import { leesPlan, bibliotheek, fold, dagNr } from "./lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const cid = arg("canister");
if (!cid) throw new Error("gebruik: node tools/inrichting/steekproef.mjs --canister <id> [--n 25] [--plan map]");
const map = arg("plan", join(homedir(), ".bowaco", "inrichting", "plan"));
const n = Number(arg("n", 25));
let seed = Number(arg("seed", 7));
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const kies = (xs, k = n) => { const c = [...xs]; const out = []; while (c.length && out.length < k) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
const a = await backend(arg("identity", "proef-admin"), cid);
let goed = 0, fout = 0;
const check = (wat, sleutel, c, x = "") => { c ? goed++ : fout++; if (!c) console.log(`✗ ${wat} ${sleutel}${x ? `: ${x}` : ""}`); };
const P = (f) => leesPlan(join(map, f));
const gelijk = (x, y) => String(x ?? "").trim().replace(/\s+/g, " ") === String(y ?? "").trim().replace(/\s+/g, " ");
const conflict = new Set(arg("verslag") ? readFileSync(arg("verslag"), "utf8").split("\n").filter((l) => l.includes('"conflict"')).map((l) => l.split(";")[2]?.replace(/"/g, "")) : []);

const p1 = P("stap1-bedrijf.json");
if (p1) {
  const doc = await a.getQuoteDocSettings();
  check("afzender", "", doc.issuer === p1.afzender);
  check("betaaltermijn", "", Number(doc.paymentDays) === p1.betaaltermijn);
  check("voorwaarden", "", doc.terms.some((t) => fold(t.text) === fold(p1.voorwaarden.tekst) && t.provisional));
  check("offertenummer", "", Number(await a.quoteSequence(BigInt(p1.offertenummer.jaar))) === p1.offertenummer.laatste);
  const units = new Set((await a.libraryUnits(false)).map((u) => u.key));
  for (const e of p1.eenheden) check("eenheid", e.key, units.has(e.key));
  const ch = await a.libraryChapters(false);
  for (const h of p1.hoofdstukken) check("hoofdstuk", h.code, ch.some((c) => c.code === h.code && c.title === h.titel));
}

const p2 = P("stap2-firmas.json");
if (p2) {
  const orgs = await a.listOrgs(false);
  const soort = (o) => Object.keys(o.kind)[0];
  for (const r of kies(p2.rijen.filter((x) => !conflict.has(x.key)))) {
    const o = orgs.find((x) => (r.kbo && x.kbo?.[0] === r.kbo) || fold(x.name) === fold(r.name));
    if (!o) { check("firma", r.key, false, "niet gevonden (conflict in het verslag?)"); continue; }
    check("firma", r.key, soort(o) === r.kind && (!r.kbo || o.kbo?.[0] === r.kbo) && r.aliases.every((c) => o.aliases.includes(c) || fold(c) === fold(o.name)), `${soort(o)}/${o.kbo?.[0]}/${o.aliases.join(",")}`);
  }
}

const p3 = P("stap3-werven.json");
if (p3) {
  const works = await a.listWorks();
  const notes = new Map((await a.workReviewNotes()).map(([id, t]) => [id, t]));
  for (const w of kies(p3.werven)) {
    const x = works.find((y) => y.code === w.code);
    check("werf", w.code, x && x.name === w.naam && x.address.street === w.adres.street && x.address.number === w.adres.number && x.address.zip === w.adres.zip && x.address.city === w.adres.city && Number(x.vatBp) === w.vatBp && (notes.get(x.id) ?? "").includes("Nog na te kijken"), x ? `${x.name} · ${x.address.street} ${x.address.number}` : "ontbreekt");
  }
  // Planning: de taken van een blok staan in de juiste werf (vervolg = de werf van de map).
  const pl = leesPlan(isAbsolute(p3.planning.plan) ? p3.planning.plan : join(map, p3.planning.plan));
  for (const b of kies(pl.blokken, Math.min(n, 12))) {
    // Het doelblok: een vervolg uit 1.5 komt in de werf van het blok waarvan het een vervolg is.
    let d = b;
    const gezien = new Set();
    while (d.besluit?.beslissing === "vervolg" && d.besluit.doel && p3.planning.blokken[String(d.rij)]?.beslissing !== "vervolg" && !gezien.has(d.code)) {
      gezien.add(d.code);
      d = pl.blokken.find((x) => x.code === d.besluit.doel) ?? d;
    }
    const k = p3.planning.blokken[String(d.rij)];
    const doel = k?.beslissing === "vervolg" ? works.find((w) => w.code === k.werf) : null;
    const kand = doel ? [doel] : works.filter((w) => fold(w.name) === fold(d.name) || (w.address.street === d.street && w.address.number === d.number));
    let gevonden = 0;
    for (const w of kand) {
      const titels = new Set((await a.getPlan(w.id)).tasks.map((t) => t.title));
      gevonden = Math.max(gevonden, b.tasks.filter((t) => titels.has(t.title)).length);
    }
    check("planningblok", b.code, gevonden === b.tasks.length, `${gevonden}/${b.tasks.length} taken teruggevonden`);
  }
}

const p4 = P("stap4-posten.json");
if (p4) {
  const { perSleutel } = await bibliotheek(a);
  const ch = new Map((await a.libraryChapters(true)).map((c) => [c.id, c.code]));
  for (const p of kies(p4.posten)) {
    const it = perSleutel.get(p.key);
    if (!it) { check("post", p.key, false, "niet gevonden"); continue; }
    const vorm = Object.keys(it.form)[0];
    check("post", p.key, gelijk(it.title, p.titel) && it.unit === p.eenheid && ch.get(it.chapterId) === p.hoofdstuk && vorm === p.vorm && gelijk(it.text, p.tekst), `${it.title} · ${it.unit} · ${ch.get(it.chapterId)} · ${vorm}`);
    const h = (await a.readLibraryPriceHistory(it.id)).ok;
    for (const k of p.kosten) {
      const c = h.costs.find((x) => x.ref === `offerte ${k.offerte}`);
      check("aankoopprijs", `${p.key} ${k.offerte}`, c && Number(c.costCents[0]) === k.cents && c.day === dagNr(k.dag), c ? `${c.costCents[0]} op dag ${c.day}` : "ontbreekt");
    }
    const pr = (await a.readLibraryPrices([it.id])).ok.prices[0];
    const rule = pr.rule[0];
    const verwacht = p.margeBp !== null && p.margeBp !== Number((await a.readLibraryPrices([])).ok.standardMarginBp) ? `m${p.margeBp}` : p.verkoopCents !== null && p.verkoopCents !== undefined ? `p${p.verkoopCents}` : "std";
    const echt = rule ? ("margin" in rule ? `m${rule.margin}` : `p${rule.price}`) : "std";
    check("verkoopregel", p.key, verwacht === echt, `${echt} ≠ ${verwacht}`);
  }
}

const p5 = P("stap5-prijzen.json");
if (p5) {
  const { perSleutel } = await bibliotheek(a);
  for (const l of p5.lijsten) for (const x of kies(l.lijnen, 4)) {
    const it = (x.offerteKey && perSleutel.get(x.offerteKey)) || perSleutel.get(x.key);
    const h = it ? (await a.readLibraryPriceHistory(it.id)).ok : null;
    const c = h?.costs.find((y) => y.ref === `prijslijst ${l.doc}`);
    check("prijs uit prijslijst", `${l.doc} ${x.key}`, c && Number(c.costCents[0]) === x.cents && c.day === dagNr(l.datum), c ? String(c.costCents[0]) : "ontbreekt");
  }
}

const p6 = P("stap6-vergunningen.json");
if (p6) {
  const gem = await a.listMunicipalities(false);
  for (const g of p6.gemeenten) {
    const m = gem.find((x) => fold(x.name) === fold(g.naam));
    check("gemeente", g.naam, m && g.postcodes.every((z) => m.zips.includes(z)));
    for (const p of g.procedures) check("procedure", `${g.naam}:${p.soort}`, m?.procedures.some((x) => x.kind === p.soort && Number(x.leadDays) === p.dagen));
  }
}
console.log(`\nsteekproef: ${goed} ✓  ${fout} ✗`);
process.exit(fout ? 1 : 0);
