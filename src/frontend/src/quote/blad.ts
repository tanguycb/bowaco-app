// Het rekenblad (stap 4b.3b): de zuivere kern van de offerte-editor als werkblad. Geen React, geen DOM, geen backend-imports:
// tests/proef-4b-3b.mjs draait DEZELFDE code. Rekenen blijft in calc.ts (QuoteCalc v2) en het model in model.ts; hier staat
// enkel wat het werkblad erbij doet: welke editor en welke kolommen per rol, de indeling op een groot scherm en een laptop,
// ongedaan maken, plakken uit Excel, meerdere rijen verplaatsen, en of het ontwerp klaar is om vanzelf te bewaren.
import * as M from "./model.ts";

// ── Welke editor, welke kolommen ─────────────────────────────────────────
export type Scope = "full" | "sell" | "totals";
export type Editor = "blad" | "klassiek";
/** Vanaf deze breedte (scherm met muis, de dichte stand van 4b.3) kan het rekenblad; daaronder de klassieke editor (gsm). */
export const BLAD_VANAF = 900;
/** Vanaf deze breedte staan de inhoud links en het lijnpaneel rechts vast open (groot scherm); daaronder klappen ze in. */
export const GROOT_VANAF = 1440;

/** Het rekenblad enkel voor wie de volledige offerte ziet (aankoopprijs en marge: beheerder en calculator) en op een scherm
 *  met muis; de klassieke editor blijft de tweede weergave tot de calculator het rekenblad goedkeurt. */
export function kiesEditor(scope: Scope, breedte: number, vinger: boolean, keuze: Editor | null): Editor {
  if (scope !== "full" || vinger || breedte < BLAD_VANAF) return "klassiek";
  return keuze ?? "blad";
}
export function leesEditorKeuze(v: string | null | undefined): Editor | null {
  return v === "blad" || v === "klassiek" ? v : null;
}

export type Weergave = "calc" | "klant" | "verschil";
export type Kolom = "code" | "titel" | "vorm" | "vh" | "eenheid" | "kost" | "marge" | "prijs" | "totaal";
const PRIJS: Kolom[] = ["kost", "marge", "prijs", "totaal"];
/** De kolommen van het raster. Zonder #full nooit een aankoopprijs of marge; zonder prijzen (#totals: de werfleider) ook geen
 *  prijs per post. "Zoals de klant" toont wat in de PDF komt: geen vorm, aankoop of marge. */
export function kolommen(scope: Scope, w: Weergave): Kolom[] {
  const basis: Kolom[] = ["code", "titel", "vorm", "vh", "eenheid"];
  if (scope === "totals") return basis;
  if (scope === "sell") return [...basis, "prijs", "totaal"];
  if (w === "klant") return ["code", "titel", "vh", "eenheid", "prijs", "totaal"];
  return [...basis, ...PRIJS];
}
export const toontPrijzen = (k: Kolom[]) => k.some((x) => PRIJS.includes(x));

// ── Indeling ─────────────────────────────────────────────────────────────
export type Indeling = { inhoud: "vast" | "zwevend" | "dicht"; paneel: "vast" | "zwevend" | "dicht" };
/** Groot scherm: inhoud en lijnpaneel vast open. Laptop: allebei ingeklapt; wie ze opent, krijgt ze zwevend over het raster
 *  (het raster en de totalen onderaan blijven). Een offerte met hoogstens één hoofdstuk heeft geen inhoud nodig: ingeklapt,
 *  tenzij je ze zelf opent. `open` = de keuze van de gebruiker in deze sessie (undefined = geen keuze). */
export function indeling(breedte: number, hoofdstukken: number, open: { inhoud?: boolean; paneel?: boolean } = {}): Indeling {
  const groot = breedte >= GROOT_VANAF;
  const inhoudOpen = open.inhoud ?? (groot && hoofdstukken > 1);
  const paneelOpen = open.paneel ?? groot;
  return {
    inhoud: !inhoudOpen ? "dicht" : groot ? "vast" : "zwevend",
    paneel: !paneelOpen ? "dicht" : groot ? "vast" : "zwevend",
  };
}

// ── Ongedaan maken ───────────────────────────────────────────────────────
/** Een volledige kopie van het model (structuredClone kent bigint en Map). */
export function snap(m: M.Model): M.Model {
  return structuredClone(m);
}

