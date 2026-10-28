// Stap 2b.5: bewaking van de woorden op het scherm. Geen netwerk, draait in een paar seconden:
//   node tests/woorden.mjs
// Leest de schermteksten (texts/nl.ts), de schermen (screens/, app/), de PDF's (pdf/) en de mailteksten
// (backend/lib/MailText.mo) en weigert wat een eerste gebruiker niet begrijpt: bouwstapnummers, technische
// woorden en een tweede woord voor iets dat al een woord heeft (woordenlijst: BOWACO_woordenlijst_2b.5.md).
// Commentaar telt niet mee. In code tellen alleen tekstregels (met een spatie): sleutels, klassen en
// veldnamen zijn geen schermtekst.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fe = join(root, "src/frontend/src");
let fails = 0, passes = 0;
function check(name, ok, detail = "") {
  if (ok) { passes++; console.log(`✓ ${name}`); } else { fails++; console.log(`✗ ${name}${detail ? "\n    " + detail : ""}`); }
}

// Verboden in schermtekst. [patroon, wat er in de plaats komt]
const BANNED = [
  [/\bstap\s+\d+[a-z]?\.\d+/i, "bouwstapnummer (stap 2.6)"],
  [/\(\d[a-z]?\.\d{1,2}(?:[–-]\d[a-z]?\.\d{1,2})?\)/, "bouwstapnummer tussen haakjes"],
  [/\bvoorlopig tot \d[a-z]?\.\d/i, "bouwstapnummer (voorlopig tot 0.3)"],
  [/\bfase\s+[0-9]/i, "fasenummer van het bouwplan (komt later)"],
  [/\bhash\b/i, "Controlecode"],
  [/\brobots?\b/i, "een programma / koppelingen met andere programma's"],
  [/\bprincipal\b/i, "Toegangssleutel"],
  [/\bkoppel(?:en|ing|ingen)\b/i, "toegang (of: code gebruiken)"],
  [/\bcanister\b/i, "omgeving"],
  [/\bdraft\b/i, "testomgeving"],
  [/\bgateway\b/i, "koppeling met een ander programma"],
  [/\bserver\b/i, "het kantoor / de totalen nagekeken"],
  [/(?<![.\w])json\b/i, "bewaarkopie"],
  [/\bticket/i, "(verdwijnt)"],
  [/\bopId\b/, "handeling"],
  [/VOORLOPIG/, "nog na te kijken"],
  [/\bpostbode\b/i, "Mail"],
  [/\borganisatie/i, "Firma"],
  [/\blogin\b|\blogins\b/i, "toegang / inloggen"],
  [/\badmin\b/i, "beheerder"],
  [/\bauditlog\b/i, "Logboek"],
  [/\bdashboard\b/i, "Overzicht"],
  [/\buitnodig/i, "Toegang geven"],
  [/\bfiche\b/i, "gegevens"],
  [/\bafzet(?:ten)?\b|\bafgezet/i, "stopzetten (personen) / archiveren (de rest)"],
  [/\bvorderingen\b/i, "Vorderingsstaten"],
  [/Internet Identity/, "inloggen (Internet Identity enkel in de uitleg bij het inlogscherm)"],
  [/\bbatch\b/i, "overzetting"],
  [/\blijn(?:en)?\b/i, "post (offerte) of regel (factuur)"],
  [/\bweggedaan\b/i, "ingetrokken"],
];

// Uitzonderingen: [bestand (deel van het pad), fragment van de tekst, reden].
const EXCEPT = [
  ["texts/nl.ts", "Je logt in met Internet Identity, een beveiligd inlogsysteem", "inlogscherm"],
  ["texts/nl.ts", "Inloggen met Internet Identity", "knop op het inlogscherm"],
  ["texts/nl.ts", "Een beveiligd inlogsysteem zonder wachtwoord", "uitleg ⓘ bij het inlogscherm"],
  ["screens/MijnOfferte.tsx", "mq-hash", "CSS-klasse, geen schermtekst"],
  ["app/App.tsx", "toegang is nog niet bevestigd of is stopgezet", "herkent de melding van het kantoor, niet getoond"],
];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === "dist") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mo)$/.test(f)) out.push(p);
  }
  return out;
}

