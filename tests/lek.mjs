// Lektestrobot (architectuur §9.3): roept ELKE functie uit de .did aan met ELKE rol en vergelijkt
// met de verwachting in de tabel hieronder. Een functie zonder regel in de tabel = rood.
// Draait na tests/rollen.mjs op dezelfde canister (gebruikt diens werven, bestanden en voorstellen).
//   lokaal:  ICP_HOST=http://localhost:8041 node tests/lek.mjs <canister-id>
//   draft:   node tests/lek.mjs <canister-id>
// "Toegelaten" = geen trap en geen #err die met "Geen toegang" begint. De argumenten zijn zo gekozen
// dat wie toegelaten is, daarna op een gewone invoerfout botst: de test verandert (bijna) niets.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, freshBackend, identity, ok, Principal } from "../tools/lib.mjs";

const cid = process.argv[2];
if (!cid) throw new Error("gebruik: node tests/lek.mjs <canister-id>");
const did = readFileSync(join(import.meta.dirname, "../src/backend/dist/backend.did"), "utf8");
const methods = [...did.slice(did.indexOf("service")).matchAll(/^ {2}"?([A-Za-z_][A-Za-z0-9_]*)"?\s*:/gm)].map((m) => m[1]);

const admin = await backend("proef-admin", cid);
// Eigen wachtende testkoppeling (interne rol, niet bevestigd); op het einde weer afgesloten. Enkel lokaal
// (of met LEK_WACHT=1): op een draft stuurt elke wachtende koppeling een melding naar ALLE admins, ook de
// eigenaar (C4, testlijst 1.3). De rollentest bewijst lokaal dat een wachtende koppeling niets kan.
const host = process.env.ICP_HOST || "";
const metWacht = host.includes("localhost") || host.includes("127.0.0.1") || process.env.LEK_WACHT === "1";
const wacht = metWacht ? await freshBackend(cid) : null;
const wachtInv = metWacht ? ok(await admin.invitePerson({ name: "Proef Wacht (lektest)", roles: [{ calculator: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [], validDays: 1n, tag: "lektest" })) : null;
if (metWacht) ok(await wacht.redeemCode(wachtInv.code));
const roles = {
  anoniem: await backend(null, cid),
  ongekoppeld: await freshBackend(cid),
  ...(metWacht ? { wacht } : {}),
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
const doc = ex.documents.find((d) => d.kind === "vgplan" && d.archivedAt.length === 0);
const docGone = ex.documents.find((d) => d.archivedAt.length === 1);
const taskB = ex.tasks.find((t) => t.workId === B && t.archivedAt.length === 0);
const asgB = ex.assignments.find((a) => a.workId === B && a.archivedAt.length === 0);
const blkGone = ex.calendarBlocks.find((b) => "company" in b.scope && b.archivedAt.length === 1);
if (!ended || !file || !decided || !doc || !docGone || !taskB || !asgB || !blkGone) throw new Error("eerst tests/rollen.mjs draaien op deze canister");
const X = 999_999n;
const someone = identity("proef-lek-onbekend").getPrincipal();
const hash = "sha256:" + "c".repeat(64);
const blob = new TextEncoder().encode("!caf!sha256:" + "c".repeat(64));
const invReq = { name: "", roles: [{ onderaannemer: null }], orgId: [], shortCode: [], lang: [], phone: [], workIds: [A], validDays: 0n, tag: "" };
const orgIn = { kind: { other: null }, name: "", kbo: [], vat: [], aliases: [], trades: [], address: [], notes: "" };
const addr = { street: "", number: "", zip: "", city: "", country: "" };
const workIn = { code: "", name: "", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n };
const workUpd = { code: "", name: "", address: addr, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: 600n, plannedStart: [], plannedEnd: [], analyticCode: [], vatNote: "" };
const badContract = { contract: { estimatedAmountCents: [], priceRevision: { none: null }, guarantee: { retention: null }, guaranteeBp: 9999n, paymentTermDays: 0n, invoicingRhythm: { monthly: null }, signedQuoteVersionId: [], note: "" }, clientContact: [], notes: "" };
const docIn = { id: [], kind: "bestaat-niet", title: "", dueDay: [], validUntil: [], note: "", ownerOrgId: [] };
const kindIn = { key: "", name: "", rule: "altijd", deliverer: "bowaco", oaVisible: false, confidential: false, order: 0n, archived: false };
const oaFilterIn = { text: [], trade: [], kind: [], includeArchived: false };
const contactIn = { phone: [], email: [], website: [], contactNote: "" };
const oaPersonIn = { id: [], name: "", shortCode: [], phone: [], email: [], jobTitle: "", note: "" };
const tradeIn = { key: "", name: "", order: 0n, archived: false };
const taskIn = { id: [], title: "", note: "", kind: { work: null }, trade: [], responsibleOrgId: [], status: { planned: null }, percent: 0n, start: 0n, workdays: 0n, leadDays: 0n, orderDay: [], reason: "" };
const depIn = { fromTaskId: X, toTaskId: X, kind: { finishToStart: null }, lagDays: 0n };
const asgIn = { id: [], taskId: X, orgId: X, personId: [], fromDay: [], toDay: [], note: "" };
const blockIn = { id: [], scope: { company: null }, kind: { feestdag: null }, from: 20_000n, to: 20_000n, reason: "" };
const tplIn = { key: "", name: "", steps: [], provisional: true, archived: false };
const personUpd = { name: "", roles: [], orgId: [], shortCode: [], lang: [], phone: [] };

// Wie mag wat (R1–R34 zoals gebouwd in 0.6 en 1.1). Groepen:
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
  // 1.1 werffiche en contract (R4, R23, R27): contract enkel admin en calculator, nooit de werfleider-rol zelf
  updateWork: [["admin", "werfleider"], () => [B, workUpd]],
  readContract: [["admin", "calculator"], () => [B]],
  setContract: [["admin", "calculator"], () => [B, badContract, 999n]],
  readContractHistory: [["admin", "calculator"], () => [B]],
  // 1.1 documenten (R10, R11): lezen per werf, beheren admin/werfleider, soorten enkel admin
  getDossier: [ON_B, () => [B]],
  saveDocument: [["admin", "werfleider"], () => [B, docIn]],
  attachDocumentFile: [ON_B, () => [B, "andere", [], X]], // daarna "onbekend bestand"; leveren zelf: rollentest
  setDocumentStatus: [["admin", "werfleider"], () => [doc.id, { approved: null }, doc.note]],
  archiveDocument: [["admin", "werfleider"], () => [docGone.id]],
  listDocKinds: [INTERNAL, () => [false]],
  setDocKind: [ADMIN, () => [kindIn]],
  // 1.2 onderaannemers-database: lezen interne rollen (R19), beheren admin en werfleider, vakgebieden en import enkel admin (R32)
  listOas: [INTERNAL, () => [oaFilterIn]],
  getOa: [INTERNAL, () => [X]],
  saveOrgContact: [["admin", "werfleider"], () => [X, contactIn]],
  saveOaPerson: [["admin", "werfleider"], () => [X, oaPersonIn]],
  listTrades: [INTERNAL, () => [false]],
  setTrade: [ADMIN, () => [tradeIn]],
  importOrgs: [ADMIN, () => [true, []]],
  // 1.3 planning per werf: lezen wie de werf ziet (OA: eigen taken), plannen admin en werfleider (R5),
  // bevestigen enkel de OA met #confirmPlanning (R6), bedrijfskalender en sjablonen enkel admin (R17).
  getPlan: [ON_B, () => [B]],
  previewPlan: [["admin", "werfleider"], () => [B, { reflow: null }]],
  applyPlan: [["admin", "werfleider"], () => [B, { reflow: null }, 999n, ""]],
  saveTask: [["admin", "werfleider"], () => [B, taskIn, 999n]],
  archiveTask: [["admin", "werfleider"], () => [B, X, 999n]],
  setTaskOrder: [["admin", "werfleider"], () => [B, [], 999n]],
  addDependency: [["admin", "werfleider"], () => [B, depIn, 999n]],
  removeDependency: [["admin", "werfleider"], () => [B, X, 999n]],
  previewDependency: [["admin", "werfleider"], () => [B, depIn]],
  saveAssignment: [["admin", "werfleider"], () => [B, asgIn, 999n]],
  archiveAssignment: [["admin", "werfleider"], () => [B, X, 999n]],
  confirmAssignment: [["oa"], () => [asgB.id, false, ""]], // daarna "geef een reden": er verandert niets
  orgAssignments: [ACTIVE, () => [[], 20_000n, 20_010n]],
  listCalendarBlocks: [INTERNAL, () => [[]]],
  saveCalendarBlock: [ADMIN, () => [blockIn]],
  archiveCalendarBlock: [ADMIN, () => [blkGone.id]],
  listTemplates: [INTERNAL, () => []],
  saveTemplate: [ADMIN, () => [tplIn]],
  applyTemplate: [["admin", "werfleider"], () => [B, "bestaat-niet", 20_000n, false, 999n]],
  taskHistory: [INTERNAL, () => [B, [], 0n, 1n]],
  getSettings: [INTERNAL, () => []],
  setSettings: [ADMIN, () => [{ werfleiderZietAlles: true, inviteDays: 0n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n }]],
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
// Opruimen: de eigen wachtende koppeling afsluiten, zodat niemand ze later per vergissing bevestigt.
if (metWacht) ok(await admin.archivePerson(wachtInv.personId));
const left = (await admin.listLinks()).filter((l) => "pending" in l.status);
if (left.length) {
  missing++;
  console.log(`✗ na de lektest wachten nog ${left.length} koppelingen: ${left.map((l) => l.personName).join(", ")}`);
}
console.log(`\n${methods.length} functies × ${ALL.length} rollen = ${calls} oproepen`);
console.log(`onverwachte toegang (lek): ${leaks} · te streng: ${tooStrict} · functies zonder regel: ${missing}`);
writeFileSync(join(import.meta.dirname, ".laatste-lek.json"), JSON.stringify({ cid, at: new Date().toISOString(), functions: methods.length, calls, leaks, tooStrict, missing, rows }, null, 1));
process.exit(leaks || tooStrict || missing ? 1 : 0);