type HasId = { key: string; id: bigint | null; removed: boolean };
/** Zet de INHOUD van `s` terug in `m`, maar houd wat de server intussen weet (ids, stand, bewaarde basis): een lijn die na de
 *  kopie bewaard werd en nu weg moet, gaat bij de volgende bewaring weg; een lijn die intussen op de server verdween, komt
 *  terug als nieuwe lijn. Zo werkt Ctrl+Z ook na een automatische bewaring. `m` wordt ter plaatse aangepast. */
export function herstel(m: M.Model, s: M.Model): void {
  m.header = { ...s.header };
  m.chapters = merge(m.chapters, s.chapters, (c, cur) => ({ ...structuredClone(c), id: cur ? cur.id : null, base: cur ? cur.base : null, dirty: true }), (cur) => ({ ...cur, removed: true, dirty: true }));
  m.lines = merge(m.lines, s.lines, (l, cur) => ({ ...structuredClone(l), id: cur ? cur.id : null, base: cur ? cur.base : null, dirty: true }), (cur) => ({ ...cur, removed: true, dirty: true }));
  m.subgroups = merge(m.subgroups, s.subgroups, (g, cur) => ({ ...structuredClone(g), id: cur ? cur.id : null, base: cur ? cur.base : null }), (cur) => ({ ...cur, removed: true }));
  m.form = M.cloneForm(s.form);
  m.next = Math.max(m.next, s.next);
}
function merge<T extends HasId>(cur: T[], old: T[], keep: (o: T, c: T | undefined) => T, drop: (c: T) => T): T[] {
  const byKey = new Map(cur.map((x) => [x.key, x]));
  const oldKeys = new Set(old.map((x) => x.key));
  const out: T[] = [];
  for (const o of old) {
    const c = byKey.get(o.key);
    const id = c ? c.id : null;
    // weg in de kopie: enkel nog iets als het op de server staat (dan blijft het "weg")
    if (o.removed && id === null) continue;
    // in de kopie bewaard maar intussen van de server verdwenen: komt terug als nieuw
    out.push(keep(o, c));
  }
  for (const c of cur) if (!oldKeys.has(c.key) && c.id !== null) out.push(drop(c));
  return out;
}

/** Ongedaan maken en opnieuw: één stap per handeling (een cel, plakken, verplaatsen, een keuze voor meerdere rijen). */
export class Geschiedenis {
  terug: M.Model[] = [];
  vooruit: M.Model[] = [];
  readonly max: number;
  constructor(max = 100) { this.max = max; }
  /** Vóór elke wijziging. */
  voor(m: M.Model): void {
    this.terug.push(snap(m));
    if (this.terug.length > this.max) this.terug.shift();
    this.vooruit = [];
  }
  ongedaan(m: M.Model): boolean {
    const s = this.terug.pop();
    if (!s) return false;
    this.vooruit.push(snap(m));
    herstel(m, s);
    return true;
  }
  opnieuw(m: M.Model): boolean {
    const s = this.vooruit.pop();
    if (!s) return false;
    this.terug.push(snap(m));
    herstel(m, s);
    return true;
  }
  get kanTerug() { return this.terug.length > 0; }
  get kanVooruit() { return this.vooruit.length > 0; }
}

// ── Getallen zoals in Excel ──────────────────────────────────────────────
/** "1.250,50" · "1250.5" · "€ 1 250,5" · "-2" · "12,5 %" → een vast getal met `dec` decimalen (afgerond). Ongeldig → null. */
export function leesGetal(s: string, dec: number): bigint | null {
  let v = s.replace(/[€\s %]/g, "").replace("−", "-");
  if (v === "") return null;
  const neg = v.startsWith("-") || (v.startsWith("(") && v.endsWith(")"));
  v = v.replace(/^[-(]|\)$/g, "");
  const lc = v.lastIndexOf(",");
  const lp = v.lastIndexOf(".");
  let norm: string;
  if (lc >= 0 && lp >= 0) norm = lc > lp ? v.replaceAll(".", "").replace(",", ".") : v.replaceAll(",", "");
  else if (lc >= 0) norm = /^\d{1,3}(,\d{3}){2,}$/.test(v) ? v.replaceAll(",", "") : v.replace(",", ".");
  else norm = /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replaceAll(".", "") : v;
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const [int, frac = ""] = norm.split(".");
  const f = (frac + "0".repeat(dec + 1)).slice(0, dec + 1);
  let x = BigInt(int) * 10n ** BigInt(dec) + BigInt(f.slice(0, dec) || "0");
  if (Number(f[dec]) >= 5) x += 1n;
  return neg ? -x : x;
}

