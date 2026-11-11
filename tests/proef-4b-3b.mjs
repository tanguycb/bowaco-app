// Het rekenblad (stap 4b.3b): de zuivere kern (src/frontend/src/quote/blad.ts, door Node rechtstreeks gedraaid, zoals de browser)
// en, met een canister, door de backend. Bewijst:
//   (A) welke editor en welke kolommen per rol: het rekenblad enkel bij #full op een scherm met muis; zonder #full nooit een
//       aankoopprijs of marge, zonder prijzen (werfleider) ook geen prijs per post; de indeling op een groot scherm en een laptop;
//   (B) getallen en plakken uit Excel (met en zonder kopregel, hoofdstukken, eenheden, een totaal wordt nooit overgenomen);
//   (C) ongedaan maken en opnieuw, verplaatsen, dupliceren, marge voor meerdere rijen, klaar om te bewaren;
//   (D) door de backend: plakken + bewaren = dezelfde totalen als dezelfde invoer in de klassieke editor (en de server rekent na),
//       ongedaan maken NA een bewaring, bewaren terwijl je verder werkt (niets gaat verloren), wat "niet klaar" is weigert de
//       server ook, de vorige prijs (readPreviousPrices) en de prijsgrens per rol (lek: enkel admin en calculator).
// Enkel VERZONNEN gegevens ("Proef 4b3b …").
//   node tests/proef-4b-3b.mjs               (A–C)
//   ICP_HOST=http://localhost:84xx node tests/proef-4b-3b.mjs <canister-id>   (+ D, enkel op het eigen lokale net)
import * as B from "../src/frontend/src/quote/blad.ts";
import { runSelfTest } from "../src/frontend/src/quote/selftest.ts";
import { M, batchArgs, fromRead, saveAll, sameTotals, unopt } from "./offerte-lib.mjs";

const cid = process.argv[2];
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const S = (x) => JSON.stringify(x, big);
const PRIJS = ["kost", "marge", "prijs", "totaal"];

// ── A. Editor, kolommen en indeling per rol ─────────────────────────────
check("(A1) #full op een scherm met muis (≥ 900) = rekenblad; de keuze 'klassiek' wint", B.kiesEditor("full", 1440, false, null) === "blad" && B.kiesEditor("full", 900, false, null) === "blad" && B.kiesEditor("full", 1440, false, "klassiek") === "klassiek");
check("(A1) op de gsm, met de vinger of smaller dan 900: de klassieke editor", B.kiesEditor("full", 375, true, null) === "klassiek" && B.kiesEditor("full", 899, false, "blad") === "klassiek" && B.kiesEditor("full", 1366, true, "blad") === "klassiek");
check("(A1) wie geen aankoopprijs ziet (#sell, #totals) krijgt nooit het rekenblad", ["sell", "totals"].every((s) => B.kiesEditor(s, 1920, false, "blad") === "klassiek"));
check("(A1) enkel 'blad' en 'klassiek' worden gelezen", B.leesEditorKeuze("blad") === "blad" && B.leesEditorKeuze("klassiek") === "klassiek" && B.leesEditorKeuze("x") === null && B.leesEditorKeuze(null) === null);
check("(A2) werfleider (#totals): geen kost, marge, prijs of totaal per post", B.kolommen("totals", "calc").every((k) => !PRIJS.includes(k)) && !B.toontPrijzen(B.kolommen("totals", "klant")));
check("(A2) architect (#sell): prijs per post, nooit kost of marge", B.kolommen("sell", "calc").includes("prijs") && !B.kolommen("sell", "calc").includes("kost") && !B.kolommen("sell", "calc").includes("marge"));
check("(A2) calculatie (#full): kost, marge, prijs, totaal; 'zoals de klant' zonder vorm, kost en marge", PRIJS.every((k) => B.kolommen("full", "calc").includes(k)) && !["vorm", "kost", "marge"].some((k) => B.kolommen("full", "klant").includes(k)) && S(B.kolommen("full", "verschil")) === S(B.kolommen("full", "calc")));
const I = B.indeling;
check("(A3) groot scherm (1920): inhoud en lijnpaneel vast open", S(I(1920, 6)) === S({ inhoud: "vast", paneel: "vast" }));
check("(A3) laptop (1366, 1280, 1100): allebei ingeklapt, de totalen blijven (geen zijkanten)", [1366, 1280, 1100].every((w) => S(I(w, 6)) === S({ inhoud: "dicht", paneel: "dicht" })));
check("(A3) laptop: wie ze opent, krijgt ze zwevend over het raster", S(I(1366, 6, { inhoud: true, paneel: true })) === S({ inhoud: "zwevend", paneel: "zwevend" }));
check("(A3) kleine offerte zonder hoofdstukken (0 of 1): de inhoud klapt in, ook op een groot scherm", I(1920, 1).inhoud === "dicht" && I(1920, 0).inhoud === "dicht" && I(1920, 1).paneel === "vast" && I(1920, 1, { inhoud: true }).inhoud === "vast");
check("(A3) de keuze van de gebruiker wint (dichtklappen op een groot scherm)", S(I(1920, 6, { inhoud: false, paneel: false })) === S({ inhoud: "dicht", paneel: "dicht" }));
const self = runSelfTest();
check("(A4) de rekentest van de editor (calc.ts, ongewijzigd) blijft groen", self.failed.length === 0 && self.passed > 0, self.failed.join(" · "));

