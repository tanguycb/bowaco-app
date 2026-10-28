// Auditlog (nieuwste eerst) en export (back-up, §3): intern en vertrouwelijk als aparte bestanden.
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { Caps } from "../backend";
import { Button, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { backupAudit, backupConfidential, backupIntern, toJson } from "../backup";
import { errText, fmtTime, useBackend } from "../util";
import { Loading, Page } from "./common";

const PAGE = 100n;

/** "persoon-afgezet" → "Persoon stopgezet": woord voor woord via t.audit.words (stap 2b.5). */
function actionText(code: string): string {
  const out = code.split("-").map((w) => t.audit.words[w] ?? w).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function Audit({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const log = useInfiniteQuery({
    queryKey: ["audit"],
    queryFn: ({ pageParam }) => actor!.auditLog(pageParam, PAGE),
    initialPageParam: 0n,
    getNextPageParam: (last, all) => (BigInt(last.length) < PAGE ? undefined : BigInt(all.length) * PAGE),
    enabled: !!actor && !isFetching,
  });
  const persons = useQuery({ queryKey: ["persons", true], queryFn: () => actor!.listPersons(true), enabled: !!actor && !isFetching && caps.readTeam });
  const nameOf = (id: bigint) => persons.data?.find((p) => p.id === id)?.name;
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  // 1.9 V-02: de back-up in stukken (exportChunk), in dezelfde vorm als tests/herstel.mjs: zo kan het script een
  // back-up uit de browser terugzetten (docs/herstel.md §1). Elke collectie staat als "export-deel" in de auditlog.
  const download = (name: string, data: unknown) => {
    const url = URL.createObjectURL(new Blob([toJson(data)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exIntern = useMutation({ mutationFn: () => backupIntern(actor!), onSuccess: (d) => download(`intern-${stamp()}.json`, d), onError: fail });
  const exConf = useMutation({ mutationFn: () => backupConfidential(actor!), onSuccess: (d) => download(`vertrouwelijk-${stamp()}.json`, d), onError: fail });
  const exLog = useMutation({ mutationFn: () => backupAudit(actor!), onSuccess: (d) => download(`audit-${stamp()}.json`, d), onError: fail });
  const rows = (log.data?.pages.flat() ?? []).map((e, i) => ({ ...e, i }));
  return (
    <Page
      title={t.audit.title}
      actions={caps.export && (
        <>
          <Button busy={exIntern.isPending} onClick={() => exIntern.mutate()}>{t.audit.export}</Button>
          {caps.readConfidentialContact && <Button busy={exConf.isPending} onClick={() => exConf.mutate()}>{t.audit.exportConf}</Button>}
          <Button busy={exLog.isPending} onClick={() => exLog.mutate()}>{t.audit.exportLog}</Button>
        </>
      )}
    >
      <p className="a-note">{caps.readAudit ? t.audit.lead : t.audit.own}</p>
      <Loading q={log} />
      {rows.length > 0 && (
        <Table
          rows={rows}
          rowKey={(e) => String(e.i)}
          columns={[
            { key: "t", label: t.audit.when, render: (e) => <span className="bw-num">{fmtTime(e.at)}</span>, width: "150px" },
            { key: "a", label: t.audit.action, render: (e) => <span>{actionText(e.action)}</span> },
            { key: "d", label: t.audit.detail, render: (e) => e.detail || "—" },
            {
              key: "w",
              label: t.audit.who,
              render: (e) =>
                e.personId !== undefined ? (
                  <span title={e.who.toText()}>{nameOf(e.personId) ?? ""} <span className="bw-mono bw-muted">#{String(e.personId)}</span></span>
                ) : (
                  <span className="a-mono" title={e.who.toText()}>{t.audit.robot} · {e.who.toText().slice(0, 11)}…</span>
                ),
            },
          ]}
        />
      )}
      {log.hasNextPage && <Button busy={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>{t.common.more}</Button>}
    </Page>
  );
}
