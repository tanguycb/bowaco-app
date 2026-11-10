// Maandagbriefing (stap 4.4): het wekelijkse overzicht voor de beheerder, door de app zelf samengesteld (readBriefing: een query zonder
// bedragen). De afwijkingen uit de nacalculatie (4.6, met bedragen) voegt de browser toe voor wie bedragen mag zien. Enkel lezen.
import { useQuery } from "@tanstack/react-query";
import type { BrItem, BrSection, Caps } from "../backend";
import { computeBrief } from "../nacalc/calc";
import { t } from "../texts/nl";
import { fmtDayNum, fmtEuro, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";

const T = t.briefing;

function useBriefing() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["briefing"], queryFn: () => actor!.readBriefing(), enabled: !!actor && !isFetching, retry: false });
}

const whenText = (s: BrSection, i: BrItem) => {
  if (s.key === "week") return i.day !== undefined ? fmtDayNum(i.day) : "";
  if (i.days === undefined) return i.day !== undefined ? fmtDayNum(i.day) : "";
  const d = Number(i.days);
  return s.key === "proposals" || s.key === "invoices" || s.key === "clients" ? T.waiting(d) : `${i.day !== undefined ? fmtDayNum(i.day) + " · " : ""}${T.daysTo(d)}`;
};

function ItemRow({ s, i, go }: { s: BrSection; i: BrItem; go: (to: string) => void }) {
  return (
    <li>
      {i.workId !== undefined && <a href={`#/werven/${i.workId}`} onClick={(e) => { e.preventDefault(); go(`werven/${i.workId}`); }}>{i.workCode}</a>}
      {i.workId !== undefined ? " · " : ""}<strong>{i.title}</strong>
      {i.detail && <span className="bw-muted"> — {i.detail}</span>}
      {whenText(s, i) && <span className="bw-muted"> ({whenText(s, i)})</span>}
    </li>
  );
}

/** Op het Overzicht van de beheerder: per onderdeel het aantal, met een link naar de volledige briefing. */
export function BriefingBlock({ go }: { go: (to: string) => void }) {
  const q = useBriefing();
  return (
    <section className="a-section" data-testid="briefing-block">
      <h2 className="bw-h2">{T.title}</h2>
      <Loading q={q} />
      {q.data && (
        <ul className="a-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {q.data.sections.map((s) => <li key={s.key}>{s.title}: <strong>{T.count(Number(s.total))}</strong></li>)}
        </ul>
      )}
      <p><a href="#/briefing" onClick={(e) => { e.preventDefault(); go("briefing"); }}>{T.open}</a></p>
    </section>
  );
}

/** De volledige briefing. */
export function BriefingPage({ go, caps }: { go: (to: string) => void; caps: Caps }) {
  const q = useBriefing();
  const v = q.data;
  return (
    <Page title={T.title}>
      <p className="bw-muted">{T.lead}</p>
      <Loading q={q} />
      {v && <p className="bw-muted">{T.week(fmtDayNum(v.monday), fmtDayNum(v.sunday))}</p>}
      {v?.sections.map((s) => (
        <section className="a-section" key={s.key} data-testid={`briefing-${s.key}`}>
          <h2 className="bw-h2">{s.title} <span className="bw-muted">({Number(s.total)})</span></h2>
          {s.items.length === 0 ? <p className="bw-muted">{T.none}</p> : <ul>{s.items.map((i, k) => <ItemRow key={k} s={s} i={i} go={go} />)}</ul>}
          {Number(s.total) > s.items.length && <p className="bw-muted">{T.more(Number(s.total) - s.items.length)}</p>}
        </section>
      ))}
      {caps.minMeer && <Deviations go={go} />}
      <p className="bw-muted">{T.printHint}</p>
    </Page>
  );
}

function Deviations({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["nacalcAll"], queryFn: async () => unwrap(await actor!.nacalcOverview()), enabled: !!actor && !isFetching, retry: false });
  const s = q.data?.settings;
  const rows = (q.data?.rows ?? []).map((b) => ({ b, o: computeBrief(b as never, s as never) })).filter((x) => x.o.flag !== "ok").sort((a, b) => (Number(b.o.diffCents < 0n ? -b.o.diffCents : b.o.diffCents) - Number(a.o.diffCents < 0n ? -a.o.diffCents : a.o.diffCents))).slice(0, 15);
  return (
    <section className="a-section" data-testid="briefing-deviations">
      <h2 className="bw-h2">{T.deviations} <span className="bw-muted">({rows.length})</span></h2>
      <p className="bw-muted">{T.deviationsLead}</p>
      <Loading q={q} />
      {q.isSuccess && rows.length === 0 && <p className="bw-muted">{T.deviationsNone}</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map(({ b, o }) => (
            <li key={String(b.workId)}>
              <a href={`#/werven/${b.workId}/facturatie/nacalculatie`} onClick={(e) => { e.preventDefault(); go(`werven/${b.workId}/facturatie/nacalculatie`); }}>{b.workCode}</a> · {b.workName}
              <span className="bw-muted"> — {t.nacalc.flag[o.flag]}: {fmtEuro(o.diffCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
