// Stap 1.5: het importbestand van tools/plan-analyse.py (plan.json) in de app zetten, of een batch terugdraaien.
// Idempotent (vaste sleutels per blok, taak, uitvoerreeks en afspraak): tweemaal draaien maakt geen dubbels.
// Altijd eerst een PROEFRONDE over alle blokken; `--echt` bewaart. Alleen een beheerder mag importeren (R32).
//
//   ICP_HOST=http://localhost:8041 node tools/plan-import.mjs --plan plan.json --canister <id>                  (proef)
//   ICP_HOST=http://localhost:8041 node tools/plan-import.mjs --plan plan.json --canister <id> --echt           (bewaren)
//   node tools/plan-import.mjs --plan plan-anoniem.json --canister <draft-id> --identity proef-admin --echt     (draft: enkel anonieme data!)
//   node tools/plan-import.mjs --terugdraaien <batch> --canister <id> [--echt]                                   (batch archiveren)
//
// Opties: --identity <naam>   sleutel in ~/.bowaco (standaard proef-admin)
//         --batch <naam>      naam van de batch (standaard die in plan.json)
//         --rapport <map>     schrijft het validatierapport (Markdown + CSV) in die map (NIET in git: echte namen)
//         --alleen <Bnn,Bnn>  enkel die blokken (proef of test)
// Een naam die niet in de OA-database staat (alias, 1.2) wordt NOOIT een nieuwe firma: ze staat in het rapport.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { backend } from "./lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const cid = arg("canister");
const echt = process.argv.includes("--echt");
if (!cid) throw new Error("gebruik: node tools/plan-import.mjs --plan plan.json --canister <id> [--echt] [--identity naam] [--rapport map]  |  --terugdraaien <batch>");
const actor = await backend(arg("identity", "proef-admin"), cid);

// ── Terugdraaien ───────────────────────────────────────────────────────────
const terug = arg("terugdraaien");
if (terug) {
  const dry = await actor.rollbackImport(terug, true);
  if ("err" in dry) throw new Error(dry.err);
  const show = (r) => `${r.works} werven · ${r.tasks} taken · ${r.assignments} uitvoerders · ${r.appointments} afspraken${r.keptWorks.length ? ` · behouden (er staan andere taken in): ${r.keptWorks.join(", ")}` : ""}`;
  console.log(`PROEFRONDE terugdraaien «${terug}»: ${show(dry.ok)}`);
  if (echt) {
    const real = await actor.rollbackImport(terug, false);
    if ("err" in real) throw new Error(real.err);
    console.log(`TERUGGEDRAAID «${terug}»: ${show(real.ok)}`);
  } else console.log("niets gewijzigd (voeg --echt toe om te archiveren)");
  process.exit(0);
}

const planPath = arg("plan");
if (!planPath) throw new Error("--plan ontbreekt");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const batch = arg("batch", plan.batch);
const only = arg("alleen") ? new Set(String(arg("alleen")).split(",")) : null;
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const status = { planned: null, done: null, busy: null, delayed: null, blocked: null };

const byCode = Object.fromEntries(plan.blokken.map((b) => [b.code, b]));
function blockInput(b) {
  const doel = b.besluit.doel ? byCode[b.besluit.doel].key : null;
  const decision = b.besluit.beslissing === "vervolg" ? { followUp: doel } : b.besluit.beslissing === "deelwerf" ? { sub: doel } : { fresh: null };
  return {
    key: b.key, name: b.name, street: b.street, number: b.number, zip: b.zip, city: b.city, vatBp: BigInt(b.vatBp), decision,
    tasks: b.tasks.map((t, i) => ({
      key: t.key, title: t.title, note: t.note, responsible: opt(t.responsible),
      status: { [t.status]: null }, percent: BigInt(t.percent), start: BigInt(t.start), workdays: BigInt(t.workdays), order: BigInt(i + 1),
      runs: t.runs.map((r) => ({ key: r.key, name: r.name, from: BigInt(r.from), to: BigInt(r.to), note: r.note })),
      appointments: t.appointments.map((a) => ({ key: a.key, day: BigInt(a.day), time: opt(a.time), text: a.text, name: opt(a.name), weekFallback: a.weekFallback })),
      extra: t.extra,
    })),
  };
}

const blocks = plan.blokken.filter((b) => b.besluit.beslissing !== "negeren" && (!only || only.has(b.code)));
const ignored = plan.blokken.filter((b) => b.besluit.beslissing === "negeren").map((b) => b.code);
const num = (x) => Number(x);
const tot = { workCreated: 0, workExisting: 0, tasksCreated: 0, tasksExisting: 0, assignmentsCreated: 0, assignmentsExisting: 0, appointmentsCreated: 0, appointmentsExisting: 0 };
const unmatched = new Map();
const problems = [];
const perBlock = [];

