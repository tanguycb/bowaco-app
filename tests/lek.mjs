// Lektestrobot (architectuur §9.3): roept ELKE functie uit de .did aan met ELKE rol en vergelijkt
// met de verwachting in de tabel hieronder. Een functie zonder regel in de tabel = rood.
// Draait na tests/rollen.mjs op dezelfde canister (gebruikt diens werven, bestanden en voorstellen).
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/lek.mjs <canister-id>
//   draft:   node tests/lek.mjs <canister-id>
// "Toegelaten" = geen trap en geen #err die met "Geen toegang" begint. De argumenten zijn zo gekozen
// dat wie toegelaten is, daarna op een gewone invoerfout botst: de test verandert (bijna) niets.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, Principal } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/lek.mjs <canister-id>");
const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
const methods = [...did.slice(did.indexOf("service")).matchAll(/^\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*:/gm)].map((m) => m[1]);

const admin = await backend("proef-admin", cid);
const roles = {
  anoniem: await backend(null, cid),
  ongekoppeld: await freshBackend(cid),
  wacht: await backend("proef-nieuw", cid),
  admin,
  werfleider: await backend("proef-werfleider", cid),
  calculator: await backend("proef-calculator", cid),
  architect: await backend("proef-architect", cid),
  oa: await backend("proef-oa2", cid),
  klant: await backend("proef-klant", cid),
  veiligheid: await backend("proef-vc", cid),
  robot: await backend("robot-test", cid),
};
await admin.addRobot(identity("robot-test").getPrincipal(), "Proefrobot", ["proef"]).catch(() => {});