// Haalt de tekstregels uit broncode: "…", '…' en `…` (zonder ${…}), zonder commentaar.
function literals(src, mo) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '"' || (!mo && (c === "'" || c === "`"))) {
      const q = c; let j = i + 1; let buf = ""; let depth = 0;
      while (j < n) {
        const e = src[j];
        if (e === "\\") { buf += src[j + 1] ?? ""; j += 2; continue; }
        if (q === "`" && e === "$" && src[j + 1] === "{") { depth++; j += 2; buf += " "; while (j < n && depth > 0) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; } continue; }
        if (e === q) break;
        if (e === "\n" && q !== "`") break;
        buf += e; j++;
      }
      const line = src.slice(0, i).split("\n").length;
      // een sleutel ("niet-gekoppeld": …) is geen tekst
      const after = src.slice(j + 1).match(/^\s*:/);
      if (!after) out.push({ text: buf, line });
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}

const files = [
  join(fe, "texts/nl.ts"),
  ...walk(join(fe, "screens")), ...walk(join(fe, "app")), ...walk(join(fe, "pdf")),
  join(root, "src/backend/lib/MailText.mo"),
];

const bad = [];
let scanned = 0;
for (const f of files) {
  const rel = relative(root, f);
  const isNl = f.endsWith("texts/nl.ts");
  const mo = f.endsWith(".mo");
  const lits = literals(readFileSync(f, "utf8"), mo);
  for (const { text, line } of lits) {
    if (!isNl && !/\s/.test(text.trim())) continue; // enkel zinnen in code
    if (!/[A-Za-zÀ-ÿ]{3}/.test(text)) continue;
    scanned++;
    const fr = EXCEPT.filter(([p, frag]) => rel.includes(p) && text.includes(frag));
    let t = text;
    for (const [, frag] of fr) t = t.split(frag).join(" ");
    // MailText.mo bevat ook Frans en Engels: enkel de Nederlandse woorden hierboven tellen; "login" e.d. in EN blijft eruit
    if (mo && /\b(log in|your|the|votre|vous)\b/i.test(text)) continue;
    for (const [re, instead] of BANNED) {
      if (re.test(t)) bad.push(`${rel}:${line}  «${text.slice(0, 90)}»  →  ${instead}`);
    }
  }
}
check(`${scanned} tekstregels nagekeken: geen bouwstapnummers, geen technische woorden, geen tweede woord`, bad.length === 0, bad.slice(0, 60).join("\n    "));

// De gekozen woorden zijn er echt (de woordenlijst is toegepast).
const nl = readFileSync(join(fe, "texts/nl.ts"), "utf8");
for (const w of ["Toegang geven", "Controlecode", "Logboek", "Bewaarkopie", "Stopzetten", "Mijn toegang", "nog na te kijken", "Firma's & contacten"]) {
  check(`woordenlijst: «${w}» staat in de schermteksten`, nl.includes(w));
}
// ⓘ-uitleg voor de vakwoorden
for (const k of ["vh", "regie", "bis30", "checkin", "inhouding", "waarborg", "prijsherziening", "vordering", "oa", "opmeting", "meerwerk", "controlecode", "toegangscode", "ii", "fase", "contractvorm"]) {
  check(`ⓘ-uitleg «${k}» bestaat en is kort genoeg (≤ 320 tekens)`, new RegExp(`\\n    ${k}: "([^"\\n]{10,320})"`).test(nl));
}

console.log(`\n${passes} ✓  ${fails} ✗`);
process.exit(fails ? 1 : 0);
