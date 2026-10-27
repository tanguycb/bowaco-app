// Stap 2b.1: Firma's & contacten (vroeger Organisaties + Onderaannemers). Eén adresboek met de soort als filter en één
// firmafiche: contactpersonen (met planningcode en Toegang geven), werven, gegevens (KBO, btw, adres, vakgebieden,
// planningcodes), het vertrouwelijk klantcontact (klant: lezen via een update-call met auditregel, R23/R27) en de
// weekmail (OA). Enkel interne rollen; wat iemand mag aanpassen, zeggen de caps (Rights.mo).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { OrgKind, WorkStatus, type Caps, type ContactConfidentialView, type MailPreview, type OaPersonView, type OaView, type OrgView, type PersonView, type TradeView } from "../backend";
import { Button, Choice, Icon, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, optText, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page, useWorks, WorkPhase } from "./common";
import { Field } from "./Werven";
import { PersonSheet } from "./Team";
import { NieuwMetToegang, ToegangGeven, useLoginState } from "./Toegang";

const A = t.adresboek;
/** De soorten in het adresboek (BOWACO zelf staat in Team). */
export const KINDS: OrgKind[] = [OrgKind.client, OrgKind.subcontractor, OrgKind.supplier, OrgKind.architect, OrgKind.safetyCoordinator, OrgKind.authority, OrgKind.other];
/** Firma's met contactgegevens en contactpersonen in de OA-database (Oa.inDirectory): alles behalve klanten. */
const inDirectory = (k: OrgKind) => k !== OrgKind.client && k !== OrgKind.bowaco;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nextMonday = () => { const d = todayDay(); const wd = (Number(d) + 3) % 7; return d + BigInt(7 - wd); };

function useAdresboek() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const oas = useQuery({ queryKey: ["oas", "", "", ""], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: on });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on });
  const trades = useQuery({ queryKey: ["trades", true], queryFn: () => actor!.listTrades(true), enabled: on });
  return { orgs, oas, persons, trades };
}

