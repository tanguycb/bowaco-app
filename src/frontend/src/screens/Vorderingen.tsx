// Vorderingsstaten (stap 2.10, bouwplan §9 rij 2.10, §5.1 en §7): per werf en per periode een staat op de posten van de getekende
// offerte, cumulatief (vorige staten, deze periode, totaal, rest), met meer- en minderwerk en regie apart en de contractparameters
// van de werf (prijsherziening, waarborg, betaaltermijn, btw). Twee weergaven:
//   • calculator en beheerder: met bedragen (readProgressStatement, update-call met auditregel). De browser rekent live met
//     progress/calc.ts en geeft de totalen mee bij het bewaren; de server rekent na en weigert een ander totaal;
//   • de werfleider: enkel hoeveelheden en % (progressQty: het antwoord heeft geen enkel bedragveld).
// Versturen legt de staat vast (hash); verbeteren = creditnota of volgende staat. Bevestigen gebeurt in een paneel (geen
// window.confirm). Het scherm van de klant staat onderaan (MijnVorderingPage).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ProgressBasis, ProgressKind, ProgressSection, ProgressStatus, type Caps, type MyProgressBrief, type MyProgressRead, type ProgressBrief, type ProgressFullView, type ProgressQtyLine, type ProgressQtyView, type RevisionModel } from "../backend";
import { Button, Icon, Info, Sheet, useToast } from "../design";
import { makeProgressPdf, pdfFromMyProgress, pdfFromProgress, progressPdfName } from "../pdf/adapt.ts";
import type { ProgressPdfData } from "../pdf/vorderingsstaat.ts";
import { progressLine } from "../progress/calc.ts";
import * as PM from "../progress/model.ts";
import { t } from "../texts/nl";
import { dayToInput, downloadJson, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, parsePct, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Frame, Loading, Page } from "./common";
import { fmtQty, parseQty } from "./Offertes";
import "../app/vordering.css";

const T = t.vorderingen;
const SECTIONS = [ProgressSection.contract, ProgressSection.extra, ProgressSection.less, ProgressSection.regie];
const kindWord = (k: ProgressKind) => (k === ProgressKind.credit ? T.credit : "");
const statusTag = (b: ProgressBrief) => (b.status === ProgressStatus.sent ? (b.billing === "klaar" ? "a-tag--ok" : "a-tag--accent") : b.status === ProgressStatus.cancelled ? "a-tag--bad" : "");
const briefTitle = (b: ProgressBrief) => (b.code ? `${b.code}` : `${kindWord(b.kind) || T.draft} #${b.id}`);
const fmtPctBp = (bp: bigint) => fmtBp(bp);
const signedEuro = (c: bigint) => fmtEuro(c);
const unitOf = (u: string) => (u === "m2" ? "m²" : u === "m3" ? "m³" : u);
const valueOf = (basis: ProgressBasis, pct: bigint, qty: bigint, unit: string) => (basis === ProgressBasis.percent ? fmtPctBp(pct) : `${fmtQty(qty)} ${unitOf(unit)}`);

export function VorderingenPage({ caps, go, route }: { caps: Caps; go: (to: string) => void; route: string[] }) {
  if (route[1] === "w" && route[2] && /^\d+$/.test(route[2])) return <WorkStatements key={route[2]} workId={BigInt(route[2])} caps={caps} go={go} />;
  if (route[1] === "s" && route[2] && /^\d+$/.test(route[2])) {
    return caps.quotePrices ? <FullStatement key={route[2]} id={BigInt(route[2])} go={go} /> : <QtyStatement key={route[2]} id={BigInt(route[2])} go={go} />;
  }
  return <ProgressWorks go={go} />;
}