// ── B. Getallen en plakken ──────────────────────────────────────────────
const G = (s, d) => B.leesGetal(s, d);
check("(B1) getallen zoals in Excel: 1.250,50 · 1250.5 · € 1 250,5 · 12,5 · -2 · (3) · 1,250.75", G("1.250,50", 2) === 125_050n && G("1250.5", 2) === 125_050n && G("€ 1 250,5", 2) === 125_050n && G("12,5", 3) === 12_500n && G("-2", 3) === -2000n && G("(3)", 0) === -3n && G("1,250.75", 2) === 125_075n);
check("(B1) afronden op de laatste decimaal (333,335 → 333,34; 0,0005 m → 0,001) en ongeldig = null", G("333,335", 2) === 33_334n && G("0,0005", 3) === 1n && G("abc", 2) === null && G("", 2) === null && G("1.2.3", 2) === null);
check("(B1) duizendtallen: 1.250 = 1250, 12.500.000 = 12 miljoen, 1,5 = anderhalf", G("1.250", 0) === 1250n && G("12.500.000", 0) === 12_500_000n && G("1,5", 1) === 15n);
const U = [{ key: "st", name: "stuk" }, { key: "m2", name: "m²" }, { key: "m3", name: "m³" }, { key: "lm", name: "lopende meter" }, { key: "sog", name: "som of geheel (forfait)" }, { key: "kg", name: "kilogram" }, { key: "u", name: "uur" }];
check("(B2) eenheden: m² → m2, stuks → st, m1 → lm, forfait → sog, uur → u, 'kilogram' → kg; onbekend → null", B.eenheidVan("m²", U) === "m2" && B.eenheidVan("Stuks", U) === "st" && B.eenheidVan("m1", U) === "lm" && B.eenheidVan("forfait", U) === "sog" && B.eenheidVan("uur", U) === "u" && B.eenheidVan("kilogram", U) === "kg" && B.eenheidVan("vat", U) === null);
check("(B2) één waarde is geen plakken (gewoon in de cel); tabs of regels wel", !B.isPlak("12,5") && !B.isPlak("12,5\n") && B.isPlak("a\tb") && B.isPlak("a\nb"));
// Verzonnen rijen in de vorm van een offerte-Excel: code · omschrijving · VH · eenheid · prijs · totaal.
const excel = [
  "01\tVOORBEREIDING\t\t\t\t",
  "01.01\tWerfinrichting proef\t1\tforfait\t450,00\t450,00",
  "01.02\tAfbraak binnenmuur proef\t12,5\tm²\t38,40\t480,00",
  "\tTekst: puin wordt afgevoerd\t\t\t\t",
  "02\tRUWBOUW\t\t\t\t",
  "02.01\tMetselwerk proef\t34\tm2\t1.120,50\t38.097,00",
  "02.02\tLatei proef\t3\tstuks\t\t",
  "02.03\tProef met onbekende eenheid\t2\tvat\t10\t20",
].join("\r\n") + "\r\n";
const p1 = B.leesPlak(excel, U);
const kinds = p1.rijen.map((r) => r.soort).join(",");
check("(B3) zonder kop: 2 hoofdstukken, 5 posten, 1 tekstregel, in volgorde", kinds === "hoofdstuk,post,post,tekst,hoofdstuk,post,post,post", kinds);
const r = (i) => p1.rijen[i];
check("(B3) code, omschrijving, VH, eenheid en aankoopprijs; een totaal wordt nooit overgenomen", r(1).code === "01.01" && r(1).titel === "Werfinrichting proef" && r(1).qtyMilli === 1000n && r(1).unit === "sog" && r(1).cost === 45_000n && r(2).qtyMilli === 12_500n && r(2).unit === "m2" && r(2).cost === 3840n && r(5).cost === 112_050n && r(5).qtyMilli === 34_000n, S(p1.rijen.slice(1, 3)));
check("(B3) post zonder prijs: kost leeg; onbekende eenheid gemeld en niet geraden", r(6).cost === null && r(6).unit === "st" && r(7).unitOk === false && r(7).unit === "vat" && S(p1.onbekendeEenheden) === S(["vat"]));
const p2 = B.leesPlak("Omschrijving\tHoeveelheid\tEenh.\tAankoop\tVerkoop\tTotaal\nProef dakgoot\t8\tlm\t22,5\t\t\nProef kraanuur\t4\tu\t\t65,00\t260\n", U);
check("(B4) met kopregel: kolommen volgen de kop; 'verkoop' = vaste verkoopprijs", p2.kop && p2.rijen.length === 2 && p2.rijen[0].titel === "Proef dakgoot" && p2.rijen[0].qtyMilli === 8000n && p2.rijen[0].unit === "lm" && p2.rijen[0].cost === 2250n && p2.rijen[1].vast === 6500n && p2.rijen[1].cost === null, S(p2));
const p3 = B.leesPlak("Proef plinten\tlm\t24\t12,80\nProef schilderen\t48,5\tm2\n\n", U);
check("(B4) eenheid vóór de getallen, of zonder prijs; lege regels tellen niet", p3.rijen.length === 2 && p3.rijen[0].unit === "lm" && p3.rijen[0].qtyMilli === 24_000n && p3.rijen[0].cost === 1280n && p3.rijen[1].qtyMilli === 48_500n && p3.rijen[1].cost === null, S(p3));

