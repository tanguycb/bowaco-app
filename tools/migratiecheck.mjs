// Migratiecheck (M7, M11): bewijst dat het nieuwe programma kan upgraden vanaf het programma van de
// vorige gelande draft, met data én leeg. Alleen op het EIGEN testnet (~/.bowaco/net, poort 8041).
//   OUD=<pad naar backend.wasm van de vorige draft> node tools/migratiecheck.mjs
//   ZONDER_DATA=1 …   enkel (1)
//   OUD_REPO=<map met de code van de vorige draft> …   als de interface veranderde (1.1): de rollentest en
//                     de telling vóór de upgrade draaien dan met de code (en .did) van de vorige draft,
//                     bv. `git archive <commit> | tar -x -C <map>` + een symlink tools/node_modules.
// Stappen: (1) oud leeg → nieuw; (2) oud + rollentest-data → nieuw; tellingen uit exportIntern vóór/na gelijk.
// Bij 0.6 bestaat er nog geen vorige draft op de nieuwe keten: dan enkel (0) verse installatie.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { backend, KEYDIR } from "./lib.mjs";

const net = join(KEYDIR, "net");
const repo = join(import.meta.dirname, "..");
const nieuw = join(repo, "src/backend/dist/backend.wasm");
const oud = process.env.OUD;
process.env.ICP_HOST = "http://localhost:8041";
const icp = (...a) => execFileSync("icp", a, { cwd: net, env: process.env, encoding: "utf8" });
const cid = () => JSON.parse(readFileSync(join(net, ".icp/cache/mappings/local.ids.json"), "utf8")).backend;
const oudRepo = process.env.OUD_REPO;
// Telling met de code van de vorige draft (oude .did): `node <OUD_REPO>/tools/telling.mjs <cid>`.
const tellingOud = () => {
  const e = JSON.parse(execFileSync("node", [join(oudRepo, "tools/telling.mjs"), cid()], { env: process.env, encoding: "utf8" }));
  return { personen: e.personen, koppelingen: e.koppelingen, codes: e.codes, organisaties: e.organisaties, werven: e.werven, leden: e.leden, bestanden: e.bestanden, audit: e.audit };
};
const telling = async () => {
  const e = await (await backend("proef-admin", cid())).exportIntern();
  return { personen: e.persons.length, koppelingen: e.links.length, codes: e.invites.length, organisaties: e.orgs.length, werven: e.works.length, leden: e.memberships.length, bestanden: e.files.length, audit: Number(e.auditCount) };
};

if (!oud) {
  process.env.WASM = nieuw;
  icp("deploy", "backend", "--mode", "reinstall", "-y");
  console.log("(0) verse installatie van de nieuwe keten: OK (geen vorige draft om van te upgraden)");
  process.exit(0);
}
if (!existsSync(oud)) throw new Error(`OUD bestaat niet: ${oud}`);
process.env.WASM = oud;
icp("deploy", "backend", "--mode", "reinstall", "-y");
process.env.WASM = nieuw;
icp("deploy", "backend", "--mode", "upgrade", "-y");
console.log("(1) oud leeg → nieuw: OK");
if (process.env.ZONDER_DATA) process.exit(0); // (2) dan op de draft zelf: tools/telling.mjs voor en na
process.env.WASM = oud;
icp("deploy", "backend", "--mode", "reinstall", "-y");
execFileSync("node", [join(oudRepo ?? repo, "tests/rollen.mjs"), cid()], { env: { ...process.env, ZONDER_KLOK: "1" }, stdio: "ignore" });
const voor = oudRepo ? tellingOud() : await telling();
process.env.WASM = nieuw;
icp("deploy", "backend", "--mode", "upgrade", "-y");
const na = await telling();
const gelijk = JSON.stringify(voor) === JSON.stringify({ ...na, audit: voor.audit });
console.log(`(2) oud met data → nieuw: ${gelijk ? "GELIJK" : "VERSCHIL"}`, JSON.stringify(voor), "→", JSON.stringify(na));
process.exit(gelijk ? 0 : 1);