// ── Werven ─────────────────────────────────────────────────────────────────
function ProgressWorks({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["progressWorks"], queryFn: () => actor!.progressWorks(), enabled: !!actor && !isFetching });
  const rows = q.data ?? [];
  return (
    <Page label={T.label} title={T.title}>
      <p className="bw-muted" style={{ maxWidth: 720 }}>{T.lead}<Info text={t.uitleg.vordering} label={t.uitleg.label} /></p>
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={t.leeg.vorderingen.t} text={t.leeg.vorderingen.d} action={<Button onClick={() => go("werven/lopend")}>{t.nav.werven}</Button>} />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="vs-works">
          {rows.map((w) => (
            <li key={String(w.workId)}>
              <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.workId}/facturatie`)}>
                <span className="a-tag">{w.code}</span>
                <span className="a-list__main">
                  <b>{w.name}</b>
                  <span className="bw-muted">
                    {w.lastCode ? `${w.lastCode}${w.lastTo !== undefined ? ` · ${T.periodTo.toLowerCase()} ${fmtDayNum(w.lastTo)}` : ""}` : w.draftId !== undefined ? T.firstDraft : T.noStatements}
                    {w.scope === "prepare" ? ` · ${T.scopePrepare}` : ""}
                  </span>
                </span>
                {w.draftId !== undefined && <span className="a-tag a-tag--warn">{T.draft}</span>}
                {w.ready > 0n && <span className="a-tag a-tag--ok">{T.billing.klaar} ({String(w.ready)})</span>}
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

// ── Staten van één werf ────────────────────────────────────────────────────
/** De vorderingsstaten van één werf; 2b.3: ook in het tabblad Facturatie van de werf (embedded). */
export function WorkStatements({ workId, caps, go, embedded }: { workId: bigint; caps: Caps; go: (to: string) => void; embedded?: boolean }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const works = useQuery({ queryKey: ["progressWorks"], queryFn: () => actor!.progressWorks(), enabled: !!actor && !isFetching });
  const list = useQuery({ queryKey: ["progressList", String(workId)], queryFn: () => actor!.listProgress(workId), enabled: !!actor && !isFetching });
  const w = works.data?.find((x) => x.workId === workId);
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  const draft = rows.find((r) => r.status === ProgressStatus.draft);
  const start = async () => {
    setBusy(true);
    try {
      const id = unwrap(await actor!.newProgress(workId));
      void qc.invalidateQueries({ queryKey: ["progressWorks"] });
      go(`vorderingen/s/${id}`);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      embedded={embedded}
      label={`${T.label}${w ? ` · ${w.code}` : ""}`}
      title={w ? w.name : T.title}
      actions={<>
        {!embedded && <Button icon="back" onClick={() => go("vorderingen")}>{t.common.back}</Button>}
        {draft ? <Button variant="primary" icon="next" onClick={() => go(`vorderingen/s/${draft.id}`)}>{T.openDraft}</Button> : <Button variant="primary" icon="plus" busy={busy} onClick={() => void start()} data-testid="vs-new">{caps.quotePrices ? T.newStatement : T.startPrepare}</Button>}
      </>}
    >
      <h2 className="bw-h2">{T.statements}</h2>
      <Loading q={list} />
      {list.data && rows.length === 0 && <p className="a-empty">{T.noStatements}</p>}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="vs-list">
          {rows.map((b) => (
            <li key={String(b.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`vorderingen/s/${b.id}`)}>
                <span className="a-tag bw-mono">{briefTitle(b)}</span>
                <span className="a-list__main">
                  <b>{T.period(fmtDayNum(b.periodFrom), fmtDayNum(b.periodTo))}</b>
                  <span className="bw-muted">
                    {b.status === ProgressStatus.sent && b.sentAt !== undefined ? fmtTime(b.sentAt) : b.prepared ? T.prepared(b.preparedByName) : T.notPrepared}
                    {b.creditsCode ? ` · ${T.credits(b.creditsCode)}` : ""}{b.creditedByCode ? ` · ${T.creditedBy(b.creditedByCode)}` : ""}
                    {b.answer ? ` · ${b.answer.ok ? t.mijnVordering.accepted : t.mijnVordering.remarked}` : ""}
                  </span>
                </span>
                <span className={`a-tag ${statusTag(b)}`}>{b.billing !== "open" && b.status === ProgressStatus.sent ? T.billing[b.billing] : T.status[b.status]}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

// ── Lijnen (gedeeld door beide weergaven) ──────────────────────────────────
type Row = { q: ProgressQtyLine; m?: { unitPriceCents: bigint; noPrice: boolean; offerCents: bigint; prevCents: bigint } };

function hintText(q: ProgressQtyLine): string {
  const h = q.hints;
  const u = unitOf(q.unit);
  const parts: string[] = [];
  if (q.basis === ProgressBasis.quantity) parts.push(h.measuredMilli !== undefined ? T.hintMeasured(`${fmtQty(h.measuredMilli)} ${u}`, String(h.measuredSurvey ?? "")) : T.hintPrev(`${fmtQty(q.prevQtyMilli)} ${u}`));
  if (q.basis === ProgressBasis.hours) {
    parts.push(h.hoursMilli !== undefined ? T.hintHours(`${fmtQty(h.hoursMilli)} u`) : T.hintPrev(`${fmtQty(q.prevQtyMilli)} u`));
    if (h.hoursDisputedMilli > 0n) parts.push(T.hintDisputed(`${fmtQty(h.hoursDisputedMilli)} u`));
    if (h.hoursOpenMilli > 0n) parts.push(T.hintOpen(`${fmtQty(h.hoursOpenMilli)} u`));
  }
  if (q.basis === ProgressBasis.percent) parts.push(h.planPctBp !== undefined ? T.hintPlan(fmtPctBp(h.planPctBp)) : T.hintPrev(fmtPctBp(q.prevPctBp)));
  return parts.join(" · ");
}

function toModel(r: Row): PM.ModelLine {
  const q = r.q;
  return {
    root: q.root,
    section: q.section as PM.ModelLine["section"],
    basis: q.basis as PM.ModelLine["basis"],
    offerQtyMilli: q.offerQtyMilli,
    unitPrice: r.m?.unitPriceCents ?? 0n,
    prevCents: r.m?.prevCents ?? 0n,
    prevPctBp: q.prevPctBp,
    prevQtyMilli: q.prevQtyMilli,
    cumPctBp: q.cumPctBp,
    cumQtyMilli: q.cumQtyMilli,
    hasInput: q.hasInput,
    note: q.note,
    hints: { measuredMilli: q.hints.measuredMilli ?? null, hoursMilli: q.hints.hoursMilli ?? null, planPctBp: q.hints.planPctBp ?? null },
  };
}

function ValueCell({ row, edit, editable, onEdit }: { row: Row; edit: PM.Edit | undefined; editable: boolean; onEdit: (e: PM.Edit | undefined) => void }) {
  const q = row.q;
  const ml = toModel(row);
  const x = PM.effective(ml, edit);
  const shown = q.basis === ProgressBasis.percent ? (Number(x.cumPctBp) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 2 }) : fmtQty(x.cumQtyMilli);
  const [v, setV] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => { setV(shown); setBad(false); }, [shown]);
  if (!editable) return <span className="bw-mono">{valueOf(q.basis, x.cumPctBp, x.cumQtyMilli, q.unit)}</span>;
  const commit = () => {
    if (v === shown) return;
    if (q.basis === ProgressBasis.percent) {
      const p = parsePct(v);
      if (p === null || p > 10_000n) { setBad(true); return; }
      onEdit({ ...(edit ?? {}), clear: false, cumPctBp: p });
    } else {
      const n = parseQty(v);
      if (n === null) { setBad(true); return; }
      onEdit({ ...(edit ?? {}), clear: false, cumQtyMilli: n });
    }
  };
  return (
    <span className="vs-val">
      <input
        className={`bw-input bw-num vs-input${bad ? " vs-input--bad" : ""}${x.hasInput ? " vs-input--set" : ""}`}
        inputMode="decimal"
        aria-label={`${T.cols.cum} · ${q.title}`}
        value={v}
        onChange={(e) => { setV(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <span className="bw-muted vs-unit">{q.basis === ProgressBasis.percent ? "%" : unitOf(q.unit)}</span>
      {x.hasInput && <Button variant="quiet" icon="undo" iconOnly onClick={() => onEdit({ clear: true })}>{T.backToProposal}</Button>}
    </span>
  );
}

function LinesTable({ rows, edits, setEdit, editable, money }: { rows: Row[]; edits: Map<string, PM.Edit>; setEdit: (root: bigint, e: PM.Edit | undefined) => void; editable: boolean; money: boolean }) {
  return (
    <>
      {SECTIONS.map((sec) => {
        const rs = rows.filter((r) => r.q.section === sec);
        if (rs.length === 0) return null;
        return (
          <section key={sec} className="vs-section" data-testid={`vs-sec-${sec}`}>
            <h3 className="bw-h3">{T.sections[sec]}</h3>
            <div className="bw-table-wrap">
              <table className="bw-table bw-table--stack vs-table">
                <thead>
                  <tr>
                    <th>{T.cols.post}</th>
                    <th className="bw-right">{T.cols.offerQty}</th>
                    {money && <th className="bw-right">{T.cols.unitPrice}</th>}
                    {money && <th className="bw-right">{T.cols.offerAmount}</th>}
                    <th className="bw-right">{T.cols.prev}</th>
                    <th className="bw-right">{T.cols.cum}</th>
                    {money && <th className="bw-right">{T.cols.period}</th>}
                    {money && <th className="bw-right">{T.cols.rest}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rs.map((r) => {
                    const q = r.q;
                    const key = String(q.root);
                    const e = edits.get(key);
                    const ml = toModel(r);
                    const out = money ? PM.lineOut(ml, e) : null;
                    const x = PM.effective(ml, e);
                    const flags = q.flags.filter((f) => f !== "boven-vh" || !e);
                    return (
                      <tr key={key} data-testid="vs-line">
                        <td data-label={T.cols.post}>
                          <span className="vs-post">
                            <b>{q.code ? <span className="bw-mono bw-muted">{q.code} </span> : null}{q.title}</b>
                            <span className="bw-muted vs-sub">{[q.chapter, q.quoteNumber, T.basis[q.basis]].filter(Boolean).join(" · ")}</span>
                            {editable && <span className="bw-muted vs-sub" data-testid="vs-hint">{T.cols.hint}: {hintText(q)}{!x.hasInput ? ` · ${T.followProposal}` : ""}</span>}
                            {flags.length > 0 && <span className="vs-flags">{flags.map((f) => <span key={f} className={`a-tag ${/uitgelegd/.test(f) ? "" : "a-tag--warn"}`}>{T.flags[f] ?? f}</span>)}</span>}
                            {editable && x.hasInput && (
                              <input className="bw-input vs-note" placeholder={T.notePh} aria-label={`${T.note} · ${q.title}`} defaultValue={x.note} onBlur={(ev) => { if (ev.target.value !== x.note) setEdit(q.root, { ...(e ?? {}), clear: false, note: ev.target.value }); }} />
                            )}
                            {!editable && x.note && <span className="bw-muted vs-sub">{T.note}: {x.note}</span>}
                          </span>
                        </td>
                        <td data-label={T.cols.offerQty} className="bw-right bw-mono">{fmtQty(q.offerQtyMilli)} {unitOf(q.unit)}</td>
                        {money && <td data-label={T.cols.unitPrice} className="bw-right bw-mono">{r.m?.noPrice ? "–" : fmtEuro(r.m?.unitPriceCents)}</td>}
                        {money && <td data-label={T.cols.offerAmount} className="bw-right bw-mono">{fmtEuro(out?.offerCents)}</td>}
                        <td data-label={T.cols.prev} className="bw-right bw-mono">
                          {valueOf(q.basis, q.prevPctBp, q.prevQtyMilli, q.unit)}
                          {money && <span className="bw-muted vs-sub">{fmtEuro(r.m?.prevCents)}</span>}
                        </td>
                        <td data-label={T.cols.cum} className="bw-right">
                          <ValueCell row={r} edit={e} editable={editable} onEdit={(ne) => setEdit(q.root, ne)} />
                          {money && <span className="bw-muted vs-sub bw-mono">{fmtEuro(out?.cumCents)}</span>}
                        </td>
                        {money && <td data-label={T.cols.period} className="bw-right bw-mono"><b>{signedEuro(out!.periodCents)}</b>{out!.overVhCents > 0n && <span className="bw-muted vs-sub">{T.tot.overVh} {fmtEuro(out!.overVhCents)}</span>}</td>}
                        {money && <td data-label={T.cols.rest} className="bw-right bw-mono">{fmtEuro(out?.restCents)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function useEdits() {
  const [edits, setEdits] = useState<Map<string, PM.Edit>>(new Map());
  const setEdit = (root: bigint, e: PM.Edit | undefined) =>
    setEdits((m) => {
      const n = new Map(m);
      if (e === undefined) n.delete(String(root));
      else n.set(String(root), e);
      return n;
    });
  return { edits, setEdit, reset: () => setEdits(new Map()) };
}

const opsTs = (ops: ReturnType<typeof PM.opsOf>) => ops.map((o) => ({ root: o.root, cumPctBp: o.cumPctBp ?? undefined, cumQtyMilli: o.cumQtyMilli ?? undefined, note: o.note, clear: o.clear }));

function StatementHead({ b, go }: { b: ProgressBrief; go: (to: string) => void }) {
  return (
    <div className="vs-head" data-testid="vs-head">
      <span className={`a-tag ${statusTag(b)}`}>{b.status === ProgressStatus.sent ? (b.billing !== "open" ? T.billing[b.billing] : T.status.sent) : T.status[b.status]}</span>
      <span className="bw-muted">{T.period(fmtDayNum(b.periodFrom), fmtDayNum(b.periodTo))}</span>
      {b.status === ProgressStatus.draft && b.kind === ProgressKind.statement && <span className="bw-muted">· {b.prepared ? T.prepared(b.preparedByName) : T.notPrepared}</span>}
      {b.creditsCode && <span className="bw-muted">· {T.credits(b.creditsCode)}</span>}
      {b.creditedByCode && <span className="a-tag a-tag--bad">{T.creditedBy(b.creditedByCode)}</span>}
      <Button variant="quiet" onClick={() => go(`werven/${b.workId}/facturatie`)}>{b.workCode}</Button>
    </div>
  );
}

// ── De werfleider: hoeveelheden en %, nooit een bedrag ─────────────────────
function QtyStatement({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const q = useQuery({ queryKey: ["progressQty", String(id)], queryFn: () => actor!.progressQty(id), enabled: !!actor && !isFetching });
  const { edits, setEdit, reset } = useEdits();
  const [periodTo, setPeriodTo] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const v: ProgressQtyView | undefined = q.data;
  useEffect(() => { if (v) setPeriodTo(dayToInput(v.brief.periodTo)); }, [v?.brief.periodTo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <Page label={T.label} title={T.title}><Loading q={q} /></Page>;
  const rows: Row[] = v.lines.map((x) => ({ q: x }));
  const lines = rows.map(toModel);
  const dirty = edits.size + (periodTo && inputToDay(periodTo) !== v.brief.periodTo ? 1 : 0);
  const save = async () => {
    setBusy(true);
    try {
      unwrap(await actor!.saveProgressDraft(id, v.brief.rev, { periodTo: inputToDay(periodTo) !== v.brief.periodTo ? inputToDay(periodTo) : undefined, note: undefined, setIndexes: false, sIndex: undefined, iIndex: undefined, lines: opsTs(PM.opsOf(lines, edits)), expect: undefined }));
      toast.show({ kind: "ok", text: T.saved });
      reset();
      await q.refetch();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const prepared = async () => {
    setBusy(true);
    try {
      unwrap(await actor!.markProgressPrepared(id));
      toast.show({ kind: "ok", text: T.preparedOk });
      await q.refetch();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      wide
      label={`${T.label} · ${v.brief.workCode} ${v.brief.workName}`}
      title={briefTitle(v.brief)}
      actions={<>
        <Button icon="back" onClick={() => go(`werven/${v.brief.workId}/facturatie`)}>{t.common.back}</Button>
        {v.canEdit && <Button variant="primary" icon="check" busy={busy} disabled={dirty === 0} onClick={() => void save()} data-testid="vs-save">{T.save}</Button>}
        {v.canEdit && v.canPrepare && <Button busy={busy} disabled={dirty > 0} onClick={() => void prepared()} data-testid="vs-prepared">{T.prepare}</Button>}
      </>}
    >
      <StatementHead b={v.brief} go={go} />
      <p className="a-note">{T.qtyOnly}</p>
      {v.note === "geen getekende offerte" && <p className="a-note">{T.noPosts}</p>}
      {v.canEdit && (
        <label className="bw-field vs-period">
          <span className="bw-label">{T.periodTo}</span>
          <input type="date" className="bw-input" value={periodTo} min={dayToInput(v.brief.periodFrom)} max={dayToInput(todayDay())} onChange={(e) => setPeriodTo(e.target.value)} />
        </label>
      )}
      {v.openSurvey !== undefined && <p className="a-note">{T.openSurvey(String(v.openSurvey))}</p>}
      {v.unassignedRegieMilli > 0n && <p className="a-note">{T.unassigned(`${fmtQty(v.unassignedRegieMilli)} u`)}</p>}
      {dirty > 0 && <p className="bw-muted">{T.unsaved(dirty)}</p>}
      <LinesTable rows={rows} edits={edits} setEdit={setEdit} editable={v.canEdit} money={false} />
    </Page>
  );
}

// ── Calculator en beheerder: met bedragen ──────────────────────────────────
function FullStatement({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["progressFull", String(id)], queryFn: async () => unwrap(await actor!.readProgressStatement(id)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const { edits, setEdit, reset } = useEdits();
  const [periodTo, setPeriodTo] = useState("");
  const [note, setNote] = useState("");
  const [sIdx, setSIdx] = useState("");
  const [iIdx, setIIdx] = useState("");
  const [sheet, setSheet] = useState<null | "send" | "cancel" | "credit" | "ready" | "model">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const v: ProgressFullView | undefined = q.data;
  const fmtIdx = (x: bigint | undefined) => (x === undefined ? "" : (Number(x) / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 3 }));
  useEffect(() => {
    if (!v) return;
    setPeriodTo(dayToInput(v.brief.periodTo));
    setNote(v.clientNote);
    setSIdx(fmtIdx(v.header.sIndex));
    setIIdx(fmtIdx(v.header.iIndex));
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: Row[] = useMemo(() => (v ? v.lines.map((x) => ({ q: x.q, m: x.m })) : []), [v]);
  const lines = useMemo(() => rows.map(toModel), [rows]);
  const parseIdx = (s: string): bigint | null | "bad" => {
    if (s.trim() === "") return null;
    const n = parseQty(s);
    return n === null || n <= 0n ? "bad" : n;
  };
  const sI = parseIdx(sIdx);
  const iI = parseIdx(iIdx);
  const idxBad = sI === "bad" || iI === "bad";
  const header = v ? PM.headerOf(v) : null;
  const live = v && header && !idxBad ? PM.totals(lines, edits, header, sI as bigint | null, iI as bigint | null) : null;
  if (!v || !header) return <Page label={T.label} title={T.title}><Loading q={q} /></Page>;
  const editable = v.canEdit;
  const idxChanged = editable && ((sI as bigint | null) !== (v.header.sIndex ?? null) || (iI as bigint | null) !== (v.header.iIndex ?? null));
  const ptChanged = editable && periodTo !== "" && inputToDay(periodTo) !== v.brief.periodTo;
  const dirty = edits.size + (idxChanged ? 1 : 0) + (ptChanged ? 1 : 0) + (editable && note.trim() !== v.clientNote ? 1 : 0);
  const tot = editable && live ? live : { ...v.totals, sections: v.totals.sections.map((s) => ({ ...s, section: s.section as string })) };
  const blocks = v.findings.filter((f) => f.block);
  const warns = v.findings.filter((f) => !f.block);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    if (!live) throw new Error(T.bad);
    unwrap(await actor!.saveProgressDraft(id, v.brief.rev, {
      periodTo: ptChanged ? inputToDay(periodTo) : undefined,
      note: note.trim() !== v.clientNote ? note.trim() : undefined,
      setIndexes: idxChanged,
      sIndex: (sI as bigint | null) ?? undefined,
      iIndex: (iI as bigint | null) ?? undefined,
      lines: opsTs(PM.opsOf(lines, edits)),
      expect: PM.expectOf(live),
    }));
    toast.show({ kind: "ok", text: T.saved });
    reset();
    await q.refetch();
  });
  const send = () => run(async () => {
    const code = unwrap(await actor!.sendProgress(id, v.brief.rev, v.totals.totalCents, reason));
    toast.show({ kind: "ok", text: T.sendOk(code) });
    setSheet(null);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["progressWorks"] });
    await q.refetch();
  });
  const cancel = () => run(async () => {
    unwrap(await actor!.cancelProgressDraft(id, reason));
    toast.show({ kind: "ok", text: T.cancelOk });
    setSheet(null);
    void qc.invalidateQueries({ queryKey: ["progressWorks"] });
    go(`werven/${v.brief.workId}/facturatie`);
  });
  const credit = () => run(async () => {
    const nid = unwrap(await actor!.creditProgress(id, reason));
    toast.show({ kind: "ok", text: T.creditOk });
    setSheet(null);
    setReason("");
    go(`vorderingen/s/${nid}`);
  });
  const ready = () => run(async () => {
    unwrap(await actor!.setProgressReady(id));
    toast.show({ kind: "ok", text: T.readyOk });
    setSheet(null);
    await q.refetch();
  });
  const invoice = () => run(async () => {
    const d = unwrap(await actor!.progressInvoiceData(id));
    downloadJson(`BOWACO factuurgegevens ${v.brief.code.replace(/[^\w.-]+/g, "-")}.json`, d);
  });
  const pdf = () => run(async () => {
    const liveLines = editable && live ? rows.map((r) => {
      const ml = toModel(r);
      const e = edits.get(String(r.q.root));
      const x = PM.effective(ml, e);
      const o = progressLine(PM.calcLine(ml, e));
      return { section: r.q.section as ProgressPdfData["lines"][number]["section"], basis: r.q.basis as ProgressPdfData["lines"][number]["basis"], code: r.q.code, title: r.q.title, chapter: r.q.chapter, unit: unitOf(r.q.unit), offerQtyMilli: r.q.offerQtyMilli, unitPriceCents: ml.unitPrice, offerCents: o.offerCents, prevPctBp: r.q.prevPctBp, prevQtyMilli: r.q.prevQtyMilli, prevCents: ml.prevCents, cumPctBp: x.cumPctBp, cumQtyMilli: o.cumQtyMilli, cumCents: o.cumCents, periodCents: o.periodCents };
    }) : undefined;
    const d = pdfFromProgress(v, editable ? note : v.clientNote, liveLines && live ? { lines: liveLines, totals: live } : undefined);
    if (!d) throw new Error(T.bad);
    const blob = await makeProgressPdf(d);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = progressPdfName(d);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
  const secTotals = SECTIONS.map((s) => tot.sections.find((x) => x.section === s)).filter((x) => x && (x.offerCents !== 0n || x.cumCents !== 0n || x.periodCents !== 0n));
  const h = v.header;
  return (
    <Page
      wide
      label={`${T.label} · ${v.brief.workCode} ${v.brief.workName}`}
      title={briefTitle(v.brief)}
      actions={<>
        <Button icon="back" onClick={() => go(`werven/${v.brief.workId}/facturatie`)}>{t.common.back}</Button>
        <Button icon="doc" busy={busy} onClick={() => void pdf()} data-testid="vs-pdf">{v.frozen ? T.pdf : T.pdfPreview}</Button>
        {editable && <Button variant="primary" icon="check" busy={busy} disabled={dirty === 0 || idxBad} onClick={() => void save()} data-testid="vs-save">{T.save}</Button>}
        {v.canSend && <Button variant="primary" icon="share" disabled={dirty > 0} onClick={() => { setReason(""); setSheet("send"); }} data-testid="vs-send">{dirty > 0 ? T.saveFirst : T.send}</Button>}
        {v.canReady && <Button icon="check" onClick={() => setSheet("ready")} data-testid="vs-ready">{T.ready}</Button>}
        {v.frozen && <Button icon="receipt" busy={busy} onClick={() => void invoice()} data-testid="vs-invoice">{T.invoiceData}</Button>}
        {v.canCredit && <Button icon="undo" onClick={() => { setReason(""); setSheet("credit"); }} data-testid="vs-credit">{T.creditBtn}</Button>}
        {v.canCancel && <Button variant="quiet" icon="close" onClick={() => { setReason(""); setSheet("cancel"); }}>{T.cancel}</Button>}
      </>}
    >
      <StatementHead b={v.brief} go={go} />
      {v.frozen && <p className={v.intact ? "bw-muted" : "a-err"} data-testid="vs-frozen">{T.frozen} · {v.intact ? T.intact : T.notIntact} · <span className="bw-mono">{v.hash.slice(0, 16)}…</span>{v.doc ? ` · ${T.tot.due(fmtDayNum(v.doc.dueDay))}` : ""}</p>}
      {v.frozen && v.brief.kind === ProgressKind.statement && <p className="bw-muted" data-testid="vs-answer">{v.answer ? (v.answer.ok ? T.answerOk(v.answer.byName, fmtTime(v.answer.at)) : T.answerNo(v.answer.byName, fmtTime(v.answer.at), v.answer.note)) : v.clientMode === "uit" ? T.clientModeOff : `${T.noAnswer}${v.clientMode === "vereist" ? ` · ${T.clientRequired}` : ""}`}</p>}
      {v.note === "geen getekende offerte" && <p className="a-note">{T.noPosts}</p>}

      <div className="vs-top">
        <section className="vs-card" data-testid="vs-contract">
          <h2 className="bw-h3">{T.contract}</h2>
          {!h.contractFound && <p className="a-note">{T.noContract}</p>}
          <ul className="vs-facts">
            <li>{T.vat(fmtBp(h.vatBp))}{h.vatBp === 600n ? ` · ${h.vatNote ? T.vatNote(h.vatNote) : T.vatNoNote}` : ""}</li>
            <li>{h.guarantee === "retention" ? T.retention(fmtBp(h.retentionBp), h.retentionOnIncl) : T.guarantee[h.guarantee]}</li>
            <li>{T.payment(String(h.paymentDays))}</li>
            {h.signedVersion && <li>{T.signed(h.signedVersion)}</li>}
            {h.originalContractCents !== undefined && <li>{T.original(fmtEuro(h.originalContractCents))}</li>}
          </ul>
          <h3 className="bw-h3">{T.revision}</h3>
          {!h.formula ? <p className="bw-muted">{T.revisionNone}</p> : (
            <>
              <p className="bw-muted">{T.revisionFormula(h.formula)}</p>
              {h.model ? <p className="bw-muted bw-mono">{T.revisionModel(fmtBp(h.model.aBp), fmtBp(h.model.bBp), fmtBp(h.model.cBp))} · S {fmtIdx(h.model.sBase)} · I {fmtIdx(h.model.iBase)}</p> : <p className="a-note">{T.revisionNoModel}</p>}
              {editable && (
                <>
                  <div className="a-grid2">
                    <label className="bw-field"><span className="bw-label">{T.sIndex(h.model?.sLabel ?? "")}</span><input className={`bw-input bw-num${sI === "bad" ? " vs-input--bad" : ""}`} inputMode="decimal" value={sIdx} onChange={(e) => setSIdx(e.target.value)} data-testid="vs-s" /></label>
                    <label className="bw-field"><span className="bw-label">{T.iIndex(h.model?.iLabel ?? "")}</span><input className={`bw-input bw-num${iI === "bad" ? " vs-input--bad" : ""}`} inputMode="decimal" value={iIdx} onChange={(e) => setIIdx(e.target.value)} data-testid="vs-i" /></label>
                  </div>
                  <p className="bw-muted">{T.indexHint}</p>
                  <Button variant="quiet" icon="settings" onClick={() => setSheet("model")}>{T.revisionEdit}</Button>
                </>
              )}
              {!editable && h.sIndex !== undefined && <p className="bw-muted bw-mono">s {fmtIdx(h.sIndex)} · i {fmtIdx(h.iIndex)}</p>}
            </>
          )}
          {editable && (
            <>
              <label className="bw-field vs-period">
                <span className="bw-label">{T.periodTo}</span>
                <input type="date" className="bw-input" value={periodTo} min={dayToInput(v.brief.periodFrom)} max={dayToInput(todayDay())} onChange={(e) => setPeriodTo(e.target.value)} />
              </label>
              <label className="bw-field"><span className="bw-label">{T.noteClient}</span><textarea className="bw-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </>
          )}
        </section>

        <section className="vs-card vs-totals" data-testid="vs-totals">
          <h2 className="bw-h3">{T.totals}</h2>
          <dl className="vs-dl">
            {secTotals.map((s) => <div key={s!.section}><dt>{T.sectionsShort[s!.section]}</dt><dd className="bw-mono">{fmtEuro(s!.periodCents)}</dd></div>)}
            <div className="vs-dl__sum"><dt>{T.tot.period}</dt><dd className="bw-mono">{fmtEuro(tot.periodCents)}</dd></div>
            {(h.formula || tot.revisionCents !== 0n) && <div><dt>{T.tot.revision}</dt><dd className="bw-mono" data-testid="vs-revision">{fmtEuro(tot.revisionCents)}</dd></div>}
            <div><dt>{T.tot.subtotal}</dt><dd className="bw-mono">{fmtEuro(tot.subtotalCents)}</dd></div>
            <div><dt>{T.tot.vat(fmtBp(tot.vatBp))}</dt><dd className="bw-mono">{fmtEuro(tot.vatCents)}</dd></div>
            <div className="vs-dl__big"><dt>{T.tot.total}</dt><dd className="bw-mono" data-testid="vs-total">{fmtEuro(tot.totalCents)}</dd></div>
            {tot.retentionCents !== 0n && <div><dt>{T.tot.retention} {fmtBp(tot.retentionBp)}</dt><dd className="bw-mono">{fmtEuro(-tot.retentionCents)}</dd></div>}
            {tot.retentionCents !== 0n && <div className="vs-dl__big"><dt>{T.tot.payable}</dt><dd className="bw-mono" data-testid="vs-payable">{fmtEuro(tot.payableCents)}</dd></div>}
          </dl>
          <dl className="vs-dl vs-dl--small">
            <div><dt>{T.tot.offer}</dt><dd className="bw-mono">{fmtEuro(tot.offerCents)}</dd></div>
            <div><dt>{T.tot.prev}</dt><dd className="bw-mono">{fmtEuro(tot.prevCents)}</dd></div>
            <div><dt>{T.tot.cum}</dt><dd className="bw-mono">{fmtEuro(tot.cumCents)}</dd></div>
            <div><dt>{T.tot.rest}</dt><dd className="bw-mono">{fmtEuro(tot.restCents)}</dd></div>
            {tot.overVhCents > 0n && <div><dt>{T.tot.overVh}</dt><dd className="bw-mono">{fmtEuro(tot.overVhCents)}</dd></div>}
          </dl>
          {dirty > 0 && <p className="bw-muted" data-testid="vs-dirty">{T.unsaved(dirty)}</p>}
        </section>
      </div>

      {v.findings.length > 0 && (
        <section className="vs-card" data-testid="vs-findings">
          <h2 className="bw-h3">{T.findings}</h2>
          <ul className="vs-findings">
            {v.findings.map((f) => <li key={f.key}><span className={`a-tag ${f.block ? "a-tag--bad" : "a-tag--warn"}`}>{f.block ? T.block : T.warn}</span> {f.text}{f.count > 0n ? ` (${f.count})` : ""}</li>)}
          </ul>
        </section>
      )}
      {v.openSurvey !== undefined && <p className="a-note">{T.openSurvey(String(v.openSurvey))}</p>}
      {v.unassignedRegieMilli > 0n && <p className="a-note">{T.unassigned(`${fmtQty(v.unassignedRegieMilli)} u`)}</p>}
      <LinesTable rows={rows} edits={edits} setEdit={setEdit} editable={editable} money />

      <Sheet title={T.sendTitle} open={sheet === "send"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={blocks.length > 0 || (warns.length > 0 && reason.trim().length < 5)} onClick={() => void send()} data-testid="vs-send-go">{T.send}</Button></>}>
        <p>{T.sendLead}</p>
        <p className="bw-mono"><b>{T.tot.total}: {fmtEuro(v.totals.totalCents)}</b>{v.totals.retentionCents !== 0n ? ` · ${T.tot.payable}: ${fmtEuro(v.totals.payableCents)}` : ""}</p>
        {blocks.length > 0 && <p className="a-err">{T.sendBlocked}</p>}
        {v.findings.length > 0 && <ul className="vs-findings">{v.findings.map((f) => <li key={f.key}><span className={`a-tag ${f.block ? "a-tag--bad" : "a-tag--warn"}`}>{f.block ? T.block : T.warn}</span> {f.text}{f.count > 0n ? ` (${f.count})` : ""}</li>)}</ul>}
        {warns.length > 0 && <label className="bw-field"><span className="bw-label">{T.sendReason}</span><textarea className="bw-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="vs-reason" /></label>}
      </Sheet>
      <Sheet title={T.cancelTitle} open={sheet === "cancel"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void cancel()}>{T.cancel}</Button></>}>
        <p>{T.cancelLead}</p>
        <label className="bw-field"><span className="bw-label">{T.reason}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
      <Sheet title={T.creditTitle} open={sheet === "credit"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={() => void credit()} data-testid="vs-credit-go">{T.creditBtn}</Button></>}>
        <p>{T.creditLead}</p>
        <label className="bw-field"><span className="bw-label">{T.reason}</span><textarea className="bw-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
      <Sheet title={T.readyTitle} open={sheet === "ready"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} onClick={() => void ready()} data-testid="vs-ready-go">{T.ready}</Button></>}>
        <p>{T.readyLead}</p>
      </Sheet>
      {sheet === "model" && <ModelSheet workId={v.brief.workId} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void q.refetch(); }} />}
    </Page>
  );
}

function ModelSheet({ workId, onClose, onSaved }: { workId: bigint; onClose: () => void; onSaved: () => void }) {
  const M = T.model;
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const cur = useQuery({ queryKey: ["progressRevision", String(workId)], queryFn: async () => unwrap(await actor!.readProgressRevision(workId)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const [f, setF] = useState({ a: "40", b: "40", c: "20", sBase: "", iBase: "", sLabel: "", iLabel: "", note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const m: RevisionModel | undefined = cur.data ?? undefined;
    if (m) setF({ a: String(Number(m.aBp) / 100).replace(".", ","), b: String(Number(m.bBp) / 100).replace(".", ","), c: String(Number(m.cBp) / 100).replace(".", ","), sBase: fmtQty(m.sBase), iBase: fmtQty(m.iBase), sLabel: m.sLabel, iLabel: m.iLabel, note: m.note });
  }, [cur.data]);
  const a = parsePct(f.a), b = parsePct(f.b), c = parsePct(f.c), s = parseQty(f.sBase), i = parseQty(f.iBase);
  const valid = a !== null && b !== null && c !== null && a + b + c === 10_000n && s !== null && s > 0n && i !== null && i > 0n;
  const save = async () => {
    setBusy(true);
    try {
      unwrap(await actor!.saveProgressRevision(workId, { aBp: a!, bBp: b!, cBp: c!, sBase: s!, iBase: i!, sLabel: f.sLabel, iLabel: f.iLabel, note: f.note }));
      toast.show({ kind: "ok", text: M.saved });
      onSaved();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const fld = (k: keyof typeof f, label: string, num = true) => <label className="bw-field"><span className="bw-label">{label}</span><input className={`bw-input${num ? " bw-num" : ""}`} inputMode={num ? "decimal" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <Sheet title={M.title} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={() => void save()} data-testid="vs-model-save">{M.save}</Button></>}>
      <p className="bw-muted">{M.lead}</p>
      <Loading q={cur} />
      <div className="a-grid3">{fld("a", M.a)}{fld("b", M.b)}{fld("c", M.c)}</div>
      <div className="a-grid2">{fld("sBase", M.sBase)}{fld("iBase", M.iBase)}</div>
      <div className="a-grid2">{fld("sLabel", M.sLabel, false)}{fld("iLabel", M.iLabel, false)}</div>
      {fld("note", M.note, false)}
      {!valid && <p className="a-err">{M.bad}</p>}
    </Sheet>
  );
}

// ── De klant ───────────────────────────────────────────────────────────────
const MV = t.mijnVordering;

export function MijnVorderingPage({ go, route }: { go: (to: string) => void; route: string[] }) {
  if (route[1] && /^\d+$/.test(route[1])) return <MyStatement key={route[1]} id={BigInt(route[1])} go={go} />;
  return <MyStatements go={go} />;
}

export function MyStatements({ go, embedded, workName }: { go: (to: string) => void; embedded?: boolean; workName?: string }) {
  const { actor, isFetching } = useBackend();
  const list = useQuery({ queryKey: ["myProgress"], queryFn: () => actor!.listMyProgress(), enabled: !!actor && !isFetching });
  const rows: MyProgressBrief[] = (list.data ?? []).filter((x) => workName === undefined || x.workName === workName);
  return (
    <Frame embedded={embedded} label={MV.label} title={MV.title}>
      <p className="bw-muted" style={{ maxWidth: 680 }}>{MV.lead}</p>
      <Loading q={list} />
      {list.data && rows.length === 0 && <p className="a-empty">{MV.none}</p>}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="my-progress">
          {rows.map((x) => (
            <li key={String(x.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`mijn-vordering/${x.id}`)}>
                <span className="a-tag bw-mono">{x.code}</span>
                <span className="a-list__main">
                  <b>{x.workName}</b>
                  <span className="bw-muted">{T.period(fmtDayNum(x.periodFrom), fmtDayNum(x.periodTo))} · {MV.sentOn(fmtTime(x.sentAt))}{x.creditedBy ? ` · ${MV.credited}` : ""}</span>
                </span>
                {x.answered !== undefined && <span className={`a-tag ${x.answered ? "a-tag--ok" : "a-tag--warn"}`}>{x.answered ? MV.accepted : MV.remarked}</span>}
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function MyStatement({ id, go }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["myProgressRead", String(id)], queryFn: async () => unwrap(await actor!.readMyProgress(id)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const [sheet, setSheet] = useState<null | "ok" | "no">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const r: MyProgressRead | undefined = q.data;
  if (q.error) return <Page label={MV.label} title={MV.title}><p className="a-err" role="alert">{errText(q.error)}</p><Button icon="back" onClick={() => go("mijn-vordering")}>{t.common.back}</Button></Page>;
  if (!r) return <Page label={MV.label} title={MV.title}><p className="bw-muted">{t.common.loading}</p></Page>;
  const pdf = async () => {
    try {
      const d = pdfFromMyProgress(r);
      const blob = await makeProgressPdf(d);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = progressPdfName(d);
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  };
  const answer = async (ok: boolean) => {
    setBusy(true);
    try {
      unwrap(await actor!.answerMyProgress(r.id, r.hash, ok, note));
      toast.show({ kind: "ok", text: ok ? MV.accepted : MV.remarked });
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["myProgress"] });
      await q.refetch();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const rows: Row[] = r.lines.map((l) => ({ q: { ...l, form: (l.basis === ProgressBasis.percent ? "fixed" : l.basis === ProgressBasis.hours ? "regie" : "vh") as ProgressQtyLine["form"], inOffer: true, hasInput: true, hints: { hoursOpenMilli: 0n, hoursDisputedMilli: 0n }, flags: [] }, m: { unitPriceCents: l.unitPriceCents, noPrice: false, offerCents: l.offerCents, prevCents: l.prevCents } }));
  const tt = r.totals;
  return (
    <Page
      wide
      label={`${MV.label} · ${r.doc.workCode} ${r.doc.workName}`}
      title={r.code}
      actions={<><Button icon="back" onClick={() => go("mijn-vordering")}>{t.common.back}</Button><Button icon="doc" onClick={() => void pdf()} data-testid="my-vs-pdf">{MV.pdf}</Button></>}
    >
      <p className="bw-muted">{T.period(fmtDayNum(r.periodFrom), fmtDayNum(r.periodTo))} · {MV.sentOn(fmtTime(r.sentAt))} · {T.tot.due(fmtDayNum(r.doc.dueDay))}{r.creditsCode ? ` · ${T.credits(r.creditsCode)}` : ""}{r.creditedByCode ? ` · ${T.creditedBy(r.creditedByCode)}` : ""}</p>
      {r.note && <p>{r.note}</p>}
      {r.answer && <p className="a-note" data-testid="my-vs-answer">{r.answer.ok ? T.answerOk(r.answer.byName, fmtTime(r.answer.at)) : T.answerNo(r.answer.byName, fmtTime(r.answer.at), r.answer.note)}</p>}
      <LinesTable rows={rows} edits={new Map()} setEdit={() => {}} editable={false} money />
      <section className="vs-card vs-totals" style={{ maxWidth: 520, marginLeft: "auto" }}>
        <dl className="vs-dl">
          <div className="vs-dl__sum"><dt>{T.tot.period}</dt><dd className="bw-mono">{fmtEuro(tt.periodCents)}</dd></div>
          {tt.revisionCents !== 0n && <div><dt>{T.tot.revision}</dt><dd className="bw-mono">{fmtEuro(tt.revisionCents)}</dd></div>}
          <div><dt>{T.tot.subtotal}</dt><dd className="bw-mono">{fmtEuro(tt.subtotalCents)}</dd></div>
          <div><dt>{T.tot.vat(fmtBp(tt.vatBp))}</dt><dd className="bw-mono">{fmtEuro(tt.vatCents)}</dd></div>
          <div className="vs-dl__big"><dt>{T.tot.total}</dt><dd className="bw-mono">{fmtEuro(tt.totalCents)}</dd></div>
          {tt.retentionCents !== 0n && <div><dt>{T.tot.retention} {fmtBp(tt.retentionBp)}</dt><dd className="bw-mono">{fmtEuro(-tt.retentionCents)}</dd></div>}
          {tt.retentionCents !== 0n && <div className="vs-dl__big"><dt>{T.tot.payable}</dt><dd className="bw-mono">{fmtEuro(tt.payableCents)}</dd></div>}
        </dl>
        {r.canAnswer && <div className="a-row"><Button variant="primary" icon="check" onClick={() => setSheet("ok")} data-testid="my-vs-ok">{MV.agree}</Button><Button onClick={() => { setNote(""); setSheet("no"); }} data-testid="my-vs-no">{MV.remark}</Button></div>}
      </section>
      <Sheet title={MV.agreeTitle} open={sheet === "ok"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} onClick={() => void answer(true)} data-testid="my-vs-ok-go">{MV.agree}</Button></>}>
        <p>{MV.agreeLead}</p>
        <p className="bw-mono">{T.tot.total}: {fmtEuro(tt.totalCents)}</p>
        <p className="bw-muted q-small">{MV.exact} <span className="bw-mono">{r.hash.slice(0, 16)}…</span></p>
      </Sheet>
      <Sheet title={MV.remarkTitle} open={sheet === "no"} onClose={() => setSheet(null)} footer={<><Button onClick={() => setSheet(null)}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={note.trim().length < 5} onClick={() => void answer(false)}>{MV.remark}</Button></>}>
        <p>{MV.remarkLead}</p>
        <textarea className="bw-input" rows={3} placeholder={MV.remarkPh} value={note} onChange={(e) => setNote(e.target.value)} />
      </Sheet>
    </Page>
  );
}