// Gegevens uit de rollentest
const works = await admin.listWorks();
const A = works.find((w) => w.code === "P-A").id;
const B = works.find((w) => w.code === "P-B").id;
const ex = await admin.exportIntern();
const ended = ex.memberships.find((m) => m.endedAt.length === 1);
const file = ex.files.find((f) => !f.confidential);
const decided = ex.proposals.find((p) => p.decision.length === 1);
if (!ended || !file || !decided) throw new Error("eerst tests/rollen.mjs draaien op deze canister");
const X = 999_999n;
const someone = identity("proef-lek-onbekend").getPrincipal();
const hash = "sha256:" + "c".repeat(64);
const blob = new TextEncoder().encode("!caf!sha256:" + "c".repeat(64));
const invReq = { name: "", roles: [{ onderaannemer: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [A], validDays: 0n, tag: "" };
const orgIn = { kind: { other: null }, name: "", kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "" };
const addr = { street: "", number: "", zip: "", city: "", country: "" };
const workIn = { code: "", name: "", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n };
const personUpd = { name: "", roles: [], orgId: [], shortCode: [], lang: [], phone: [] };

// Wie mag wat (R1–R34 zoals gebouwd in 0.6). Groepen:
const ALL = Object.keys(roles);
const AUTH = ALL.filter((r) => r !== "anoniem");
const ACTIVE = ["admin", "werfleider", "calculator", "architect", "oa", "klant", "veiligheid"];
const INTERNAL = ["admin", "werfleider", "calculator"];
const ADMIN = ["admin"];
const NONE = [];
const ON_B = ["admin", "werfleider", "calculator", "oa"]; // werf B: interne rollen + OA Dak (lid van B)

const table = {
  me: [ALL, () => []],
  _initialize_access_control: [ALL, () => []],
  claimBootstrap: [AUTH, () => ["BOW-0000-0000-0000-0000", "x"]],
  redeemCode: [AUTH, () => ["BOW-0000-0000-0000"]],
  invitePerson: [["admin", "werfleider"], () => [invReq]],
  createRecoveryCode: [ADMIN, () => [X, 0n, ""]],
  confirmLink: [ADMIN, () => [someone]],
  revokeLink: [ADMIN, () => [someone]],
  setLinkLabel: [ADMIN, () => [someone, ""]],
  revokeInvite: [["admin", "werfleider"], () => [X]],
  listInvites: [["admin", "werfleider"], () => [0n, 1n]],
  listLinks: [ADMIN, () => []],
  accessStats: [ADMIN, () => []],
  listPersons: [INTERNAL, () => [false]],
  updatePerson: [ADMIN, () => [X, personUpd]],
  archivePerson: [ADMIN, () => [X]],
  restorePerson: [ADMIN, () => [X]],
  listOrgs: [INTERNAL, () => [false]],
  createOrg: [["admin", "werfleider"], () => [orgIn]],
  updateOrg: [["admin", "werfleider"], () => [X, orgIn]],
  archiveOrg: [ADMIN, () => [X]],
  setOrgConfidential: [["admin", "calculator"], () => [X, [], ""]],
  readOrgConfidential: [["admin", "calculator"], () => [X]],
  listWorks: [ACTIVE, () => []],
  getWork: [ON_B, () => [B]],
  createWork: [["admin", "werfleider"], () => [workIn]],
  setWorkStatus: [["admin", "werfleider"], () => [B, { planned: null }]],
  listMembers: [ON_B, () => [B]],
  addMembership: [["admin", "werfleider"], () => [B, [], [], { onderaannemer: null }, []]],
  endMembership: [["admin", "werfleider"], () => [ended.id]],
  getSettings: [INTERNAL, () => []],
  setSettings: [ADMIN, () => [{ werfleiderZietAlles: true, inviteDays: 0n }]],
  listRobots: [ADMIN, () => []],
  addRobot: [ADMIN, () => [Principal.anonymous(), "", []]],
  revokeRobot: [ADMIN, () => [someone]],
  auditLog: [ACTIVE, () => [0n, 1n]],
  auditCount: [ADMIN, () => []],
  myNotifications: [ACTIVE, () => [true]],
  markNotificationsRead: [ACTIVE, () => [[]]],
  exportIntern: [ADMIN, () => []],
  exportConfidential: [ADMIN, () => []],
  addFile: [ON_B, () => ["", "image/jpeg", 0n, blob, [B], false]],
  listFiles: [ON_B, () => [[B]]],
  readConfidentialFile: [["admin", "calculator"], () => [X]],
  archiveFile: [ADMIN, () => [file.id]],
  createTicket: [INTERNAL, () => ["onbekend", []]],
  checkTicket: [["robot"], () => ["TK-0"]],
  submitProposal: [["robot"], () => [X, "", ""]],
  myProposals: [ACTIVE, () => []],
  decideProposal: [["admin", "werfleider"], () => [decided.id, true, ""]],
  // Opslag (StorageGate.mo). De poort: alleen actieve personen met een uploadrecht.
  _immutableObjectStorageCreateCertificate: [["admin", "werfleider", "calculator", "oa", "veiligheid"], () => [hash]],
  _immutableObjectStorageBlobsAreLive: [ALL, () => [[]]],
  _immutableObjectStorageBlobsToDelete: [NONE, () => []],
  _immutableObjectStorageConfirmBlobDeletion: [NONE, () => [[]]],
  _immutableObjectStorageRefillCashier: [NONE, () => [[]]],
  // Ongewijzigd van Caffeine: iedereen mag de gatewaylijst laten verversen (één call naar de kassier).
  // Lokaal trapt hij altijd (geen kassier); daarom niet vergeleken. Open punt voor de review (0.7).
  _immutableObjectStorageUpdateGatewayPrincipals: [null, () => []],
};

async function allowed(fn, args) {
  try {
    const r = await fn(...args);
    return !(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err));
  } catch {
    return false;
  }
}

let leaks = 0;
let tooStrict = 0;
let missing = 0;
let calls = 0;
const rows = [];
for (const m of methods) {
  const entry = table[m];
  if (!entry) {
    missing++;
    console.log(`✗ ${m}: geen regel in de tabel (nieuwe functie?)`);
    continue;
  }
  const [expect, args] = entry;
  if (expect === null) {
    console.log(`· ${m}: niet vergeleken (zie opmerking in de tabel)`);
    continue;
  }
  const got = [];
  // admin als laatste: zijn oproep mag iets veranderen (archiveFile).
  for (const role of [...ALL.filter((r) => r !== "admin"), "admin"]) {
    calls++;
    const ok = await allowed(roles[role][m], args());
    if (ok) got.push(role);
    const want = expect.includes(role);
    if (ok && !want) {
      leaks++;
      console.log(`✗ LEK ${m} door ${role}`);
    } else if (!ok && want) {
      tooStrict++;
      console.log(`✗ te streng: ${m} voor ${role}`);
    }
  }
  rows.push({ m, expect, got });
}
for (const k of Object.keys(table)) if (!methods.includes(k)) console.log(`· tabelregel zonder functie: ${k}`);
console.log(`\n${methods.length} functies × ${ALL.length} rollen = ${calls} oproepen`);
console.log(`onverwachte toegang (lek): ${leaks} · te streng: ${tooStrict} · functies zonder regel: ${missing}`);
writeFileSync(join(import.meta.dirname, ".laatste-lek.json"), JSON.stringify({ cid, at: new Date().toISOString(), functions: methods.length, calls, leaks, tooStrict, missing, rows }, null, 1));
process.exit(leaks || tooStrict || missing ? 1 : 0);
