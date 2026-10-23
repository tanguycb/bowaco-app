// Uitnodigings- en herstelcodes: alleen de hint (laatste 2 tekens), nooit de code. Intrekken werkt meteen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Caps, PersonView } from "../backend";
import { Button, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";

export function Codes({ caps, me }: { caps: Caps; me: PersonView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const codes = useQuery({ queryKey: ["invites"], queryFn: () => actor!.listInvites(0n, 200n), enabled: !!actor && !isFetching });
  const revoke = useMutation({
    mutationFn: async (id: bigint) => unwrap(await actor!.revokeInvite(id)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const now = BigInt(Date.now()) * 1_000_000n;
  return (
    <Page title={t.codes.title}>
      <p className="a-note">{t.codes.lead}</p>
      <Loading q={codes} />
      {codes.data && codes.data.length === 0 && <p className="a-empty">{t.codes.empty}</p>}
      {codes.data && codes.data.length > 0 && (
        <Table
          rows={codes.data}
          rowKey={(c) => String(c.id)}
          columns={[
            { key: "p", label: t.team.name, render: (c) => <b>{c.personName}</b> },
            { key: "k", label: "Soort", render: (c) => t.codes.kind[c.kind] ?? c.kind },
            { key: "h", label: "Code", render: (c) => <span className="bw-mono">…{c.hint}</span> },
            {
              key: "s",
              label: "Stand",
              render: (c) => {
                const k = c.state.__kind__ === "open" && c.expiresAt < now ? "expired" : c.state.__kind__;
                return <span className={`a-tag${k === "open" ? " a-tag--accent" : k === "used" ? " a-tag--ok" : ""}`}>{t.codes.state[k]}</span>;
              },
            },
            { key: "e", label: t.team.expires, render: (c) => <span className="bw-num">{fmtTime(c.expiresAt)}</span> },
            { key: "n", label: t.team.tag, render: (c) => c.tag || "—" },
            {
              key: "x",
              label: "",
              render: (c) =>
                c.state.__kind__ === "open" && c.expiresAt > now && (caps.manageAccess || c.createdBy === me.id) ? (
                  <Button variant="quiet" busy={revoke.isPending && revoke.variables === c.id} onClick={() => revoke.mutate(c.id)}>{t.codes.revoke}</Button>
                ) : null,
            },
          ]}
        />
      )}
    </Page>
  );
}
