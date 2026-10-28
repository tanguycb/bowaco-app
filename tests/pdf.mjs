// De offerte-PDF (stap 2.7, bouwplan §9 rij 2.7 ⚖): src/frontend/src/pdf/offerte.ts in Node, met VERZONNEN offertes
// (tests/pdf-voorbeeld.mjs). Controleert met PyMuPDF (python3, enkel lezen) de tekst, de ingebedde lettertypes, de bladzijden en
// dat geen enkel stukje tekst buiten de marge valt. De invoer van de PDF (QuotePdfData) heeft geen veld voor een aankoopprijs of
// een marge; deze test bewijst bovendien dat zulke woorden nooit in de PDF staan. Schrijft niets buiten een tijdelijke map.
//   node tests/pdf.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quotePdf } from "../src/frontend/src/pdf/offerte.ts";
import { fonts, voorbeeld } from "./pdf-voorbeeld.mjs";

let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const dir = mkdtempSync(join(tmpdir(), "bowaco-pdf-"));

// PyMuPDF: per bladzijde de tekst, de lettertypen en de grenzen van elk tekstblok.
const PY = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
out = {"pages": [], "fonts": []}
fs = set()
for p in d:
    r = p.rect
    blocks = [b for b in p.get_text("blocks") if b[6] == 0]
    out["pages"].append({"text": p.get_text(), "w": r.width, "h": r.height,
      "outside": [b[4][:40] for b in blocks if b[0] < 40 or b[2] > r.width - 40 or b[3] > r.height - 20 or b[1] < 20]})
    for f in p.get_fonts(full=True):
        fs.add((f[3], f[1]))
out["fonts"] = sorted([list(x) for x in fs])
print(json.dumps(out))
`;
function read(bytes, name) {
  const f = join(dir, name);
  writeFileSync(f, bytes);
  const r = spawnSync("python3", ["-c", PY, f], { encoding: "utf8", cwd: dir });
  if (r.status !== 0) throw new Error(`PyMuPDF: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const all = (o) => o.pages.map((p) => p.text).join("\n");
const F = fonts();

