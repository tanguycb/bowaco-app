// Stap 2b.6/2d.4 stap 7: de werfdocumenten (plan van tools/inrichting/lees-documenten.py), zuinig:
//   - KEUZE PER WERF (D47): de gegevens komen van alle werven (stap 3), de documenten standaard enkel van de actieve
//     werven. Overschrijven per werf met --documenten-werf W-012=ja,W-091=nee;
//   - foto's verkleind met dezelfde regels als de app (tools/inrichting/zuinig.mjs: 2000 px, JPEG 0,8, zonder EXIF/gps),
//     in een voorraad buiten git (~/.bowaco/inrichting/verkleind); video's nooit, enkel in de lijst; > 15 MB niet;
//   - de droogloop toont vooraf per werf het aantal bestanden, de MB vóór en na verkleining en een kostenraming
//     (IC-tarief, BOWACO_verslag_2d.md §4; × 2,6 op een groter subnet). Ook een CSV naast het verslag (-raming.csv).
// Opladen doet deze stap nooit (ook niet met --echt): de opslagdienst van Caffeine ligt buiten het lokale net, en live
// vraagt het "ja" van de eigenaar (PB-01). Opladen gebeurt per werf met stap 8 (--werf <code>), met dezelfde regels.
// Foto's van werven die NIET gekozen zijn, worden niet verkleind (geen werk, geen iCloud-download): hun "na" is geraamd
// met de gemiddelde verkleinde grootte van deze run (of 0,5 MB per foto), nooit meer dan het origineel. --schatting
// raamt alle foto's zo (snel, zonder iets te lezen).
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { isLocal } from "./lib.mjs";
import { REGELS, beslis, verkleindeFoto, raming, euro, mb } from "./zuinig.mjs";

const S = 7;
const SCHATTING_FOTO = 500_000; // bytes per verkleinde foto als er in deze run nog niets gemeten is

