// "Mijn week" (1.3, uitgebreid in 1.4): het startscherm van een OA. Deze week / volgende week / later, per
// toewijzing de dagen (ma–vr), Bevestigen en Kan niet (R6); daaronder wat botst (dubbel, afwezig, blokkering)
// en de eigen afwezigheden, met "Afwezigheid melden" als de admin dat toelaat. Enkel de eigen firma, enkel de
// werven waar hij lid is (myBoard, orgAssignments; Rights.planScope).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type OrgAssignmentView } from "../backend";
import { Button, Choice, Icon, Sheet, StatusBadge, useToast, type Status } from "../design";
import { t } from "../texts/nl";
import { errText, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { AbsencePanel } from "./Weekbord";
import { ShareSheet } from "./Extern";
import { Field } from "./Werven";
import { fmtDm, fmtShort, isoWeek, today, weekday } from "./planUtil";

const N = Number;
const WD = ["ma", "di", "wo", "do", "vr"];

export function MijnTaken({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const now = today();
  const monday = now - weekday(now);
  const [tab, setTab] = useState<"now" | "next" | "later">("now");
  const mine = useQuery({ queryKey: ["mine", monday], queryFn: () => actor!.orgAssignments(null, BigInt(monday - 7), BigInt(monday + 7 * 17)), enabled: on, refetchOnWindowFocus: true });
  const board = useQuery({ queryKey: ["myBoard", monday], queryFn: () => actor!.myBoard(BigInt(monday), 2n), enabled: on, refetchOnWindowFocus: true });
  const me = useQuery({ queryKey: ["meSelf"], queryFn: () => actor!.me(), enabled: on });
  const [declining, setDeclining] = useState<OrgAssignmentView | null>(null);
  const [why, setWhy] = useState("");
  const answer = useMutation({
    mutationFn: async (v: { id: bigint; ok: boolean }) => unwrap(await actor!.confirmAssignment(v.id, v.ok, v.ok ? "" : why)),
    onSuccess: () => { setDeclining(null); setWhy(""); void qc.invalidateQueries({ queryKey: ["mine"] }); void qc.invalidateQueries({ queryKey: ["myBoard"] }); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  const row = board.data?.row;
  // Werkdagen per toewijzing in deze en volgende week (volgens de kalender van de werf, uit myBoard).
  const daysOf = new Map<string, Set<number>>();
  for (const c of row?.cells ?? []) for (const it of c.items) for (const x of it.tasks) {
    const k = String(x.assignmentId);
    const s = daysOf.get(k) ?? new Set<number>();
    x.days.forEach((d) => s.add(N(d)));
    daysOf.set(k, s);
  }
  const rows = (mine.data ?? []).filter((r) => N(r.assignment.end) >= monday);
  const wk = tab === "now" ? monday : monday + 7;
  const shown = tab === "later"
    ? rows.filter((r) => N(r.assignment.start) >= monday + 14)
    : rows.filter((r) => N(r.assignment.start) <= wk + 6 && N(r.assignment.end) >= wk);
  const conflicts = (row?.conflicts ?? []).filter((c) => tab === "later" || N(c.week) === wk);
  const self = me.data?.person;
  const [sharing, setSharing] = useState(false);

  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <p className="bw-muted">{t.mine.lead}</p>
        {row && <Button icon="share" onClick={() => setSharing(true)}>{t.extern.share}</Button>}
      </div>
      {sharing && row && <ShareSheet base={{ orgName: row.name, orgCode: row.code, appUrl: window.location.origin, byName: self?.name }} row={row} monday={monday} weeks={2} onClose={() => setSharing(false)} />}
      <Choice label={t.mine.title} value={tab} onChange={setTab} fill options={[
        { value: "now", label: `${t.mine.thisWeek} · ${isoWeek(monday).week}` },
        { value: "next", label: `${t.mine.nextWeek} · ${isoWeek(monday + 7).week}` },
        { value: "later", label: t.mine.later },
      ]} />
      {tab !== "later" && <span className="bw-label">{t.plan.week(isoWeek(wk).week)} · {fmtDm(wk)} – {fmtDm(wk + 4)}</span>}
      {conflicts.length > 0 && (
        <div className="a-stack">
          <span className="bw-label">{t.mine.conflicts}</span>
          {conflicts.map((c, i) => <div key={i} className="a-alert"><Icon name="alert" size={18} /><span>{c.text}</span></div>)}
        </div>
      )}
      <Loading q={mine} />
      {mine.data && shown.length === 0 && <p className="a-empty">{tab === "later" ? t.plan.mineNone : t.mine.nothingWeek}</p>}
      {shown.length > 0 && (
        <ul className="a-list">
          {shown.map((r) => {
            const a = r.assignment;
            const k = a.confirmation.__kind__;
            const days = daysOf.get(String(a.id));
            return (
              <li key={String(a.id)} className="a-doc">
                <button type="button" className="a-list__btn" onClick={() => go(`werven/${a.workId}/planning?taak=${a.taskId}`)}>
                  <span className="a-tag">{r.workCode}</span>
                  <span className="a-list__main">
                    <b>{r.taskTitle}</b>
                    <span className="bw-num">{fmtShort(a.start)}{a.end !== a.start ? ` – ${fmtShort(a.end)}` : ""}</span>
                    <span className="bw-muted">{r.workName}{a.note ? ` · ${a.note}` : ""}</span>
                  </span>
                  {tab !== "later" && days && <span className="wb-mdays">{WD.map((d, i) => <span key={d} className={days.has(wk + i) ? "on" : ""}>{d}</span>)}</span>}
                  <StatusBadge status={r.taskStatus as unknown as Status} small />
                </button>
                <span className={`a-tag${k === "confirmed" ? " a-tag--ok" : k === "declined" ? " a-tag--bad" : ""}`}>{t.plan.conf[k]}</span>
                {r.canConfirm && k !== "confirmed" && <Button variant="primary" busy={answer.isPending && answer.variables?.id === a.id} onClick={() => answer.mutate({ id: a.id, ok: true })}>{t.plan.confirm}</Button>}
                {r.canConfirm && k !== "declined" && <Button onClick={() => setDeclining(r)}>{t.plan.decline}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {row && self && (
        <AbsencePanel orgId={row.orgId} from={monday} canEdit={board.data!.canReport} own persons={[{ id: self.id, name: self.name }]} />
      )}
      <Sheet title={t.plan.declineTitle} open={declining !== null} onClose={() => setDeclining(null)} footer={<>
        <Button onClick={() => setDeclining(null)}>{t.common.cancel}</Button>
        <Button variant="primary" disabled={!why.trim()} busy={answer.isPending} onClick={() => declining && answer.mutate({ id: declining.assignment.id, ok: false })}>{t.plan.decline}</Button>
      </>}>
        {declining && <p><b>{declining.taskTitle}</b> · {declining.workCode}</p>}
        <Field label={t.plan.declineReason}><textarea className="bw-input" rows={3} maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus /></Field>
      </Sheet>
    </section>
  );
}
