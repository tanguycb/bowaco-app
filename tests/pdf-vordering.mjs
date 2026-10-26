// De PDF van de vorderingsstaat (stap 2.10): src/frontend/src/pdf/vorderingsstaat.ts in Node, met VERZONNEN staten. Controleert met
// PyMuPDF (python3, enkel lezen) de tekst (secties, bedragen, herziening, btw met grond, inhouding, te betalen, vervaldag, akkoord),
// A4 liggend, de ingebedde lettertypes, de bladzijden (een grote staat loopt over met een kop) en dat niets buiten de marge valt.
// De invoer (ProgressPdfData) heeft geen veld voor een aankoopprijs of marge; de test bewijst ook dat zulke woorden er niet staan.
//   node tests/pdf-vordering.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { progressPdf } from "../src/frontend/src/pdf/vorderingsstaat.ts";
import { fonts } from "./pdf-voorbeeld.mjs";

let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const dir = mkdtempSync(join(tmpdir(), "bowaco-pdf-vs-"));
const PY = `
import fitz, json, sys
d = fitz.open(sys.argv[1])
out = {"pages": [], "fonts": []}
fs = set()
for p in d:
    r = p.rect
    blocks = [b for b in p.get_text("blocks") if b[6] == 0]
    out["pages"].append({"text": p.get_text(), "w": r.width, "h": r.height,
      "outside": [b[4][:40] for b in blocks if b[0] < 39 or b[2] > r.width - 39 or b[3] > r.height - 15 or b[1] < 15]})
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
const D = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const L = (o) => ({ section: "contract", basis: "quantity", code: "", title: "", chapter: "", unit: "m²", offerQtyMilli: 0n, unitPriceCents: 0n, offerCents: 0n, prevPctBp: 0n, prevQtyMilli: 0n, prevCents: 0n, cumPctBp: 0n, cumQtyMilli: 0n, cumCents: 0n, periodCents: 0n, ...o });
const sample = (o = {}) => ({
  code: "VS P-A/2",
  credit: false,
  creditsCode: "",
  frozen: true,
  hash: "ab12cd34ef56789000000000000000000000000000000000000000000000beef",
  periodFrom: D(2026, 10, 1),
  periodTo: D(2026, 10, 31),
  sendDay: D(2026, 11, 2),
  dueDay: D(2026, 12, 2),
  paymentDays: 30,
  issuer: "BOWACO (proef)\nProefstraat 1, 8670 Koksijde",
  clientName: "Familie Proef",
  clientAddress: { street: "Proefstraat", number: "12", zip: "8670", city: "Koksijde", country: "BE" },
  clientVat: "",
  workCode: "P-A",
  workName: "Proefwerf A",
  workAddress: { street: "Werfstraat", number: "3", zip: "8670", city: "Koksijde", country: "BE" },
  quoteRefs: ["2026/234 v2"],
  vatBp: 600n,
  vatNote: "woning ouder dan 10 jaar (proef)",
  note: "Verzonnen notitie voor de klant.",
  guarantee: "retention",
  retentionOnIncl: false,
  revision: { formula: "p = P × (0,4 s/S + 0,4 i/I + 0,2)", aBp: 4000n, bBp: 4000n, cBp: 2000n, sBase: 100_000n, iBase: 200_000n, sIndex: 105_000n, iIndex: 210_000n, sLabel: "loonindex", iLabel: "materiaalindex" },
  lines: [
    L({ code: "1.01", title: "Proef afbraak vloeren", chapter: "01 Afbraak", offerQtyMilli: 40_000n, unitPriceCents: 3125n, offerCents: 125_000n, prevQtyMilli: 20_000n, prevCents: 62_500n, cumQtyMilli: 42_000n, cumCents: 131_250n, periodCents: 68_750n }),
    L({ basis: "percent", code: "2.01", title: "Proef metselwerk binnenmuur", chapter: "02 Ruwbouw", unit: "sog", offerQtyMilli: 1_000n, unitPriceCents: 1_000_000n, offerCents: 1_000_000n, prevPctBp: 3000n, prevCents: 300_000n, cumPctBp: 6000n, cumQtyMilli: 600n, cumCents: 600_000n, periodCents: 300_000n }),
    L({ section: "extra", title: "Proef meerwerk stopcontacten", unit: "st", offerQtyMilli: 3_000n, unitPriceCents: 7500n, offerCents: 22_500n, cumQtyMilli: 2_000n, cumCents: 15_000n, periodCents: 15_000n }),
    L({ section: "less", title: "Proef minwerk bestaande muur", offerQtyMilli: -2_000n, unitPriceCents: 5625n, offerCents: -11_250n, cumQtyMilli: -2_000n, cumCents: -11_250n, periodCents: -11_250n }),
    L({ section: "regie", basis: "hours", title: "Proef regie werfploeg", unit: "u", offerQtyMilli: 40_000n, unitPriceCents: 5000n, offerCents: 200_000n, prevQtyMilli: 8_000n, prevCents: 40_000n, cumQtyMilli: 16_000n, cumCents: 80_000n, periodCents: 40_000n }),
  ],
  totals: {
    periodCents: 412_500n, prevCents: 402_500n, cumCents: 815_000n, offerCents: 1_336_250n, restCents: 521_250n, revisionCents: 14_900n, subtotalCents: 427_400n, vatCents: 25_644n, totalCents: 453_044n, retentionBp: 500n, retentionCents: 21_370n, payableCents: 431_674n,
    sections: [
      { section: "contract", offerCents: 1_125_000n, prevCents: 362_500n, cumCents: 731_250n, periodCents: 368_750n },
      { section: "extra", offerCents: 22_500n, prevCents: 0n, cumCents: 15_000n, periodCents: 15_000n },
      { section: "less", offerCents: -11_250n, prevCents: 0n, cumCents: -11_250n, periodCents: -11_250n },
      { section: "regie", offerCents: 200_000n, prevCents: 40_000n, cumCents: 80_000n, periodCents: 40_000n },
    ],
  },
  answer: { ok: true, atDay: D(2026, 11, 3), byName: "Proef Klant", note: "" },
  ...o,
});

// ── 1. Een verzonden staat ──
const b1 = await progressPdf(sample(), F);
const r1 = read(b1, "staat.pdf");
const t1 = all(r1);
check("(1) een geldige PDF, A4 liggend, kleiner dan 150 KB", String.fromCharCode(...b1.slice(0, 5)) === "%PDF-" && r1.pages.every((p) => Math.abs(p.w - 841.89) < 0.5 && Math.abs(p.h - 595.28) < 0.5) && b1.length < 150_000, `${b1.length} bytes, ${r1.pages.length} bladzijde(n)`);
check("(1) woordmerk, nummer, periode, klant, werf, offerte", /BOWACO/.test(t1) && t1.includes("VS P-A/2") && /1 oktober 2026/.test(t1) && /31 oktober 2026/.test(t1) && t1.includes("Familie Proef") && t1.includes("P-A · Proefwerf A") && t1.includes("2026/234 v2"));
check("(1) de vier secties met hun posten", ["Aanneming (getekende offerte)", "Meerwerk", "Minderwerk", "Regie"].every((s) => t1.includes(s)) && t1.includes("Proef afbraak vloeren") && t1.includes("Proef regie werfploeg"));
check("(1) per post offerte, vorige, tot nu en deze periode (afbraak 1.250,00 · 625,00 · 1.312,50 · 687,50; metselwerk 60 %)", t1.includes("€ 1.250,00") && t1.includes("€ 625,00") && t1.includes("€ 1.312,50") && t1.includes("€ 687,50") && t1.includes("60 %"));
check("(1) minwerk negatief", t1.includes("-€ 112,50"));
check("(1) totalen: deze periode, prijsherziening, subtotaal, btw 6 % met de grond, totaal, inhouding, te betalen, vervaldag", t1.includes("€ 4.125,00") && t1.includes("€ 149,00") && t1.includes("€ 4.274,00") && /Btw 6 %/.test(t1) && /Grond voor het btw-tarief/.test(t1) && t1.includes("€ 4.530,44") && /Inhouding waarborg 5 %/.test(t1) && t1.includes("-€ 213,70") && t1.includes("€ 4.316,74") && /2 december 2026/.test(t1));
check("(1) cumulatief: offerte, vorige staten, totaal tot nu, nog te factureren", t1.includes("€ 13.362,50") && t1.includes("€ 4.025,00") && t1.includes("€ 8.150,00") && t1.includes("€ 5.212,50"));
check("(1) de prijsherziening met formule, model en indexwaarden", /Prijsherziening: p = P/.test(t1) && /S = 100,00/.test(t1) && /s = 105,00/.test(t1));
check("(1) het akkoord van de klant met de hash", /AKKOORD VAN DE KLANT/.test(t1) && t1.includes("Proef Klant") && t1.includes("ab12cd34ef567890"));
check("(1) voet met nummer en hash op elke bladzijde", r1.pages.every((p, i) => p.text.includes("ab12cd34ef567890") && p.text.includes(`${i + 1} / ${r1.pages.length}`)));
check("(1) ingebedde lettertypes (Archivo en IBM Plex Mono, subset)", r1.fonts.length >= 3 && r1.fonts.every(([n]) => /Archivo|IBMPlexMono|Plex/i.test(n)), JSON.stringify(r1.fonts));
check("(1) niets buiten de marge", r1.pages.every((p) => p.outside.length === 0), JSON.stringify(r1.pages.map((p) => p.outside)));
check("(1) geen aankoopprijs, marge of interne notitie", !/aankoop|marge|kostprijs|intern/i.test(t1));

// ── 2. Een ontwerp (voorbeeld met watermerk), een creditnota, een grote staat ──
const r2 = read(await progressPdf(sample({ frozen: false, code: "", hash: "", sendDay: null, dueDay: null, answer: null }), F), "ontwerp.pdf");
check("(2) ontwerp: watermerk ONTWERP, geen hash, vervaldag in dagen", /ONTWERP/.test(all(r2)) && /30 dagen na datum/.test(all(r2)));
const neg = (x) => (typeof x === "bigint" ? -x : x);
const r3 = read(await progressPdf(sample({ credit: true, code: "CN P-A/1", creditsCode: "VS P-A/2", answer: null, totals: Object.fromEntries(Object.entries(sample().totals).map(([k, v]) => [k, k === "sections" ? v : k === "retentionBp" ? v : neg(v)])) }), F), "credit.pdf");
const t3 = all(r3);
check("(3) creditnota: titel, wat ze crediteert, negatief totaal, geen akkoordvak", /CREDITNOTA/.test(t3) && t3.includes("CN P-A/1") && t3.includes("crediteert VS P-A/2") && t3.includes("-€ 4.530,44") && !/AKKOORD/.test(t3));
const many = Array.from({ length: 70 }, (_, i) => L({ code: `9.${i}`, title: `Proef post ${i} met een wat langere omschrijving om af te breken op twee regels in de kolom`, chapter: "09 Proef", offerQtyMilli: 1_000n, unitPriceCents: 10_000n, offerCents: 10_000n, cumQtyMilli: 1_000n, cumCents: 10_000n, periodCents: 10_000n }));
const r4 = read(await progressPdf(sample({ lines: many }), F), "groot.pdf");
check("(4) grote staat (70 posten): loopt over meerdere bladzijden met een kop en 'vervolg', niets buiten de marge", r4.pages.length >= 4 && r4.pages.slice(1).every((p) => /VORDERINGSSTAAT VS P-A\/2/.test(p.text)) && /\(vervolg\)/.test(all(r4)) && r4.pages.every((p) => p.outside.length === 0), `${r4.pages.length} bladzijden`);
// ── (5) securityreview 2.12: een posttitel als één woord van 1.500 tekens (de backend laat 160 toe; de PDF mag nooit vastlopen) ──
const t5 = Date.now();
const r5 = read(await progressPdf(sample({ lines: [L({ code: "9.1", title: "y".repeat(1500), chapter: "09 Proef", offerQtyMilli: 1_000n, unitPriceCents: 10_000n, offerCents: 10_000n, cumQtyMilli: 1_000n, cumCents: 10_000n, periodCents: 10_000n })] }), F), "langwoord.pdf");
check("(5) een woord van 1.500 tekens: PDF in minder dan 3 s, afgebroken over regels, niets buiten de marge", Date.now() - t5 < 3000 && (all(r5).match(/y/g) ?? []).length >= 1500 && r5.pages.every((p) => p.outside.length === 0), `${Date.now() - t5} ms, ${r5.pages.length} bladzijden; ${r5.pages.flatMap((p) => p.outside).join(" | ")}`);

console.log(`\n${pass} ✓ ${fail} ✗`);
process.exit(fail ? 1 : 0);
