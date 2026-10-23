// Stap 1.2: de beslissingen van Alexis (validatie-CSV van tools/oa-analyse.py) in de OA-database zetten.
// Idempotent: tweemaal draaien maakt geen dubbels en overschrijft niets (de backend vult enkel aan).
// Altijd eerst een PROEFRONDE (standaard); `--echt` bewaart. Alleen een beheerder mag importeren (R32).
//
//   ICP_HOST=http://localhost:8041 node tools/oa-import.mjs --csv X.csv --canister <id>            (proef, lokaal)
//   ICP_HOST=http://localhost:8041 node tools/oa-import.mjs --csv X.csv --canister <id> --echt     (bewaren)
//   node tools/oa-import.mjs --csv X.csv --canister <draft-id> --identity proef-admin              (draft: enkel testdata!)
//
// Opties: --identity <naam>  sleutel in ~/.bowaco (standaard proef-admin)
//         --uit <bestand.md> schrijft het resultaat als Markdown (NIET in git zetten bij echte namen)
//
// CSV: punt-komma, UTF-8 (met of zonder BOM). Kolommen: zie tools/oa-analyse.py. BESLISSING:
//   firma · dezelfde firma als · leverancier · nutsbedrijf · persoon · negeren · (leeg = nog niet beslist)
import { readFileSync, writeFileSync } from "node:fs";
import { backend } from "./lib.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const csvPath = arg("csv");
const cid = arg("canister");
const echt = process.argv.includes("--echt");
if (!csvPath || !cid) throw new Error("gebruik: node tools/oa-import.mjs --csv bestand.csv --canister <id> [--echt] [--identity naam] [--uit rapport.md]");

