// Team (2b.1: enkel de mensen van BOWACO): rol, werven en toegang; uitnodigen (§3.3.2), toegang geven of herstelcode
// (§3.3.5), logins bevestigen of intrekken (§3.3.4/6), afzetten. Externen staan bij Firma's & contacten. Een nieuwe code
// wordt één keer getoond; de backend bewaart enkel de hash.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LinkStatus, OrgKind, Role, WorkStatus, type Caps, type NewCode, type OrgView, type PersonView } from "../backend";
import { Button, Choice, Confirm, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtDay, fmtTime, optText, unwrap, useBackend } from "../util";
import { Loading, Page, RoleTags, useWorks } from "./common";
import { Field } from "./Werven";

const ALL_ROLES: Role[] = [Role.admin, Role.werfleider, Role.calculator, Role.onderaannemer, Role.architect, Role.klant, Role.veiligheidscoordinator];
const INTERNAL: Role[] = [Role.admin, Role.werfleider, Role.calculator];

/** Hoort iemand bij BOWACO? Een interne rol, of geen firma / de firma BOWACO zelf (zoals Rights.orgRuleError). */
export function isBowaco(p: PersonView, orgs: OrgView[]): boolean {
  if (p.roles.some((r) => INTERNAL.includes(r))) return true;
  if (p.orgId === undefined) return true;
  return orgs.find((o) => o.id === p.orgId)?.kind === OrgKind.bowaco;
}

export function Team({ caps, me }: { caps: Caps; me: PersonView }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const [archived, setArchived] = useState(false);
  const persons = useQuery({ queryKey: ["persons", archived], queryFn: () => actor!.listPersons(archived), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on && caps.manageAccess });
  const works = useWorks();
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<PersonView | null>(null);
  const team = (persons.data ?? []).filter((p) => isBowaco(p, orgs.data ?? []));
  // Werven: een werfleider die van een werf (fiche), anders ziet een interne rol alle werven.
  const worksOf = (p: PersonView) => {
    if (!p.roles.includes(Role.werfleider) || p.roles.includes(Role.admin) || p.roles.includes(Role.calculator)) return <span className="bw-muted">{t.team.worksAll}</span>;
    const mine = (works.data ?? []).filter((w) => w.leaderPersonId === p.id && w.status !== WorkStatus.cancelled);
    return mine.length ? <span className="a-row">{mine.slice(0, 4).map((w) => <span key={String(w.id)} className="a-tag">{w.code}</span>)}{mine.length > 4 ? <span className="bw-muted">+{mine.length - 4}</span> : null}</span> : <span className="bw-muted">—</span>;
  };
  const access = (p: PersonView) => {
    const mine = (links.data ?? []).filter((l) => l.personId === p.id);
    if (mine.some((l) => l.status === LinkStatus.active)) return <span className="a-tag a-tag--ok">{t.team.accessActive}</span>;
    if (mine.some((l) => l.status === LinkStatus.pending)) return <span className="a-tag a-tag--warn">{t.team.accessPending}</span>;
    return <span className="a-tag">{t.team.accessNone}</span>;
  };
  return (
    <Page title={t.team.title} actions={caps.manageAccess && <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>{t.team.invite}</Button>}>
      <p className="bw-muted" style={{ maxWidth: 760 }}>{t.team.lead}</p>
      {caps.manageAccess && (
        <label className="a-check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{t.team.showArchived}</label>
      )}
      <Loading q={persons} />
      {persons.data && orgs.data && team.length === 0 && <p className="a-empty">{t.team.empty}</p>}
      {team.length > 0 && (
        <Table
          rows={team}
          rowKey={(p) => String(p.id)}
          onRow={caps.manageAccess ? setOpen : undefined}
          columns={[
            { key: "n", label: t.team.name, render: (p) => <span><b>{p.name}</b>{p.archivedAt !== undefined && <> <span className="a-tag a-tag--bad">{t.common.archived}</span></>}</span> },
            { key: "r", label: t.team.roles, render: (p) => <RoleTags roles={p.roles} /> },
            { key: "w", label: t.team.worksCol, render: worksOf },
            ...(caps.manageAccess ? [{ key: "a", label: t.team.access, render: access }] : []),
            { key: "c", label: t.team.shortCode, render: (p) => <span className="bw-mono">{p.shortCode ?? "—"}</span> },
            { key: "g", label: t.team.phone, render: (p) => <span className="bw-num">{p.phone ?? "—"}</span> },
          ]}
        />
      )}
      <p className="bw-muted">{t.team.externalHere}</p>
      {inviting && <Invite onClose={() => setInviting(false)} />}
      {open && <PersonSheet person={open} me={me} onClose={() => setOpen(null)} />}
    </Page>
  );
}

