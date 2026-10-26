// Planning per werf (stap 1.3): Gantt op de desktop (slepen = verplaatsen, rechterrand = verlengen, met een
// voorvertoning van wat er meeschuift), een weeklijst op de gsm, de taakfiche met afhankelijkheden en
// uitvoerders, het sjabloon, de kalender van de werf en de wijzigingen. Wat iemand mag en ziet, zegt de
// backend (PlanView.caps en .scope, Rights.mo); elke handeling wordt daar opnieuw nagekeken.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  BlockKind, CascadeMode, DependencyKind, Grant, Role, TaskKind, TaskStatus,
  type AssignmentView, type Caps, type PlanChange, type PlanPreview, type PlanView, type TaskInput, type TaskView, type WorkView,
} from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, StatusBadge, useToast, type Status } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtTime, inputToDay, unwrap, useBackend } from "../util";
import { Frame, Loading } from "./common";
import { Field } from "./Werven";
import { addWorkdays, dayLetter, fmtDm, fmtShort, isoWeek, isStale, isWorkday, makeCal, nextWorkday, today, weekday, workdaysIn, type Cal } from "./planUtil";

const N = Number;

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Planning lezen + de gewone foutafhandeling: bij "intussen gewijzigd" opnieuw laden en het zeggen. */
function usePlan(workId: bigint) {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["plan", String(workId)], queryFn: () => actor!.getPlan(workId), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
}

function usePlanMutation<V>(workId: bigint, fn: (v: V) => Promise<unknown>, done?: (r: unknown) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["plan", String(workId)] });
      void qc.invalidateQueries({ queryKey: ["planHist", String(workId)] });
      done?.(r);
    },
    onError: (e) => {
      if (isStale(e)) void qc.invalidateQueries({ queryKey: ["plan", String(workId)] });
      toast.show({ kind: "error", text: isStale(e) ? t.plan.stale : errText(e) });
    },
  });
}

const statusOf = (s: TaskStatus): Status => s as unknown as Status;
const confKey = (a: AssignmentView) => a.confirmation.__kind__;

/** Het resultaat van een wijziging als korte melding: "3 taken geschoven · 1 bevestiging terug open". */
function resultText(r: unknown): string {
  const x = r as { changes?: unknown[]; reopened?: bigint } | undefined;
  const parts: string[] = [t.common.saved];
  if (x?.changes && x.changes.length > 0) parts.push(t.plan.shifted(x.changes.length));
  if (x?.reopened && x.reopened > 0n) parts.push(t.plan.reopened(N(x.reopened)));
  return parts.join(" · ");
}

// ── Pagina ────────────────────────────────────────────────────────────────

/** De volledige planning van een werf (Gantt of weeklijst); 2b.3: ook als tabblad Planning van de werf (embedded). */
export function PlanningPage({ id, caps, go, embedded }: { id: bigint; caps: Caps; go: (to: string) => void; embedded?: boolean }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const work = useQuery({ queryKey: ["work", String(id)], queryFn: () => actor!.getWork(id), enabled: on });
  const plan = usePlan(id);
  const wide = useMedia("(min-width: 900px)");
  const toast = useToast();
  // Vanaf het weekbord (1.4): #/werven/3/planning?taak=12 opent meteen die taak.
  const [open, setOpen] = useState<bigint | "new" | null>(() => {
    const m = window.location.hash.match(/[?&]taak=(\d+)/);
    return m ? BigInt(m[1]) : null;
  });
  const [preview, setPreview] = useState<{ change: PlanChange; title: string } | null>(null);
  const [sheet, setSheet] = useState<"tpl" | "cal" | "hist" | null>(null);
  const [zoom, setZoom] = useState<"day" | "week">("day");

  const p = plan.data;
  const cal = useMemo(() => makeCal(p?.blocks ?? []), [p?.blocks]);
  if (!work.data || !p) {
    return (
      <Frame embedded={embedded} title={t.plan.title} actions={embedded ? undefined : <Button icon="back" onClick={() => go(`werven/${id}`)}>{t.common.back}</Button>}>
        <Loading q={work.data ? plan : work} />
      </Frame>
    );
  }
  const w = work.data;
  const warnings = p.tasks.reduce((n, x) => n + x.warnings.length, 0);
  const task = open === "new" || open === null ? null : p.tasks.find((x) => x.id === open) ?? null;

  const move = (taskId: bigint, start: number, workdays: number) => {
    const tk = p.tasks.find((x) => x.id === taskId);
    if (!tk) return;
    setPreview({ change: { __kind__: "move", move: { taskId, start: BigInt(start), workdays: BigInt(workdays), mode: CascadeMode.follow } }, title: tk.title });
  };

  return (
    <Frame embedded={embedded} label={`${w.code} · ${w.name}`} title={t.plan.title} actions={<>
      {p.caps.edit && <Button variant="primary" icon="plus" onClick={() => setOpen("new")}>{t.plan.addTask}</Button>}
      {p.caps.edit && <Button icon="list" onClick={() => setSheet("tpl")}>{t.plan.applyTemplate}</Button>}
      <Button icon="calendar" onClick={() => setSheet("cal")}>{t.plan.calendar}</Button>
      {p.caps.history && <Button icon="clock" onClick={() => setSheet("hist")}>{t.plan.history}</Button>}
      {!embedded && <Button icon="back" onClick={() => go(`werven/${id}`)}>{t.common.back}</Button>}
    </>}>
      {!p.caps.edit && <p className="a-note">{p.scope === "ownOrg" ? t.plan.ownOnly : p.scope === "summary" ? t.plan.summaryOnly : t.plan.readOnly}</p>}
      {p.caps.edit && warnings > 0 && (
        <div className="a-alert" role="alert">
          <Icon name="alert" size={18} />
          <span className="a-list__main"><b>{t.plan.warnings(warnings)}</b>{t.plan.reflowLead}</span>
          <Button onClick={() => setPreview({ change: { __kind__: "reflow", reflow: null }, title: t.plan.reflow })}>{t.plan.reflow}</Button>
        </div>
      )}
      {p.tasks.length === 0 ? (
        <div className="a-empty">
          <p>{t.plan.empty} {p.caps.edit ? t.plan.emptyEdit : ""}</p>
          {p.caps.edit && <div className="a-row"><Button variant="primary" icon="list" onClick={() => setSheet("tpl")}>{t.plan.applyTemplate}</Button><Button icon="plus" onClick={() => setOpen("new")}>{t.plan.addTask}</Button></div>}
        </div>
      ) : wide ? (
        <>
          <div className="a-row a-row--between">
            <span className="bw-muted bw-num">{t.plan.summary(p.tasks.length)} · {p.start !== undefined ? `${fmtShort(p.start)} – ${fmtShort(p.end!)}` : ""}</span>
            <Choice label={t.plan.zoom} value={zoom} onChange={setZoom} options={[{ value: "day", label: t.plan.zoomDay }, { value: "week", label: t.plan.zoomWeek }]} />
          </div>
          <Gantt plan={p} cal={cal} zoom={zoom} editable={p.caps.edit} onOpen={setOpen} onMove={move} ghost={preview} workId={id} />
          <Legend />
        </>
      ) : (
        <WeekList plan={p} onOpen={setOpen} workId={id} />
      )}

      {open !== null && (
        <TaskSheet key={String(open)} workId={id} w={w} plan={p} cal={cal} task={task} caps={caps} onClose={() => setOpen(null)} onOpen={setOpen} />
      )}
      {preview && <PreviewSheet workId={id} plan={p} cal={cal} change={preview.change} title={preview.title} onChange={(c) => setPreview({ ...preview, change: c })} onClose={() => setPreview(null)} onDone={(r) => { setPreview(null); toast.show({ kind: "ok", text: resultText(r) }); }} />}
      {sheet === "tpl" && <TemplateSheet workId={id} plan={p} onClose={() => setSheet(null)} />}
      {sheet === "cal" && <CalendarSheet workId={id} plan={p} caps={caps} onClose={() => setSheet(null)} go={go} />}
      {sheet === "hist" && <HistorySheet workId={id} onClose={() => setSheet(null)} />}
    </Frame>
  );
}

