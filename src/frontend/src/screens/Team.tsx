// Team: personen, uitnodigen (§3.3.2), herstelcode (§3.3.5), logins bevestigen of intrekken (§3.3.4/6),
// afzetten. Een nieuwe code wordt één keer getoond; de backend bewaart enkel de hash.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LinkStatus, OrgKind, Role, type Caps, type NewCode, type PersonView } from "../backend";
import { Button, Choice, Confirm, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtDay, fmtTime, optText, unwrap, useBackend } from "../util";
import { Loading, Page, RoleTags } from "./common";
import { Field } from "./Werven";

const ALL_ROLES: Role[] = [Role.admin, Role.werfleider, Role.calculator, Role.onderaannemer, Role.architect, Role.klant, Role.veiligheidscoordinator];
const EXTERNAL: Role[] = [Role.onderaannemer, Role.architect, Role.klant, Role.veiligheidscoordinator];
/** Welke soort organisatie bij een externe rol hoort (veiligheidscoördinator: elke externe). */
const ORG_FOR: Partial<Record<Role, OrgKind>> = { [Role.onderaannemer]: OrgKind.subcontractor, [Role.architect]: OrgKind.architect, [Role.klant]: OrgKind.client };

export function Team({ caps, me }: { caps: Caps; me: PersonView }) {
  const { actor, isFetching } = useBackend();
  const [archived, setArchived] = useState(false);
  const persons = useQuery({ queryKey: ["persons", archived], queryFn: () => actor!.listPersons(archived), enabled: !!actor && !isFetching });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const orgName = (id?: bigint) => (id === undefined ? "BOWACO" : orgs.data?.find((o) => o.id === id)?.name ?? `#${id}`);
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<PersonView | null>(null);
  return (
    <Page title={t.team.title} actions={caps.inviteExternal && <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>{t.team.invite}</Button>}>
      {caps.manageAccess && (
        <label className="a-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{t.team.showArchived}</label>
      )}
      <Loading q={persons} />
      {persons.data && (
        <Table
          rows={persons.data}
          rowKey={(p) => String(p.id)}
          onRow={caps.manageAccess ? setOpen : undefined}
          columns={[
            { key: "n", label: t.team.name, render: (p) => <span><b>{p.name}</b>{p.archivedAt !== undefined && <> <span className="a-tag a-tag--bad">{t.common.archived}</span></>}</span> },
            { key: "r", label: t.team.roles, render: (p) => <RoleTags roles={p.roles} /> },
            { key: "o", label: t.team.org, render: (p) => orgName(p.orgId) },
            { key: "c", label: t.team.shortCode, render: (p) => <span className="bw-mono">{p.shortCode ?? "—"}</span> },
            { key: "g", label: t.team.phone, render: (p) => <span className="bw-num">{p.phone ?? "—"}</span> },
          ]}
        />
      )}
      {inviting && <Invite caps={caps} onClose={() => setInviting(false)} />}
      {open && <PersonSheet person={open} me={me} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function Invite({ caps, onClose }: { caps: Caps; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: on });
  const roles = caps.manageAccess ? ALL_ROLES : EXTERNAL;
  // Standaard een interne rol (BOWACO zelf) voor de beheerder; een werfleider nodigt enkel externen uit.
  const [f, setF] = useState({ name: "", role: caps.manageAccess ? Role.werfleider : Role.onderaannemer, org: "", code: "", phone: "", days: "", tag: "" });
  const external = EXTERNAL.includes(f.role);
  // II-test punt 4 (R15): werven gelden voor externen (lid) en een werfleider (werfleider van die werf); beheerder en
  // calculator zien alles. Een rolwissel laat geen werven meer achter die de backend dan zou weigeren.
  const withWorks = external || f.role === Role.werfleider;
  const orgChoices = (orgs.data ?? []).filter((o) => o.kind !== OrgKind.bowaco && (ORG_FOR[f.role] === undefined || o.kind === ORG_FOR[f.role]));
  const [workIds, setWorkIds] = useState<bigint[]>([]);
  const [code, setCode] = useState<NewCode | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.invitePerson({
        name: f.name,
        roles: [f.role],
        orgId: f.org ? BigInt(f.org) : undefined,
        shortCode: optText(f.code),
        lang: "nl",
        phone: optText(f.phone),
        workIds: withWorks ? workIds : [],
        validDays: BigInt(f.days || "0"),
        tag: f.tag,
      })),
    onSuccess: (c) => { setCode(c); void qc.invalidateQueries(); },
  });
  if (code) return <CodeShown title={`${t.team.codeTitle} ${f.name}`} code={code} onClose={onClose} />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={t.team.inviteTitle} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={!f.name.trim() || (external && !f.org)} onClick={() => save.mutate()}>{t.team.invite}</Button></>}>
      <div className="a-form">
        <Field label={t.team.name}><input className="bw-input" value={f.name} onChange={set("name")} maxLength={80} /></Field>
        <Field label={t.team.roles}><Choice label={t.team.roles} value={f.role} onChange={(r) => { setF({ ...f, role: r, org: "" }); if (!(EXTERNAL.includes(r) || r === Role.werfleider)) setWorkIds([]); }} options={roles.map((r) => ({ value: r, label: t.roles[r] }))} /></Field>
        {external ? (
          <Field label={t.team.org}>
            <select className="bw-input" value={f.org} onChange={set("org")}>
              <option value="">{t.team.pickOrg}</option>
              {orgChoices.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
            {orgChoices.length === 0 && <span className="bw-muted">{t.team.noOrgYet}</span>}
          </Field>
        ) : (
          <Field label={t.team.org}><span>{t.team.noOrg}</span></Field>
        )}
        <div className="a-grid2">
          <Field label={t.team.shortCode}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} maxLength={20} /></Field>
          <Field label={t.team.phone}><input className="bw-input" value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        </div>
        {!withWorks && <p className="bw-muted">{t.team.worksNone}</p>}
        {withWorks && (works.data?.length ?? 0) > 0 && (
          <Field label={external ? t.team.works : t.team.worksLeader}>
            <div className="a-stack">
              {works.data!.map((w) => (
                <label key={String(w.id)} className="a-check">
                  <input type="checkbox" checked={workIds.includes(w.id)} onChange={(e) => setWorkIds(e.target.checked ? [...workIds, w.id] : workIds.filter((x) => x !== w.id))} />
                  <span className="a-tag">{w.code}</span> {w.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="a-grid2">
          <Field label={t.team.days}><input className="bw-input bw-num" value={f.days} onChange={set("days")} inputMode="numeric" placeholder="7" /></Field>
          <Field label={t.team.tag}><input className="bw-input" value={f.tag} onChange={set("tag")} maxLength={60} /></Field>
        </div>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

/** De code één keer tonen, met een link waarvan het deel na # de server nooit bereikt. */
export function CodeShown({ title, code, onClose }: { title: string; code: NewCode; onClose: () => void }) {
  const toast = useToast();
  const link = `${window.location.origin}${window.location.pathname}#code=${code.code}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ kind: "ok", text: t.common.copied });
    } catch {
      toast.show({ kind: "error", text: t.common.error });
    }
  };
  return (
    <Sheet title={title} open onClose={onClose} side footer={<Button variant="primary" onClick={onClose}>{t.common.close}</Button>}>
      <p className="bw-muted">{t.team.codeLead}</p>
      <div className="a-code">
        <span className="a-code__value">{code.code}</span>
        <span className="bw-muted">{t.team.expires} {fmtTime(code.expiresAt)}</span>
        <div className="a-row">
          <Button onClick={() => copy(code.code)}>{t.common.copy}</Button>
          <Button onClick={() => copy(link)}>{t.team.codeLink}</Button>
          {"share" in navigator && <Button icon="share" onClick={() => navigator.share({ text: `BOWACO: ${link}` }).catch(() => {})}>Delen</Button>}
        </div>
      </div>
    </Sheet>
  );
}

function PersonSheet({ person, me, onClose }: { person: PersonView; me: PersonView; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const mine = (links.data ?? []).filter((l) => l.personId === person.id);
  const [f, setF] = useState({ name: person.name, roles: person.roles, org: person.orgId !== undefined ? String(person.orgId) : "", code: person.shortCode ?? "", phone: person.phone ?? "" });
  const [recTag, setRecTag] = useState("");
  const [ask, setAsk] = useState(false);
  const [code, setCode] = useState<NewCode | null>(null);
  const done = (msg = t.common.saved) => { toast.show({ kind: "ok", text: msg }); void qc.invalidateQueries(); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.updatePerson(person.id, { name: f.name, roles: f.roles, orgId: f.org ? BigInt(f.org) : undefined, shortCode: optText(f.code), lang: person.lang, phone: optText(f.phone) })),
    onSuccess: () => { done(); onClose(); },
    onError: fail,
  });
  const recovery = useMutation({ mutationFn: async () => unwrap(await actor!.createRecoveryCode(person.id, 0n, recTag)), onSuccess: (c) => { setCode(c); void qc.invalidateQueries(); }, onError: fail });
  const confirm = useMutation({ mutationFn: async (p: (typeof mine)[number]["principal"]) => unwrap(await actor!.confirmLink(p)), onSuccess: () => done(), onError: fail });
  const revoke = useMutation({ mutationFn: async (p: (typeof mine)[number]["principal"]) => unwrap(await actor!.revokeLink(p)), onSuccess: () => done(), onError: fail });
  const archive = useMutation({ mutationFn: async () => unwrap(await actor!.archivePerson(person.id)), onSuccess: () => { done(); onClose(); }, onError: fail });
  const restore = useMutation({ mutationFn: async () => unwrap(await actor!.restorePerson(person.id)), onSuccess: () => { done(); onClose(); }, onError: fail });

  if (code) return <CodeShown title={`${t.team.recovery}: ${person.name}`} code={code} onClose={() => { setCode(null); onClose(); }} />;
  const isArchived = person.archivedAt !== undefined;
  const toggleRole = (r: Role) => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });
  return (
    <Sheet title={person.name} open onClose={onClose} side footer={!isArchived && <><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      {isArchived ? (
        <div className="a-stack">
          <p className="a-note">{t.common.archived} · {fmtDay(person.archivedAt)}</p>
          <Button busy={restore.isPending} onClick={() => restore.mutate()}>{t.team.restore}</Button>
        </div>
      ) : (
        <div className="a-form">
          <Field label={t.team.name}><input className="bw-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t.team.roles}>
            <div className="bw-choice" role="group" aria-label={t.team.roles}>
              {ALL_ROLES.map((r) => <button key={r} type="button" className="bw-choice__opt" aria-pressed={f.roles.includes(r)} onClick={() => toggleRole(r)}>{t.roles[r]}</button>)}
            </div>
          </Field>
          <Field label={t.team.org}>
            <select className="bw-input" value={f.org} onChange={(e) => setF({ ...f, org: e.target.value })}>
              <option value="">{t.team.noOrg}</option>
              {(orgs.data ?? []).map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
          </Field>
          <div className="a-grid2">
            <Field label={t.team.shortCode}><input className="bw-input bw-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label={t.team.phone}><input className="bw-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          {save.error ? <p className="a-err">{errText(save.error)}</p> : null}

          <h3 className="bw-h3">{t.team.logins}</h3>
          <Loading q={links} />
          {links.data && mine.length === 0 && <p className="bw-muted">{t.team.noLogins}</p>}
          {mine.length > 0 && (
            <ul className="a-list">
              {mine.map((l) => (
                <li key={l.principal.toText()}>
                  <span className="a-list__main">
                    <span className="a-row"><span className={`a-tag${l.status === LinkStatus.active ? " a-tag--ok" : l.status === LinkStatus.pending ? " a-tag--warn" : " a-tag--bad"}`}>{t.team.statusLink[l.status]}</span>{l.tag && <b>{l.tag}</b>}</span>
                    <span className="a-mono">{l.principal.toText()}</span>
                    <span className="bw-muted bw-num">{fmtTime(l.linkedAt)} · …{l.codeHint}</span>
                  </span>
                  {l.status === LinkStatus.pending && person.id !== me.id && <Button variant="primary" onClick={() => confirm.mutate(l.principal)}>{t.overzicht.confirm}</Button>}
                  {l.status !== LinkStatus.revoked && <Button variant="quiet" onClick={() => revoke.mutate(l.principal)}>{t.team.revoke}</Button>}
                </li>
              ))}
            </ul>
          )}
          <h3 className="bw-h3">{t.team.recovery}</h3>
          <div className="a-row">
            <input className="bw-input" style={{ flex: 1, minWidth: 180 }} value={recTag} onChange={(e) => setRecTag(e.target.value)} placeholder={t.team.recoveryTag} maxLength={60} />
            <Button icon="key" busy={recovery.isPending} onClick={() => recovery.mutate()}>{t.team.recovery}</Button>
          </div>
          {person.id !== me.id && <Button variant="danger" onClick={() => setAsk(true)}>{t.team.archive}</Button>}
          <Confirm open={ask} title={`${t.team.archive}: ${person.name}`} text={t.team.archiveConfirm} confirmLabel={t.team.archive} busy={archive.isPending} onConfirm={() => archive.mutate()} onClose={() => setAsk(false)} />
        </div>
      )}
    </Sheet>
  );
}
