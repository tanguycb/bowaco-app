// Startscherm van de beheerder (bouwplan §8.2 en §8.4): bovenaan de tellers van het dashboard (1.8), daarnaast
// "Vraagt aandacht" (problemen en vertragingen, dubbele boekingen, werven zonder verslag, OA's die niet kunnen,
// koppelingen die op bevestiging wachten, de remming op codes) en de meldingen; daaronder de werven als kaarten,
// de achterstanden, deze week en de openstaande bevestigingen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinkStatus } from "../backend";
import { Button, Icon, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { BoardAttention } from "./Weekbord";
import { DashboardBody, DashCounters, useDashboard } from "./Dashboard";
import { IssueAttention } from "./Verslagen";

export function Overzicht({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const stats = useQuery({ queryKey: ["accessStats"], queryFn: () => actor!.accessStats(), enabled: on });
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on });
  const notes = useQuery({ queryKey: ["notes"], queryFn: () => actor!.myNotifications(true), enabled: on });
  const dash = useDashboard();

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
      {dash.data && <DashCounters v={dash.data} />}
      {s && <p className="bw-muted bw-num">{t.overzicht.access(String(s.persons), String(s.activeLinks), String(s.openInvites))}</p>}
      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{t.overzicht.attention}</h2>
          <IssueAttention go={go} />
          <BoardAttention go={go} />
          {dash.data && dash.data.works.filter((w) => w.missingReport !== undefined || w.confirmDeclined > 0n).map((w) => (
            <div key={String(w.id)} className="a-alert"><Icon name="alert" size={20} /><span><button type="button" className="wb-link" onClick={() => go(`werven/${w.id}`)}><b>{w.code}</b></button> · {w.warnings.filter((x) => /verslag|kan niet/.test(x)).join(" · ")}</span></div>
          ))}
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
      <DashboardBody go={go} withCounters={false} />
    </Page>
  );
}