export function Adresboek({ caps, route, go }: { caps: Caps; route: string[]; go: (to: string) => void }) {
  const { orgs, oas, persons, trades } = useAdresboek();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<OrgKind | "">("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setQ(text), 150);
    return () => clearTimeout(h);
  }, [text]);
  // #/adresboek/<id> opent meteen de fiche (bv. vanuit het weekbord).
  const openId = route[1] && /^\d+$/.test(route[1]) ? BigInt(route[1]) : null;
  const tradeName = (k: string) => trades.data?.find((x) => x.key === k)?.name ?? k;
  const rows = (orgs.data ?? [])
    .filter((o) => o.kind !== OrgKind.bowaco)
    .map((o) => {
      const v = oas.data?.find((x) => x.org.id === o.id);
      const people = (persons.data ?? []).filter((p) => p.orgId === o.id);
      return { o, v, people };
    })
    .sort((a, b) => a.o.name.localeCompare(b.o.name, "nl"));
  const f = fold(q.trim());
  const shown = rows.filter(({ o, v, people }) => {
    if (kind !== "" && o.kind !== kind) return false;
    if (f === "") return true;
    const hay = [o.name, ...o.aliases, o.kbo ?? "", o.vat ?? "", ...o.trades.map(tradeName), v?.contact?.email ?? "", v?.contact?.phone ?? "",
      ...people.flatMap((p) => [p.name, p.shortCode ?? ""]), ...(v?.persons ?? []).flatMap((p) => [p.email ?? "", p.jobTitle])].join(" ");
    return fold(hay).includes(f) || fold(hay.replace(/[\s.]/g, "")).includes(f.replace(/[\s.]/g, ""));
  });
  const count = (k: OrgKind) => rows.filter((r) => r.o.kind === k).length;
  return (
    <Page title={A.title} actions={caps.manageOrgs && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{A.new}</Button>}>
      <p className="bw-muted" style={{ maxWidth: 760 }}>{A.lead}</p>
      <input className="bw-input" type="search" aria-label={A.search} placeholder={A.search} value={text} onChange={(e) => setText(e.target.value)} data-testid="adresboek-zoek" />
      <div className="a-row" role="group" aria-label={t.orgs.kind}>
        <button type="button" className={`a-tag a-tag--link${kind === "" ? " a-tag--accent" : ""}`} aria-pressed={kind === ""} onClick={() => setKind("")} style={{ minHeight: 32 }}>{A.all} {rows.length}</button>
        {KINDS.map((k) => (
          <button key={k} type="button" className={`a-tag a-tag--link${kind === k ? " a-tag--accent" : ""}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)} style={{ minHeight: 32 }}>
            {t.orgKinds[k]} {count(k)}
          </button>
        ))}
      </div>
      <Loading q={orgs} />
      {orgs.data && <span className="bw-label" role="status">{A.count(shown.length)}</span>}
      {orgs.data && shown.length === 0 && (rows.length === 0 ? <EmptyState title={t.leeg.firmas.t} text={t.leeg.firmas.d} action={caps.manageOrgs && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{t.leeg.firmas.add}</Button>} extra={caps.importOa && <Button onClick={() => go("beheer/planning")}>{t.leeg.werven.import}</Button>} /> : <p className="a-empty">{A.noMatch}</p>)}
      {shown.length > 0 && (
        <Table
          rows={shown}
          rowKey={(r) => String(r.o.id)}
          onRow={(r) => go(`adresboek/${r.o.id}`)}
          columns={[
            { key: "n", label: A.colFirm, render: (r) => <span><b>{r.o.name}</b><br /><span className="bw-muted">{t.orgKinds[r.o.kind]}</span></span> },
            { key: "t", label: A.colTrades, render: (r) => (r.o.trades.length ? <span className="a-row">{r.o.trades.map((k) => <span key={k} className="a-tag">{tradeName(k)}</span>)}</span> : <span className="bw-muted">—</span>) },
            { key: "a", label: A.colCodes, render: (r) => <span className="bw-mono">{r.o.aliases.join(", ") || "—"}</span> },
            { key: "p", label: A.colPeople, render: (r) => { const ps = r.people.filter((p) => p.archivedAt === undefined); return ps.length ? <span>{ps.slice(0, 3).map((p) => p.name + (p.shortCode ? ` (${p.shortCode})` : "")).join(", ")}{ps.length > 3 ? ` +${ps.length - 3}` : ""}</span> : <span className="bw-muted">—</span>; } },
            { key: "c", label: A.colContact, render: (r) => { const bits = [r.v?.contact?.phone, r.v?.contact?.email].filter(Boolean); return bits.length ? <span>{bits.join(" · ")}</span> : <span className="bw-muted">—</span>; } },
          ]}
        />
      )}
      {creating && <FirmaFiche id="new" caps={caps} trades={trades.data ?? []} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); go(`adresboek/${id}`); }} go={go} />}
      {openId !== null && <FirmaFiche key={String(openId)} id={openId} caps={caps} trades={trades.data ?? []} onClose={() => go("adresboek")} go={go} />}
    </Page>
  );
}

/** De firmafiche: alles over één firma in één scherm. */
function FirmaFiche({ id, caps, trades, onClose, onCreated, go }: { id: bigint | "new"; caps: Caps; trades: TradeView[]; onClose: () => void; onCreated?: (id: bigint) => void; go: (to: string) => void }) {
  const { orgs, oas, persons } = useAdresboek();
  const org = id === "new" ? null : orgs.data?.find((o) => o.id === id) ?? null;
  const v = id === "new" ? undefined : oas.data?.find((x) => x.org.id === id);
  if (id !== "new" && !org) {
    return (
      <Sheet title={A.title} open onClose={onClose} side wide>
        <Loading q={orgs} />
        {orgs.data && <p className="a-empty">{t.common.noAccess}</p>}
      </Sheet>
    );
  }
  return (
    <Sheet title={org ? org.name : A.new} open onClose={onClose} side wide>
      {org && (
        <div className="a-row">
          <span className="a-tag a-tag--accent">{t.orgKinds[org.kind]}</span>
          {org.aliases.map((a) => <span key={a} className="a-tag bw-mono">{a}</span>)}
          {org.kbo && <span className="bw-muted bw-mono">KBO {org.kbo}</span>}
        </div>
      )}
      {org ? (
        <>
          <Contacten org={org} v={v} persons={persons.data ?? []} caps={caps} />
          <Werven orgId={org.id} go={go} />
        </>
      ) : (
        <p className="bw-muted">{A.saveFirst}</p>
      )}
      <Gegevens org={org} v={v} caps={caps} trades={trades} onCreated={onCreated} />
      {org && org.kind === OrgKind.client && caps.readConfidentialContact && <Vertrouwelijk orgId={org.id} />}
      {org && org.kind === OrgKind.client && <p className="bw-muted">{A.clientNote}</p>}
      {org && org.kind === OrgKind.subcontractor && caps.manageRobots && <Weekmail org={org} v={v} />}
      <p className="bw-muted">{t.oa.internalNote}</p>
    </Sheet>
  );
}

function Contacten({ org, v, persons, caps }: { org: OrgView; v?: OaView; persons: PersonView[]; caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const login = useLoginState(caps);
  // Afgezette contactpersonen enkel voor de beheerder (die kan ze terugzetten).
  const all = useQuery({ queryKey: ["persons", true], queryFn: () => actor!.listPersons(true), enabled: !!actor && !isFetching && caps.manageAccess });
  const [edit, setEdit] = useState<OaPersonView | "new" | null>(null);
  const [access, setAccess] = useState<PersonView | null>(null);
  const [admin, setAdmin] = useState<PersonView | null>(null);
  const [fresh, setFresh] = useState(false);
  const restore = useMutation({
    mutationFn: async (pid: bigint) => unwrap(await actor!.restorePerson(pid)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const dir = inDirectory(org.kind);
  const people = persons.filter((p) => p.orgId === org.id && p.archivedAt === undefined);
  const gone = (all.data ?? []).filter((p) => p.orgId === org.id && p.archivedAt !== undefined);
  const extra = (pid: bigint) => v?.persons.find((x) => x.id === pid);
  // Een nieuwe contactpersoon met code: wie externen mag uitnodigen (beheerder, werfleider; R15 beslist per werf).
  const mayFresh = caps.inviteExternal;
  return (
    <section className="a-section" data-testid="fiche-contacten">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{A.contacts}</h2>
        <span className="a-row">
          {dir && caps.manageOa && <Button icon="plus" onClick={() => setEdit("new")}>{A.addContact}</Button>}
          {mayFresh && <Button icon="key" onClick={() => setFresh(true)}>{A.addClientContact}</Button>}
        </span>
      </div>
      {org.kind === OrgKind.client && <p className="bw-muted">{A.clientContactHint}</p>}
      {people.length === 0 && <p className="a-empty">{A.noContacts}</p>}
      {people.length > 0 && (
        <ul className="a-list">
          {people.map((p) => {
            const x = extra(p.id);
            const state = login(p.id);
            return (
              <li key={String(p.id)} className="a-wrap">
                <span className="a-list__main">
                  <b>{p.name}{p.shortCode ? <> <span className="a-tag bw-mono">{p.shortCode}</span></> : null}</b>
                  <span className="bw-muted">{[x?.jobTitle, p.phone, x?.email].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="a-row">
                    {p.roles.map((r) => <span key={r} className="a-tag">{t.roles[r] ?? r}</span>)}
                    {state === "ja" && <span className="a-tag a-tag--ok">{t.team.accessActive}</span>}
                    {state === "wacht" && <span className="a-tag a-tag--warn">{t.team.accessPending}</span>}
                    {state === "nee" && <span className="a-tag">{t.team.accessNone}</span>}
                  </span>
                </span>
                {caps.inviteExternal && state !== "ja" && state !== "wacht" && <Button variant="quiet" icon="key" onClick={() => setAccess(p)}>{t.team.giveAccess}</Button>}
                {dir && caps.manageOa && x && <Button variant="quiet" onClick={() => setEdit(x)}>{t.team.edit}</Button>}
                {caps.manageAccess && <Button variant="quiet" icon="settings" onClick={() => setAdmin(p)}>{A.login}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {gone.length > 0 && (
        <details>
          <summary className="bw-muted">{A.archivedContacts} ({gone.length})</summary>
          <ul className="a-list">
            {gone.map((p) => (
              <li key={String(p.id)}>
                <span className="a-list__main"><b>{p.name}</b><span className="a-tag a-tag--bad">{t.common.archived}</span></span>
                <Button variant="quiet" busy={restore.isPending && restore.variables === p.id} onClick={() => restore.mutate(p.id)}>{t.team.restore}</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {edit && <PersonForm orgId={org.id} p={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {access && <ToegangGeven person={access} orgKind={org.kind} caps={caps} onClose={() => setAccess(null)} />}
      {fresh && <NieuwMetToegang org={org} onClose={() => setFresh(false)} />}
      {admin && <PersonSheet person={admin} me={null} onClose={() => setAdmin(null)} />}
    </section>
  );
}

function Werven({ orgId, go }: { orgId: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const ids = useQuery({ queryKey: ["orgWorks", String(orgId)], queryFn: () => actor!.orgWorks(orgId), enabled: !!actor && !isFetching });
  const works = useWorks();
  const list = (works.data ?? []).filter((w) => ids.data?.includes(w.id)).sort((a, b) => Number(a.status === WorkStatus.cancelled) - Number(b.status === WorkStatus.cancelled) || b.code.localeCompare(a.code));
  return (
    <section className="a-section" data-testid="fiche-werven">
      <h2 className="bw-h2">{A.works}</h2>
      <Loading q={ids} />
      {ids.data && list.length === 0 && <p className="a-empty">{A.noWorks}</p>}
      {list.length > 0 && (
        <ul className="a-list">
          {list.map((w) => (
            <li key={String(w.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.id}`)}>
                <span className="a-tag">{w.code}</span>
                <span className="a-list__main"><b>{w.name}</b><span className="bw-muted">{[w.address.street, w.address.number].filter(Boolean).join(" ")}{w.address.city ? `, ${w.address.city}` : ""}</span></span>
                <WorkPhase w={w} />
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Gegevens van de firma: wat vroeger over Organisaties (KBO, btw, adres, planningcodes) en Onderaannemers
 *  (vakgebieden, telefoon, e-mail, website) verdeeld stond. */
function Gegevens({ org, v, caps, trades, onCreated }: { org: OrgView | null; v?: OaView; caps: Caps; trades: TradeView[]; onCreated?: (id: bigint) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const c = v?.contact;
  const canEdit = caps.manageOrgs;
  const [f, setF] = useState({
    kind: org?.kind ?? OrgKind.subcontractor,
    name: org?.name ?? "",
    kbo: org?.kbo ?? "",
    vat: org?.vat ?? "",
    aliases: org?.aliases.join(", ") ?? "",
    trades: org?.trades ?? ([] as string[]),
    notes: org?.notes ?? "",
    street: org?.address?.street ?? "",
    number: org?.address?.number ?? "",
    zip: org?.address?.zip ?? "",
    city: org?.address?.city ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    website: c?.website ?? "",
    contactNote: c?.contactNote ?? "",
  });
  // De contactgegevens komen later binnen dan de firma (andere query): eenmaal vullen zolang er niets getypt is.
  const [seeded, setSeeded] = useState(!!c);
  useEffect(() => {
    if (!seeded && c) { setF((x) => ({ ...x, phone: c.phone ?? "", email: c.email ?? "", website: c.website ?? "", contactNote: c.contactNote ?? "" })); setSeeded(true); }
  }, [c, seeded]);
  const dir = inDirectory(f.kind);
  const contactChanged = dir && (f.phone !== (c?.phone ?? "") || f.email !== (c?.email ?? "") || f.website !== (c?.website ?? "") || f.contactNote !== (c?.contactNote ?? ""));
  const save = useMutation({
    mutationFn: async () => {
      const input = {
        kind: f.kind,
        name: f.name,
        kbo: optText(f.kbo),
        vat: optText(f.vat),
        aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean),
        trades: f.trades,
        // 2.6: het adres van de firma (een klant zonder volledig adres houdt het versturen van een offerte tegen)
        address: [f.street, f.number, f.zip, f.city].some((x) => x.trim()) ? { street: f.street.trim(), number: f.number.trim(), zip: f.zip.trim(), city: f.city.trim(), country: org?.address?.country || "BE" } : undefined,
        notes: f.notes,
      };
      const o = unwrap(org ? await actor!.updateOrg(org.id, input) : await actor!.createOrg(input));
      if (contactChanged && caps.manageOa) unwrap(await actor!.saveOrgContact(o.id, { phone: optText(f.phone), email: optText(f.email), website: optText(f.website), contactNote: f.contactNote }));
      return o;
    },
    onSuccess: (o) => {
      toast.show({ kind: "ok", text: t.common.saved });
      for (const k of ["orgs", "oas", "oa", "orgWorks"]) void qc.invalidateQueries({ queryKey: [k] });
      if (!org) onCreated?.(o.id);
    },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const toggle = (k: string) => setF({ ...f, trades: f.trades.includes(k) ? f.trades.filter((x) => x !== k) : [...f.trades, k] });
  const shownTrades = trades.filter((x) => !x.archived || f.trades.includes(x.key));
  return (
    <section className="a-section" data-testid="fiche-gegevens">
      <h2 className="bw-h2">{A.data}</h2>
      {!canEdit && <p className="bw-muted">{A.readOnly}</p>}
      <fieldset disabled={!canEdit} className="a-form" style={{ border: 0, padding: 0, margin: 0 }}>
        <Field label={t.orgs.kind}><Choice label={t.orgs.kind} value={f.kind} onChange={(k) => setF({ ...f, kind: k })} options={KINDS.map((k) => ({ value: k, label: t.orgKinds[k] }))} /></Field>
        <Field label={t.oa.name}><input className="bw-input" value={f.name} onChange={set("name")} maxLength={80} /></Field>
        <div className="a-grid2">
          <Field label={t.orgs.kbo}><input className="bw-input bw-mono" value={f.kbo} onChange={set("kbo")} placeholder="0123.456.789" /></Field>
          <Field label={t.orgs.vat}><input className="bw-input bw-mono" value={f.vat} onChange={set("vat")} /></Field>
        </div>
        <Field label={t.orgs.address}>
          <div className="a-grid2">
            <input className="bw-input" aria-label={t.orgs.street} placeholder={t.orgs.street} value={f.street} onChange={set("street")} maxLength={80} />
            <input className="bw-input" aria-label={t.orgs.number} placeholder={t.orgs.number} value={f.number} onChange={set("number")} maxLength={20} />
            <input className="bw-input bw-mono" aria-label={t.orgs.zip} placeholder={t.orgs.zip} value={f.zip} onChange={set("zip")} maxLength={12} />
            <input className="bw-input" aria-label={t.orgs.city} placeholder={t.orgs.city} value={f.city} onChange={set("city")} maxLength={60} />
          </div>
        </Field>
        <Field label={t.oa.aliases}><input className="bw-input bw-mono" value={f.aliases} onChange={set("aliases")} placeholder="KEVIN, KDS" /></Field>
        <span className="bw-muted">{t.oa.aliasesHelp}</span>
        {f.kind !== OrgKind.client && (
          <>
            <span className="bw-label">{t.oa.trades}</span>
            <div className="a-row" role="group" aria-label={t.oa.trades}>
              {shownTrades.map((x) => (
                <button key={x.key} type="button" className={`a-tag a-tag--link${f.trades.includes(x.key) ? " a-tag--accent" : ""}`} aria-pressed={f.trades.includes(x.key)} onClick={() => toggle(x.key)} style={{ minHeight: 32 }}>
                  {x.name}{x.archived ? ` (${t.oa.tradeArchived})` : ""}
                </button>
              ))}
            </div>
          </>
        )}
        {dir && (
          <>
            <div className="a-grid2">
              <Field label={t.oa.phone}><input className="bw-input" type="tel" value={f.phone} maxLength={30} onChange={set("phone")} /></Field>
              <Field label={t.oa.email}><input className="bw-input" type="email" value={f.email} maxLength={120} onChange={set("email")} /></Field>
            </div>
            <Field label={t.oa.website}><input className="bw-input" value={f.website} maxLength={120} onChange={set("website")} /></Field>
            <Field label={t.oa.contactNote}><textarea className="bw-input" value={f.contactNote} maxLength={1000} onChange={set("contactNote")} /></Field>
          </>
        )}
        <Field label={t.oa.notes}><textarea className="bw-input" value={f.notes} onChange={set("notes")} maxLength={1000} /></Field>
      </fieldset>
      {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      {canEdit && <div><Button variant="primary" busy={save.isPending} disabled={f.name.trim() === ""} onClick={() => save.mutate()} data-testid="fiche-bewaren">{t.oa.saveFirm}</Button></div>}
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
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); for (const k of ["oas", "oa", "persons"]) void qc.invalidateQueries({ queryKey: [k] }); onClose(); },
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

/** Vertrouwelijk klantcontact: pas na een klik ophalen (elk bekijken is een auditregel), enkel in het geheugen van deze fiche. */
function Vertrouwelijk({ orgId }: { orgId: bigint }) {
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
    <section className="a-section" data-testid="fiche-vertrouwelijk">
      <h2 className="bw-h2">{t.orgs.confidential}</h2>
      <p className="bw-muted">{t.orgs.confidentialLead}</p>
      {!view ? (
        <div><Button icon="key" busy={show.isPending} onClick={() => show.mutate()}>{t.orgs.show}</Button></div>
      ) : (
        <div className="a-form">
          <Field label={t.orgs.contactName}><input className="bw-input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <div className="a-grid2">
            <Field label={t.team.phone}><input className="bw-input" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
            <Field label={t.orgs.email}><input className="bw-input" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
          </div>
          <Field label={t.orgs.notes}><textarea className="bw-input" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
          <div><Button busy={save.isPending} onClick={() => save.mutate()}>{t.common.save} ({t.orgs.confidential.toLowerCase()})</Button></div>
        </div>
      )}
    </section>
  );
}

/** De weekmail van één OA (wat vroeger enkel in Postbode → Mails per firma stond): aan/uit, taal, bekijken. */
function Weekmail({ org, v }: { org: OrgView; v?: OaView }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({ queryKey: ["postSettings"], queryFn: () => actor!.postSettings(), enabled: !!actor && !isFetching });
  const [preview, setPreview] = useState<MailPreview | null>(null);
  const done = () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["postSettings"] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const optOut = useMutation({ mutationFn: async (gets: boolean) => unwrap(await actor!.setOrgMail(org.id, gets)), onSuccess: done, onError: fail });
  const setLang = useMutation({ mutationFn: async (l: string) => unwrap(await actor!.setOrgMailLang(org.id, l)), onSuccess: done, onError: fail });
  const show = useMutation({ mutationFn: async () => unwrap(await actor!.mailPreview("weekplanning", org.id, nextMonday())), onSuccess: setPreview, onError: fail });
  const s = st.data;
  const out = s?.optedOut.some((x) => x === org.id) ?? false;
  const lang = s?.langs.find(([x]) => x === org.id)?.[1] ?? "";
  const mail = v?.contact?.email ?? v?.persons.find((p) => p.email)?.email;
  const P = t.postbode;
  return (
    <section className="a-section" data-testid="fiche-weekmail">
      <h2 className="bw-h2">{A.weekmail}</h2>
      <p className="bw-muted">{A.weekmailLead}</p>
      <Loading q={st} />
      {!mail && <p className="a-note">{A.weekmailNoAddress}</p>}
      {s && (
        <div className="a-row">
          <label className="a-check"><input type="checkbox" checked={!out} disabled={!mail || optOut.isPending} onChange={(e) => optOut.mutate(e.target.checked)} /> {A.weekmailGets}</label>
          <select className="bw-input" style={{ maxWidth: 170 }} aria-label={P.lang} value={lang} disabled={!mail} onChange={(e) => setLang.mutate(e.target.value)}>
            <option value="">{P.langAuto}</option>
            {Object.entries(P.langs).map(([k, x]) => <option key={k} value={k}>{x}</option>)}
          </select>
          <Button icon="share" busy={show.isPending} disabled={!mail} onClick={() => show.mutate()}>{A.weekmailPreview}</Button>
        </div>
      )}
      {preview && (
        <div className="p-mail">
          <p className="bw-muted">{P.to}: {preview.mail.to.map((x) => x.email).join(", ")} · {P.langs[preview.lang] ?? preview.lang}</p>
          <p className="bw-muted"><Icon name="alert" size={14} /> {preview.deliver}</p>
          <p><b>{preview.mail.subject}</b></p>
          {/* De mail precies zoals ze vertrekt; sandbox zonder scripts, enkel opmaak. */}
          <iframe className="p-mail__frame" title={A.weekmail} sandbox="" srcDoc={preview.html} />
        </div>
      )}
    </section>
  );
}
