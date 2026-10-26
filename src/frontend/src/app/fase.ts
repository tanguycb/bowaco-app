// 2b.3: de werf als centrum. Hier staan, als zuivere functies (tests/fase.mjs laadt ze in node):
//   • werfFase: de fase van een werf, afgeleid uit wat er gebeurde (listWorkStages) en de status die iemand met de hand zette;
//   • werfGroep: het tabblad van Werven (aanvragen & offertes · lopend · afgerond);
//   • werfTabs: de tabbladen van de werf per rol (uit de caps; Rights.mo blijft de enige matrix) en welke nog niet gelden;
//   • volgendeStap: de ene knop op de kaart "Volgende stap", per fase en rol.
// VOORLOPIG: de regels volgen het prototype (BOWACO_prototype_2b.md, vraag 14); Alexis antwoordde nog niet. Wie ze aanpast,
// past enkel FASE_EVENTS en STATUS_FLOOR aan (en de uitleg in texts/nl.ts → fase.rules).
import type { Caps } from "../backend";
import { t } from "../texts/nl";
import { isClient } from "./nav";

export const PHASE_KEYS = ["aanvraag", "offerte", "akkoord", "gestart", "uitvoering", "opgemeten", "gefactureerd", "opgeleverd"] as const;
export type PhaseKey = (typeof PHASE_KEYS)[number];
export type StepState = "done" | "skipped" | "now" | "todo";

/** De stand van één werf: wat de backend telt (WorkStageView) + de status van de werf. Alles optioneel: zonder stand telt enkel de status. */
export type StageFacts = {
  status: string; // request · quoting · planned · running · delivered · aftercare · cancelled
  quoteSentAt?: bigint;
  quoteWaiting?: boolean;
  acceptedAt?: bigint;
  startedAt?: bigint;
  startPending?: boolean;
  tasks?: bigint | number;
  firstReportAt?: bigint;
  surveyOpen?: boolean;
  measuredAt?: bigint;
  progressSent?: bigint | number;
  progressDraft?: boolean;
  invoicedAt?: bigint;
};

export type Fase = {
  index: number; // 0 … 7
  key: PhaseKey;
  cancelled: boolean;
  aftercare: boolean;
  manual: boolean; // de fase komt van de status die iemand met de hand zette, niet van een gebeurtenis
  steps: StepState[]; // per fase: gebeurd · overgeslagen · nu · nog niet
  at: (bigint | undefined)[]; // wanneer elke fase begon (voor zover bekend)
};

/** VOORLOPIG (vraag 14): welke gebeurtenis een werf naar welke fase schuift. Fase 0 = de werf bestaat; fase 7 = enkel met de hand. */
export const FASE_EVENTS: (keyof StageFacts | null)[] = [null, "quoteSentAt", "acceptedAt", "startedAt", "firstReportAt", "measuredAt", "invoicedAt", null];

/** VOORLOPIG: de status die iemand met de hand zet, is een ondergrens (vooruit zetten kan, terug niet zolang de gebeurtenis bestaat). */
export const STATUS_FLOOR: Record<string, number> = { request: 0, quoting: 1, planned: 3, running: 4, delivered: 7, aftercare: 7, cancelled: 0 };

/** Welke fases een status met de hand "gebeurd" maakt (voor de stappenbalk): in uitvoering betekent ook gestart. */
const STATUS_MARKS: Record<string, number[]> = { quoting: [1], planned: [3], running: [3, 4], delivered: [7], aftercare: [7] };

export function werfFase(f: StageFacts): Fase {
  const ev = FASE_EVENTS.map((k) => (k ? (f[k] as bigint | undefined) : undefined));
  let auto = 0;
  ev.forEach((x, i) => { if (x !== undefined && i > auto) auto = i; });
  const floor = STATUS_FLOOR[f.status] ?? 0;
  const cancelled = f.status === "cancelled";
  const index = Math.max(auto, floor);
  const marks = new Set(STATUS_MARKS[f.status] ?? []);
  const steps: StepState[] = PHASE_KEYS.map((_, i) => {
    if (i === index) return "now";
    if (i > index) return "todo";
    return i === 0 || ev[i] !== undefined || marks.has(i) ? "done" : "skipped";
  });
  return { index, key: PHASE_KEYS[index], cancelled, aftercare: f.status === "aftercare", manual: floor > auto, steps, at: ev };
}

