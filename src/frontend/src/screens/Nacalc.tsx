// Nacalculatie (stap 4.6): gepland (getekende offerte) tegenover werkelijk (min-meerstaat + goedgekeurde aankoopfacturen), per werf (werf →
// Facturatie → Nacalculatie), over alle werven (Facturatie → Nacalculatie) en de drempel (Beheer). De backend (readNacalc, nacalcOverview:
// update-calls met auditregel, enkel admin en calculator) geeft de feiten; de browser rekent met nacalc/calc.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NcBrief, NcFacts } from "../backend";
import { Button, useToast } from "../design";
import { compute, computeBrief, type BriefOut, type Facts, type Flag, type Group } from "../nacalc/calc";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtEuro, parseEuro, parsePct, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";

const T = t.nacalc;
const flagText = (f: Flag) => T.flag[f] ?? f;
const flagStyle = (f: Flag) => (f === "meer" || f === "ongepland" ? { color: "var(--bw-danger, #b42318)", fontWeight: 600 } : f === "minder" ? { color: "var(--bw-warn, #b54708)", fontWeight: 600 } : undefined);
const pct = (bp: bigint | null) => (bp === null ? "–" : fmtBp(bp));
const signed = (c: bigint) => (c > 0n ? "+" : "") + fmtEuro(c);

/** De feiten van de backend als invoer voor de rekenmodule (de vorm komt overeen). */
export const toFacts = (f: NcFacts): Facts => f as unknown as Facts;

function FlagCell({ flag }: { flag: Flag }) {
  return <span style={flagStyle(flag)}>{flag === "ok" ? "" : flagText(flag)}</span>;
}