// ── Plakken uit Excel ────────────────────────────────────────────────────
export type Eenheid = { key: string; name: string };
export type PlakRij =
  | { soort: "hoofdstuk"; code: string; titel: string }
  | { soort: "tekst"; code: string; titel: string }
  | { soort: "post"; code: string; titel: string; tekst: string; qtyMilli: bigint; unit: string; unitOk: boolean; cost: bigint | null; vast: bigint | null; vorm?: "vh" | "fixed" };
export type Plak = { rijen: PlakRij[]; kop: boolean; onbekendeEenheden: string[] };

/** Meer dan één cel op het klembord (tab of nieuwe regel) = rijen uit een rekenblad. Eén waarde plakt gewoon in de cel. */
export function isPlak(tekst: string): boolean {
  const t = tekst.replace(/\r?\n$/, "");
  return t.includes("\t") || t.includes("\n");
}

const norm = (x: string) => x.toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/[\s.]/g, "");
const ALIAS: Record<string, string[]> = {
  st: ["st", "stuk", "stuks", "stk", "pc", "pce", "pièce", "piece"],
  m2: ["m2", "vierkantemeter"],
  m3: ["m3", "kubiekemeter"],
  lm: ["lm", "m1", "mtr", "lopendemeter", "ml", "m"],
  sog: ["sog", "ff", "forfait", "gh", "geheel", "pm"],
  kg: ["kg"],
  u: ["u", "uur", "uren", "h"],
};
/** Een eenheid uit Excel → de sleutel uit de lijst van de app (op sleutel, naam of een gewone schrijfwijze). Onbekend → null. */
export function eenheidVan(cel: string, eenheden: Eenheid[]): string | null {
  const n = norm(cel);
  if (!n) return null;
  for (const e of eenheden) if (norm(e.key) === n || norm(e.name) === n) return e.key;
  for (const [k, xs] of Object.entries(ALIAS)) if (xs.includes(n)) { const e = eenheden.find((u) => norm(u.key) === k); if (e) return e.key; }
  return null;
}
const lijktEenheid = (c: string) => c.length <= 8 && /^[a-zA-Z][a-zA-Z0-9²³/.]*$/.test(c.trim());
const lijktCode = (c: string) => c.length <= 20 && /^[A-Za-z]{0,3}\d+([.\-/]\d+)*[a-z]?\.?$/.test(c.trim());

type KopKol = "code" | "titel" | "tekst" | "vh" | "eenheid" | "kost" | "vast" | "totaal" | "";
function kopKolom(c: string): KopKol {
  const n = c.toLowerCase().trim();
  if (/^(code|nr\.?|nummer|post ?nr|pos)$/.test(n)) return "code";
  if (/omschrijving|beschrijving|titel|^post$|^werk/.test(n)) return "titel";
  if (/lastenboek|^tekst$/.test(n)) return "tekst";
  if (/^(vh|hoev|hoeveelheid|aantal|qty|q)\.?$/.test(n) || n.startsWith("hoeveelh")) return "vh";
  if (/^(eenh|eenheid|ehd|unit)\.?$/.test(n)) return "eenheid";
  if (/verkoop|^vp$/.test(n)) return "vast";
  if (/totaal|^tot\.?$|bedrag/.test(n)) return "totaal";
  if (/prijs|aankoop|kost|^ep$|^ap$|eenheidsprijs/.test(n)) return "kost";
  return "";
}

/** De rijen van het klembord (tab tussen de cellen). Met een kopregel volgen de kolommen de kop; zonder kop raadt het blad
 *  per rij: een eenheid scheidt de hoeveelheid (ervoor) van de prijs (erna), de langste tekst is de omschrijving, een korte
 *  code vooraan is de code. Een rij met enkel tekst wordt een hoofdstuk (code van één of twee cijfers, of alles in hoofdletters)
 *  of een tekstregel. De prijs wordt de aankoopprijs; een kolom "verkoop" wordt een vaste verkoopprijs. Een totaal wordt nooit
 *  overgenomen (het blad rekent zelf). */