/** Het woord van de fase (klant: eigen woorden). */
export function faseNaam(f: Fase, client = false): string {
  if (f.cancelled) return t.fase.cancelled;
  if (f.aftercare) return t.fase.aftercare;
  return (client ? t.fase.client : t.fase.names)[f.index];
}

export type WervenTab = "aanvragen" | "lopend" | "afgerond";

/** Werven → tabblad: aanvraag en offerte · akkoord tot gefactureerd · opgeleverd (en geannuleerd, enkel met het vinkje). */
export function werfGroep(f: Fase): WervenTab {
  if (f.cancelled) return "afgerond";
  return f.index < 2 ? "aanvragen" : f.index < 7 ? "lopend" : "afgerond";
}

export const TAB_KEYS = ["overzicht", "offerte", "planning", "verslagen", "opmeting", "facturatie", "vergunningen", "documenten", "wie"] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export type WerfTab = { key: TabKey; label: string; off?: string };

/**
 * De tabbladen van de werf voor deze rol. Zichtbaar = wat de caps toelaten (dezelfde gates als de blokken van vroeger;
 * de backend controleert elke oproep opnieuw). `off` = het tabblad geldt nog niet in deze fase (grijs, met uitleg).
 */
export function werfTabs(caps: Caps, f: Fase, s: StageFacts): WerfTab[] {
  const T = t.fase;
  const n = (x: bigint | number | undefined) => Number(x ?? 0);
  const off: Partial<Record<TabKey, string>> = {};
  if (f.index < 2 && n(s.tasks) === 0) off.planning = T.off.planning;
  if (f.index < 3 && s.firstReportAt === undefined) off.verslagen = T.off.verslagen;
  if (f.index < 3) off.opmeting = T.off.opmeting;
  else if (s.acceptedAt === undefined) off.opmeting = T.off.opmetingNoQuote;
  if (f.index < 3 && n(s.progressSent) === 0 && !s.progressDraft) off.facturatie = T.off.facturatie;

  let keys: TabKey[];
  let labels: Record<string, string> = T.tabs;
  if (isClient(caps)) {
    keys = ["overzicht", ...(caps.myQuotes ? ["offerte" as const] : []), ...(caps.myProgress ? ["facturatie" as const] : []), "documenten"];
    labels = { ...T.tabs, ...T.clientTabs };
    delete off.opmeting; delete off.planning; delete off.verslagen;
  } else if (caps.readTeam) {
    keys = ["overzicht"];
    if (caps.quotes) keys.push("offerte");
    keys.push("planning", "verslagen");
    if (caps.measureRead) keys.push("opmeting");
    if (caps.progress || caps.oaInvoices) keys.push("facturatie");
    if (caps.permits || caps.wadm) keys.push("vergunningen");
    keys.push("documenten", "wie");
  } else if (caps.home === "week") {
    // Externen (OA, architect, VC) krijgen geen stand van de werf (listWorkStages, review 2b.3): geen grijze tabbladen voor hen;
    // wat ze mogen zien, beslist de backend per tabblad.
    for (const k of Object.keys(off)) delete off[k as TabKey];
    // onderaannemer: zijn taken, de opmeting (voorstellen), de vergunningen en de documenten van de werf
    keys = ["overzicht", "planning", ...(caps.measureRead ? ["opmeting" as const] : []), "vergunningen", "documenten"];
  } else {
    for (const k of Object.keys(off)) delete off[k as TabKey];
    // architect, veiligheidscoördinator: verslagen enkel als BOWACO het vinkje gaf (de backend beslist per werf)
    keys = ["overzicht", "planning", "verslagen", ...(caps.measureRead ? ["opmeting" as const] : []), "vergunningen", "documenten"];
  }
  return keys.map((key) => ({ key, label: labels[key], ...(off[key] ? { off: off[key] } : {}) }));
}

/** Wie de stappenbalk ziet: kantoor en de klant (de anderen krijgen geen stand van de werf, enkel het label uit de status). */
export const toontFase = (caps: Caps) => caps.readTeam || isClient(caps);

