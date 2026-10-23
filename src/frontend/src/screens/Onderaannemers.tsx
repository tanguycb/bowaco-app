// Onderaannemers-database (1.2): firma's met codes uit de planning, vakgebieden, contactgegevens en
// contactpersonen. Intern (architectuur §3): alleen interne rollen lezen, beheerder en werfleider beheren.
// Klantcontact staat hier niet; dat blijft vertrouwelijk bij Organisaties.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { OrgKind, type Caps, type OaPersonView, type OaView, type TradeView } from "../backend";
import { Button, Choice, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, optText, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const KINDS: OrgKind[] = [OrgKind.subcontractor, OrgKind.supplier, OrgKind.authority, OrgKind.architect, OrgKind.other];

function useTrades() {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["trades", true], queryFn: () => actor!.listTrades(true), enabled: !!actor && !isFetching });
}

export function Onderaannemers({ caps }: { caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<bigint | "new" | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setQ(text), 200);
    return () => clearTimeout(h);
  }, [text]);
  const trades = useTrades();
  const tradeName = (k: string) => trades.data?.find((x) => x.key === k)?.name ?? k;
  const list = useQuery({
    queryKey: ["oas", q, trade, kind],
    queryFn: () => actor!.listOas({ text: optText(q), trade: trade || undefined, kind: (kind || undefined) as OrgKind | undefined, includeArchived: false }),
    enabled: !!actor && !isFetching,
    placeholderData: (prev) => prev,
  });
  const filtered = q !== "" || trade !== "" || kind !== "";
  return (
    <Page title={t.oa.title} actions={caps.manageOa && <Button variant="primary" icon="plus" onClick={() => setOpen("new")}>{t.oa.new}</Button>}>
      <p className="bw-muted" style={{ maxWidth: 720 }}>{t.oa.lead}</p>
      <div className="a-grid3">
        <input className="bw-input" type="search" aria-label={t.oa.search} placeholder={t.oa.search} value={text} onChange={(e) => setText(e.target.value)} />
        <select className="bw-input" aria-label={t.oa.trades} value={trade} onChange={(e) => setTrade(e.target.value)}>
          <option value="">{t.oa.allTrades}</option>
          {trades.data?.filter((x) => !x.archived).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        <select className="bw-input" aria-label={t.oa.kind} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t.oa.allKinds}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t.orgKinds[k]}</option>)}
        </select>
      </div>
      <Loading q={list} />
      {list.data && <span className="bw-label" role="status">{t.oa.count(list.data.length)}</span>}
      {list.data && list.data.length === 0 && <p className="a-empty">{filtered ? t.oa.noMatch : t.oa.empty}</p>}
      {list.data && list.data.length > 0 && (
        <Table
          rows={list.data}
          rowKey={(v) => String(v.org.id)}
          onRow={(v) => setOpen(v.org.id)}
          columns={[
            { key: "n", label: t.oa.name, render: (v) => <span><b>{v.org.name}</b><br /><span className="bw-muted">{t.orgKinds[v.org.kind]}</span></span> },
            { key: "t", label: t.oa.trades, render: (v) => (v.org.trades.length ? <span className="a-row">{v.org.trades.map((k) => <span key={k} className="a-tag">{tradeName(k)}</span>)}</span> : <span className="bw-muted">{t.oa.noTrades}</span>) },
            { key: "a", label: t.orgs.aliases.replace(" (komma's)", ""), render: (v) => <span className="bw-mono">{v.org.aliases.join(", ") || "—"}</span> },
            { key: "c", label: t.oa.contact.replace(" van de firma", ""), render: (v) => <ContactCell v={v} /> },
          ]}
        />
      )}
      {open !== null && <OaSheet id={open} caps={caps} trades={trades.data ?? []} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function ContactCell({ v }: { v: OaView }) {
  const bits = [v.contact?.phone, v.contact?.email].filter(Boolean) as string[];
  const people = v.persons.filter((p) => p.archivedAt === undefined);
  return (
    <span>
      {bits.length ? bits.join(" · ") : <span className="bw-muted">—</span>}
      {people.length > 0 && <><br /><span className="bw-muted">{people.map((p) => p.name).slice(0, 3).join(", ")}{people.length > 3 ? ` +${people.length - 3}` : ""}</span></>}
    </span>
  );
}

function OaSheet({ id, caps, trades, onClose }: { id: bigint | "new"; caps: Caps; trades: TradeView[]; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const [current, setCurrent] = useState<bigint | "new">(id);
  const one = useQuery({ queryKey: ["oa", String(current)], queryFn: async () => unwrap(await actor!.getOa(current as bigint)), enabled: !!actor && !isFetching && current !== "new" });
  const v = current === "new" ? null : one.data ?? null;
  return (
    <Sheet title={v ? v.org.name : t.oa.new} open onClose={onClose} side>
      {current !== "new" && <Loading q={one} />}
      {(current === "new" || v) && (
        <div className="a-form">
          <Firm v={v} canEdit={caps.manageOa} trades={trades} onSaved={(nid) => setCurrent(nid)} />
          {v ? (
            <>
              <Contact v={v} canEdit={caps.manageOa} />
              <Persons v={v} canEdit={caps.manageOa} />
            </>
          ) : (
            <p className="bw-muted">{t.oa.newFirstHint}</p>
          )}
          <p className="bw-muted">{t.oa.internalNote}</p>
        </div>
      )}
    </Sheet>
  );
}

function Firm({ v, canEdit, trades, onSaved }: { v: OaView | null; canEdit: boolean; trades: TradeView[]; onSaved: (id: bigint) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const o = v?.org;
  const [f, setF] = useState({ kind: o?.kind ?? OrgKind.subcontractor, name: o?.name ?? "", kbo: o?.kbo ?? "", vat: o?.vat ?? "", aliases: o?.aliases.join(", ") ?? "", notes: o?.notes ?? "", trades: o?.trades ?? ([] as string[]) });
  const save = useMutation({
    mutationFn: async () => {
      const input = { kind: f.kind, name: f.name, kbo: optText(f.kbo), vat: optText(f.vat), aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean), trades: f.trades, address: o?.address, notes: f.notes };
      return unwrap(o ? await actor!.updateOrg(o.id, input) : await actor!.createOrg(input));
    },
    onSuccess: (r) => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["oas"] }); void qc.invalidateQueries({ queryKey: ["oa"] }); void qc.invalidateQueries({ queryKey: ["orgs"] }); onSaved(r.id); },
  });
  const toggle = (k: string) => setF({ ...f, trades: f.trades.includes(k) ? f.trades.filter((x) => x !== k) : [...f.trades, k] });
  const shown = [...trades.filter((x) => !x.archived || f.trades.includes(x.key))];
  return (
    <section className="a-section">
      <Field label={t.oa.kind}><Choice label={t.oa.kind} value={f.kind} onChange={(k) => setF({ ...f, kind: k })} options={KINDS.map((k) => ({ value: k, label: t.orgKinds[k] }))} /></Field>
      <Field label={t.oa.name}><input className="bw-input" value={f.name} maxLength={80} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="a-grid2">
        <Field label={t.oa.kbo}><input className="bw-input bw-mono" value={f.kbo} disabled={!canEdit} placeholder="0123.456.789" onChange={(e) => setF({ ...f, kbo: e.target.value })} /></Field>
        <Field label={t.oa.vat}><input className="bw-input bw-mono" value={f.vat} disabled={!canEdit} onChange={(e) => setF({ ...f, vat: e.target.value })} /></Field>
      </div>
      <Field label={t.oa.aliases}><input className="bw-input bw-mono" value={f.aliases} disabled={!canEdit} placeholder="ANNA, AN" onChange={(e) => setF({ ...f, aliases: e.target.value })} /></Field>
      <span className="bw-muted">{t.oa.aliasesHelp}</span>
      <span className="bw-label">{t.oa.trades}</span>
      <div className="a-row" role="group" aria-label={t.oa.trades}>
        {shown.map((x) => (
          <button key={x.key} type="button" disabled={!canEdit} className={`a-tag a-tag--link${f.trades.includes(x.key) ? " a-tag--accent" : ""}`} aria-pressed={f.trades.includes(x.key)} onClick={() => toggle(x.key)} style={{ minHeight: 32 }}>
            {x.name}{x.archived ? ` (${t.oa.tradeArchived})` : ""}
          </button>
        ))}
      </div>
      <Field label={t.oa.notes}><textarea className="bw-input" value={f.notes} maxLength={1000} disabled={!canEdit} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      {canEdit && <div><Button variant="primary" busy={save.isPending} disabled={f.name.trim() === ""} onClick={() => save.mutate()}>{t.oa.saveFirm}</Button></div>}
    </section>
  );
}