export function leesPlak(tekst: string, eenheden: Eenheid[]): Plak {
  const cellen = tsv(tekst).map((r) => r.map((c) => c.trim()));
  const kopRij = cellen[0] ?? [];
  const kop = kopRij.map(kopKolom);
  const metKop = kop.filter((k) => k !== "").length >= 2 && kopRij.every((c) => leesGetal(c, 3) === null);
  const onbekend = new Set<string>();
  const rijen: PlakRij[] = [];
  for (const rij of metKop ? cellen.slice(1) : cellen) {
    if (rij.every((c) => c === "")) continue;
    const r = metKop ? metKopRij(rij, kop, eenheden) : zonderKopRij(rij, eenheden);
    if (!r) continue;
    if (r.soort === "post" && !r.unitOk && r.unit) onbekend.add(r.unit);
    rijen.push(r);
  }
  // Het sjabloon van BOWACO zet "VH" (vermoedelijke hoeveelheid) in een eigen kolom: staat die ergens, dan is een post
  // zonder VH forfaitair ("vaste prijs").
  if (rijen.some((r) => r.soort === "post" && r.vorm === "vh")) for (const r of rijen) if (r.soort === "post" && !r.vorm) r.vorm = "fixed";
  return { rijen, kop: metKop, onbekendeEenheden: [...onbekend] };
}

/** Tabs tussen de cellen, een nieuwe regel tussen de rijen; een cel met een tab, een nieuwe regel of een aanhalingsteken staat
 *  tussen aanhalingstekens ("" = één aanhalingsteken), zoals Excel en Numbers kopiëren. */
export function tsv(tekst: string): string[][] {
  const t = tekst.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cel = "";
  let i = 0;
  let begin = true;
  while (i < t.length) {
    const ch = t[i];
    if (begin && ch === '"') {
      // cel tussen aanhalingstekens
      let j = i + 1;
      let v = "";
      while (j < t.length) {
        if (t[j] === '"' && t[j + 1] === '"') { v += '"'; j += 2; continue; }
        if (t[j] === '"') break;
        v += t[j++];
      }
      if (j < t.length && (t[j + 1] === "\t" || t[j + 1] === "\n" || j + 1 >= t.length)) { cel = v; i = j + 1; begin = false; continue; }
      // geen sluitend aanhalingsteken op de grens: gewone tekst
    }
    begin = false;
    if (ch === "\t") { row.push(cel); cel = ""; begin = true; }
    else if (ch === "\n") { row.push(cel); rows.push(row); row = []; cel = ""; begin = true; }
    else cel += ch;
    i++;
  }
  row.push(cel);
  rows.push(row);
  return rows;
}

function postOf(code: string, titel: string, tekst: string, vh: string, eenh: string, kost: string, vast: string, eenheden: Eenheid[]): PlakRij {
  const qty = vh ? leesGetal(vh, 3) : null;
  const unit = eenh ? eenheidVan(eenh, eenheden) : null;
  const c = kost ? leesGetal(kost, 2) : null;
  const f = vast ? leesGetal(vast, 2) : null;
  if (qty === null && !eenh && c === null && f === null) {
    // "3 – Ruwbouw" of "3. Ruwbouw" in de omschrijving: een hoofdstuk met code 3
    const genummerd = !code ? /^(\d{1,2})\s*[-–.:)]\s*(\S.*)$/s.exec(titel) : null;
    if (genummerd && genummerd[2].length <= 120) return { soort: "hoofdstuk", code: genummerd[1], titel: genummerd[2].trim() };
    const hoofdstuk = (/^\d{1,2}\.?$/.test(code) || /^[A-Z]\.?$/.test(code) || (titel.length >= 3 && titel.length <= 120 && titel === titel.toUpperCase() && /[A-Z]/.test(titel))) && titel !== "";
    return { soort: hoofdstuk ? "hoofdstuk" : "tekst", code: code.replace(/\.$/, ""), titel: titel || tekst };
  }
  return { soort: "post", code, titel, tekst, qtyMilli: qty ?? 0n, unit: unit ?? eenh, unitOk: unit !== null, cost: c !== null && c >= 0n ? c : null, vast: f !== null && f >= 0n ? f : null };
}

