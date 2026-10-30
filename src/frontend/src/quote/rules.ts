// Controleregels vóór verzending (stap 2.6, bouwplan §8.5 en §9 rij 2.6; VOORLOPIG: vragen voor Alexis): DEZELFDE regels als
// src/backend/lib/QuoteRules.mo. De editor toont de bevindingen live; de backend voert de regels uit bij het versturen en
// weigert bij een blokkering (tests/regels.mjs vergelijkt beide op willekeurige offertes). Een bevinding draagt nooit een
// bedrag: de regel, hoeveel lijnen of hoofdstukken, en welke (hoogstens MAX_IDS).
// Een standaardpost telt als aanwezig als een POST (geen optie, geen tekstregel) een van zijn woorden draagt in de titel,
// de code of het hoofdstuk, na normalisatie (kleine letters, letters en cijfers, één spatie tussen woorden): een woord van
// minder dan 4 tekens moet een heel woord zijn ("pid"), een langer woord mag het begin zijn ("afval" vindt "afvalcontainer").
// Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.
import { calcLine, calcTotals, type CalcLine, type Discount, type Kind, type Regie, type Rule } from "./calc.ts";

export const MAX_IDS = 20;
export type Severity = "warn" | "block";

/** De instelling van één regel (uit getQuoteRules). */
export type RuleSet = { key: string; name: string; fixed: boolean; enabled: boolean; severity: Severity; thresholdBp: bigint | null };
export type StdPost = { key: string; name: string; keywords: string[]; enabled: boolean; severity: Severity; archived: boolean };

export type RuleChapter = { id: string; code: string; title: string };
/** baseBp en regie: QuoteCalc v2 (2c.1). Een verborgen post met 0 blijft meetellen voor qty-zero (zoals QuoteRules.mo). */
export type RuleLine = { id: string; chapter: string; kind: Kind; code: string; title: string; qtyMilli: bigint; cost: bigint | null; rule: Rule; reason: string; baseBp?: bigint | null; regie?: Regie | null };
export type RuleInput = {
  chapters: RuleChapter[];
  lines: RuleLine[];
  standardBp: bigint;
  vatBp: bigint;
  discount?: Discount;
  workVatBp: bigint;
  vatNote: string;
  clientSet: boolean;
  clientAddressOk: boolean;
};
export type Finding = { rule: string; name: string; severity: Severity; count: number; lineIds: string[]; chapterIds: string[] };

/** Kleine letters, letters en cijfers (ook niet-ASCII); alle rest is een scheiding. */
export function norm(t: string): string {
  let out = "";
  let pending = false;
  let any = false;
  for (const c of t.toLowerCase()) {
    const cp = c.codePointAt(0)!;
    const word = (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp > 0x7f;
    if (word) {
      if (pending && any) out += " ";
      out += c;
      any = true;
      pending = false;
    } else pending = true;
  }
  return out;
}

function hasKeyword(haystack: string, kw: string): boolean {
  const k = norm(kw);
  if (k.length === 0) return false;
  const h = ` ${haystack} `;
  // Motoko telt tekens, JavaScript UTF-16-eenheden: voor de lengtegrens tellen we tekens.
  return [...k].length >= 4 ? h.includes(` ${k}`) : h.includes(` ${k} `);
}

const filled = (t: string) => t.replace(/^ +| +$/g, "").length > 0;
export const addressOk = (a: { street: string; zip: string; city: string } | null | undefined) => !!a && filled(a.street) && filled(a.zip) && filled(a.city);

export function evaluate(i: RuleInput, rules: RuleSet[], std: StdPost[]): Finding[] {
  const found: Finding[] = [];
  const calc: CalcLine[] = i.lines.map((l) => ({ chapter: l.chapter, kind: l.kind, qtyMilli: l.qtyMilli, cost: l.cost, rule: l.rule, baseBp: l.baseBp ?? null, regie: l.regie ?? null }));
  const t = calcTotals(i.chapters.map((c) => c.id), calc, i.vatBp, i.standardBp, i.discount ?? null);
  const outs = calc.map((c) => calcLine(c, i.standardBp));
  const items = i.lines.filter((l) => l.kind === "item");
  const add = (r: RuleSet, ls: RuleLine[], chs: RuleChapter[]) =>
    found.push({ rule: r.key, name: r.name, severity: r.severity, count: ls.length + chs.length, lineIds: ls.slice(0, MAX_IDS).map((l) => l.id), chapterIds: chs.slice(0, MAX_IDS).map((c) => c.id) });
  const flag = (r: RuleSet) => found.push({ rule: r.key, name: r.name, severity: r.severity, count: 1, lineIds: [], chapterIds: [] });
  const pick = (f: (l: RuleLine, o: ReturnType<typeof calcLine>) => boolean) => i.lines.filter((l, k) => f(l, outs[k]));

  for (const r of rules) {
    if (!r.enabled) continue;
    switch (r.key) {
      case "no-posts": if (items.length === 0) flag(r); break;
      case "no-price": if (t.noPrice > 0) add(r, pick((_, o) => o.noPrice), []); break;
      case "total-zero": if (items.length > 0 && t.total <= 0n) flag(r); break;
      case "client-missing": if (!i.clientSet) flag(r); break;
      case "client-address": if (i.clientSet && !i.clientAddressOk) flag(r); break;
      case "vat-ground": if (i.vatBp === 600n && !filled(i.vatNote)) flag(r); break;
      case "vat-differs": if (i.vatBp !== i.workVatBp) flag(r); break;
      case "qty-zero": { const ls = pick((l) => (l.kind === "item" || l.kind === "option") && l.qtyMilli === 0n); if (ls.length) add(r, ls, []); break; }
      case "qty-negative": { const ls = pick((l) => l.kind === "item" && l.qtyMilli < 0n); if (ls.length) add(r, ls, []); break; }
      case "margin-unknown": { const ls = pick((l) => l.kind !== "text" && l.cost === null && l.rule !== null && "price" in l.rule); if (ls.length) add(r, ls, []); break; }
      case "margin-low": {
        const thr = r.thresholdBp ?? 0n;
        const ls = pick((l, o) => l.kind !== "text" && !o.negative && o.marginBp !== null && o.marginBp < thr);
        if (ls.length) add(r, ls, []);
        break;
      }
      case "below-cost": { const ls = pick((l, o) => l.kind !== "text" && o.negative); if (ls.length) add(r, ls, []); break; }
      case "no-reason": { const ls = pick((l, o) => l.kind !== "text" && o.deviates && l.reason === ""); if (ls.length) add(r, ls, []); break; }
      case "chapter-empty": { const empty = i.chapters.filter((c) => !items.some((l) => l.chapter === c.id)); if (empty.length) add(r, [], empty); break; }
      default: break;
    }
  }
  // Standaardposten: één bevinding per ontbrekende post.
  const chTitle = new Map(i.chapters.map((c) => [c.id, norm(c.title)]));
  const texts = items.map((l) => norm(`${chTitle.get(l.chapter) ?? ""} ${l.code} ${l.title}`));
  for (const s of std) {
    if (!s.enabled || s.archived) continue;
    if (!texts.some((h) => s.keywords.some((kw) => hasKeyword(h, kw)))) found.push({ rule: `std:${s.key}`, name: s.name, severity: s.severity, count: 1, lineIds: [], chapterIds: [] });
  }
  return found;
}

export const blocks = (fs: Finding[]) => fs.filter((f) => f.severity === "block");
export const warnings = (fs: Finding[]) => fs.filter((f) => f.severity === "warn");