/** "W-012=ja,W-091=nee" → Map(code → true/false). */
export function leesKeuze(tekst) {
  const m = new Map();
  for (const deel of String(tekst ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const r = deel.match(/^([A-Za-z0-9-]{1,20})=(ja|nee)$/i);
    if (!r) throw new Error(`--documenten-werf: "${deel}" moet zoals W-012=ja of W-091=nee`);
    m.set(r[1].toUpperCase(), r[2].toLowerCase() === "ja");
  }
  return m;
}

const q = (x) => `"${String(x).replace(/"/g, '""')}"`;

export async function stap7({ actor, plan, echt, verslag, zou, opties = {} }) {
  const keuze = opties.documentenWerf ?? new Map();
  const schatting = !!opties.schatting;
  const cache = opties.verkleind ?? join(homedir(), ".bowaco", "inrichting", "verkleind");
  const inApp = new Set([...(await actor.listWorks()).map((w) => w.code), ...(zou?.werven ?? [])]);
  for (const code of keuze.keys()) {
    if (!plan.werven.some((w) => w.code === code)) verslag.add(S, "keuze", code, "", "conflict", "--documenten-werf: geen documenten van deze werf in het plan");
  }

  // 1. Per bestand beslissen; foto's van de gekozen werven echt verkleinen (de voorraad maakt een tweede run snel).
  const rijen = [];
  let gemeten = 0, gemetenBytes = 0, nieuw = 0;
  const t0 = Date.now();
  for (const w of plan.werven) {
    const gekozen = keuze.has(w.code) ? keuze.get(w.code) : !!w.actief;
    const r = {
      w, gekozen, waarom: keuze.has(w.code) ? `keuze --documenten-werf=${gekozen ? "ja" : "nee"}` : w.actief ? "actieve werf" : "niet actief",
      bestanden: 0, voor: 0, na: 0, fotos: 0, geraamd: [], videos: [], teGroot: [],
    };
    for (const b of w.bestanden) {
      const naam = b.naam || `${b.doc}.${b.type}`;
      const d = beslis(naam, b.bytes, b.type);
      if (d.actie === "video") { r.videos.push(b); continue; }
      if (d.actie === "te groot") { r.teGroot.push(b); continue; }
      if (d.actie === "ongewijzigd") { r.bestanden++; r.voor += b.bytes; r.na += b.bytes; continue; }
      if (gekozen && !schatting && b.pad && existsSync(b.pad)) {
        try {
          const v = verkleindeFoto(b.pad, cache, b.doc);
          if (v.nieuw && ++nieuw % 100 === 0) console.log(`   … ${nieuw} foto's verkleind (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
          if (v.bytes > REGELS.maxBytes) { r.teGroot.push({ ...b, bytes: v.bytes }); continue; }
          r.fotos++; r.bestanden++; r.voor += b.bytes; r.na += v.bytes;
          gemeten++; gemetenBytes += v.bytes;
          continue;
        } catch (e) {
          if (/3 GB/.test(e.message)) throw e;
          verslag.add(S, "foto", b.doc, naam, "fout", `niet te verkleinen (${String(e.message).slice(0, 120)}); geraamd`);
        }
      } else if (gekozen && !schatting) {
        verslag.add(S, "foto", b.doc, naam, "overgeslagen", "bronbestand niet gevonden; geraamd");
      }
      r.fotos++; r.bestanden++; r.voor += b.bytes; r.geraamd.push(b.bytes);
    }
    rijen.push(r);
  }
  // 2. Geraamde foto's: de gemiddelde verkleinde grootte van deze run, nooit groter dan het origineel.
  const gem = gemeten ? gemetenBytes / gemeten : SCHATTING_FOTO;
  for (const r of rijen) r.na += r.geraamd.reduce((s, b) => s + Math.min(b, Math.round(gem)), 0);

  // 3. Verslag, tabel, CSV.
  const tabel = [
    "| Werf | Actief | Documenten | Bestanden | MB vóór | MB na | Foto's | Video's (niet) | > 15 MB (niet) | Eenmalig | Per maand | Groot subnet (× 2,6) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const csv = [["werf", "actief", "documenten", "waarom", "bestanden", "bytes_voor", "bytes_na", "fotos", "fotos_geraamd", "videos", "te_groot", "eenmalig_eur", "per_maand_eur", "eenmalig_groot_subnet_eur", "per_maand_groot_subnet_eur"].join(";")];
  const tot = { ja: { werven: 0, n: 0, voor: 0, na: 0, video: 0 }, alle: { werven: 0, n: 0, voor: 0, na: 0, video: 0 } };
  for (const r of rijen) {
    const w = r.w;
    const k = raming(r.na, r.bestanden);
    for (const t of r.gekozen ? [tot.ja, tot.alle] : [tot.alle]) { t.werven++; t.n += r.bestanden; t.voor += r.voor; t.na += r.na; t.video += r.videos.length; }
    for (const v of r.videos) verslag.add(S, "video", v.doc, v.naam ?? "", "overgeslagen", `werf ${w.code}: video (${mb(v.bytes)}) nooit opladen, enkel in de lijst; link naar de cloudmap`);
    for (const g of r.teGroot) verslag.add(S, "bestand", g.doc, g.naam ?? "", "overgeslagen", `werf ${w.code}: groter dan 15 MB (${mb(g.bytes)}), niet opladen; link naar de cloudmap`);
    if (r.gekozen && !inApp.has(w.code)) verslag.add(S, "werfdocumenten", w.code, "", "conflict", "documenten gekozen, maar de werf staat niet in de app (eerst stap 3 of stap 8)");
    const geraamd = r.geraamd.length ? ` (${r.geraamd.length} foto's geraamd)` : "";
    verslag.add(S, "werfdocumenten", w.code, "", "overgeslagen",
      `documenten ${r.gekozen ? "JA" : "nee"} (${r.waarom}): ${r.bestanden} bestanden, ${mb(r.voor)} → ${mb(r.na)}${geraamd}; ${r.videos.length} video's en ${r.teGroot.length} > 15 MB niet; raming ${euro(k.eenmalig)} eenmalig + ${euro(k.maand)}/maand; niet opgeladen in stap 7 (per werf met stap 8)`);
    tabel.push(`| ${w.code} | ${w.actief ? "ja" : "nee"} | ${r.gekozen ? "**ja**" : "nee"} | ${r.bestanden} | ${mb(r.voor)} | ${mb(r.na)} | ${r.fotos}${geraamd ? ` (${r.geraamd.length} geraamd)` : ""} | ${r.videos.length} | ${r.teGroot.length} | ${euro(k.eenmalig)} | ${euro(k.maand)} | ${euro(k.eenmaligGroot)} + ${euro(k.maandGroot)}/m |`);
    csv.push([w.code, w.actief ? "ja" : "nee", r.gekozen ? "ja" : "nee", r.waarom, r.bestanden, r.voor, r.na, r.fotos, r.geraamd.length, r.videos.length, r.teGroot.length,
      k.eenmalig.toFixed(4), k.maand.toFixed(4), k.eenmaligGroot.toFixed(4), k.maandGroot.toFixed(4)].map(q).join(";"));
  }
  const som = (t, wat) => {
    const k = raming(t.na, t.n);
    return `${wat} (${t.werven}): ${t.n} bestanden, ${mb(t.voor)} → ${mb(t.na)}, ${t.video} video's niet; raming ${euro(k.eenmalig)} eenmalig + ${euro(k.maand)}/maand (groot subnet × 2,6: ${euro(k.eenmaligGroot)} + ${euro(k.maandGroot)}/maand)`;
  };
  const somJa = som(tot.ja, "gekozen werven"), somAlle = som(tot.alle, "alle werven");
  verslag.noteer(S, `Regels van de app (uploadPrep.ts): foto's ≤ ${REGELS.maxZijde} px, JPEG ${String(REGELS.kwaliteit).replace(".", ",")}, zonder EXIF/gps; video's nooit; grens ${(REGELS.maxBytes / 1048576).toFixed(0)} MB. Verkleind in deze run: ${nieuw} nieuw, ${gemeten} gemeten (gemiddeld ${mb(gem)} per foto${gemeten ? "" : ", standaardschatting"}).`);
  verslag.noteer(S, somJa);
  verslag.noteer(S, somAlle);
  verslag.noteer(S, "Tarief (IC, zonder de marge van Caffeine; BOWACO_verslag_2d.md §4): ≈ € 2,6 per GB eenmalig (ingress) + ≈ 11 M cycli per bestand, en € 0,41 per GB per maand opslag. Op een groter subnet (34 nodes) ≈ × 2,6.");
  verslag.noteer(S, "\n\n" + tabel.join("\n") + "\n");
  verslag.noteer(S, `Niet opgeladen: ${isLocal() ? "de opslagdienst van Caffeine ligt buiten het lokale net" : "wacht op het ja van de eigenaar"}. Opladen per werf met stap 8 (--werf <code>).`);
  for (const [k, n] of Object.entries(plan.nietGeselecteerd ?? {})) verslag.noteer(S, `niet geselecteerd: ${n} × ${k}`);
  if (echt) verslag.noteer(S, "--echt heeft voor deze stap geen effect: er wordt niets opgeladen.");
  if (opties.raming) {
    mkdirSync(dirname(opties.raming), { recursive: true, mode: 0o700 });
    writeFileSync(opties.raming, "﻿" + csv.join("\n") + "\n", { mode: 0o600 });
    verslag.noteer(S, `raming per werf (CSV): ${opties.raming}`);
  }
  // Op het scherm: de tabel (enkel werfcodes en getallen).
  console.log(tabel.join("\n"));
  console.log(`   ${somJa}\n   ${somAlle}\n   tarief IC zonder marge Caffeine; groter subnet ≈ × 2,6`);
  return { rijen, totaal: tot };
}