function Contact({ v, canEdit }: { v: OaView; canEdit: boolean }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const c = v.contact;
  const [f, setF] = useState({ phone: c?.phone ?? "", email: c?.email ?? "", website: c?.website ?? "", contactNote: c?.contactNote ?? "" });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveOrgContact(v.org.id, { phone: optText(f.phone), email: optText(f.email), website: optText(f.website), contactNote: f.contactNote })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["oas"] }); void qc.invalidateQueries({ queryKey: ["oa"] }); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="a-section">
      <h2 className="bw-h2">{t.oa.contact}</h2>
      <div className="a-grid2">
        <Field label={t.oa.phone}><input className="bw-input" type="tel" value={f.phone} maxLength={30} disabled={!canEdit} onChange={set("phone")} /></Field>
        <Field label={t.oa.email}><input className="bw-input" type="email" value={f.email} maxLength={120} disabled={!canEdit} onChange={set("email")} /></Field>
      </div>
      <Field label={t.oa.website}><input className="bw-input" value={f.website} maxLength={120} disabled={!canEdit} onChange={set("website")} /></Field>
      <Field label={t.oa.contactNote}><textarea className="bw-input" value={f.contactNote} maxLength={1000} disabled={!canEdit} onChange={set("contactNote")} /></Field>
      {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      {canEdit && <div><Button variant="secondary" busy={save.isPending} onClick={() => save.mutate()}>{t.oa.saveContact}</Button></div>}
    </section>
  );
}