const q = B.tsv('"Proef muur\nmet tekst op\ntwee regels"\t12\tm2\t5\n"zeg ""hallo"""\t1\n');
check("(B4) een cel met nieuwe regels of aanhalingstekens (zoals Excel kopieert) blijft één cel", q.length === 2 && q[0][0] === "Proef muur\nmet tekst op\ntwee regels" && q[0].length === 4 && q[1][0] === 'zeg "hallo"', S(q));
const pq = B.leesPlak('01.03\t"Proef muur\nLastenboektekst van de post."\tVH\t12\tm2\t5,00\t60,00\n2 – Ruwbouw proef\t\t\t\t\t\t\n02.01\tProef forfait\t\t1\tsog\t100\t100\n', U);
check("(B4) eerste regel = titel, de rest = tekst voor de klant; 'VH' = vermoedelijke hoeveelheid, zonder VH forfaitair", pq.rijen[0].titel.startsWith("Proef muur") && pq.rijen[0].vorm === "vh" && pq.rijen[2].vorm === "fixed" && B.splitsTekst(pq.rijen[0].titel).tekst === "Lastenboektekst van de post.", S(pq.rijen));
check("(B4) '2 – Ruwbouw' in de omschrijving = hoofdstuk met code 2", pq.rijen[1].soort === "hoofdstuk" && pq.rijen[1].code === "2" && pq.rijen[1].titel === "Ruwbouw proef");
const lang = "Proef ".repeat(60).trim();
const sp = B.splitsTekst(lang);
check("(B4) een te lange omschrijving: titel ingekort op een woord (≤ 160), de volledige tekst blijft in de tekst", sp.titel.length <= 160 && sp.titel.endsWith("…") && sp.tekst === lang);

// Een leeg model (zoals een nieuwe offerte) om in te plakken.
const leeg = (std = 2000n) => M.load({ versionId: 1n, rev: 0n, header: { title: "Proef 4b3b", vatBp: 2100n, clientOrgId: null, validDays: 30n, intro: "", note: "", standardMarginBp: std }, chapters: [], lines: [], form: { hideZeroLines: true, regieText: false, textBlockKeys: [], subgroups: [], lineForms: [], chapterMargins: [], orgMargins: [], links: [], regie: null, discount: null, discountText: "", live: true } });
const STD = { unit: "st", form: "vh", standaardTitel: "Werken" };
const m1 = leeg();
const nieuw = B.plakIn(m1, p1.rijen, null, null, STD);
const chs = M.activeChapters(m1);
check("(B5) plakken in een lege offerte: de hoofdstukrijen worden hoofdstukken, de rest komt erin", chs.length === 2 && chs[0].title === "VOORBEREIDING" && chs[1].code === "02" && M.linesOf(m1, chs[0].key).length === 3 && M.linesOf(m1, chs[1].key).length === 3 && nieuw.length === 6, S(chs.map((c) => c.title)));
const m1b = leeg();
B.plakIn(m1b, p3.rijen, null, null, STD);
check("(B5) rijen zonder hoofdstuk in een lege offerte: één hoofdstuk 'Werken'", M.activeChapters(m1b).length === 1 && M.activeChapters(m1b)[0].title === "Werken" && M.activeLines(m1b).length === 2);
// in het midden plakken: na een gekozen lijn, in haar hoofdstuk
const eerste = M.linesOf(m1, chs[0].key)[0];
B.plakIn(m1, p3.rijen, chs[0].key, eerste.key, STD);
check("(B5) na de gekozen lijn plakken: de rijen staan meteen eronder, in volgorde", M.linesOf(m1, chs[0].key).map((l) => l.title).slice(0, 3).join("|") === "Werfinrichting proef|Proef plinten|Proef schilderen");
// hoofdstukrij plakken na het eerste hoofdstuk: het nieuwe hoofdstuk komt ertussen
B.plakIn(m1, B.leesPlak("03\tAFWERKING\t\t\nProef vloer\t20\tm2\t30", U).rijen, chs[0].key, null, STD);
check("(B5) een geplakt hoofdstuk komt na het hoofdstuk waarin je plakt", M.activeChapters(m1).map((c) => c.code).join(",") === "01,03,02", M.activeChapters(m1).map((c) => c.code).join(","));

