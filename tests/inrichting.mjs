// Stap 2b.6: de inrichting (tools/inrichting/*) op een VERZONNEN documentenmap (tests/inrichting-fixtures.py), op een
// lokale canister. Bewijst: de lezers lezen de vier offertevormen, het sjabloon, de voorwaarden, de prijslijst en de
// indexen; de grens (echte gegevens nooit buiten het lokale net, ook niet in een droogloop); de droogloop bewaart niets;
// de echte run zet alles in de app; een tweede run maakt niets dubbel; "nog na te kijken" staat bij de werven.
//   ICP_HOST=http://localhost:8041 node tests/inrichting.mjs <canister>      (na de claim door proef-admin)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { backend } from "../tools/lib.mjs";
import { blobHash } from "../tools/opslag.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/inrichting.mjs <canister>");
const host = process.env.ICP_HOST || "";
if (!/localhost|127\.0\.0\.1/.test(host)) throw new Error("tests/inrichting.mjs enkel op een lokaal net (ICP_HOST=http://localhost:…)");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${!c && x ? `  — ${x}` : ""}`); };

const tmp = mkdtempSync(join(tmpdir(), "bowaco-inrichting-"));
const docs = join(tmp, "docs"), werk = join(tmp, "werk");
const env = { ...process.env, BOWACO_INRICHTING: werk, BOWACO_BRON: "test" };
execFileSync("python3", ["-I", join(repo, "tests/inrichting-fixtures.py"), docs], { env, stdio: "pipe" });
const lezers = execFileSync("zsh", [join(repo, "tools/inrichting/lees-alles.sh"), docs], { env, encoding: "utf8" });
const plan = (n) => JSON.parse(readFileSync(join(werk, "plan", n), "utf8"));

// ── De lezers ──────────────────────────────────────────────────────────────
const p4 = plan("stap4-posten.json");
const post = (t) => p4.posten.find((x) => x.titel.startsWith(t));
check("offerte-lezer: rijk (VH + subtotalen), rijk zonder VH, een variant en plat gelezen; een andere activiteit niet", p4.offertes.length === 5 && !p4.offertes.some((o) => o.id === "Q-2023-101"), JSON.stringify(p4.offertes.map((o) => o.id)));
check("offerte-lezer: dezelfde post in twee offertes = één post met twee aankoopprijzen (met de datum uit de index)", post("Werfvoorbereiding proefpost")?.kosten.length === 4 && post("Werfvoorbereiding proefpost").kosten.map((k) => k.dag).join() === "2025-05-12,2025-09-01,2025-09-02,2025-10-01");
check("offerte-lezer: een variant met hetzelfde nummer krijgt een eigen verwijzing (geen aankoopprijs die wegvalt)", post("Werfvoorbereiding proefpost")?.kosten.map((k) => k.offerte).join() === "2025/150,2025/151,2025/151 (raming),2025/152 (in de offerte: 2025/151)");
check("offerte-lezer: de nummering van een offerte (\"1.2. \") staat niet in de posttitel", !p4.posten.some((x) => /^\d+(\.\d+)*\.\s/.test(x.titel)) && !!post("Container proefpuin"));
check("offerte-lezer: hoofdstuk = buitenste SUM-groep (\"1 – ALGEMEEN\" → Algemeen, BUITENSCHRIJNWERK → Buitenschrijnwerk; de subgroep Gelijkvloers telt niet)", post("Container proefpuin")?.hoofdstuk === "01" && post("Proefraam in hout")?.hoofdstuk === "08");
check("offerte-lezer: /0,9 = marge 10 %, /0,8 = de standaard (geen regel), vast getal = vaste verkoopprijs", post("Proefraam in hout")?.margeBp === 1000 && post("Container proefpuin")?.margeBp === null && post("Werfbord proef")?.verkoopCents === 15000);
check("offerte-lezer: VH-vlag = contractvorm VH; een lastenboektekst over meerdere regels blijft", post("Proefraam in hout")?.vorm === "vh" && post("Proefraam in hout").tekst.includes("dubbel glas"));
check("offerte-lezer: afrekenregel met een datum vooraan overgeslagen", !p4.posten.some((x) => /Gepresteerde uren/.test(x.titel)));
check("offerte-lezer: kortingslijn (negatief) overgeslagen; eenheden wa en cm/m² genormaliseerd", !p4.posten.some((x) => /korting/i.test(x.titel)) && post("Proefdeur plaatsen")?.eenheid === "wa" && post("Proefisolatie")?.eenheid === "cm/m2");
check("offerte-lezer: platte offerte = enkel prijsgeheugen bij een bestaande post (een post die enkel daar staat, komt er niet bij)", p4.prijsgeheugen.length === 1 && p4.prijsgeheugen[0].offerte === "2024/140" && !post("Een post die enkel hier staat"));
const p1 = plan("stap1-bedrijf.json");
check("bedrijf: afzender met naam, adres, ondernemingsnummer, contact en rekening; geen persoonsnaam", Object.values(p1.afzenderGevonden).every(Boolean) && p1.afzender.includes("Proefbouw BV") && p1.afzender.includes("9999 Proefdorp"));
check("bedrijf: voorwaarden met koppen en opsommingen; nog na te kijken", p1.voorwaarden.tekst.includes("\nBetaling\n- binnen de twee weken") && p1.voorwaarden.nakijken === true);
check("bedrijf: laatste offertenummer = het hoogste volgnummer (doorlopend), betaaltermijn = de meest gebruikte (15)", p1.offertenummer.laatste === 152 && p1.betaaltermijn === 15);
const p2 = plan("stap2-firmas.json");
check("firma's: een bestandsnaam van een factuur wordt de firmanaam", p2.rijen.find((r) => r.key === "F-007")?.name === "PROEFDEUREN");
check("firma's: beslist in 1.2 + soort uit de facturen; diensten, onbekend en planningscode zonder beslissing niet", p2.rijen.length === 7 && !p2.rijen.some((r) => r.name.includes("BOEKHOUDER") || r.name.includes("ONBEKENDE")) && p2.nietInDeApp["diensten en bedrijfskosten (vraag D25)"]?.aantal === 1);
check("firma's: een zeker voorstel planningscode wordt een code; geen persoonsgegevens", p2.rijen.find((r) => r.key === "F-003")?.aliases.includes("PLAAT") && p2.rijen.every((r) => !("phone" in r) && !("email" in r)));
const p3 = plan("stap3-werven.json");
check("werven: enkel 'stap 3: werf aanmaken'; adres uit de mapnaam; nog na te kijken met de reden", p3.werven.map((w) => w.code).join() === "W-901,W-902" && p3.werven[1].nakijken.includes("geen postcode"));
check("planning: het blok met een zekere werfmap → vervolg in die werf; het andere blok → eigen werf", p3.planning.blokken["6"]?.beslissing === "vervolg" && p3.planning.blokken["20"]?.beslissing === "standaard");
const p5 = plan("stap5-prijzen.json");
const l5 = p5.lijsten[0]?.lijnen ?? [];
check("prijslijst: regels uit Word met kop (Plafond, Scheidingswand), pdf met de hand", l5.length === 5 && l5.some((x) => x.titel === "Plafond: Plaatsing proefplaat") && l5.some((x) => x.titel === "Scheidingswand: Plaatsing proefplaat") && p5.metDeHand.some((h) => h.doc === "D-00004"));
check("prijslijst: enkel een regel zonder kop hoort bij de gelijknamige offertepost; dezelfde omschrijving onder twee koppen = twee posten", l5.find((x) => x.titel === "Werfvoorbereiding proefpost")?.offerteKey && l5.filter((x) => x.titel.endsWith("Plaatsing proefplaat")).every((x) => !x.offerteKey && x.key) && new Set(l5.map((x) => x.key)).size === 5);
const p7 = plan("stap7-documenten.json");
const w7 = (c) => p7.werven.find((w) => w.code === c);
check("documenten (2d.4): alle werven met een werfmap, actief = de werven van stap 3; foto's en video's mee, gevoelig niet", p7.werven.map((w) => `${w.code}:${w.actief}`).join() === "W-901:true,W-903:false" && w7("W-901").bestanden.map((b) => b.doc).join() === "D-00010,D-00011,D-00012,D-00014,D-00015,D-00016" && !JSON.stringify(p7).includes("D-00013"), JSON.stringify(p7.werven.map((w) => [w.code, w.actief, w.bestanden.map((b) => b.doc)])));
check("documenten (2d.4): het pad per bestand (voor het verkleinen); dubbels en historiek niet", w7("W-901").bestanden.find((b) => b.doc === "D-00014")?.pad?.endsWith("groot proefbeeld.jpg") && !w7("W-903").bestanden.some((b) => b.doc === "D-09015" || b.doc === "D-09016"));
check("de lezers draaien zonder fout (lees-alles.sh)", lezers.includes("stap 7"));

// ── De grens: echte gegevens nooit buiten het lokale net ───────────────────
const echtMap = join(tmp, "echt-plan");
cpSync(join(werk, "plan"), echtMap, { recursive: true });
const p1e = { ...p1 };
delete p1e.bron; // zonder label = echt
writeFileSync(join(echtMap, "stap1-bedrijf.json"), JSON.stringify(p1e));
const buiten = spawnSync("node", [join(repo, "tools/inrichting.mjs"), "--canister", cid, "--plan", echtMap, "--stap", "1", "--verslag", join(tmp, "x.md")], { env: { ...process.env, ICP_HOST: "https://icp-api.io" }, encoding: "utf8" });
check("grens: een plan met echte gegevens naar een canister buiten het lokale net wordt geweigerd, ook als droogloop", buiten.status !== 0 && /enkel op het eigen lokale net/.test(buiten.stderr));
const ja = spawnSync("node", [join(repo, "tools/inrichting.mjs"), "--canister", cid, "--plan", echtMap, "--stap", "1", "--verslag", join(tmp, "y.md")], { env: { ...process.env, ICP_HOST: host }, encoding: "utf8" });
check("grens: hetzelfde plan op het lokale net mag (droogloop)", ja.status === 0, ja.stderr.slice(0, 200));
// Stap 3 met een testplan dat naar het planningsplan verwijst (dat geen label "test" draagt = echt): ook geweigerd.
const p3e = spawnSync("node", [join(repo, "tools/inrichting.mjs"), "--canister", cid, "--plan", join(werk, "plan"), "--stap", "3", "--verslag", join(tmp, "z.md")], { env: { ...process.env, ICP_HOST: "https://icp-api.io" }, encoding: "utf8" });
check("grens: het planningsplan (zonder label) gaat ook niet buiten het lokale net, ook al is het werfplan een testplan", p3e.status !== 0 && /plan\.json: echte gegevens enkel op het eigen lokale net/.test(p3e.stderr), p3e.stderr.slice(0, 200));
mkdirSync(join(tmp, "geen-proefmap"), { recursive: true });
const zonderMerk = spawnSync("zsh", [join(repo, "tools/inrichting/lees-alles.sh"), join(tmp, "geen-proefmap")], { env, encoding: "utf8" });
check("grens: BOWACO_BRON=test op een map zonder merkbestand wordt geweigerd (de echte map wordt nooit test)", zonderMerk.status === 2 && /merkbestand/.test(zonderMerk.stdout));
check("grens: een host die enkel het woord localhost bevat, telt niet als lokaal", spawnSync("node", ["--input-type=module", "-e", `process.env.ICP_HOST="https://icp-api.io/?localhost"; const m = await import("${join(repo, "tools/inrichting/lib.mjs")}"); process.exit(m.isLocal() ? 1 : 0)`]).status === 0);

// ── Droogloop, echt, nog eens ──────────────────────────────────────────────
const verkleind = join(tmp, "verkleind"); // de voorraad verkleinde foto's van de proef (niet ~/.bowaco)
const run = (naam, extra = []) => {
  const r = spawnSync("node", [join(repo, "tools/inrichting.mjs"), "--canister", cid, "--plan", join(werk, "plan"), "--verslag", join(tmp, `${naam}.md`), "--verkleind", verkleind, ...extra], { env: process.env, encoding: "utf8" });
  const rijen = readFileSync(join(tmp, `${naam}.csv`), "utf8").replace(/^﻿/, "").trim().split("\n").slice(1).map((l) => l.split(";").map((x) => x.replace(/^"|"$/g, "")));
  const tel = (soort, uitkomst) => rijen.filter((x) => x[1] === soort && x[4] === uitkomst).length;
  return { r, rijen, tel };
};
const a = await backend("proef-admin", cid);
const voor = { works: (await a.listWorks()).length, orgs: (await a.listOrgs(true)).length, lib: (await a.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 1n })).total.toString(), terms: (await a.getQuoteDocSettings()).terms.length };
const d = run("droog");
check("droogloop: zonder fout, en hij zou werven, posten, firma's, eenheden en prijzen aanmaken", d.r.status === 0 && d.tel("werf", "zou aangemaakt worden") === 2 && d.tel("post", "zou aangemaakt worden") >= 6 && d.tel("eenheid", "zou aangemaakt worden") >= 3, d.r.stdout.slice(-400));
// ── 2d.4: zuinige stap 7 (droogloop) ───────────────────────────────────────
const raming = (naam) => Object.fromEntries(readFileSync(join(tmp, `${naam}-raming.csv`), "utf8").replace(/^﻿/, "").trim().split("\n").slice(1).map((l) => { const c = l.split(";").map((x) => x.replace(/^"|"$/g, "")); return [c[0], { documenten: c[2], bestanden: +c[4], voor: +c[5], na: +c[6], fotos: +c[7], geraamd: +c[8], videos: +c[9], teGroot: +c[10], eenmalig: +c[11], maand: +c[12], groot: +c[13] }]; }));
const rm = raming("droog");
const px = (f) => Object.fromEntries([...execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" }).matchAll(/(pixelWidth|pixelHeight):\s*(\d+)/g)].map((m) => [m[1], +m[2]]));
const vk = (() => { try { return execFileSync("ls", [verkleind], { encoding: "utf8" }).split("\n").find((f) => f.startsWith("D-00014-") && f.endsWith(".jpg")); } catch { return null; } })();
check("2d.4 raming: actieve werf W-901 documenten ja, historiekwerf W-903 nee (standaard D47)", rm["W-901"]?.documenten === "ja" && rm["W-903"]?.documenten === "nee", JSON.stringify(rm));
check("2d.4 raming: video's en bestanden > 15 MB tellen niet mee, maar staan in de lijst", rm["W-901"].videos === 1 && rm["W-901"].teGroot === 1 && rm["W-901"].bestanden === 4 && d.tel("video", "overgeslagen") === 2 && d.rijen.some((x) => x[1] === "bestand" && x[2] === "D-00016" && /15 MB/.test(x[5])), JSON.stringify(rm["W-901"]));
check("2d.4 verkleinen: de grote foto (3000 × 2000) wordt ≤ 2000 px, zonder EXIF/gps, en kleiner", !!vk && px(join(verkleind, vk)).pixelWidth === 2000 && px(join(verkleind, vk)).pixelHeight === 1333 && !readFileSync(join(verkleind, vk)).includes("GPS") && !readFileSync(join(verkleind, vk)).includes("Exif") && rm["W-901"].na < rm["W-901"].voor, vk ?? "geen verkleinde foto");
check("2d.4 raming: de ontbrekende foto (D-00012) en de foto's van de niet-gekozen werf worden geraamd, niet verkleind", rm["W-901"].geraamd === 1 && rm["W-903"].geraamd === rm["W-903"].fotos && rm["W-903"].fotos === 54 && !execFileSync("ls", [verkleind], { encoding: "utf8" }).includes("D-09"));
check("2d.4 raming: € 2,6 per GB eenmalig (+ per bestand), € 0,41 per GB per maand, groot subnet × 2,6", Math.abs(rm["W-901"].eenmalig - (rm["W-901"].na / 1e9 * 2.6 + rm["W-901"].bestanden * 11e6 * 1.25 / 1e12)) < 1e-4 && Math.abs(rm["W-901"].maand - rm["W-901"].na / 1e9 * 0.41) < 1e-4 && Math.abs(rm["W-901"].groot - rm["W-901"].eenmalig * 2.6) < 1e-4);
const md7 = readFileSync(join(tmp, "droog.md"), "utf8");
check("2d.4 droogloop: de tabel per werf (bestanden, MB vóór/na, raming) en het tarief in het verslag en op het scherm", /\| W-901 \| ja \| \*\*ja\*\* \| 4 \|/.test(md7) && /\| W-903 \| nee \| nee \|/.test(md7) && md7.includes("× 2,6") && md7.includes("€ 0,41 per GB per maand") && /\| W-901 \|.*MB.*€/.test(d.r.stdout), md7.slice(md7.indexOf("## Stap 7"), md7.indexOf("## Stap 7") + 900));
const sch = run("schatting", ["--stap", "7", "--schatting"]);
check("2d.4 --schatting: niets verkleind, alle foto's geraamd", sch.r.status === 0 && raming("schatting")["W-901"].geraamd === raming("schatting")["W-901"].fotos, sch.r.stderr.slice(0, 300));
const slecht = run("slecht", ["--stap", "7", "--documenten-werf", "W-901=misschien"]);
check("2d.4 --documenten-werf: een ongeldige keuze wordt geweigerd", slecht.r.status !== 0 && /W-012=ja/.test(slecht.r.stderr));
const na0 = { works: (await a.listWorks()).length, orgs: (await a.listOrgs(true)).length, lib: (await a.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 1n })).total.toString(), terms: (await a.getQuoteDocSettings()).terms.length };
check("droogloop: niets bewaard (werven, firma's, posten, voorwaarden ongewijzigd)", JSON.stringify(voor) === JSON.stringify(na0), JSON.stringify([voor, na0]));
const e1 = run("echt-1", ["--echt"]);
check("echte run: zonder fout", e1.r.status === 0 || e1.rijen.filter((x) => x[4] === "fout").length === 0, e1.r.stdout.slice(-600));
check("echte run: 2 werven, 6 posten uit de offertes, 5 prijzen uit de prijslijst, de vergunningsprocedures", e1.tel("werf", "aangemaakt") === 2 && e1.tel("post", "aangemaakt") >= 6 && e1.tel("prijs", "aangemaakt") === 5 && e1.tel("procedure", "aangemaakt") === 2);
check("echte run: geen enkele fout-rij", e1.rijen.filter((x) => x[4] === "fout").length === 0, JSON.stringify(e1.rijen.filter((x) => x[4] === "fout")).slice(0, 300));
const e2 = run("echt-2", ["--echt"]);
const nieuw2 = e2.rijen.filter((x) => x[4] === "aangemaakt" || x[4] === "bijgewerkt");
check("tweede run: niets aangemaakt of bijgewerkt (idempotent)", nieuw2.length === 0, JSON.stringify(nieuw2).slice(0, 400));

// ── In de app ──────────────────────────────────────────────────────────────
const works = await a.listWorks();
const w901 = works.find((w) => w.code === "W-901"), w902 = works.find((w) => w.code === "W-902");
check("werven W-901 en W-902 met adres uit de mapnaam; W-903 (historiek) en W-904 (andere activiteit) niet", w901?.address.street === "Proefstraat" && w902?.address.zip === "" && !works.some((w) => w.code === "W-903" || w.code === "W-904"));
const notes = new Map((await a.workReviewNotes()).map(([id, t]) => [id, t]));
check("nog na te kijken bij elke nieuwe werf (ook bij de werf uit de planning), met de reden", notes.get(w901.id)?.startsWith("Nog na te kijken") && notes.get(w902.id)?.includes("geen postcode") && works.filter((w) => w.code.startsWith("PL-")).some((w) => notes.get(w.id)?.includes("planning")));
const plan901 = await a.getPlan(w901.id);
check("planning: de taken van het blok met de werfmap staan in W-901 (vervolg), de werf staat op gepland", plan901.tasks.length === 2 && "planned" in w901.status);
const q = await a.quoteSequence(BigInt(new Date().getFullYear()));
check("offertenummer: laatste = 152 (volgende offerte krijgt 153)", Number(q) >= 152);
const units = (await a.libraryUnits(true)).map((u) => u.key);
check("eenheden wa, cm/m2 en pct erbij", ["wa", "cm/m2", "pct"].every((k) => units.includes(k)));
const lib = await a.listLibrary({ text: "Werfvoorbereiding proefpost", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 10n });
const wv = lib.items.find((x) => x.title === "Werfvoorbereiding proefpost");
const hist = wv ? (await a.readLibraryPriceHistory(wv.id)).ok : null;
check("aankoopprijzen per offerte (2025/150, 2025/151), prijsgeheugen (2024/140) en de prijslijst bij dezelfde post, elk één keer", hist && ["offerte 2025/150", "offerte 2025/151", "offerte 2025/151 (raming)", "offerte 2025/152 (in de offerte: 2025/151)", "offerte 2024/140", "prijslijst D-00003"].every((r) => hist.costs.filter((c) => c.ref === r).length === 1), JSON.stringify(hist?.costs.map((c) => c.ref)));
const raam = (await a.listLibrary({ text: "Proefraam", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: false, offset: 0n, limit: 5n })).items[0];
const pr = raam ? (await a.readLibraryPrices([raam.id])).ok.prices[0] : null;
check("margeklasse: /0,9 in de offerte = verkoopregel 10 % met een reden die 'nog na te kijken' zegt", pr && pr.rule?.[0]?.margin === 1000n && /nog na te kijken/.test(pr.reason));
const doc = await a.getQuoteDocSettings();
check("voorwaarden als nieuwe versie, gemarkeerd als nog na te kijken; afzender en betaaltermijn gezet", doc.terms.some((t) => t.provisional && t.text.includes("verzonnen opdracht")) && doc.issuer.includes("Proefbouw BV") && Number(doc.paymentDays) === 15);
const orgs = await a.listOrgs(false);
check("firma's: beslist + uit de facturen, samengevoegd op KBO (PROEFDAK = Proefdak BV), code PLAAT bij PROEFPLAAT", orgs.some((o) => o.name === "Proefdak BV") && !orgs.some((o) => o.name === "PROEFDAK") && orgs.find((o) => o.name === "PROEFPLAAT")?.aliases.includes("PLAAT"));
check("firma's: twee KBO-nummers voor dezelfde naam = conflict in het verslag, niet bewaard", e1.rijen.some((x) => x[1] === "firma" && x[4] === "conflict" && /KBO/.test(x[5])) && orgs.filter((o) => o.name.toLowerCase().startsWith("proefelek")).length === 1);
const gem = (await a.listMunicipalities(false)).find((m) => m.name === "Proefdorp");
check("vergunningen: gemeente met 2 procedures en de nieuwe soort", gem?.procedures.length === 2 && (await a.listPermitKinds(false)).some((k) => k.key === "nutsaansluiting"));
check("documenten: niets opgeladen (de opslagdienst ligt buiten het lokale net)", (await a.listFiles([w901.id])).length === 0);

// ── 2c.9 stap 8: één werf volledig (W-903, een historiekwerf die stap 3 niet aanmaakt) ──────────────────
const lw = spawnSync("python3", ["-I", join(repo, "tools/inrichting/lees-werf.py"), "--docs", docs, "--werf", "W-903", "--bron", "test"], { env, encoding: "utf8" });
check("werf-lezer: draait zonder fout", lw.status === 0, lw.stderr.slice(0, 300));
const p8 = plan("stap8-werf-W-903.json");
const b8 = (d) => p8.bestanden.find((x) => x.doc === d);
const op8 = p8.bestanden.filter((x) => !x.nietOpladen);
check("werf-lezer: alle rijen van de werf (werfmap, dubbel in 99, factuur buiten de map); 3 geweerd (pad, index, rijksregisternummer in de inhoud)", p8.telling.indexrijen === 69 && p8.bestanden.length === 66 && p8.geweerd.map((g) => g.doc).sort().join() === "D-09012,D-09013,D-09014", JSON.stringify(p8.geweerd));
check("werf-lezer: te groot (> 25 MB) en een onbekende soort niet op te laden, met de reden", /te groot/.test(b8("D-09010")?.nietOpladen) && /niet toegelaten/.test(b8("D-09011")?.nietOpladen) && op8.length === 63);
check("werf-lezer: foto's als JPEG zonder EXIF (geen GPS), naam .jpg", b8("D-09002")?.naam === "proeffoto 2.jpg" && b8("D-09001")?.mime === "image/jpeg" && !readFileSync(b8("D-09001").bestand).includes("GPS"));
check("werf-lezer (2d.4): een video staat in de lijst, nooit gekopieerd of opgeladen", b8("D-09017")?.video === true && /video/.test(b8("D-09017").nietOpladen) && b8("D-09017").bestand === "");
check("werf-lezer (2d.4): regels van de app (2000 px, 0,8); een kleine foto wordt niet vergroot", /-2000-80\.jpg$/.test(b8("D-09002")?.bestand ?? "") && px(b8("D-09002").bestand).pixelWidth === 30);
check("werf-lezer: soort per categorie, PID uit de map, dubbel apart, vertrouwelijk voor OA-offerte en factuur", b8("D-09008")?.soort === "pid" && b8("D-09015")?.documentTitel.includes("dubbel") && b8("D-09005")?.vertrouwelijk && b8("D-09016")?.soort === "factuur-klant" && b8("D-09016").vertrouwelijk && b8("D-09007")?.mime === "application/vnd.ms-outlook");
check("werf-lezer: hoogstens 50 bestanden per document (deel 1 en deel 2)", op8.filter((x) => x.documentTitel.endsWith("(deel 1)")).length === 50 && op8.filter((x) => x.documentTitel.endsWith("(deel 2)")).length === 2);
check("werf-lezer: firma's uit de aankoop van de werf, uit een pad en uit een map van een OA-offerte; geen diensten", p8.firmas.rijen.map((r) => r.key).join() === "F-001,F-003,W-903:oa:proefpleister" && p8.firmas.nietInDeApp.some((f) => f.firma === "F-005"));
check("werf-lezer: de offerte van de werf, de variant (raming) niet", p8.offertes.length === 1 && p8.offertes[0].nummer === "2025/150" && p8.offertes[0].lijnen.length === 5 && p8.nietAlsOfferte.some((x) => x.offerte === "Q-2025-151-raming"));
check("werf-lezer: --bron test op een map zonder merkbestand geweigerd", spawnSync("python3", ["-I", join(repo, "tools/inrichting/lees-werf.py"), "--docs", join(tmp, "geen-proefmap"), "--werf", "W-903", "--bron", "test"], { env, encoding: "utf8" }).status !== 0);
const r8 = (naam, extra = []) => run(naam, ["--werf", "W-903", ...extra]);
const d8 = r8("w-droog");
check("stap 8 droogloop: zonder fout en niets bewaard", d8.r.status === 0 && d8.tel("bestand", "zou aangemaakt worden") === 63 && d8.tel("werf", "zou aangemaakt worden") === 1 && !(await a.listWorks()).some((w) => w.code === "W-903"), d8.r.stdout.slice(-500));
check("stap 8 droogloop: het manifest (soort, grootte, sha256, hash van de opslag, doel)", (() => { const m = readFileSync(join(tmp, "w-droog-manifest.csv"), "utf8"); return m.split("\n").length >= 66 && /D-09003.*plannen.*application\/pdf.*sha256:[0-9a-f]{64}.*dossier/.test(m); })());
const e8 = r8("w-echt-1", ["--echt"]);
check("stap 8 echt: zonder fout of conflict", e8.r.status === 0 && e8.rijen.filter((x) => x[4] === "fout" || x[4] === "conflict").length === 0, JSON.stringify(e8.rijen.filter((x) => x[4] === "fout")).slice(0, 400));
const w903 = (await a.listWorks()).find((w) => w.code === "W-903");
const ds = w903 ? await a.getDossier(w903.id) : { documents: [] };
const fl = ds.documents.flatMap((d) => d.files.map((f) => ({ ...f, d })));
check("stap 8 echt: werf met adres, klant (plaatshouder), aanvraag, nog na te kijken", w903?.address.street === "Oudeproef" && "request" in w903.status && w903.clientOrgId.length === 1 && (new Map((await a.workReviewNotes()).map(([i, t]) => [i, t])).get(w903.id) ?? "").startsWith("Nog na te kijken"));
check("stap 8 echt: 12 documenten en 63 bestanden in het dossier; verwijzing = de hash van de opslag; vertrouwelijk zonder verwijzing", ds.documents.length === 12 && fl.length === 63 && (await Promise.all(fl.filter((f) => !f.confidential).map(async (f) => { const b = op8.find((x) => x.naam === f.name && x.bytes === Number(f.size) && x.documentTitel === f.d.title); return b && new TextDecoder().decode(f.blob[0]) === "!caf!" + (await blobHash(readFileSync(b.bestand), b.mime, b.naam)); }))).every(Boolean) && fl.filter((f) => f.confidential).length === 4 && fl.filter((f) => f.confidential).every((f) => !f.blob.length));
check("stap 8 echt: Excel, Outlook en de PID als document; nieuwe soorten fotos en factuur-klant", fl.some((f) => f.mime === "application/vnd.ms-outlook") && ds.documents.some((d) => d.kind === "pid") && (await a.listDocKinds(false)).filter((k) => k.key === "fotos" || (k.key === "factuur-klant" && k.confidential)).length === 2);
const q8 = (await a.listQuotes([w903.id], true)).find((q) => q.number === "2025/150");
const rq = q8 ? (await a.readQuoteVersion(q8.versions[0].id)).ok : null;
check("stap 8 echt: offerte 2025/150 als ontwerp met 2 hoofdstukken, 5 lijnen, subtotaal = de Excel (47,00 €·100)", rq && "draft" in rq.version.status && rq.chapters.length === 2 && rq.lines.length === 5 && rq.totals.subtotalCents === 470000n, rq ? `${rq.totals.subtotalCents}` : "geen offerte");
const e8b = r8("w-echt-2", ["--echt"]);
const nieuw8 = e8b.rijen.filter((x) => x[4] === "aangemaakt" || x[4] === "bijgewerkt");
check("stap 8 tweede run: niets nieuw (idempotent)", e8b.r.status === 0 && nieuw8.length === 0 && e8b.tel("bestand", "overgeslagen") === 69, JSON.stringify(nieuw8).slice(0, 300));
const sp8 = spawnSync("node", [join(repo, "tools/inrichting/steekproef.mjs"), "--canister", cid, "--plan", join(werk, "plan"), "--werf", "W-903"], { env: process.env, encoding: "utf8" });
check("stap 8 steekproef: alles teruggevonden", sp8.status === 0, sp8.stdout.slice(-400));
const lk8 = spawnSync("node", [join(repo, "tools/inrichting/lekcontrole.mjs"), cid, "--ids", String(Number(w903.id) + 5)], { env: process.env, encoding: "utf8" });
check("stap 8 lekcontrole: een onbekende login ziet niets (ook niet per werf-id)", lk8.status === 0, lk8.stdout.slice(-400));
const liveUp = spawnSync("node", ["--input-type=module", "-e", `const m = await import("${join(repo, "tools/opslag.mjs")}"); try { await m.storageClientInrichting("${cid}", "p", "proef-admin"); process.exit(1); } catch (e) { process.exit(/Geweigerd/.test(e.message) ? 0 : 2); }`], { env: { ...process.env, LIVE_CANISTERS_EXTRA: cid, JA_EIGENAAR: "1" }, encoding: "utf8" });
check("stap 8 grens: op live laadt enkel de inrichtingsidentiteit op", liveUp.status === 0, liveUp.stderr.slice(0, 200));

// ── 2d.4: keuze per werf overschrijven (W-903 staat nu in de app via stap 8) ────────────────────────────
const ov = run("keuze", ["--stap", "7", "--documenten-werf", "W-903=ja,W-901=nee"]);
const rk = raming("keuze");
check("2d.4 --documenten-werf: W-903=ja en W-901=nee overschrijven de standaard; geen conflict", ov.r.status === 0 && rk["W-903"]?.documenten === "ja" && rk["W-901"]?.documenten === "nee" && !ov.rijen.some((x) => x[4] === "conflict"), JSON.stringify(rk));
check("2d.4 --documenten-werf: de foto's van de gekozen werf worden nu verkleind (en kleine nooit vergroot)", rk["W-903"].geraamd === 0 && execFileSync("ls", [verkleind], { encoding: "utf8" }).includes("D-09002-2000-80.jpg") && px(join(verkleind, "D-09002-2000-80.jpg")).pixelWidth === 30);
const onb = run("onbekend", ["--stap", "7", "--documenten-werf", "W-999=ja"]);
check("2d.4 --documenten-werf: een werf zonder documenten in het plan = conflict in het verslag", onb.rijen.some((x) => x[1] === "keuze" && x[2] === "W-999" && x[4] === "conflict"));
check("2d.4: stap 7 laadt nooit iets op (ook niet met keuze)", (await a.listFiles([w901.id])).length === 0);

rmSync(tmp, { recursive: true, force: true });
console.log(`\ninrichting: ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
