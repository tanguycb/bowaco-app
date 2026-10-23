// Organisaties (OA-firma's, architecten, klanten …). Klantcontact is vertrouwelijk: lezen via een
// update-call die in de auditlog komt (R23, R27), nooit gecachet buiten deze pagina.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { OrgKind, type Caps, type ContactConfidentialView, type OrgView } from "../backend";
import { Button, Choice, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, optText, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const KINDS: OrgKind[] = [OrgKind.subcontractor, OrgKind.architect, OrgKind.client, OrgKind.supplier, OrgKind.authority, OrgKind.other];

export function Organisaties({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const [open, setOpen] = useState<OrgView | "new" | null>(null);
  return (
    <Page title={t.orgs.title} actions={caps.manageOrgs && <Button variant="primary" icon="plus" onClick={() => setOpen("new")}>{t.orgs.new}</Button>}>
      <Loading q={orgs} />
      {orgs.data && orgs.data.length === 0 && <p className="a-empty">{t.orgs.empty}</p>}
      {orgs.data && orgs.data.length > 0 && (
        <Table
          rows={orgs.data}
          rowKey={(o) => String(o.id)}
          onRow={caps.manageOrgs || caps.readConfidentialContact ? setOpen : undefined}
          columns={[
            { key: "n", label: t.orgs.name, render: (o) => <b>{o.name}</b> },
            { key: "k", label: t.orgs.kind, render: (o) => t.orgKinds[o.kind] },
            { key: "a", label: t.orgs.aliases, render: (o) => <span className="bw-mono">{o.aliases.join(", ") || "—"}</span> },
            { key: "b", label: t.orgs.kbo, render: (o) => <span className="bw-mono">{o.kbo ?? "—"}</span> },
          ]}
        />
      )}
      {open && <OrgSheet org={open === "new" ? null : open} caps={caps} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function OrgSheet({ org, caps, onClose }: { org: OrgView | null; caps: Caps; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    kind: org?.kind ?? OrgKind.subcontractor,
    name: org?.name ?? "",
    kbo: org?.kbo ?? "",
    vat: org?.vat ?? "",
    aliases: org?.aliases.join(", ") ?? "",
    notes: org?.notes ?? "",
  });
  const input = () => ({
    kind: f.kind,
    name: f.name,
    kbo: optText(f.kbo),
    vat: optText(f.vat),
    aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean),
    trades: org?.trades ?? [],
    address: org?.address,
    notes: f.notes,
  });
  const save = useMutation({
    mutationFn: async () => unwrap(org ? await actor!.updateOrg(org.id, input()) : await actor!.createOrg(input())),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["orgs"] }); onClose(); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={org ? org.name : t.orgs.new} open onClose={onClose} side footer={caps.manageOrgs && <><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={t.orgs.kind}><Choice label={t.orgs.kind} value={f.kind} onChange={(k) => setF({ ...f, kind: k })} options={KINDS.map((k) => ({ value: k, label: t.orgKinds[k] }))} /></Field>
        <Field label={t.orgs.name}><input className="bw-input" value={f.name} onChange={set("name")} maxLength={80} /></Field>
        <div className="a-grid2">
          <Field label={t.orgs.kbo}><input className="bw-input bw-mono" value={f.kbo} onChange={set("kbo")} placeholder="0123.456.789" /></Field>
          <Field label={t.orgs.vat}><input className="bw-input bw-mono" value={f.vat} onChange={set("vat")} /></Field>
        </div>
        <Field label={t.orgs.aliases}><input className="bw-input bw-mono" value={f.aliases} onChange={set("aliases")} placeholder="KEVIN, KDS" /></Field>
        <Field label={t.orgs.notes}><textarea className="bw-input" value={f.notes} onChange={set("notes")} maxLength={1000} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
        {org && caps.readConfidentialContact && <Confidential orgId={org.id} />}
      </div>
    </Sheet>
  );
}

/** Pas na een klik ophalen: elk bekijken is een auditregel. Alleen in het geheugen van deze pagina. */
function Confidential({ orgId }: { orgId: bigint }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [view, setView] = useState<ContactConfidentialView | null>(null);
  const [c, setC] = useState({ name: "", phone: "", email: "", notes: "" });
  const show = useMutation({
    mutationFn: async () => unwrap(await actor!.readOrgConfidential(orgId)),
    onSuccess: (v) => { setView(v); setC({ name: v.contact?.name ?? "", phone: v.contact?.phone ?? "", email: v.contact?.email ?? "", notes: v.notes ?? "" }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.setOrgConfidential(orgId, { name: c.name, phone: optText(c.phone), email: optText(c.email) }, c.notes)),
    onSuccess: () => toast.show({ kind: "ok", text: t.common.saved }),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-stack">
      <h3 className="bw-h3">{t.orgs.confidential}</h3>
      <p className="bw-muted">{t.orgs.confidentialLead}</p>
      {!view ? (
        <Button icon="key" busy={show.isPending} onClick={() => show.mutate()}>{t.orgs.show}</Button>
      ) : (
        <>
          <Field label={t.orgs.contactName}><input className="bw-input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <div className="a-grid2">
            <Field label={t.team.phone}><input className="bw-input" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
            <Field label={t.orgs.email}><input className="bw-input" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
          </div>
          <Field label={t.orgs.notes}><textarea className="bw-input" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
          <Button busy={save.isPending} onClick={() => save.mutate()}>{t.common.save} ({t.orgs.confidential.toLowerCase()})</Button>
        </>
      )}
    </section>
  );
}