// ── C. Ongedaan maken, verplaatsen, meerdere rijen, klaar om te bewaren ──
const m2 = leeg();
B.plakIn(m2, p1.rijen.filter((x) => x.soort !== "post" || x.unitOk), null, null, STD);
const H = new B.Geschiedenis();
const t0 = M.totals(m2);
const ks = M.activeLines(m2).filter((l) => l.kind === "item").map((l) => l.key);
H.voor(m2); B.zetMarge(m2, ks.slice(0, 2), 3000n, "proef");
const t1 = M.totals(m2);
H.voor(m2); B.verwijder(m2, [ks[2]]);
check("(C1) marge voor twee rijen tegelijk: de totalen stijgen", t1.subtotal > t0.subtotal && M.lineOut(m2, m2.lines.find((l) => l.key === ks[0])).marginBp === 3000n);
H.ongedaan(m2);
check("(C1) Ctrl+Z zet de verwijderde lijn terug (zelfde totalen als voor het verwijderen)", S(M.totals(m2)) === S(t1));
H.ongedaan(m2);
check("(C1) nog eens Ctrl+Z: de marge terug (totalen = het begin)", S(M.totals(m2)) === S(t0) && !H.kanTerug);
H.opnieuw(m2); H.opnieuw(m2);
check("(C1) Ctrl+Shift+Z twee keer: weer verwijderd en weer 30 %", S(M.totals(m2)) !== S(t1) && !H.kanVooruit && !M.activeLines(m2).some((l) => l.key === ks[2]));
H.voor(m2); B.zetMarge(m2, [ks[0]], null, "");
check("(C1) een nieuwe wijziging wist 'opnieuw'", !H.kanVooruit && H.kanTerug);
const m3 = leeg();
B.plakIn(m3, p1.rijen.filter((x) => x.soort !== "post" || x.unitOk), null, null, STD);
const [c1, c2] = M.activeChapters(m3);
const in1 = M.linesOf(m3, c1.key).map((l) => l.key);
const ta = M.totals(m3);
B.verplaats(m3, [in1[0], in1[2]], c2.key, M.linesOf(m3, c2.key)[1].key);
check("(C2) twee rijen slepen naar een ander hoofdstuk (vóór de tweede lijn): volgorde en hoofdstuk kloppen", M.linesOf(m3, c2.key).map((l) => l.key).join(",") === [M.linesOf(m3, c2.key)[0].key, in1[0], in1[2], ...M.linesOf(m3, c2.key).slice(3).map((l) => l.key)].join(",") && M.linesOf(m3, c1.key).length === 1);
check("(C2) verplaatsen verandert het totaal niet, enkel de hoofdstuktotalen", M.totals(m3).subtotal === ta.subtotal && S(M.totals(m3).chapters) !== S(ta.chapters));
B.verplaatsHoofdstuk(m3, c2.key, c1.key);
check("(C2) een hoofdstuk slepen (in de inhoud): de volgorde wisselt", M.activeChapters(m3)[0].key === c2.key);
const dup = B.dupliceer(m3, [in1[0]]);
check("(C2) dupliceren: een kopie meteen onder het origineel, zonder id", dup.length === 1 && M.linesOf(m3, c2.key).findIndex((l) => l.key === dup[0]) === M.linesOf(m3, c2.key).findIndex((l) => l.key === in1[0]) + 1 && m3.lines.find((l) => l.key === dup[0]).id === null);
{ const ms = leeg(); B.plakIn(ms, B.leesPlak("A\t1\tst\t1\nB\t1\tst\t1\nC\t1\tst\t1", U).rijen, null, null, STD); const ch = M.activeChapters(ms)[0].key; const [a, b, c] = M.linesOf(ms, ch).map((l) => l.key); const g = M.addSubgroup(ms, ch, "Proef sub"); M.setLineSubgroup(ms, c, g.key);
  B.verplaats(ms, [a], ch, c);
  check("(C2) slepen vóór een lijn in een subgroep: de lijn komt in die subgroep; vóór een lijn zonder subgroep: eruit", M.lineSubgroup(ms, ms.lines.find((l) => l.key === a))?.key === g.key && (B.verplaats(ms, [a], ch, b), M.lineSubgroup(ms, ms.lines.find((l) => l.key === a)) === null)); }
