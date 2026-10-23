// Startscherm van de beheerder: "Vraagt aandacht" (bouwplan §8.2). In 0.6: koppelingen die op
// bevestiging wachten, de globale remming op codes en de meldingen; daaronder de werven.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinkStatus } from "../backend";
import { Button, Icon, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page, useWorks, WorkList } from "./common";
import { BoardAttention } from "./Weekbord";

export function Overzicht({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const stats = useQuery({ queryKey: ["accessStats"], queryFn: () => actor!.accessStats(), enabled: on });
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on });
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => actor!.myNotifications(true), enabled: on });
  const works = useWorks();

  const confirm = useMutation({
    mutationFn: async (p: Parameters<NonNullable<typeof actor>["confirmLink"]>[0]) => unwrap(await actor!.confirmLink(p)),
    onMutate: () => toast.show({ kind: "wait", text: t.common.saving }),
    onSuccess: (_d, _v, id) => { toast.update(id as number, { kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e, _v, id) => toast.update(id as number, { kind: "error", text: errText(e) }),
  });
  const read = useMutation({
    mutationFn: async (ids: bigint[]) => actor!.markNotificationsRead(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const pending = (links.data ?? []).filter((l) => l.status === LinkStatus.pending);
  const s = stats.data;

  return (
    <Page title={t.overzicht.title}>
      {s && (
        <div className="a-counters">
          <div className="a-counter"><span className="a-counter__n">{String(s.persons)}</span><span className="a-counter__l">{t.overzicht.counters.persons}</span></div>
          <div className="a-counter"><span className="a-counter__n">{String(s.activeLinks)}</span><span className="a-counter__l">{t.overzicht.counters.active}</span></div>
          <div className={`a-counter${s.pendingLinks > 0n ? " a-counter--accent" : ""}`}><span className="a-counter__n">{String(s.pendingLinks)}</span><span className="a-counter__l">{t.overzicht.counters.pending}</span></div>
          <div className="a-counter"><span className="a-counter__n">{String(s.openInvites)}</span><span className="a-counter__l">{t.overzicht.counters.codes}</span></div>
        </div>
      )}
      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{t.overzicht.attention}</h2>
          <BoardAttention go={go} />
          <Loading q={links} />
          {s?.codesLockedUntil !== undefined && (
            <div className="a-alert" role="alert"><Icon name="alert" size={20} /><span><b>{t.overzicht.locked}</b> · {fmtTime(s.codesLockedUntil)}</span></div>
          )}
          {s && s.failuresThisHour >= 100n && (
            <div className="a-alert"><Icon name="alert" size={20} /><span><b>{t.overzicht.throttle}</b> — {t.overzicht.throttleBody(String(s.failuresThisHour))}</span></div>
          )}
          {pending.length > 0 ? (
            <ul className="a-list">
              {pending.map((l) => (
                <li key={l.principal.toText()}>
                  <span className="a-list__main">
                    <b>{l.personName}</b>
                    <span className="bw-muted">{fmtTime(l.linkedAt)} · code …{l.codeHint}{l.tag ? ` · ${l.tag}` : ""}</span>
                  </span>
                  <Button variant="primary" busy={confirm.isPending && confirm.variables === l.principal} onClick={() => confirm.mutate(l.principal)}>{t.overzicht.confirm}</Button>
                </li>
              ))}
            </ul>
          ) : (
            links.data && s?.codesLockedUntil === undefined && <p className="a-empty">{t.overzicht.noPending}</p>
          )}
          <h2 className="bw-h2">{t.overzicht.works}</h2>
          <Loading q={works} />
          {works.data && <WorkList works={works.data} go={go} empty={t.werven.empty} />}
        </section>
        <section className="a-section">
          <div className="a-row a-row--between">
            <h2 className="bw-h2">{t.overzicht.notes}</h2>
            {(notes.data?.length ?? 0) > 0 && <Button variant="quiet" onClick={() => read.mutate(notes.data!.map((n) => n.id))}>{t.overzicht.markRead}</Button>}
          </div>
          <Loading q={notes} />
          {notes.data && notes.data.length === 0 && <p className="a-empty">{t.overzicht.nothing}</p>}
          {notes.data && notes.data.length > 0 && (
            <ul className="a-list">
              {notes.data.map((n) => (
                <li key={String(n.id)}>
                  <span className="a-list__main"><span>{n.text}</span><span className="bw-muted bw-num">{fmtTime(n.createdAt)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
