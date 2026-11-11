// 4b.3: de schil van design system versie 3. Zuivere functies (geen React, geen DOM), zodat tests/proef-4b-3.mjs ze per
// rol kan nalopen: de dichtheid, de stand van het menu (rail), het kruimelpad in de bovenbalk en de uitleg achter de ⓘ
// van elk scherm. Alles volgt uit de caps (Rights.mo is de enige matrix); hier verandert enkel de vorm.
import type { Caps } from "../backend";
import { t } from "../texts/nl";
import { activeKey, beheerTabs, hubTabs, isClient, navFor, planningTabs } from "./nav";

/** Twee dichtheden: ruim (gsm, tablet met vinger) zoals vroeger, dicht op een scherm met muis vanaf 900 px. */
export type Dichtheid = "ruim" | "dicht";
export const DICHT_VANAF = 900;
export function dichtheid(breedte: number, vinger: boolean): Dichtheid {
  return !vinger && breedte >= DICHT_VANAF ? "dicht" : "ruim";
}

/** Het menu: volledig (± 228 px), als rail (iconen) of verborgen (gsm: het menu zit dan achter de knop of de onderbalk). */
export type MenuStand = "open" | "rail" | "verborgen";
export const RAIL_TOT = 1280;
/** Zonder eigen keuze: onder 1280 px vanzelf een rail, zodat lijsten en de werf de breedte krijgen. */
export function menuStand(breedte: number, keuze: "open" | "rail" | null): MenuStand {
  if (breedte < DICHT_VANAF) return "verborgen";
  return keuze ?? (breedte < RAIL_TOT ? "rail" : "open");
}
/** De opgeslagen keuze lezen (enkel "open" of "rail"; al de rest = geen keuze). */
export function leesKeuze(v: string | null | undefined): "open" | "rail" | null {
  return v === "open" || v === "rail" ? v : null;
}

export type Kruimel = { label: string; to: string };

/** Waar je bent, voor de bovenbalk: het menu-item, daarna het tabblad van de hub of van Beheer en eventueel de werf
 *  (de werf zelf vult App aan met haar code, die enkel de werflijst van de rol kent). Nooit meer dan het menu toont. */
export function kruimels(route: string[], caps: Caps): Kruimel[] {
  const groups = navFor(caps);
  const key = activeKey(groups, route);
  const all = groups.flatMap((g) => g.items);
  const item = all.find((i) => i.key === key);
  const out: Kruimel[] = [];
  if (item) out.push({ label: item.label, to: item.to });
  const page = route[0] ?? "";
  const tabs = page === "beheer" ? beheerTabs(caps) : page === "weekbord" ? planningTabs(caps) : hubTabs(page, caps);
  const two = route.slice(0, 2).join("/");
  const tab = tabs.find((x) => x.to === two) ?? tabs.find((x) => x.to === page);
  if (tab && tabs.length > 1 && tab.label !== item?.label) out.push({ label: tab.label, to: tab.to }); // mag hetzelfde adres hebben als het menu-item (Facturatie → Facturen): de sleutel in App is de plaats
  if (page === "te-doen" && !item) out.push({ label: t.todo.title, to: "te-doen" });
  if (page === "login" && !item) out.push({ label: t.nav.login, to: "login" });
  return out;
}

/** Of het scherm van deze route zijn ⓘ krijgt: het scherm zelf of een tabblad ervan, en een werklijst met een gekozen
 *  regel (de lijst blijft in beeld). Niet: een werf (die heeft haar eigen kop) of een stuk dat los openstaat. */
export function toontUitleg(r: string[]): boolean {
  if (r.length <= 1) return true;
  if (r.length > 2) return false;
  const [p, s] = r;
  if (p === "werven") return !/^\d+$/.test(s);
  if (s === "nieuw") return false; // een formulier krijgt de uitleg van de lijst niet
  return ["beheer", "weekbord", "oa-facturen", "adresboek"].includes(p);
}

/** De uitleg achter de ⓘ naast de schermtitel (L6: niet meer als alinea boven het scherm). Per rol waar de rol
 *  iets anders ziet (bv. offertes zonder prijzen). Geen bedragen, geen namen; null = het scherm heeft geen uitleg nodig. */