check("(C2) Shift-klik: het bereik in de volgorde van het blad", S(B.bereik(["a", "b", "c", "d"], "d", "b")) === S(["b", "c", "d"]) && S(B.bereik(["a", "b"], "x", "b")) === S(["b"]));
check("(C2) optie maken voor meerdere rijen (tekstregels blijven)", B.zetSoort(m3, M.activeLines(m3).map((l) => l.key), "option") === M.activeLines(m3).filter((l) => l.kind !== "text").length && M.activeLines(m3).every((l) => l.kind !== "item"));
check("(C2) kopiëren naar Excel: tabs, met aankoop en prijs per eenheid", B.alsTekst(m2, [ks[0]], true).split("\t").length === 6 && B.alsTekst(m2, [ks[0]], false).split("\t").length === 4);
const m4 = leeg();
M.addChapter(m4, { title: "" });
const u1 = M.addLine(m4, M.activeChapters(m4)[0].key, { kind: "item", title: "", unit: "st" });
const u2 = M.addLine(m4, M.activeChapters(m4)[0].key, { kind: "item", title: "Proef", unit: "vat" });
const nk = B.nietKlaar(m4, U.map((u) => u.key));
check("(C3) niet klaar om te bewaren: hoofdstuk zonder titel, post zonder omschrijving, onbekende eenheid", S(nk.map((x) => x.wat).sort()) === S(["eenheid", "hoofdstukTitel", "titel"]) && nk.some((x) => x.key === u1.key) && nk.some((x) => x.key === u2.key));
check("(C3) zonder de lijst van eenheden telt de eenheid niet (de server beslist)", !B.nietKlaar(m4, null).some((x) => x.wat === "eenheid"));
{ const mr = leeg(); B.plakIn(mr, B.leesPlak("Proef\t1\tst\t10", U).rijen, null, null, STD); const l = M.activeLines(mr)[0]; M.updateLine(mr, l.key, { price: { ...l.price, rule: { margin: 3000n }, reason: "x".repeat(1001) } });
  check("(C3) een reden langer dan 1000 tekens (servergrens) is niet klaar", B.nietKlaar(mr, null).some((x) => x.wat === "lang")); }
check("(C3) een gewone offerte is klaar", B.nietKlaar(m2, U.map((u) => u.key)).length === 0);
check("(C4) de marge van een hoofdstuk zoals calc.ts het geheel rekent (verkoop met kost − kost)", B.hoofdstukMarge({ cost: 8000n, sellWithCost: 10_000n }) === 2000n && B.hoofdstukMarge({ cost: 0n, sellWithCost: 0n }) === null && B.hoofdstukMarge({ cost: 12_000n, sellWithCost: 10_000n }) === -2000n);
const vgl = [{ tenderId: 1n, code: "PV-1", items: [{ id: 5n, lineId: 100n, libItemId: 9n, unit: "m2" }, { id: 6n, lineId: 101n, libItemId: null, unit: "st" }], firmas: [{ oaQuoteId: 70n, orgId: 3n, firma: "Proef A", dag: 20_000n }, { oaQuoteId: 71n, orgId: 4n, firma: "Proef B", dag: null }], cellen: [{ itemId: 5n, oaQuoteId: 70n, unitCents: 5000n, lowest: false, unitChanged: false, vhChanged: false, alt: false }, { itemId: 5n, oaQuoteId: 71n, unitCents: 4200n, lowest: true, unitChanged: false, vhChanged: true, alt: false }, { itemId: 5n, oaQuoteId: 71n, unitCents: 1n, lowest: false, unitChanged: false, vhChanged: false, alt: true }], gekozen: [{ itemId: 5n, oaQuoteId: 70n }] }];
const oa = B.oaPrijzen([100n], null, vgl);
check("(C5) offertes van onderaannemers naast elkaar: gekozen eerst, dan op prijs; alternatieven niet", oa.length === 2 && oa[0].firma === "Proef A" && oa[0].gekozen && oa[1].laagste && oa[1].anders && oa[1].orgId === 4n);
check("(C5) via de lijn van de vorige versie, anders via dezelfde post uit de bibliotheek; geen bron = leeg", B.oaPrijzen([999n, 100n], null, vgl).length === 2 && B.oaPrijzen([999n], 9n, vgl).length === 2 && B.oaPrijzen([999n], null, vgl).length === 0);

// ── Klaar zonder canister ───────────────────────────────────────────────
if (!cid) {
  console.log(`\n${pass} ✓  ${fail} ✗  (A–C; geef een canister voor D)`);
  process.exit(fail ? 1 : 0);
}
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-4b-3b.mjs D enkel op het eigen lokale net");
const { backend, freshBackend } = await import("../tools/lib.mjs");
const ok = (r) => { if (r && "err" in r) throw new Error(r.err); return r.ok; };
const denied = async (p) => { try { const r = await p; return !!(r && "err" in r && /^Geen toegang/.test(r.err)); } catch (e) { return /Geen toegang|trap|Reject/i.test(String(e)); } };
const [admin, calc, wl, arch, klant, oa2, vc] = await Promise.all(["proef-admin", "proef-calculator", "proef-werfleider", "proef-architect", "proef-klant", "proef-oa2", "proef-vc"].map((n) => backend(n, cid)));
const vreemd = await freshBackend(cid);
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A");
if (!A) throw new Error("werf P-A ontbreekt: eerst tests/rollen.mjs");
const units = (await calc.libraryUnits(false)).map((u) => ({ key: u.key, name: u.name }));
const read = async (vid, who = calc) => ok(await who.readQuoteVersion(vid));