// ── 1. De verzonden offerte ─────────────────────────────────────────────
const v1 = await quotePdf(voorbeeld(), F);
const r1 = read(v1, "verstuurd.pdf");
const t1 = all(r1);
check("(1) een geldige PDF (%PDF), minder dan 150 KB, 3 bladzijden (offerte, totalen, voorwaarden)", String.fromCharCode(...v1.slice(0, 5)) === "%PDF-" && v1.length < 150_000 && r1.pages.length === 3, `${v1.length} bytes, ${r1.pages.length} bladzijden`);
check("(1) A4", r1.pages.every((p) => Math.abs(p.w - 595.28) < 0.5 && Math.abs(p.h - 841.89) < 0.5));
check("(1) woordmerk, offertenummer, versie, klant, adres, werf", /BOWACO/.test(t1) && t1.includes("2026/234") && /versie 1/.test(t1) && t1.includes("Familie Proef") && t1.includes("Proefstraat 12") && t1.includes("8670 Koksijde") && t1.includes("P-A · Proefwerf A"));
check("(1) titel en inleiding", t1.includes("Proef renovatie woning") && t1.includes("Verzonnen inleiding"));
check("(1) hoofdstukken met hun subtotaal, posten met code, VH en contractvorm", /Werfinrichting/.test(t1) && /Dakwerken/.test(t1) && t1.includes("€ 1.310,63") && t1.includes("7.01") && /\bVH\b/.test(t1) && /\bvast\b/.test(t1) && /\bregie\b/.test(t1));
check("(1) hoeveelheid, eenheid, eenheidsprijs en lijntotaal (12,5 lm × 56,25 = 703,13)", t1.includes("12,5") && t1.includes("€ 56,25") && t1.includes("€ 703,13"));
check("(1) minwerk negatief, pro memorie als 'p.m.'", t1.includes("-€ 112,50") && t1.includes("p.m."));
check("(1) opties apart en niet in het totaal, met meer- en minprijs", /Opties/.test(t1) && /niet inbegrepen in het totaal/.test(t1) && /meerprijs/.test(t1) && /minprijs/.test(t1) && t1.includes("€ 125,00") && t1.includes("-€ 225,00"));
check("(1) subtotaal, btw 6 % met de grond, totaal incl. btw", t1.includes("Subtotaal excl. btw") && t1.includes("€ 2.508,63") && /Btw 6 %/.test(t1) && t1.includes("€ 150,52") && /Grond voor het btw-tarief/.test(t1) && /Totaal incl\. btw/.test(t1) && t1.includes("€ 2.659,15"));
check("(1) geldig tot een datum, betaaltermijn, de legende van de contractvormen", /Geldig tot: 24 november 2026/.test(t1) && /Betaaltermijn: 30 dagen/.test(t1) && /VH = geschatte hoeveelheid/.test(t1));
check("(1) afzender en 'Voor akkoord' (twee handtekenvakken) en de uitleg van het digitale akkoord", /AFZENDER/i.test(t1) && /BOWACO \(proef\)/.test(t1) && /Voor akkoord/.test(t1) && /digitaal aanvaarden/.test(t1));
check("(1) de algemene voorwaarden op eigen bladzijden, met de VOORLOPIGE tekst duidelijk gemarkeerd", /Algemene voorwaarden/.test(r1.pages[2].text) && /Voorlopige tekst/.test(r1.pages[2].text) && /\[In te vullen door BOWACO\.\]/.test(r1.pages[2].text));
check("(1) elke bladzijde heeft een voet met nummer, versie en de eerste 16 tekens van de hash, en 'i / n'", r1.pages.every((p, i) => p.text.includes("e41f4b2e374d0000") && p.text.includes(`${i + 1} / 3`)));
check("(1) geen watermerk 'ONTWERP' op een verzonden offerte", !/ONTWERP/.test(t1));
check("(1) NOOIT een woord over aankoopprijs, marge, kostprijs of reden van de marge", !/aankoop|marge|kostprijs|inkoop|winst/i.test(t1));
check("(1) lettertypen ingebed (subset), enkel Archivo en IBM Plex Mono, geen standaardlettertype", r1.fonts.length >= 4 && r1.fonts.every(([name, ext]) => /^(Archivo|IBMPlexMono)-/.test(name) && ext === "ttf"), r1.fonts.map((f) => `${f[0]}:${f[1]}`).join(", "));
check("(1) geen tekstblok buiten de marges", r1.pages.every((p) => p.outside.length === 0), r1.pages.flatMap((p) => p.outside).join(" | "));

// ── 2. Een ontwerp en een aanvaarde offerte ─────────────────────────────
const r2 = read(await quotePdf(voorbeeld({ frozen: false, status: "ontwerp", hash: "", sentDay: null, validUntilDay: null }), F), "ontwerp.pdf");
const t2 = all(r2);
check("(2) ontwerp: watermerk ONTWERP, 'ontwerp' in de kop en de voet, geen datum en geen hash", /ONTWERP/.test(t2) && /ontwerp/.test(r2.pages[0].text) && /Geldig: 30 dagen na datum/.test(t2) && /Datum: —/.test(t2));
const r3 = read(await quotePdf(voorbeeld({ status: "aanvaard", accepted: { digital: { atDay: 20_755, byName: "Piet Proef" }, signed: { atDay: 20_756, byName: "Kantoor Proef" } } }), F), "aanvaard.pdf");
const t3 = all(r3);
check("(2) aanvaard: wie, wanneer, en de hash waarvoor het akkoord geldt; geen leeg handtekenvak meer", /AANVAARD/.test(t3) && /Digitaal akkoord van Piet Proef op 29 oktober 2026/.test(t3) && /Getekende offerte ontvangen op 30 oktober 2026/.test(t3) && /e41f4b2e374d/.test(t3) && !/Naam, datum en handtekening/i.test(t3));

