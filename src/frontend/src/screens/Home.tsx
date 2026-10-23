// Startscherm per rol (bouwplan §8.2). In 0.6 tonen ze de werven van de persoon; planning, werfverslag
// en weekplanning vullen dit scherm vanaf 1.1–1.7. Geen begroeting: datum en week in mono erboven.
import { t } from "../texts/nl";
import { Loading, Page, useWorks, WorkList } from "./common";
import { MijnTaken } from "./MijnTaken";

const TITLE: Record<string, string> = { vandaag: t.home.vandaag, week: t.home.week, offertes: t.home.offertes, werven: t.home.werven };

export function Home({ kind, go }: { kind: string; go: (to: string) => void }) {
  const works = useWorks();
  return (
    <Page title={TITLE[kind] ?? t.home.werven}>
      {kind === "week" && <MijnTaken go={go} />}
      <p className="a-note">{kind === "offertes" ? t.home.laterOffertes : t.home.later}</p>
      <Loading q={works} />
      {works.data && <WorkList works={works.data.filter((w) => w.archivedAt === undefined)} go={go} empty={t.home.noWorks} />}
    </Page>
  );
}