// (D1) Plakken op het rekenblad en dezelfde invoer met de hand in de klassieke editor → dezelfde totalen, en de server rekent na.
const qa = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 4b3b rekenblad" }));
const qb = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 4b3b klassiek" }));
const ma = fromRead(await read(qa.versionId));
const plak = B.leesPlak(excel, units);
const geplakt = B.plakIn(ma, plak.rijen.filter((x) => x.soort !== "post" || x.unitOk), null, null, { unit: units[0].key, form: "vh", standaardTitel: "Werken" });
B.zetMarge(ma, geplakt.slice(0, 2), 2500n, "proef 4b3b");
check("(D1) het geplakte blad is klaar om te bewaren", B.nietKlaar(ma, units.map((u) => u.key)).length === 0, S(B.nietKlaar(ma, units.map((u) => u.key))));
const ra = await saveAll(calc, ma);
check("(D1) rekenblad bewaard: de server rekende na en vond geen verschil", !!ra && !("err" in ra), S(ra));
const mb = fromRead(await read(qb.versionId));
// klassiek: hoofdstuk per hoofdstuk, lijn per lijn met de knoppen van de oude editor (addChapter, addLine, updateLine)
let ch = null;
let n = 0;
for (const x of plak.rijen.filter((y) => y.soort !== "post" || y.unitOk)) {
  if (x.soort === "hoofdstuk") { ch = M.addChapter(mb, { code: x.code, title: x.titel }).key; continue; }
  const l = M.addLine(mb, ch, x.soort === "tekst" ? { kind: "text", unit: "" } : { kind: "item", unit: units[0].key, form: "vh" });
  if (x.soort === "tekst") M.updateLine(mb, l.key, { code: x.code, title: x.titel });
  else M.updateLine(mb, l.key, { code: x.code, title: x.titel, qtyMilli: x.qtyMilli, unit: x.unit, price: { ...l.price, cost: x.cost, source: x.cost !== null ? "handmatig" : "", rule: n < 2 ? { margin: 2500n } : null, reason: n < 2 ? "proef 4b3b" : "" } });
  if (x.soort === "post") n++;
}
const rb = await saveAll(calc, mb);
check("(D1) klassiek bewaard", !!rb && !("err" in rb), S(rb));
const va = await read(qa.versionId);
const vb = await read(qb.versionId);
check("(D1) rekenblad = klassieke editor: zelfde subtotaal, btw, totaal, kost en marge (server)", va.totals.subtotalCents === vb.totals.subtotalCents && va.totals.totalCents === vb.totals.totalCents && va.totals.vatCents === vb.totals.vatCents && unopt(va.margins).costCents === unopt(vb.margins).costCents && unopt(va.margins).marginCents === unopt(vb.margins).marginCents, `${va.totals.totalCents} vs ${vb.totals.totalCents}`);
check("(D1) en gelijk aan wat de browser rekent (M.totals)", sameTotals(ma, va.totals, unopt(va.margins)) && sameTotals(fromRead(va), va.totals, unopt(va.margins)));

// (D2) Ongedaan maken NA een automatische bewaring: de stand van vóór de wijziging komt terug op de server.
const H2 = new B.Geschiedenis();
const ma2 = fromRead(await read(qa.versionId));
const voor = S(fromRead(await read(qa.versionId)).lines.map((l) => [l.title, l.qtyMilli, l.price.cost]));
const totVoor = (await read(qa.versionId)).totals.totalCents;
H2.voor(ma2);
const extra = B.plakIn(ma2, B.leesPlak("Proef extra na bewaring\t5\tst\t99", units).rijen, M.activeChapters(ma2)[0].key, null, STD);
H2.voor(ma2);
B.verwijder(ma2, [M.activeLines(ma2).find((l) => l.title === "Metselwerk proef").key]);
check("(D2) wijzigingen bewaard (vanzelf)", !("err" in (await saveAll(calc, ma2))) && (await read(qa.versionId)).totals.totalCents !== totVoor && extra.length === 1);
H2.ongedaan(ma2); H2.ongedaan(ma2);
check("(D2) Ctrl+Z twee keer na de bewaring: de nieuwe lijn moet weg, de verwijderde komt terug (als nieuwe lijn)", M.pendingCount(ma2) >= 2 && ma2.lines.some((l) => l.removed && l.title === "Proef extra na bewaring") && M.activeLines(ma2).some((l) => l.title === "Metselwerk proef" && l.id === null));
check("(D2) opnieuw bewaard: de server staat op de stand van vóór (zelfde lijnen en totaal)", !("err" in (await saveAll(calc, ma2))) && S(fromRead(await read(qa.versionId)).lines.map((l) => [l.title, l.qtyMilli, l.price.cost]).sort()) === S(JSON.parse(voor).sort()) && (await read(qa.versionId)).totals.totalCents === totVoor);