// ── 3. Een lange offerte: pagina's, afbreken, vervolgkop ────────────────
const base = voorbeeld();
const many = [];
for (let i = 0; i < 90; i++) many.push({ chapter: i < 45 ? "c1" : "c2", kind: "item", code: `9.${i}`, title: `Proef lange post ${i} met een titel die ook lang genoeg is om af te breken over twee regels`, text: i % 7 === 0 ? "Een lange lastenboektekst. ".repeat(30) : "", specRef: "", qtyMilli: 1500n, unitName: "m²", form: i % 2 ? "vh" : "fixed", unitSellCents: 1234n, lineSellCents: 1851n });
const r4 = read(await quotePdf(voorbeeld({ lines: many, chapters: base.chapters.slice(0, 2) }), F), "lang.pdf");
check("(3) 90 posten: 5 of meer bladzijden, vervolgkop met 'vervolg', geen tekst buiten de marge", r4.pages.length >= 5 && /vervolg/.test(all(r4)) && r4.pages.every((p) => p.outside.length === 0), `${r4.pages.length} bladzijden; ${r4.pages.flatMap((p) => p.outside).slice(0, 3).join(" | ")}`);
check("(3) elke bladzijde 'i / n' met n = het aantal bladzijden", r4.pages.every((p, i) => p.text.includes(`${i + 1} / ${r4.pages.length}`)));

// ── 4. Vreemde tekens, lege velden, grote bedragen ──────────────────────
const odd = voorbeeld({ title: "Proef ëéèçü € ² · … «tekst» 日本語 😀", intro: "", vatNote: "", clientAddress: null, clientVat: "BE 0123.456.789", subtotalCents: 123_456_789_012n, vatCents: 7_407_407_341n, totalCents: 130_864_196_353n });
let oddOk = true;
let oddText = "";
try { const ro = read(await quotePdf(odd, F), "vreemd.pdf"); oddText = all(ro); } catch (e) { oddOk = false; oddText = String(e); }
check("(4) vreemde tekens (accenten, €, ², CJK, emoji) en een leeg adres: geen fout, de onbekende worden '?'", oddOk && oddText.includes("ëéèçü") && oddText.includes("?") && /BTW BE 0123\.456\.789/.test(oddText), oddText.slice(0, 120));
check("(4) bedragen boven een miljard: € 1.234.567.890,12", oddText.includes("€ 1.234.567.890,12"));

// ── 5. Het type heeft geen prijsvelden (statisch) ───────────────────────
const keys = new Set(Object.keys(voorbeeld()).concat(Object.keys(voorbeeld().lines[0])));
check("(5) de invoer van de PDF kent geen veld met cost, margin, marg, aankoop of purchase", ![...keys].some((k) => /cost|marg|aankoop|purchase|reason/i.test(k)), [...keys].join(","));

// ── 6. Lange teksten (securityreview 2.12): één woord van 4.000 tekens zonder spaties (geplakt lastenboek) en voorwaarden van
//    ± 27.000 tekens in één alinea: snel (was minuten: kubieke afbreeklus) en volledig zichtbaar (liep stil onder de marge) ──
{
  const longWord = "x".repeat(4000);
  const longTerms = Array.from({ length: 300 }, (_, i) => `Proefzin ${i} van de lange voorwaarden zonder alinea-einde, met nog wat woorden erbij.`).join(" ");
  const t0 = Date.now();
  const r6 = read(await quotePdf(voorbeeld({ lines: base.lines.map((l, i) => (i === 0 ? { ...l, text: longWord } : l)), intro: longWord.slice(0, 1200), terms: { version: 1, title: "Lange voorwaarden (proef)", text: longTerms, provisional: false } }), F), "lang-woord.pdf");
  const dt = Date.now() - t0;
  const t6 = all(r6);
  check("(6) een woord van 4.000 tekens in een post en 1.200 in de inleiding: de PDF in minder dan 5 s (was minuten)", dt < 5000, `${dt} ms`);
  check("(6) de voorwaarden van ± 27.000 tekens staan volledig in de PDF (begin én einde), niets buiten de marge", t6.includes("Proefzin 0 van") && t6.includes("Proefzin 299 van") && r6.pages.every((p) => p.outside.length === 0), `${r6.pages.length} bladzijden; ${r6.pages.flatMap((p) => p.outside).join(" | ")}`);
  check("(6) het lange woord is afgebroken over regels en volledig aanwezig (4.000 × x)", (t6.match(/x/g) ?? []).length >= 4000);
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
