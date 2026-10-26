// Laadt het menu van de app (src/frontend/src/app/nav.ts, zuivere functies) in node: gebundeld met esbuild uit het
// project zelf, zonder React of browser. Gebruikt door tests/rollen.mjs (menu per rol) en tests/menu.mjs.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(repo, "package.json"));

export async function loadNav() {
  const esbuild = require(join(repo, "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild"));
  const out = join(mkdtempSync(join(tmpdir(), "bowaco-nav-")), "nav.mjs");
  await esbuild.build({ entryPoints: [join(repo, "src/frontend/src/app/nav.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent" });
  return import(pathToFileURL(out).href);
}

/** De 21 menu-items van de beheerder tot en met draft 49, de oude adressen en wat ze nu openen (tabel oud → nieuw). */
export const OUD_NAAR_NIEUW = [
  // [oude route, scherm dat opent, nieuw adres waarnaar de adresbalk doorverwijst (of null), minimale cap]
  ["overzicht", "overzicht", null, "home=overzicht"],
  ["vandaag", "vandaag", null, "writeReports"],
  ["werven", "werven", null, "any"],
  ["weekbord", "weekbord", null, "readOrgPlanning"],
  ["dashboard", "dashboard", null, "readOrgPlanning"],
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