// (D3) Bewaren terwijl je verder werkt: wat je tijdens de bewaring wijzigt, blijft "te bewaren" (niets gaat ongezien verloren).
const ma3 = fromRead(await read(qa.versionId));
const doel = M.activeLines(ma3).find((l) => l.kind === "item");
M.updateLine(ma3, doel.key, { qtyMilli: doel.qtyMilli + 1000n });
const nieuwL = M.addLine(ma3, doel.chapter, { kind: "item", title: "Proef tijdens bewaring weg", unit: units[0].key });
const bt = M.nextBatch(ma3);
const r3 = ok(await calc.saveQuoteDraft(...batchArgs(ma3, bt)));
M.updateLine(ma3, doel.key, { qtyMilli: doel.qtyMilli + 1000n, title: "Proef gewijzigd tijdens bewaring" }); // nog tijdens de bewaring
M.removeLine(ma3, nieuwL.key); // een nieuwe lijn die tijdens de bewaring weer weg gaat
M.applySaved(ma3, bt, r3.rev, r3.refs);
check("(D3) de wijziging tijdens de bewaring blijft te bewaren", M.pendingCount(ma3) >= 2 && ma3.lines.find((l) => l.key === doel.key).dirty);
check("(D3) de nieuwe lijn die tijdens de bewaring weg ging, staat als 'weg' (de server kreeg ze wel)", ma3.lines.some((l) => l.key === nieuwL.key && l.removed && l.id !== null));
check("(D3) volgende bewaring: de titel staat op de server en de lijn is er niet meer", !("err" in (await saveAll(calc, ma3))) && (await read(qa.versionId)).lines.some((l) => l.title === "Proef gewijzigd tijdens bewaring") && !(await read(qa.versionId)).lines.some((l) => l.title === "Proef tijdens bewaring weg") && M.pendingCount(ma3) === 0);

// (D3b) Een subgroep die bijkomt TERWIJL de vorm bewaard wordt, blijft nieuw en komt bij de volgende bewaring mee (review).
const ma6 = fromRead(await read(qa.versionId));
const ch6 = M.activeChapters(ma6)[0].key;
M.addSubgroup(ma6, ch6, "Proef sub A");
const fs6 = M.formSave(ma6);
const { formArgs } = await import("./offerte-lib.mjs");
const r6 = ok(await calc.saveQuoteForm(...formArgs(ma6, fs6)));
const gB = M.addSubgroup(ma6, ch6, "Proef sub B"); // tijdens de bewaring
M.setLineSubgroup(ma6, M.linesOf(ma6, ch6)[0].key, gB.key);
M.applyFormSaved(ma6, r6.rev, r6.refs, fs6.snap);
check("(D3b) de subgroep van tijdens de bewaring is nog nieuw (te bewaren)", ma6.subgroups.find((g) => g.key === gB.key).id === null && M.formDirty(ma6));
const r6b = await saveAll(calc, ma6);
const f6 = unopt((await read(qa.versionId)).form);
check("(D3b) volgende bewaring: beide subgroepen staan op de server, de lijn in B", !("err" in r6b) && ["Proef sub A", "Proef sub B"].every((t) => f6.subgroups.some((g) => g.title === t)) && f6.lineForms.some((x) => unopt(x.subgroupId) === f6.subgroups.find((g) => g.title === "Proef sub B").id), S(r6b));

// (D4) Wat het blad "niet klaar" noemt, weigert de server ook (anders wacht het blad terecht).
const ma4 = fromRead(await read(qa.versionId));
const leegL = M.addLine(ma4, M.activeChapters(ma4)[0].key, { kind: "item", title: "", unit: units[0].key });
check("(D4) een post zonder omschrijving: blad 'niet klaar' én server weigert", B.nietKlaar(ma4, units.map((u) => u.key)).some((x) => x.key === leegL.key) && "err" in (await calc.saveQuoteDraft(...batchArgs(ma4, M.nextBatch(ma4)))));
M.updateLine(ma4, leegL.key, { title: "Proef", unit: "vat-proef" });
check("(D4) een onbekende eenheid: blad 'niet klaar' én server weigert", B.nietKlaar(ma4, units.map((u) => u.key)).some((x) => x.wat === "eenheid") && "err" in (await calc.saveQuoteDraft(...batchArgs(ma4, M.nextBatch(ma4)))));
const ma5 = fromRead(await read(qa.versionId));
M.addChapter(ma5, { title: "" });
check("(D4) een hoofdstuk zonder titel: blad 'niet klaar' én server weigert", B.nietKlaar(ma5, null).some((x) => x.wat === "hoofdstukTitel") && "err" in (await calc.saveQuoteDraft(...batchArgs(ma5, M.nextBatch(ma5)))));