function Persons({ v, canEdit }: { v: OaView; canEdit: boolean }) {
  const [edit, setEdit] = useState<OaPersonView | "new" | null>(null);
  const people = v.persons.filter((p) => p.archivedAt === undefined);
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.oa.persons}</h2>
        {canEdit && <Button icon="plus" onClick={() => setEdit("new")}>{t.oa.addPerson}</Button>}
      </div>
      {people.length === 0 && <p className="a-empty">{t.oa.noPersons}</p>}
      {people.length > 0 && (
        <ul className="a-list">
          {people.map((p) => (
            <li key={String(p.id)}>
              <span className="a-list__main">
                <b>{p.name}{p.shortCode ? <> <span className="a-tag">{p.shortCode}</span></> : null}</b>
                <span className="bw-muted">{[p.jobTitle, p.phone, p.email].filter(Boolean).join(" · ") || "—"}</span>
                <span className="bw-muted">{p.hasLogin ? t.oa.hasLogin : t.oa.noLogin}</span>
              </span>
              {canEdit && <Button variant="quiet" onClick={() => setEdit(p)}>{t.team.edit}</Button>}
            </li>
          ))}
        </ul>
      )}
      {edit && <PersonForm orgId={v.org.id} p={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function PersonForm({ orgId, p, onClose }: { orgId: bigint; p: OaPersonView | null; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: p?.name ?? "", shortCode: p?.shortCode ?? "", phone: p?.phone ?? "", email: p?.email ?? "", jobTitle: p?.jobTitle ?? "", note: p?.note ?? "" });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveOaPerson(orgId, { id: p?.id, name: f.name, shortCode: optText(f.shortCode), phone: optText(f.phone), email: optText(f.email), jobTitle: f.jobTitle, note: f.note })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["oas"] }); void qc.invalidateQueries({ queryKey: ["oa"] }); void qc.invalidateQueries({ queryKey: ["persons"] }); onClose(); },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={p ? t.oa.editPerson : t.oa.addPerson} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={f.name.trim() === ""} onClick={() => save.mutate()}>{t.oa.savePerson}</Button></>}>
      <div className="a-form">
        <Field label={t.oa.personName}><input className="bw-input" value={f.name} maxLength={80} onChange={set("name")} /></Field>
        <div className="a-grid2">
          <Field label={t.oa.shortCode}><input className="bw-input bw-mono" value={f.shortCode} maxLength={20} onChange={set("shortCode")} /></Field>
          <Field label={t.oa.jobTitle}><input className="bw-input" value={f.jobTitle} maxLength={60} onChange={set("jobTitle")} /></Field>
        </div>
        <div className="a-grid2">
          <Field label={t.oa.phone}><input className="bw-input" type="tel" value={f.phone} maxLength={30} onChange={set("phone")} /></Field>
          <Field label={t.oa.email}><input className="bw-input" type="email" value={f.email} maxLength={120} onChange={set("email")} /></Field>
        </div>
        <Field label={t.oa.note}><textarea className="bw-input" value={f.note} maxLength={1000} onChange={set("note")} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}
