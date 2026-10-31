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

const TITLE: Record<string, string> = { vandaag: t.home.vandaag, week: t.home.week, offertes: t.home.offertes, werven: t.home.werven };

export function Home({ kind, go, caps }: { kind: string; go: (to: string) => void; caps?: Caps }) {
  const works = useWorks();
  return (
    <Page title={TITLE[kind] ?? t.home.werven}>
      {kind === "week" && caps?.myTenders && <MyTenderList go={go} embedded />}
      {kind === "week" && <MijnTaken go={go} />}
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
