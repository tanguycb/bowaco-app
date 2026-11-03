// 2b.3: de werf als centrum. Hier staan, als zuivere functies (tests/fase.mjs laadt ze in node):
//   • werfFase: de fase van een werf, afgeleid uit wat er gebeurde (listWorkStages) en de status die iemand met de hand zette;
//   • werfGroep: het tabblad van Werven (aanvragen & offertes · lopend · afgerond);
//   • werfTabs: de tabbladen van de werf per rol (uit de caps; Rights.mo blijft de enige matrix) en welke nog niet gelden;
//   • volgendeStap: de ene knop op de kaart "Volgende stap", per fase en rol.
// VOORLOPIG: de regels volgen het prototype (BOWACO_prototype_2b.md, vraag 14); Alexis antwoordde nog niet. Wie ze aanpast,
// past enkel FASE_EVENTS en STATUS_FLOOR aan (en de uitleg in texts/nl.ts → fase.rules).
import type { Caps, NextFacts } from "../backend";
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
  /** Deel A van de open punten: prijsvraag, contract, attesten, uren, verzekering, schijf. Enkel tellingen en dagen, per rol gefilterd door de backend. */
  next?: NextFacts;
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
  // 2c.6: vanaf het akkoord van de klant open (de voorschotfactuur komt vóór de start).
  if (f.index < 3 && n(s.progressSent) === 0 && !s.progressDraft && s.acceptedAt === undefined) off.facturatie = T.off.facturatie;

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
  | { kind: "tab"; tab: TabKey; sub?: string }
  | { kind: "report" } // werfverslag van vandaag
  | { kind: "werfstart" } // het openstaande voorstel Werf starten
  | { kind: "status"; status: "delivered" | "aftercare" }
  | { kind: "go"; to: string };
/** Gegevens voor de zin op de kaart (firma, titel, aantallen, dag als getal): de kaart zet ze om naar tekst (t.stapDetail). */
export type StapData = { n?: number; of?: number; firm?: string; title?: string; day?: bigint };
export type Stap = { key: keyof typeof t.stap; action: StapActie | null; data?: StapData };

/** Dagen vooruit waarbinnen "verzekering aangeven" op de kaart komt (de uiterste dag zelf staat in de zin). */
export const DECLARE_WINDOW = 14;

// Review L8: de lokale dag (zoals todayDay in util.ts en Post.local in de backend), niet de UTC-dag.
const dayNow = () => { const n = new Date(); return BigInt(Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86_400_000)); };

/**
 * 2c-open punten, deel A: de nieuwe stappen van de kaart. Volgorde: wat geld kost of wettelijk vastzit gaat voor (vervallen factuur,
 * contract, vergelijken, uren, aangifte, schijf, attest); een lopende prijsvraag enkel vóór de start. De backend geeft de feiten al per
 * recht (werfleider: geen bedragen, dus ook geen factuurfeiten; OA en klant niets); de caps hier zijn een tweede slot.
 */
function nieuweStap(f: Fase, s: StageFacts, caps: Caps, today: bigint): Stap | null {
  const n = s.next;
  if (!n) return null;
  const tab = (x: TabKey, sub?: string): StapActie => ({ kind: "tab", tab: x, ...(sub ? { sub } : {}) });
  const num = (x: bigint | number) => Number(x);
  if (caps.sales && caps.quotePrices && num(n.salesLate) > 0) return { key: "factuurVervallen", action: tab("facturatie", "facturen"), data: { n: num(n.salesLate) } };
  if (num(n.contractsToSign) > 0) return { key: "contractTekenen", action: tab("wie"), data: { n: num(n.contractsToSign), firm: n.contractFirm } };
  if (num(n.addendums) > 0) return { key: "aanhangselNodig", action: tab("wie"), data: { n: num(n.addendums) } };
  if (caps.tenders && caps.quotePrices && n.tender?.compare) return { key: "prijsvraagKiezen", action: tab("offerte", "oa-offertes"), data: { title: n.tender.title, n: num(n.tender.answered), of: num(n.tender.asked), ...(n.tender.deadlineDay !== undefined ? { day: n.tender.deadlineDay } : {}) } };
  if (caps.hourClaims && num(n.hoursOpen) > 0) return { key: "urenBevestigen", action: tab("facturatie", "aankoop"), data: { n: num(n.hoursOpen) } };
  if (caps.siteAdmin && n.declareBy !== undefined && n.declareBy <= today + BigInt(DECLARE_WINDOW)) return { key: "verzekeringAangeven", action: tab("vergunningen"), data: { day: n.declareBy } };
  if (caps.sales && caps.quotePrices && num(n.salesDue) > 0) return { key: "schijfFactureren", action: tab("facturatie", "facturen"), data: { n: num(n.salesDue), ...(n.salesDueDay !== undefined ? { day: n.salesDueDay } : {}) } };
  if (num(n.attestsSoon) + num(n.attestsExpired) > 0) return { key: "attestVervalt", action: tab("wie"), data: { n: num(n.attestsSoon) + num(n.attestsExpired), ...(n.attestDay !== undefined ? { day: n.attestDay } : {}) } };
  if (caps.tenders && caps.quotePrices && n.tender && !n.tender.compare && f.index <= 2) return { key: "prijsvraagLoopt", action: tab("offerte", "prijsvragen"), data: { title: n.tender.title, n: num(n.tender.answered), of: num(n.tender.asked), ...(n.tender.deadlineDay !== undefined ? { day: n.tender.deadlineDay } : {}) } };
  return null;
}

export function volgendeStap(f: Fase, s: StageFacts, caps: Caps, canEdit: boolean, today: bigint = dayNow()): Stap | null {
  const tab = (x: TabKey): StapActie => ({ kind: "tab", tab: x });
  if (isClient(caps)) {
    if (f.index >= 1 && s.quoteWaiting && caps.myQuotes) return { key: "klantOfferte", action: { kind: "go", to: "mijn-offerte" } };
    if (f.index >= 4 && Number(s.progressSent ?? 0) > 0 && caps.myProgress) return { key: "klantVordering", action: { kind: "go", to: "mijn-vordering" } };
    return { key: "klantWacht", action: tab("documenten") };
  }
  if (!caps.readTeam) return null; // architect, OA, VC: geen kaart
  if (f.cancelled) return { key: "geannuleerd", action: null };
  const extra = nieuweStap(f, s, caps, today);
  if (extra) return extra;
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
