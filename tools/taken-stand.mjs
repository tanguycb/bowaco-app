// De stand van alle opdrachten en voorstellen van assistenten (3.4–3.11) op een canister, als JSON: migratiecheck 4b.5.
//   node tools/taken-stand.mjs <canister> <uit.json>              inleesopdrachten (per werf), nakijk- en controleopdrachten (per
//                                                                  nummer tot de teller), acties van bots, Te doen (beheerder en
//                                                                  calculator, enkel de voorstellen) en, als de code het kent, het
//                                                                  model van taak en voorstel (listTasks)
//   node tools/taken-stand.mjs vergelijk <voor.json> <na.json>     elk veld van "voor" moet in "na" gelijk zijn ("model" telt niet)
//   node tools/taken-stand.mjs model <na.json>                     elk dossier van "na" heeft precies één taak met dezelfde stand
// Enkel op een EIGEN lokaal net met de proefidentiteiten van tests/rollen.mjs (tools/lib.mjs weigert live). readAiCheck en
// readInvCheck zijn update-calls met een auditregel (de auditlog telt niet mee). De uitvoer bevat enkel verzonnen proefgegevens.
import { readFileSync, writeFileSync } from "node:fs";
import { backend } from "./lib.mjs";

const big = (_, v) => (typeof v === "bigint" ? `${v}n` : v);

if (process.argv[2] === "vergelijk") {
  const voor = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const na = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const diffs = [];
  const walk = (a, b, path) => {
    if (diffs.length > 100) return;
    if (a === null || typeof a !== "object") { if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return; }
    if (b === null || typeof b !== "object") { diffs.push(`${path}: ontbreekt na de upgrade`); return; }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) { diffs.push(`${path}: lengte ${a.length} → ${Array.isArray(b) ? b.length : "?"}`); return; }
      a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
      return;
    }
    for (const k of Object.keys(a)) walk(a[k], b[k], `${path}.${k}`);
  };
  for (const k of Object.keys(voor)) if (k !== "model") walk(voor[k], na[k], k);
  const n = (x) => `inlezen ${x.oaReads.length}, nakijken ${x.aiChecks.length}, controle ${x.invChecks.length}, acties ${x.actions.length}, Te doen ${x.todoAdmin.length}+${x.todoCalc.length}`;
  console.log(`  voor: ${n(voor)}\n  na:   ${n(na)}`);
  if (diffs.length) { console.log(diffs.slice(0, 40).join("\n")); process.exit(1); }
  process.exit(0);
}

if (process.argv[2] === "model") {
  const na = JSON.parse(readFileSync(process.argv[3], "utf8"));
  // Nummers staan in de JSON als "12n" (bigint).
  const n = (x) => String(x).replace(/n$/, "");
  for (const x of [...na.oaReads, ...na.aiChecks, ...na.invChecks, ...na.actions]) x.id = n(x.id);
  for (const t of na.model ?? []) for (const p of t.proposal) p.actionId = p.actionId.map(n);
  if (!na.model) { console.log("  geen model in de stand (oude code?)"); process.exit(1); }
  const tasks = new Map(na.model.map((t) => [t.key, t]));
  const bad = [];
  const OAR = { open: ["wacht", "bezig"], voorstel: ["voorstel"], geregistreerd: ["klaar"], afgewezen: ["klaar", "geannuleerd"], geannuleerd: ["geannuleerd", "klaar"], mislukt: ["mislukt"], ongedaan: ["klaar"] };
  const CHK = { open: ["wacht", "bezig"], voorstel: ["voorstel"], afgesloten: ["klaar", "geannuleerd"], geannuleerd: ["geannuleerd", "klaar"], mislukt: ["mislukt"] };
  const ACT = { proposed: "voorstel", accepted: "klaar", rejected: "klaar", done: "klaar", undone: "klaar", expired: "geannuleerd", failed: "mislukt" };
  for (const b of na.oaReads) { const t = tasks.get(`oaread:${b.id}`); if (!t || !OAR[b.status].includes(t.state) || (t.proposal.length === 1) !== b.hasProposal) bad.push(["oaread", b.id, b.status, t?.state]); }
  for (const b of na.aiChecks) { const t = tasks.get(`check:${b.id}`); if (!t || !CHK[b.status].includes(t.state)) bad.push(["check", b.id, b.status, t?.state]); }
  for (const b of na.invChecks) { const t = tasks.get(`invcheck:${b.id}`); if (!t || !CHK[b.status].includes(t.state)) bad.push(["invcheck", b.id, b.status, t?.state]); }
  const inJob = new Set(na.model.filter((t) => !t.key.startsWith("bot:")).flatMap((t) => t.proposal.flatMap((p) => p.actionId)).map(String));
  let own = 0;
  for (const a of na.actions) {
    const t = tasks.get(`bot:${a.id}`);
    const linked = inJob.has(String(a.id));
    if (t) own++;
    if ((t ? 1 : 0) + (linked ? 1 : 0) !== 1) bad.push(["actie", a.id, t ? "eigen taak" : "", linked ? "bij opdracht" : ""]);
    else if (t && t.state !== ACT[Object.keys(a.state)[0]]) bad.push(["actie", a.id, Object.keys(a.state)[0], t.state]);
  }
  const expected = na.oaReads.length + na.aiChecks.length + na.invChecks.length + own;
  console.log(`  model: ${na.model.length} taken = inlezen ${na.oaReads.length} + nakijken ${na.aiChecks.length} + controle ${na.invChecks.length} + losse acties ${own} (${expected}); voorstellen ${na.model.filter((t) => t.proposal.length).length}`);
  if (bad.length || na.model.length !== expected) { console.log(JSON.stringify(bad.slice(0, 20), big)); process.exit(1); }
  process.exit(0);
}

