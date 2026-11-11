// De balk (stap 4b.2) op een canister die al in gebruik is (het eigen net, na tests/rollen.mjs). De zoekindex wordt met DEZELFDE code als de app
// opgebouwd (src/frontend/src/balk/zoek.ts, gebundeld met esbuild) tegen de echte canister, per rol. Bewijst:
//   (1) per rol precies de bronnen die de rol mag: werven, documenten van een werf, offertes, OA-facturen, firma's, personen;
//       externen krijgen geen personen/firma's/offertes/facturen die hun caps niet geven;
//   (2) lek: elke regel met een werf hoort bij een werf in listWorks van díe rol; niets van een andere werf; geen bedrag,
//       geen telefoon, geen e-mail, geen opslag-URL, geen vertrouwelijk veld in een regel (enkel vaste velden, vaste vorm);
//   (3) schermen en handelingen ⊆ het menu van de rol (pagesFor/navFor) en elk adres opent echt dat scherm voor die rol;
//   (4) het zoeken: woorden, accenten, hoofdletters, begrensd per soort, lege tekst = enkel handelingen en schermen.
// Enkel VERZONNEN gegevens ("Proef … 4b2", Lindegem, 9993).
//   node tests/proef-4b-2.mjs <canister-id>
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backend } from "../tools/lib.mjs";
import { loadNav } from "./menu-lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/proef-4b-2.mjs <canister-id>");
const host = process.env.ICP_HOST || "";
if (!host.includes("localhost") && !host.includes("127.0.0.1")) throw new Error("tests/proef-4b-2.mjs enkel op het eigen lokale net");
let pass = 0;
let fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repo, "package.json"));
const esbuild = require(join(repo, "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
const out = join(mkdtempSync(join(tmpdir(), "bowaco-balk-")), "zoek.mjs");
await esbuild.build({ entryPoints: [join(repo, "src/frontend/src/balk/zoek.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
const Z = await import(pathToFileURL(out).href);
const nav = await loadNav();
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const addr = { street: "Proefstraat", number: "4", zip: "9993", city: "Lindegem", country: "BE" };

const NAMES = { admin: "proef-admin", calc: "proef-calculator", wl: "proef-werfleider", arch: "proef-architect", klant: "proef-klant", vc: "proef-vc", oa: "proef-oa2" };
const who = {};
for (const [k, n] of Object.entries(NAMES)) who[k] = await backend(n, cid);
const admin = who.admin;

// Verzonnen gegevens met accenten, om het zoeken te bewijzen.
const orgId = ok(await admin.createOrg({ kind: { subcontractor: null }, name: `Proef Bouwbedrijf Zoëkt ${sfx}`, kbo: [], vat: [], aliases: [`Zoekalias${sfx}`], trades: [], address: [addr], notes: "Verzonnen (4b.2)" })).id;
const w = ok(await admin.createWork({ code: `Z${sfx}`, name: `Proef Zoekwerf Café ${sfx}`, address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 2100n, plannedStart: [], plannedEnd: [], estimatedAmountCents: [] }));

const idx = {};
const caps = {};
for (const [k, a] of Object.entries(who)) {
  const me = await a.me();
  caps[k] = me.caps[0] ?? me.caps;
  idx[k] = await Z.laadIndex(a, caps[k]);
}
const kinds = (r) => new Set(r.map((x) => x.soort));
const of = (k, s) => idx[k].filter((x) => x.soort === s);

// (1) bronnen per rol
for (const k of Object.keys(who)) {
  const c = caps[k];
  const has = (s) => of(k, s).length > 0;
  check(`${k}: personen enkel met readTeam`, !has("persoon") || c.readTeam);
  check(`${k}: firma's enkel met readTeam of readOa`, !has("firma") || c.readTeam || c.readOa);
  check(`${k}: offertes enkel met quotes`, !has("offerte") || c.quotes);
  check(`${k}: facturen enkel met oaInvoices`, !has("factuur") || c.oaInvoices);
}
check("admin: eigen proefwerf, firma en personen in de index", of("admin", "werf").some((r) => r.titel.includes(`Z${sfx}`)) && of("admin", "firma").some((r) => r.titel.includes(sfx)) && of("admin", "persoon").length >= 3);
for (const k of ["klant", "arch", "vc", "oa"]) check(`${k}: geen personen en geen firma's`, !kinds(idx[k]).has("persoon") && !kinds(idx[k]).has("firma") || caps[k].readOa);

// (2) lek
const big = (_, v) => (typeof v === "bigint" ? v.toString() : v);
for (const k of Object.keys(who)) {
  const mine = new Set((await who[k].listWorks()).map((x) => String(x.id)));
  const wk = (r) => { const m = r.to.match(/^werven\/(\d+)/); return m ? m[1] : null; };
  const foreign = idx[k].filter((r) => wk(r) && !mine.has(wk(r)));
  check(`${k}: elke regel met een werf hoort bij een werf van deze rol (${mine.size} werven)`, foreign.length === 0, foreign.slice(0, 2).map((r) => r.id).join(","));
  const werfIds = of(k, "werf").map(wk);
  check(`${k}: werven in de index = werven van de lijst`, werfIds.length === mine.size && werfIds.every((x) => mine.has(x)));
  const keys = new Set(idx[k].flatMap((r) => Object.keys(r)));
  check(`${k}: enkel vaste velden (soort, id, titel, sub, to, hay)`, [...keys].sort().join() === "hay,id,soort,sub,titel,to");
  const text = JSON.stringify(idx[k], big);
  check(`${k}: geen opslag-URL, bedrag, mail of telefoon in de index`, !/!caf!|https?:|blob|cents|€|@[a-z0-9-]+\.[a-z]{2,}|\+32|\b0\d{2,3}[ /.]?\d{2}[ .]?\d{2}[ .]?\d{2}\b/i.test(text.replace(/"to":"[^"]*"/g, "")));
}
// de proefwerf zonder lid is niet zichtbaar voor externen die er niet bij horen
for (const k of ["klant", "arch", "vc", "oa"]) check(`${k}: ziet de nieuwe werf zonder lidmaatschap niet`, !of(k, "werf").some((r) => r.titel.includes(`Z${sfx}`)) && !idx[k].some((r) => r.to === `werven/${w.id}` || r.to.startsWith(`werven/${w.id}/`)));
// een extern ziet geen werfcodes van anderen via documenten
check("klant: documenten enkel van eigen werven", of("klant", "document").length === of("klant", "werf").length);

// (3) schermen en handelingen
for (const k of Object.keys(who)) {
  const c = caps[k];
  const bad = [];
  for (const r of idx[k].filter((x) => x.soort === "scherm")) {
    const res = nav.resolveRoute(r.to.split("/"), c);
    if (res.page !== r.to.split("/")[0] && !res.redirect) bad.push(r.to);
  }
  check(`${k}: elk scherm in de balk opent dat scherm voor deze rol`, bad.length === 0, bad.join(","));
  const menu = new Set(nav.navFor(c).flatMap((g) => g.items.map((i) => i.to)));
  const extra = idx[k].filter((x) => x.soort === "scherm").map((x) => x.to).filter((to) => !menu.has(to) && !["te-doen", "login"].includes(to) && !nav.pagesFor(c).has(to.split("/")[0]));
  check(`${k}: geen scherm buiten wat het menu en de rechten geven`, extra.length === 0, extra.join(","));
  const ha = of(k, "handeling").map((x) => x.id.replace("handeling:", ""));
  const want = [c.createWork && "nieuwe-werf", c.manageOrgs && "nieuwe-firma", c.oaInvoices && c.quotePrices && "nieuwe-oa-factuur", c.purchases && "nieuwe-aankoop", c.writeReports && "werfverslag", c.quotes && "offertes", c.tenders && "prijsvragen"].filter(Boolean);
  check(`${k}: handelingen = precies wat de rechten geven`, ha.sort().join() === want.sort().join(), `${ha.join(",")}`);
}
check("klant en onderaannemer: geen enkele handeling", of("klant", "handeling").length === 0 && of("oa", "handeling").length === 0);

// (4) zoeken
const A = idx.admin;
const f1 = Z.zoek(A, `Z${sfx}`);
check("zoeken op werfcode: de werf eerst", f1[0]?.titel.startsWith(`Z${sfx}`) && f1[0].soort === "werf");
check("zoeken zonder accenten en hoofdletters (cafe = Café)", Z.zoek(A, `zoekwerf CAFE ${sfx.toLowerCase()}`).some((r) => r.soort === "werf" && r.titel.includes(sfx)));
check("zoeken op accenten (zoëkt)", Z.zoek(A, "zoekt " + sfx).some((r) => r.soort === "firma"));
check("zoeken op alias van een firma", Z.zoek(A, `zoekalias${sfx}`).some((r) => r.soort === "firma" && r.to === `adresboek/${orgId}`));
check("alle woorden moeten passen", Z.zoek(A, `Z${sfx} bestaatniet`).length === 0);
check("niets gevonden = lege lijst", Z.zoek(A, "qqqqxzx").length === 0);
check("lege tekst: enkel handelingen en schermen", Z.zoek(A, "").length > 0 && Z.zoek(A, "").every((r) => r.soort === "handeling" || r.soort === "scherm"));
check("begrensd: hoogstens 5 per soort", Object.values(Object.groupBy(Z.zoek(A, "p"), (r) => r.soort)).every((l) => l.length <= 5));
check("handeling vinden: 'nieuwe werf' → Nieuwe werf of aanvraag, adres werven/nieuw", Z.zoek(A, "nieuwe werf")[0]?.to === "werven/nieuw");
check("scherm vinden: 'te doen'", Z.zoek(A, "te doen").some((r) => r.to === "te-doen"));
check("een klant vindt 'nieuwe werf' niet", Z.zoek(idx.klant, "nieuwe werf").every((r) => r.soort !== "handeling"));
check("een werfleider vindt het werfverslag", Z.zoek(idx.wl, "verslag").some((r) => r.to === "verslag"));
console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail ? 1 : 0);
