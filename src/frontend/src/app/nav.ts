// 2b.2: het menu per rol, gegroepeerd (Werk · Geld · Opvolging · Adresboek + Beheer), de tabbladen van de hubs en
// de oude adressen. Alles volgt uit de caps van de backend (Rights.mo is de enige matrix); hier verandert enkel de
// ordening. Zuivere functies, zodat tests/menu.mjs ze per rol kan nalopen.
import type { Caps } from "../backend";
import type { IconName } from "../design/Icon";
import { t } from "../texts/nl";

export type NavItem = { key: string; label: string; icon: IconName; to: string; match: string[] };
export type NavGroup = { id: string; label: string | null; items: NavItem[] };
export type Tab = { key: string; label: string; to: string };

const M = t.menu;

const item = (key: string, label: string, icon: IconName, match: string[] = [key], to = key): NavItem => ({ key, label, icon, to, match });

/** De sleutels van alle schermen die iemand mag openen (ook zonder menu-item): de bladwijzers van vroeger blijven werken. */
export function pagesFor(caps: Caps): Set<string> {
  const s = new Set<string>([caps.home, "login", "werven"]);
  if (caps.writeReports) { s.add("vandaag"); s.add("verslag"); }
  if (caps.workStarts) s.add("werfstart");
  if (caps.home === "week") s.add("uren");
  if (caps.readOrgPlanning) s.add("weekbord"); // 2b.4: het Dashboard is weg (#/dashboard verwijst door, zie resolveRoute)
  if (caps.myQuotes) s.add("mijn-offerte");
  if (caps.quotes) s.add("offertes");
  if (caps.measureRead) s.add("opmeting");
  if (caps.progress) s.add("vorderingen");
  if (caps.myProgress) s.add("mijn-vordering");
  if (caps.oaInvoices) s.add("oa-facturen");
  if (caps.myOaInvoices) s.add("mijn-facturen");
  if (caps.tenders || caps.myTenders) s.add("prijsvragen"); // 2c.2: werklijst (kantoor) of Mijn prijsvragen (OA)
  if (caps.readLibrary) s.add("posten");
  if (caps.permits) s.add("vergunningen");
  if (caps.readMunicipalities) s.add("gemeenten");
  if (caps.wadm) s.add("werfadministratie");
  if (caps.readTeam) s.add("team");
  if (caps.readTeam || caps.readOa) s.add("adresboek");
  if (beheerTabs(caps).length > 0) s.add("beheer");
  return s;
}

/** Het adres dat een oude bladwijzer vandaag krijgt (Instellingen, Codes, Auditlog, Postbode, Boete opzoeken …). */
export const OLD_TO_NEW: Record<string, string> = {
  organisaties: "adresboek",
  onderaannemers: "adresboek",
  instellingen: "beheer/bedrijf",
  codes: "beheer/toegang",
  audit: "beheer/audit",
  postbode: "beheer/mail",
  boetes: "beheer/voertuigen",
};

/** 2b.3: oude adressen met een werf erin → het tabblad van die werf (vorderingen/w/12 → werven/12/facturatie). */
export function oldWorkRoute(route: string[]): string | undefined {
  if (route[0] === "vorderingen" && route[1] === "w" && route[2] && /^\d+$/.test(route[2])) return `werven/${route[2]}/facturatie`;
  return undefined;
}

/** Een route → het scherm dat opent, en eventueel het nieuwe adres waarnaar de adresbalk doorverwijst. */
export function resolveRoute(route: string[], caps: Caps): { page: string; redirect?: string } {
  // 2b.4: het Dashboard bestaat niet meer: de tellers staan in Overzicht (beheerder) en Werven → Lopend (werfleider, calculator).
  if (route[0] === "dashboard" && caps.readOrgPlanning) {
    const to = caps.home === "overzicht" ? "overzicht" : "werven/lopend";
    return { page: to.split("/")[0], redirect: to };
  }
  const toWork = oldWorkRoute(route);
  if (toWork) return { page: "werven", redirect: toWork };
  const old = route[0] ? OLD_TO_NEW[route[0]] : undefined;
  if (old) return { page: old.split("/")[0], redirect: [old, ...route.slice(1)].join("/") };
  const allowed = pagesFor(caps);
  return { page: route[0] && allowed.has(route[0]) ? route[0] : caps.home };
}

