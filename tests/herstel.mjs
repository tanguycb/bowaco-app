// Hersteltest (architectuur M9, T16; stap 1.9): export → bestanden → herstel op een LEGE canister → vergelijking.
// Het draaiboek staat in docs/herstel.md.
//   node tests/herstel.mjs export <canister> <map>            als testbeheerder (proef-admin): intern.json,
//                                                             vertrouwelijk.json, audit.json in <map> (buiten git!)
//   node tests/herstel.mjs herstel <lege-canister> <map>      stuurt alles in stukken; de opstartcode komt uit
//                                                             BOWACO_CODE, anders ~/.bowaco/test-opstartcode.txt (lokaal)
//   node tests/herstel.mjs vergelijk <map> <herstelde-canister>   export opnieuw en vergelijk per collectie (hash)
//   node tests/herstel.mjs alles <bron> <map> <doel>          de drie stappen na elkaar
// De exportbestanden bevatten persoonsgegevens en opslag-URL's: bewaar ze versleuteld, nooit in git of chat.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backend, KEYDIR, ok, Principal } from "../tools/lib.mjs";

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (!cmd) {
  console.error("gebruik: node tests/herstel.mjs export|herstel|vergelijk|alles …");
  process.exit(2);
}

// ── JSON met Candid-waarden: bigint, Principal en bytes blijven herkenbaar ──
// (JSON.stringify roept eerst toJSON() van een Principal aan: die geeft { __principal__: "…" }.)
const replacer = (_, v) => {
  if (typeof v === "bigint") return { $n: v.toString() };
  if (v instanceof Uint8Array) return { $b: Buffer.from(v).toString("base64") };
  if (v && typeof v === "object" && typeof v.__principal__ === "string") return { $p: v.__principal__ };
  return v;
};
const reviver = (_, v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("$n" in v && Object.keys(v).length === 1) return BigInt(v.$n);
    if ("$b" in v && Object.keys(v).length === 1) return new Uint8Array(Buffer.from(v.$b, "base64"));
    if ("$p" in v && Object.keys(v).length === 1) return Principal.fromText(v.$p);
    if ("__principal__" in v && Object.keys(v).length === 1) return Principal.fromText(v.__principal__);
  }
  return v;
};
const save = (dir, name, data) => writeFileSync(join(dir, name), JSON.stringify(data, replacer), { mode: 0o600 });
const load = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"), reviver);