function metKopRij(rij: string[], kop: KopKol[], eenheden: Eenheid[]): PlakRij | null {
  const v = (k: KopKol) => { const i = kop.indexOf(k); return i >= 0 ? rij[i] ?? "" : ""; };
  const titel = v("titel");
  const tekst = v("tekst");
  if (!titel && !tekst && !v("code")) return null;
  const r = postOf(v("code"), titel, tekst, v("vh"), v("eenheid"), v("kost"), v("vast"), eenheden);
  if (r.soort === "post" && rij.some(isVH)) r.vorm = "vh";
  return r;
}

const isVH = (c: string) => /^v\.?h\.?$/i.test(c.trim());
function zonderKopRij(rij: string[], eenheden: Eenheid[]): PlakRij | null {
  const cells = rij.map((c, i) => ({ c, i, getal: leesGetal(c, 3) !== null }));
  const vh = cells.some((x) => isVH(x.c));
  const vol = cells.filter((x) => x.c !== "" && !isVH(x.c));
  if (!vol.length) return null;
  // een onbekende eenheid herken je aan haar plaats: kort, tussen de getallen, naast een langere omschrijving
  const nGetal = vol.filter((x) => x.getal).length;
  const u = vol.find((x) => !x.getal && eenheidVan(x.c, eenheden) !== null)
    ?? vol.find((x) => !x.getal && lijktEenheid(x.c) && x.c.length <= 5 && nGetal >= 2 && vol.some((y) => !y.getal && y !== x && y.c.length > x.c.length));
  const teksten = vol.filter((x) => !x.getal && x !== u);
  let code = "";
  const eerste = vol[0];
  if (teksten.length >= 2 && !eerste.getal && lijktCode(eerste.c)) code = eerste.c;
  else if (eerste.getal && vol.length > 1 && !vol[1].getal && lijktCode(eerste.c) && !u?.c.includes(eerste.c)) code = eerste.c;
  const rest = teksten.filter((x) => !(code && x === eerste));
  const titelCel = rest.reduce<(typeof rest)[number] | null>((a, x) => (!a || x.c.length > a.c.length ? x : a), null);
  const titel = titelCel?.c ?? "";
  const getallen = vol.filter((x) => x.getal && !(code && x === eerste));
  let vhq = "";
  let prijs = "";
  if (u) {
    const voor = getallen.filter((x) => x.i < u.i);
    const na = getallen.filter((x) => x.i > u.i);
    vhq = voor.at(-1)?.c ?? "";
    prijs = na[0]?.c ?? "";
    if (!vhq && na.length >= 2) { vhq = na[0].c; prijs = na[1].c; }
  } else if (getallen.length >= 2) {
    vhq = getallen[0].c;
    prijs = getallen[1].c;
  } else if (getallen.length === 1) vhq = getallen[0].c;
  if (!titel && !code) return null;
  const r = postOf(code, titel, "", vhq, u?.c ?? "", prijs, "", eenheden);
  if (r.soort === "post" && vh) r.vorm = "vh";
  return r;
}

/** De geplakte rijen in het model: na lijn `na` (of achteraan) in hoofdstuk `doel`; een hoofdstukrij maakt een nieuw hoofdstuk
 *  na het huidige en de rijen erna komen daarin. Zonder hoofdstuk (lege offerte) eerst één hoofdstuk met `standaardTitel`.
 *  Geeft de sleutels van de nieuwe lijnen. */
export function plakIn(m: M.Model, rijen: PlakRij[], doel: string | null, na: string | null, std: { unit: string; form: string; standaardTitel: string }): string[] {
  let ch = doel && m.chapters.some((c) => c.key === doel && !c.removed) ? doel : M.activeChapters(m)[0]?.key ?? null;
  let after = ch === doel ? na : null;
  const nieuw: string[] = [];
  for (const r of rijen) {
    if (r.soort === "hoofdstuk") {
      const c = M.addChapter(m, { code: r.code.slice(0, 20), title: r.titel.slice(0, 160) || std.standaardTitel });
      if (ch) {
        // meteen na het hoofdstuk waarin je plakte (of na het vorige geplakte hoofdstuk)
        const a = M.activeChapters(m).filter((x) => x.key !== c.key);
        verplaatsHoofdstuk(m, c.key, a[a.findIndex((x) => x.key === ch) + 1]?.key ?? null);
      }
      ch = c.key;
      after = null;
      continue;
    }
    if (!ch) ch = M.addChapter(m, { title: std.standaardTitel }).key;
    const { titel, tekst } = splitsTekst(r.titel, r.soort === "post" ? r.tekst : "");
    const l = r.soort === "tekst"
      ? M.addLine(m, ch, { kind: "text", code: r.code.slice(0, 20), title: titel, text: tekst, unit: "" }, after ?? undefined)
      : M.addLine(m, ch, {
          kind: "item", code: r.code.slice(0, 20), title: titel, text: tekst, qtyMilli: r.qtyMilli, unit: r.unit || std.unit, form: r.vorm ?? std.form,
          price: { ...M.emptyPrice(), cost: r.cost, rule: r.vast !== null ? { price: r.vast } : null, reason: r.vast !== null ? "Geplakt uit een rekenblad" : "", source: r.cost !== null ? "handmatig" : "" },
        }, after ?? undefined);
    after = l.key;
    nieuw.push(l.key);
  }
  return nieuw;
}

