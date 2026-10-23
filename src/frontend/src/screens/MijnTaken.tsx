// "Mijn taken" (1.3): de toewijzingen van de eigen firma op de werven waar je lid bent, per week, met
// Bevestigen en Kan niet (R6). Het startscherm van een OA; het weekbord per OA voor kantoor komt in 1.4.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type OrgAssignmentView } from "../backend";
import { Button, Sheet, StatusBadge, useToast, type Status } from "../design";
import { t } from "../texts/nl";
import { errText, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";
import { fmtDm, fmtShort, isoWeek, today, weekday } from "./planUtil";

export function MijnTaken({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const now = today();
  const from = now - weekday(now) - 7;
  const mine = useQuery({ queryKey: ["mine", from], queryFn: () => actor!.orgAssignments(null, BigInt(from), BigInt(from + 7 * 17)), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [declining, setDeclining] = useState<OrgAssignmentView | null>(null);
  const [why, setWhy] = useState("");
  const answer = useMutation({
    mutationFn: async (v: { id: bigint; ok: boolean }) => unwrap(await actor!.confirmAssignment(v.id, v.ok, v.ok ? "" : why)),
    onSuccess: () => { setDeclining(null); setWhy(""); void qc.invalidateQueries({ queryKey: ["mine"] }); toast.show({ kind: "ok", text: t.common.saved }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const rows = mine.data ?? [];
  const weeks = [...new Set(rows.map((r) => Number(r.assignment.start) - weekday(Number(r.assignment.start))))].sort((a, b) => a - b);
  return (
    <section className="a-section">
      <h2 className="bw-h2">{t.plan.mine}</h2>
      <p className="bw-muted">{t.plan.mineLead}</p>
      <Loading q={mine} />
      {mine.data && rows.length === 0 && <p className="a-empty">{t.plan.mineNone}</p>}
      {weeks.map((m) => (
        <div key={m} className="a-stack">
          <span className="bw-label">{t.plan.week(isoWeek(m).week)} · {fmtDm(m)} – {fmtDm(m + 4)}</span>
          <ul className="a-list">
            {rows.filter((r) => Number(r.assignment.start) - weekday(Number(r.assignment.start)) === m).map((r) => {
              const a = r.assignment;
              const k = a.confirmation.__kind__;
              return (
                <li key={String(a.id)} className="a-doc">
                  <button type="button" className="a-list__btn" onClick={() => go(`werven/${a.workId}/planning`)}>
                    <span className="a-tag">{r.workCode}</span>
                    <span className="a-list__main">
                      <b>{r.taskTitle}</b>
                      <span className="bw-num">{fmtShort(a.start)}{a.end !== a.start ? ` – ${fmtShort(a.end)}` : ""}</span>
                      <span className="bw-muted">{r.workName}{a.note ? ` · ${a.note}` : ""}</span>
                    </span>
                    <StatusBadge status={r.taskStatus as unknown as Status} small />
                  </button>
                  <span className={`a-tag${k === "confirmed" ? " a-tag--ok" : k === "declined" ? " a-tag--bad" : ""}`}>{t.plan.conf[k]}</span>
                  {r.canConfirm && k !== "confirmed" && <Button variant="primary" busy={answer.isPending && answer.variables?.id === a.id} onClick={() => answer.mutate({ id: a.id, ok: true })}>{t.plan.confirm}</Button>}
                  {r.canConfirm && k !== "declined" && <Button onClick={() => setDeclining(r)}>{t.plan.decline}</Button>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
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