export function paginaUitleg(page: string, caps: Caps, sub?: string): string | null {
  const U = t.schil.uitleg;
  switch (page) {
    case "overzicht": return U.overzicht;
    case "te-doen": return t.todo.lead;
    case "vandaag": return caps.writeReports ? U.vandaag : null;
    case "week": return t.mine.lead;
    case "uren": return t.hours.lead;
    case "werven":
      if (isClient(caps)) return U.mijnWerf;
      return caps.readTeam ? U.werven : U.mijnWerven;
    case "weekbord":
      return sub === "afwezigheden" ? t.planningTabs.absLead : sub === "conflicten" ? U.conflicten : t.board.lead;
    case "offertes": return caps.quotePrices ? t.offertes.lead : t.offertes.leadTotals;
    case "prijsvragen": return caps.tenders ? (caps.quotePrices ? t.prijsvragen.overviewLead : t.prijsvragen.leadLeader) : U.mijnPrijsvragen;
    case "posten": return `${t.posten.lead}${caps.libraryPrices ? "" : ` ${t.posten.leadNoPrices}`}`;
    case "facturen": return U.facturen;
    case "vorderingen": return `${t.vorderingen.lead} ${t.uitleg.vordering}`;
    case "oa-facturen": return caps.quotePrices ? t.oaFacturen.lead : t.oaFacturen.leadQty;
    case "nacalculatie": return t.nacalc.leadAll;
    case "mijn-facturen": return U.mijnFacturen;
    case "mijn-offerte": return t.mijnOfferte.lead;
    case "mijn-vordering": return t.mijnVordering.lead;
    case "vergunningen": return t.permits.lead;
    case "gemeenten": return t.gemeenten.lead;
    case "werfadministratie": return t.wadm.pageLead;
    case "opmeting": return t.opmeting.lead;
    case "team": return t.team.lead;
    case "adresboek": return t.adresboek.lead;
    case "briefing": return t.briefing.lead;
    case "beheer": return U.beheer;
    case "login": return U.login;
    default: return null;
  }
}

/** Een teller bij een onderdeel van het dossier (de werf): hoeveel er is en of iets aandacht vraagt. Enkel tellingen uit
 *  de stand die de backend per rol filtert (listWorkStages) en de werf zelf; geen bedragen. */
export type Teller = { n: number; aandacht: boolean };
type DossierFeiten = {
  tasks?: bigint | number;
  quoteWaiting?: boolean;
  next?: {
    salesDue: bigint; salesLate: bigint; hoursOpen: bigint; addendums: bigint; contractsToSign: bigint;
    attestsSoon: bigint; attestsExpired: bigint; declareBy?: bigint; tender?: { asked: bigint; answered: bigint; compare: boolean };
  };
};
export function onderdeelTellers(f: DossierFeiten, docsOpen: bigint | number | undefined): Partial<Record<string, Teller>> {
  const n = (x: bigint | number | undefined) => Number(x ?? 0);
  const x = f.next;
  const out: Partial<Record<string, Teller>> = {};
  const zet = (k: string, aantal: number, aandacht: boolean) => { if (aantal > 0 || aandacht) out[k] = { n: aantal, aandacht }; };
  const tender = x?.tender;
  const openVragen = tender ? Math.max(0, n(tender.asked) - n(tender.answered)) : 0;
  zet("offerte", (f.quoteWaiting ? 1 : 0) + openVragen, !!f.quoteWaiting || !!tender?.compare);
  zet("planning", n(f.tasks), false);
  if (x) {
    zet("facturatie", n(x.salesDue) + n(x.salesLate) + n(x.hoursOpen) + n(x.addendums), n(x.salesLate) > 0 || n(x.salesDue) > 0);
    zet("wie", n(x.contractsToSign) + n(x.attestsSoon) + n(x.attestsExpired), n(x.attestsExpired) > 0 || n(x.contractsToSign) > 0);
    zet("vergunningen", x.declareBy !== undefined ? 1 : 0, x.declareBy !== undefined);
  }
  zet("documenten", n(docsOpen), n(docsOpen) > 0);
  return out;
}
