// De schil en design system v3 (stap 4b.3) op een canister die al in gebruik is (het eigen net, na tests/rollen.mjs). De zuivere kern
// wordt met DEZELFDE code als de app gebundeld (src/frontend/src/app/schil.ts en design/tabel.ts, met esbuild) en per rol nagelopen
// met de caps die de echte canister geeft. Bewijst:
//   (1) de twee dichtheden (gsm en vinger ruim, scherm met muis vanaf 900 px dicht) en de stand van het menu (rail, open, verborgen);
//   (2) de ⓘ per rol: elk scherm in het menu van de rol heeft een uitleg, in gewone woorden, zonder "AI", zonder bedrag of e-mail;
//       wie geen prijzen ziet, krijgt de uitleg zonder prijzen; externen krijgen hun eigen uitleg;
//   (3) het kruimelpad in de bovenbalk: enkel labels uit het menu en de tabbladen van de rol, het eerste = het menu-item;
//   (4) de tellers van het dossier (de werf): enkel tellingen uit de stand die de backend per rol geeft (listWorkStages), geen bedrag,
//       enkel onderdelen die de rol heeft; externen krijgen geen stand en dus geen tellers van gebeurtenissen;
//   (5) het tabelonderdeel (sorteren met accenten, getallen en bigints, leeg achteraan, filter) en de pijltjes van de werklijst;
//   (6) het stelsel in de code: twee dichtheidsblokken, drie maten per knop, geen window.confirm, geen "AI" in de nieuwe teksten.
// Enkel lezen; geen gegevens.
//   node tests/proef-4b-3.mjs <canister-id>
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backend } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-4b-3.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-4b-3.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(repo, "src/frontend/src");
const require = createRequire(join(repo, "package.json"));
const esbuild = require(join(repo, "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
const dir = mkdtempSync(join(tmpdir(), "bowaco-schil-"));
const entry = join(dir, "in.ts");
writeFileSync(entry, `export * from ${JSON.stringify(join(src, "app/schil.ts"))};
export * from ${JSON.stringify(join(src, "design/tabel.ts"))};
export { navFor, pagesFor, hubTabs, beheerTabs, planningTabs } from ${JSON.stringify(join(src, "app/nav.ts"))};
export { werfTabs, werfFase } from ${JSON.stringify(join(src, "app/fase.ts"))};
export { t } from ${JSON.stringify(join(src, "texts/nl.ts"))};
`);
const out = join(dir, "schil.mjs");
await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
const S = await import(pathToFileURL(out).href);
const { t } = S;

// (1) dichtheid en menu
check("gsm (375, vinger) = ruim", S.dichtheid(375, true) === "ruim");
check("smal venster met muis (899) = ruim", S.dichtheid(899, false) === "ruim");
check("scherm met muis vanaf 900 = dicht", S.dichtheid(900, false) === "dicht" && S.dichtheid(1440, false) === "dicht");
check("tablet met vinger (1180) blijft ruim", S.dichtheid(1180, true) === "ruim");
check("menu op de gsm verborgen (achter de knop)", S.menuStand(375, "open") === "verborgen" && S.menuStand(899, null) === "verborgen");
check("zonder keuze: rail onder 1280, open vanaf 1280", S.menuStand(1100, null) === "rail" && S.menuStand(1280, null) === "open" && S.menuStand(1920, null) === "open");
check("de keuze van dit toestel wint", S.menuStand(1100, "open") === "open" && S.menuStand(1920, "rail") === "rail");
check("enkel open of rail wordt gelezen", S.leesKeuze("open") === "open" && S.leesKeuze("rail") === "rail" && S.leesKeuze("x") === null && S.leesKeuze(null) === null && S.leesKeuze('{"a":1}') === null);

// (2)–(4) per rol, met de caps van de echte canister
const NAMES = { admin: "proef-admin", calc: "proef-calculator", wl: "proef-werfleider", arch: "proef-architect", klant: "proef-klant", vc: "proef-vc", oa: "proef-oa2" };
const AI = /\bAI\b/;
const BEDRAG = /€|\b\d+[.,]\d{2}\b|@/;
const stagesOf = async (a) => { try { return await a.listWorkStages(); } catch { return null; } };
const nz = (x) => (Array.isArray(x) ? (x.length ? x[0] : undefined) : x);
for (const [k, n] of Object.entries(NAMES)) {
  const a = await backend(n, cid);
  const me = await a.me();
  const caps = nz(me.caps);
  const groups = S.navFor(caps);
  const items = groups.flatMap((g) => g.items);
  const pages = S.pagesFor(caps);
  // (2) uitleg
  const zonder = [];
  const fout = [];
  for (const it of items) {
    const page = it.to.split("/")[0];
    const u = S.paginaUitleg(page, caps, it.to.split("/")[1]);
    if (!u) zonder.push(it.to);
    else if (AI.test(u) || BEDRAG.test(u) || u.length > 420) fout.push(it.to);
  }
  check(`${k}: elk menu-item heeft een ⓘ-uitleg`, zonder.length === 0, zonder.join(", "));
  check(`${k}: de uitleg zonder "AI", bedrag of e-mail, en kort`, fout.length === 0, fout.join(", "));
  const alle = [...pages].map((p) => S.paginaUitleg(p, caps)).filter(Boolean);
  check(`${k}: ook de schermen buiten het menu: geen "AI" in de uitleg`, alle.every((u) => !AI.test(u)));
  if (pages.has("offertes")) check(`${k}: uitleg Offertes volgt de prijzen (${caps.quotePrices ? "met" : "zonder"})`, S.paginaUitleg("offertes", caps) === (caps.quotePrices ? t.offertes.lead : t.offertes.leadTotals));
  if (pages.has("prijsvragen")) check(`${k}: uitleg Prijsvragen volgt de rol`, S.paginaUitleg("prijsvragen", caps) === (caps.tenders ? (caps.quotePrices ? t.prijsvragen.overviewLead : t.prijsvragen.leadLeader) : t.schil.uitleg.mijnPrijsvragen));
  if (pages.has("oa-facturen")) check(`${k}: uitleg OA-facturen zonder bedragen voor wie geen prijzen ziet`, S.paginaUitleg("oa-facturen", caps) === (caps.quotePrices ? t.oaFacturen.lead : t.oaFacturen.leadQty));
  const wu = S.paginaUitleg("werven", caps);
  check(`${k}: uitleg Werven past bij de rol`, wu === (caps.readTeam ? t.schil.uitleg.werven : (caps.myQuotes || caps.myProgress) ? t.schil.uitleg.mijnWerf : t.schil.uitleg.mijnWerven));
  // (3) kruimelpad
  const tabs = new Set([...items.map((i) => i.label), ...S.beheerTabs(caps).map((x) => x.label), ...S.planningTabs(caps).map((x) => x.label), t.todo.title, t.nav.login,
    ...["offertes", "facturen", "vergunningen", "werven"].flatMap((p) => S.hubTabs(p, caps).map((x) => x.label))]);
  const kfout = [];
  for (const it of items) {
    const kr = S.kruimels(it.to.split("/"), caps);
    if (kr.length === 0 || kr[0].label !== it.label || kr.some((x) => !tabs.has(x.label))) kfout.push(`${it.to}: ${kr.map((x) => x.label).join(" / ")}`);
  }
  check(`${k}: kruimelpad = menu-item + tabblad, niets daarbuiten`, kfout.length === 0, kfout.slice(0, 3).join("; "));
  check(`${k}: Te doen en Mijn toegang hebben een kruimel`, S.kruimels(["te-doen"], caps).length >= 1 && S.kruimels(["login"], caps).length >= 1);
  // (4) tellers van het dossier
  const st = await stagesOf(a);
  const works = await a.listWorks().catch(() => []);
  if (caps.readTeam || caps.myQuotes || caps.myProgress) check(`${k}: krijgt de stand van zijn werven`, Array.isArray(st));
  let tfout = 0;
  let geteld = 0;
  for (const w of works) {
    const s = (st ?? []).find((x) => x.workId === w.id);
    const facts = s ? { tasks: s.tasks, quoteWaiting: s.quoteWaiting, next: { ...s.next, declareBy: nz(s.next.declareBy), tender: nz(s.next.tender) } } : {};
    const tl = S.onderdeelTellers(facts, nz(w.checklistOpen));
    const keys = Object.keys(tl);
    geteld += keys.length;
    // enkel getallen, nooit een bedrag of tekst
    if (!Object.values(tl).every((x) => Number.isInteger(x.n) && x.n >= 0 && typeof x.aandacht === "boolean")) tfout++;
    if (!s && keys.some((x) => x !== "documenten")) tfout++; // zonder stand enkel de documentenlijst van de werf zelf
  }
  check(`${k}: tellers van het dossier enkel tellingen uit de eigen stand (${works.length} werven, ${geteld} tellers)`, tfout === 0);
  if (k === "admin") check("admin: het dossier telt iets op de proefwerven", geteld > 0);
  // Externen krijgen een lege stand (StageApi: geen gebeurtenissen voor wie geen kantoor of klant is): enkel de documentenlijst kan tellen.
  if (["arch", "vc", "oa"].includes(k)) {
    const leeg = (st ?? []).every((x) => Number(x.tasks) === 0 && !x.quoteWaiting && Number(x.next.salesDue) + Number(x.next.salesLate) + Number(x.next.contractsToSign) + Number(x.next.attestsSoon) + Number(x.next.attestsExpired) === 0 && x.next.tender.length === 0);
    check(`${k}: lege stand, dus geen tellers van gebeurtenissen in het dossier`, leeg && works.every((w) => { const s = (st ?? []).find((x) => x.workId === w.id); return Object.keys(S.onderdeelTellers(s ? { tasks: s.tasks, quoteWaiting: s.quoteWaiting, next: { ...s.next, declareBy: nz(s.next.declareBy), tender: nz(s.next.tender) } } : {}, nz(w.checklistOpen))).every((x) => x === "documenten"); }));
  }
}

// toontUitleg
check("ⓘ op het scherm en zijn tabbladen", S.toontUitleg(["overzicht"]) && S.toontUitleg(["beheer", "toegang"]) && S.toontUitleg(["werven", "lopend"]) && S.toontUitleg(["oa-facturen", "12"]));
check("geen ⓘ van de lijst op een werf of een los stuk", !S.toontUitleg(["werven", "12"]) && !S.toontUitleg(["werven", "12", "planning"]) && !S.toontUitleg(["oa-facturen", "12", "wijzigen"]));

// tellers: vaste gevallen
{
  const nul = { salesDue: 0n, salesLate: 0n, hoursOpen: 0n, addendums: 0n, contractsToSign: 0n, attestsSoon: 0n, attestsExpired: 0n };
  check("niets te tellen = geen tellers", Object.keys(S.onderdeelTellers({ tasks: 0n, quoteWaiting: false, next: nul }, 0n)).length === 0);
  const x = S.onderdeelTellers({ tasks: 12n, quoteWaiting: true, next: { ...nul, salesLate: 1n, attestsExpired: 2n, declareBy: 5n, tender: { asked: 3n, answered: 1n, compare: false } } }, 4n);
  check("planning telt de taken (geen aandacht)", x.planning?.n === 12 && !x.planning.aandacht);
  check("offerte: wacht op de klant + open prijsvragen, met aandacht", x.offerte?.n === 3 && x.offerte.aandacht);
  check("facturatie: een te late schijf vraagt aandacht", x.facturatie?.n === 1 && x.facturatie.aandacht);
  check("wie werkt mee: vervallen attesten vragen aandacht", x.wie?.n === 2 && x.wie.aandacht);
  check("vergunningen: een aangifte vóór een dag", x.vergunningen?.aandacht === true);
  check("documenten: ontbrekende stukken", x.documenten?.n === 4 && x.documenten.aandacht);
}

// (5) tabel en werklijst
{
  const rows = [{ n: "Émile", b: 30n }, { n: "anton", b: 5n }, { n: "Zoë", b: undefined }, { n: "Bart", b: 100n }];
  const cols = [{ key: "n", label: "Naam", render: () => "", sort: (r) => r.n }, { key: "b", label: "Bedrag", render: () => "", sort: (r) => r.b }];
  check("sorteren op naam zonder accenten en hoofdletters", S.tabelRijen(rows, cols, "n").map((r) => r.n).join(",") === "anton,Bart,Émile,Zoë");
  check("aflopend", S.tabelRijen(rows, cols, "-n").map((r) => r.n).join(",") === "Zoë,Émile,Bart,anton");
  check("bigints als getal, leeg achteraan", S.tabelRijen(rows, cols, "b").map((r) => r.n).join(",") === "anton,Émile,Bart,Zoë");
  check("ook aflopend blijft leeg achteraan", S.tabelRijen(rows, cols, "-b").map((r) => r.n).join(",") === "Bart,Émile,anton,Zoë");
  check("filter", S.tabelRijen(rows, cols, null, { key: "x", label: "x", test: (r) => r.b !== undefined }).length === 3);
  check("geen sortering = de volgorde van de lijst", S.tabelRijen(rows, cols, null).map((r) => r.n).join(",") === "Émile,anton,Zoë,Bart");
  check("onbekende kolom laat de volgorde staan", S.tabelRijen(rows, cols, "x").length === 4);
  const k = ["1", "2", "3"];
  check("pijltjes in de werklijst: omlaag, omhoog, blijven op de rand", S.volgende(k, "1", 1) === "2" && S.volgende(k, "2", -1) === "1" && S.volgende(k, "3", 1) === "3" && S.volgende(k, "1", -1) === "1");
  check("pijltjes zonder keuze: eerste of laatste", S.volgende(k, undefined, 1) === "1" && S.volgende(k, undefined, -1) === "3" && S.volgende([], undefined, 1) === undefined);
}

// (6) het stelsel in de code
{
  const css = readFileSync(join(src, "design/v3.css"), "utf8");
  const dicht = css.slice(css.indexOf(':root[data-dichtheid="dicht"]'));
  check("v3.css: drie knopmaten in beide dichtheden", ["--bw-h-sm", "--bw-h-md", "--bw-h-lg"].every((v) => css.indexOf(v) < css.indexOf(':root[data-dichtheid="dicht"]') && dicht.includes(v)));
  check("v3.css: dicht = letter 14,5 px en rijen van 40 px", /--bw-fs-md: 0\.90625rem/.test(dicht) && /--bw-row: 40px/.test(dicht));
  check("v3.css: geen nieuwe kleuren (enkel tokens)", !/#[0-9a-f]{3,6}\b(?![^"]*")/i.test(css.replace(/url\("[^"]*"\)/g, "")));
  const btn = readFileSync(join(src, "design/Button.tsx"), "utf8");
  check("Button: drie soorten + gevaarlijk, drie maten", /"primary" \| "secondary" \| "quiet" \| "danger"/.test(btn) && /"sm" \| "md" \| "lg"/.test(btn));
  const nieuw = ["app/schil.ts", "app/App.tsx", "design/Pop.tsx", "design/Table.tsx", "design/Werklijst.tsx", "design/Tag.tsx", "screens/Werf.tsx", "screens/FacturenLijst.tsx", "screens/OaFacturen.tsx", "screens/MinMeer.tsx"].map((f) => readFileSync(join(src, f), "utf8")).join("\n");
  const code = nieuw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // commentaar telt niet ("geen window.confirm")
  check("geen window.confirm in de nieuwe en aangepaste schermen", !/window\.confirm|\bconfirm\(/.test(code));
  const schilTekst = JSON.stringify(t.schil);
  check('t.schil zonder "AI"', !AI.test(schilTekst));
  check("main.tsx zet de dichtheid vóór het eerste beeld", /dataset\.dichtheid = dichtheid\(/.test(readFileSync(join(src, "main.tsx"), "utf8")));
}

console.log(`\n${pass} ✓  ${fail} ✗`);
if (fail > 0) process.exit(1);