/** Beheer = één pagina met tabbladen; elk tabblad toont enkel wat de rol mag. */
export function beheerTabs(caps: Caps): Tab[] {
  const B = t.beheer.tabs;
  const tabs: [string, string, boolean][] = [
    ["bedrijf", B.bedrijf, caps.manageSettings],
    ["offertes", B.offertes, caps.manageSettings],
    ["opmeting", B.opmeting, caps.manageSettings],
    ["planning", B.planning, caps.manageSettings],
    ["documenten", B.documenten, caps.manageSettings],
    ["voertuigen", B.voertuigen, caps.readTrips || caps.manageVehicles],
    ["mail", B.mail, caps.manageRobots],
    ["toegang", B.toegang, caps.inviteExternal || caps.manageAccess],
    ["audit", B.audit, caps.readAudit || caps.export],
  ];
  return tabs.filter((x) => x[2]).map(([key, label]) => ({ key, label, to: `beheer/${key}` }));
}

/** 2b.4 (WC-03, V4): Planning heeft drie tabbladen; elk vraagt dezelfde leesrechten als het weekbord. */
export function planningTabs(caps: Caps): Tab[] {
  const P = t.planningTabs;
  if (!caps.readOrgPlanning) return [];
  return [
    { key: "weekbord", label: P.weekbord, to: "weekbord" },
    { key: "weekbord/afwezigheden", label: P.afwezigheden, to: "weekbord/afwezigheden" },
    { key: "weekbord/conflicten", label: P.conflicten, to: "weekbord/conflicten" },
  ];
}

/** Hubs: schermen die samen één menu-item delen krijgen een tabbalk (alleen wat de rol mag). */
export function hubTabs(page: string, caps: Caps): Tab[] {
  const tab = (key: string, label: string, ok: boolean): [string, string, boolean] => [key, label, ok];
  let list: [string, string, boolean][] = [];
  if (page === "offertes" || page === "posten" || (page === "prijsvragen" && caps.tenders)) list = [tab("offertes", M.offertesTab, caps.quotes), tab("prijsvragen", M.prijsvragenTab, caps.tenders), tab("posten", M.postenTab, caps.readLibrary)];
  else if (page === "vorderingen" || page === "oa-facturen") list = [tab("vorderingen", M.vorderingenTab, caps.progress), tab("oa-facturen", M.oaFacturenTab, caps.oaInvoices)];
  else if (page === "vergunningen" || page === "werfadministratie" || page === "gemeenten") list = [tab("vergunningen", M.vergunningenTab, caps.permits), tab("werfadministratie", M.wadmTab, caps.wadm), tab("gemeenten", M.gemeentenTab, caps.readMunicipalities)];
  else if (isClient(caps) && (page === "werven" || page === "mijn-offerte" || page === "mijn-vordering")) list = [tab("werven", M.mijnWerfTab, true), tab("mijn-offerte", M.mijnOfferteTab, caps.myQuotes), tab("mijn-vordering", M.mijnVorderingTab, caps.myProgress)];
  return list.filter((x) => x[2]).map(([key, label]) => ({ key, label, to: key }));
}

export const isClient = (caps: Caps) => !caps.readTeam && (caps.myQuotes || caps.myProgress);
const isInternal = (caps: Caps) => caps.readTeam;

