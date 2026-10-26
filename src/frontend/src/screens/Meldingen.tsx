// In-app meldingen (bouwplan §8.6 en rij 1.7, R18: iedereen leest enkel zijn eigen). Een bel in de kop met het aantal
// nieuwe meldingen; tikken = de lijst, met doorklikken naar de werf, de planning of Mijn uren.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NotificationView } from "../backend";
import { Button, Icon, Sheet } from "../design";
import { t } from "../texts/nl";
import { fmtTime, useBackend } from "../util";
import { Loading } from "./common";

const M = t.notes;

export function Bell({ go, home }: { go: (to: string) => void; home: string }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const [open, setOpen] = useState(false);
  const unread = useQuery({ queryKey: ["notes"], queryFn: () => actor!.myNotifications(true), enabled: on, refetchInterval: 60_000, refetchOnWindowFocus: true, retry: 0 });
  const n = unread.data?.length ?? 0;
  return (
    <>
      <button type="button" className={`bw-conn${n > 0 ? " a-bell--on" : ""}`} aria-label={n > 0 ? M.unread(n) : M.title} onClick={() => setOpen(true)}>
        <Icon name="bell" size={16} />{n > 0 ? n : ""}
      </button>
      {open && <NotesSheet go={go} home={home} onClose={() => setOpen(false)} />}
    </>
  );
}

/** 2b.3: een melding springt naar het tabblad van de werf waar het over gaat (#/werven/12/offerte …). */
const TAB_OF: [RegExp, string][] = [
  [/^(planning|afwezigheid|vallen|valt|remming)/, "planning"],
  [/^(offerte|werfstart)/, "offerte"],
  [/^opmeting/, "opmeting"],
  [/^vordering/, "facturatie"],
  [/^(vergunning|inhoudingsplicht)/, "vergunningen"],
  [/^(verslag|probleem)/, "verslagen"],
];

function target(n: NotificationView, home: string): string | null {
  if (n.kind === "uren-bevestigen") return "uren";
  if (n.workId === undefined) return home === "week" ? "week" : null;
  if (n.kind.startsWith("planning")) return home === "week" ? "week" : `werven/${n.workId}/planning`;
  const tab = TAB_OF.find(([re]) => re.test(n.kind))?.[1];
  return tab ? `werven/${n.workId}/${tab}` : `werven/${n.workId}`;
}

function NotesSheet({ go, home, onClose }: { go: (to: string) => void; home: string; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["notesAll"], queryFn: () => actor!.myNotifications(false), enabled: !!actor && !isFetching });
  const read = useMutation({
    mutationFn: async (ids: bigint[]) => actor!.markNotificationsRead(ids),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notes"] }); void qc.invalidateQueries({ queryKey: ["notesAll"] }); },
  });
  const list = (all.data ?? []).slice(0, 60);
  const unreadIds = list.filter((n) => n.readAt === undefined).map((n) => n.id);
  return (
    <Sheet title={M.title} open onClose={onClose} side footer={<>
      <Button onClick={onClose}>{t.common.close}</Button>
      <Button variant="primary" icon="check" disabled={unreadIds.length === 0} busy={read.isPending} onClick={() => read.mutate(unreadIds)}>{M.allRead}</Button>
    </>}>
      <Loading q={all} />
      {all.data && list.length === 0 && <p className="a-empty">{M.none}</p>}
      <ul className="a-list">
        {list.map((n) => {
          const to = target(n, home);
          return (
            <li key={String(n.id)}>
              <span className="a-list__main">
                <span className={n.readAt === undefined ? "a-strong" : ""}>{n.text}</span>
                <span className="bw-muted bw-num">{fmtTime(n.createdAt)}</span>
              </span>
              {to && <Button variant="quiet" onClick={() => { read.mutate([n.id]); onClose(); go(to); }}>{M.open}</Button>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