function Legend() {
  return (
    <div className="g-legend bw-muted">
      <span><i className="g-legend__bar" />{t.plan.kinds.work}</span>
      <span><i className="g-legend__dia" />{t.plan.kinds.milestone}</span>
      <span><i className="g-legend__dia g-legend__dia--del" />{t.plan.kinds.delivery}</span>
      <span><i className="g-legend__off" />weekend · {t.plan.blockKinds.bouwverlof} · {t.plan.blockKinds.feestdag} · {t.plan.blockKinds.stop}</span>
      <span><i className="g-legend__today" />{t.plan.today}</span>
    </div>
  );
}

// ── Gantt (desktop) ───────────────────────────────────────────────────────

const ROW = 36;
const HEAD = 46;
const LEFT = 300;

type Drag = { taskId: bigint; mode: "move" | "resize"; x0: number; dd: number; moved: boolean };

function Gantt({ plan, cal, zoom, editable, onOpen, onMove, ghost, workId }: {
  plan: PlanView; cal: Cal; zoom: "day" | "week"; editable: boolean;
  onOpen: (id: bigint) => void; onMove: (id: bigint, start: number, workdays: number) => void;
  ghost: { change: PlanChange } | null; workId: bigint;
}) {
  const px = zoom === "day" ? 26 : 9;
  const now = today();
  const first = Math.min(N(plan.start ?? now), now);
  const last = Math.max(N(plan.end ?? now), now);
  const origin = first - weekday(first) - 7;
  const endDay = last - weekday(last) + 6 + 21;
  const days = endDay - origin + 1;
  const width = days * px;
  const x = (d: number) => (d - origin) * px;
  const rows = plan.tasks;
  const rowOf = new Map(rows.map((r, i) => [String(r.id), i]));
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const preview = usePreviewFor(workId, ghost?.change ?? null);
  const ghosts = new Map((preview.data?.__kind__ === "ok" ? preview.data.ok.changes : []).map((c) => [String(c.taskId), c]));

  // Bij het openen: naar vandaag (of het begin van de planning) scrollen.
  useEffect(() => {
    const el = scroller.current;
    // Een planning die pas later begint: open bij haar begin; anders bij vandaag (een week terug).
    // Vanaf het weekbord (?taak=…): naar die taak.
    const m = window.location.hash.match(/[?&]taak=(\d+)/);
    const focus = m ? plan.tasks.find((t) => String(t.id) === m[1]) : undefined;
    const target = focus ? N(focus.start) - 7 : N(plan.start ?? now) > now + 7 ? N(plan.start!) - 3 : now - 7;
    if (el) el.scrollLeft = Math.max(0, x(Math.max(first, target)) - 40);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const weeks: { monday: number; week: number }[] = [];
  for (let d = origin; d <= endDay; d += 7) weeks.push({ monday: d, week: isoWeek(d).week });

  const down = (e: RPointerEvent, tk: TaskView, mode: "move" | "resize") => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ taskId: tk.id, mode, x0: e.clientX, dd: 0, moved: false });
  };
  const moveP = (e: RPointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    setDrag({ ...drag, dd: Math.round(dx / px), moved: drag.moved || Math.abs(dx) > 3 });
  };
  const up = (tk: TaskView) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (!d.moved || d.dd === 0) {
      if (!d.moved) onOpen(tk.id);
      return;
    }
    if (d.mode === "move") onMove(tk.id, nextWorkday(cal, N(tk.start) + d.dd), N(tk.workdays));
    else onMove(tk.id, N(tk.start), Math.max(1, workdaysIn(cal, N(tk.start), N(tk.end) + d.dd)));
  };

  // Waar staat een taak (met de sleep of de voorvertoning erbij)?
  const span = (tk: TaskView): [number, number] => {
    if (drag && drag.taskId === tk.id && drag.moved) {
      if (drag.mode === "move") {
        const s = nextWorkday(cal, N(tk.start) + drag.dd);
        return [s, N(tk.workdays) === 0 ? s : addWorkdays(cal, s, N(tk.workdays) - 1)];
      }
      return [N(tk.start), Math.max(N(tk.start), N(tk.end) + drag.dd)];
    }
    return [N(tk.start), N(tk.end)];
  };

  const offDays: number[] = [];
  for (let d = origin; d <= endDay; d++) if (!isWorkday(cal, d)) offDays.push(d);
  const blockLabels = plan.blocks.filter((b) => N(b.to) >= origin && N(b.from) <= endDay);

  // Pijlen van de afhankelijkheden: van het einde van de voorganger naar het begin van de opvolger.
  const arrows = plan.dependencies.map((d) => {
    const a = rows.find((r) => r.id === d.fromTaskId);
    const b = rows.find((r) => r.id === d.toTaskId);
    if (!a || !b) return null;
    const [as, ae] = span(a);
    const [bs] = span(b);
    const ya = rowOf.get(String(a.id))! * ROW + ROW / 2;
    const yb = rowOf.get(String(b.id))! * ROW + ROW / 2;
    const xa = d.kind === DependencyKind.startToStart ? x(as) : N(a.workdays) === 0 ? x(ae) + px / 2 : x(ae + 1);
    const xb = N(b.workdays) === 0 ? x(bs) + px / 2 - 6 : x(bs);
    const mid = Math.max(xa + 6, Math.min(xb - 6, xa + 10));
    const path = `M${xa},${ya} H${mid} V${yb} H${xb - 1}`;
    return <path key={String(d.id)} d={path} className="g-arrow" markerEnd="url(#g-head)" />;
  });

  return (
    <div className="g" ref={scroller} onPointerMove={moveP}>
      <div className="g-inner" style={{ width: LEFT + width, height: HEAD + rows.length * ROW + 8 }}>
        {/* kop: weken en dagen */}
        <div className="g-head" style={{ height: HEAD }}>
          <div className="g-corner" style={{ width: LEFT }}>{t.plan.field.title}</div>
          <div className="g-scale" style={{ left: LEFT, width }}>
            {weeks.map((wk) => (
              <div key={wk.monday} className="g-week" style={{ left: x(wk.monday), width: 7 * px }}>
                <span>{zoom === "day" ? `wk ${wk.week} · ${fmtDm(wk.monday)}` : `${wk.week}`}</span>
              </div>
            ))}
            {zoom === "day" && Array.from({ length: days }, (_, i) => origin + i).map((d) => (
              <div key={d} className={`g-day${isWorkday(cal, d) ? "" : " g-day--off"}${d === now ? " g-day--today" : ""}`} style={{ left: x(d), width: px }}>{dayLetter(d)}</div>
            ))}
          </div>
        </div>
        {/* tijdlijn: vrije dagen, blokken, vandaag */}
        <div className="g-body" style={{ left: LEFT, top: HEAD, width, height: rows.length * ROW }}>
          {offDays.map((d) => <div key={d} className="g-off" style={{ left: x(d), width: px }} />)}
          {blockLabels.map((b) => (
            <div key={String(b.id)} className="g-block" style={{ left: x(Math.max(N(b.from), origin)), width: (Math.min(N(b.to), endDay) - Math.max(N(b.from), origin) + 1) * px }} title={`${t.plan.blockKinds[b.kind] ?? b.kind}: ${b.reason}`}>
              <span>{b.reason}</span>
            </div>
          ))}
          {now >= origin && now <= endDay && <div className="g-today" style={{ left: x(now) + px / 2 }} />}
          <svg className="g-arrows" width={width} height={rows.length * ROW}>
            <defs><marker id="g-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
            {arrows}
          </svg>
        </div>
        {/* rijen */}
        {rows.map((tk, i) => {
          const [s, e] = span(tk);
          const g = ghosts.get(String(tk.id));
          const ms = N(tk.workdays) === 0;
          const code = tk.assignments.find((a) => a.primary)?.orgCode ?? tk.responsibleName;
          const late = tk.kind === TaskKind.delivery && tk.orderBy !== undefined && N(tk.orderBy) < now;
          return (
            <div key={String(tk.id)} className="g-row" style={{ top: HEAD + i * ROW, width: LEFT + width }}>
              <button type="button" className="g-label" style={{ width: LEFT }} onClick={() => onOpen(tk.id)}>
                <span className="g-label__n">{i + 1}</span>
                <span className="g-label__t">{tk.title}</span>
                {tk.warnings.length > 0 && <span className="g-warn" title={tk.warnings.join("\n")}><Icon name="alert" size={15} /></span>}
                {code && <span className="a-tag">{code}</span>}
              </button>
              <div className="g-lane" style={{ left: LEFT, width }}>
                {tk.orderBy !== undefined && N(tk.orderBy) >= origin && (
                  <div className={`g-order${late ? " g-order--late" : ""}`} style={{ left: x(N(tk.orderBy)) + px / 2, width: Math.max(0, x(s) - x(N(tk.orderBy))) }} title={`${t.plan.field.orderBy}: ${fmtShort(tk.orderBy)}`} />
                )}
                {ms ? (
                  <div
                    className={`g-dia g-dia--${statusOf(tk.status)}${tk.kind === TaskKind.delivery ? " g-dia--del" : ""}${tk.warnings.length ? " g-bar--warn" : ""}${editable ? " g-grab" : ""}`}
                    style={{ left: x(s) + px / 2 - 8 }}
                    onPointerDown={(ev) => down(ev, tk, "move")}
                    onPointerUp={() => up(tk)}
                    role="button" tabIndex={0} aria-label={`${tk.title} ${fmtShort(s)}`}
                    onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(tk.id); }}
                    title={`${tk.title} · ${fmtShort(s)}`}
                  />
                ) : (
                  <div
                    className={`g-bar g-bar--${statusOf(tk.status)}${tk.warnings.length ? " g-bar--warn" : ""}${drag?.taskId === tk.id && drag.moved ? " g-bar--drag" : ""}${editable ? " g-grab" : ""}`}
                    style={{ left: x(s), width: (e - s + 1) * px - 2 }}
                    onPointerDown={(ev) => down(ev, tk, "move")}
                    onPointerUp={() => up(tk)}
                    role="button" tabIndex={0} aria-label={`${tk.title} ${fmtShort(s)} – ${fmtShort(e)}`}
                    onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(tk.id); }}
                    title={`${tk.title}\n${fmtShort(s)} – ${fmtShort(e)} · ${t.plan.workdays(N(tk.workdays))}`}
                  >
                    <span className="g-bar__fill" style={{ width: `${N(tk.percent)}%` }} />
                    {(e - s + 1) * px > 54 && <span className="g-bar__txt">{drag?.taskId === tk.id && drag.moved ? `${fmtDm(s)}–${fmtDm(e)}` : code ? code : `${N(tk.workdays)} d`}</span>}
                    {editable && <span className="g-bar__grip" onPointerDown={(ev) => down(ev, tk, "resize")} onPointerUp={() => up(tk)} aria-hidden />}
                  </div>
                )}
                {g && <div className={`g-ghost${ms ? " g-ghost--ms" : ""}`} style={{ left: x(N(g.toStart)), width: ms ? px : (N(g.toEnd) - N(g.toStart) + 1) * px - 2 }} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** De voorvertoning (query): dezelfde rekenregels als het bewaren, uit de backend. */
function usePreviewFor(workId: bigint, change: PlanChange | null) {
  const { actor, isFetching } = useBackend();
  const key = change ? JSON.stringify(change, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
  return useQuery({
    queryKey: ["planPreview", String(workId), key],
    queryFn: () => actor!.previewPlan(workId, change!),
    enabled: !!actor && !isFetching && !!change,
    staleTime: 0,
  });
}

function PreviewSheet({ workId, plan, change, title, onChange, onClose, onDone }: {
  workId: bigint; plan: PlanView; cal: Cal; change: PlanChange; title: string;
  onChange: (c: PlanChange) => void; onClose: () => void; onDone: (r: unknown) => void;
}) {
  const { actor } = useBackend();
  const pv = usePreviewFor(workId, change);
  const [reason, setReason] = useState("");
  const apply = usePlanMutation(workId, async () => unwrap(await actor!.applyPlan(workId, change, plan.version, reason)), onDone);
  const res: PlanPreview | null = pv.data?.__kind__ === "ok" ? pv.data.ok : null;
  const err = pv.data?.__kind__ === "err" ? pv.data.err : null;
  const mode = change.__kind__ === "move" ? change.move.mode : null;
  return (
    <Sheet side title={`${t.plan.preview} · ${title}`} open onClose={onClose} footer={<>
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" busy={apply.isPending} disabled={!res || res.changes.length === 0} onClick={() => apply.mutate(undefined)}>{t.plan.apply}</Button>
    </>}>
      <p className="bw-muted">{t.plan.previewLead}</p>
      {mode !== null && change.__kind__ === "move" && (
        <Field label={t.plan.mode}>
          <Choice label={t.plan.mode} value={mode} onChange={(m) => onChange({ __kind__: "move", move: { ...change.move, mode: m } })} options={[{ value: CascadeMode.follow, label: t.plan.modeFollow }, { value: CascadeMode.asNeeded, label: t.plan.modeAsNeeded }]} />
        </Field>
      )}
      {mode !== null && <p className="bw-muted">{t.plan.modeHelp}</p>}
      <Loading q={pv} />
      {err && <p className="a-err">{err}</p>}
      {res && res.changes.length === 0 && <p className="a-empty">{t.plan.noChanges}</p>}
      {res && res.changes.length > 0 && (
        <ul className="a-list">
          {res.changes.map((c) => (
            <li key={String(c.taskId)}>
              <span className="a-list__main">
                <b>{c.title}</b>
                <span className="bw-num">{fmtShort(c.fromStart)} – {fmtShort(c.fromEnd)} → <b>{fmtShort(c.toStart)} – {fmtShort(c.toEnd)}</b></span>
                <span className="bw-muted">{c.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {res && res.reopened > 0n && <p className="a-note">{t.plan.reopened(N(res.reopened))}</p>}
      <Field label={t.plan.field.reason}><input className="bw-input" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>
    </Sheet>
  );
}

// ── Weeklijst (gsm) ───────────────────────────────────────────────────────

function WeekList({ plan, onOpen, workId }: { plan: PlanView; onOpen: (id: bigint) => void; workId: bigint }) {
  const [view, setView] = useState<"weeks" | "all">("weeks");
  const [past, setPast] = useState(false);
  const now = today();
  const thisMonday = now - weekday(now);
  const first = N(plan.start ?? now);
  const last = N(plan.end ?? now);
  const weeks: number[] = [];
  for (let m = first - weekday(first); m <= last; m += 7) if (past || m + 6 >= thisMonday) weeks.push(m);
  return (
    <div className="a-stack">
      <div className="a-row a-row--between">
        <Choice label={t.plan.title} value={view} onChange={setView} options={[{ value: "weeks", label: t.plan.viewWeeks }, { value: "all", label: t.plan.viewList }]} />
        {view === "weeks" && first < thisMonday && <Button variant="quiet" onClick={() => setPast(!past)}>{past ? "—" : t.common.more}</Button>}
      </div>
      {view === "all" ? (
        <TaskRows tasks={plan.tasks} onOpen={onOpen} workId={workId} />
      ) : (
        weeks.map((m) => {
          const tasks = plan.tasks.filter((x) => N(x.start) <= m + 6 && N(x.end) >= m);
          if (tasks.length === 0) return null;
          return (
            <section key={m} className="a-section">
              <h2 className="bw-label">{t.plan.week(isoWeek(m).week)} · {fmtDm(m)} – {fmtDm(m + 4)}{m === thisMonday ? ` · ${t.plan.today.toLowerCase()}` : ""}</h2>
              <TaskRows tasks={tasks} onOpen={onOpen} workId={workId} />
            </section>
          );
        })
      )}
    </div>
  );
}

function TaskRows({ tasks, onOpen, workId }: { tasks: TaskView[]; onOpen: (id: bigint) => void; workId: bigint }) {
  return (
    <ul className="a-list">
      {tasks.map((x) => (
        <li key={String(x.id)}>
          <button type="button" className="a-list__btn" onClick={() => onOpen(x.id)}>
            <span className="a-list__main">
              <b>{x.title}</b>
              <span className="bw-num bw-muted">{N(x.workdays) === 0 ? `${t.plan.kinds[x.kind]} · ${fmtShort(x.start)}` : `${fmtShort(x.start)} – ${fmtShort(x.end)} · ${t.plan.workdays(N(x.workdays))}`}</span>
              {(x.responsibleName || x.assignments.length > 0) && <span className="bw-muted">{x.assignments.length > 0 ? [...new Set(x.assignments.map((a) => `${a.orgName}${a.orgCode ? ` (${a.orgCode})` : ""}`))].join(", ") : x.responsibleName}</span>}
              {x.warnings.map((wn) => <span key={wn} className="a-err">{wn}</span>)}
            </span>
            <span className="a-stack" style={{ alignItems: "flex-end", gap: 4 }}>
              <StatusBadge status={statusOf(x.status)} small />
              {x.assignments.filter((a, i, arr) => arr.findIndex((b) => b.orgId === a.orgId && Object.keys(b.confirmation)[0] === Object.keys(a.confirmation)[0]) === i).map((a) => <ConfTag key={String(a.id)} a={a} />)}
            </span>
          </button>
          <span hidden>{String(workId)}</span>
        </li>
      ))}
    </ul>
  );
}

function ConfTag({ a }: { a: AssignmentView }) {
  const k = confKey(a);
  return <span className={`a-tag${k === "confirmed" ? " a-tag--ok" : k === "declined" ? " a-tag--bad" : ""}`}>{t.plan.conf[k]}</span>;
}

// ── Taakfiche ─────────────────────────────────────────────────────────────

const KINDS = [TaskKind.work, TaskKind.milestone, TaskKind.delivery];
const STATUSES = [TaskStatus.planned, TaskStatus.busy, TaskStatus.delayed, TaskStatus.done, TaskStatus.blocked];

function TaskSheet({ workId, w, plan, cal, task, caps, onClose, onOpen }: {
  workId: bigint; w: WorkView; plan: PlanView; cal: Cal; task: TaskView | null; caps: Caps;
  onClose: () => void; onOpen: (id: bigint) => void;
}) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const toast = useToast();
  const edit = plan.caps.edit;
  const trades = useQuery({ queryKey: ["trades", false], queryFn: () => actor!.listTrades(false), enabled: on && edit });
  const oas = useQuery({ queryKey: ["oas-all"], queryFn: () => actor!.listOas({ includeArchived: false }), enabled: on && edit });
  const [title, setTitle] = useState(task?.title ?? "");
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? TaskKind.work);
  const [trade, setTrade] = useState(task?.trade ?? "");
  const [org, setOrg] = useState(task?.responsibleOrgId !== undefined ? String(task.responsibleOrgId) : "");
  const [start, setStart] = useState(dayToInput(task ? task.start : BigInt(nextWorkday(cal, Math.max(today(), N(plan.start ?? today()))))));
  const [wd, setWd] = useState(String(task ? task.workdays : 5n));
  const [lead, setLead] = useState(String(task?.leadDays ?? 0n));
  const [orderDay, setOrderDay] = useState(dayToInput(task?.orderDay));
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? TaskStatus.planned);
  const [pct, setPct] = useState(String(task?.percent ?? 0n));
  const [note, setNote] = useState(task?.note ?? "");
  const [reason, setReason] = useState("");
  const [archive, setArchive] = useState(false);

  const input = (): TaskInput => {
    const s = inputToDay(start);
    if (s === undefined) throw new Error(`${t.plan.field.start}: ?`);
    return {
      id: task?.id,
      title,
      note,
      kind,
      trade: trade || undefined,
      responsibleOrgId: org ? BigInt(org) : undefined,
      status,
      percent: BigInt(Math.max(0, Math.min(100, Number(pct) || 0))),
      start: s,
      workdays: kind === TaskKind.work ? BigInt(Math.max(1, Number(wd) || 1)) : 0n,
      leadDays: kind === TaskKind.delivery ? BigInt(Math.max(0, Number(lead) || 0)) : 0n,
      orderDay: kind === TaskKind.delivery ? inputToDay(orderDay) : undefined,
      reason,
    };
  };
  const save = usePlanMutation(workId, async () => unwrap(await actor!.saveTask(workId, input(), plan.version)), (r) => {
    toast.show({ kind: "ok", text: resultText(r) });
    const id = (r as { taskId?: bigint }).taskId;
    if (!task && id !== undefined) onOpen(id);
  });
  const del = usePlanMutation(workId, async () => unwrap(await actor!.archiveTask(workId, task!.id, plan.version)), () => onClose());

  const ro = !edit;
  const headTitle = task ? task.title : t.plan.newTask;
  const end = task ? task.end : undefined;
  const now = today();
  return (
    <Sheet side title={headTitle} open onClose={onClose} footer={edit ? <>
      {task && <Button variant="danger" onClick={() => setArchive(true)}>{t.plan.archiveTask}</Button>}
      <Button onClick={onClose}>{t.common.close}</Button>
      <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>{t.common.save}</Button>
    </> : <Button onClick={onClose}>{t.common.close}</Button>}>
      {task && task.warnings.length > 0 && <div className="a-alert"><Icon name="alert" size={18} /><span>{task.warnings.join(" · ")}</span></div>}
      {task && (task.actualStart !== undefined || task.actualEnd !== undefined) && (
        <p className="a-note">{t.plan.actual(task.actualStart !== undefined ? fmtDayNum(task.actualStart) : "–", task.actualEnd !== undefined ? fmtDayNum(task.actualEnd) : "–")}</p>
      )}
      {ro && task ? (
        <dl className="a-dl">
          <dt>{t.plan.field.kind}</dt><dd>{t.plan.kinds[task.kind]}</dd>
          <dt>{t.plan.status}</dt><dd><StatusBadge status={statusOf(task.status)} small extra={N(task.percent) > 0 ? `${task.percent} %` : undefined} /></dd>
          <dt>{t.plan.field.start}</dt><dd className="bw-num">{fmtShort(task.start)}</dd>
          {N(task.workdays) > 0 && <><dt>{t.plan.field.end}</dt><dd className="bw-num">{fmtShort(task.end)} · {t.plan.workdays(N(task.workdays))}</dd></>}
          {task.responsibleName && <><dt>{t.plan.field.org}</dt><dd>{task.responsibleName}</dd></>}
          {task.kind === TaskKind.delivery && <><dt>{t.plan.field.lead}</dt><dd>{N(task.leadDays)} d{task.orderDay !== undefined ? ` · ${t.plan.field.orderDay} ${fmtShort(task.orderDay)}` : ` · ${t.plan.notOrdered}`}</dd></>}
        </dl>
      ) : (
        <div className="a-form">
          <Field label={t.plan.field.title}><input className="bw-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} /></Field>
          <Field label={t.plan.field.kind}>
            <Choice label={t.plan.field.kind} value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t.plan.kinds[k] }))} />
          </Field>
          {kind !== TaskKind.work && <p className="bw-muted">{t.plan.kindHelp}</p>}
          <div className="a-grid2">
            <Field label={t.plan.field.start}><input className="bw-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            {kind === TaskKind.work && <Field label={t.plan.field.workdays}><input className="bw-input bw-num" type="number" min={1} max={400} value={wd} onChange={(e) => setWd(e.target.value)} /></Field>}
          </div>
          {task && end !== undefined && kind === TaskKind.work && <p className="bw-muted bw-num">{t.plan.field.end}: {fmtShort(end)}</p>}
          {kind === TaskKind.delivery && (
            <div className="a-grid2">
              <Field label={t.plan.field.lead}><input className="bw-input bw-num" type="number" min={0} max={365} value={lead} onChange={(e) => setLead(e.target.value)} /></Field>
              <Field label={t.plan.field.orderDay}><input className="bw-input" type="date" value={orderDay} onChange={(e) => setOrderDay(e.target.value)} /></Field>
            </div>
          )}
          {task?.orderBy !== undefined && <p className={N(task.orderBy) < now ? "a-err" : "bw-muted"}>{t.plan.field.orderBy}: <b className="bw-num">{fmtShort(task.orderBy)}</b>{N(task.orderBy) < now ? ` · ${t.plan.orderLate}` : ""}</p>}
          <div className="a-grid2">
            <Field label={t.plan.field.trade}>
              <select className="bw-input" value={trade} onChange={(e) => setTrade(e.target.value)}>
                <option value="">{t.plan.field.noTrade}</option>
                {(trades.data ?? []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                {trade && !(trades.data ?? []).some((x) => x.key === trade) && <option value={trade}>{trade}</option>}
              </select>
            </Field>
            <Field label={t.plan.field.org}>
              <select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">{t.plan.field.noOrg}</option>
                {(() => {
                  // Firma's met dit vakgebied eerst; de andere blijven kiesbaar.
                  const opt = (o: { org: { id: bigint; name: string; aliases: string[] } }) => <option key={String(o.org.id)} value={String(o.org.id)}>{o.org.name}{o.org.aliases[0] ? ` (${o.org.aliases[0]})` : ""}</option>;
                  const all = oas.data ?? [];
                  if (!trade) return all.map(opt);
                  const match = all.filter((o) => o.org.trades.includes(trade));
                  const rest = all.filter((o) => !o.org.trades.includes(trade));
                  return <>{match.length > 0 && <optgroup label={t.plan.withTrade}>{match.map(opt)}</optgroup>}<optgroup label={t.plan.otherOrgs}>{rest.map(opt)}</optgroup></>;
                })()}
                {org && !(oas.data ?? []).some((o) => String(o.org.id) === org) && <option value={org}>{task?.responsibleName || `#${org}`}</option>}
              </select>
            </Field>
          </div>
          <Field label={t.plan.status}>
            <Choice label={t.plan.status} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: <StatusBadge status={statusOf(s)} small /> }))} />
          </Field>
          {kind === TaskKind.work && <Field label={t.plan.field.percent}><input className="bw-input bw-num" type="number" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(e.target.value)} /></Field>}
          <Field label={t.plan.field.note}><textarea className="bw-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {task && <Field label={t.plan.field.reason}><input className="bw-input" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>}
        </div>
      )}
      {task && <Deps workId={workId} plan={plan} task={task} onOpen={onOpen} />}
      {task && (plan.scope !== "summary") && <Assignments workId={workId} w={w} plan={plan} task={task} caps={caps} />}
      {task && plan.caps.history && <TaskAppointments workId={workId} taskId={task.id} />}
      {task && plan.caps.history && <TaskHistory workId={workId} taskId={task.id} />}
      {task && <p className="bw-muted">{task.updatedByName ? `${task.updatedByName} · ` : ""}{fmtTime(task.updatedAt)}</p>}
      <Confirm open={archive} title={t.plan.archiveTask} text={t.plan.archiveTaskText} confirmLabel={t.plan.archiveTask} busy={del.isPending} onConfirm={() => del.mutate(undefined)} onClose={() => setArchive(false)} />
    </Sheet>
  );
}