/** Een omschrijving uit Excel: de eerste regel is de titel (hoogstens 160 tekens), de rest de tekst voor de klant (hoogstens
 *  4000). Een lange eerste regel blijft volledig in de tekst; de titel wordt dan ingekort op een woord. Niets gaat verloren. */
export function splitsTekst(cel: string, extra = ""): { titel: string; tekst: string } {
  const regels = cel.split("\n");
  const eerste = regels[0].trim();
  const rest = regels.slice(1).join("\n").trim();
  if (eerste.length <= GRENS.titel) return { titel: eerste, tekst: [rest, extra].filter(Boolean).join("\n").slice(0, GRENS.tekst) };
  const kort = eerste.slice(0, GRENS.titel - 1).replace(/\s+\S*$/, "");
  return { titel: `${kort}…`, tekst: [cel.trim(), extra].filter(Boolean).join("\n").slice(0, GRENS.tekst) };
}

// ── Meerdere rijen ───────────────────────────────────────────────────────
const STEP = 10n;
/** Lijnen (in hun volgorde op het blad) naar hoofdstuk `doel`, vóór lijn `voor` (null = achteraan). De volgorde van het doel
 *  wordt hernummerd (10, 20, …); een lijn die van hoofdstuk wisselt, verlaat haar subgroep. */
export function verplaats(m: M.Model, keys: string[], doel: string, voor: string | null): void {
  const set = new Set(keys);
  const moving = bladVolgorde(m).filter((l) => set.has(l.key));
  if (!moving.length || voor !== null && set.has(voor)) return;
  const blijft = M.linesOf(m, doel).filter((l) => !set.has(l.key));
  // vóór een lijn in een subgroep = in die subgroep (zo landt de lijn waar je ze neerzet)
  const doelSub = voor !== null ? M.lineSubgroup(m, M.linesOf(m, doel).find((l) => l.key === voor)!) : undefined;
  const i = voor === null ? blijft.length : blijft.findIndex((l) => l.key === voor);
  const rij = [...blijft.slice(0, i < 0 ? blijft.length : i), ...moving, ...blijft.slice(i < 0 ? blijft.length : i)];
  let o = STEP;
  for (const l of rij) {
    if (l.chapter !== doel) { l.chapter = doel; l.dirty = true; M.setLineSubgroup(m, l.key, null); }
    if (set.has(l.key) && doelSub !== undefined) M.setLineSubgroup(m, l.key, doelSub ? doelSub.key : null);
    if (l.order !== o) { l.order = o; l.dirty = true; }
    o += STEP;
  }
}

/** Een hoofdstuk vóór hoofdstuk `voor` (null = achteraan); de hoofdstukken worden hernummerd. */
export function verplaatsHoofdstuk(m: M.Model, key: string, voor: string | null): void {
  const a = M.activeChapters(m);
  const c = a.find((x) => x.key === key);
  if (!c || voor === key) return;
  const rest = a.filter((x) => x.key !== key);
  const i = voor === null ? rest.length : rest.findIndex((x) => x.key === voor);
  const rij = [...rest.slice(0, i < 0 ? rest.length : i), c, ...rest.slice(i < 0 ? rest.length : i)];
  let o = STEP;
  for (const x of rij) {
    if (x.order !== o) { x.order = o; x.dirty = true; }
    o += STEP;
  }
}

/** Alle actieve lijnen in de volgorde van het blad (hoofdstuk per hoofdstuk). */
export function bladVolgorde(m: M.Model): M.Line[] {
  return M.activeLines(m);
}

