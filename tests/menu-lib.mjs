// Laadt het menu van de app (src/frontend/src/app/nav.ts, zuivere functies) in node: gebundeld met esbuild uit het
// project zelf, zonder React of browser. Gebruikt door tests/rollen.mjs (menu per rol) en tests/menu.mjs.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repo, "package.json"));

async function load(file) {
  const esbuild = require(join(repo, "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
  const out = join(mkdtempSync(join(tmpdir(), "bowaco-nav-")), "mod.mjs");
  await esbuild.build({ entryPoints: [join(repo, "src/frontend/src/app", file)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
  return import(pathToFileURL(out).href);
}

export const loadNav = () => load("nav.ts");
/** 2b.3: de faseregels, de tabbladen per rol en de volgende stap (src/frontend/src/app/fase.ts). */
export const loadFase = () => load("fase.ts");

/** De 21 menu-items van de beheerder tot en met draft 49, de oude adressen en wat ze nu openen (tabel oud → nieuw). */
export const OUD_NAAR_NIEUW = [
  // [oude route, scherm dat opent, nieuw adres waarnaar de adresbalk doorverwijst (of null), minimale cap]
  ["overzicht", "overzicht", null, "home=overzicht"],
  ["vandaag", "vandaag", null, "writeReports"],
  ["werven", "werven", null, "any"],
  ["weekbord", "weekbord", null, "readOrgPlanning"],
  // 2b.4: ["dashboard", …] is weg: #/dashboard verwijst door (admin → overzicht, werfleider en calculator → werven/lopend); zie tests/start.mjs en de rollentest 2b.4
  ["offertes", "offertes", null, "quotes"],
  ["posten", "posten", null, "readLibrary"],
  ["opmeting", "opmeting", null, "measureRead"],
  ["vorderingen", "vorderingen", null, "progress"],
  ["oa-facturen", "oa-facturen", null, "oaInvoices"],
  ["vergunningen", "vergunningen", null, "permits"],
  ["gemeenten", "gemeenten", null, "readMunicipalities"],
  ["werfadministratie", "werfadministratie", null, "wadm"],
  ["boetes", "beheer", "beheer/voertuigen", "readTrips"],
  ["team", "team", null, "readTeam"],
  ["codes", "beheer", "beheer/toegang", "inviteExternal"],
  ["onderaannemers", "adresboek", "adresboek", "readOa"],
  ["organisaties", "adresboek", "adresboek", "readOa"],
  ["audit", "beheer", "beheer/audit", "readAudit"],
  ["postbode", "beheer", "beheer/mail", "manageRobots"],
  ["instellingen", "beheer", "beheer/bedrijf", "manageSettings"],
  ["login", "login", null, "any"],
  ["week", "week", null, "home=week"],
  ["uren", "uren", null, "home=week"],
  ["mijn-offerte", "mijn-offerte", null, "myQuotes"],
  ["mijn-vordering", "mijn-vordering", null, "myProgress"],
  ["mijn-facturen", "mijn-facturen", null, "myOaInvoices"],
  ["adresboek", "adresboek", null, "readOa"],
  ["verslag", "verslag", null, "writeReports"],
  ["werfstart", "werfstart", null, "workStarts"],
];

/** 2b.4: het startpunt (Aan de slag, Zo werkt het voor jou, blokken per rol, Vraagt aandacht, de bel; src/frontend/src/app/start.ts). */
export const loadStart = () => load("start.ts");
