// 2b.4: het startpunt. Zuivere functies (tests/start.mjs laadt ze in node):
//   • de zes stappen van "Aan de slag" en wanneer een stap klaar is (de app ziet het, of de beheerder markeerde hem);
//   • "Zo werkt het voor jou": welke tekst bij welke rol hoort;
//   • de blokken van het Overzicht en van het startscherm per rol (elk blok toont enkel wat de rol mag);
//   • "Vraagt aandacht": groepen per soort met telkens hoogstens vijf regels.
// Rights.mo blijft de enige matrix: hier verandert niets aan wat iemand mag, enkel wat er op het startscherm staat.
import type { Caps } from "../backend";
import { isClient } from "./nav";

export const START_KEYS = ["bedrijf", "team", "onderaannemers", "posten", "werf", "planning"] as const;
export type StartKey = (typeof START_KEYS)[number];

/** Waar elke stap heen gaat (het scherm krijgt de blauwe uitlegbalk via ?start=<nummer>). */
export const START_TO: Record<StartKey, string> = {
  bedrijf: "beheer/offertes",
  team: "team",
  onderaannemers: "adresboek",
  posten: "posten",
  werf: "werven",
  planning: "weekbord",
};

/** Wat de app zelf kan zien: tellingen uit bestaande queries (geen nieuwe gegevens). */
export type StartFacts = {
  issuer: boolean; // de uitgever van de offerte (bedrijfsgegevens) is ingevuld
  team: number; // mensen van BOWACO (beheerder, werfleider, calculator)
  oas: number; // onderaannemers in het adresboek
  posts: number; // posten in de bibliotheek
  works: number; // werven
  planned: number; // werven met minstens één taak in de planning
};

/** De uitgever van de offerte is pas ingevuld als de standaardtekst met "in te vullen" vervangen is (Config.defaultQuoteIssuer). */
export const issuerFilled = (issuer: string): boolean => issuer.trim().length > 0 && !/in te vullen/i.test(issuer);

export type StartStep = { key: StartKey; n: number; done: boolean; how: "app" | "hand" | null };

/** Een stap telt als klaar als de app het ziet of als de beheerder hem markeerde. */
export function startSteps(facts: StartFacts, marked: readonly string[]): StartStep[] {
  const seen: Record<StartKey, boolean> = {
    bedrijf: facts.issuer,
    team: facts.team >= 2,
    onderaannemers: facts.oas >= 1,
    posten: facts.posts >= 1,
    werf: facts.works >= 1,
    planning: facts.planned >= 1,
  };
  return START_KEYS.map((key, i) => {
    const app = seen[key];
    const hand = marked.includes(key);
    return { key, n: i + 1, done: app || hand, how: app ? "app" : hand ? "hand" : null };
  });
}

export const startDoneCount = (steps: StartStep[]) => steps.filter((s) => s.done).length;

/** De kaart staat er zolang niet alles klaar is en de beheerder hem niet verborg. */
export const startVisible = (steps: StartStep[], hidden: boolean) => !hidden && startDoneCount(steps) < steps.length;

/** ?start=3 in de adresbalk → stap 3 (de uitlegbalk). */
export function startParam(hash: string): number | null {
  const m = hash.match(/[?&]start=([1-6])(?:&|$)/);
  return m ? Number(m[1]) : null;
}

/** Het adres van een stap, met de uitlegbalk (?start=n). */
export const startRoute = (key: StartKey): string => `${START_TO[key]}?start=${START_KEYS.indexOf(key) + 1}`;

// ── Zo werkt het voor jou ────────────────────────────────────────────────

export type IntroKind = "admin" | "werfleider" | "calculator" | "oa" | "architect" | "vc" | "klant";
export const INTRO_KINDS: IntroKind[] = ["admin", "werfleider", "calculator", "oa", "architect", "vc", "klant"];

/** De rol die de tekst bepaalt: de eerste die past (een beheerder die ook werfleider is, leest de tekst van de beheerder). */
export function introKind(roles: readonly string[]): IntroKind | null {
  const order: [string, IntroKind][] = [["admin", "admin"], ["werfleider", "werfleider"], ["calculator", "calculator"], ["onderaannemer", "oa"], ["architect", "architect"], ["veiligheidscoordinator", "vc"], ["klant", "klant"]];
  return order.find(([r]) => roles.includes(r))?.[1] ?? null;
}

// ── De blokken van het startscherm ───────────────────────────────────────

