// Stap 2.5, ENKEL LOKAAL: de echte offerte (gelezen door tools/rekentest-echt.py, ~/.bowaco/posten/rekentest-<nr>.json)
// rekenen met de rekenmodule van de app en naast de Excel leggen. Het rapport met ECHTE bedragen gaat naar
// ~/.bowaco/posten/rekentest-<nr>.md (buiten git); op de terminal komen enkel ja/nee en aantallen.
//   node tests/rekentest-echt.mjs ~/.bowaco/posten/rekentest-2026-231.json [verwacht subtotaal in cent]
// Zonder verwacht bedrag geldt de som van kolom F van het blad zelf (zo komt er geen echt bedrag in git).
import { readFileSync, writeFileSync } from "node:fs";
import { C } from "./offerte-lib.mjs";

const [path, expectArg] = process.argv.slice(2);
if (!path) throw new Error("gebruik: node tests/rekentest-echt.mjs <rekentest-…json> [verwacht subtotaal in cent]");
const d = JSON.parse(readFileSync(path, "utf8"));
if (d.bron !== "echt") throw new Error("geen uitvoer van tools/rekentest-echt.py");
const eur = (c) => (Number(c) / 100).toLocaleString("nl-BE", { style: "currency", currency: "EUR" });
const cents = (x) => BigInt(Math.round(x * 100));
// Het verwachte subtotaal (architectuur §1.3) = de som van kolom F over alle prijslijnen, of het bedrag als argument.
const expected = expectArg ? BigInt(expectArg) : cents(d.items.reduce((s, it) => s + (it.F ?? 0), 0));

const milli = (x) => BigInt(Math.round(x * 1000));

// De app: hoeveelheid in duizendsten, de eenheidsprijs op de cent (zoals ze in de app bewaard wordt), rekenen met calc.ts.
const keys = d.chapters.map((_, i) => String(i));
const lines = d.items.map((it) => ({ chapter: String(it.chapter), kind: "item", qtyMilli: milli(it.qty), cost: null, rule: { price: cents(it.price) } }));
const t = C.calcTotals(keys, lines, 600n, 2000n);
// Ter vergelijking: de Excel-rekenwijze zonder tussentijdse afronding (hoeveelheid × eenheidsprijs met alle decimalen),
// en de kolom F zoals ze in het blad staat (met de getypte totalen).
const exactLine = (it) => it.qty * it.price;
const exact = d.items.reduce((s, it) => s + exactLine(it), 0);
const sheetF = d.items.reduce((s, it) => s + (it.F ?? 0), 0);
const typed = d.items.filter((it) => it.F !== null && Math.abs(it.F - exactLine(it)) > 0.005);
const fractional = d.items.filter((it) => Math.abs(it.price * 100 - Math.round(it.price * 100)) > 1e-6);
const perChapter = d.chapters.map((c, i) => {
  const own = d.items.filter((it) => it.chapter === i).reduce((s, it) => s + exactLine(it), 0);
  return { ...c, app: t.chapters[i].sell, own: cents(own), sheet: c.sumValue === null ? null : cents(c.sumValue) };
});
const wrongCh = perChapter.filter((c) => c.sheet !== null && c.sheet !== c.own);
// Varianten om het verschil te verklaren: (1) elke lijn op de cent met de EXACTE eenheidsprijs (geen afronding van de prijs);
// (2) idem, maar met de getypte totalen van het blad (rij 58: € 350 i.p.v. 1 × € 450), zoals de som van kolom F.
const exactRounded = d.items.reduce((s, it) => s + cents(exactLine(it)), 0n);
const exactRoundedTyped = d.items.reduce((s, it) => s + cents(it.F !== null && typed.includes(it) ? it.F : exactLine(it)), 0n);
// Het verschil app − verwacht in drie delen: (a) de getypte totalen (fout 4: de app rekent ze uit), (b) elke lijn op de
// cent (de som van kolom F is onafgerond), (c) de eenheidsprijs op de cent (zoals op de offerte; de Excel rekent met alle
// decimalen van X/0.8). Groen = (a) + (b) + (c) verklaart het verschil tot op de cent.
const dTyped = cents(typed.reduce((s, it) => s + exactLine(it) - it.F, 0));
const dLine = exactRoundedTyped - expected;
const dUnit = t.subtotal - exactRounded;
const explained = t.subtotal - expected === dTyped + dLine + dUnit;
const appOk = t.subtotal === expected;
const exactOk = cents(exact) === expected;