const cid = process.argv[2];
const out = process.argv[3];
if (!cid || !out) throw new Error("gebruik: node tools/taken-stand.mjs <canister> <uit.json>");
const admin = await backend("proef-admin", cid);
const calc = await backend("proef-calculator", cid);
const ex = await admin.exportIntern();
const counter = (k) => Number((ex.counters.find(([n]) => n === k) ?? [k, 0n])[1]);
const works = await admin.listWorks();
const stand = { oaReads: [], aiChecks: [], invChecks: [], actions: [], todoAdmin: [], todoCalc: [] };
for (const w of works) stand.oaReads.push(...(await admin.listOaReads(w.id)));
stand.oaReads.sort((a, b) => Number(a.id - b.id));
for (let id = 1; id <= counter("aiCheck"); id++) {
  const r = await admin.readAiCheck(BigInt(id));
  if ("ok" in r) stand.aiChecks.push(r.ok);
}
for (let id = 1; id <= counter("invCheck"); id++) {
  const r = await admin.readInvCheck(BigInt(id));
  if ("ok" in r) stand.invChecks.push(r.ok);
}
// Na de reads (die de stand van een opdracht kunnen bijwerken): de briefs opnieuw, zodat voor en na hetzelfde moment tonen.
stand.aiChecks = stand.aiChecks.map((x) => ({ ...x.brief, confidence: x.confidence, picks: x.picks, findings: x.findings }));
stand.invChecks = stand.invChecks.map((x) => ({ ...x.brief, result: x.result }));
stand.actions = (await admin.botActions(false)).sort((a, b) => Number(a.id - b.id));
const cDay = BigInt(Math.floor(Number((await admin.auditLog(0n, 1n))[0].at / 1_000_000n) / 86_400_000));
const todoAll = async (x) => {
  const all = [];
  for (let off = 0n; ; off += 100n) {
    const p = await x.myTodo({ day: cDay, offset: off, limit: 100n, snoozed: false, kind: "voorstel" });
    all.push(...p.items);
    if (all.length >= Number(p.total) || p.items.length === 0) break;
  }
  // De leeftijd in dagen hangt van het uur van de lezing af; de rest moet gelijk zijn.
  return all.map(({ age, ...r }) => r).sort((a, b) => a.key.localeCompare(b.key));
};
stand.todoAdmin = await todoAll(admin);
stand.todoCalc = await todoAll(calc);
// Het model enkel als de canister het kent (de oude code heeft geen listTasks, ook al staat het in de .did van deze map).
try {
  const model = [];
  for (let off = 0n; ; off += 100n) {
    const p = await admin.listTasks({ workId: [], openOnly: false, kind: "", offset: off, limit: 100n });
    model.push(...p.items);
    if (model.length >= Number(p.total) || p.items.length === 0) break;
  }
  stand.model = model;
} catch (e) {
  if (!/no query method|has no update method|method-not-found|IC0536/i.test(String(e))) throw e;
}
writeFileSync(out, JSON.stringify(stand, big, 1));
console.log(`  stand: inlezen ${stand.oaReads.length}, nakijken ${stand.aiChecks.length}, controle ${stand.invChecks.length}, acties ${stand.actions.length}, Te doen ${stand.todoAdmin.length}+${stand.todoCalc.length}${stand.model ? `, model ${stand.model.length}` : ""} → ${out}`);
