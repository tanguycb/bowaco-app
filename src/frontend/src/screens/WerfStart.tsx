// Offerte → werf (stap 2.8): het voorstel "Werf starten" uit een aanvaarde offerteversie. De backend rekent het voorstel
// (lib/WorkStart.mo, query: zonder bedragen) bij elke aanpassing opnieuw; bevestigen maakt de taken, de afhankelijkheden,
// de vergunningsvoorstellen, de aangifte en het contract (update, idempotent per offerteversie). Wie mag, zegt de backend
// (Rights.mo: admin of de werfleider van de werf); dit scherm toont nooit een bedrag.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Role, TaskKind, type Caps, type WorkStartGroup, type WorkStartInput, type WorkStartPending, type WorkStartPreview } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtTime, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { fmtDm, fmtShort, isoWeek, weekday } from "./planUtil";

const W = t.werfstart;
const N = Number;

const defaultInput = (): WorkStartInput => ({
  target: { __kind__: "existing", existing: null },
  startDay: 0n,
  templateKey: "",
  leaderPersonId: undefined,
  lineSteps: [],
  options: [],
  groupDays: [],
  skipPermits: [],
  declaration: true,
});

/** De voorstellen "Werf starten" (aanvaarde offertes zonder start): op de werf, het overzicht en Vandaag. */
export function PendingStarts({ workId, caps, go, compact }: { workId?: bigint; caps: Caps; go: (to: string) => void; compact?: boolean }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["pendingWorkStarts", workId === undefined ? "all" : String(workId)], queryFn: () => actor!.pendingWorkStarts(workId ?? null), enabled: !!actor && !isFetching && caps.workStarts, refetchOnWindowFocus: true });
  const list: WorkStartPending[] = q.data ?? [];
  if (!caps.workStarts || list.length === 0) return null;
  return (
    <section className={compact ? "ws-pending ws-pending--compact" : "a-section ws-pending"} aria-label={W.pendingTitle}>
      <div className="ws-pending__head">
        <Icon name="building" size={20} />
        <span className="a-list__main"><b>{W.pendingTitle}</b>{!compact && <span className="bw-muted">{W.pendingLead}</span>}</span>
      </div>
      <ul className="a-list">
        {list.map((p) => (
          <li key={String(p.versionId)}>
            <button type="button" className="a-list__btn" onClick={() => go(`werfstart/${p.versionId}`)}>
              <span className="a-tag">{p.workCode}</span>
              <span className="a-list__main">
                <b>{p.title}</b>
                <span className="bw-muted">{W.pendingItem(p.quoteNumber, String(p.version), p.acceptedHow)} · {fmtTime(p.acceptedAt)}{p.meerwerk ? ` · ${W.meerwerk}` : ""}</span>
              </span>
              <span className="a-tag a-tag--accent">{W.openShort}</span>
              <Icon name="next" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WerfStartPage({ versionId, caps, go }: { versionId: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const [input, setInput] = useState<WorkStartInput>(defaultInput);
  // Typen in een getal of de naam van een nieuwe werf: pas na een korte pauze opnieuw rekenen.
  const [asked, setAsked] = useState<WorkStartInput>(input);
  useEffect(() => { const h = window.setTimeout(() => setAsked(input), 350); return () => window.clearTimeout(h); }, [input]);
  const pv = useQuery({
    queryKey: ["workStart", String(versionId), JSON.stringify(asked)],
    queryFn: async () => unwrap(await actor!.workStartPreview(versionId, asked)),
    enabled: on,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && caps.readTeam });
  const [dismissing, setDismissing] = useState(false);
  const [why, setWhy] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const done = (r: { workId: bigint; workCode: string; tasks: bigint; already: boolean; status: string }) => {
    void qc.invalidateQueries();
    toast.show({ kind: "ok", text: r.already ? W.already : r.status === "afgewezen" ? W.dismissed : W.started(r.workCode, String(r.tasks)) });
  };
  const start = useMutation({
    mutationFn: async () => unwrap(await actor!.startWorkFromQuote(versionId, input, pv.data?.planVersion ?? 0n)),
    onSuccess: done,
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const dismiss = useMutation({
    mutationFn: async () => unwrap(await actor!.dismissWorkStart(versionId, why)),
    onSuccess: (r) => { setDismissing(false); done(r); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  const p = pv.data;
  if (!p) {
    return (
      <Page title={W.title} actions={<Button icon="back" onClick={() => history.back()}>{t.common.back}</Button>}>
        <Loading q={pv} />
        {pv.isLoading && <p className="bw-muted">{W.loadingPreview}</p>}
      </Page>
    );
  }
  const label = `${p.quoteNumber} v${String(p.version)} · ${p.sourceCode} ${p.sourceName}`;
  if (p.done) {
    const d = p.done;
    return (
      <Page label={label} title={W.title} actions={<Button icon="back" onClick={() => go(`werven/${p.sourceWorkId}`)}>{t.common.back}</Button>}>
        <div className="a-note" data-testid="ws-done">
          <p><b>{W.done(d.status, d.byName, fmtTime(d.at))}</b></p>
          {d.status === "gestart" ? <p>{W.doneCounts(String(d.tasks), String(d.linked), String(d.permits), d.declaration)}</p> : <p>{W.doneDismissed(d.note)}</p>}
        </div>
        {d.status === "gestart" && (
          <div className="a-row">
            <Button variant="primary" icon="calendar" onClick={() => go(`werven/${d.workId}/planning`)}>{W.toPlanning}</Button>
            <Button icon="building" onClick={() => go(`werven/${d.workId}`)}>{W.toWork} {d.workCode}</Button>
          </div>
        )}
      </Page>
    );
  }

  const set = (f: Partial<WorkStartInput>) => setInput((x) => ({ ...x, ...f }));
  const lineStep = (lineId: bigint) => input.lineSteps.find(([l]) => l === lineId)?.[1];
  const setLineStep = (lineId: bigint, v: string | null) => set({ lineSteps: [...input.lineSteps.filter(([l]) => l !== lineId), ...(v === null ? [] : [[lineId, v] as [bigint, string]])] });
  const setDays = (key: string, n: number) => set({ groupDays: [...input.groupDays.filter(([k]) => k !== key), [key, BigInt(Math.max(1, Math.min(400, Math.round(n) || 1)))]] });
  const toggleOption = (lineId: bigint, okd: boolean) => set({ options: okd ? [...input.options, lineId] : input.options.filter((x) => x !== lineId) });
  const togglePermit = (kind: string, inc: boolean) => set({ skipPermits: inc ? input.skipPermits.filter((k) => k !== kind) : [...input.skipPermits, kind] });
  const isNew = input.target.__kind__ === "newWork";
  const newWork = input.target.__kind__ === "newWork" ? input.target.newWork : { code: "", name: "", asSub: true };
  const setNew = (f: Partial<typeof newWork>) => set({ target: { __kind__: "newWork", newWork: { ...newWork, ...f } } });
  const leaders = (persons.data ?? []).filter((x) => x.roles.includes(Role.werfleider) && x.archivedAt === undefined);
  const stepName = new Map(p.steps.map(([k, v]) => [k, v]));
  const linesOf = (g: WorkStartGroup) => p.lines.filter((l) => l.group === g.key);
  const now = N(todayDay());
  const busy = pv.isFetching;

  return (
    <Page label={label} title={W.title} wide actions={<Button icon="back" onClick={() => go(`werven/${p.sourceWorkId}`)}>{t.common.back}</Button>}>
      {p.warnings.length > 0 && (
        <div className="ws-warn" role="status">
          <Icon name="alert" size={18} />
          <span className="a-list__main"><b>{W.warnings}</b>{p.warnings.map((w) => <span key={w}>{w}</span>)}</span>
        </div>
      )}
      {p.bases.length > 0 && <p className="a-note">{W.bases(p.bases.join(", "))}</p>}

      <section className="a-section">
        <h2 className="bw-h2">{W.secWork}</h2>
        {p.caps.newWork && (
          <Choice label={W.secWork} value={isNew ? "new" : "existing"} onChange={(v) => set({ target: v === "new" ? { __kind__: "newWork", newWork: { code: `${p.sourceCode}-B`, name: p.sourceName, asSub: true } } : { __kind__: "existing", existing: null } })}
            options={[{ value: "existing", label: `${W.targetExisting} (${p.sourceCode})` }, { value: "new", label: W.targetNew }]} />
        )}
        {isNew && (
          <div className="a-grid3">
            <label className="bw-field"><span className="bw-label">{W.newCode}</span><input className="bw-input bw-mono" value={newWork.code} onChange={(e) => setNew({ code: e.target.value })} /></label>
            <label className="bw-field"><span className="bw-label">{W.newName}</span><input className="bw-input" value={newWork.name} onChange={(e) => setNew({ name: e.target.value })} /></label>
            <label className="ws-check"><input type="checkbox" checked={newWork.asSub} onChange={(e) => setNew({ asSub: e.target.checked })} /> {W.newSub(p.sourceCode)}</label>
          </div>
        )}
        <dl className="a-dl">
          <dt>{W.client}</dt><dd>{p.clientName || t.common.none}</dd>
          <dt>{W.address}</dt><dd>{[p.address.street, p.address.number].filter(Boolean).join(" ")}{p.address.city ? `, ${p.address.zip} ${p.address.city}` : ""}</dd>
          <dt>{W.vat}</dt><dd>{N(p.vatBp) / 100} %{p.vatNote ? <span className="bw-muted"> · {p.vatNote}</span> : null}</dd>
          <dt>{W.leader}</dt>
          <dd>
            {p.caps.setLeader && leaders.length > 0 ? (
              <select className="bw-input ws-narrow" value={p.leaderPersonId !== undefined ? String(p.leaderPersonId) : ""} onChange={(e) => set({ leaderPersonId: e.target.value ? BigInt(e.target.value) : undefined })}>
                <option value="">{W.noLeader}</option>
                {leaders.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
              </select>
            ) : (<>{p.leaderName || <span className="a-tag a-tag--warn">{W.noLeader}</span>} {!p.caps.setLeader && <span className="bw-muted">· {W.leaderOnlyAdmin}</span>}</>)}
          </dd>
        </dl>
        <div className="a-grid2">
          <label className="bw-field"><span className="bw-label">{W.startDay}</span><input type="date" className="bw-input" value={dayToInput(p.startDay)} onChange={(e) => { const d = inputToDay(e.target.value); if (d !== undefined) set({ startDay: d }); }} /></label>
          <label className="bw-field"><span className="bw-label">{W.template}{p.templateProvisional ? ` · ${W.provisional}` : ""}</span>
            <select className="bw-input" value={p.templateKey} onChange={(e) => set({ templateKey: e.target.value })}>
              {p.templates.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="a-section">
        <div className="a-row a-row--between">
          <h2 className="bw-h2">{W.secPlan}</h2>
          {p.end !== undefined && <span className="bw-muted bw-num">{W.ganttEnd(fmtDayNum(p.end))}</span>}
        </div>
        <p className="bw-muted">{W.planLead}</p>
        <MiniGantt p={p} />
        {p.existingCount > BigInt(p.existing.length) && <p className="bw-muted">{W.existingOther(N(p.existingCount) - p.existing.length)}</p>}
        <div className="ws-table" role="table" aria-label={W.secPlan}>
          <div className="ws-row ws-row--head" role="row">
            <span role="columnheader">{W.colTask}</span><span role="columnheader">{W.colWho}</span><span role="columnheader">{W.colDays}</span><span role="columnheader">{W.colWhen}</span><span role="columnheader">{W.colAfter}</span>
          </div>
          {p.groups.map((g) => {
            const ls = linesOf(g);
            const editableDays = g.kind === TaskKind.work && g.existingTaskId === undefined;
            return (
              <div key={g.key} className="ws-group" role="rowgroup">
                <div className="ws-row" role="row">
                  <span className="a-list__main" role="cell" data-l={W.colTask}>
                    <b>{g.title}</b>
                    <span className="a-row">
                      {g.kind !== TaskKind.work && <span className="a-tag">{g.kind === TaskKind.milestone ? "mijlpaal" : "levering"}</span>}
                      {g.existingTaskId !== undefined && <span className="a-tag a-tag--accent">{W.existingTask}</span>}
                      {g.companion && <span className="a-tag">{W.companion}</span>}
                      {ls.length > 0 && <button type="button" className="wb-link" aria-expanded={open.has(g.key)} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>{W.posts(ls.length)} · {W.showPosts}</button>}
                    </span>
                  </span>
                  <span role="cell" data-l={W.colWho}>{[g.tradeName, g.orgName, ...g.extraOrgs].filter(Boolean).join(" · ") || "—"}</span>
                  <span role="cell" data-l={W.colDays} className="bw-num">
                    {editableDays ? (
                      <span className="a-row"><input className="bw-input ws-days bw-num" type="number" min={1} max={400} aria-label={`${W.colDays} ${g.title}`} value={N(input.groupDays.find(([k]) => k === g.key)?.[1] ?? g.workdays)} onChange={(e) => setDays(g.key, Number(e.target.value))} /><span className={`a-tag${g.daysFrom === "geschat" ? " a-tag--warn" : ""}`}>{W.daysFrom[g.daysFrom] ?? g.daysFrom}</span></span>
                    ) : <>{N(g.workdays)} <span className="a-tag">{W.daysFrom[g.daysFrom] ?? g.daysFrom}</span></>}
                  </span>
                  <span role="cell" data-l={W.colWhen} className="bw-num">{N(g.workdays) === 0 ? fmtShort(g.start) : `${fmtShort(g.start)} – ${fmtShort(g.end)}`}</span>
                  <span role="cell" data-l={W.colAfter} className="bw-muted">{g.after.join(", ") || "—"}</span>
                </div>
                {open.has(g.key) && (
                  <ul className="ws-lines">
                    {ls.map((l) => (
                      <li key={String(l.lineId)}>
                        <span className="a-list__main">
                          <span><span className="bw-mono">{l.code}</span> {l.title}{l.option && <span className="a-tag">optie</span>}</span>
                          <span className="bw-muted">{l.chapter} · {N(l.qtyMilli) / 1000} {l.unit}{l.days !== undefined ? ` · ${N(l.days)} d` : ""}{l.orgName ? ` · ${l.orgName}` : ""} · {W.howLabel[l.how] ?? l.how}</span>
                        </span>
                        <label className="ws-steppick"><span className="bw-label">{W.stepFor}</span>
                          <select className="bw-input" value={lineStep(l.lineId) ?? (l.group.startsWith("step:") ? l.group : "ch")} onChange={(e) => setLineStep(l.lineId, e.target.value)}>
                            {p.steps.map(([k, n]) => <option key={k} value={`step:${k}`}>{n}</option>)}
                            <option value="ch">{W.ownChapter}</option>
                            <option value="skip">{W.skipLine}</option>
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {(p.skipped.length > 0 || p.changed.length > 0 || p.removed.length > 0) && (
        <section className="a-section">
          {p.skipped.length > 0 && <>
            <h2 className="bw-h2">{W.secSkipped}</h2>
            <ul className="ws-notes">
              {p.skipped.map((s) => {
                const isOpt = /optie/.test(s.why);
                const chosen = lineStep(s.lineId) === "skip";
                return (
                  <li key={String(s.lineId)}>
                    <span className="a-list__main"><span><span className="bw-mono">{s.code}</span> {s.title}</span><span className="bw-muted">{s.why}</span></span>
                    {isOpt && <label className="ws-check"><input type="checkbox" checked={input.options.includes(s.lineId)} onChange={(e) => toggleOption(s.lineId, e.target.checked)} /> {W.optionOk}</label>}
                    {chosen && <Button variant="quiet" onClick={() => setLineStep(s.lineId, null)}>{W.undo}</Button>}
                  </li>
                );
              })}
              {input.options.filter((o) => !p.skipped.some((s) => s.lineId === o)).length > 0 && p.lines.filter((l) => l.option).map((l) => (
                <li key={`o${l.lineId}`}>
                  <span className="a-list__main"><span><span className="bw-mono">{l.code}</span> {l.title}</span><span className="bw-muted">{W.optionOk}</span></span>
                  <label className="ws-check"><input type="checkbox" checked onChange={() => toggleOption(l.lineId, false)} /> {W.optionOk}</label>
                </li>
              ))}
            </ul>
          </>}
          {p.changed.length > 0 && <><h3 className="bw-h3">{W.secChanged}</h3><ul className="ws-notes">{p.changed.map((s) => <li key={String(s.lineId)}><span className="a-list__main"><span><span className="bw-mono">{s.code}</span> {s.title}</span><span className="bw-muted">{s.why}</span></span></li>)}</ul></>}
          {p.removed.length > 0 && <><h3 className="bw-h3">{W.secRemoved}</h3><ul className="ws-notes">{p.removed.map((s) => <li key={String(s.lineId)}><span className="a-list__main"><span><span className="bw-mono">{s.code}</span> {s.title}</span><span className="bw-muted">{s.why}</span></span></li>)}</ul></>}
        </section>
      )}

      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{W.secPermits}</h2>
          <p className="bw-muted">{W.permitsLead}</p>
          {p.permits.length === 0 && <p className="a-empty">{W.permitsNone}</p>}
          <ul className="ws-notes">
            {p.permits.map((x) => {
              const late = x.deadline !== undefined && N(x.deadline) <= now;
              return (
                <li key={x.kind}>
                  <span className="a-list__main">
                    <b>{x.kindName}</b>
                    <span className="bw-muted">{W.permitFor(x.groups.join(", "))} · {x.reason}</span>
                    <span className="bw-num">{x.from !== undefined ? `${fmtDm(x.from)} – ${fmtDm(x.to ?? x.from)}` : "—"} · {W.permitLead(String(x.leadDays))} · {W.permitDeadline} <b>{fmtDayNum(x.deadline)}</b>{late && <span className="a-tag a-tag--bad">{W.permitLate}</span>}{x.municipality ? ` · ${x.municipality}` : ""}</span>
                  </span>
                  {x.exists ? <span className="a-tag">{W.permitExists}</span> : <label className="ws-check"><input type="checkbox" checked={!input.skipPermits.includes(x.kind)} onChange={(e) => togglePermit(x.kind, e.target.checked)} /> {W.permitInclude}</label>}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="a-section">
          <h2 className="bw-h2">{W.secAdmin}</h2>
          <p><b>{W.art30bis}</b> <NeedTag v={p.art30bis} /><br /><span className="bw-muted">{p.art30bisReason}{/onderaannemer/.test(p.art30bisReason) ? "" : ` · ${W.oaCount(String(p.oaCount))}`}</span></p>
          <p><b>{W.ciaw}</b> <NeedTag v={p.checkinatwork} /></p>
          {p.art30bis === true && (p.declarationExists ? <p className="bw-muted">{W.declExists}</p> : <label className="ws-check"><input type="checkbox" checked={input.declaration} onChange={(e) => set({ declaration: e.target.checked })} /> {W.declare}</label>)}
          <p className="bw-muted">{W.amountNote}</p>
        </section>
      </div>

      <div className="ws-foot">
        <Button variant="primary" icon="check" busy={start.isPending} disabled={busy || p.groups.length === 0 && p.permits.length === 0} onClick={() => start.mutate()}>{W.confirm}</Button>
        <Button variant="quiet" onClick={() => setDismissing(true)}>{W.dismiss}</Button>
      </div>

      {dismissing && (
        <Sheet title={W.dismissTitle} open onClose={() => setDismissing(false)} side footer={<><Button onClick={() => setDismissing(false)}>{t.common.cancel}</Button><Button variant="danger" busy={dismiss.isPending} disabled={why.trim().length < 5} onClick={() => dismiss.mutate()}>{W.dismissDo}</Button></>}>
          <p className="bw-muted">{W.dismissLead}</p>
          <label className="bw-field"><span className="bw-label">{W.dismissReason}</span><textarea className="bw-input" rows={3} maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} /></label>
        </Sheet>
      )}
    </Page>
  );
}

function NeedTag({ v }: { v?: boolean }) {
  if (v === undefined) return <span className="a-tag a-tag--warn">{W.unknown}</span>;
  return v ? <span className="a-tag a-tag--accent">{W.yes}</span> : <span className="a-tag">{W.no}</span>;
}

/** Gantt-voorvertoning van het voorstel: de nieuwe taken (zwart), bestaande taken waarop gewacht wordt of die aangevuld worden (grijs). */
function MiniGantt({ p }: { p: WorkStartPreview }) {
  const rows = useMemo(() => {
    const linked = new Set(p.groups.map((g) => (g.existingTaskId !== undefined ? String(g.existingTaskId) : "")));
    const ctx = p.existing.filter((e) => !linked.has(String(e.id))).map((e) => ({ key: `e${e.id}`, title: e.title, start: N(e.start), end: N(e.end), kind: e.kind, ghost: true }));
    const gs = p.groups.map((g) => ({ key: g.key, title: g.title, start: N(g.start), end: N(g.end), kind: g.kind, ghost: g.existingTaskId !== undefined }));
    return [...ctx, ...gs];
  }, [p]);
  // De schaal past zich aan de breedte aan (4–16 px per dag); daarboven scrolt enkel dit vak zijwaarts.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  if (rows.length === 0) return null;
  const first = Math.min(...rows.map((r) => r.start));
  const last = Math.max(...rows.map((r) => r.end));
  const origin = first - weekday(first);
  const endDay = last - weekday(last) + 6;
  const days = endDay - origin + 1;
  const px = Math.max(4, Math.min(16, Math.floor((width - 224) / days)));
  const weeks: number[] = [];
  for (let d = origin; d <= endDay; d += 7) weeks.push(d);
  const kindClass = (k: TaskKind) => (k === TaskKind.milestone ? " ws-bar--ms" : k === TaskKind.delivery ? " ws-bar--dl" : "");
  return (
    <div className="ws-gantt" aria-label={W.gantt} ref={box}>
      <div className="ws-gantt__inner" style={{ width: 220 + days * px }}>
        <div className="ws-gantt__head" style={{ marginLeft: 220 }}>
          {weeks.map((m) => <span key={m} style={{ width: 7 * px }} className="bw-mono">{px >= 16 ? `wk ${isoWeek(m).week} · ${fmtDm(m)}` : px >= 8 ? `wk ${isoWeek(m).week}` : isoWeek(m).week}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="ws-gantt__row">
            <span className="ws-gantt__label" title={r.title}>{r.title}</span>
            <span className="ws-gantt__track" style={{ width: days * px, backgroundSize: `${7 * px}px 100%` }}>
              <span className={`ws-bar${r.ghost ? " ws-bar--ghost" : ""}${kindClass(r.kind)}`} style={{ left: (r.start - origin) * px, width: r.kind === TaskKind.work ? Math.max(px, (r.end - r.start + 1) * px) : 12 }} title={`${r.title}: ${fmtShort(r.start)}${r.end !== r.start ? ` – ${fmtShort(r.end)}` : ""}`} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