// (D5) De vorige prijs: dezelfde post in een verstuurde offerte (andere offerte), met haar aankoopprijs; per rol.
const lib = (await calc.listLibrary({ text: "", offset: 0n, limit: 5n, includeArchived: false, chapterId: [], form: [], trade: [], unit: [], orgId: [] })).items.find((x) => units.some((u) => u.key === x.unit));
let prevOk = false;
let prevNum = "";
if (lib) {
  // een eerste offerte met die post, verstuurd
  const q1 = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 4b3b vorige prijs" }));
  const m1v = fromRead(await read(q1.versionId));
  const c1v = M.addChapter(m1v, { title: "Proef" }).key;
  M.addLine(m1v, c1v, { kind: "item", title: lib.title, unit: lib.unit, form: "vh", qtyMilli: 2000n, libItemId: lib.id, libItemVersion: lib.version, price: { ...M.emptyPrice(), cost: 4321n, source: "handmatig" } });
  ok(await saveAll(calc, m1v));
  const r1 = await read(q1.versionId);
  const sent = await calc.sendQuoteVersion(q1.versionId, r1.version.rev, r1.totals.totalCents, "proef 4b3b: waarschuwingen doorgezet");
  // een tweede offerte met dezelfde post (en een post met dezelfde omschrijving zonder bibliotheek)
  const q2 = ok(await calc.createQuote({ workId: A.id, number: "", title: "Proef 4b3b vorige prijs 2" }));
  const m2v = fromRead(await read(q2.versionId));
  const c2v = M.addChapter(m2v, { title: "Proef" }).key;
  M.addLine(m2v, c2v, { kind: "item", title: lib.title, unit: lib.unit, form: "vh", qtyMilli: 1000n, libItemId: lib.id, libItemVersion: lib.version });
  ok(await saveAll(calc, m2v));
  const prev = ok(await calc.readPreviousPrices(q2.versionId));
  const lineId = (await read(q2.versionId)).lines[0].id;
  const pp = prev.find((x) => x.lineId === lineId);
  prevNum = pp?.quoteNumber ?? "";
  prevOk = "ok" in sent && !!pp && pp.byLibItem && unopt(pp.costCents) === 4321n && pp.versionId === q1.versionId && pp.at > 0n && unopt(pp.unitSellCents) !== null;
  check("(D5) vorige prijs: dezelfde post in de verstuurde offerte, met aankoop- en verkoopprijs", prevOk, S(pp ?? sent));
  check("(D5) een ontwerp telt niet als vorige prijs (enkel verstuurd, aanvaard, geweigerd)", !ok(await calc.readPreviousPrices(q1.versionId)).some((x) => x.versionId === q2.versionId));
  check("(D5) admin mag de vorige prijs ook lezen", "ok" in (await admin.readPreviousPrices(q2.versionId)));
  const voorA = await admin.auditCount();
  ok(await calc.readPreviousPrices(q2.versionId));
  const naA = await admin.auditCount();
  check("(D5) elke oproep = één auditregel (bekeek:vorige-prijzen), zonder bedrag", naA === voorA + 1n);
  for (const [naam, who] of [["werfleider", wl], ["architect", arch], ["klant", klant], ["onderaannemer", oa2], ["veiligheidscoördinator", vc], ["onbekend", vreemd]]) {
    check(`(D5) prijsgrens: ${naam} krijgt geen vorige prijs`, await denied(who.readPreviousPrices(q2.versionId)));
  }
} else check("(D5) een post uit de bibliotheek om mee te proeven", false, "geen post in de bibliotheek (tests/rollen.mjs of de postentest eerst)");

// (D6) Prijsgrens per rol in de offerte zelf: de werfleider ziet het blad niet en geen prijs per post.
const vw = await read(qa.versionId, wl);
check("(D6) werfleider: scope 'totals', geen aankoopprijzen, geen verkoopprijs per post → klassieke weergave zonder prijzen", "totals" in vw.scope && vw.costs.length === 0 && vw.sell.length === 0 && B.kiesEditor(Object.keys(vw.scope)[0], 1920, false, "blad") === "klassiek" && !B.toontPrijzen(B.kolommen(Object.keys(vw.scope)[0], "calc")));
const vc2 = await read(qa.versionId, calc);
check("(D6) calculator: scope 'full' → het rekenblad met kost en marge", "full" in vc2.scope && vc2.costs.length > 0 && B.kiesEditor("full", 1920, false, null) === "blad");
check("(D6) klant, onderaannemer en een vreemde login lezen de offerte niet", (await denied(klant.readQuoteVersion(qa.versionId))) && (await denied(oa2.readQuoteVersion(qa.versionId))) && (await denied(vreemd.readQuoteVersion(qa.versionId))));
void prevNum;

console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
