// Kleine bouwstenen die meerdere schermen delen.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WorkStatus, type WorkView } from "../backend";
import { Icon, STATUS_WORD, StatusBadge, type Status } from "../design";
import { t } from "../texts/nl";
import { errText, todayLabel, useBackend } from "../util";

export function Page({ label, title, actions, children }: { label?: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="a-page">
      <header className="a-head">
        <div>
          <span className="bw-label">{label ?? todayLabel()}</span>
          <h1 className="bw-h1">{title}</h1>
        </div>
        {actions && <div className="a-row">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <p className="bw-muted">{t.common.loading}</p>;
  if (q.error) return <p className="a-err" role="alert"><Icon name="alert" size={16} /> {errText(q.error)}</p>;
  return null;
}

/** Werfstatus → een van de vijf vaste statussen + het eigen woord als aanvulling. */
const WORK_TO_STATUS: Record<string, Status> = {
  request: "planned",
  quoting: "planned",
  planned: "planned",
  running: "busy",
  delivered: "done",
  aftercare: "done",
  cancelled: "blocked",
};

export function WorkBadge({ status }: { status: WorkStatus }) {
  const s = WORK_TO_STATUS[status] ?? "planned";
  const word = t.workStatus[status] ?? status;
  return <StatusBadge status={s} small extra={word !== STATUS_WORD[s] ? word : undefined} />;
}

export function useWorks() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: !!actor && !isFetching });
}

export function WorkList({ works, go, empty }: { works: WorkView[]; go: (to: string) => void; empty: string }) {
  if (works.length === 0) return <p className="a-empty">{empty}</p>;
  return (
    <ul className="a-list">
      {works.map((w) => (
        <li key={String(w.id)}>
          <button type="button" className={`a-list__btn${w.parentId !== undefined ? " a-list__btn--sub" : ""}`} onClick={() => go(`werven/${w.id}`)}>
            <span className="a-tag">{w.code}</span>
            <span className="a-list__main">
              <b>{w.name}</b>
              <span className="bw-muted">{w.parentId !== undefined ? `${t.werven.sub} · ` : ""}{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.city}` : ""}</span>
            </span>
            {w.checklistOpen !== undefined && w.checklistOpen > 0n && <span className="a-tag a-tag--warn">{t.werven.docsOpen(Number(w.checklistOpen))}</span>}
            <WorkBadge status={w.status} />
            <Icon name="next" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RoleTags({ roles }: { roles: string[] }) {
  return <span className="a-row">{roles.map((r) => <span key={r} className={`a-tag${r === "admin" ? " a-tag--accent" : ""}`}>{t.roles[r] ?? r}</span>)}</span>;
}
