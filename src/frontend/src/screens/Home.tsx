// Startscherm per rol (bouwplan §8.2). In 0.6 tonen ze de werven van de persoon; planning, werfverslag
// en weekplanning vullen dit scherm vanaf 1.1–1.7. Geen begroeting: datum en week in mono erboven.
import { Button } from "../design";
import { t } from "../texts/nl";
import { Loading, Page, useWorks, WorkList } from "./common";
import { MijnTaken } from "./MijnTaken";
import { HoursPanel, MijnWerven } from "./Extern";
import { BoardAttention } from "./Weekbord";
import type { Caps } from "../backend";
import { MyTenderList } from "./Prijsvragen";
import { MijnAttesten, MijnContracten } from "./Attesten";
import { TodoBlock, TodoEenTik } from "./TeDoen";

const TITLE: Record<string, string> = { vandaag: t.home.vandaag, week: t.home.week, offertes: t.home.offertes, werven: t.home.werven };

export function Home({ kind, go, caps }: { kind: string; go: (to: string) => void; caps?: Caps }) {
  const works = useWorks();
  return (
    <Page title={TITLE[kind] ?? t.home.werven}>
      {/* 4b.4: elke externe rol heeft een eigen start. Onderaannemer = "Voor jou": eerst wat bevestigd moet worden (één knop per dag), dan de
          week, dan Te doen en de rest. Klant = de stand in één zin. Architect en veiligheidscoördinator = wat voor hen klaarstaat. */}
      {caps && kind === "week" && <MijnTaken go={go} only />}
      {caps && kind === "week" && <TodoEenTik go={go} home={caps.home} zonder={["taak-bevestigen"]} />}
      {kind === "week" && <MijnTaken go={go} />}
      {caps && !caps.readTeam && kind === "week" && <TodoBlock go={go} home={caps.home} hideEmpty zonder={["taak-bevestigen"]} />}
      {kind === "week" && caps?.myTenders && <MyTenderList go={go} embedded />}
      {kind === "week" && caps?.myDeals && <MijnContracten />}
      {kind === "week" && caps?.myDeals && <MijnAttesten />}
      {kind === "week" && <HoursPanel compact />}
      {kind === "week" && caps?.measureRead && <div><Button icon="ruler" onClick={() => go("opmeting")}>{t.opmeting.title}</Button></div>}
      {caps && !caps.readTeam && <MijnWerven go={go} />}
      {kind === "vandaag" && caps?.readOrgPlanning && <section className="a-section"><h2 className="bw-h2">{t.overzicht.attention}</h2><BoardAttention go={go} /></section>}
      {kind === "offertes" && <p className="a-note">{t.home.laterOffertes}</p>}
      <Loading q={works} />
      {works.data && (!caps || caps.readTeam) && <WorkList works={works.data.filter((w) => w.archivedAt === undefined)} go={go} empty={t.home.noWorks} />}
    </Page>
  );
}
