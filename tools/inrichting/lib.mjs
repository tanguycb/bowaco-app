// Stap 2b.6: gedeelde hulp voor de inrichting (tools/inrichting.mjs en de stappen in tools/inrichting/stap*.mjs).
//   - de GRENS: een plan met echte gegevens (bron "echt") gaat enkel naar het eigen lokale net. Ook een droogloop stuurt
//     de gegevens naar de canister (queries, proefrondes), dus ook die is buiten het lokale net geweigerd, tot de
//     eigenaar uitdrukkelijk ja zegt (dan JA_EIGENAAR=1, bouwplan PB-01);
//   - het verslag per run: per rij wat er gebeurde (aangemaakt, bijgewerkt, overgeslagen, conflict, fout) en waarom;
//   - kleine hulp: een pool voor gelijktijdige oproepen, pagineren, vouwen.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Lokaal = de host van ICP_HOST is exact localhost, 127.0.0.1 of ::1 (niet "ergens localhost in de tekst").
export const isLocal = () => {
  try { return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(process.env.ICP_HOST || "").hostname); } catch { return false; }
};

// Een plan is ECHT tenzij het uitdrukkelijk "bron": "test" draagt (ook een plan zonder label, zoals plan.json van
// tools/plan-analyse.py). De lezers geven het label "test" enkel aan een verzonnen documentenmap (tests/inrichting-fixtures.py).
export function leesPlan(pad) {
  if (!existsSync(pad)) return null;
  const plan = JSON.parse(readFileSync(pad, "utf8"));
  if (plan.bron !== "test" && !isLocal() && process.env.JA_EIGENAAR !== "1") {
    throw new Error(`${pad}: echte gegevens enkel op het eigen lokale net (ICP_HOST=http://localhost:…). Een draft of live krijgt ze pas na het uitdrukkelijke "ja" van de eigenaar.`);
  }
  return plan;
}

export const fold = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, " ").trim();
export const opt = (v) => (v === undefined || v === null || v === "" ? [] : [v]);
export const dagNr = (iso) => BigInt(Math.floor(Date.parse(String(iso).slice(0, 10) + "T00:00:00Z") / 86_400_000));
export const NAKIJKEN = "Nog na te kijken";

export function ok(r, wat) {
  if (r && typeof r === "object" && "err" in r) throw new Error(`${wat ? wat + ": " : ""}${r.err}`);
  return r && typeof r === "object" && "ok" in r ? r.ok : r;
}

// Gelijktijdig, maar begrensd (het lokale net verwerkt een handvol oproepen tegelijk vlot; een draft liever 3).
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// Het verslag van één run. Uitkomsten: aangemaakt · bijgewerkt · overgeslagen · conflict · fout. In een droogloop
// staat er "zou aangemaakt worden" enz.: er is niets bewaard.
export class Verslag {
  constructor(echt) { this.echt = echt; this.rijen = []; this.notities = []; this.start = new Date(); }
  add(stap, soort, sleutel, naam, uitkomst, waarom = "") {
    this.rijen.push({ stap: String(stap), soort, sleutel: String(sleutel ?? ""), naam: String(naam ?? ""), uitkomst, waarom: String(waarom ?? "") });
  }
  noteer(stap, tekst) { this.notities.push({ stap: String(stap), tekst }); }
  telling(stap) {
    const t = {};
    for (const r of this.rijen.filter((x) => stap === undefined || x.stap === String(stap))) {
      const k = `${r.soort}|${r.uitkomst}`;
      t[k] = (t[k] ?? 0) + 1;
    }
    return t;
  }
  problemen() { return this.rijen.filter((r) => r.uitkomst === "conflict" || r.uitkomst === "fout"); }
  woord(u) { return this.echt ? u : ({ aangemaakt: "zou aangemaakt worden", bijgewerkt: "zou bijgewerkt worden" }[u] ?? u); }
  samenvatting(stap) {
    const t = this.telling(stap);
    const soorten = [...new Set(Object.keys(t).map((k) => k.split("|")[0]))];
    return soorten.map((s) => `${s}: ` + ["aangemaakt", "bijgewerkt", "overgeslagen", "conflict", "fout"].filter((u) => t[`${s}|${u}`]).map((u) => `${this.woord(u)} ${t[`${s}|${u}`]}`).join(" · ")).join("\n");
  }
  schrijf(pad, kop) {
    mkdirSync(dirname(pad), { recursive: true });
    const stappen = [...new Set(this.rijen.map((r) => r.stap).concat(this.notities.map((n) => n.stap)))].sort();
    const md = [`# ${kop}`, "", `*${this.echt ? "ECHT BEWAARD" : "DROOGLOOP (niets bewaard)"} · ${this.start.toISOString()} → ${new Date().toISOString()} · ${process.env.ICP_HOST || "mainnet"}*`, ""];
    for (const s of stappen) {
      md.push(`## Stap ${s}`, "", "```", this.samenvatting(s) || "(niets)", "```", "");
      for (const n of this.notities.filter((x) => x.stap === s)) md.push(`- ${n.tekst}`);
      const prob = this.rijen.filter((r) => r.stap === s && (r.uitkomst === "conflict" || r.uitkomst === "fout"));
      if (prob.length) md.push("", "| Soort | Sleutel | Naam | Uitkomst | Waarom |", "|---|---|---|---|---|", ...prob.map((r) => `| ${r.soort} | ${r.sleutel} | ${r.naam.replace(/\|/g, "/")} | ${r.uitkomst} | ${r.waarom.replace(/\|/g, "/")} |`));
      md.push("");
    }
    writeFileSync(pad, md.join("\n") + "\n", { mode: 0o600 });
    const csv = ["stap;soort;sleutel;naam;uitkomst;waarom", ...this.rijen.map((r) => [r.stap, r.soort, r.sleutel, r.naam, this.woord(r.uitkomst), r.waarom].map((x) => `"${String(x).replace(/"/g, '""').replace(/\n/g, " ")}"`).join(";"))];
    writeFileSync(pad.replace(/\.md$/, "") + ".csv", "﻿" + csv.join("\n") + "\n", { mode: 0o600 });
  }
}

// Alle posten van de bibliotheek (ook gearchiveerde), per importsleutel.
export async function bibliotheek(actor) {
  const perSleutel = new Map();
  const alle = [];
  for (let offset = 0n; ; offset += 200n) {
    const p = await actor.listLibrary({ text: "", chapterId: [], trade: [], unit: [], form: [], orgId: [], includeArchived: true, offset, limit: 200n });
    for (const it of p.items) { alle.push(it); if (it.importKey.length) perSleutel.set(it.importKey[0], it); }
    if (BigInt(p.items.length) < 200n) break;
  }
  return { perSleutel, alle };
}
