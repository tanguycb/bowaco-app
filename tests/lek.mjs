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
import { connect, rpc, tool as mcpTool } from "./mcp-lib.mjs";

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
  // 3.13: een bot (eigen Internet Identity, GEEN persoon) met een minimale fiche: enkel mijn_fiche, geen werven, geen soorten.
  bot: await backend("proef-bot-lek", cid),
};
if (!("bot" in (await roles.bot.myBot()))) {
  const bid = ok(await admin.saveBot({ id: [], rev: 0n, name: "Proef bot (lektest)", vendor: "Proef", model: "", tools: ["mijn_fiche"], allWorks: false, works: [], docKinds: [], callsPerDay: 500n, tasks: [], instruction: [] }));
  ok(await roles.bot.claimBotCode(ok(await admin.newBotCode(bid)).code));
}
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
const orgDak = ex.orgs.find((o) => o.name === "Proef Dak NV");
const absGone = ex.absences.find((a) => a.archivedAt.length === 1 && "intern" in a.source && a.orgId === orgDak?.id);
const repA = ex.dayReports?.find((r) => r.workId === A);
const issDone = ex.issues?.find((i) => "handled" in i.status);
const attDak = ex.attendances?.find((a) => a.orgId[0] === orgDak?.id && a.archivedAt.length === 0);
// een OA kan ook als PERSOON lid zijn met dat recht (draft 57: de rollentest gaf proef-oa2 het zo); dan is "toegelaten" juist
const oaPersonId = (await roles.oa.me()).person[0]?.id;
const dakMayConfirm = !!attDak && ex.memberships.some((m) => m.workId === attDak.workId && m.endedAt.length === 0 && "onderaannemer" in m.role && (m.orgId[0] === orgDak?.id || m.personId[0] === oaPersonId) && m.grants.some((g) => "confirmHours" in g));
const memDakB = ex.memberships.find((m) => m.workId === B && "onderaannemer" in m.role && m.personId.length === 1 && m.endedAt.length === 0);
// 1b.1: een lopende vergunning op B en een gearchiveerde (rollentest of tests/vergunning-draft.mjs)
const pmB = ex.permits?.find((x) => x.workId === B && x.archivedAt.length === 0);
const pmGone = ex.permits?.find((x) => x.archivedAt.length === 1);
if (!pmB || !pmGone) throw new Error("eerst tests/rollen.mjs (lokaal) of tests/vergunning-draft.mjs (draft) draaien: geen vergunningen");
if (!ended || !file || !decided || !doc || !docGone || !taskB || !asgB || !blkGone || !orgDak || !absGone || !repA || !issDone || !attDak || !memDakB) throw new Error("eerst tests/rollen.mjs draaien op deze canister");
const X = 999_999n;
// 2c.2: de prijsvraag van de rollentest op P-B (open, Proef Dak NV gevraagd en ingediend) en de geannuleerde.
const tOpen = ex.tenders?.find((x) => x.title === "Proef prijsvraag rollentest");
const tGone = ex.tenders?.find((x) => x.title === "Proef prijsvraag rollentest (geannuleerd)");
const invOpen = ex.tenderInvites?.find((i) => tOpen && i.tenderId === tOpen.id);
const invGone = ex.tenderInvites?.find((i) => tGone && i.tenderId === tGone.id);
const oaq = ex.oaQuotes?.find((q) => tOpen && q.tenderId[0] === tOpen.id);
if (!tOpen || !tGone || !invOpen || !invGone || !oaq) throw new Error("eerst tests/rollen.mjs draaien op deze canister (geen prijsvraag)");
// Review L10: een OA-factuur (2.11 of een werfdeel) uit de rollentest.
const oaInv = ex.oaInvoices?.find((i) => !("withdrawn" in i.status));
if (!oaInv) throw new Error("eerst tests/rollen.mjs draaien op deze canister (geen OA-factuur)");
const draftIn = { number: "N".repeat(41), quoteDay: [], validUntil: [], discountBp: [], reverse: true, lines: [], remark: "" };
const wsIn = { target: { existing: null }, startDay: 0n, templateKey: "", leaderPersonId: [], lineSteps: [], options: [], groupDays: [], skipPermits: [], declaration: true };
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
const boardIn = { from: 20_000n, weeks: 1n, offset: 0n, limit: 1n, text: "", trade: [], workId: [], onlyConflicts: false, withIdle: false };
const absenceIn = { id: [], orgId: X, personId: [], kind: { verlof: null }, from: 20_000n, to: 20_000n, note: "" };
const impBlock = { key: "lek", name: "Lek", street: "", number: "", zip: "", city: "", vatBp: 600n, decision: { fresh: null }, tasks: [] };
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
  // 1.9 (R28): een robotprincipal is nooit een persoon, dus ook geen code.
  claimBootstrap: [AUTH.filter((r) => r !== "robot" && r !== "bot"), () => ["BOW-0000-0000-0000-0000", "x"]],
  redeemCode: [AUTH.filter((r) => r !== "robot" && r !== "bot"), () => ["BOW-0000-0000-0000"]],
  // 3.4 + 3.13: bots via MCP. De HTTP-ingang is voor iedereen (de OAuth- en MCP-laag beslist, zie hieronder); goedkeuren enkel een
  // gekoppelde bot; de koppelcode gebruiken elke ingelogde identiteit behalve een robot (een persoon of bot krijgt een invoerfout);
  // beheer enkel de beheerder (#manageBots).
  http_request: [ALL, () => [{ method: "GET", url: "/bestaat-niet", headers: [], body: new Uint8Array(), certificate_version: [] }]],
  http_request_update: [ALL, () => [{ method: "GET", url: "/bestaat-niet", headers: [], body: new Uint8Array(), certificate_version: [] }]],
  _caffeineMcpSignInOrigin: [ALL, () => []],
  _caffeineMcpClient: [ALL, () => ["bestaat-niet"]],
  _caffeineMcpApprove: [["bot"], () => [{ clientId: "bestaat-niet", redirectUri: "https://x.example/cb", codeChallenge: "c".repeat(43), codeChallengeMethod: "S256" }]],
  _caffeineMcpSetSignInOrigin: [ADMIN, () => ["https://x.example/ongeldig-pad"]],
  myBot: [ALL, () => []],
  claimBotCode: [AUTH.filter((r) => r !== "robot"), () => ["BOT-0000-0000-0000-0000"]],
  mcpInfo: [ADMIN, () => []],
  listBots: [ADMIN, () => []],
  saveBot: [ADMIN, () => [{ id: [X], rev: 0n, name: "", vendor: "", model: "", tools: [], allWorks: false, works: [], docKinds: [], callsPerDay: 0n, tasks: [], instruction: [] }]],
  newBotCode: [ADMIN, () => [X]],
  revokeBot: [ADMIN, () => [X]],
  botConnections: [ADMIN, () => [X]],
  // 3.12: de toegelaten toepassingen (terugkeeradressen) enkel de beheerder; een ongeldig adres = een invoerfout (er verandert niets).
  setMcpRedirectHosts: [ADMIN, () => [["https://x.example/pad"]]],
  revokeBotConnection: [ADMIN, () => [X, ""]],
  botActions: [ADMIN, () => [true]],
  decideBotAction: [ADMIN, () => [X, false, ""]],
  undoBotAction: [ADMIN, () => [X]],
  botLog: [ADMIN, () => [0n, 1n]],
  // 3.5: de proefbank, enkel de beheerder (#manageBots). Een bot krijgt de gevallen enkel via /mcp (proeftools, zie hieronder).
  proofInfo: [ADMIN, () => []],
  listProofSets: [ADMIN, () => []],
  proofSetCases: [ADMIN, () => [X]],
  listProofRounds: [ADMIN, () => []],
  proofRoundCases: [ADMIN, () => [X]],
  buildProofSet: [ADMIN, () => ["bestaat-niet", "x", 1n]],
  archiveProofSet: [ADMIN, () => [X]],
  startProofRound: [ADMIN, () => [X, { bot: X }]],
  closeProofRound: [ADMIN, () => [X, false]],
  runProofAi: [ADMIN, () => [X]],
  // 3.8: de bestanden van een testset met OA-offertes (enkel de beheerder).
  proofContentNeeds: [ADMIN, () => [X]],
  loadProofContent: [ADMIN, () => [X, 1n, new Uint8Array()]],
  // 3.8: OA-offerte inlezen (kantoor met de bedragen: admin en calculator; het voorstel enkel via readOaRead, update-call met
  // auditregel). De invoer is telkens ongeldig (lege inhoud, onbekende opdracht): geen wijziging.
  startOaRead: [["admin", "calculator"], () => [{ workId: B, orgId: X, inviteId: [], way: { ai: null }, name: "x", mime: "text/plain", content: new Uint8Array(), blob: [] }]],
  listOaReads: [["admin", "calculator"], () => [B]],
  listOaReadBots: [["admin", "calculator"], () => [B]],
  oaReadAiReady: [["admin", "calculator"], () => []],
  readOaRead: [["admin", "calculator"], () => [X]],
  runOaReadAi: [["admin", "calculator"], () => [X]],
  finishOaRead: [["admin", "calculator"], () => [X, { cancelled: null }]],
  applyOaRead: [["admin", "calculator"], () => [X, { inviteId: [], workId: B, orgId: X, source: { hand: null }, sheetKey: "", number: "", quoteDay: 0n, validUntil: [], discountBp: [], reverse: true, prices: { total: 0n }, remark: "", note: "", file: [] }, 0n]],
  // 3.10: OA-factuurcontrole (kantoor met het volle zicht op de OA-facturen: admin en calculator; het resultaat enkel via
  // readInvCheck, update-call met auditregel). De invoer is telkens ongeldig (lege inhoud): geen wijziging.
  startInvCheck: [["admin", "calculator"], () => [{ invoiceId: oaInv.id, way: { ai: null }, name: "x", mime: "text/plain", content: new Uint8Array() }]],
  listInvChecks: [["admin", "calculator"], () => [oaInv.id]],
  listInvCheckBots: [["admin", "calculator"], () => [B]],
  invCheckAiReady: [["admin", "calculator"], () => []],
  // Een onbekende opdracht: voor iedereen "Geen toegang" (geen id-orakel).
  readInvCheck: [NONE, () => [X]],
  runInvCheckAi: [NONE, () => [X]],
  finishInvCheck: [NONE, () => [X, { cancelled: null }]],
  // 3.9 + 3.11: nakijkopdrachten (kantoor met de prijzen; een onbekend doel of een onbekende opdracht: voor iedereen "Geen toegang").
  startAiCheck: [NONE, () => [{ target: { tender: X }, way: { ai: null } }]],
  listAiChecks: [NONE, () => [{ quote: X }]],
  listAiCheckBots: [NONE, () => [{ tender: X }]],
  aiCheckAiReady: [["admin", "calculator"], () => ["vergelijking"]],
  readAiCheck: [NONE, () => [X]],
  runAiCheckAi: [NONE, () => [X]],
  finishAiCheck: [NONE, () => [X, { cancelled: null }]],
  applyTenderCheck: [NONE, () => [X, [], X]],
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
  orgWorks: [INTERNAL, () => [X]], // 2b.1: werven van een firma (firmafiche)
  createOrg: [["admin", "werfleider"], () => [orgIn]],
  updateOrg: [["admin", "werfleider"], () => [X, orgIn]],
  archiveOrg: [ADMIN, () => [X]],
  setOrgConfidential: [["admin", "calculator"], () => [X, [], ""]],
  readOrgConfidential: [["admin", "calculator"], () => [X]],
  listWorks: [ACTIVE, () => []],
  listWorkStages: [ACTIVE, () => []], // 2b.3: stand van de werf (enkel momenten en vlaggen; zelfde werven als listWorks)
  // 2b.4: het startpunt (settings.values): lezen en het eigen Begrepen mag elke actieve persoon; Aan de slag bewaren enkel de beheerder
  startState: [ACTIVE, () => []],
  markIntroSeen: [ACTIVE, () => []],
  setStartStep: [ADMIN, () => ["bestaat-niet", true]],
  setStartHidden: [ADMIN, () => [false]],
  // 2b.6: "nog na te kijken" per werf (settings.values): lezen mag elke actieve persoon (een niet-interne krijgt een lege
  // lijst), zetten of wissen enkel de beheerder
  workReviewNotes: [ACTIVE, () => []],
  setWorkReviewNote: [ADMIN, () => [B, ""]],
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
  // 1.4 weekbord: intern (#readOrgPlanning); afwezigheden ingeven admin en werfleider (een OA enkel voor zijn
  // eigen firma: hier een onbekende firma → geweigerd); "Mijn week" voor elke actieve persoon (leeg als hij
  // geen OA is); de geschiedenis van een firma: intern + de OA van die firma; regels enkel admin.
  weekBoard: [INTERNAL, () => [boardIn]],
  boardConflicts: [INTERNAL, () => [20_000n, 1n, 1n]],
  workConflicts: [INTERNAL, () => [B, 20_000n, 1n]],
  myBoard: [ACTIVE, () => [20_000n, 1n]],
  listAbsences: [INTERNAL, () => [[], 20_000n, 20_010n]],
  saveAbsence: [["admin", "werfleider"], () => [absenceIn]],
  archiveAbsence: [["admin", "werfleider"], () => [absGone.id]], // gearchiveerd, van kantoor: daarna "bestaat niet meer"
  absenceHistory: [[...INTERNAL, "oa"], () => [orgDak.id, 0n, 1n]],
  boardRules: [INTERNAL, () => []],
  setBoardRules: [ADMIN, () => [{ unit: "x", defaultMax: 1n, oaReportsAbsence: true }]],
  setCapacity: [ADMIN, () => ["x", [1n], ""]],
  // 1.5 import van de bestaande planning: enkel admin (R32); afspraken lezen: interne rollen die de werf zien
  importPlanning: [ADMIN, () => [true, "lek", "Lektest", [], impBlock]],
  rollbackImport: [ADMIN, () => ["bestaat-niet", true]],
  listImportBatches: [ADMIN, () => []],
  listAppointments: [INTERNAL, () => [B]],
  // 1.6 werfverslag: schrijven admin en werfleider (R7, poort #reportWriter; per werf #writeReport); lezen per rol
  // (R8): werf B = interne rollen + OA Dak (enkel zijn uren); verslag op A ook architect (grant) en klant
  // (samenvatting), niet de veiligheidscoördinator zonder grant; de lijst niet voor een OA; ritten R14; voertuigen.
  reportSync: [["admin", "werfleider"], () => [[{ opId: "lek-opdracht-1", clientKey: "lek-sleutel-1", op: { ensure: { workId: B, day: 1n } } }]]], // daarna "voorbije 60 dagen"
  getReportDay: [ON_B, () => [B, 20_000n]],
  getReport: [["admin", "werfleider", "calculator", "architect", "oa", "klant"], () => [repA.id]],
  listReports: [["admin", "werfleider", "calculator", "architect", "klant"], () => [A, 0n, 1n]],
  myDay: [["admin", "werfleider"], () => [20_000n, false]],
  listIssues: [INTERNAL, () => [[B], true, 1n]],
  handleIssue: [["admin", "werfleider"], () => [issDone.id, ""]], // al afgehandeld: er verandert niets
  listTrips: [["admin", "werfleider"], () => [20_000n, 20_001n]],
  listVehicles: [INTERNAL, () => [false]],
  saveVehicle: [ADMIN, () => [{ id: [], plate: "", name: "", archived: false }]],
  // 1.7 externe weergaven: Mijn uren en Mijn werven voor elke actieve persoon (leeg voor wie niets heeft); uren
  // bevestigen enkel de OA van die firma MET de grant (OA Dak is lid via zijn firma zonder grant: niemand); rechten
  // per externe: wie het team beheert (een recht dat niet bij de rol past: daarna "past niet"); een bestaande
  // persoon uitnodigen: admin en werfleider (onbekende persoon: daarna "Onbekende persoon").
  myHours: [ACTIVE, () => [20_000n, 20_001n]],
  // Verwacht: de OA Dak enkel als zijn firma op die werf het recht "uren bevestigen" heeft (op de draft zet
  // tests/extern-draft.mjs dat aan; in de rollentest niet). Wie de uren mag bevestigen, voegt een bevestiging toe.
  confirmHours: [dakMayConfirm ? ["oa"] : NONE, () => [attDak.id, true, ""]],
  myWorks: [ACTIVE, () => []],
  setMemberGrants: [["admin", "werfleider"], () => [memDakB.id, [{ readSellPrices: null }]]],
  inviteExistingPerson: [["admin", "werfleider"], () => [{ personId: X, workIds: [], validDays: 0n, tag: "" }]],
  // 1.8 dashboard: interne rollen (een werfleider zonder "ziet alles" enkel zijn werven)
  dashboard: [INTERNAL, () => [20_000n]],
  // 1b.1 vergunningen (R13): lezen per werf = intern zonder de calculator + architect/OA/VC als lid (B: OA Dak);
  // wijzigen admin en werfleider; de lijst en de gsm admin en werfleider; de kennisbank intern, aanvullen admin en
  // werfleider; soorten, regels en de meldronde enkel admin. Argumenten botsen daarna op een invoerfout.
  listPermitKinds: [INTERNAL, () => [false]],
  setPermitKind: [ADMIN, () => [{ key: "", name: "", leadDays: 0n, words: [], publicDomain: false, order: 0n, archived: false }]],
  permitRules: [INTERNAL, () => []],
  setPermitRules: [ADMIN, () => [{ warnDays: 0n, expiryDays: 0n }]],
  scanPermits: [ADMIN, () => []],
  meetKlok: [ADMIN, () => ["tick"]], // 2d.1: meetfunctie, enkel in de testbouw (Config.measureAnyCanister)
  workPermits: [["admin", "werfleider", "oa"], () => [B]],
  savePermit: [["admin", "werfleider"], () => [B, { id: [], kind: "bestaat-niet", title: "", municipalityId: [], status: { needed: null }, location: "", taskIds: [], neededFrom: [], neededTo: [], leadDays: [], requestedOn: [], validFrom: [], validTo: [], reference: "", costCents: [], note: "" }]],
  attachPermitFile: [["admin", "werfleider"], () => [pmB.id, X]], // daarna "Onbekend bestand"
  archivePermit: [["admin", "werfleider"], () => [pmGone.id, ""]], // al gearchiveerd: er verandert niets
  permitHistory: [["admin", "werfleider", "oa"], () => [pmB.id]],
  listPermits: [["admin", "werfleider"], () => ["alles", []]],
  permitsOnSite: [["admin", "werfleider"], () => [20_000n]],
  listMunicipalities: [INTERNAL, () => [false]],
  saveMunicipality: [["admin", "werfleider"], () => [{ id: [], name: "", zips: [], portal: [], email: [], phone: [], contact: "", notes: "", archived: false }]],
  saveProcedure: [["admin", "werfleider"], () => [{ municipalityId: X, kind: "", how: "", portal: [], email: [], leadDays: 0n, cost: "", attachments: [], contact: "", notes: "", archived: false }]],
  // 1b.2 boete-opzoeking (R14): admin alle ritten, werfleider de zijne; onmogelijke dag → daarna een invoerfout
  lookupFine: [["admin", "werfleider"], () => [{ day: 5n, time: [], plate: "", place: "", widen: false }]],
  // 1b.3 postbode: de robot leaset en meldt (onbekende opdracht → daarna een invoerfout; sinds mail-caffeine krijgt
  // geen robot nog een mail); instellingen, wachtrij, voorbeeld en proefmail enkel admin (#manageRobots).
  leaseJobs: [["robot"], () => [1n]],
  completeJob: [["robot"], () => [X, 1n, ""]],
  failJob: [["robot"], () => [X, 1n, "", false]],
  postSettings: [ADMIN, () => []],
  setPostSettings: [ADMIN, () => [{ weekmail: false, reminders: false, day: 9n, hour: 0n, reminderDay: 0n, appUrl: "", contact: [] }]],
  setOrgMail: [ADMIN, () => [X, true]],
  listJobs: [ADMIN, () => ["open", 0n, 1n]],
  previewMail: [ADMIN, () => ["bestaat-niet", [], 20_000n]],
  queueWeekMails: [ADMIN, () => [20_001n, []]],
  queueReminders: [ADMIN, () => [20_001n]],
  queueTestMail: [ADMIN, () => [""]],
  cancelJob: [ADMIN, () => [X]],
  retryJob: [ADMIN, () => [X]],
  // mail-caffeine: de app verstuurt zelf (testmodus, logboek, taal per firma, nu versturen): enkel admin. "Nu versturen"
  // doet voor de admin een echte ronde; de rollentest liet de wachtrij leeg en de testmodus droog.
  setMailTest: [ADMIN, () => [true, "geen-adres"]],
  setOrgMailLang: [ADMIN, () => [X, "xx"]],
  sendMailNow: [ADMIN, () => []],
  listMailLog: [ADMIN, () => [0n, 1n]],
  mailPreview: [ADMIN, () => ["bestaat-niet", [], 20_000n]],
  // 1b.4 werfadministratie: lezen interne rollen die de werf zien (#readWorkFacts), bijhouden en exporteren admin en
  // werfleider (#editWork), inhoudingsplicht interne rollen, regels admin.
  workAdmin: [INTERNAL, () => [B]],
  declarationDraft: [INTERNAL, () => [B]],
  saveDeclaration: [["admin", "werfleider"], () => [B, { status: { todo: null }, nature: "x", asbestos: false, note: "" }]],
  recordWithholdingCheck: [INTERNAL, () => [X, { result: { clear: null }, consultedOn: 20_000n, reference: "", note: "", workId: [] }]],
  withholdingHistory: [INTERNAL, () => [X]],
  checkinatworkExport: [["admin", "werfleider"], () => [B, 20_001n, 20_000n]],
  wadmOverview: [INTERNAL, () => []],
  wadmRules: [INTERNAL, () => []],
  setWadmRules: [ADMIN, () => [{ threshold30bisCents: 0n, threshold30bisWithOaCents: 0n, oaCountAlways: 0n, thresholdCheckinatworkCents: 0n }]],
  // 2.2 postenbibliotheek: lezen (zonder prijzen) interne rollen; bewerken admin en calculator; eenheden en de standaardmarge
  // admin (R17). De PRIJZEN (aankoop, marge, verkoop) enkel admin en calculator (R20, R21): nooit werfleider, OA, architect,
  // klant, VC of robot. Onbekende ids en lege invoer → daarna een invoerfout (er verandert niets).
  libraryChapters: [INTERNAL, () => [true]],
  libraryUnits: [INTERNAL, () => [true]],
  listLibrary: [INTERNAL, () => [{ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset: 0n, limit: 1n }]],
  getLibraryItem: [INTERNAL, () => [X]],
  libraryItemHistory: [INTERNAL, () => [X]],
  saveLibraryChapter: [["admin", "calculator"], () => [{ id: [], code: "", title: "", order: 0n, note: "" }]],
  setLibraryChapterArchived: [["admin", "calculator"], () => [X, true]],
  loadLibraryStartChapters: [["admin", "calculator"], () => []], // de rollentest of de draftproef laadde ze al: "Er zijn al hoofdstukken"
  setLibraryUnit: [ADMIN, () => [{ key: "", name: "", order: 0n, archived: false }]],
  saveLibraryItem: [["admin", "calculator"], () => [{ id: [], chapterId: X, code: "", title: "", text: "", unit: "", form: { fixed: null }, trade: [], orgId: [], durationDays: [], perDayMilli: [], planStepKey: [], keywords: [], importKey: [] }, 0n]],
  setLibraryItemArchived: [["admin", "calculator"], () => [X, true, ""]],
  readLibraryPrices: [["admin", "calculator"], () => [[X]]],
  readLibraryPriceHistory: [["admin", "calculator"], () => [X]],
  addLibraryCost: [["admin", "calculator"], () => [X, { orgId: [], day: 20_000n, costCents: 0n, source: "eigen", ref: "", note: "" }]],
  archiveLibraryCost: [["admin", "calculator"], () => [X, ""]],
  setLibrarySell: [["admin", "calculator"], () => [X, { rule: [], reason: "" }, 0n]],
  setLibraryMargin: [ADMIN, () => [99_999n]],
  // 2.4: offertes. Lezen: interne rollen (een architect enkel met de grant op een werf: de lijst over alle werven en een
  // onbekende versie blijven dicht). Bewerken, versturen, beslissen: admin en calculator. Volgnummer: admin (R17).
  listQuotes: [INTERNAL, () => [[], false]],
  readQuoteVersion: [INTERNAL, () => [X]],
  readPreviousPrices: [["admin", "calculator"], () => [X]], // 4b.3b: de vorige prijs (aankoop en verkoop): enkel kantoor
  createQuote: [["admin", "calculator"], () => [{ workId: X, number: "", title: "" }]],
  setQuoteSequence: [ADMIN, () => [1n, 0n]],
  quoteSequence: [ADMIN, () => [2026n]],
  newQuoteVersion: [["admin", "calculator"], () => [X, []]],
  saveQuoteDraft: [["admin", "calculator"], () => [X, 0n, [], [], [], { subtotalCents: 0n, vatCents: 0n, totalCents: 0n, optionsPlusCents: 0n, optionsMinusCents: 0n, costCents: 0n, marginCents: 0n, chapters: [] }]],
  sendQuoteVersion: [["admin", "calculator"], () => [X, 0n, 0n, ""]],
  // 2.6: controleregels vóór verzending (lezen: wie offertes bewerkt; instellen: enkel admin; de controle zelf: wie ook de marges mag zien)
  getQuoteRules: [["admin", "calculator"], () => []],
  setQuoteRule: [ADMIN, () => [{ key: "bestaat-niet", enabled: true, severity: { warn: null }, thresholdBp: [] }]],
  setQuoteStdPost: [ADMIN, () => [{ key: "", name: "", keywords: [], enabled: true, severity: { warn: null }, order: 0n, archived: false }]],
  checkQuoteVersion: [["admin", "calculator"], () => [X]],
  // 2c.1: margeklassen en hun koppeling (vertrouwelijk: #readCosts + #editLibrary), tekstblokken, soort en vorm van een offerte
  listMarginClasses: [["admin", "calculator"], () => []],
  setMarginClass: [["admin", "calculator"], () => [{ id: [X], name: "", marginBp: 0n, note: "", archived: false }]],
  setMarginClassLink: [["admin", "calculator"], () => ["bestaat-niet:1", []]],
  listTextBlocks: [["admin", "calculator"], () => [true]],
  setTextBlock: [["admin", "calculator"], () => [{ key: "", title: "", text: "", defaultOn: false, place: { top: null }, order: 0n, archived: false }]],
  setQuoteInfo: [["admin", "calculator"], () => [X, { kind: { standard: null }, insurerOrgId: [], claimRef: "" }]],
  saveQuoteForm: [["admin", "calculator"], () => [X, 0n, { hideZeroLines: true, regieText: false, textBlockKeys: [], subgroupOps: [], lineOps: [], chapterMargins: [], regie: [], discount: [], discountText: "" }, { subtotalCents: 0n, discountCents: 0n, totalCents: 0n }]],
  // 2.7: voorwaarden, getekend bewijs, mail naar de klant (kantoor) en de offerte voor de klant
  getQuoteDocSettings: [["admin", "calculator"], () => []],
  setQuoteDocSettings: [ADMIN, () => [{ issuer: "", paymentDays: 0n }]],
  addQuoteTerms: [ADMIN, () => [{ title: "", text: "", provisional: true, note: "" }]],
  registerSignedQuote: [["admin", "calculator"], () => [X, X, ""]],
  mailQuoteToClient: [["admin", "calculator"], () => [X]],
  listMyQuotes: [["klant"], () => []],
  readMyQuote: [["klant"], () => [X]],
  acceptMyQuote: [["klant"], () => [X, "x"]],
  declineMyQuote: [["klant"], () => [X, "x", ""]],
  decideQuoteVersion: [["admin", "calculator"], () => [X, true, ""]],
  // 2.8: offerte → werf. Admin en werfleider (de werfleider enkel op de werven die hij ziet); een onbekende versie geeft hen
  // "Onbekende versie", de anderen "Geen toegang" (geen id-orakel). Calculator, externen en de robot nooit.
  pendingWorkStarts: [["admin", "werfleider"], () => [[]]],
  workStartPreview: [["admin", "werfleider"], () => [X, wsIn]],
  startWorkFromQuote: [["admin", "werfleider"], () => [X, wsIn, 0n]],
  dismissWorkStart: [["admin", "werfleider"], () => [X, ""]],
  // 2.9: opmeting ter plaatse. De lijst en de samenvatting per werf volgen het bereik (measureScope): admin en calculator alles, de
  // werfleider de werven die hij ziet, de OA zijn eigen werven (enkel zijn posten); architect, klant en veiligheid niets
  // zonder schakelaar. De schrijfpoort: interne rollen (een OA enkel als de beheerder "OA stelt voor" aanzet). Een onbekende
  // post of opmeting: voor iedereen "Geen toegang" (geen id-orakel). De instellingen: interne rollen lezen, enkel de admin schrijft.
  measureSettings: [INTERNAL, () => []],
  saveMeasureSettings: [ADMIN, () => [{ thresholdBp: 0n, oaPropose: false, externalRead: false }]],
  listMeasureWorks: [ACTIVE, () => []],
  measureSummary: [ON_B, () => [B]],
  measurePost: [NONE, () => [B, X]],
  getMeasureSurvey: [NONE, () => [X]],
  measureSync: [INTERNAL, () => [[]]],
  // 2.10: vorderingsstaten. Menu en lijst per werf: admin, calculator en werfleider (progressScope full/prepare). Een onbekende
  // staat: voor iedereen "Geen toegang" (geen id-orakel); een nieuw ontwerp op een onbekende werf evenzeer. Het rekenmodel van
  // de prijsherziening: enkel admin en calculator. De klantfuncties: enkel de klantrol ("Onbekende staat" voor wat niet van hem is).
  progressSettings: [INTERNAL, () => []],
  saveProgressSettings: [ADMIN, () => [{ client: "bestaat-niet", retentionOnIncl: false }]],
  progressWorks: [INTERNAL, () => []],
  listProgress: [INTERNAL, () => [B]],
  newProgress: [NONE, () => [X]],
  progressQty: [NONE, () => [X]],
  readProgressStatement: [NONE, () => [X]],
  saveProgressDraft: [NONE, () => [X, 0n, { periodTo: [], note: [], setIndexes: false, sIndex: [], iIndex: [], lines: [], expect: [] }]],
  markProgressPrepared: [NONE, () => [X]],
  cancelProgressDraft: [NONE, () => [X, ""]],
  sendProgress: [NONE, () => [X, 0n, 0n, ""]],
  creditProgress: [NONE, () => [X, ""]],
  setProgressReady: [NONE, () => [X]],
  progressInvoiceData: [NONE, () => [X]],
  readProgressRevision: [["admin", "calculator"], () => [B]],
  saveProgressRevision: [["admin", "calculator"], () => [B, { aBp: 1n, bBp: 1n, cBp: 1n, sBase: 0n, iBase: 0n, sLabel: "", iLabel: "", note: "" }]],
  listMyProgress: [["klant"], () => []],
  readMyProgress: [["klant"], () => [X]],
  answerMyProgress: [["klant"], () => [X, "x", true, ""]],
  // 2.11: OA-facturen. Lijst: admin, calculator en werfleider (oaInvoiceScope full/qty). Een onbekende factuur: voor iedereen
  // "Geen toegang" (geen id-orakel). Registreren op werf B: admin en calculator (de invoer is ongeldig: geen nummer). De posten
  // van het formulier: admin en calculator. De OA ziet zijn eigen facturen enkel met de schakelaar van de beheerder (staat uit).
  oaInvoiceSettings: [INTERNAL, () => []],
  saveOaInvoiceSettings: [ADMIN, () => [{ thresholdBp: 99_999n, thresholdCents: 0n, oaView: false, disputeNotice: "melding" }]],
  listOaInvoices: [INTERNAL, () => [[], []]],
  oaInvoicePosts: [["admin", "calculator"], () => [B]],
  oaInvoiceQty: [NONE, () => [X]],
  readOaInvoice: [NONE, () => [X]],
  saveOaInvoice: [["admin", "calculator"], () => [{ id: [], orgId: X, workId: B, number: "", invoiceDay: 0n, dueDay: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], note: "", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [] }, 0n]],
  approveOaInvoice: [NONE, () => [X, 0n, { exception: "" }, ""]],
  disputeOaInvoice: [NONE, () => [X, 0n, ""]],
  withdrawOaInvoice: [NONE, () => [X, 0n, ""]],
  myOaInvoices: [NONE, () => []],
  // 2c.2: prijsvragen (R35–R39). Per werf: admin, calculator en de werfleider van de werf (enkel stand, geen bedrag). Maken, beheren
  // en OA-offertes lezen: admin en calculator (de invoer is telkens ongeldig of de prijsvraag is afgesloten: geen wijziging). De OA
  // (proef-oa2 = Proef Dak NV, gevraagd op de open prijsvraag): enkel zijn eigen uitnodiging; een bijlage die eraan hangt.
  listTenders: [["admin", "werfleider", "calculator"], () => [[B]]],
  readTender: [["admin", "calculator"], () => [tOpen.id]],
  tenderSuggestions: [["admin", "calculator"], () => [X, []]],
  createTender: [["admin", "calculator"], () => [{ versionId: X, lineIds: [], title: "", noteForOa: "", internalNote: "", deadlineDay: 0n, remindDays: 0n, fileIds: [], addressMode: { full: null }, firms: [] }]],
  addTenderFirm: [["admin", "calculator"], () => [tOpen.id, { orgId: X, contactPersonId: [] }]],
  updateTender: [["admin", "calculator"], () => [tOpen.id, 999n, { internalNote: "" }]],
  updateTenderInvite: [["admin", "calculator"], () => [invOpen.id, { markSent: [] }]],
  tenderAccess: [["admin", "calculator"], () => [invGone.id, 0n]],
  readOaQuote: [["admin", "calculator"], () => [oaq.id]],
  listMyTenders: [["oa"], () => []],
  readMyTender: [["oa"], () => [invOpen.ref]],
  readMyTenderAnswer: [["oa"], () => [invOpen.ref]],
  saveMyTender: [["oa"], () => [invOpen.ref, draftIn, false, 0n]],
  declineMyTender: [["oa"], () => [invOpen.ref, "x".repeat(1001)]],
  readTenderFile: [["oa"], () => [invOpen.ref, 1n]],
  addMyTenderFile: [["oa"], () => [invOpen.ref, "", "application/pdf", 0n, blob]],
  // 2c.3: OA-offertes ontvangen, vergelijken, kiezen, overnemen (R36, R38: admin en calculator; bedragen enkel via update-calls met
  // auditregel). De invoer is telkens ongeldig (geen wijziging); de instellingen lezen alle interne rollen, bewaren enkel de beheerder.
  tenderSettings: [INTERNAL, () => []],
  saveTenderSettings: [ADMIN, () => [{ deadlineDays: 0n, remindDays: 0n, thanksMode: "fax", deviationBp: 0n }]],
  listOaQuotes: [["admin", "calculator"], () => [B]],
  registerOaQuote: [["admin", "calculator"], () => [{ inviteId: [], workId: B, orgId: X, source: { hand: null }, sheetKey: "", number: "", quoteDay: 0n, validUntil: [], discountBp: [], reverse: true, prices: { total: 0n }, remark: "", note: "", file: [] }, 0n]],
  compareTender: [["admin", "calculator"], () => [tOpen.id]],
  saveTenderChoices: [["admin", "calculator"], () => [tOpen.id, []]],
  // 2c open punten (deel A): een OA-offerte intrekken (zonder reden = ongeldig, dus geen wijziging).
  withdrawOaQuote: [["admin", "calculator"], () => [oaq.id, "", false]],
  applyTenderChoices: [["admin", "calculator"], () => [tOpen.id, X]],
  // 2c.4: afspraken met de gekozen OA (R40). Kantoor (admin, calculator) alles, bedragen enkel via update-calls met auditregel; de
  // werfleider van de werf de stand (listDeals); interne rollen de attesten op de firmafiche; de OA zijn eigen contracten en attesten
  // (verwijzing; een onbekende of andere verwijzing = "Onbekend …", geen toegangsorakel). De invoer is telkens ongeldig.
  dealSetup: [[...INTERNAL, "oa"], () => []],
  listOaRates: [["admin", "calculator"], () => [X]],
  saveOaRate: [["admin", "calculator"], () => [{ orgId: X, kind: "regie", unit: "uur", cents: 0n, validFrom: 0n, source: "offerte", ref: "", fileId: [], note: "" }]],
  archiveOaRate: [["admin", "calculator"], () => [X, ""]],
  listDeals: [["admin", "werfleider", "calculator"], () => [B]],
  readDeal: [["admin", "calculator"], () => [X]],
  createDeal: [["admin", "calculator"], () => [B, X]],
  saveDealTerms: [["admin", "calculator"], () => [X, { advanceBp: 0n, paymentDays: 0n, endOfMonth: true }, 0n]],
  addDealRate: [["admin", "calculator"], () => [X, { kind: "x", unit: "", cents: 0n, validFrom: 0n, fromRateId: [], note: "" }, 0n]],
  endDeal: [["admin", "calculator"], () => [X, "", 0n]],
  makeOaContract: [["admin", "calculator"], () => [X, 0n]],
  readOaContract: [["admin", "calculator"], () => [X, 1n]],
  markOaContractSigned: [["admin", "calculator"], () => [X, 1n, X, "", 0n]],
  listContractTemplates: [["admin", "calculator"], () => []],
  saveContractTemplate: [ADMIN, () => ["", "", true, ""]],
  addDealFile: [["admin", "calculator"], () => ["", "application/pdf", 0n, blob, { rate: X }]],
  listOrgDocs: [INTERNAL, () => [X]],
  saveOrgDoc: [["admin", "calculator"], () => [{ orgId: X, kind: "ba", title: "", fileId: [], validFrom: [], validUntil: [], note: "" }]],
  reviewOrgDoc: [["admin", "calculator"], () => [X, true, ""]],
  archiveOrgDoc: [["admin", "calculator"], () => [X, ""]],
  listMyContracts: [["oa"], () => []],
  readMyContract: [["oa"], () => ["0".repeat(16), 1n]],
  readMyContractFile: [["oa"], () => ["0".repeat(16), 1n]],
  listMyAttests: [["oa"], () => []],
  addMyAttest: [["oa"], () => ["", "", [], [], "", "application/pdf", 0n, blob]],
  readMyAttestFile: [["oa"], () => ["0".repeat(16)]],
  scanOrgDocs: [ADMIN, () => []],
  // 2c.7: aankoopfacturen (R44). Kantoor (admin, calculator) registreert, beslist en ziet bedragen (update-calls met auditregel);
  // een onbekende aankoop of dag: voor iedereen "Geen toegang" (geen id-orakel). De uren per dag: de werfleider en de beheerder
  // (listHourClaims zonder werf; per dag beslist de werf). De OA ziet zijn eigen facturen enkel met de schakelaar (staat uit).
  purchaseSettings: [INTERNAL, () => []],
  savePurchaseSettings: [ADMIN, () => [{ askHours: "x", passOn: true }]],
  listPurchases: [["admin", "calculator"], () => [[], []]],
  readPurchase: [NONE, () => [X]],
  listPurchasesToPay: [["admin", "calculator"], () => []],
  purchaseCosts: [["admin", "calculator"], () => [B]],
  savePurchase: [["admin", "calculator"], () => [{ id: [], orgId: X, kind: { oa: null }, number: "", invoiceDay: 0n, dueDay: [], discountUntil: [], discountBp: [], periodFrom: [], periodTo: [], vatRegime: { reverse: null }, reverseMention: true, fileId: [], oaStatementFileId: [], oaStatementRef: "", note: "", netCents: 0n, vatCents: 0n, totalCents: 0n, lines: [], finalWorkIds: [], creditOf: [] }, 0n]],
  approvePurchase: [NONE, () => [X, 0n, ""]],
  disputePurchase: [NONE, () => [X, 0n, ""]],
  withdrawPurchase: [NONE, () => [X, 0n, ""]],
  markPurchasePaid: [NONE, () => [X, 0n, [], []]],
  // 2c.8+ B: een OA-factuur van 2.11 betaald markeren (onbekende factuur: niemand).
  // Review L10: met een echte OA-factuur (rev klopt niet: niets verandert), zodat de rechten per rol echt getest worden.
  markOaInvoicePaid: [["admin", "calculator"], () => [oaInv.id, 999_999n, [], []]],
  listHourClaims: [["admin", "werfleider"], () => [[]]],
  reviewHourClaim: [NONE, () => [X, true, ""]],
  myPurchases: [NONE, () => []],
  // 2c.5: de min-meerstaat (R41). Kantoor (admin, calculator) alles, bedragen enkel via update-calls met auditregel; de werfleider van
  // de werf de staat in hoeveelheden en uren en voorstellen (zonder prijs); de klant en de architect enkel gedeelde versies (een
  // onbekende versie = "Onbekende versie", geen toegangsorakel); antwoorden enkel de klant. De invoer is telkens ongeldig.
  minMeerSettings: [["admin", "calculator"], () => []],
  saveMinMeerSettings: [ADMIN, () => [{ quoteFromCents: 0n, passOnBp: 0n, passOnByKind: [], client: "x" }]],
  minMeerQty: [["admin", "werfleider", "calculator"], () => [B]],
  readMinMeer: [["admin", "calculator"], () => [B]],
  // 4.6 nacalculatie en 4.4 maandagbriefing
  readNacalc: [["admin", "calculator"], () => [B]],
  nacalcOverview: [["admin", "calculator"], () => []],
  nacalcSettings: [["admin", "calculator"], () => []],
  saveNacalcSettings: [ADMIN, () => [{ pctBp: 1000n, minCents: 25_000n }]],
  readBriefing: [ADMIN, () => []],
  saveMinMeerEntry: [["admin", "werfleider", "calculator"], () => [B, [], 0n, { kind: { extra: null }, chapter: "", root: [], description: "", unit: "", qtyMilli: 0n, pctBp: [], day: [], approval: { pending: null }, photoFileId: [], note: "", price: [] }]],
  archiveMinMeerEntry: [["admin", "calculator"], () => [X, ""]],
  setMinMeerOverride: [["admin", "calculator"], () => [B, { key: "x", exclude: false, chapter: [], passOn: false, reason: "" }]],
  saveMinMeerRegieRates: [["admin", "calculator"], () => [B, [{ fromDay: 0n, sellCents: 0n, note: "" }]]],
  makeMinMeerVersion: [["admin", "calculator"], () => [B, "", { balanceCents: 1n, toInvoiceCents: 1n }]],
  readMinMeerVersion: [["admin", "calculator"], () => [X]],
  shareMinMeerVersion: [["admin", "calculator"], () => [X]],
  listMyMinMeer: [["architect", "klant"], () => []],
  readMyMinMeer: [["architect", "klant"], () => [X]],
  answerMyMinMeer: [["klant"], () => [X, "", true, ""]],
  // 2c.6 (R42, R43): verkoopfacturen. Kantoor (admin, calculator) alles; de werfleider enkel "voorschot betaald"; de klant zijn eigen
  // uitgereikte facturen; teller en vermeldingen enkel de beheerder. Onbekende ids: een gewone fout voor wie mag (geen "Geen toegang").
  salesSettings: [["admin", "calculator"], () => []],
  saveSalesSettings: [ADMIN, () => [{ issuer: { name: "", legalForm: "", address: { street: "", number: "", zip: "", city: "", country: "" }, vat: "", kbo: "", rpr: "", email: "", phone: "", website: "", iban: "", bic: "" }, paymentDays: 0n, vat6Text: "", reverseText: "", creditText: "", paymentText: "", footerText: "", reminderText: "", reminderDays: 0n, issuerOnly: false, firstSeqF: 100n, firstSeqCN: 1n, planBp: [], peppolScheme: "" }]],
  setSalesCounter: [ADMIN, () => ["X", 0n, 0n]],
  readSalesPlan: [["admin", "calculator"], () => [B]],
  saveSalesPlan: [["admin", "calculator"], () => [B, 999n, []]],
  // 2c.8+ B: de eigen schijven van een meerwerkofferte (kantoor; zonder aanvaarde meerwerkofferte een gewone weigering).
  saveSalesExtraPlan: [["admin", "calculator"], () => [B, X, 999n, []]],
  listSales: [["admin", "calculator"], () => [B]],
  salesFacts: [["admin", "werfleider", "calculator"], () => [B]],
  newSalesInvoice: [["admin", "calculator"], () => [B, { credit: { invoiceId: X, full: true } }]],
  saveSalesDraft: [["admin", "calculator"], () => [X, 0n, { title: "", note: "", serviceDay: [], serviceTo: [], paymentDays: 0n, vat: { mixed: null }, lines: [], expectTotalCents: 0n }]],
  cancelSalesDraft: [["admin", "calculator"], () => [X, ""]],
  readSalesInvoice: [["admin", "calculator"], () => [X]],
  issueSalesInvoice: [["admin", "calculator"], () => [X, 0n, 0n]],
  markSalesSent: [["admin", "calculator"], () => [X, ""]],
  addSalesPayment: [["admin", "calculator"], () => [X, 0n, 0n, "", ""]],
  archiveSalesPayment: [["admin", "calculator"], () => [X, ""]],
  salesWorklist: [["admin", "calculator"], () => []],
  listMySales: [["klant"], () => []],
  readMySalesInvoice: [["klant"], () => [X]],
  // 2c.6b: kwartaallijst, UBL gemaakt, herinnering (kantoor).
  salesQuarter: [["admin", "calculator"], () => [2026n, 9n]],
  markSalesUbl: [["admin", "calculator"], () => [X]],
  remindSalesInvoice: [["admin", "calculator"], () => [X, false, ""]],
  makeExtraWorkQuote: [["admin", "calculator"], () => [B, [], ""]],
  // 2c.8: werfadministratie en oplevering (R45, R46). Lezen: interne rollen die de werf zien; bewaren: kantoor en de werfleider van de werf;
  // werfwaarde en premie: kantoor (update-calls); de klant leest enkel zijn eigen werf (clientSiteAdmin); een onbekend id: voor iedereen "Geen toegang".
  nextWorkCode: [["admin", "werfleider"], () => []],
  siteAdminSettings: [["admin", "calculator"], () => []],
  saveSiteAdminSettings: [ADMIN, () => [{ codeP: false, rates: [["x", 0n, 0n]] }]],
  listInsurances: [ON_B.filter((r) => r !== "oa"), () => [[B], false]],
  saveInsurance: [["admin", "calculator", "werfleider"], () => [{ id: [], workId: [B], kind: { other: "" }, insurerOrgId: [], brokerOrgId: [], policyRef: "", periodFrom: [], periodTo: [], status: { toDeclare: null }, note: "", rev: 0n }]],
  archiveInsurance: [NONE, () => [X]],
  attachInsuranceFile: [NONE, () => [X, "x", "", X, false]],
  shareInsuranceAttest: [NONE, () => [X, true]],
  readInsuranceConf: [NONE, () => [X]],
  saveInsuranceConf: [NONE, () => [X, { workValueCents: [], rateMilli: [], minPremiumCents: [], taxesCents: [], paid: false, rev: 0n }]],
  insuranceSheet: [NONE, () => [X]],
  listMeetings: [ON_B.filter((r) => r !== "oa"), () => [B]],
  saveMeeting: [["admin", "werfleider"], () => [B, { id: [], opId: "", rev: 0n, day: 20_000n, attendees: ["x".repeat(81)], fileId: [], note: "", addPoints: [] }]],
  archiveMeeting: [NONE, () => [X]],
  listHandovers: [ON_B.filter((r) => r !== "oa"), () => [B]],
  saveHandover: [["admin", "werfleider"], () => [B, { id: [], opId: "", rev: 0n, kind: { provisional: null }, day: [], attendees: ["x".repeat(81)], pvFileId: [], signedFileId: [], note: "", docNote: "", addPoints: [] }]],
  finishHandover: [NONE, () => [X, X, "x"]],
  shareHandover: [NONE, () => [X, true]],
  archiveHandover: [NONE, () => [X]],
  handoverDoc: [NONE, () => [X]],
  listTechSheets: [INTERNAL, () => [false]],
  saveTechSheet: [["admin", "calculator"], () => [{ id: [], materialKey: "", title: "", fileId: X, supplierOrgId: [] }]],
  archiveTechSheet: [NONE, () => [X]],
  workTechSheets: [ON_B.filter((r) => r !== "oa"), () => [B]],
  setWorkTechSheets: [["admin", "calculator", "werfleider"], () => [B, [X]]],
  // 2c open punten (deel A): het PID-document maakt de browser; dit zet enkel de auditregel (ongeldige tellingen = geen regel).
  recordPid: [["admin", "calculator", "werfleider"], () => [B, 100_000n, 0n, 0n]],
  pidSheetFiles: [["admin", "calculator", "werfleider"], () => [B]],
  // 2c open punten (deel A): attestsoorten in Beheer (enkel de beheerder; lege naam / onbekende soort = geen wijziging).
  listOrgDocKinds: [ADMIN, () => []],
  addOrgDocKind: [ADMIN, () => [""]],
  archiveOrgDocKind: [ADMIN, () => ["bestaat-niet", true]],
  clientSiteAdmin: [NONE, () => [X]],
  scanSiteAdmin: [ADMIN, () => []],
  setQuoteArchived: [["admin", "calculator"], () => [X, true, ""]],
  getSettings: [INTERNAL, () => []],
  setSettings: [ADMIN, () => [{ werfleiderZietAlles: true, inviteDays: 0n, threshold30bisCents: 3_000_000n, thresholdCheckinatworkCents: 50_000_000n }]],
  listRobots: [ADMIN, () => []],
  addRobot: [ADMIN, () => [Principal.anonymous(), "", []]],
  revokeRobot: [ADMIN, () => [someone]],
  auditLog: [ACTIVE, () => [0n, 1n]],
  auditCount: [ADMIN, () => []],
  myNotifications: [ACTIVE, () => [true]],
  markNotificationsRead: [ACTIVE, () => [[]]],
  // 4b.1: Te doen (iedere actieve persoon zijn eigen lijst; wat erin staat bewijst tests/proef-4b-1.mjs per regel en per rol).
  myTodo: [ACTIVE, () => [{ day: BigInt(Math.floor(Date.now() / 86_400_000)), offset: 0n, limit: 1n, snoozed: false, kind: "" }]],
  snoozeTodo: [ACTIVE, () => ["", []]],
  // 4b.5: het model van taak en voorstel (enkel de beheerder, #manageBots; geen bedragen en geen vrije tekst van een bot).
  listTasks: [ADMIN, () => [{ workId: [], openOnly: false, kind: "", offset: 0n, limit: 1n }]],
  // 4b.6: het voorstelscherm en wie deed wat (interne rollen met de rechten van hun scherm, Rights.taskSight; externen geen toegang;
  // wat elke rol ziet bewijst tests/proef-4b-6.mjs per taak en per soort).
  listTasksFor: [INTERNAL, () => [{ workId: [], key: "", subject: "", openOnly: false, kind: "", offset: 0n, limit: 1n }]],
  exportIntern: [ADMIN, () => []],
  exportConfidential: [ADMIN, () => []],
  exportChunk: [ADMIN, () => ["persons", 0n, 1n]], // 1.9: export in stukken (O-11)
  addFile: [ON_B, () => ["", "image/jpeg", 0n, blob, [B], false]],
  listFiles: [ON_B, () => [[B]]],
  readConfidentialFile: [["admin", "calculator"], () => [X]],
  archiveFile: [ADMIN, () => [file.id]],
  createTicket: [INTERNAL, () => ["onbekend", []]],
  checkTicket: [["robot"], () => ["TK-0"]],
  submitProposal: [["robot"], () => [X, "", ""]],
  myProposals: [ACTIVE, () => []],
  // 3.1: AI-connector. Een AI-taak starten enkel interne rollen (een OA, klant, architect of VC nooit); fiches, catalogus, overzicht,
  // logboek en instellingen enkel de admin; aiCall antwoordt null voor andermans oproep (elke actieve persoon); de twee robotfuncties
  // enkel een robot met de soort "ai" (de lekrobot heeft enkel "proef": niemand hier).
  askAi: [INTERNAL, () => ["onbekend", [], { text: "", refs: [], forceRoute: [] }]],
  aiTestCall: [ADMIN, () => ["onbekend"]],
  aiCall: [ACTIVE, () => [X]],
  myAiCalls: [INTERNAL, () => []],
  aiLog: [ADMIN, () => [0n, 1n]],
  listAiWorkers: [INTERNAL, () => []],
  aiOverview: [ADMIN, () => []],
  saveAiWorker: [ADMIN, () => [{ key: "onbekend", name: "", route: { caffeine: null }, modelAlias: "", fallback: false, fallbackModel: [], budgetMonthCents: 0n, maxCallCents: 0n, clientData: false, autonomy: { proposal: null }, instructionVersion: 1n, enabled: false, rev: 0n }]],
  setAiSettings: [ADMIN, () => [["http://ongeldig.invalid"], [], []]],
  refreshAiModels: [ADMIN, () => []],
  reportAiUsage: [NONE, () => [X, { model: "", promptTokens: 0n, completionTokens: 0n, cachedTokens: 0n, costCents: 0n, durationMs: 0n, outputSha256: [] }]],
  failAiTicket: [NONE, () => [X, ""]],
  decideProposal: [["admin", "werfleider"], () => [decided.id, true, ""]],
  // Opslag (StorageGate.mo). De poort: alleen actieve personen met een uploadrecht.
  _immutableObjectStorageCreateCertificate: [["admin", "werfleider", "calculator", "oa", "veiligheid"], () => [hash]],
  _immutableObjectStorageBlobsAreLive: [ALL, () => [[]]],
  _immutableObjectStorageBlobsToDelete: [NONE, () => []],
  _immutableObjectStorageConfirmBlobDeletion: [NONE, () => [[]]],
  _immutableObjectStorageRefillCashier: [NONE, () => [[]]],
  // Zoals bij Caffeine mag iedereen de gatewaylijst laten verversen; sinds 1.9 hoogstens eens per 5 min echt naar de
  // kassier (O-06). Lokaal trapt hij altijd (geen kassier); daarom niet vergeleken.
  _immutableObjectStorageUpdateGatewayPrincipals: [null, () => []],
  // 1.9 herstel (M9): enkel op een LEGE canister met de opstartcode; hier is de canister gevuld, dus voor niemand.
  restoreBegin: [NONE, () => ["BOW-0000-0000-0000-0000"]],
  restoreChunk: [NONE, () => ["BOW-0000-0000-0000-0000", { counters: [] }]],
  restoreFinish: [NONE, () => ["BOW-0000-0000-0000-0000"]],
};