async function exportAll(cid, dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const admin = await backend("proef-admin", cid);
  const t0 = Date.now();
  // In stukken (exportChunk): één antwoord van exportIntern wordt bij ± 100 werven groter dan een IC-bericht (O-11).
  const part = async (kind, n = 500) => {
    const out = [];
    for (let from = 0; ; from += n) {
      const r = ok(await admin.exportChunk(kind, BigInt(from), BigInt(n)));
      const xs = Object.values(r)[0]; // de variant draagt de collectie ("confidentialFiles" komt terug als #files)
      if (!Array.isArray(xs)) return xs; // settings: één record
      out.push(...xs);
      if (xs.length < n) return out;
    }
  };
  const INTERN = ["persons", "links", "linkHistory", "invites", "orgs", "works", "memberships", "files", "workInfo", "documents", "orgContacts", "personContacts", "tasks", "assignments", "dependencies", "calendarBlocks", "taskChanges", "templates", "absences", "absenceChanges", "capacity", "importBatches", "importKeys", "appointments", "vehicles", "dayReports", "reportChanges", "attendances", "hoursConfirmations", "workDone", "materials", "photos", "issues", "trips", "robots", "proposals", "notifications", "lookups", "values", "sequences", "counters", "planVersions", "reportKeys", "ops"];
  // Collecties die pas in een latere stap bestaan (1b.1: vergunningen): een oudere canister kent ze niet → leeg.
  const LATER = ["permits", "permitChanges", "municipalities", "procedures", "permitAlerts", "jobs", "mailLog", "withholdingChecks", "declarations", "libChapters", "libItems", "libItemVersions", "quotes", "quoteVersions", "quoteChapters", "quoteLines"];
  // Collecties met lange teksten (tot 4.000 tekens per record) in kleinere stukken: 500 × 4 KB raakt de berichtgrens.
  const SIZE = { libItems: 100, libItemVersions: 50, quoteLines: 100 };
  const partOpt = async (k) => { try { return await part(k, SIZE[k] ?? 500); } catch (e) { if (/Onbekende collectie/.test(String(e))) return []; throw e; } };
  const intern = { version: (await admin.me()).version, at: BigInt(Date.now()) * 1_000_000n, trades: await admin.listTrades(true), settings: await part("settings"), auditCount: await admin.auditCount() };
  for (const k of INTERN) intern[k] = await part(k);
  for (const k of LATER) intern[k] = await partOpt(k);
  const vertrouwelijk = { at: intern.at, orgs: await part("orgConfidential"), persons: await part("personConfidential"), files: await part("confidentialFiles"), workConfidential: await part("workConfidential"), workConfidentialHistory: await part("workConfidentialHistory") };
  // 2.2: de prijzen van de postenbibliotheek (vertrouwelijk; een oudere canister kent ze niet → leeg).
  for (const k of ["libCosts", "libSells", "libSellVersions"]) vertrouwelijk[k] = await partOpt(k);
  // 2.4: de prijs per offertelijn en de standaardmarge per versie (vertrouwelijk; een oudere canister kent ze niet → leeg).
  for (const k of ["quotePrices", "quoteVersionConf"]) vertrouwelijk[k] = await partOpt(k);
  // Auditlog in stukken (nieuwste eerst) → chronologisch bewaren. De log groeit tijdens het lezen (elke
  // export-oproep schrijft een regel), dus dubbels eruit en op tijd sorteren.
  const seen = new Set();
  const audit = [];
  for (let from = 0; ; from += 500) {
    const page = await admin.auditLog(BigInt(from), 500n);
    for (const e of page) {
      const k = `${e.at}|${e.action}|${e.who.toText()}|${e.detail}`;
      if (!seen.has(k)) { seen.add(k); audit.push(e); }
    }
    if (page.length < 500) break;
  }
  // Bladzijden komen nieuwste-eerst: omkeren geeft de volgorde van de log zelf (regels uit één ronde delen een tijdstip,
  // dus sorteren op tijd zou ze kunnen verwisselen).
  audit.reverse();
  save(dir, "intern.json", intern);
  save(dir, "vertrouwelijk.json", vertrouwelijk);
  save(dir, "audit.json", audit);
  const size = (n) => (readFileSync(join(dir, n)).length / 1024).toFixed(0);
  console.log(`export van ${cid} → ${dir} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(`  intern.json ${size("intern.json")} KiB · vertrouwelijk.json ${size("vertrouwelijk.json")} KiB · audit.json ${size("audit.json")} KiB (${audit.length} regels, auditCount ${intern.auditCount})`);
  console.log(`  ${intern.persons.length} personen, ${intern.orgs.length} organisaties, ${intern.works.length} werven, ${intern.tasks.length} taken, ${intern.dayReports.length} verslagen, ${intern.files.length} bestanden`);
  return { intern, vertrouwelijk, audit };
}

function codeFor() {
  if (process.env.BOWACO_CODE) return process.env.BOWACO_CODE;
  const f = join(KEYDIR, "test-opstartcode.txt");
  if (!existsSync(f)) throw new Error("geen opstartcode: zet BOWACO_CODE (enkel in je eigen Terminal) of gebruik de testcode lokaal");
  return readFileSync(f, "utf8").trim();
}

const chunks = (xs, n) => {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function restoreAll(cid, dir) {
  const code = codeFor();
  const admin = await backend("proef-admin", cid);
  const intern = load(dir, "intern.json");
  const vertrouwelijk = load(dir, "vertrouwelijk.json");
  const audit = load(dir, "audit.json");
  const t0 = Date.now();
  ok(await admin.restoreBegin(code));
  let calls = 0;
  const send = async (tag, xs, n = 200) => {
    let total = 0;
    for (const part of chunks(xs, n)) {
      total += Number(ok(await admin.restoreChunk(code, { [tag]: part })));
      calls++;
    }
    if (xs.length) console.log(`  ${tag.padEnd(24)} ${String(total).padStart(6)}`);
  };
  // Volgorde: personen en organisaties eerst (namen), dan werven, dan de rest; tellers als laatste.
  await send("persons", intern.persons);
  await send("links", intern.links);
  await send("linkHistory", intern.linkHistory);
  await send("invites", intern.invites);
  await send("orgs", intern.orgs);
  await send("orgConfidential", vertrouwelijk.orgs);
  await send("personConfidential", vertrouwelijk.persons);
  await send("works", intern.works);
  await send("workInfo", intern.workInfo);
  await send("workConfidential", vertrouwelijk.workConfidential);
  await send("workConfidentialHistory", vertrouwelijk.workConfidentialHistory);
  await send("memberships", intern.memberships);
  await send("files", intern.files, 100);
  await send("files", vertrouwelijk.files, 100);
  await send("documents", intern.documents);
  await send("orgContacts", intern.orgContacts);
  await send("personContacts", intern.personContacts);
  await send("lookups", intern.lookups);
  await send("values", intern.values);
  await send("sequences", intern.sequences);
  calls++;
  ok(await admin.restoreChunk(code, { settings: intern.settings }));
  await send("tasks", intern.tasks);
  await send("assignments", intern.assignments);
  await send("dependencies", intern.dependencies);
  await send("calendarBlocks", intern.calendarBlocks);
  await send("taskChanges", intern.taskChanges, 300);
  await send("templates", intern.templates, 20);
  await send("planVersions", intern.planVersions, 500);
  await send("absences", intern.absences);
  await send("absenceChanges", intern.absenceChanges);
  await send("capacity", intern.capacity);
  await send("importBatches", intern.importBatches);
  await send("importKeys", intern.importKeys, 500);
  await send("appointments", intern.appointments);
  await send("vehicles", intern.vehicles);
  await send("dayReports", intern.dayReports);
  await send("reportKeys", intern.reportKeys, 500);
  await send("reportChanges", intern.reportChanges);
  await send("attendances", intern.attendances);
  await send("hoursConfirmations", intern.hoursConfirmations);
  await send("workDone", intern.workDone);
  await send("materials", intern.materials);
  await send("photos", intern.photos);
  await send("issues", intern.issues);
  await send("trips", intern.trips);
  await send("ops", intern.ops, 500);
  await send("robots", intern.robots);
  await send("proposals", intern.proposals, 50);
  await send("notifications", intern.notifications, 300);
  await send("municipalities", intern.municipalities ?? []);
  await send("procedures", intern.procedures ?? []);
  await send("permits", intern.permits ?? []);
  await send("permitChanges", intern.permitChanges ?? [], 300);
  await send("permitAlerts", intern.permitAlerts ?? [], 500);
  await send("jobs", intern.jobs ?? [], 300);
  await send("mailLog", intern.mailLog ?? [], 500);
  await send("withholdingChecks", intern.withholdingChecks ?? [], 300);
  await send("declarations", intern.declarations ?? [], 300);
  // 2.2: postenbibliotheek (de indexen herrekent restoreFinish).
  await send("libChapters", intern.libChapters ?? []);
  await send("libItems", intern.libItems ?? [], 100);
  await send("libItemVersions", intern.libItemVersions ?? [], 100);
  await send("libCosts", vertrouwelijk.libCosts ?? [], 300);
  await send("libSells", vertrouwelijk.libSells ?? [], 300);
  await send("libSellVersions", vertrouwelijk.libSellVersions ?? [], 300);
  // 2.4: offertes (de indexen herrekent restoreFinish).
  await send("quotes", intern.quotes ?? [], 300);
  await send("quoteVersions", intern.quoteVersions ?? [], 200);
  await send("quoteChapters", intern.quoteChapters ?? [], 300);
  await send("quoteLines", intern.quoteLines ?? [], 100);
  await send("quotePrices", vertrouwelijk.quotePrices ?? [], 300);
  await send("quoteVersionConf", vertrouwelijk.quoteVersionConf ?? [], 300);
  await send("audit", audit, 500);
  await send("counters", intern.counters, 500);
  const s = ok(await admin.restoreFinish(code));
  console.log(`herstel op ${cid}: ${calls + 2} oproepen in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${s.persons} personen, ${s.works} werven, ${s.tasks} taken, ${s.reports} verslagen, ${s.files} bestanden, ${s.audit} auditregels`);
  return s;
}

// ── Vergelijken: per collectie een hash over de gesorteerde, genormaliseerde inhoud ──
const canon = (x) => JSON.stringify(x, (_, v) => {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  if (v && typeof v === "object" && typeof v.__principal__ === "string") return v.__principal__;
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
  return v;
});
const hash = (x) => createHash("sha256").update(canon(x)).digest("hex").slice(0, 12);
const byKey = (xs, key) => [...xs].sort((a, b) => (canon(key(a)) < canon(key(b)) ? -1 : canon(key(a)) > canon(key(b)) ? 1 : 0));

function normalize(intern, vertrouwelijk, audit) {
  const id = (x) => x.id;
  const out = {
    persons: byKey(intern.persons, id),
    links: byKey(intern.links, (l) => l.principal.toText()),
    linkHistory: byKey(intern.linkHistory, id),
    // Open codes komen na een herstel als vervallen terug (hun hash staat niet in de export): gelijkstellen.
    invites: byKey(intern.invites, id).map((i) => ("open" in i.state ? { ...i, state: { expired: null } } : { ...i, state: Object.keys(i.state)[0] === "expired" ? { expired: null } : i.state })),
    orgs: byKey(intern.orgs, id),
    works: byKey(intern.works, id),
    memberships: byKey(intern.memberships, id),
    files: byKey(intern.files, id),
    workInfo: byKey(intern.workInfo, (x) => x.workId),
    documents: byKey(intern.documents, id),
    orgContacts: byKey(intern.orgContacts, (x) => x.orgId),
    personContacts: byKey(intern.personContacts, (x) => x.personId),
    trades: intern.trades,
    lookups: byKey(intern.lookups, (x) => [x.list, x.key]),
    values: byKey(intern.values.filter(([k]) => !k.startsWith("herstel")), (x) => x[0]),
    sequences: byKey(intern.sequences, (x) => x[0]),
    counters: byKey(intern.counters, (x) => x[0]),
    tasks: byKey(intern.tasks, id),
    assignments: byKey(intern.assignments, id),
    dependencies: byKey(intern.dependencies, id),
    calendarBlocks: byKey(intern.calendarBlocks, id),
    taskChanges: byKey(intern.taskChanges, id),
    templates: byKey(intern.templates, (x) => x.key),
    planVersions: byKey(intern.planVersions, (x) => x[0]),
    absences: byKey(intern.absences, id),
    absenceChanges: byKey(intern.absenceChanges, id),
    capacity: byKey(intern.capacity, (x) => x.key),
    importBatches: byKey(intern.importBatches, id),
    importKeys: byKey(intern.importKeys, (x) => x.key),
    appointments: byKey(intern.appointments, id),
    vehicles: byKey(intern.vehicles, id),
    dayReports: byKey(intern.dayReports, id),
    reportKeys: byKey(intern.reportKeys, (x) => x[0]),
    reportChanges: byKey(intern.reportChanges, id),
    attendances: byKey(intern.attendances, id),
    hoursConfirmations: byKey(intern.hoursConfirmations, id),
    workDone: byKey(intern.workDone, id),
    materials: byKey(intern.materials, id),
    photos: byKey(intern.photos, id),
    issues: byKey(intern.issues, id),
    trips: byKey(intern.trips, id),
    ops: byKey(intern.ops, (x) => x.opId),
    robots: byKey(intern.robots, (x) => x.principal.toText()),
    proposals: byKey(intern.proposals, id),
    notifications: byKey(intern.notifications, id),
    permits: byKey(intern.permits ?? [], id),
    permitChanges: byKey(intern.permitChanges ?? [], id),
    municipalities: byKey(intern.municipalities ?? [], id),
    procedures: byKey(intern.procedures ?? [], (x) => [x.municipalityId, x.kind]),
    permitAlerts: byKey(intern.permitAlerts ?? [], (x) => x[0]),
    // 1b.3: een geleasete opdracht komt na een herstel terug in de wachtrij (de lease hoort bij de oude canister).
    withholdingChecks: byKey(intern.withholdingChecks ?? [], id),
    declarations: byKey(intern.declarations ?? [], (x) => x.workId),
    // mail-caffeine: een mail die "bij de maildienst" stond (lease van de app, aaaaa-aa) komt terug als onzeker.
    jobs: byKey(intern.jobs ?? [], id).map((j) => {
      const app = "leased" in j.state && j.state.leased.by.toText() === "aaaaa-aa";
      const onz = "failed" in j.state && j.state.failed.why.startsWith("onzeker: stond bij de maildienst tijdens de export");
      return app || onz ? { ...j, state: { onzeker: null } } : "leased" in j.state ? { ...j, state: { queued: null } } : j;
    }),
    mailLog: byKey(intern.mailLog ?? [], id),
    libChapters: byKey(intern.libChapters ?? [], id),
    libItems: byKey(intern.libItems ?? [], id),
    libItemVersions: byKey(intern.libItemVersions ?? [], id),
    quotes: byKey(intern.quotes ?? [], id),
    quoteVersions: byKey(intern.quoteVersions ?? [], id),
    quoteChapters: byKey(intern.quoteChapters ?? [], id),
    quoteLines: byKey(intern.quoteLines ?? [], id),
    settings: intern.settings,
    "vertrouwelijk.orgs": byKey(vertrouwelijk.orgs, (x) => x[0]),
    "vertrouwelijk.persons": byKey(vertrouwelijk.persons, (x) => x[0]),
    "vertrouwelijk.files": byKey(vertrouwelijk.files, id),
    "vertrouwelijk.workConfidential": byKey(vertrouwelijk.workConfidential, (x) => x.workId),
    "vertrouwelijk.workConfidentialHistory": byKey(vertrouwelijk.workConfidentialHistory, id),
    "vertrouwelijk.libCosts": byKey(vertrouwelijk.libCosts ?? [], id),
    "vertrouwelijk.libSells": byKey(vertrouwelijk.libSells ?? [], (x) => x.itemId),
    "vertrouwelijk.libSellVersions": byKey(vertrouwelijk.libSellVersions ?? [], id),
    "vertrouwelijk.quotePrices": byKey(vertrouwelijk.quotePrices ?? [], (x) => x.lineId),
    "vertrouwelijk.quoteVersionConf": byKey(vertrouwelijk.quoteVersionConf ?? [], (x) => x.versionId),
    audit,
  };
  return out;
}

async function compare(dir, cid) {
  const a = normalize(load(dir, "intern.json"), load(dir, "vertrouwelijk.json"), load(dir, "audit.json"));
  const tmp = join(dir, "na-herstel");
  const b0 = await exportAll(cid, tmp);
  // De herstelde auditlog = 'herstel-begonnen', dan de oude regels, dan 'herstel-klaar' en de regels van deze
  // vergelijking (export-deel …): zonder de herstelregels telt enkel het eerste stuk, even lang als de bron.
  const restoredAudit = b0.audit.filter((e) => !/^herstel-/.test(e.action)).slice(0, a.audit.length);
  const b = normalize(b0.intern, b0.vertrouwelijk, restoredAudit);
  let same = 0;
  let diff = 0;
  console.log("\ncollectie                                  bron    → hersteld   (aantal)");
  for (const k of Object.keys(a)) {
    const ha = hash(a[k]);
    const hb = hash(b[k]);
    const na = Array.isArray(a[k]) ? a[k].length : 1;
    const nb = Array.isArray(b[k]) ? b[k].length : 1;
    const eq = ha === hb;
    eq ? same++ : diff++;
    console.log(`${eq ? "✓" : "✗"} ${k.padEnd(40)} ${ha} ${eq ? "=" : "≠"} ${hb}   (${na}${na === nb ? "" : ` → ${nb}`})`);
    if (!eq && Array.isArray(a[k]) && Array.isArray(b[k])) {
      const sa = new Map(a[k].map((x) => [canon(x), x]));
      const sb = new Map(b[k].map((x) => [canon(x), x]));
      const onlyA = [...sa.keys()].filter((x) => !sb.has(x)).slice(0, 2);
      const onlyB = [...sb.keys()].filter((x) => !sa.has(x)).slice(0, 2);
      for (const x of onlyA) console.log(`    enkel in de bron:      ${x.slice(0, 220)}`);
      for (const x of onlyB) console.log(`    enkel in het herstel:  ${x.slice(0, 220)}`);
    }
  }
  console.log(`\n${same} collecties gelijk, ${diff} verschillend`);
  return diff === 0;
}

if (cmd === "export") {
  await exportAll(a1, a2);
} else if (cmd === "herstel") {
  await restoreAll(a1, a2);
} else if (cmd === "vergelijk") {
  process.exit((await compare(a1, a2)) ? 0 : 1);
} else if (cmd === "alles") {
  await exportAll(a1, a2);
  await restoreAll(a3, a2);
  process.exit((await compare(a2, a3)) ? 0 : 1);
} else {
  console.error(`onbekende opdracht: ${cmd}`);
  process.exit(2);
}
