// "Vraagt aandacht" (stap 2b.4, vraag 9 van het prototype): wat dringend is staat hier één voor één, gegroepeerd per soort
// (vertraagd · onderaannemer kan niet · dubbel geboekt · open problemen · vergunning vervalt · geen werfverslag · wacht op jou),
// telkens hoogstens vijf met "Toon alle". De rest (gewone meldingen) zit gebundeld in de bel. Gebruikt door het Overzicht van de
// beheerder en door Vandaag (werfleider) en Offertes (calculator): elke groep komt uit een bestaande query die de rol toch mag lezen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LinkStatus, type Caps } from "../backend";
import { Button, Icon, useToast } from "../design";
import { werfFase } from "../app/fase";
import { attentionGroups, type AttentionGroup, type AttentionItem } from "../app/start";
import { t } from "../texts/nl";
import { errText, fmtDayNum, fmtTime, unwrap, useBackend } from "../util";
import { factsOf, Loading, useStages, useWorks } from "./common";
import { useDashboard } from "./Dashboard";
import { fmtDm, today, weekday } from "./planUtil";
import { warnText } from "./Vergunningen";

const A = t.aandacht;
const N = Number;
const monday = () => today() - weekday(today());

/** De groepen van "Vraagt aandacht" voor deze rol. `loading` is waar zolang een bron nog antwoordt. */
export function useAttention(caps: Caps): { groups: AttentionGroup[]; loading: boolean; counters?: ReturnType<typeof useDashboard>["data"] } {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const dash = useDashboard();
  const issues = useQuery({ queryKey: ["issues", "open"], queryFn: () => actor!.listIssues(null, true, 50n), enabled: on, retry: 0, refetchOnWindowFocus: true });
  const from = monday();
  const conflicts = useQuery({ queryKey: ["boardConflicts", from, 6], queryFn: () => actor!.boardConflicts(BigInt(from), 6n, 50n), enabled: on, refetchOnWindowFocus: true });
  const permits = useQuery({ queryKey: ["permits", "aandacht"], queryFn: () => actor!.listPermits("aandacht", null), enabled: on && caps.permits, refetchOnWindowFocus: true });
  const starts = useQuery({ queryKey: ["pendingWorkStarts", "all"], queryFn: () => actor!.pendingWorkStarts(null), enabled: on && caps.workStarts, refetchOnWindowFocus: true });
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on && caps.manageAccess });
  const works = useWorks();
  const stages = useStages();
  const confirm = useMutation({
    mutationFn: async (p: Parameters<NonNullable<typeof actor>["confirmLink"]>[0]) => unwrap(await actor!.confirmLink(p)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  const d = dash.data;
  const item = (key: string, title: string, detail: string, to: string, action?: AttentionItem["action"]): AttentionItem => ({ key, title, detail, to, action });

  const vertraagd = (d?.late ?? []).map((x) => item(`l${x.taskId}`, `${x.workCode} · ${x.title}`, A.late(N(x.lateDays)) + (x.orgNames.length ? ` · ${x.orgNames.join(", ")}` : ""), `werven/${x.workId}/planning?taak=${x.taskId}`));
  const declined = (d?.confirmations ?? []).filter((c) => c.declined).map((c) => item(`c${c.assignmentId}`, `${c.workCode} · ${c.orgName}`, `${c.taskTitle} · ${fmtDayNum(c.start)}${c.reason ? ` · ${c.reason}` : ""}`, `werven/${c.workId}/planning?taak=${c.taskId}`));
  const cs = conflicts.data?.items ?? [];
  const conflictItem = (c: (typeof cs)[number], i: number, prefix = "") => item(`k${c.week}-${c.orgId}-${i}`, `${c.orgCode ?? c.orgName}`, `${prefix}${c.text} · ${fmtDm(c.week)}`, `weekbord?w=${c.week}&org=${c.orgId}`);
  const afwezig = cs.map((c, i) => ({ c, i })).filter((x) => x.c.kind === "afwezig").map((x) => conflictItem(x.c, x.i));
  const dubbel = cs.map((c, i) => ({ c, i })).filter((x) => x.c.kind !== "afwezig").map((x) => conflictItem(x.c, x.i, x.c.kind === "blokkering" ? "Geblokkeerd: " : ""));
  const probleem = (issues.data ?? []).map((i) => item(`i${i.id}`, `${i.workCode} · ${t.verslag.issueKinds[i.kind] ?? i.kind}${i.delayDays !== undefined ? ` +${i.delayDays} wd` : ""}`, i.text, `werven/${i.workId}/verslagen`));
  const vergunning = (permits.data ?? []).filter((p) => p.warnings.some((w) => w.__kind__ === "expiresSoon" || w.__kind__ === "expired")).map((p) => item(`p${p.id}`, `${p.workCode} · ${p.title || p.kindName}`, p.warnings.map(warnText).join(" · "), `werven/${p.workId}/vergunningen`));
  const verslag = (d?.works ?? []).filter((w) => w.missingReport !== undefined).map((w) => item(`m${w.id}`, `${w.code} · ${w.name}`, A.noReport(fmtDayNum(w.missingReport)), `werven/${w.id}/verslagen`));
  const wacht: AttentionItem[] = [
    ...(starts.data ?? []).map((p) => item(`s${p.versionId}`, `${p.workCode} · ${p.title}`, t.werfstart.pendingItem(p.quoteNumber, String(p.version), p.acceptedHow), `werfstart/${p.versionId}`)),
    ...(works.data ?? []).filter((w) => w.archivedAt === undefined && stages.data?.some((s) => s.workId === w.id && s.quoteWaiting)).map((w) => item(`q${w.id}`, `${w.code} · ${w.name}`, A.quoteWaits(""), `werven/${w.id}/offerte`)),
    ...(links.data ?? []).filter((l) => l.status === LinkStatus.pending).map((l) => item(`x${l.principal.toText()}`, l.personName, `${fmtTime(l.linkedAt)} · code …${l.codeHint}`, "beheer/toegang", { label: t.overzicht.confirm, busy: confirm.isPending && confirm.variables === l.principal, run: () => confirm.mutate(l.principal) })),
  ];
  const groups: AttentionGroup[] = [
    { kind: "vertraagd", items: vertraagd },
    { kind: "oa", items: [...declined, ...afwezig] },
    { kind: "dubbel", items: dubbel },
    { kind: "probleem", items: probleem },
    { kind: "vergunning", items: vergunning },
    { kind: "verslag", items: verslag },
    { kind: "wacht", items: wacht },
  ];
  return { groups, loading: dash.isLoading || issues.isLoading || conflicts.isLoading, counters: d };
}

/** De groepen zelf: koppen per soort, hoogstens vijf regels, "Toon alle". */
export function AttentionGroups({ groups, go }: { groups: AttentionGroup[]; go: (to: string) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const shown = attentionGroups(groups, open);
  const flip = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <>
      {shown.map((g) => (
        <div key={g.kind} className="a-attn" data-kind={g.kind}>
          <span className="bw-label a-attn__h"><Icon name="alert" size={14} /> {A.kinds[g.kind]} · {g.total}</span>
          <ul className="a-list">
            {g.shown.map((x) => (
              <li key={x.key}>
                <button type="button" className="a-list__btn" onClick={() => go(x.to)}>
                  <span className="a-list__main"><b>{x.title}</b><span className="bw-muted">{x.detail}</span></span>
                  {!x.action && <Icon name="next" size={18} />}
                </button>
                {x.action && <Button variant="primary" busy={x.action.busy} onClick={x.action.run}>{x.action.label}</Button>}
              </li>
            ))}
          </ul>
          {(g.more || open.has(g.kind)) && g.total > 5 && <button type="button" className="wb-link" data-testid="toon-alle" onClick={() => flip(g.kind)}>{open.has(g.kind) ? A.less : A.more(g.total)}</button>}
        </div>
      ))}
    </>
  );
}

/** Het blok "Vraagt aandacht" van het Overzicht (beheerder) en van Vandaag (werfleider). */
export function AttentionBlock({ caps, go, title = A.title, hideEmpty }: { caps: Caps; go: (to: string) => void; title?: string; hideEmpty?: boolean }) {
  const { groups, loading } = useAttention(caps);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (hideEmpty && total === 0) return null;
  return (
    <section className="a-section" data-testid="aandacht">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{title} {total > 0 && <span className="bw-muted bw-num">({total})</span>}</h2>
      </div>
      {loading && total === 0 && <Loading q={{ isLoading: true, error: null }} />}
      {!loading && total === 0 && <p className="a-empty">{A.nothing}</p>}
      <AttentionGroups groups={groups} go={go} />
      <p className="bw-muted a-note-small">{A.bundled}</p>
    </section>
  );
}

/** Het startscherm van de calculator (Offertes): wat op een offerte wacht, zonder bedragen en zonder het Dashboard. */
export function CalculatorStart({ go }: { go: (to: string) => void }) {
  const works = useWorks();
  const stages = useStages();
  if (!works.data || !stages.data) return null;
  const live = works.data.filter((w) => w.archivedAt === undefined);
  const fase = (w: (typeof live)[number]) => werfFase(factsOf(w, stages.data));
  const groups: AttentionGroup[] = [
    { kind: "aanvraag", items: live.filter((w) => fase(w).index === 0 && !fase(w).cancelled).map((w) => ({ key: `a${w.id}`, title: `${w.code} · ${w.name}`, detail: A.requestNoQuote, to: `werven/${w.id}/offerte` })) },
    { kind: "wacht", items: live.filter((w) => stages.data!.some((s) => s.workId === w.id && s.quoteWaiting)).map((w) => ({ key: `q${w.id}`, title: `${w.code} · ${w.name}`, detail: A.quoteWaits(""), to: `werven/${w.id}/offerte` })) },
  ];
  if (groups.every((g) => g.items.length === 0)) return null;
  return (
    <section className="a-section" data-testid="rekenaar-start">
      <h2 className="bw-h2">{A.calcTitle}</h2>
      <AttentionGroups groups={groups} go={go} />
    </section>
  );
}