/** Shift-klik: de sleutels van `van` tot en met `tot` in de volgorde van het blad. */
export function bereik(volgorde: string[], van: string, tot: string): string[] {
  const a = volgorde.indexOf(van);
  const b = volgorde.indexOf(tot);
  if (a < 0 || b < 0) return [tot];
  return volgorde.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Kopieën van de lijnen, elk meteen na het origineel (zonder id: nieuw bij de volgende bewaring). Geeft de nieuwe sleutels. */
export function dupliceer(m: M.Model, keys: string[]): string[] {
  const set = new Set(keys);
  const out: string[] = [];
  for (const l of bladVolgorde(m).filter((x) => set.has(x.key))) {
    const c = M.addLine(m, l.chapter, { kind: l.kind, code: l.code, title: l.title, text: l.text, specRef: l.specRef, qtyMilli: l.qtyMilli, unit: l.unit, form: l.form, libItemId: l.libItemId, libItemVersion: l.libItemVersion, price: { ...l.price } }, l.key);
    const sub = M.lineSubgroup(m, l);
    if (sub) M.setLineSubgroup(m, c.key, sub.key);
    out.push(c.key);
  }
  return out;
}

/** Eén marge voor meerdere posten (null = terug naar de basismarge: klasse of standaard). Tekstregels en vaste prijzen blijven. */
export function zetMarge(m: M.Model, keys: string[], bp: bigint | null, reden: string): number {
  let n = 0;
  for (const k of keys) {
    const l = m.lines.find((x) => x.key === k && !x.removed);
    if (!l || l.kind === "text" || (l.price.rule && "price" in l.price.rule)) continue;
    M.updateLine(m, k, { price: { ...l.price, rule: bp === null ? null : { margin: bp }, reason: bp === null ? "" : reden } });
    n++;
  }
  return n;
}

/** Posten ↔ opties (tekstregels blijven). */
export function zetSoort(m: M.Model, keys: string[], soort: "item" | "option"): number {
  let n = 0;
  for (const k of keys) {
    const l = m.lines.find((x) => x.key === k && !x.removed);
    if (!l || l.kind === "text" || l.kind === soort) continue;
    M.updateLine(m, k, { kind: soort });
    n++;
  }
  return n;
}

export function verwijder(m: M.Model, keys: string[]): void {
  for (const k of keys) M.removeLine(m, k);
}

/** De rijen als tekst met tabs (kopiëren naar Excel): code, omschrijving, VH, eenheid en, met prijzen, aankoop en prijs/eenheid. */
export function alsTekst(m: M.Model, keys: string[], metPrijs: boolean): string {
  const set = new Set(keys);
  const g = (x: bigint, d: number) => (Number(x) / 10 ** d).toLocaleString("nl-BE", { useGrouping: false, maximumFractionDigits: d });
  return bladVolgorde(m).filter((l) => set.has(l.key)).map((l) => {
    const cells = [l.code, l.title || l.text.split("\n")[0], l.kind === "text" ? "" : g(l.qtyMilli, 3), l.unit];
    if (metPrijs) { const o = M.lineOut(m, l); cells.push(l.price.cost !== null ? g(l.price.cost, 2) : "", o.unitSell !== null ? g(o.unitSell, 2) : ""); }
    return cells.map((c) => c.replace(/[\t\n]/g, " ")).join("\t");
  }).join("\n");
}

// ── Klaar om vanzelf te bewaren ──────────────────────────────────────────
// Dezelfde grenzen als saveQuoteDraft (QuotesApi.mo): de server weigert anders het hele stuk. Wat niet klaar is, wacht; de rest
// van het blad ook (alles of niets), en het blad zegt waarom.
export type Probleem = { key: string; wat: "hoofdstukTitel" | "titel" | "eenheid" | "lang" | "prijs" | "hoeveelheid" };
export const GRENS = { titel: 160, code: 20, tekst: 4000, verwijzing: 80, reden: 1000, qtyMilli: 1_000_000_000_000n, cents: 100_000_000_000n };
export function nietKlaar(m: M.Model, eenheden: string[] | null): Probleem[] {
  const out: Probleem[] = [];
  for (const c of M.activeChapters(m)) {
    const t = c.title.trim();
    if (!t || t.length > GRENS.titel || c.code.trim().length > GRENS.code) out.push({ key: c.key, wat: "hoofdstukTitel" });
  }
  for (const l of M.activeLines(m)) {
    if (l.title.length > GRENS.titel || l.code.length > GRENS.code || l.text.length > GRENS.tekst || l.specRef.length > GRENS.verwijzing || l.price.reason.length > GRENS.reden) { out.push({ key: l.key, wat: "lang" }); continue; }
    if (l.kind !== "text" && !l.title.trim() && !l.text.trim()) { out.push({ key: l.key, wat: "titel" }); continue; }
    if ((l.qtyMilli < 0n ? -l.qtyMilli : l.qtyMilli) > GRENS.qtyMilli) { out.push({ key: l.key, wat: "hoeveelheid" }); continue; }
    if (l.kind === "text") { if (l.price.cost !== null || l.price.rule !== null) out.push({ key: l.key, wat: "prijs" }); continue; }
    if (eenheden && !eenheden.includes(l.unit)) { out.push({ key: l.key, wat: "eenheid" }); continue; }
    if (l.price.cost !== null && (l.price.cost < 0n || l.price.cost > GRENS.cents)) out.push({ key: l.key, wat: "prijs" });
  }
  return out;
}

/** Vanzelf bewaren: hoe lang na de laatste wijziging (ms). Elke bewaring is één auditregel ("offerte-bewaard"). */
export const BEWAAR_NA = 2500;

// ── Herkomst van de kost (lijnpaneel) ────────────────────────────────────
export type OaVergelijking = {
  tenderId: bigint;
  code: string;
  items: { id: bigint; lineId: bigint; libItemId: bigint | null; unit: string }[];
  firmas: { oaQuoteId: bigint; orgId: bigint; firma: string; dag: bigint | null }[];
  cellen: { itemId: bigint; oaQuoteId: bigint; unitCents: bigint | null; lowest: boolean; unitChanged: boolean; vhChanged: boolean; alt: boolean }[];
  gekozen: { itemId: bigint; oaQuoteId: bigint | null }[];
};
export type OaPrijs = { tenderCode: string; orgId: bigint; firma: string; dag: bigint | null; unitCents: bigint | null; laagste: boolean; gekozen: boolean; anders: boolean };
/** De offertes van de onderaannemers voor één lijn, naast elkaar: via de prijsvraag die van deze lijn (of van de lijn waarvan
 *  ze in een vorige versie gekopieerd werd) een post maakte, anders via dezelfde post uit de bibliotheek. Gesorteerd: gekozen
 *  eerst, dan op prijs (zonder prijs achteraan). Elke firma één keer per prijsvraag. */
export function oaPrijzen(lineIds: bigint[], libItemId: bigint | null, vgl: OaVergelijking[]): OaPrijs[] {
  const ids = new Set(lineIds.map(String));
  const out: OaPrijs[] = [];
  for (const v of vgl) {
    let items = v.items.filter((i) => ids.has(String(i.lineId)));
    if (!items.length && libItemId !== null) items = v.items.filter((i) => i.libItemId === libItemId).slice(0, 1);
    for (const it of items) {
      const keuze = v.gekozen.find((g) => g.itemId === it.id)?.oaQuoteId ?? null;
      for (const f of v.firmas) {
        const c = v.cellen.find((x) => x.itemId === it.id && x.oaQuoteId === f.oaQuoteId && !x.alt);
        if (!c) continue;
        out.push({ tenderCode: v.code, orgId: f.orgId, firma: f.firma, dag: f.dag, unitCents: c.unitCents, laagste: c.lowest, gekozen: keuze === f.oaQuoteId, anders: c.unitChanged || c.vhChanged });
      }
    }
  }
  const p = (x: OaPrijs) => (x.unitCents === null ? Number.MAX_SAFE_INTEGER : Number(x.unitCents));
  return out.sort((a, b) => Number(b.gekozen) - Number(a.gekozen) || p(a) - p(b));
}

/** De marge van één hoofdstuk zoals calc.ts ze voor het geheel rekent: verkoop met kost min kost, op die verkoop. Enkel tonen. */
export function hoofdstukMarge(c: { cost: bigint; sellWithCost: bigint }): bigint | null {
  if (c.sellWithCost <= 0n) return null;
  const n = (c.sellWithCost - c.cost) * 10_000n;
  return n >= 0n ? (n + c.sellWithCost / 2n) / c.sellWithCost : -((-n + c.sellWithCost / 2n) / c.sellWithCost);
}