/** Iemand van BOWACO toevoegen (enkel de beheerder): een interne rol, geen firma. Externen: Firma's & contacten. */
function Invite({ onClose }: { onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const works = useQuery({ queryKey: ["works"], queryFn: () => actor!.listWorks(), enabled: on });
  const [f, setF] = useState({ name: "", role: Role.werfleider, code: "", phone: "", days: "", tag: "" });
  // II-test punt 4 (R15): werven gelden voor een werfleider (werfleider van die werf); beheerder en calculator zien
  // alles. Een rolwissel laat geen werven meer achter die de backend dan zou weigeren.
  const withWorks = f.role === Role.werfleider;
  const [workIds, setWorkIds] = useState<bigint[]>([]);
  const [code, setCode] = useState<NewCode | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.invitePerson({
        name: f.name,
        roles: [f.role],
        orgId: undefined,
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
    <Sheet title={t.team.inviteTitle} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={!f.name.trim()} onClick={() => save.mutate()}>{t.toegang.make}</Button></>}>
      <div className="a-form">
        <Field label={t.team.name}><input className="bw-input" value={f.name} onChange={set("name")} maxLength={80} /></Field>
        <Field label={t.team.roles}><Choice label={t.team.roles} value={f.role} onChange={(r) => { setF({ ...f, role: r }); if (r !== Role.werfleider) setWorkIds([]); }} options={INTERNAL.map((r) => ({ value: r, label: t.roles[r] }))} /></Field>
        <Field label={t.team.org}><span>{t.team.noOrg}</span></Field>
        <div className="a-grid2">
          <Field label={t.team.shortCode}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} maxLength={20} /></Field>
          <Field label={t.team.phone}><input className="bw-input" value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        </div>
        {!withWorks && <p className="bw-muted">{t.team.worksNone}</p>}
        {withWorks && (works.data?.length ?? 0) > 0 && (
          <Field label={t.team.worksLeader}>
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
        <p className="bw-muted">{t.team.externalHere}</p>
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

/** Logins, rollen, toegang en afzetten van één persoon (beheerder): vanuit Team en vanuit de firmafiche. */
export function PersonSheet({ person, me, onClose }: { person: PersonView; me: PersonView | null; onClose: () => void }) {
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
  const noLogin = !!links.data && !mine.some((l) => l.status !== LinkStatus.revoked);
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
                  {l.status === LinkStatus.pending && person.id !== me?.id && <Button variant="primary" onClick={() => confirm.mutate(l.principal)}>{t.overzicht.confirm}</Button>}
                  {l.status !== LinkStatus.revoked && <Button variant="quiet" onClick={() => revoke.mutate(l.principal)}>{t.team.revoke}</Button>}
                </li>
              ))}
            </ul>
          )}
          {/* 2b.1: zonder login heet het "Toegang geven" (dezelfde code, aan deze persoon: geen tweede fiche). */}
          <h3 className="bw-h3">{noLogin ? t.team.giveAccess : t.team.recovery}</h3>
          {noLogin && <p className="bw-muted">{t.team.giveAccessLead} {t.toegang.noDouble}</p>}
          <div className="a-row">
            <input className="bw-input" style={{ flex: 1, minWidth: 180 }} value={recTag} onChange={(e) => setRecTag(e.target.value)} placeholder={t.team.recoveryTag} maxLength={60} />
            <Button icon="key" busy={recovery.isPending} onClick={() => recovery.mutate()} data-testid="persoon-code">{noLogin ? t.team.giveAccess : t.team.recovery}</Button>
          </div>
          {person.id !== me?.id && <Button variant="danger" onClick={() => setAsk(true)}>{t.team.archive}</Button>}
          <Confirm open={ask} title={`${t.team.archive}: ${person.name}`} text={t.team.archiveConfirm} confirmLabel={t.team.archive} busy={archive.isPending} onConfirm={() => archive.mutate()} onClose={() => setAsk(false)} />
        </div>
      )}
    </Sheet>
  );
}