function Deps({ workId, plan, task, onOpen }: { workId: bigint; plan: PlanView; task: TaskView; onOpen: (id: bigint) => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const inc = plan.dependencies.filter((d) => d.toTaskId === task.id);
  const out = plan.dependencies.filter((d) => d.fromTaskId === task.id);
  const name = (id: bigint) => plan.tasks.find((x) => x.id === id)?.title ?? `#${id}`;
  const [from, setFrom] = useState("");
  const [kind, setKind] = useState<DependencyKind>(DependencyKind.finishToStart);
  const [lag, setLag] = useState("0");
  const dep = () => ({ fromTaskId: BigInt(from), toTaskId: task.id, kind, lagDays: BigInt(Math.round(Number(lag) || 0)) });
  // Eerst de voorvertoning (C2): schuift er iets, dan toont de fiche wat en bevestig je; anders meteen bewaren.
  const [shifts, setShifts] = useState<PlanPreview | null>(null);
  const add = usePlanMutation(workId, async () => unwrap(await actor!.addDependency(workId, dep(), plan.version)), (r) => { setFrom(""); setLag("0"); setShifts(null); toast.show({ kind: "ok", text: resultText(r) }); });
  const check = usePlanMutation(workId, async () => unwrap(await actor!.previewDependency(workId, dep())), (r) => {
    const pv = r as PlanPreview;
    if (pv.changes.length === 0) add.mutate(undefined);
    else setShifts(pv);
  });
  const del = usePlanMutation(workId, async (id: bigint) => unwrap(await actor!.removeDependency(workId, id, plan.version)));
  if (plan.scope === "summary") return null;
  return (
    <section className="a-section">
      <h3 className="bw-label">{t.plan.deps}</h3>
      {inc.length === 0 && <p className="bw-muted">{t.plan.depsNone}</p>}
      {inc.length > 0 && (
        <ul className="a-list">
          {inc.map((d) => (
            <li key={String(d.id)}>
              <button type="button" className="a-list__btn" onClick={() => onOpen(d.fromTaskId)}>
                <span className="a-list__main"><b>{name(d.fromTaskId)}</b><span className="bw-muted">{t.plan.depKind[d.kind]}{d.lagDays !== 0n ? ` · ${t.plan.lag.toLowerCase()} ${d.lagDays}` : ""}</span></span>
              </button>
              {plan.caps.edit && <Button variant="quiet" icon="close" iconOnly busy={del.isPending && del.variables === d.id} onClick={() => del.mutate(d.id)}>{t.common.close}</Button>}
            </li>
          ))}
        </ul>
      )}
      {plan.caps.edit && (
        <div className="a-form a-sub">
          <Field label={t.plan.addDep}>
            <select className="bw-input" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{t.plan.pickTask}</option>
              {plan.tasks.filter((x) => x.id !== task.id && !inc.some((d) => d.fromTaskId === x.id)).map((x) => <option key={String(x.id)} value={String(x.id)}>{x.title}</option>)}
            </select>
          </Field>
          <div className="a-grid2">
            <Choice label={t.plan.addDep} value={kind} onChange={setKind} options={[{ value: DependencyKind.finishToStart, label: t.plan.depKind.finishToStart }, { value: DependencyKind.startToStart, label: t.plan.depKind.startToStart }]} />
            <Field label={t.plan.lag}><input className="bw-input bw-num" type="number" min={-120} max={120} value={lag} onChange={(e) => setLag(e.target.value)} /></Field>
          </div>
          <p className="bw-muted">{t.plan.lagHelp}</p>
          <div><Button icon="plus" disabled={!from} busy={add.isPending || check.isPending} onClick={() => check.mutate(undefined)}>{t.plan.addDep}</Button></div>
        </div>
      )}
      <Sheet title={`${t.plan.preview} · ${t.plan.addDep.toLowerCase()}`} open={shifts !== null} onClose={() => setShifts(null)} footer={<>
        <Button onClick={() => setShifts(null)}>{t.common.cancel}</Button>
        <Button variant="primary" busy={add.isPending} onClick={() => add.mutate(undefined)}>{t.plan.apply}</Button>
      </>}>
        <p className="bw-muted">{t.plan.depPreviewLead(name(BigInt(from || "0")), task.title)}</p>
        {shifts && (
          <ul className="a-list">
            {shifts.changes.map((c) => (
              <li key={String(c.taskId)}>
                <span className="a-list__main">
                  <b>{c.title}</b>
                  <span className="bw-num">{fmtShort(c.fromStart)} – {fmtShort(c.fromEnd)} → <b>{fmtShort(c.toStart)} – {fmtShort(c.toEnd)}</b></span>
                  <span className="bw-muted">{c.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {shifts && shifts.reopened > 0n && <p className="a-note">{t.plan.reopened(N(shifts.reopened))}</p>}
      </Sheet>
      {out.length > 0 && <p className="bw-muted">{t.plan.succs}: {out.map((d) => name(d.toTaskId)).join(", ")}</p>}
    </section>
  );
}

function Assignments({ workId, w, plan, task, caps }: { workId: bigint; w: WorkView; plan: PlanView; task: TaskView; caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const oas = useQuery({ queryKey: ["oas-all"], queryFn: () => actor!.listOas({ includeArchived: false }), enabled: on && plan.caps.edit });
  const [org, setOrg] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState<bigint | null>(null);
  const [why, setWhy] = useState("");
  const add = usePlanMutation(workId, async () => unwrap(await actor!.saveAssignment(workId, { taskId: task.id, orgId: BigInt(org), fromDay: inputToDay(from), toDay: inputToDay(to), note }, plan.version)), () => { setOrg(""); setFrom(""); setTo(""); setNote(""); toast.show({ kind: "ok", text: t.common.saved }); });
  const del = usePlanMutation(workId, async (id: bigint) => unwrap(await actor!.archiveAssignment(workId, id, plan.version)));
  const confirm = usePlanMutation(workId, async (v: { id: bigint; ok: boolean }) => unwrap(await actor!.confirmAssignment(v.id, v.ok, v.ok ? "" : why)), () => { setDeclining(null); setWhy(""); void qc.invalidateQueries({ queryKey: ["mine"] }); toast.show({ kind: "ok", text: t.common.saved }); });
  const team = useMutation({
    mutationFn: async (orgId: bigint) => unwrap(await actor!.addMembership(workId, null, orgId, Role.onderaannemer, [Grant.confirmPlanning, Grant.confirmHours])),
    onSuccess: () => { void qc.invalidateQueries(); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section">
      <h3 className="bw-label">{t.plan.assignments}</h3>
      {plan.caps.edit && <p className="bw-muted">{t.plan.assignmentsLead}</p>}
      {task.assignments.length > 0 && (
        <ul className="a-list">
          {task.assignments.map((a) => (
            <li key={String(a.id)} className="a-doc">
              <span className="a-list__main">
                <b>{a.orgName}{a.orgCode ? <span className="a-tag" style={{ marginLeft: 6 }}>{a.orgCode}</span> : null}</b>
                <span className="bw-num bw-muted">{fmtShort(a.start)}{a.end !== a.start ? ` – ${fmtShort(a.end)}` : ""}{a.note ? ` · ${a.note}` : ""}</span>
                <span className="a-row"><ConfTag a={a} />{a.confirmedByName && <span className="bw-muted">{t.plan.confirmedBy(a.confirmedByName)}</span>}{a.confirmation.__kind__ === "declined" && <span className="bw-muted">“{a.confirmation.declined.reason}”</span>}</span>
                {!a.inTeam && plan.caps.edit && <span className="a-row"><span className="a-tag a-tag--warn">{t.plan.notInTeam}</span>{w.caps.manageMembers && <Button variant="quiet" busy={team.isPending} onClick={() => team.mutate(a.orgId)}>{t.plan.addToTeam}</Button>}</span>}
              </span>
              {plan.caps.confirm && caps && a.confirmation.__kind__ !== "confirmed" && (
                <Button variant="primary" busy={confirm.isPending && confirm.variables?.id === a.id && confirm.variables.ok} onClick={() => confirm.mutate({ id: a.id, ok: true })}>{t.plan.confirm}</Button>
              )}
              {plan.caps.confirm && a.confirmation.__kind__ !== "declined" && <Button onClick={() => setDeclining(a.id)}>{t.plan.decline}</Button>}
              {plan.caps.edit && !a.primary && <Button variant="quiet" icon="close" iconOnly busy={del.isPending && del.variables === a.id} onClick={() => del.mutate(a.id)}>{t.common.close}</Button>}
            </li>
          ))}
        </ul>
      )}
      {plan.caps.edit && (
        <div className="a-form a-sub">
          <Field label={t.plan.addAssignment}>
            <select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="">—</option>
              {(oas.data ?? []).map((o) => <option key={String(o.org.id)} value={String(o.org.id)}>{o.org.name}{o.org.aliases[0] ? ` (${o.org.aliases[0]})` : ""}</option>)}
            </select>
          </Field>
          <div className="a-grid2">
            <Field label={t.plan.fromDay}><input className="bw-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={t.plan.toDay}><input className="bw-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label={t.plan.cellNote}><input className="bw-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
          <div><Button icon="plus" disabled={!org} busy={add.isPending} onClick={() => add.mutate(undefined)}>{t.plan.addAssignment}</Button></div>
        </div>
      )}
      <Sheet title={t.plan.declineTitle} open={declining !== null} onClose={() => setDeclining(null)} footer={<>
        <Button onClick={() => setDeclining(null)}>{t.common.cancel}</Button>
        <Button variant="primary" disabled={!why.trim()} busy={confirm.isPending} onClick={() => declining !== null && confirm.mutate({ id: declining, ok: false })}>{t.plan.decline}</Button>
      </>}>
        <Field label={t.plan.declineReason}><textarea className="bw-input" rows={3} maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus /></Field>
      </Sheet>
    </section>
  );
}

/** Afspraken uit de geïmporteerde planning (1.5): dag, uur en de tekst van de cel. Enkel interne rollen. */
function TaskAppointments({ workId, taskId }: { workId: bigint; taskId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["appointments", String(workId)], queryFn: () => actor!.listAppointments(workId), enabled: !!actor && !isFetching, retry: false });
  const mine = (q.data ?? []).filter((a) => a.taskId === taskId).sort((a, b) => Number(a.day - b.day));
  if (mine.length === 0) return null;
  return (
    <section className="a-section">
      <h3 className="bw-label">{t.plan.appts}</h3>
      <ul className="a-list">
        {mine.map((a) => (
          <li key={String(a.id)}>
            <span className="a-list__main">
              <b className="bw-num">{fmtDayNum(a.day)}{a.time !== undefined ? t.plan.apptTime(a.time) : ""}</b>
              <span>{a.text}</span>
              {a.weekFallback && <span className="bw-muted">{t.imp.weekFallback}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaskHistory({ workId, taskId }: { workId: bigint; taskId: bigint }) {
  const { actor, isFetching } = useBackend();
  const [show, setShow] = useState(false);
  const h = useQuery({ queryKey: ["planHist", String(workId), String(taskId)], queryFn: () => actor!.taskHistory(workId, taskId, 0n, 50n), enabled: show && !!actor && !isFetching });
  return (
    <section className="a-section">
      {!show ? <div><Button variant="quiet" icon="clock" onClick={() => setShow(true)}>{t.plan.history}</Button></div> : <>
        <h3 className="bw-label">{t.plan.history}</h3>
        <Loading q={h} />
        {h.data && <HistoryList rows={h.data} withTask={false} />}
      </>}
    </section>
  );
}

function HistoryList({ rows, withTask }: { rows: { id: bigint; taskTitle: string; at: bigint; byName: string; field: string; from: string; to: string; reason: string }[]; withTask: boolean }) {
  if (rows.length === 0) return <p className="a-empty">{t.plan.histNone}</p>;
  return (
    <ul className="a-list">
      {rows.map((c) => (
        <li key={String(c.id)}>
          <span className="a-list__main">
            <b>{withTask ? `${c.taskTitle} · ` : ""}{c.field}</b>
            <span className="bw-num">{c.from || "—"} → {c.to || "—"}</span>
            <span className="bw-muted">{c.byName} · {fmtTime(c.at)}{c.reason ? ` · ${c.reason}` : ""}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function HistorySheet({ workId, onClose }: { workId: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const [limit, setLimit] = useState(60);
  const h = useQuery({ queryKey: ["planHist", String(workId), "all", limit], queryFn: () => actor!.taskHistory(workId, null, 0n, BigInt(limit)), enabled: !!actor && !isFetching });
  return (
    <Sheet side title={t.plan.history} open onClose={onClose}>
      <p className="bw-muted">{t.plan.histLead}</p>
      <Loading q={h} />
      {h.data && <HistoryList rows={h.data} withTask />}
      {h.data && h.data.length >= limit && <div><Button variant="quiet" onClick={() => setLimit(limit + 100)}>{t.common.more}</Button></div>}
    </Sheet>
  );
}

// ── Sjabloon en kalender ──────────────────────────────────────────────────

function TemplateSheet({ workId, plan, onClose }: { workId: bigint; plan: PlanView; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const tpls = useQuery({ queryKey: ["templates"], queryFn: () => actor!.listTemplates(), enabled: !!actor && !isFetching });
  const [key, setKey] = useState("standaardrenovatie");
  const [start, setStart] = useState(dayToInput(BigInt(nextWorkday({ blocks: [] }, today() + 7))));
  const [append, setAppend] = useState(plan.tasks.length > 0);
  const apply = usePlanMutation(workId, async () => {
    const s = inputToDay(start);
    if (s === undefined) throw new Error(t.plan.tplStart);
    return unwrap(await actor!.applyTemplate(workId, key, s, append, plan.version));
  }, () => { toast.show({ kind: "ok", text: t.common.saved }); onClose(); });
  const list = (tpls.data ?? []).filter((x) => !x.archived);
  const sel = list.find((x) => x.key === key);
  return (
    <Sheet side title={t.plan.tplTitle} open onClose={onClose} footer={<>
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" busy={apply.isPending} disabled={!sel || (plan.tasks.length > 0 && !append)} onClick={() => apply.mutate(undefined)}>{t.plan.applyTemplate}</Button>
    </>}>
      <p className="bw-muted">{t.plan.tplLead}</p>
      <Loading q={tpls} />
      <div className="a-form">
        <Field label={t.plan.tplPick}>
          <select className="bw-input" value={key} onChange={(e) => setKey(e.target.value)}>
            {list.map((x) => <option key={x.key} value={x.key}>{x.name}{x.provisional ? ` (${t.plan.provisional})` : ""}</option>)}
          </select>
        </Field>
        <Field label={t.plan.tplStart}><input className="bw-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        {plan.tasks.length > 0 && <label className="a-check"><input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />{t.plan.tplAppend}</label>}
      </div>
      {sel && (
        <ol className="a-steps">
          {sel.steps.map((s) => (
            <li key={s.key}>
              <span>{s.title}</span>
              <span className="bw-muted bw-num">{s.kind === TaskKind.work ? t.plan.workdays(N(s.workdays)) : t.plan.kinds[s.kind]}{N(s.leadDays) > 0 ? ` · ${N(s.leadDays)} d` : ""}{N(s.lagDays) > 0 ? ` · +${N(s.lagDays)} wd` : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

const BLOCK_KINDS = [BlockKind.stop, BlockKind.bouwverlof, BlockKind.feestdag, BlockKind.other];

function CalendarSheet({ workId, plan, caps, onClose, go }: { workId: bigint; plan: PlanView; caps: Caps; onClose: () => void; go: (to: string) => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<BlockKind>(BlockKind.stop);
  const [reason, setReason] = useState("");
  const add = usePlanMutation(workId, async () => {
    const f = inputToDay(from);
    const u = inputToDay(to || from);
    if (f === undefined || u === undefined) throw new Error(t.plan.blockFrom);
    return unwrap(await actor!.saveCalendarBlock({ scope: { __kind__: "work", work: workId }, kind, from: f, to: u, reason }));
  }, () => { setFrom(""); setTo(""); setReason(""); toast.show({ kind: "ok", text: `${t.common.saved} · ${t.plan.afterBlock}` }); });
  const del = usePlanMutation(workId, async (id: bigint) => unwrap(await actor!.archiveCalendarBlock(id)));
  const blocks = [...plan.blocks].sort((a, b) => N(a.from) - N(b.from));
  return (
    <Sheet side title={t.plan.calTitle} open onClose={onClose}>
      <p className="bw-muted">{t.plan.calLead}</p>
      {blocks.length === 0 ? <p className="a-empty">—</p> : (
        <ul className="a-list">
          {blocks.map((b) => (
            <li key={String(b.id)}>
              <span className="a-list__main">
                <b>{b.reason}</b>
                <span className="bw-num bw-muted">{fmtShort(b.from)}{b.to !== b.from ? ` – ${fmtShort(b.to)}` : ""} {new Date(Number(b.to) * 86_400_000).getUTCFullYear()} · {t.plan.blockKinds[b.kind]} · {b.scope.__kind__ === "company" ? t.plan.calCompany : t.plan.calWork}</span>
              </span>
              {b.scope.__kind__ !== "company" && plan.caps.edit && <Button variant="quiet" icon="close" iconOnly busy={del.isPending && del.variables === b.id} onClick={() => del.mutate(b.id)}>{t.common.close}</Button>}
            </li>
          ))}
        </ul>
      )}
      {caps.manageCompanyCalendar && <div><Button variant="quiet" icon="settings" onClick={() => go("beheer/bedrijf")}>{t.plan.settingsCal}</Button></div>}
      {plan.caps.edit && (
        <div className="a-form a-sub">
          <h3 className="bw-label">{t.plan.addBlock}</h3>
          <Choice label={t.plan.addBlock} value={kind} onChange={setKind} options={BLOCK_KINDS.map((k) => ({ value: k, label: t.plan.blockKinds[k] }))} />
          <div className="a-grid2">
            <Field label={t.plan.blockFrom}><input className="bw-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={t.plan.blockTo}><input className="bw-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label={t.plan.blockReason}><input className="bw-input" value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} /></Field>
          <div><Button icon="plus" disabled={!from || !reason.trim()} busy={add.isPending} onClick={() => add.mutate(undefined)}>{t.plan.addBlock}</Button></div>
        </div>
      )}
    </Sheet>
  );
}

// ── Samenvatting op de werfpagina ─────────────────────────────────────────

export function PlanSummary({ workId, go, noLink }: { workId: bigint; go: (to: string) => void; noLink?: boolean }) {
  const plan = usePlan(workId);
  const p = plan.data;
  const now = today();
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.plan.title}</h2>
        {!noLink && <Button variant="primary" icon="calendar" onClick={() => go(`werven/${workId}/planning`)}>{t.plan.open}</Button>}
      </div>
      <Loading q={plan} />
      {p && p.tasks.length === 0 && <p className="a-empty">{t.plan.empty}</p>}
      {p && p.tasks.length > 0 && (() => {
        const all = p.tasks.flatMap((x) => x.assignments);
        const open = all.filter((a) => a.confirmation.__kind__ === "open").length;
        const declined = all.filter((a) => a.confirmation.__kind__ === "declined").length;
        const warn = p.tasks.reduce((n, x) => n + x.warnings.length, 0);
        const next = p.tasks.filter((x) => N(x.end) >= now && x.status !== TaskStatus.done).sort((a, b) => N(a.start) - N(b.start)).slice(0, 4);
        return <>
          <div className="a-row">
            <span className="a-tag">{t.plan.summary(p.tasks.length)}</span>
            {p.start !== undefined && <span className="a-tag">{fmtShort(p.start)} – {fmtShort(p.end!)}</span>}
            {open > 0 && <span className="a-tag a-tag--accent">{t.plan.openConfirm(open)}</span>}
            {declined > 0 && <span className="a-tag a-tag--bad">{t.plan.declined(declined)}</span>}
            {warn > 0 && <span className="a-tag a-tag--warn">{t.plan.warnings(warn)}</span>}
          </div>
          {next.length > 0 && <>
            <span className="bw-label">{t.plan.next}</span>
            <TaskRows tasks={next} onOpen={() => { if (!noLink) go(`werven/${workId}/planning`); }} workId={workId} />
          </>}
        </>;
      })()}
    </section>
  );
}
