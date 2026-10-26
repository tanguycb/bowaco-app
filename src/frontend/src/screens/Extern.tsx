// Externe weergaven (stap 1.7, bouwplan §8.2 en rij 1.7): Mijn uren (bevestigen of betwisten, R9), Mijn werven met de
// werfleider om te bellen, en de deel-knop van de weekplanning (PDF of beeld). Wat iemand ziet, beslist de backend.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Grant, type BoardRow, type HoursLine, type MembershipView } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { shareWeek, type ShareWeek } from "../pdf/weekplanning";
import { t } from "../texts/nl";
import { errText, fmtDayNum, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page, WorkPhase } from "./common";
import { fmtDur, fmtMin } from "./Werfverslag";

const H = t.hours;
const E = t.extern;

export function MijnUren() {
  return (
    <Page title={H.title}>
      <HoursPanel />
    </Page>
  );
}

/** De uren van mijn firma uit de werfverslagen (laatste 60 dagen). */
export function HoursPanel({ compact }: { compact?: boolean }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayDay();
  const q = useQuery({ queryKey: ["myHours", String(today)], queryFn: () => actor!.myHours(today - 60n, today + 1n), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [dispute, setDispute] = useState<HoursLine | null>(null);
  const [why, setWhy] = useState("");
  const m = useMutation({
    mutationFn: async (v: { id: bigint; ok: boolean; remark: string }) => unwrap(await actor!.confirmHours(v.id, v.ok, v.remark)),
    onSuccess: () => { setDispute(null); setWhy(""); toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["myHours"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const lines = q.data ?? [];
  const open = lines.filter((l) => l.canConfirm && l.confirmations.length === 0);
  const shown = compact ? open : lines;
  if (compact && shown.length === 0) return null;
  return (
    <section className="a-section">
      {compact ? <h2 className="bw-h2">{H.title} · {H.toConfirm(open.length)}</h2> : <p className="bw-muted">{H.lead} ({H.period(60)})</p>}
      <Loading q={q} />
      {q.data && shown.length === 0 && <p className="a-empty">{H.none}</p>}
      {shown.length > 0 && (
        <ul className="a-list">
          {shown.map((l) => {
            const last = l.confirmations[l.confirmations.length - 1];
            return (
              <li key={String(l.attendanceId)} className="a-doc">
                <span className="a-tag">{fmtDayNum(l.day)}</span>
                <span className="a-list__main">
                  <b>{l.workCode} · {l.workName}</b>
                  <span className="m-slots">{l.headcount > 1n ? `${l.headcount} × ` : ""}{l.slots.map((s) => `${fmtMin(s.fromMin)}–${fmtMin(s.toMin)}`).join(" · ")} = {fmtDur(l.minutesTotal)}{l.regie ? " · regie" : ""}</span>
                  {l.names && <span className="bw-muted">{l.names}</span>}
                  {last && <span className={`a-tag ${last.ok ? "a-tag--ok" : "a-tag--bad"}`}>{last.ok ? H.confirmed : H.disputed} · {last.byName}{last.remark ? `: ${last.remark}` : ""}</span>}
                  {!l.reportFinal && <span className="bw-muted">{H.waitFinal}</span>}
                  {l.reportFinal && !l.canConfirm && <span className="bw-muted">{H.noRight}</span>}
                </span>
                {l.canConfirm && (!last || !last.ok) && <Button variant="primary" busy={m.isPending && m.variables?.id === l.attendanceId && m.variables.ok} onClick={() => m.mutate({ id: l.attendanceId, ok: true, remark: "" })}>{H.ok}</Button>}
                {l.canConfirm && (!last || last.ok) && <Button onClick={() => setDispute(l)}>{H.notOk}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {dispute && (
        <Sheet title={H.disputeTitle} open onClose={() => setDispute(null)} footer={<>
          <Button onClick={() => setDispute(null)}>{t.common.cancel}</Button>
          <Button variant="primary" disabled={!why.trim()} busy={m.isPending} onClick={() => m.mutate({ id: dispute.attendanceId, ok: false, remark: why })}>{H.notOk}</Button>
        </>}>
          <p><b>{dispute.workCode}</b> · {fmtDayNum(dispute.day)} · {fmtDur(dispute.minutesTotal)}</p>
          <label className="bw-field"><span className="bw-label">{H.disputeTitle}</span><textarea id="hours-why" className="bw-input" rows={3} maxLength={1000} value={why} placeholder={H.disputePh} onChange={(e) => setWhy(e.target.value)} /></label>
        </Sheet>
      )}
    </section>
  );
}

/** Mijn werven (externen) met de werfleider om te bellen. */
export function MijnWerven({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["myWorks"], queryFn: () => actor!.myWorks(), enabled: !!actor && !isFetching });
  if (q.data && q.data.length === 0) return null;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{E.works}</h2>
      <p className="bw-muted">{E.worksLead}</p>
      <Loading q={q} />
      {q.data && (
        <ul className="a-list">
          {q.data.map((w) => (
            <li key={String(w.id)} className="a-doc">
              <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.id}`)}>
                <span className="a-tag">{w.code}</span>
                <span className="a-list__main">
                  <b>{w.name}</b>
                  <span className="bw-muted">{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.city}` : ""}</span>
                  {w.leaderName && <span className="bw-muted">{E.leader}: {w.leaderName}</span>}
                </span>
                <WorkPhase w={w} />
              </button>
              {w.leaderPhone && <a className="bw-btn bw-btn--secondary" href={`tel:${w.leaderPhone.replace(/\s/g, "")}`}><Icon name="phone" size={18} />{E.call}</a>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Delen van één week van één firma: kies de week en PDF of beeld. */
export function ShareSheet({ base, row, monday, weeks, onClose }: { base: Omit<ShareWeek, "monday" | "weekIndex" | "row">; row: BoardRow | null; monday: number; weeks: number; onClose: () => void }) {
  const toast = useToast();
  const [wi, setWi] = useState(0);
  const [busy, setBusy] = useState<"pdf" | "png" | null>(null);
  const go = async (kind: "pdf" | "png") => {
    setBusy(kind);
    try {
      const r = await shareWeek({ ...base, row, monday: monday + 7 * wi, weekIndex: wi }, kind);
      toast.show({ kind: "ok", text: r === "shared" ? E.shared : E.downloaded });
      onClose();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title={E.shareTitle} open onClose={onClose} footer={<>
      <Button icon="doc" busy={busy === "pdf"} onClick={() => void go("pdf")}>{E.pdf}</Button>
      <Button variant="primary" icon="share" busy={busy === "png"} onClick={() => void go("png")}>{E.png}</Button>
    </>}>
      <p className="bw-muted">{E.shareLead}</p>
      <p><b>{base.orgCode ? `${base.orgCode} · ` : ""}{base.orgName}</b></p>
      <Choice label={E.week} fill value={wi} onChange={setWi} options={Array.from({ length: Math.max(1, weeks) }, (_, i) => ({ value: i, label: `${E.week} ${isoWeek(monday + 7 * i)}` }))} />
    </Sheet>
  );
}

function isoWeek(d: number): number {
  const x = new Date(d * 86_400_000);
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

// ── Werfpagina: externen uitnodigen en hun rechten (R15, architectuur rij 1.7) ──

const ROLE_GRANTS: Record<string, Grant[]> = {
  onderaannemer: [Grant.confirmPlanning, Grant.confirmHours],
  architect: [Grant.readReports, Grant.uploadDocs],
  veiligheidscoordinator: [Grant.uploadDocs, Grant.readReports],
};

/** De rechten van één extern lidmaatschap als aan/uit-knoppen (wie het team beheert). */
export function GrantToggles({ m }: { m: MembershipView }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const opts = ROLE_GRANTS[m.role] ?? [];
  const save = useMutation({
    mutationFn: async (grants: Grant[]) => unwrap(await actor!.setMemberGrants(m.id, grants)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["members", String(m.workId)] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (opts.length === 0 || m.endedAt !== undefined) return null;
  return (
    <span className="bw-choice" role="group" aria-label={t.invite.grants}>
      {opts.map((g) => {
        const on = m.grants.includes(g);
        return (
          <button key={g} type="button" className="bw-choice__opt" aria-pressed={on} disabled={save.isPending} onClick={() => save.mutate(on ? m.grants.filter((x) => x !== g) : [...m.grants, g])}>
            {t.grants[g] ?? g}
          </button>
        );
      })}
    </span>
  );
}
