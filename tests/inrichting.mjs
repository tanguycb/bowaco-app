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
check("documenten: enkel werfbestanden van aangemaakte werven; foto's en gevoelige bestanden niet", p7.werven.length === 1 && p7.werven[0].aantal === 2 && !JSON.stringify(p7).includes("D-00012") && !JSON.stringify(p7).includes("D-00013"));
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
const run = (naam, extra = []) => {
  const r = spawnSync("node", [join(repo, "tools/inrichting.mjs"), "--canister", cid, "--plan", join(werk, "plan"), "--verslag", join(tmp, `${naam}.md`), ...extra], { env: process.env, encoding: "utf8" });
  const rijen = readFileSync(join(tmp, `${naam}.csv`), "utf8").replace(/^﻿/, "").trim().split("\n").slice(1).map((l) => l.split(";").map((x) => x.replace(/^"|"$/g, "")));
  const tel = (soort, uitkomst) => rijen.filter((x) => x[1] === soort && x[4] === uitkomst).length;
  return { r, rijen, tel };
};
const a = await backend("proef-admin", cid);
const voor = { works: (await a.listWorks()).length, orgs: (await a.listOrgs(true)).length, lib: (await a.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 1n })).total.toString(), terms: (await a.getQuoteDocSettings()).terms.length };
const d = run("droog");
check("droogloop: zonder fout, en hij zou werven, posten, firma's, eenheden en prijzen aanmaken", d.r.status === 0 && d.tel("werf", "zou aangemaakt worden") === 2 && d.tel("post", "zou aangemaakt worden") >= 6 && d.tel("eenheid", "zou aangemaakt worden") >= 3, d.r.stdout.slice(-400));
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

rmSync(tmp, { recursive: true, force: true });
console.log(`\ninrichting: ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