export type OverzichtBlock = "start" | "aandacht" | "vandaag" | "fase" | "week";

/** Het Overzicht van de beheerder: Aan de slag · Vraagt aandacht · Vandaag op de werven · Werven per fase · Deze week. */
export function overzichtBlocks(caps: Caps, startVisibleNow: boolean): OverzichtBlock[] {
  const out: OverzichtBlock[] = [];
  if (caps.manageSettings && startVisibleNow) out.push("start");
  if (caps.readOrgPlanning) out.push("aandacht");
  if (caps.writeReports) out.push("vandaag");
  if (caps.readTeam) out.push("fase");
  if (caps.readOrgPlanning) out.push("week");
  return out;
}

/** Wat de beheerder aan "Vraagt aandacht" mag zien: de soorten waarvoor de rol de gegevens mag lezen. */
export type AttentionKind = "vertraagd" | "oa" | "dubbel" | "probleem" | "vergunning" | "verslag" | "wacht" | "aanvraag";
export const ATTENTION_KINDS: AttentionKind[] = ["vertraagd", "oa", "dubbel", "probleem", "vergunning", "verslag", "wacht", "aanvraag"];

export type AttentionItem = { key: string; title: string; detail: string; to: string; action?: { label: string; run: () => void; busy?: boolean } };
export type AttentionGroup = { kind: AttentionKind; items: AttentionItem[] };

export const ATTENTION_LIMIT = 5;

/** Groepen zonder regels vallen weg; per groep hoogstens `limit` regels tenzij de groep uitgeklapt is. */
export function attentionGroups(groups: AttentionGroup[], open: ReadonlySet<string> = new Set(), limit = ATTENTION_LIMIT) {
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => ({ kind: g.kind, total: g.items.length, shown: open.has(g.kind) ? g.items : g.items.slice(0, limit), more: !open.has(g.kind) && g.items.length > limit }));
}

/** Het startscherm van wie geen Overzicht heeft: werfleider = Vandaag (met aandacht), calculator = Offertes (met aandacht). */
export type StartScreen = "overzicht" | "vandaag" | "offertes" | "mijn-week" | "mijn-werven" | "mijn-werf";
export function startScreen(caps: Caps): StartScreen {
  if (caps.home === "overzicht") return "overzicht";
  if (caps.home === "vandaag") return "vandaag";
  if (caps.home === "offertes") return "offertes";
  if (caps.home === "week") return "mijn-week";
  return isClient(caps) ? "mijn-werf" : "mijn-werven";
}

/** Wie de blokken "aandacht" op het eigen startscherm krijgt (werfleider en calculator; de beheerder in het Overzicht). */
export const hasAttention = (caps: Caps) => caps.readOrgPlanning && caps.readTeam;

// ── Meldingen gebundeld in de bel (vraag 9) ─────────────────────────────

export type NoteGroupKey = "planning" | "offerte" | "opmeting" | "facturatie" | "vergunning" | "verslag" | "uren" | "toegang" | "mail" | "overig";

/** Welke soort een melding is (op het begin van haar kind). Dringende dingen staan daarnaast één voor één in Vraagt aandacht. */
export function noteGroup(kind: string): NoteGroupKey {
  const rules: [RegExp, NoteGroupKey][] = [
    [/^(planning|afwezigheid|vallen|valt|remming)/, "planning"],
    [/^(offerte|werfstart)/, "offerte"],
    [/^opmeting/, "opmeting"],
    [/^vordering/, "facturatie"],
    [/^(vergunning|inhoudingsplicht)/, "vergunning"],
    [/^(verslag|probleem)/, "verslag"],
    [/^uren/, "uren"],
    [/^(gekoppeld|uitnodiging|bevestigen)/, "toegang"],
    [/^postbode/, "mail"],
  ];
  return rules.find(([re]) => re.test(kind))?.[1] ?? "overig";
}

export type NoteLike = { id: bigint; kind: string; createdAt: bigint; readAt?: bigint };

/** De bel: per soort één groep, de nieuwste groep bovenaan, binnen een groep de nieuwste eerst. */
export function bundleNotes<T extends NoteLike>(list: readonly T[]): { key: NoteGroupKey; items: T[]; unread: number }[] {
  const map = new Map<NoteGroupKey, T[]>();
  for (const n of [...list].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1))) {
    const k = noteGroup(n.kind);
    map.set(k, [...(map.get(k) ?? []), n]);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items, unread: items.filter((x) => x.readAt === undefined).length }));
}