// ── CSV lezen (aanhalingstekens, punt-komma) ───────────────────────────────
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ";") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const fold = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const upper = (s) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const list = (s) => (s ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
const opt = (v) => (v ? [v] : []);

// ── Beslissingen → importrijen ─────────────────────────────────────────────
const BESLISSINGEN = ["firma", "dezelfde firma als", "leverancier", "nutsbedrijf", "persoon", "negeren"];

export function buildRows(csvRows) {
  const problems = [];
  const firms = new Map(); // sleutel (code) → rij
  const byFold = new Map(); // gevouwen code of firmanaam → sleutel
  const skipped = [];
  const pending = []; // "dezelfde firma als" en "persoon"
  for (const r of csvRows) {
    const code = upper(r.code);
    const d = fold(r.BESLISSING);
    const dec = BESLISSINGEN.find((b) => fold(b) === d);
    if (!r.BESLISSING) { skipped.push({ code, why: "nog geen beslissing" }); continue; }
    if (!dec) { problems.push(`${code}: onbekende beslissing "${r.BESLISSING}"`); continue; }
    if (dec === "negeren") { skipped.push({ code, why: "negeren" }); continue; }
    const aliases = [code, ...list(r.ook_geschreven_als).map(upper)];
    if (dec === "dezelfde firma als" || dec === "persoon") { pending.push({ r, code, dec, aliases }); continue; }
    const kind = dec === "leverancier" ? "supplier" : dec === "nutsbedrijf" ? "authority" : "subcontractor";
    const name = r.FIRMANAAM || titleCase(code);
    if (dec === "firma" && !r.FIRMANAAM) { problems.push(`${code}: beslissing "firma" maar FIRMANAAM is leeg`); continue; }
    const row = { key: code, kind: { [kind]: null }, name, kbo: opt(r.KBO), vat: [], aliases, trades: list(r.VAKGEBIED), phone: opt(r.TELEFOON), email: opt(r.EMAIL), website: [], notes: "", persons: [] };
    firms.set(code, row);
    byFold.set(fold(code), code);
    byFold.set(fold(name), code);
    for (const a of aliases) byFold.set(fold(a), code);
  }
  for (const p of pending) {
    const target = p.r.DEZELFDE_FIRMA_ALS;
    if (p.dec === "dezelfde firma als") {
      const k = byFold.get(fold(target));
      if (!target || !k) { problems.push(`${p.code}: "dezelfde firma als" verwijst naar "${target}", maar dat is geen firma in deze lijst`); continue; }
      const t = firms.get(k);
      for (const a of p.aliases) if (!t.aliases.includes(a)) t.aliases.push(a);
      continue;
    }
    // persoon
    const person = { name: p.r.PERSOONSNAAM || titleCase(p.code), shortCode: opt(p.code), phone: opt(p.r.TELEFOON), email: opt(p.r.EMAIL), jobTitle: "" };
    if (target) {
      const k = byFold.get(fold(target));
      if (!k) { problems.push(`${p.code}: persoon van "${target}", maar dat is geen firma in deze lijst`); continue; }
      firms.get(k).persons.push(person);
    } else {
      // zelfstandige: eigen firma met dezelfde naam, de persoon erbij
      const row = { key: p.code, kind: { subcontractor: null }, name: p.r.FIRMANAAM || person.name, kbo: opt(p.r.KBO), vat: [], aliases: [p.code, ...p.aliases.slice(1)], trades: list(p.r.VAKGEBIED), phone: [], email: [], website: [], notes: "Zelfstandige (persoon zonder firmanaam in de planning)", persons: [{ ...person, phone: opt(p.r.TELEFOON), email: opt(p.r.EMAIL) }] };
      firms.set(p.code, row);
      byFold.set(fold(p.code), p.code);
    }
  }
  const long = [];
  for (const row of firms.values()) {
    row.aliases = row.aliases.filter((a) => { if (a.length > 20) { long.push(`${row.key}: code "${a}" is langer dan 20 tekens en wordt overgeslagen`); return false; } return true; });
  }
  problems.push(...long);
  return { rows: [...firms.values()], skipped, problems };
}

// ── Uitvoeren ──────────────────────────────────────────────────────────────
const csvRows = parseCsv(readFileSync(csvPath, "utf8"));
const { rows, skipped, problems } = buildRows(csvRows);
const actor = await backend(arg("identity", "proef-admin"), cid);
const out = [];
const tot = { created: 0, updated: 0, unchanged: 0, conflicts: 0, invalid: 0 };
const lines = [];
for (let i = 0; i < rows.length; i += 40) {
  const chunk = rows.slice(i, i + 40);
  // Eerst altijd de proefronde; alleen als ze geen ongeldige rij of conflict toont, mag de echte ronde volgen.
  const dry = await actor.importOrgs(true, chunk);
  if ("err" in dry) throw new Error(dry.err);
  let rep = dry.ok;
  if (echt) {
    const bad = rep.results.filter((x) => "invalid" in x.outcome || "conflict" in x.outcome);
    if (bad.length) console.log(`  ${bad.length} rij(en) met conflict of fout in dit stuk: die worden niet bewaard, de rest wel.`);
    const real = await actor.importOrgs(false, chunk);
    if ("err" in real) throw new Error(real.err);
    rep = real.ok;
  }
  for (const k of Object.keys(tot)) tot[k] += Number(rep[k]);
  rep.results.forEach((r, j) => {
    const [kind, why] = Object.entries(r.outcome)[0];
    lines.push({ code: chunk[j].key, name: chunk[j].name, uitkomst: kind, detail: typeof why === "string" ? why : r.changes.join("; ") });
  });
}
const modus = echt ? "ECHT BEWAARD" : "PROEFRONDE (niets bewaard)";
console.log(`\n${modus}: ${rows.length} firma's uit ${csvRows.length} rijen`);
console.log(`nieuw ${tot.created} · aangevuld ${tot.updated} · ongewijzigd ${tot.unchanged} · conflicten ${tot.conflicts} · ongeldig ${tot.invalid}`);
console.log(`overgeslagen: ${skipped.filter((s) => s.why === "negeren").length} genegeerd, ${skipped.filter((s) => s.why !== "negeren").length} zonder beslissing`);
for (const p of problems) console.log(`  ! ${p}`);
for (const l of lines.filter((x) => x.uitkomst === "conflict" || x.uitkomst === "invalid")) console.log(`  ✗ ${l.code} (${l.name}): ${l.uitkomst}: ${l.detail}`);
const uit = arg("uit");
if (uit) {
  const md = [`# Importresultaat OA-database`, "", `*${modus}, ${new Date().toISOString()}. Bevat echte namen: niet in git.*`, "",
    `nieuw ${tot.created} · aangevuld ${tot.updated} · ongewijzigd ${tot.unchanged} · conflicten ${tot.conflicts} · ongeldig ${tot.invalid}`, "",
    "| Code | Firma | Uitkomst | Detail |", "|---|---|---|---|", ...lines.map((l) => `| ${l.code} | ${l.name} | ${l.uitkomst} | ${l.detail} |`), "",
    "## Overgeslagen", "", ...skipped.map((s) => `- ${s.code}: ${s.why}`), "", "## Problemen in de CSV", "", ...(problems.length ? problems.map((p) => `- ${p}`) : ["Geen."])];
  writeFileSync(uit, md.join("\n") + "\n");
  console.log(`rapport: ${uit}`);
}
process.exit(tot.invalid + tot.conflicts + problems.length ? 2 : 0);
