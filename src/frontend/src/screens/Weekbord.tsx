// Weekbord per OA (stap 1.4, bouwplan §8.4): rijen = firma's, kolommen = weken (of de dagen van één week),
// cel = de werven met de taken van die week. Conflicten (dubbel, afwezig, blokkering) in rood met het werflint;
// afwezigheden per firma; doorklikken naar de taak in de planning. Alleen-lezen: verplaatsen gebeurt in de Gantt
// (met de voorvertoning van 1.3). Wat iemand ziet en mag, zegt de backend (Rights.mo, BoardView.caps).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AbsenceKind, AbsenceSource, OrgKind, TaskKind,
  type AbsenceView, type BoardItem, type BoardRow, type BoardTask, type BoardView, type BoardWeek, type Caps, type ConflictView,
} from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, StatusBadge, useToast, type Status } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtTime, inputToDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page } from "./common";
import { useMedia } from "./Planning";
import { Field } from "./Werven";
import { ShareSheet } from "./Extern";
import { fmtDm, fmtShort, isoWeek, today, weekday } from "./planUtil";

const N = Number;
const WD = ["ma", "di", "wo", "do", "vr"];
const thisMonday = () => today() - weekday(today());

/** Parameters uit de hash: #/weekbord?w=20760&org=5 (vanaf "Vraagt aandacht" of de werfpagina). */
function hashParam(k: string): string | null {
  const m = window.location.hash.match(new RegExp(`[?&]${k}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

const confIcon = (ts: BoardTask[]): { icon: "check" | "close" | "clock"; word: string } => {
  if (ts.some((x) => x.confirmation.__kind__ === "declined")) return { icon: "close", word: t.plan.conf.declined };
  if (ts.length > 0 && ts.every((x) => x.confirmation.__kind__ === "confirmed")) return { icon: "check", word: t.plan.conf.confirmed };
  return { icon: "clock", word: t.plan.conf.open };
};

const daysOfItem = (it: BoardItem) => new Set(it.tasks.flatMap((x) => x.days.map(N)));
const absentOn = (row: BoardRow, d: number) => row.absences.some((a) => a.personId === undefined && d >= N(a.from) && d <= N(a.to));

// ── Pagina ────────────────────────────────────────────────────────────────

export function Weekbord({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const wide = useMedia("(min-width: 900px)");
  const [from, setFrom] = useState(() => { const w = hashParam("w"); return w && /^\d+$/.test(w) ? N(w) - weekday(N(w)) : thisMonday(); });
  const [zoom, setZoom] = useState<"weeks" | "days">("weeks");
  const [text, setText] = useState("");
  const [trade, setTrade] = useState("");
  const [show, setShow] = useState<"busy" | "conflicts" | "all">("busy");
  const [offset, setOffset] = useState(0);
  const [item, setItem] = useState<{ row: BoardRow; item: BoardItem; week: number } | null>(null);
  const [orgSel, setOrgSel] = useState<bigint | null>(() => { const o = hashParam("org"); return o && /^\d+$/.test(o) ? BigInt(o) : null; });
  const [rules, setRules] = useState(false);
  const [list, setList] = useState(false);
  const weeks = !wide ? 1 : zoom === "weeks" ? 6 : 1;
  const limit = 50;
  useEffect(() => setOffset(0), [text, trade, show, from, weeks]);

  const board = useQuery({
    queryKey: ["board", from, weeks, offset, text, trade, show],
    queryFn: () => actor!.weekBoard({ from: BigInt(from), weeks: BigInt(weeks), offset: BigInt(offset), limit: BigInt(limit), text: text.trim(), trade: trade || undefined, workId: undefined, onlyConflicts: show === "conflicts", withIdle: show === "all" }),
    enabled: on,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
  const trades = useQuery({ queryKey: ["trades", false], queryFn: () => actor!.listTrades(false), enabled: on });
  const tradeName = (k: string) => trades.data?.find((x) => x.key === k)?.name ?? k;
  const b = board.data;
  const stale = board.isPlaceholderData;
  const shownFrom = b ? N(b.from) : from;
  const shownWeeks = b ? b.weeks.length : weeks;
  const fw = isoWeek(shownFrom);
  const lw = isoWeek(shownFrom + 7 * (shownWeeks - 1));
  const title = fw.year === lw.year ? t.board.weeksRange(fw.week, lw.week) : t.board.weeksRangeYears(fw.week, fw.year, lw.week, lw.year);
  const allConflicts = (b?.rows ?? []).flatMap((r) => r.conflicts);
  const selRow = b?.rows.find((r) => r.orgId === orgSel) ?? null;

  const step = wide ? weeks * 7 : 7;
  return (
    <Page label={t.board.title} title={title} actions={<>
      <Button iconOnly icon="back" onClick={() => setFrom(from - step)}>{t.board.prev}</Button>
      <Button disabled={from === thisMonday()} onClick={() => setFrom(thisMonday())}>{t.board.now}</Button>
      <Button iconOnly icon="next" onClick={() => setFrom(from + step)}>{t.board.next}</Button>
      <Button icon="settings" onClick={() => setRules(true)}>{t.board.rules}</Button>
    </>}>
      <p className="bw-muted">{wide ? t.board.lead : t.board.mobileLead}</p>
      {!wide && (
        <Choice label={t.board.zoom} value={from === thisMonday() + 7 ? "next" : "now"} onChange={(v) => setFrom(thisMonday() + (v === "next" ? 7 : 0))} fill options={[{ value: "now", label: t.board.mobileWeek.now }, { value: "next", label: t.board.mobileWeek.next }]} />
      )}
      <div className="a-row a-row--wrap wb-filters">
        {wide && <Choice label={t.board.zoom} value={zoom} onChange={setZoom} options={[{ value: "weeks", label: t.board.zoomWeeks }, { value: "days", label: t.board.zoomDays }]} />}
        <input className="bw-input wb-search" type="search" placeholder={t.board.search} value={text} onChange={(e) => setText(e.target.value)} aria-label={t.board.search} />
        <select className="bw-input wb-trade" value={trade} onChange={(e) => setTrade(e.target.value)} aria-label={t.board.trade}>
          <option value="">{t.board.allTrades}</option>
          {(trades.data ?? []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        <Choice label={t.board.show} value={show} onChange={setShow} options={[{ value: "busy", label: t.board.showBusy }, { value: "conflicts", label: t.board.showConflicts }, { value: "all", label: t.board.showAll }]} />
      </div>
      <Loading q={board} />
      {b && (
        <div className={`a-stack${stale ? " wb-stale" : ""}`} aria-busy={stale}>
          {N(b.conflictTotal) > 0 ? (
            <div className="a-alert" role="alert">
              <Icon name="alert" size={20} />
              <span className="wb-grow"><b>{t.board.conflicts(N(b.conflictTotal))}</b> {t.board.inWeeks(b.weeks.length)}{allConflicts.length > 0 && <> · <button type="button" className="wb-link" onClick={() => setList(!list)}>{list ? t.board.hideList : t.board.showList}</button></>}</span>
            </div>
          ) : (
            <p className="bw-muted">{t.board.conflictsNone}</p>
          )}
          {list && <ConflictList items={allConflicts} go={go} onPick={(c) => setOrgSel(c.orgId)} />}
          <Legend />
          {b.rows.length === 0 ? (
            (show === "busy" && !text.trim() && !trade ? <EmptyState title={t.leeg.planning.t} text={t.leeg.planning.d} action={<Button onClick={() => go(caps.importPlan ? "beheer/planning" : "werven/lopend")}>{caps.importPlan ? t.leeg.werven.import : t.nav.werven}</Button>} /> : <p className="a-empty">{show === "conflicts" ? t.board.noRowsConflicts : t.board.noRows}</p>)
          ) : wide && zoom === "weeks" ? (
            <WeeksGrid b={b} onItem={(row, it, week) => setItem({ row, item: it, week })} onOrg={(r) => setOrgSel(r.orgId)} />
          ) : wide ? (
            <DaysGrid b={b} onItem={(row, it) => setItem({ row, item: it, week: 0 })} onOrg={(r) => setOrgSel(r.orgId)} />
          ) : (
            <MobileList b={b} onItem={(row, it) => setItem({ row, item: it, week: 0 })} onOrg={(r) => setOrgSel(r.orgId)} />
          )}
          {N(b.total) > limit && (
            <div className="a-row">
              <Button iconOnly icon="back" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>{t.board.prev}</Button>
              <span className="bw-num">{t.board.page(offset + 1, Math.min(offset + limit, N(b.total)), N(b.total))}</span>
              <Button iconOnly icon="next" disabled={offset + limit >= N(b.total)} onClick={() => setOffset(offset + limit)}>{t.board.next}</Button>
            </div>
          )}
          <p className="bw-muted bw-num wb-cost">{t.board.cost((N(b.instructions) / 1e6).toFixed(0))}</p>
        </div>
      )}
      {item && b && <ItemSheet b={b} sel={item} go={go} onClose={() => setItem(null)} onOrg={() => { setOrgSel(item.row.orgId); setItem(null); }} />}
      {orgSel !== null && b && <OrgSheet orgId={orgSel} row={selRow} b={b} caps={caps} tradeName={tradeName} onClose={() => setOrgSel(null)} go={go} />}
      {rules && <RulesSheet caps={caps} onClose={() => setRules(false)} />}
    </Page>
  );
}

function Legend() {
  return (
    <div className="wb-legend">
      <span><span className="wb-chip wb-chip--clash wb-chip--mini" />{t.board.legendClash}</span>
      <span><span className="wb-absent wb-chip--mini" />{t.board.legendAbsent}</span>
      <span><span className="wb-hatch wb-chip--mini" />{t.board.legendBlocked}</span>
      {(["check", "clock", "close"] as const).map((i, k) => <span key={i}><Icon name={i} size={16} />{[t.plan.conf.confirmed, t.plan.conf.open, t.plan.conf.declined][k]}</span>)}
    </div>
  );
}

function OaCell({ row, onOrg }: { row: BoardRow; onOrg: (r: BoardRow) => void }) {
  const n = row.conflicts.length;
  return (
    <button type="button" className="wb-oa" onClick={() => onOrg(row)}>
      <b>{row.code ?? row.name}</b>
      <span className="bw-muted">{row.code ? row.name : t.board.max(N(row.maxWorks))}</span>
      {n > 0 && <span className="a-tag a-tag--bad" title={t.board.conflicts(n)}><Icon name="alert" size={14} /> {n}</span>}
    </button>
  );
}

function WeekHead({ w, label }: { w: BoardWeek; label: string }) {
  const now = thisMonday() === N(w.monday);
  return (
    <div className={`wb-head${now ? " wb-head--today" : ""}${w.blocks.length ? " wb-hatch" : ""}`} title={w.blocks.map((x) => x.reason).join(", ")}>
      <span className="bw-label">{label}</span>
      <span className="bw-num">{fmtDm(w.monday)}</span>
      {w.blocks.length > 0 && <span className="wb-head__block">{w.blocks[0].reason}</span>}
    </div>
  );
}

function Chip({ it, monday: m0, onClick, clashDay }: { it: BoardItem; monday: number; onClick: () => void; clashDay?: boolean }) {
  const days = daysOfItem(it);
  const ci = confIcon(it.tasks);
  const clash = clashDay ?? it.clash;
  return (
    <button type="button" className={`wb-chip${clash ? " wb-chip--clash" : ""}${it.hidden ? " wb-chip--hidden" : ""}${ci.icon === "close" ? " wb-chip--no" : ""}`} onClick={onClick}>
      <span className="wb-chip__werf">{it.hidden ? t.board.hidden : it.workCode}</span>
      <span className="wb-chip__conf"><Icon name={clash ? "alert" : ci.icon} size={14} label={clash ? t.board.legendClash : ci.word} /></span>
      {!it.hidden && <span className="wb-chip__task">{it.tasks[0]?.title}{it.tasks.length > 1 ? ` +${it.tasks.length - 1}` : ""}</span>}
      <span className="wb-dots" aria-label={WD.filter((_, i) => days.has(m0 + i)).join(" ")}>
        {WD.map((d, i) => <span key={d} className={days.has(m0 + i) ? "on" : ""} title={d} />)}
      </span>
    </button>
  );
}

function WeeksGrid({ b, onItem, onOrg }: { b: BoardView; onItem: (r: BoardRow, it: BoardItem, week: number) => void; onOrg: (r: BoardRow) => void }) {
  const cols = `200px repeat(${b.weeks.length}, minmax(150px, 1fr))`;
  return (
    <div className="wb-wrap">
      <div className="wb-grid" role="grid" style={{ gridTemplateColumns: cols, minWidth: 200 + 150 * b.weeks.length }}>
        <div className="wb-corner bw-label">{t.board.oa}</div>
        {b.weeks.map((w) => <WeekHead key={String(w.monday)} w={w} label={t.plan.week(isoWeek(N(w.monday)).week)} />)}
        {b.rows.map((r) => (
          <div key={String(r.orgId)} className="wb-row" role="row">
            <OaCell row={r} onOrg={onOrg} />
            {b.weeks.map((w, i) => {
              const cell = r.cells.find((c) => N(c.week) === i);
              const m = N(w.monday);
              const abs = r.absences.filter((a) => N(a.to) >= m && N(a.from) <= m + 6);
              return (
                <div key={i} className={`wb-cell${thisMonday() === m ? " wb-cell--today" : ""}`} role="gridcell">
                  {abs.map((a) => <button type="button" key={String(a.id)} className="wb-absent" onClick={() => onOrg(r)}>{t.absence.kinds[a.kind]}{a.personName ? ` · ${a.personName}` : ""} {fmtDm(a.from)}–{fmtDm(a.to)}</button>)}
                  {cell?.items.map((it, k) => <Chip key={k} it={it} monday={m} onClick={() => onItem(r, it, i)} />)}
                  {!cell && abs.length === 0 && <span className="wb-free">{t.board.free}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DaysGrid({ b, onItem, onOrg }: { b: BoardView; onItem: (r: BoardRow, it: BoardItem) => void; onOrg: (r: BoardRow) => void }) {
  const m = N(b.from);
  const blocked = (d: number) => b.weeks[0]?.blocks.some((x) => d >= N(x.from) && d <= N(x.to));
  return (
    <div className="wb-wrap">
      <div className="wb-grid" role="grid" style={{ gridTemplateColumns: "200px repeat(5, minmax(130px, 1fr))", minWidth: 850 }}>
        <div className="wb-corner bw-label">{t.board.oa}</div>
        {WD.map((d, i) => (
          <div key={d} className={`wb-head${today() === m + i ? " wb-head--today" : ""}${blocked(m + i) ? " wb-hatch" : ""}`}>
            <span className="bw-label">{d}</span><span className="bw-num">{fmtDm(m + i)}</span>
          </div>
        ))}
        {b.rows.map((r) => {
          const items = r.cells.find((c) => N(c.week) === 0)?.items ?? [];
          const clashDays = new Set(r.conflicts.filter((c) => c.kind === "dubbel").flatMap((c) => c.days.map(N)));
          return (
            <div key={String(r.orgId)} className="wb-row" role="row">
              <OaCell row={r} onOrg={onOrg} />
              {WD.map((d, i) => {
                const day = m + i;
                const here = items.filter((it) => daysOfItem(it).has(day));
                return (
                  <div key={d} className={`wb-cell${today() === day ? " wb-cell--today" : ""}${absentOn(r, day) ? " wb-cell--absent" : ""}`} role="gridcell">
                    {absentOn(r, day) && <span className="wb-absent">{t.board.legendAbsent}</span>}
                    {here.map((it, k) => <Chip key={k} it={it} monday={m} clashDay={it.clash && clashDays.has(day)} onClick={() => onItem(r, it)} />)}
                    {here.length === 0 && !absentOn(r, day) && <span className="wb-free">{t.board.free}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Gsm: per firma een kaart met de werven van de gekozen week, per dag. */
function MobileList({ b, onItem, onOrg }: { b: BoardView; onItem: (r: BoardRow, it: BoardItem) => void; onOrg: (r: BoardRow) => void }) {
  const m = N(b.from);
  return (
    <ul className="a-list">
      {b.rows.map((r) => {
        const items = r.cells.find((c) => N(c.week) === 0)?.items ?? [];
        return (
          <li key={String(r.orgId)} className="wb-mrow">
            <button type="button" className="wb-mrow__head" onClick={() => onOrg(r)}>
              <b className="bw-mono">{r.code ?? r.name}</b>
              <span className="bw-muted">{r.code ? r.name : ""}</span>
              {r.conflicts.length > 0 && <span className="a-tag a-tag--bad">{t.board.kinds[r.conflicts[0].kind]}{r.conflicts.length > 1 ? ` +${r.conflicts.length - 1}` : ""}</span>}
            </button>
            {r.absences.map((a) => <span key={String(a.id)} className="wb-absent">{t.absence.kinds[a.kind]} {fmtDm(a.from)}–{fmtDm(a.to)}</span>)}
            {items.length === 0 && <span className="wb-free">{t.board.free}</span>}
            {items.map((it, k) => {
              const days = daysOfItem(it);
              return (
                <button key={k} type="button" className={`wb-mitem${it.clash ? " wb-chip--clash" : ""}`} onClick={() => onItem(r, it)}>
                  <span className="bw-mono"><b>{it.hidden ? t.board.hidden : it.workCode}</b></span>
                  <span className="wb-mitem__main">{it.hidden ? "" : `${it.workName} · ${it.tasks.map((x) => x.title).join(", ")}`}</span>
                  <span className="wb-mdays">{WD.map((d, i) => <span key={d} className={days.has(m + i) ? "on" : ""}>{d}</span>)}</span>
                </button>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

// ── Detail van een werf in een cel ─────────────────────────────────────────

function ItemSheet({ b, sel, go, onClose, onOrg }: { b: BoardView; sel: { row: BoardRow; item: BoardItem; week: number }; go: (to: string) => void; onClose: () => void; onOrg: () => void }) {
  const { row, item, week } = sel;
  const monday = N(b.weeks[week]?.monday ?? b.from);
  const conflicts = row.conflicts.filter((c) => N(c.week) === monday && (item.hidden ? c.works.some(([w]) => w === null) : c.works.some(([w]) => w === item.workId)));
  return (
    <Sheet side title={`${row.code ?? row.name} · ${item.hidden ? t.board.hidden : item.workCode}`} open onClose={onClose} footer={<>
      <Button onClick={onOrg}>{t.board.oaSheet}</Button>
      {!item.hidden && item.workId !== undefined && <Button onClick={() => go(`werven/${item.workId}`)}>{t.board.openWork}</Button>}
    </>}>
      {item.hidden ? <p className="bw-muted">{t.board.hiddenLead}</p> : <p><b>{item.workName}</b> <span className="bw-muted">· {t.plan.week(isoWeek(monday).week)}</span></p>}
      {conflicts.map((c, i) => <div key={i} className="a-alert"><Icon name="alert" size={18} /><span>{c.text}</span></div>)}
      <ul className="a-list">
        {item.tasks.map((x, i) => (
          <li key={i} className="wb-task">
            <span className="a-list__main">
              {!item.hidden && <b>{x.title}</b>}
              <span className="bw-num">{t.board.days}: {x.days.map((d) => fmtShort(d)).join(", ") || "—"}</span>
              <span className="bw-muted bw-num">{t.board.whole}: {fmtShort(x.start)}{x.end !== x.start ? ` – ${fmtShort(x.end)}` : ""}{x.personName ? ` · ${x.personName}` : ""}{x.note ? ` · ${x.note}` : ""}</span>
            </span>
            {!item.hidden && (
              <span className="a-row">
                {x.kind === TaskKind.work && <StatusBadge status={x.status as unknown as Status} small />}
                <span className={`a-tag${x.confirmation.__kind__ === "confirmed" ? " a-tag--ok" : x.confirmation.__kind__ === "declined" ? " a-tag--bad" : ""}`}>{t.plan.conf[x.confirmation.__kind__]}</span>
                {item.workId !== undefined && <Button variant="quiet" icon="next" onClick={() => go(`werven/${item.workId}/planning?taak=${x.taskId}`)}>{t.board.openPlanning}</Button>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ── Firma: regel, conflicten, afwezigheden ────────────────────────────────

function OrgSheet({ orgId, row, b, caps, tradeName, onClose, go }: { orgId: bigint; row: BoardRow | null; b: BoardView; caps: Caps; tradeName: (k: string) => string; onClose: () => void; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const oa = useQuery({ queryKey: ["oa", String(orgId)], queryFn: async () => unwrap(await actor!.getOa(orgId)), enabled: !!actor && !isFetching });
  const name = row?.name ?? oa.data?.org.name ?? "…";
  const persons = (oa.data?.persons ?? []).filter((p) => p.archivedAt === undefined).map((p) => ({ id: p.id, name: p.name }));
  const [sharing, setSharing] = useState(false);
  return (
    <Sheet side wide title={`${row?.code ? `${row.code} · ` : ""}${name}`} open onClose={onClose}>
      {/* 1.7: deel-knop weekplanning per OA (PDF of beeld) */}
      <div><Button icon="share" onClick={() => setSharing(true)}>{t.extern.shareRow}</Button></div>
      {sharing && <ShareSheet base={{ orgName: name, orgCode: row?.code, appUrl: window.location.origin }} row={row} monday={N(b.from)} weeks={b.weeks.length} onClose={() => setSharing(false)} />}
      {row && (
        <p className="bw-muted">
          {row.trades.map(tradeName).join(", ")}{row.trades.length ? " · " : ""}{t.board.max(N(row.maxWorks))} ({t.board.maxFrom[row.maxFrom] ?? row.maxFrom})
        </p>
      )}
      {row && row.conflicts.length > 0 && <ConflictList items={row.conflicts} go={go} />}
      <AbsencePanel orgId={orgId} from={N(b.from)} canEdit={b.caps.manageAbsences} persons={persons} />
      {caps.readOa && <div><Button variant="quiet" icon="building" onClick={() => go(`adresboek/${orgId}`)}>{t.board.oaFiche}</Button></div>}
    </Sheet>
  );
}

/** Afwezigheden van één firma (kantoor of de OA zelf): lijst, toevoegen, wijzigen, weghalen, geschiedenis. */
export function AbsencePanel({ orgId, from, canEdit, persons, own }: { orgId: bigint; from: number; canEdit: boolean; persons: { id: bigint; name: string }[]; own?: boolean }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const span = 7 * 26;
  const list = useQuery({ queryKey: ["absences", String(orgId), from], queryFn: () => actor!.listAbsences(orgId, BigInt(from - 28), BigInt(from + span)), enabled: on });
  const hist = useQuery({ queryKey: ["absHist", String(orgId)], queryFn: () => actor!.absenceHistory(orgId, 0n, 20n), enabled: on });
  const [edit, setEdit] = useState<AbsenceView | "new" | null>(null);
  const [showHist, setShowHist] = useState(false);
  const mayEdit = (a: AbsenceView) => canEdit && (!own || a.mine);
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.absence.title}</h2>
        {canEdit && <Button icon="plus" onClick={() => setEdit("new")}>{own ? t.absence.report : t.absence.add}</Button>}
      </div>
      <p className="bw-muted">{t.absence.lead}</p>
      <Loading q={list} />
      {list.data && list.data.length === 0 && <p className="a-empty">{t.absence.none}</p>}
      {list.data && list.data.length > 0 && (
        <ul className="a-list">
          {list.data.map((a) => (
            <li key={String(a.id)}>
              <span className="a-list__main">
                <b>{t.absence.kinds[a.kind]}{a.personName ? ` · ${a.personName}` : ` · ${t.absence.wholeFirm}`}</b>
                <span className="bw-num">{fmtShort(a.from)} – {fmtShort(a.to)}</span>
                <span className="bw-muted">{a.source === AbsenceSource.oa ? t.absence.byOa : t.absence.byOffice} · {a.updatedByName}{a.note ? ` · ${a.note}` : ""}</span>
              </span>
              {mayEdit(a) ? <Button variant="quiet" icon="edit" onClick={() => setEdit(a)}>{t.absence.change}</Button> : own && <span className="bw-muted">{t.absence.readOnlyOffice}</span>}
            </li>
          ))}
        </ul>
      )}
      <div><Button variant="quiet" onClick={() => setShowHist(!showHist)}>{t.absence.history}</Button></div>
      {showHist && (hist.data?.length ? (
        <ul className="a-list">
          {hist.data.map((h) => <li key={String(h.id)}><span className="a-list__main"><span>{h.what}: {h.detail}</span><span className="bw-muted bw-num">{fmtTime(h.at)} · {h.byName}</span></span></li>)}
        </ul>
      ) : <p className="a-empty">{t.absence.historyNone}</p>)}
      {edit !== null && <AbsenceSheet orgId={orgId} current={edit === "new" ? null : edit} persons={persons} own={own} from={from} onClose={() => setEdit(null)} />}
    </section>
  );
}

function AbsenceSheet({ orgId, current, persons, own, from: shown, onClose }: { orgId: bigint; current: AbsenceView | null; persons: { id: bigint; name: string }[]; own?: boolean; from: number; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  // Nieuw: de week die op het weekbord in beeld is (of volgende week als die al voorbij is).
  const start = Math.max(shown, thisMonday() + 7);
  const [kind, setKind] = useState<AbsenceKind>(current?.kind ?? AbsenceKind.verlof);
  const [who, setWho] = useState(current?.personId !== undefined ? String(current.personId) : "");
  const [from, setFrom] = useState(dayToInput(current ? current.from : BigInt(start)));
  const [to, setTo] = useState(dayToInput(current ? current.to : BigInt(start + 4)));
  const [note, setNote] = useState(current?.note ?? "");
  const [remove, setRemove] = useState(false);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["absences"] });
    void qc.invalidateQueries({ queryKey: ["absHist"] });
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["myBoard"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const f = inputToDay(from);
      const u = inputToDay(to);
      if (f === undefined || u === undefined) throw new Error(t.absence.from);
      return unwrap(await actor!.saveAbsence({ id: current?.id, orgId, personId: who ? BigInt(who) : undefined, kind, from: f, to: u, note }));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.absence.saved }); done(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const del = useMutation({
    mutationFn: async () => unwrap(await actor!.archiveAbsence(current!.id)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); done(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <>
      <Sheet side title={current ? t.absence.edit : own ? t.absence.report : t.absence.add} open onClose={onClose} footer={<>
        {current && <Button variant="danger" onClick={() => setRemove(true)}>{t.absence.remove}</Button>}
        <Button onClick={onClose}>{t.common.cancel}</Button>
        <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>
      </>}>
        <Choice label={t.absence.kind} value={kind} onChange={setKind} fill options={[AbsenceKind.verlof, AbsenceKind.ziekte, AbsenceKind.andere].map((k) => ({ value: k, label: t.absence.kinds[k] }))} />
        <Field label={t.absence.who}>
          <select className="bw-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{t.absence.wholeFirm}</option>
            {persons.map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
          </select>
        </Field>
        <div className="a-row">
          <Field label={t.absence.from}><input className="bw-input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label={t.absence.to}><input className="bw-input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label={t.absence.note}><input className="bw-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <span className="bw-muted">{t.absence.noteHelp}</span>
      </Sheet>
      <Confirm open={remove} title={t.absence.remove} text={t.absence.removeText} confirmLabel={t.absence.remove} busy={del.isPending} onConfirm={() => del.mutate()} onClose={() => setRemove(false)} />
    </>
  );
}

// ── Conflicten als lijst (weekbord, firma, werfpagina, Vraagt aandacht) ─────

export function ConflictList({ items, go, onPick, limit }: { items: ConflictView[]; go: (to: string) => void; onPick?: (c: ConflictView) => void; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="a-list">
      {shown.map((c, i) => (
        <li key={i}>
          <button type="button" className="a-list__btn" onClick={() => (onPick ? onPick(c) : go(`weekbord?w=${c.week}&org=${c.orgId}`))}>
            <span className={`a-tag ${c.kind === "dubbel" ? "a-tag--bad" : "a-tag--warn"}`}>{t.board.kinds[c.kind] ?? c.kind}</span>
            <span className="a-list__main">
              <span>{c.text}</span>
              <span className="bw-muted bw-num">{t.plan.week(isoWeek(N(c.week)).week)} · {fmtDm(c.week)}</span>
            </span>
            <Icon name="next" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Vraagt aandacht": de conflicten van deze en de komende weken (overzicht en Vandaag van de werfleider). */
export function BoardAttention({ go, weeks = 6 }: { go: (to: string) => void; weeks?: number }) {
  const { actor, isFetching } = useBackend();
  const from = thisMonday();
  const q = useQuery({ queryKey: ["boardConflicts", from, weeks], queryFn: () => actor!.boardConflicts(BigInt(from), BigInt(weeks), 50n), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  if (!q.data || q.data.total === 0n) return <Loading q={q} />;
  return (
    <>
      <div className="a-alert"><Icon name="alert" size={20} /><span className="wb-grow"><b>{t.board.conflicts(N(q.data.total))}</b> {t.board.coming(weeks)} · <button type="button" className="wb-link" onClick={() => go("weekbord")}>{t.nav.weekbord}</button></span></div>
      <ConflictList items={q.data.items} go={go} limit={5} />
    </>
  );
}

/** Werfpagina: de conflicten waarin deze werf zit (komende 12 weken). */
export function WorkConflicts({ workId, go }: { workId: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const from = thisMonday();
  const q = useQuery({ queryKey: ["workConflicts", String(workId), from], queryFn: () => actor!.workConflicts(workId, BigInt(from), 12n), enabled: !!actor && !isFetching });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  if (!q.data || items.length === 0) return null;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{t.board.conflicts(N(q.data.total))}</h2>
      <ConflictList items={items} go={go} />
    </section>
  );
}

// ── Regels voor dubbel ────────────────────────────────────────────────────

export function RulesSheet({ caps, onClose }: { caps: Caps; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useQuery({ queryKey: ["boardRules"], queryFn: () => actor!.boardRules(), enabled: on });
  const trades = useQuery({ queryKey: ["trades", false], queryFn: () => actor!.listTrades(false), enabled: on && caps.manageBoardRules });
  const oas = useQuery({ queryKey: ["oas-all"], queryFn: () => actor!.listOas({ includeArchived: false }), enabled: on && caps.manageBoardRules });
  const r = rules.data;
  const [unit, setUnit] = useState<string | null>(null);
  const [max, setMax] = useState<string | null>(null);
  const [oaRep, setOaRep] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [n, setN] = useState("2");
  const [note, setNote] = useState("");
  const edit = caps.manageBoardRules;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["boardRules"] }); void qc.invalidateQueries({ queryKey: ["board"] }); void qc.invalidateQueries({ queryKey: ["boardConflicts"] }); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const saveMain = useMutation({
    mutationFn: async () => unwrap(await actor!.setBoardRules({ unit: unit ?? r!.unit, defaultMax: BigInt(max ?? String(r!.defaultMax)), oaReportsAbsence: oaRep ?? r!.oaReportsAbsence })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const setCap = useMutation({
    mutationFn: async (v: { key: string; max: bigint | null; note: string }) => unwrap(await actor!.setCapacity(v.key, v.max, v.note)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); setKey(""); setNote(""); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet side title={t.rules.title} open onClose={onClose} footer={edit ? <><Button onClick={onClose}>{t.common.close}</Button><Button variant="primary" busy={saveMain.isPending} disabled={!r || !/^\d+$/.test(max ?? String(r.defaultMax))} onClick={() => saveMain.mutate()}>{t.common.save}</Button></> : undefined}>
      <p className="bw-muted">{t.rules.lead}</p>
      <Loading q={rules} />
      {r && (
        <>
          <Field label={t.rules.unit}>
            {edit ? <Choice label={t.rules.unit} value={unit ?? r.unit} onChange={setUnit} options={[{ value: "dag", label: t.rules.unitDay }, { value: "week", label: t.rules.unitWeek }]} /> : <span>{r.unit === "week" ? t.rules.unitWeek : t.rules.unitDay}</span>}
          </Field>
          <span className="bw-muted">{t.rules.unitHelp}</span>
          <Field label={t.rules.defaultMax}>
            {edit ? <input className="bw-input" inputMode="numeric" value={max ?? String(r.defaultMax)} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} /> : <span className="bw-num">{t.board.max(N(r.defaultMax))}</span>}
          </Field>
          <span className="bw-muted">{t.rules.maxHelp}</span>
          <label className="a-row"><input type="checkbox" disabled={!edit} checked={oaRep ?? r.oaReportsAbsence} onChange={(e) => setOaRep(e.target.checked)} /> {t.rules.oaReports}</label>
          <h2 className="bw-h2">{t.rules.own}</h2>
          {r.rules.length === 0 ? <p className="a-empty">{t.rules.ownNone}</p> : (
            <ul className="a-list">
              {r.rules.map((x) => (
                <li key={x.key}>
                  <span className="a-list__main"><b>{x.title}</b><span className="bw-muted">{x.key.startsWith("org:") ? t.rules.addOrg : t.rules.addTrade} · {t.board.max(N(x.maxWorks))}{x.note ? ` · ${x.note}` : ""} · {x.updatedByName}</span></span>
                  {edit && <Button variant="quiet" busy={setCap.isPending && setCap.variables?.key === x.key} onClick={() => setCap.mutate({ key: x.key, max: null, note: "" })}>{t.rules.remove}</Button>}
                </li>
              ))}
            </ul>
          )}
          {edit && (
            <div className="a-stack">
              <Field label={`${t.rules.addTrade} / ${t.rules.addOrg}`}>
                <select className="bw-input" value={key} onChange={(e) => setKey(e.target.value)}>
                  <option value="">{t.rules.pick}</option>
                  <optgroup label={t.rules.addTrade}>{(trades.data ?? []).map((x) => <option key={x.key} value={`trade:${x.key}`}>{x.name}</option>)}</optgroup>
                  <optgroup label={t.rules.addOrg}>{(oas.data ?? []).filter((x) => x.org.kind !== OrgKind.architect && x.org.kind !== OrgKind.client).map((x) => <option key={String(x.org.id)} value={`org:${x.org.id}`}>{x.org.aliases[0] ? `${x.org.aliases[0]} · ` : ""}{x.org.name}</option>)}</optgroup>
                </select>
              </Field>
              <div className="a-row">
                <Field label={t.rules.maxWorks}><input className="bw-input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} /></Field>
                <Field label={t.rules.note}><input className="bw-input" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              <div><Button icon="plus" disabled={!key || n === ""} busy={setCap.isPending} onClick={() => setCap.mutate({ key, max: BigInt(n), note })}>{t.rules.addRule}</Button></div>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
