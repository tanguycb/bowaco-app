// 2b.2: Beheer = één pagina met tabbladen (bedrijf · offertes & voorwaarden · opmeting & facturatie · planning ·
// documenten · voertuigen & ritten · mail · toegang & codes · auditlog & export). Elk tabblad toont enkel wat de rol
// mag (beheerTabs volgt uit de caps); de onderdelen zijn die van het vroegere Instellingen, Postbode, Codes, Auditlog
// en Boete opzoeken, onveranderd.
import type { ReactNode } from "react";
import type { Caps, PersonView } from "../backend";
import { t } from "../texts/nl";
import { beheerTabs } from "../app/nav";
import { TabBar } from "./Tabs";
import { Page } from "./common";
import { Audit } from "./Audit";
import { BoetesPage } from "./Boetes";
import { Codes } from "./Codes";
import { PostbodePage } from "./Postbode";
import { CompanyCalendar, Templates } from "./PlanSettings";
import { WadmRules } from "./Werfadministratie";
import { PermitKindsSettings } from "./Vergunningen";
import { MarginClassesAdmin, TextBlocksAdmin } from "./OfferteVorm";
import { DocKinds, ImportBatches, OaFactuurAdmin, OpmetingAdmin, QuoteDocsAdmin, QuoteNumbers, QuoteRulesAdmin, SettingsFields, Trades, VorderingAdmin, Vehicles } from "./Instellingen";

export function Beheer({ caps, me, route, go }: { caps: Caps; me: PersonView; route: string[]; go: (to: string) => void }) {
  const tabs = beheerTabs(caps);
  const cur = tabs.find((x) => x.key === route[1]) ?? tabs[0];
  if (!cur) return null;
  const own = (title: string, body: ReactNode) => <Page title={title} label={t.beheer.title}>{body}</Page>;
  let body: ReactNode = null;
  switch (cur.key) {
    case "bedrijf": body = own(cur.label, <><SettingsFields show={{ wl: true }} /><CompanyCalendar /></>); break;
    case "offertes": body = own(cur.label, <><QuoteNumbers /><MarginClassesAdmin /><TextBlocksAdmin /><QuoteRulesAdmin /><QuoteDocsAdmin /></>); break;
    case "opmeting": body = own(cur.label, <><SettingsFields show={{ thresholds: true }} /><WadmRules /><OpmetingAdmin /><VorderingAdmin /><OaFactuurAdmin /></>); break;
    case "planning": body = own(cur.label, <><Templates /><Trades /><ImportBatches /></>); break;
    case "documenten": body = own(cur.label, <><DocKinds />{caps.managePermitKinds && <PermitKindsSettings />}</>); break;
    case "voertuigen": body = caps.readTrips ? <BoetesPage go={go} extra={caps.manageVehicles ? <Vehicles /> : undefined} /> : own(cur.label, <Vehicles />); break;
    case "mail": body = <PostbodePage />; break;
    case "toegang": body = <Codes caps={caps} me={me} extra={caps.manageSettings ? <SettingsFields show={{ days: true }} /> : undefined} />; break;
    case "audit": body = <Audit caps={caps} />; break;
  }
  return (
    <>
      <TabBar tabs={tabs} current={cur.key} go={go} label={t.menu.tabs} />
      {body}
    </>
  );
}
