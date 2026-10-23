// Werfpagina (stap 1.1): fiche, afgeleide feiten, contract (vertrouwelijk), team, documenten, bestanden.
// Wat iemand mag, zegt de backend per werf (WorkView.caps, Rights.mo); elke handeling wordt opnieuw nagekeken.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GuaranteeKind, Role, WorkStatus, type Caps, type ContractInput, type ContractView, type InvoicingRhythm, type WorkView } from "../backend";
import { Button, Choice, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, optText, parseEuro, parsePct, unwrap, useBackend } from "../util";
import { Loading, Page, RoleTags, useWorks, WorkBadge } from "./common";
import { Dossier } from "./Dossier";
import { AddMember, Field, Files, NewWork } from "./Werven";

export function WerfDetail({ id, caps, go }: { id: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const work = useQuery({ queryKey: ["work", String(id)], queryFn: () => actor!.getWork(id), enabled: on });
  const members = useQuery({ queryKey: ["members", String(id)], queryFn: () => actor!.listMembers(id), enabled: on && !!work.data, refetchOnWindowFocus: true });
  const works = useWorks();
  // Namen van klant, architect en werfleider: enkel voor interne rollen (team en organisaties lezen).
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && caps.readTeam });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newSub, setNewSub] = useState(false);
  const status = useMutation({
    mutationFn: async (s: WorkStatus) => unwrap(await actor!.setWorkStatus(id, s)),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const end = useMutation({
    mutationFn: async (mid: bigint) => unwrap(await actor!.endMembership(mid)),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });

  if (!work.data) {
    return (
      <Page title={t.werven.title} actions={<Button icon="back" onClick={() => go("werven")}>{t.common.back}</Button>}>
        <Loading q={work} />
      </Page>
    );
  }
  const w = work.data;
  const orgName = (oid?: bigint) => (oid === undefined ? t.common.none : orgs.data?.find((o) => o.id === oid)?.name ?? `#${oid}`);
  const personName = (pid?: bigint) => (pid === undefined ? t.werven.noLeader : persons.data?.find((p) => p.id === pid)?.name ?? members.data?.find((m) => m.personId === pid)?.name ?? `#${pid}`);
  const parent = w.parentId !== undefined ? works.data?.find((x) => x.id === w.parentId) : undefined;
  const subs = (works.data ?? []).filter((x) => x.parentId === w.id);
  const vcs = (members.data ?? []).filter((m) => m.role === Role.veiligheidscoordinator);
  const leaders = (members.data ?? []).filter((m) => m.role === Role.werfleider);
  const addr = [w.address.street, w.address.number].filter(Boolean).join(" ") + (w.address.city ? `, ${w.address.zip} ${w.address.city}` : "");

  return (
    <Page label={w.code} title={w.name} actions={<>
      {w.caps.edit && <Button icon="edit" onClick={() => setEditing(true)}>{t.werven.edit}</Button>}
      <Button icon="back" onClick={() => go("werven")}>{t.common.back}</Button>
    </>}>
      <div className="a-row">
        <WorkBadge status={w.status} />
        <span className="bw-muted">{addr}</span>
        <span className="a-tag">btw {Number(w.vatBp) / 100} %</span>
        {parent && <button type="button" className="a-tag a-tag--link" onClick={() => go(`werven/${parent.id}`)}>{t.werven.subOf} {parent.code}</button>}
      </div>
      {w.caps.edit && (
        <Choice label={t.werven.status} value={w.status} onChange={(s) => { if (s !== w.status && !status.isPending) status.mutate(s); }} options={[WorkStatus.request, WorkStatus.quoting, WorkStatus.planned, WorkStatus.running, WorkStatus.delivered, WorkStatus.aftercare, WorkStatus.cancelled].map((s) => ({ value: s, label: t.workStatus[s] }))} />
      )}

      <div className="a-cols">
        <section className="a-section">
          <h2 className="bw-h2">{t.werven.fiche}</h2>
          <dl className="a-dl">
            {caps.readTeam && <>
              <dt>{t.werven.client}</dt><dd>{orgs.data || w.clientOrgId === undefined ? orgName(w.clientOrgId) : "…"}</dd>
              <dt>{t.werven.architect}</dt><dd>{orgs.data || w.architectOrgId === undefined ? orgName(w.architectOrgId) : "…"}</dd>
            </>}
            <dt>{t.werven.leader}</dt><dd>{w.leaderPersonId === undefined && leaders.length ? leaders.map((m) => m.name).join(", ") : personName(w.leaderPersonId)}</dd>
            <dt>{t.werven.vc}</dt><dd>{vcs.length ? vcs.map((m) => m.name).join(", ") : <span className="a-tag a-tag--warn">{t.werven.noVc}</span>}</dd>
            <dt>{t.werven.period}</dt><dd className="bw-num">{w.plannedStart !== undefined || w.plannedEnd !== undefined ? `${fmtDayNum(w.plannedStart)} – ${fmtDayNum(w.plannedEnd)}` : t.common.none}</dd>
            <dt>{t.werven.vat}</dt><dd>{Number(w.vatBp) / 100} %{w.vatNote ? <span className="bw-muted"> · {w.vatNote}</span> : null}</dd>
            <dt>{t.werven.analytic}</dt><dd className="bw-mono">{w.analyticCode ?? <>{w.code} <span className="bw-muted">{t.werven.analyticSame}</span></>}</dd>
            {subs.length > 0 && <><dt>{t.werven.subs}</dt><dd className="a-row">{subs.map((s) => <button key={String(s.id)} type="button" className="a-tag a-tag--link" onClick={() => go(`werven/${s.id}`)}>{s.code}</button>)}</dd></>}
          </dl>
          {caps.createWork && w.parentId === undefined && <div><Button variant="quiet" icon="plus" onClick={() => setNewSub(true)}>{t.werven.newSub}</Button></div>}
          {w.facts && <Facts w={w} works={works.data ?? []} />}
        </section>
        {w.caps.contract && <Contract w={w} works={works.data ?? []} />}
      </div>

      <section className="a-section">
        <div className="a-row a-row--between">
          <h2 className="bw-h2">{t.werven.team}</h2>
          {w.caps.manageMembers && <Button icon="plus" onClick={() => setAdding(true)}>{t.werven.addMember}</Button>}
        </div>
        <p className="bw-muted">{t.werven.teamLead}</p>
        <Loading q={members} />
        {members.data && members.data.length === 0 && <p className="a-empty">—</p>}
        {members.data && members.data.length > 0 && (
          <ul className="a-list">
            {members.data.slice().sort((a, b) => roleOrder(a.role) - roleOrder(b.role)).map((m) => (
              <li key={String(m.id)}>
                <span className="a-list__main">
                  <b>{m.name}</b>
                  <span className="a-row"><RoleTags roles={[m.role]} />{m.archived && <span className="a-tag a-tag--bad">{t.werven.archivedMember}</span>}{m.orgId !== undefined && m.personId === undefined && <span className="a-tag">{t.werven.org}</span>}{m.grants.map((g) => <span key={g} className="a-tag">{t.grants[g] ?? g}</span>)}</span>
                </span>
                {w.caps.manageMembers && (m.role !== Role.werfleider || w.caps.setLeader) && <Button variant="quiet" busy={end.isPending && end.variables === m.id} onClick={() => end.mutate(m.id)}>{t.werven.endMember}</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dossier w={w} />
      <Files workId={id} canUpload={caps.upload && w.caps.upload} title={t.werven.loose} />

      {adding && <AddMember workId={id} allowLeader={w.caps.setLeader} onClose={() => setAdding(false)} />}
      {editing && <EditWork w={w} onClose={() => setEditing(false)} />}
      {newSub && <NewWork parent={w} onClose={() => setNewSub(false)} go={go} />}
    </Page>
  );
}

const ROLE_ORDER: string[] = [Role.werfleider, Role.veiligheidscoordinator, Role.architect, Role.klant, Role.onderaannemer];
const roleOrder = (r: string) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? 99 : i; };

/** De afgeleide feiten: wat de werfleider moet weten, zonder bedragen (R27). */
function Facts({ w, works }: { w: WorkView; works: WorkView[] }) {
  const f = w.facts!;
  if (!f.contractKnown) return <p className="a-note">{t.facts.unknown}</p>;
  const yn = (b?: boolean) => (b === undefined ? t.facts.unknownValue : b ? t.facts.yes : t.facts.no);
  const need = (b?: boolean) => (b === undefined ? <span className="a-tag a-tag--warn">{t.facts.unknownValue}</span> : b ? <span className="a-tag a-tag--accent">{t.facts.needed}</span> : <span className="a-tag">{t.facts.notNeeded}</span>);
  const from = f.inheritedFrom !== undefined ? works.find((x) => x.id === f.inheritedFrom)?.code ?? `#${f.inheritedFrom}` : null;
  return (
    <div className="a-facts">
      <span className="bw-label">{t.facts.title}{from ? ` · ${t.facts.inherited(from)}` : ""}</span>
      <dl className="a-dl">
        <dt>{t.facts.guarantee}</dt><dd>{yn(f.guarantee)}</dd>
        <dt>{t.facts.revision}</dt><dd>{yn(f.priceRevision)}</dd>
        <dt>{t.facts.art30bis}</dt><dd>{need(f.art30bis)}</dd>
        <dt>{t.facts.checkinatwork}</dt><dd>{need(f.checkinatwork)}</dd>
      </dl>
      <p className="bw-muted">{t.facts.help}</p>
    </div>
  );
}

/** Contractparameters: pas na een klik gelezen (update-call met auditregel), nooit in een cache (R23). */
function Contract({ w, works }: { w: WorkView; works: WorkView[] }) {
  const { actor } = useBackend();
  const [view, setView] = useState<ContractView | null>(null);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadHistory>> | null>(null);
  const loadHistory = async () => unwrap(await actor!.readContractHistory(w.id));
  const read = useMutation({ mutationFn: async () => unwrap(await actor!.readContract(w.id)), onSuccess: setView });
  const hist = useMutation({ mutationFn: loadHistory, onSuccess: setHistory });
  // Weg bij het verlaten van de werf: niets vertrouwelijks blijft in het geheugen hangen.
  useEffect(() => () => { setView(null); setHistory(null); }, [w.id]);
  const code = (id?: bigint) => works.find((x) => x.id === id)?.code ?? `#${id}`;
  const k = view?.contract;
  return (
    <section className="a-section a-confidential">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.contract.title}</h2>
        <span className="a-tag a-tag--warn">{t.werven.confidential}</span>
      </div>
      <p className="bw-muted">{t.contract.lead}</p>
      {!view && <div><Button icon="key" busy={read.isPending} onClick={() => read.mutate()}>{t.contract.show}</Button></div>}
      {read.error && <p className="a-err" role="alert">{errText(read.error)}</p>}
      {view && (
        <>
          {view.inheritedFrom !== undefined && <p className="a-note">{t.contract.inherited(code(view.inheritedFrom))}</p>}
          {view.sealed && <p className="a-note">{t.contract.sealed}</p>}
          {!k && !view.sealed && <p className="a-empty">{t.contract.empty}</p>}
          {k && (
            <dl className="a-dl">
              <dt>{t.contract.amount}</dt><dd className="bw-num">{fmtEuro(k.estimatedAmountCents)}</dd>
              <dt>{t.contract.revision}</dt><dd>{k.priceRevision.__kind__ === "formula" ? <span className="bw-mono">{k.priceRevision.formula}</span> : t.contract.revisionNone}</dd>
              <dt>{t.contract.guarantee}</dt><dd>{t.contract.guaranteeKinds[k.guarantee]}{k.guarantee !== GuaranteeKind.none ? ` · ${fmtBp(k.guaranteeBp)}` : ""}</dd>
              <dt>{t.contract.term}</dt><dd className="bw-num">{t.contract.days(String(k.paymentTermDays))}</dd>
              <dt>{t.contract.rhythm}</dt><dd>{k.invoicingRhythm.__kind__ === "other" ? k.invoicingRhythm.other : t.contract.rhythms[k.invoicingRhythm.__kind__]}</dd>
              {k.note && <><dt>{t.contract.note}</dt><dd>{k.note}</dd></>}
              {view.clientContact && view.clientContact.name && <><dt>{t.contract.contact}</dt><dd>{[view.clientContact.name, view.clientContact.phone, view.clientContact.email].filter(Boolean).join(" · ")}</dd></>}
              {view.notes && <><dt>{t.contract.notes}</dt><dd>{view.notes}</dd></>}
            </dl>
          )}
          {view.version > 0n && view.updatedAt !== undefined && <p className="bw-muted bw-num">{t.contract.version(String(view.version), view.updatedByName, fmtTime(view.updatedAt))}</p>}
          <div className="a-row">
            {!view.sealed && <Button icon="edit" onClick={() => setEditing(true)}>{t.contract.edit}</Button>}
            {view.version > 0n && view.inheritedFrom === undefined && <Button variant="quiet" busy={hist.isPending} onClick={() => hist.mutate()}>{t.contract.history}</Button>}
            <Button variant="quiet" onClick={() => { setView(null); setHistory(null); }}>{t.contract.hide}</Button>
          </div>
          {history && (
            <ul className="a-list">
              {history.slice().reverse().map((h) => (
                <li key={String(h.version)}>
                  <span className="a-list__main">
                    <b className="bw-num">v{String(h.version)} · {fmtEuro(h.contract?.estimatedAmountCents)}</b>
                    <span className="bw-muted bw-num">{h.byName} · {fmtTime(h.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {editing && view && <EditContract w={w} view={view} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setHistory(null); read.mutate(); }} />}
    </section>
  );
}

function EditContract({ w, view, onClose, onSaved }: { w: WorkView; view: ContractView; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const k = view.contract;
  const [f, setF] = useState({
    amount: k?.estimatedAmountCents !== undefined ? (Number(k.estimatedAmountCents) / 100).toLocaleString("nl-BE", { minimumFractionDigits: 2 }) : "",
    revision: k?.priceRevision.__kind__ ?? "none",
    formula: k?.priceRevision.__kind__ === "formula" ? k.priceRevision.formula : "",
    guarantee: k?.guarantee ?? GuaranteeKind.none,
    pct: k && k.guaranteeBp > 0n ? (Number(k.guaranteeBp) / 100).toLocaleString("nl-BE") : "",
    term: k ? String(k.paymentTermDays) : "30",
    rhythm: (k?.invoicingRhythm.__kind__ ?? "perProgress") as InvoicingRhythm["__kind__"],
    rhythmOther: k?.invoicingRhythm.__kind__ === "other" ? k.invoicingRhythm.other : "",
    note: k?.note ?? "",
    cName: view.clientContact?.name ?? "",
    cPhone: view.clientContact?.phone ?? "",
    cEmail: view.clientContact?.email ?? "",
    notes: view.notes ?? "",
  });
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [key]: e.target.value });
  // Een overgenomen contract (deelwerf) wordt een eigen contract: versie 0.
  const expected = view.inheritedFrom !== undefined ? 0n : view.version;
  const save = useMutation({
    mutationFn: async () => {
      const amount = parseEuro(f.amount);
      if (amount === null) throw new Error(t.contract.amount + ": ongeldig bedrag");
      const pct = f.guarantee === GuaranteeKind.none ? 0n : parsePct(f.pct);
      if (pct === null) throw new Error(t.contract.guaranteePct + ": ongeldig percentage");
      if (!/^\d{1,3}$/.test(f.term.trim())) throw new Error(t.contract.term + ": een getal");
      const rhythm: InvoicingRhythm = f.rhythm === "other" ? { __kind__: "other", other: f.rhythmOther } : ({ __kind__: f.rhythm, [f.rhythm]: null } as InvoicingRhythm);
      const input: ContractInput = {
        contract: {
          estimatedAmountCents: amount,
          priceRevision: f.revision === "formula" ? { __kind__: "formula", formula: f.formula } : { __kind__: "none", none: null },
          guarantee: f.guarantee,
          guaranteeBp: pct,
          paymentTermDays: BigInt(f.term.trim()),
          invoicingRhythm: rhythm,
          signedQuoteVersionId: undefined,
          note: f.note,
        },
        clientContact: f.cName || f.cPhone || f.cEmail ? { name: f.cName, phone: optText(f.cPhone), email: optText(f.cEmail), address: undefined } : undefined,
        notes: f.notes,
      };
      return unwrap(await actor!.setContract(w.id, input, expected));
    },
    // De feiten bepalen ook de checklist (30bis, Checkinatwork) van deze werf en van haar deelwerven.
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["work"] }); void qc.invalidateQueries({ queryKey: ["works"] }); void qc.invalidateQueries({ queryKey: ["dossier"] }); onSaved(); },
  });
  return (
    <Sheet title={`${t.contract.title} · ${w.code}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={t.contract.amount}><input className="bw-input bw-num" value={f.amount} onChange={set("amount")} inputMode="decimal" placeholder="45.000,00" /></Field>
        <p className="bw-muted">{t.contract.amountHelp}</p>
        <Field label={t.contract.revision}>
          <Choice label={t.contract.revision} value={f.revision} onChange={(v) => setF({ ...f, revision: v })} options={[{ value: "none", label: t.contract.revisionNone }, { value: "formula", label: t.contract.revisionFormula }]} />
        </Field>
        {f.revision === "formula" && <Field label={t.contract.formula}><input className="bw-input bw-mono" value={f.formula} onChange={set("formula")} placeholder={t.contract.formulaPh} /></Field>}
        <Field label={t.contract.guarantee}>
          <Choice label={t.contract.guarantee} value={f.guarantee} onChange={(v) => setF({ ...f, guarantee: v })} options={[GuaranteeKind.none, GuaranteeKind.retention, GuaranteeKind.bankGuarantee].map((g) => ({ value: g, label: t.contract.guaranteeKinds[g] }))} />
        </Field>
        {f.guarantee !== GuaranteeKind.none && <Field label={t.contract.guaranteePct}><input className="bw-input bw-num" style={{ maxWidth: 120 }} value={f.pct} onChange={set("pct")} inputMode="decimal" placeholder="5" /></Field>}
        <div className="a-grid2">
          <Field label={t.contract.term}><input className="bw-input bw-num" value={f.term} onChange={set("term")} inputMode="numeric" /></Field>
          <Field label={t.contract.rhythm}>
            <select className="bw-input" value={f.rhythm} onChange={(e) => setF({ ...f, rhythm: e.target.value as InvoicingRhythm["__kind__"] })}>
              {(["monthly", "perPhase", "perProgress", "other"] as const).map((r) => <option key={r} value={r}>{t.contract.rhythms[r]}</option>)}
            </select>
          </Field>
        </div>
        {f.rhythm === "other" && <Field label={t.contract.rhythmOther}><input className="bw-input" value={f.rhythmOther} onChange={set("rhythmOther")} /></Field>}
        <Field label={t.contract.note}><input className="bw-input" value={f.note} onChange={set("note")} /></Field>
        <span className="bw-label">{t.contract.contact}</span>
        <div className="a-grid3">
          <Field label={t.contract.contactName}><input className="bw-input" value={f.cName} onChange={set("cName")} /></Field>
          <Field label={t.team.phone}><input className="bw-input" value={f.cPhone} onChange={set("cPhone")} inputMode="tel" /></Field>
          <Field label={t.orgs.email}><input className="bw-input" value={f.cEmail} onChange={set("cEmail")} inputMode="email" /></Field>
        </div>
        <Field label={t.contract.notes}><textarea className="bw-input" rows={3} value={f.notes} onChange={set("notes")} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

function EditWork({ w, onClose }: { w: WorkView; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const works = useWorks();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && w.caps.setLeader });
  const [f, setF] = useState({
    code: w.code,
    name: w.name,
    street: w.address.street,
    number: w.address.number,
    zip: w.address.zip,
    city: w.address.city,
    vat: Number(w.vatBp),
    vatNote: w.vatNote,
    analytic: w.analyticCode ?? "",
    start: dayToInput(w.plannedStart),
    end: dayToInput(w.plannedEnd),
    client: w.clientOrgId !== undefined ? String(w.clientOrgId) : "",
    architect: w.architectOrgId !== undefined ? String(w.architectOrgId) : "",
    parent: w.parentId !== undefined ? String(w.parentId) : "",
    leader: w.leaderPersonId !== undefined ? String(w.leaderPersonId) : "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const big = (s: string) => (s === "" ? undefined : BigInt(s));
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.updateWork(w.id, {
        code: f.code,
        name: f.name,
        address: { ...w.address, street: f.street, number: f.number, zip: f.zip, city: f.city },
        parentId: big(f.parent),
        clientOrgId: big(f.client),
        architectOrgId: big(f.architect),
        leaderPersonId: big(f.leader),
        vatBp: BigInt(f.vat),
        plannedStart: inputToDay(f.start),
        plannedEnd: inputToDay(f.end),
        analyticCode: optText(f.analytic),
        vatNote: f.vatNote,
      })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); onClose(); },
  });
  const orgOpts = (kind: string) => (orgs.data ?? []).filter((o) => o.kind === kind);
  // Mogelijke hoofdwerven: zelfstandige werven, niet deze, en niet als deze werf zelf deelwerven heeft.
  const hasSubs = (works.data ?? []).some((x) => x.parentId === w.id);
  const parents = (works.data ?? []).filter((x) => x.parentId === undefined && x.id !== w.id);
  return (
    <Sheet title={`${t.werven.edit} · ${w.code}`} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={t.werven.code}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} /></Field>
          <Field label={t.werven.analytic}><input className="bw-input bw-mono" value={f.analytic} onChange={set("analytic")} placeholder={f.code} /></Field>
        </div>
        <p className="bw-muted">{t.werven.analyticHelp}</p>
        <Field label={t.werven.name}><input className="bw-input" value={f.name} onChange={set("name")} /></Field>
        <div className="a-grid3">
          <Field label={t.werven.street}><input className="bw-input" value={f.street} onChange={set("street")} /></Field>
          <Field label={t.werven.number}><input className="bw-input" value={f.number} onChange={set("number")} /></Field>
          <Field label={t.werven.zip}><input className="bw-input" value={f.zip} onChange={set("zip")} inputMode="numeric" /></Field>
        </div>
        <Field label={t.werven.city}><input className="bw-input" value={f.city} onChange={set("city")} /></Field>
        <Field label={t.werven.vat}><Choice label={t.werven.vat} value={f.vat} onChange={(v) => setF({ ...f, vat: v })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} /></Field>
        <Field label={t.werven.vatNote}><input className="bw-input" value={f.vatNote} onChange={set("vatNote")} placeholder={t.werven.vatNotePh} /></Field>
        <div className="a-grid2">
          <Field label={t.werven.start}><input type="date" className="bw-input bw-num" value={f.start} onChange={set("start")} /></Field>
          <Field label={t.werven.end}><input type="date" className="bw-input bw-num" value={f.end} onChange={set("end")} /></Field>
        </div>
        <div className="a-grid2">
          <Field label={t.werven.client}>
            <select className="bw-input" value={f.client} onChange={set("client")}>
              <option value="">{t.werven.noOrgPick}</option>
              {orgOpts("client").map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
          </Field>
          <Field label={t.werven.architect}>
            <select className="bw-input" value={f.architect} onChange={set("architect")}>
              <option value="">{t.werven.noOrgPick}</option>
              {orgOpts("architect").map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t.werven.leader}>
          {w.caps.setLeader ? (
            <select className="bw-input" value={f.leader} onChange={set("leader")}>
              <option value="">{t.werven.noLeader}</option>
              {(persons.data ?? []).filter((p) => p.roles.includes(Role.werfleider)).map((p) => <option key={String(p.id)} value={String(p.id)}>{p.name}</option>)}
            </select>
          ) : <span className="bw-muted">{t.werven.leaderAdminOnly}</span>}
        </Field>
        {!hasSubs && (
          <Field label={t.werven.parent}>
            <select className="bw-input" value={f.parent} onChange={set("parent")}>
              <option value="">{t.werven.noParent}</option>
              {parents.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.code} · {x.name}</option>)}
            </select>
          </Field>
        )}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}