/** Het menu: groepen (Werk · Geld · Opvolging · Adresboek), Beheer, en voor werfleider en calculator ook Meer. */
export function navFor(caps: Caps): NavGroup[] {
  const G = M.groups;
  const admin = caps.home === "overzicht";
  const lead = caps.home === "vandaag";
  const deskFirst = admin || lead; // admin en werfleider hebben Planning als hoofditem; de calculator onder Meer
  const werk: NavItem[] = [];
  const geld: NavItem[] = [];
  const opv: NavItem[] = [];
  const adres: NavItem[] = [];
  const meer: NavItem[] = [];
  const loose: NavItem[] = [];

  if (admin) werk.push(item("overzicht", t.nav.overzicht, "grid", ["overzicht", "vandaag", "verslag", "werfstart"]));
  if (lead) werk.push(item("vandaag", t.nav.vandaag, "home", ["vandaag", "verslag", "werfstart"]));
  if (caps.home === "week") {
    werk.push(item("week", t.nav.week, "calendar", ["week", "opmeting", "prijsvragen"]));
    werk.push(item("uren", t.nav.uren, "clock"));
    if (caps.myOaInvoices) werk.push(item("mijn-facturen", t.nav.mijnFacturen, "receipt"));
  } else if (isInternal(caps)) {
    werk.push(item("werven", t.nav.werven, "building", ["werven", "opmeting"]));
  } else {
    werk.push(item("werven", isClient(caps) ? M.mijnWerf : M.mijnWerven, "building", isClient(caps) ? ["werven", "mijn-offerte", "mijn-vordering", "opmeting"] : ["werven", "opmeting"]));
  }
  if (caps.readOrgPlanning) (deskFirst ? werk : meer).push(item("weekbord", M.planning, "calendar"));

  // Geld: wie prijzen ziet. De werfleider ziet offertes en facturatie (zonder bedragen) in de werf.
  if (caps.quotes && caps.quotePrices) geld.push(item("offertes", t.nav.offertes, "euro", ["offertes", "posten", "prijsvragen"]));
  if ((caps.progress || caps.oaInvoices) && caps.quotePrices) geld.push(item("facturatie", M.facturatie, "receipt", ["vorderingen", "oa-facturen"], caps.progress ? "vorderingen" : "oa-facturen"));
  if (caps.readLibrary && !caps.quotePrices) meer.push(item("posten", t.nav.posten, "doc"));

  // Opvolging
  const opvTo = caps.permits ? "vergunningen" : caps.wadm ? "werfadministratie" : "gemeenten";
  if (caps.permits || caps.wadm || caps.readMunicipalities) (caps.permits ? opv : meer).push(item("opvolging", M.opvolging, "permit", ["vergunningen", "werfadministratie", "gemeenten"], opvTo));

  // Adresboek
  if (caps.readTeam || caps.readOa) adres.push(item("adresboek", t.nav.adresboek, "building", ["adresboek"]));
  if (caps.readTeam) (admin ? adres : meer).push(item("team", t.nav.team, "people"));

  // Beheer (admin) of de losse onderdelen die een andere rol uit Beheer mag zien (AB-4: de werfleider houdt zijn codes).
  const tabs = beheerTabs(caps);
  if (caps.manageSettings) loose.push(item("beheer", M.beheer, "settings", ["beheer"], tabs[0].to));
  else for (const tb of tabs) meer.push(item(`beheer-${tb.key}`, tb.key === "voertuigen" ? M.ritten : tb.label, tb.key === "voertuigen" ? "truck" : "key", [`beheer/${tb.key}`], tb.to));

  const groups: NavGroup[] = [
    { id: "werk", label: geld.length || opv.length || adres.length ? G.werk : null, items: werk },
    { id: "geld", label: G.geld, items: geld },
    { id: "opvolging", label: G.opvolging, items: opv },
    { id: "adresboek", label: G.adresboek, items: adres },
    { id: "beheer", label: null, items: loose },
    { id: "meer", label: G.meer, items: meer },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Hoeveel menu-items iemand heeft (Meer telt als één, zoals in het prototype). */
export function itemCount(groups: NavGroup[]): number {
  return groups.reduce((n, g) => n + (g.id === "meer" ? 1 : g.items.length), 0);
}

/** Welk menu-item hoort bij de huidige route ("beheer/voertuigen" telt voor de losse onderdelen van een niet-beheerder). */
export function activeKey(groups: NavGroup[], route: string[]): string | undefined {
  const first = route[0] ?? "";
  const two = route.slice(0, 2).join("/");
  const all = groups.flatMap((g) => g.items);
  return (all.find((i) => i.match.includes(two)) ?? all.find((i) => i.match.includes(first)))?.key;
}

/** De vaste balk onderaan op de gsm, voor de werfleider (startscherm Vandaag): Vandaag · Werven · + Verslag · Meer. */
export function bottomBar(caps: Caps): string[] {
  return caps.home === "vandaag" && caps.writeReports ? ["vandaag", "werven", "verslag", "meer"] : [];
}