async function run(dryRun) {
  const known = [];
  const out = [];
  for (const b of blocks) {
    const res = await actor.importPlanning(dryRun, batch, plan.titel ?? batch, known, blockInput(b));
    if ("err" in res) { problems.push(`${b.code}: ${res.err}`); continue; }
    out.push({ b, r: res.ok });
    known.push(b.key);
  }
  return out;
}

// 1. Altijd eerst de proefronde
const dry = await run(true);
let shown = dry;
if (problems.length) {
  console.log("Proefronde met fouten; er wordt niets bewaard:");
  for (const p of problems) console.log("  ! " + p);
  process.exit(2);
}
// 2. Echte ronde
if (echt) shown = await run(false);
if (problems.length) { for (const p of problems) console.log("  ! " + p); }

for (const { b, r } of shown) {
  for (const k of Object.keys(tot)) tot[k] += num(r[k]);
  for (const [n, c] of r.unmatched) unmatched.set(n, (unmatched.get(n) ?? 0) + num(c));
  for (const p of r.problems) problems.push(`${b.code}: ${p}`);
  perBlock.push({ b, r });
}
const modus = echt ? "ECHT BEWAARD" : "PROEFRONDE (niets bewaard)";
console.log(`\n${modus}: batch «${batch}», ${blocks.length} blokken${ignored.length ? ` (${ignored.length} genegeerd)` : ""}`);
console.log(`werven nieuw ${tot.workCreated} · bestaand/vervolg ${tot.workExisting}`);
console.log(`taken nieuw ${tot.tasksCreated} · bestonden ${tot.tasksExisting}`);
console.log(`uitvoerreeksen nieuw ${tot.assignmentsCreated} · bestonden ${tot.assignmentsExisting}`);
console.log(`afspraken nieuw ${tot.appointmentsCreated} · bestonden ${tot.appointmentsExisting}`);
console.log(`namen zonder firma in de database: ${unmatched.size} (${[...unmatched.values()].reduce((a, b) => a + b, 0)} plaatsen)`);
console.log(`bevindingen in het rapport: ${plan.bevindingen.length}`);
for (const p of problems) console.log(`  ! ${p}`);