// Waarom een oproep geweigerd werd (voor "te streng": een netwerk- of tijdfout is geen weigering van de app).
let lastWhy = "";
async function allowed(fn, args) {
  try {
    const r = await fn(...args);
    const no = !!(r && typeof r === "object" && "err" in r && /^Geen toegang/.test(r.err));
    lastWhy = no ? r.err : "";
    return !no;
  } catch (e) {
    lastWhy = String(e?.message ?? e).split("\n")[0].slice(0, 160);
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
  // LEK_ROLLEN=admin,werfleider: enkel die rollen (nakijken van een "te streng").
  const only = process.env.LEK_ROLLEN ? process.env.LEK_ROLLEN.split(",") : null;
  for (const role of [...ALL.filter((r) => r !== "admin"), "admin"].filter((r) => !only || only.includes(r))) {
    calls++;
    const t0 = Date.now();
    const ok = await allowed(roles[role][m], args());
    // LEK_VOORTGANG=1: per oproep de duur (een oproep die blijft hangen, valt zo op).
    if (process.env.LEK_VOORTGANG) console.log(`  ${m} · ${role}: ${Date.now() - t0} ms`);
    if (ok) got.push(role);
    const want = expect.includes(role);
    if (ok && !want) {
      leaks++;
      console.log(`✗ LEK ${m} door ${role}`);
    } else if (!ok && want) {
      tooStrict++;
      console.log(`✗ te streng: ${m} voor ${role}  — ${lastWhy}`);
    }
  }
  rows.push({ m, expect, got });
}
for (const k of Object.keys(table)) if (!methods.includes(k)) console.log(`· tabelregel zonder functie: ${k}`);
// 3.13: de bot BUITEN zijn fiche via de MCP-ingang (zoals Claude): elke tool buiten de fiche, op elke werf, met elk id = geweigerd en
// zonder gegevens. tools/list toont enkel mijn_fiche. Elke tool die iets teruggeeft dat niet mag = een lek.
{
  const anonB = roles.anoniem;
  const con = await connect(anonB, roles.bot, cid, "Proef lektest");
  if (!con.access) { leaks++; console.log(`✗ LEK-proef bot: geen koppeling (${con.err})`); }
  else {
    const tl = (await rpc(anonB, cid, con.access, "tools/list")).json?.result?.tools ?? [];
    if (tl.length !== 1 || tl[0].name !== "mijn_fiche") { leaks++; console.log(`✗ LEK tools/list van de bot: ${tl.map((t) => t.name).join(", ")}`); }
    const ids = [A, B, X, 0n].map(Number);
    const tries = [];
    for (const w of ids) {
      tries.push(["werven", {}], ["werf_documenten", { werfId: w }], ["oa_offertes", { werfId: w }], ["oa_facturen", { werfId: w }], ["document_koppelen", { werfId: w, bestandId: Number(file.id), soort: "vgplan" }]);
    }
    tries.push(["voorstel_factuurcontrole", { factuurId: Number(oaInv.id), oordeel: "in_orde" }], ["betalen", {}], ["verwijderen", { werfId: Number(A) }]);
    // 3.5: zonder open proefronde geen proeftools (ook niet met een geraden geval).
    tries.push(["proef_gevallen", {}], ["proef_antwoorden", { antwoorden: [{ geval: 1, werfId: Number(A), soort: "vgplan" }] }]);
    // 3.8: OA-offerte inlezen buiten de fiche (ook de bijlagetools, die apart beantwoord worden).
    tries.push(["inleesopdrachten", {}], ["inleesbestand", { opdracht: 1 }], ["voorstel_oa_offerte", { opdracht: 1, vorm: "totaal", totaalCent: 1 }], ["proef_bestand", { geval: 1 }]);
    // 3.10: OA-factuurcontrole buiten de fiche (ook de bijlagetool en het voorstel bij een opdracht).
    tries.push(["controleopdrachten", {}], ["controlebestand", { opdracht: 1 }], ["voorstel_factuurcontrole", { opdracht: 1, voorstel: "goedkeuren" }]);
    // 3.9 + 3.11: nakijkopdrachten buiten de fiche.
    tries.push(["vergelijkopdrachten", {}], ["voorstel_vergelijking", { opdracht: 1 }], ["naleesopdrachten", {}], ["opmerkingen_offerte", { opdracht: 1, oordeel: "in_orde" }]);
    let botCalls = 0;
    for (const [n, a] of tries) {
      botCalls++;
      const r = await mcpTool(anonB, cid, con.access, n, a);
      if (!r.isError) { leaks++; console.log(`✗ LEK bot buiten fiche: ${n} ${JSON.stringify(a)} → ${r.text.slice(0, 120)}`); }
    }
    const f = await mcpTool(anonB, cid, con.access, "mijn_fiche");
    if (f.isError || f.data?.werven?.length !== 0 || f.data?.documentsoorten?.length !== 0) { leaks++; console.log(`✗ LEK mijn_fiche van de bot: ${f.text.slice(0, 160)}`); }
    console.log(`bot buiten zijn fiche: ${botCalls} tool-oproepen via /mcp`);
  }
}
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