/** De teksten van de kaart (titel, uitleg, knop), voor de test. */
export const stapTekst = (key: Stap["key"]) => t.stap[key];

/** De rol op de kaart "Volgende stap" (uit de caps). */
export type StapActie =
  | { kind: "tab"; tab: TabKey }
  | { kind: "report" } // werfverslag van vandaag
  | { kind: "werfstart" } // het openstaande voorstel Werf starten
  | { kind: "status"; status: "delivered" | "aftercare" }
  | { kind: "go"; to: string };
export type Stap = { key: keyof typeof t.stap; action: StapActie | null };

export function volgendeStap(f: Fase, s: StageFacts, caps: Caps, canEdit: boolean): Stap | null {
  const tab = (x: TabKey): StapActie => ({ kind: "tab", tab: x });
  if (isClient(caps)) {
    if (f.index >= 1 && s.quoteWaiting && caps.myQuotes) return { key: "klantOfferte", action: { kind: "go", to: "mijn-offerte" } };
    if (f.index >= 4 && Number(s.progressSent ?? 0) > 0 && caps.myProgress) return { key: "klantVordering", action: { kind: "go", to: "mijn-vordering" } };
    return { key: "klantWacht", action: tab("documenten") };
  }
  if (!caps.readTeam) return null; // architect, OA, VC: geen kaart
  if (f.cancelled) return { key: "geannuleerd", action: null };
  // Vorderingsstaten en opmeting vertrekken van een aanvaarde offerte; zonder (opdracht in regie) blijft het bij verslagen en planning.
  const prices = caps.quotePrices && caps.progress && s.acceptedAt !== undefined;
  // Meerwerk dat na het akkoord verstuurd werd en op antwoord wacht: kantoor volgt het op (review 2b.3).
  if (f.index >= 2 && s.quoteWaiting && caps.quotePrices && !(f.index === 2 && s.startPending)) return { key: "wachtMeerwerk", action: tab("offerte") };
  switch (f.index) {
    case 0:
      return caps.editQuotes ? { key: "offerteMaken", action: tab("offerte") } : { key: "wachtOfferte", action: caps.quotes ? tab("offerte") : null };
    case 1:
      if (s.quoteWaiting) return { key: "wachtAkkoord", action: caps.quotes ? tab("offerte") : null };
      return caps.editQuotes ? { key: "offerteVersturen", action: tab("offerte") } : { key: "wachtOfferte", action: caps.quotes ? tab("offerte") : null };
    case 2:
      return s.startPending && caps.workStarts ? { key: "werfStarten", action: { kind: "werfstart" } } : { key: "wachtStart", action: caps.quotes ? tab("offerte") : null };
    case 3:
      if (s.startPending && caps.workStarts) return { key: "meerwerkStarten", action: { kind: "werfstart" } };
      return caps.writeReports ? { key: "eersteVerslag", action: { kind: "report" } } : { key: "planningBekijken", action: tab("planning") };
    case 4:
      if (s.startPending && caps.workStarts) return { key: "meerwerkStarten", action: { kind: "werfstart" } };
      if (prices) {
        if (s.progressDraft) return { key: "staatAfwerken", action: tab("facturatie") };
        if (s.surveyOpen && caps.measureRead) return { key: "opmetingAfsluiten", action: tab("opmeting") };
        return { key: "staatMaken", action: tab("facturatie") };
      }
      if (caps.writeReports) return s.surveyOpen && caps.measure && s.acceptedAt !== undefined ? { key: "opmetingAfsluiten", action: tab("opmeting") } : { key: "verslagVandaag", action: { kind: "report" } };
      return { key: "planningBekijken", action: tab("planning") };
    case 5:
      if (prices) return { key: s.progressDraft ? "staatAfwerken" : "slotstaat", action: tab("facturatie") };
      return { key: "wachtSlot", action: caps.measureRead ? tab("opmeting") : null };
    case 6:
      return canEdit ? { key: "opleveren", action: { kind: "status", status: "delivered" } } : { key: "wachtOplevering", action: tab("documenten") };
    default:
      return !f.aftercare && canEdit ? { key: "nazorg", action: { kind: "status", status: "aftercare" } } : { key: "afgerond", action: tab("documenten") };
  }
}