function GroupTable({ title, head, groups, label }: { title: string; head: string; groups: Group[]; label: (g: Group) => string }) {
  if (groups.length === 0) return null;
  const hasSell = groups.some((g) => g.actualSellCents !== null);
  return (
    <section className="a-section" data-testid={`nc-group-${head}`}>
      <h3 className="bw-h3">{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="a-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>{head}</th>
              {hasSell && <><th className="bw-num">{T.colPlannedSell}</th><th className="bw-num">{T.colActualSell}</th></>}
              <th className="bw-num">{T.colPlannedCost}</th>
              <th className="bw-num">{T.colActualCost}</th>
              <th className="bw-num">{T.colDiff}</th>
              <th>{T.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} data-flag={g.flag}>
                <td>{label(g)}{g.pendingCostCents !== 0n && <div className="bw-muted" style={{ fontSize: 12 }}>{`+ ${fmtEuro(g.pendingCostCents)} wacht`}</div>}</td>
                {hasSell && <><td className="bw-num">{fmtEuro(g.plannedSellCents)}</td><td className="bw-num">{g.actualSellCents === null ? "–" : fmtEuro(g.actualSellCents)}</td></>}
                <td className="bw-num">{fmtEuro(g.plannedCostCents)}</td>
                <td className="bw-num">{fmtEuro(g.actualCostCents)}</td>
                <td className="bw-num" style={flagStyle(g.flag)}>{signed(g.diffCents)}{g.diffBp !== null && <span className="bw-muted"> ({pct(g.diffBp)})</span>}</td>
                <td><FlagCell flag={g.flag} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Werf → Facturatie → Nacalculatie. */
export function WorkNacalc({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["nacalc", String(workId)], queryFn: async () => unwrap(await actor!.readNacalc(workId)), enabled: !!actor && !isFetching, retry: false });
  const f = q.data;
  return (
    <section className="a-section" data-testid="nacalc">
      <h2 className="bw-h2">{T.title}</h2>
      <p className="bw-muted">{T.lead}</p>
      <Loading q={q} />
      {q.isSuccess && !f && <p className="bw-muted">{T.noBase}</p>}
      {f && <Body f={f} />}
    </section>
  );
}

function Body({ f }: { f: NcFacts }) {
  const r = compute(toFacts(f));
  const unpriced = f.planned.filter((p) => p.costCents === undefined && p.sellCents !== 0n).length;
  const hoursOpen = f.hours.filter((h) => h.openMilli > 0n || h.disputedMilli > 0n).length;
  return (
    <>
      <p className="bw-muted">{`${f.baseQuote} · ${T.diff.toLowerCase()}: `}<strong style={flagStyle(r.flag)}>{signed(r.diffCents)}{r.diffBp !== null ? ` (${pct(r.diffBp)})` : ""}{r.flag === "ok" ? "" : ` · ${flagText(r.flag)}`}</strong></p>
      <div style={{ overflowX: "auto" }}>
        <table className="a-table" style={{ minWidth: 420 }} data-testid="nc-total">
          <thead><tr><th /><th className="bw-num">{T.planned}</th><th className="bw-num">{T.actual}</th></tr></thead>
          <tbody>
            <tr><td>{T.sell}</td><td className="bw-num">{fmtEuro(r.plannedSellCents)}</td><td className="bw-num">{fmtEuro(r.actualSellCents)}</td></tr>
            <tr><td>{T.cost}</td><td className="bw-num">{fmtEuro(r.plannedCostCents)}</td><td className="bw-num">{fmtEuro(r.actualCostCents)}</td></tr>
            <tr><td><strong>{T.margin}</strong></td><td className="bw-num"><strong>{fmtEuro(r.plannedMarginCents)}</strong></td><td className="bw-num"><strong>{fmtEuro(r.actualMarginCents)}</strong></td></tr>
            <tr><td>{T.marginPct}</td><td className="bw-num">{pct(r.plannedMarginBp)}</td><td className="bw-num">{pct(r.actualMarginBp)}</td></tr>
            <tr><td>{T.delta}</td><td /><td className="bw-num">{signed(r.marginDeltaCents)}</td></tr>
            <tr><td>{T.invoiced}</td><td /><td className="bw-num">{fmtEuro(r.invoicedCents)}</td></tr>
          </tbody>
        </table>
      </div>
      {r.pendingCostCents !== 0n && <p className="bw-muted">{`${T.pending}: ${fmtEuro(r.pendingCostCents)}`}</p>}
      {unpriced > 0 && <p className="bw-muted">{T.unpriced(unpriced)}</p>}
      {hoursOpen > 0 && <p className="bw-muted">{T.hoursOpen(hoursOpen)}</p>}
      {!r.finished && <p className="bw-muted">{T.running}</p>}
      <GroupTable title={T.byOrg} head={T.colOrg} groups={r.byOrg} label={(g) => g.label} />
      <GroupTable title={T.byChapter} head={T.colChapter} groups={r.byChapter} label={(g) => g.label} />
      <GroupTable title={T.byType} head={T.colType} groups={r.byType} label={(g) => T.types[g.key] ?? g.label} />
    </>
  );
}

/** Facturatie → Nacalculatie: alle werven met een getekende offerte. */
export function NacalcPage({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["nacalcAll"], queryFn: async () => unwrap(await actor!.nacalcOverview()), enabled: !!actor && !isFetching, retry: false });
  const [only, setOnly] = useState(false);
  const s = q.data?.settings;
  const rows = (q.data?.rows ?? []).map((b: NcBrief) => ({ b, o: computeBrief(b as never, s as never) as BriefOut }));
  const rank = (x: { o: BriefOut }) => (x.o.flag === "ok" ? 0n : x.o.diffCents < 0n ? -x.o.diffCents : x.o.diffCents);
  rows.sort((a, b) => (rank(b) > rank(a) ? 1 : rank(b) < rank(a) ? -1 : a.b.workCode.localeCompare(b.b.workCode)));
  const shown = only ? rows.filter((x) => x.o.flag !== "ok") : rows;
  return (
    <section className="a-section" data-testid="nacalc-all">
      <h2 className="bw-h2">{T.title}</h2>
      <p className="bw-muted">{T.leadAll}</p>
      <label className="a-row" style={{ gap: 6 }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{T.flag.meer + " / " + T.flag.minder + " / " + T.flag.ongepland}</label>
      <Loading q={q} />
      {q.isSuccess && rows.length === 0 && <p className="bw-muted">{T.noWorks}</p>}
      {q.data && q.data.skipped > 0n && <p className="bw-muted">{T.skipped(Number(q.data.skipped))}</p>}
      {shown.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="a-table" style={{ minWidth: 760 }}>
            <thead><tr><th>{T.colWork}</th><th className="bw-num">{T.colPlannedCost}</th><th className="bw-num">{T.colActualCost}</th><th className="bw-num">{T.colDiff}</th><th className="bw-num">{T.colMargin}</th><th>{T.colStatus}</th></tr></thead>
            <tbody>
              {shown.map(({ b, o }) => (
                <tr key={String(b.workId)} data-flag={o.flag}>
                  <td><a href={`#/werven/${b.workId}/facturatie/nacalculatie`} onClick={(e) => { e.preventDefault(); go(`werven/${b.workId}/facturatie/nacalculatie`); }}>{b.workCode}</a><div className="bw-muted" style={{ fontSize: 12 }}>{b.workName}</div></td>
                  <td className="bw-num">{fmtEuro(b.plannedCostCents)}</td>
                  <td className="bw-num">{fmtEuro(b.actualCents)}{b.pendingCents !== 0n && <div className="bw-muted" style={{ fontSize: 12 }}>{`+ ${fmtEuro(b.pendingCents)} wacht`}</div>}</td>
                  <td className="bw-num" style={flagStyle(o.flag)}>{signed(o.diffCents)}{o.diffBp !== null && <span className="bw-muted"> ({pct(o.diffBp)})</span>}</td>
                  <td className="bw-num">{pct(o.plannedMarginBp)} → {pct(o.actualMarginBp)}</td>
                  <td><FlagCell flag={o.flag} />{b.hoursOpen > 0n && <div className="bw-muted" style={{ fontSize: 12 }}>{T.hoursOpen(Number(b.hoursOpen))}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Beheer → Opmeting & facturatie: de drempel voor de nacalculatie. */
export function NacalcSettingsAdmin() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const S = T.settings;
  const cur = useQuery({ queryKey: ["nacalcSettings"], queryFn: () => actor!.nacalcSettings(), enabled: !!actor && !isFetching, retry: false });
  const [form, setForm] = useState<{ pct: string; min: string } | null>(null);
  const f = form ?? (cur.data ? { pct: (Number(cur.data.pctBp) / 100).toLocaleString("nl-BE"), min: (Number(cur.data.minCents) / 100).toLocaleString("nl-BE") } : null);
  const pc = f ? parsePct(f.pct) : null;
  const mn = f ? parseEuro(f.min) : null;
  const valid = !!f && pc !== null && typeof mn === "bigint" && mn >= 0n;
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveNacalcSettings({ pctBp: pc as bigint, minCents: mn as bigint })),
    onSuccess: () => { toast.show({ kind: "ok", text: S.saved }); setForm(null); void qc.invalidateQueries({ queryKey: ["nacalcSettings"] }); void qc.invalidateQueries({ queryKey: ["nacalcAll"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (cur.isError) return null;
  return (
    <section className="a-section a-form" style={{ maxWidth: 560 }} data-testid="nacalc-settings">
      <h2 className="bw-h2">{S.title}</h2>
      <p className="bw-muted">{S.lead}</p>
      <Loading q={cur} />
      {f && (
        <>
          <div className="a-grid2">
            <Field label={S.pct}><input className="bw-input bw-num" inputMode="decimal" value={f.pct} onChange={(e) => setForm({ ...f, pct: e.target.value })} /></Field>
            <Field label={S.min}><input className="bw-input bw-num" inputMode="decimal" value={f.min} onChange={(e) => setForm({ ...f, min: e.target.value })} /></Field>
          </div>
          <Button onClick={() => save.mutate()} busy={save.isPending} disabled={!valid}>{S.save}</Button>
        </>
      )}
    </section>
  );
}