// ── Validatierapport (Markdown + CSV) voor Alexis ──────────────────────────
const rapportMap = arg("rapport");
if (rapportMap) {
  mkdirSync(rapportMap, { recursive: true });
  const taskCount = new Map();
  for (const b of blocks) for (const t of b.tasks) {
    for (const n of new Set([...(t.responsible ? [t.responsible] : []), ...t.runs.map((r) => r.name)])) taskCount.set(n.toUpperCase(), (taskCount.get(n.toUpperCase()) ?? 0) + 1);
  }
  const names = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const csv = [["SOORT", "BLOK", "WERF", "RIJ", "KOLOM", "WAT", "VOORSTEL", "BESLISSING"].join(";")];
  for (const b of plan.blokken) {
    const v = b.voorstel;
    const voorstel = v.beslissing === "nieuw" ? "nieuwe werf" : `${v.beslissing} van ${v.doel} (${v.zekerheid})`;
    csv.push(["blok", b.code, b.header, b.rij, "", `${b.tasks.length} taken, ${b.van || "?"} → ${b.tot || "?"}`, voorstel + (v.reden ? ": " + v.reden : ""), ""].map(q).join(";"));
  }
  for (const [n, c] of names) csv.push(["naam zonder firma", "", "", "", "", `${n}: ${c} plaatsen in ${taskCount.get(n) ?? "?"} taken`, "beslis in het werkblad van 1.2 (firma, dezelfde als, persoon, negeren)", ""].map(q).join(";"));
  for (const f of plan.bevindingen) csv.push(["bevinding: " + f.soort, f.blok, byCode[f.blok]?.header ?? "", f.rij, f.kolom, f.tekst, f.ernst, ""].map(q).join(";"));
  for (const [soort, weken] of Object.entries(plan.blokkeringen)) csv.push(["blokkering: " + soort, "", "", "", "", `weken van ${weken.join(", ")}`, "kalenderblok voor het bedrijf of de werf aanmaken?", ""].map(q).join(";"));
  for (const b of blocks) for (const t of b.tasks) for (const a of t.appointments) csv.push(["afspraak", b.code, b.header, t.rij, a.col, `${t.title}: ${a.date}${a.time ? " " + a.time : ""} · ${a.text}`, a.weekFallback ? "datum is een vangnet (maandag van de week)" : "", ""].map(q).join(";"));
  const csvName = join(rapportMap, "BOWACO_validatie_planning_1.5.csv");
  writeFileSync(csvName, "﻿" + csv.join("\n") + "\n");

  const cats = {};
  for (const f of plan.bevindingen) cats[f.soort] = (cats[f.soort] ?? 0) + 1;
  const md = [
    "# Validatierapport import planning (stap 1.5)", "",
    `*Bron: ${plan.bron}. ${modus}, batch «${batch}». Bevat echte werfnamen, adressen en firmanamen: **niet in git, niet doorsturen via een openbaar kanaal**.*`, "",
    "## Samenvatting", "",
    "| | |", "|---|---|",
    `| Werfblokken in de Excel | ${plan.blokken.length} (genegeerd: ${ignored.length}) |`,
    `| Werven ${echt ? "aangemaakt" : "die zouden ontstaan (proefronde)"} | ${tot.workCreated} (vervolgen in een bestaande werf: ${tot.workExisting}) |`,
    `| Taken | ${tot.tasksCreated} nieuw, ${tot.tasksExisting} bestonden al |`,
    `| Uitvoerreeksen (firma + aaneengesloten weken) | ${tot.assignmentsCreated} nieuw, ${tot.assignmentsExisting} bestonden al |`,
    `| Afspraken (vrije celtekst met datum) | ${tot.appointmentsCreated} nieuw, ${tot.appointmentsExisting} bestonden al |`,
    `| Namen zonder firma in de database | ${names.length} (${names.reduce((a, [, c]) => a + c, 0)} plaatsen): komen in geen enkele firma terecht tot Alexis beslist |`,
    `| Bevindingen (cellen, kopdatums, taken zonder week, …) | ${plan.bevindingen.length} |`,
    `| Blokkeringen | ${Object.entries(plan.blokkeringen).map(([k, v]) => `${k}: ${v.length} week/weken`).join(", ") || "geen"} |`, "",
    "De kolom is de weekas (kolom D = maandag 14.10.2024). Taken van vóór de week van de planning (" + plan.statusGrens + ") staan op *klaar*, de rest op *gepland*; dat is een voorstel.", "",
    "## 1. Blokken: nieuwe werf, vervolg of deelwerf", "",
    "Standaard volgt de import alleen een **zeker** voorstel (zelfde naam of adres); een vermoedelijk voorstel blijft een nieuwe werf tot er beslist is. Vul BESLISSING in de CSV: `nieuw`, `vervolg van Bnn`, `deelwerf van Bnn` of `negeren`.", "",
    "| Blok | Werf | Taken | Periode | Voorstel | Besluit in deze ronde |", "|---|---|---|---|---|---|",
    ...plan.blokken.map((b) => `| ${b.code} | ${b.header} | ${b.tasks.length} | ${b.van || "?"} → ${b.tot || "?"} | ${b.voorstel.beslissing === "nieuw" ? "nieuwe werf" : `${b.voorstel.beslissing} van ${b.voorstel.doel} (${b.voorstel.zekerheid}): ${b.voorstel.reden}`} | ${b.besluit.beslissing}${b.besluit.doel ? " van " + b.besluit.doel : ""} (${b.besluit.bron}) |`), "",
    "## 2. Namen die niet in de OA-database staan", "",
    "Geen enkele naam wordt een nieuwe firma. De taak krijgt wel zijn weken; de naam staat in de notitie van de taak. Beslis ze in het werkblad van stap 1.2 (`BOWACO_validatie_onderaannemers_1.2.csv`) en importeer ze eerst; draai daarna deze import opnieuw (bestaande taken blijven, nieuwe uitvoerders komen erbij bij een nieuwe batch).", "",
    "| Naam | Plaatsen | Taken |", "|---|---|---|",
    ...names.map(([n, c]) => `| ${n} | ${c} | ${taskCount.get(n) ?? "?"} |`), "",
    "## 3. Bevindingen", "",
    "| Soort | Aantal |", "|---|---|", ...Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), "",
    "De volledige lijst (blok, rij, kolom, tekst) staat in de CSV. Ernst *let op* vraagt een blik van Alexis, *info* is ter kennisgeving.", "",
    ...["let op"].flatMap((e) => ["### Let op", "", "| Blok | Rij | Kol. | Soort | Wat |", "|---|---|---|---|---|", ...plan.bevindingen.filter((f) => f.ernst === e).map((f) => `| ${f.blok} | ${f.rij} | ${f.kolom} | ${f.soort} | ${f.tekst.replace(/\|/g, "/")} |`), ""]),
    "## 4. Blokkeringen (bouwverlof, STOP, congé)", "",
    ...Object.entries(plan.blokkeringen).map(([k, v]) => `- **${k}**: week van ${v.join(", ")}: kalenderblok aanmaken? (niet gedaan door de import)`), "",
    "## 5. Afspraken", "", `${tot.appointmentsCreated + tot.appointmentsExisting} afspraken uit vrije celtekst; elk met dag, uur en tekst in de CSV (soort *afspraak*). Een afspraak met «vangnet» heeft geen datum in de tekst.`, "",
    ...(problems.length ? ["## Problemen", "", ...problems.map((p) => `- ${p}`), ""] : []),
  ];
  const mdName = join(rapportMap, "BOWACO_validatie_planning_1.5.md");
  writeFileSync(mdName, md.join("\n") + "\n");
  console.log(`rapport: ${mdName}\n         ${csvName}`);
}
process.exit(problems.length ? 2 : 0);