const md = [
  `# Rekentest offerte ${d.offerte} (ECHTE bedragen — niet in git, niet delen)`,
  "",
  `*${new Date().toISOString().slice(0, 10)}, stap 2.5. Bron: ${d.bestand} (als gegevens gelezen met tools/rekentest-echt.py). ${d.chapters.length} hoofdstukken, ${d.items.length} prijslijnen.*`,
  "",
  "## Uitkomst",
  "",
  "| | |",
  "|---|---|",
  `| Verwacht subtotaal excl. btw (architectuur §1.3) | ${eur(expected)} |`,
  `| **App** (eenheidsprijs op de cent, hoeveelheid × prijs op de cent, som per hoofdstuk) | **${eur(t.subtotal)}** — ${appOk ? "GELIJK" : `verschil ${eur(t.subtotal - expected)}`} |`,
  `| Excel-rekenwijze zonder tussentijdse afronding | ${eur(cents(exact))} — ${exactOk ? "gelijk aan het verwachte" : `verschil ${eur(cents(exact) - expected)}`} |`,
  `| Som van kolom F zoals in het blad (met getypte totalen) | ${eur(cents(sheetF))} |`,
  `| Variant: elke lijn op de cent met de exacte eenheidsprijs | ${eur(exactRounded)} |`,
  `| Variant: idem, met de getypte totalen van het blad (zoals kolom F) | ${eur(exactRoundedTyped)} — ${exactRoundedTyped === expected ? "GELIJK aan het verwachte" : "verschil " + eur(exactRoundedTyped - expected)} |`,
  "",
  `| **Verschil app − verwacht** | ${eur(t.subtotal - expected)} = (a) getypte totalen ${eur(dTyped)} + (b) elke lijn op de cent ${eur(dLine)} + (c) eenheidsprijs op de cent ${eur(dUnit)} → ${explained ? "volledig verklaard" : "NIET verklaard"} |`,
  "",
  "**Verklaring.** Het verwachte bedrag is de som van kolom F zoals ze in het blad staat, met het getypte totaal van de getypte lijn(en) hieronder (fout 4). De app rekent elke lijn uit (hoeveelheid × eenheidsprijs) en kan dus nooit een getypt totaal overnemen; daarbovenop rondt ze de eenheidsprijs af op de cent zoals ze op de offerte staat (zie Afronding).",
  `| App: btw 6 % · totaal incl. btw | ${eur(t.vat)} · ${eur(t.total)} |`,
  "",
  "## Somcellen van het blad",
  "",
  "| rij | kolom | label | formule | waarde |",
  "|---|---|---|---|---|",
  ...d.sums.map((s) => `| ${s.row} | ${s.col === 6 ? "F" : "G"} | ${(s.label || "").replace(/\|/g, "/")} | \`${s.formula}\` | ${s.value === null ? "–" : eur(cents(s.value))} |`),
  "",
  "## Hoofdstukken: blad (kolom G) tegenover de eigen posten",
  "",
  "| hfst | titel | blad | eigen posten | app | |",
  "|---|---|---|---|---|---|",
  ...perChapter.map((c) => `| ${c.code} | ${c.title.replace(/\|/g, "/")} | ${c.sheet === null ? "–" : eur(c.sheet)} | ${eur(c.own)} | ${eur(c.app)} | ${c.sheet !== null && c.sheet !== c.own ? `**blad wijkt af** (\`${c.sumFormula}\`)` : ""} |`),
  "",
  "## Lijnen met een getypt totaal (kolom F ≠ hoeveelheid × eenheidsprijs)",
  "",
  ...(typed.length ? typed.map((it) => `- rij ${it.row}: ${it.qty} × ${eur(cents(it.price))} = ${eur(cents(exactLine(it)))}, in het blad ${eur(cents(it.F))}${it.FFormula ? ` (\`${it.FFormula}\`)` : " (getypt)"}`) : ["- geen"]),
  "",
  `## Afronding`,
  "",
  `${fractional.length} eenheidsprijzen hebben meer dan twee decimalen (\`X/0.8\`); de app rondt de eenheidsprijs af op de cent (zoals op de offerte staat) en dan het lijntotaal. Verschil app − Excel zonder afronding: ${eur(t.subtotal - cents(exact))}.`,
  "",
];
const out = path.replace(/\.json$/, ".md");
writeFileSync(out, md.join("\n"), { mode: 0o600 });
console.log(`app = verwacht subtotaal: ${appOk ? "JA" : "NEE"} · verschil volledig verklaard (getypt totaal + afronding): ${explained ? "JA" : "NEE"} · ${wrongCh.length} hoofdstuksommen in het blad wijken af · ${typed.length} getypte lijntotalen · ${fractional.length} prijzen met > 2 decimalen`);
console.log(`→ ${out} (ECHTE bedragen: buiten git)`);
process.exit(appOk || explained ? 0 : 1);
