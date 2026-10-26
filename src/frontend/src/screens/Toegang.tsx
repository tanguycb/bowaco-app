// Stap 2b.1: "Toegang geven" op elke persoon zonder login (Team, Firma's & contacten, Wie werkt mee) en het werfblok
// "Wie werkt mee" met één knop Toevoegen. Uitnodigen maakt nooit nog een dubbele persoon: een bestaande persoon krijgt
// zijn code via inviteExistingPerson (extern) of createRecoveryCode (BOWACO). Wat iemand mag, beslist de backend (Rights.mo).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Grant, LinkStatus, OrgKind, Role, WorkStatus, type Caps, type MembershipView, type NewCode, type OrgView, type PersonView, type WorkView } from "../backend";
import { Button, Choice, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, optText, unwrap, useBackend } from "../util";
import { Loading, RoleTags, useWorks } from "./common";
import { CodeShown } from "./Team";
import { GrantToggles } from "./Extern";
import { Field } from "./Werven";

const T = t.toegang;
const W = t.wie;
export const EXTERNAL_ROLES: Role[] = [Role.onderaannemer, Role.architect, Role.klant, Role.veiligheidscoordinator];
const MEMBER_ROLES: Role[] = [Role.werfleider, Role.veiligheidscoordinator, Role.architect, Role.klant, Role.onderaannemer];
export const isExternal = (roles: Role[]) => roles.length > 0 && roles.every((r) => EXTERNAL_ROLES.includes(r));

/** De rol van een contact volgt uit de soort van zijn firma (zoals saveOaPerson in de backend). */
export function roleForKind(k?: OrgKind): Role {
  switch (k) {
    case OrgKind.client: return Role.klant;
    case OrgKind.architect: return Role.architect;
    case OrgKind.safetyCoordinator: return Role.veiligheidscoordinator;
    default: return Role.onderaannemer;
  }
}

/** De gewone rechten van een nieuw lid op de werf (zoals vroeger bij "Lid toevoegen"). */
function defaultGrants(r: Role): Grant[] {
  if (r === Role.onderaannemer) return [Grant.confirmPlanning, Grant.confirmHours];
  if (r === Role.architect) return [Grant.readReports];
  if (r === Role.veiligheidscoordinator) return [Grant.uploadDocs];
  return [];
}

/**
 * Of een persoon kan inloggen: de beheerder ziet alle logins; anders weet enkel de OA-database het (contactpersonen van
 * firma's). "?" = onbekend (bv. een klant voor een werfleider): de knop blijft, de backend weigert als er al een login is.
 */
export function useLoginState(caps: Caps): (personId: bigint) => "ja" | "wacht" | "nee" | "?" {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: on && caps.manageAccess });
  const oas = useQuery({ queryKey: ["oas", "", "", ""], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: on && caps.readOa && !caps.manageAccess });
  return (id) => {
    if (links.data) {
      const mine = links.data.filter((l) => l.personId === id);
      if (mine.some((l) => l.status === LinkStatus.active)) return "ja";
      if (mine.some((l) => l.status === LinkStatus.pending)) return "wacht";
      return "nee";
    }
    for (const o of oas.data ?? []) {
      const p = o.persons.find((x) => x.id === id);
      if (p) return p.hasLogin ? "ja" : "nee";
    }
    return "?";
  };
}

/** Toegang geven aan een BESTAANDE persoon: geen nieuwe fiche, enkel een code. */
export function ToegangGeven({ person, orgKind, workId, caps, onClose }: { person: PersonView; orgKind?: OrgKind; workId?: bigint; caps: Caps; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const works = useWorks();
  const internal = !isExternal(person.roles);
  const [role, setRole] = useState<Role>(person.roles[0] && !internal ? person.roles[0] : roleForKind(orgKind));
  const [workIds, setWorkIds] = useState<bigint[]>(workId !== undefined ? [workId] : []);
  const [days, setDays] = useState("");
  const [tag, setTag] = useState("");
  const [code, setCode] = useState<NewCode | null>(null);
  const make = useMutation({
    mutationFn: async () => {
      if (internal) return unwrap(await actor!.createRecoveryCode(person.id, BigInt(days || "0"), tag));
      // Een beheerder mag de rol eerst rechtzetten (bv. een contact van een architectenbureau dat als OA bewaard werd).
      if (caps.manageAccess && !(person.roles.length === 1 && person.roles[0] === role)) {
        unwrap(await actor!.updatePerson(person.id, { name: person.name, roles: [role], orgId: person.orgId, shortCode: person.shortCode, lang: person.lang, phone: person.phone }));
      }
      return unwrap(await actor!.inviteExistingPerson({ personId: person.id, workIds, validDays: BigInt(days || "0"), tag }));
    },
    onSuccess: (c) => { setCode(c); void qc.invalidateQueries(); },
  });
  if (code) return <CodeShown title={`${t.team.codeTitle} ${person.name}`} code={code} onClose={onClose} />;
  const blocked = internal ? !caps.manageAccess : !caps.inviteExternal;
  const open = (works.data ?? []).filter((w) => w.archivedAt === undefined && w.status !== WorkStatus.cancelled);
  return (
    <Sheet title={`${T.title}: ${person.name}`} open onClose={onClose} side footer={<>
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" icon="key" busy={make.isPending} disabled={blocked} onClick={() => make.mutate()} data-testid="toegang-maken">{T.make}</Button>
    </>}>
      <p className="bw-muted">{T.lead}</p>
      <p className="a-note">{T.noDouble}</p>
      <div className="a-form">
        {internal ? (
          <>
            <Field label={T.role}><RoleTags roles={person.roles} /></Field>
            <p className="bw-muted">{caps.manageAccess ? T.internal : T.adminOnly}</p>
          </>
        ) : (
          <>
            <Field label={`${T.role} (${T.roleFromFirm})`}>
              {caps.manageAccess
                ? <Choice label={T.role} value={role} onChange={setRole} options={EXTERNAL_ROLES.map((r) => ({ value: r, label: t.roles[r] }))} />
                : <RoleTags roles={person.roles} />}
            </Field>
            {caps.manageAccess && <span className="bw-muted">{T.roleChange}</span>}
            <Field label={T.works}>
              <span className="bw-muted">{T.worksLead}</span>
              <Loading q={works} />
              <div className="a-stack" style={{ maxHeight: 260, overflowY: "auto" }}>
                {open.map((w) => (
                  <label key={String(w.id)} className="a-check">
                    <input type="checkbox" checked={workIds.includes(w.id)} onChange={(e) => setWorkIds(e.target.checked ? [...workIds, w.id] : workIds.filter((x) => x !== w.id))} />
                    <span className="a-tag">{w.code}</span> {w.name}
                  </label>
                ))}
              </div>
              {workIds.length === 0 && <span className="bw-muted">{T.noWorks}</span>}
            </Field>
          </>
        )}
        <div className="a-grid2">
          <Field label={t.team.days}><input className="bw-input bw-num" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="7" /></Field>
          <Field label={t.team.tag}><input className="bw-input" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={60} /></Field>
        </div>
        {make.error && <p className="a-err" role="alert">{errText(make.error)}</p>}
      </div>
    </Sheet>
  );
}

/** Een NIEUWE contactpersoon bij een firma, meteen met een code (de enige manier voor een klant: zie R23). */
export function NieuwMetToegang({ org, workId, onClose, onDone }: { org: OrgView; workId?: bigint; onClose: () => void; onDone?: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const works = useWorks();
  const role = roleForKind(org.kind);
  const [f, setF] = useState({ name: "", phone: "", code: "" });
  const [workIds, setWorkIds] = useState<bigint[]>(workId !== undefined ? [workId] : []);
  const [code, setCode] = useState<NewCode | null>(null);
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.invitePerson({ name: f.name, roles: [role], orgId: org.id, shortCode: optText(f.code), lang: "nl", phone: optText(f.phone), workIds, validDays: 0n, tag: "" })),
    onSuccess: (c) => { setCode(c); void qc.invalidateQueries(); onDone?.(); },
  });
  if (code) return <CodeShown title={`${t.team.codeTitle} ${f.name}`} code={code} onClose={onClose} />;
  const open = (works.data ?? []).filter((w) => w.archivedAt === undefined && w.status !== WorkStatus.cancelled);
  return (
    <Sheet title={`${T.newPerson} · ${org.name}`} open onClose={onClose} side footer={<>
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" icon="key" busy={make.isPending} disabled={!f.name.trim()} onClick={() => make.mutate()}>{T.make}</Button>
    </>}>
      <p className="bw-muted">{T.lead}</p>
      <div className="a-form">
        <Field label={T.name}><input className="bw-input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="a-grid2">
          <Field label={T.phone}><input className="bw-input" type="tel" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={T.shortCode}><input className="bw-input bw-mono" value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        </div>
        <Field label={`${T.role} (${T.roleFromFirm})`}><RoleTags roles={[role]} /></Field>
        {workId === undefined && (
          <Field label={T.works}>
            <span className="bw-muted">{T.worksLead}</span>
            <div className="a-stack" style={{ maxHeight: 260, overflowY: "auto" }}>
              {open.map((w) => (
                <label key={String(w.id)} className="a-check">
                  <input type="checkbox" checked={workIds.includes(w.id)} onChange={(e) => setWorkIds(e.target.checked ? [...workIds, w.id] : workIds.filter((x) => x !== w.id))} />
                  <span className="a-tag">{w.code}</span> {w.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        {make.error && <p className="a-err" role="alert">{errText(make.error)}</p>}
      </div>
    </Sheet>
  );
}

const ROLE_ORDER: string[] = [Role.werfleider, Role.veiligheidscoordinator, Role.architect, Role.klant, Role.onderaannemer];
const roleOrder = (r: string) => { const i = ROLE_ORDER.indexOf(r); return i < 0 ? 99 : i; };

/** Het werfblok "Wie werkt mee" (vroeger "Team op deze werf"): wie welke rol heeft, met vinkjes per persoon. */
export function WieWerktMee({ w, caps }: { w: WorkView; caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const members = useQuery({ queryKey: ["members", String(w.id)], queryFn: () => actor!.listMembers(w.id), enabled: on, refetchOnWindowFocus: true });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && caps.readTeam });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  const login = useLoginState(caps);
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<PersonView | null>(null);
  const end = useMutation({
    mutationFn: async (mid: bigint) => unwrap(await actor!.endMembership(mid)),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const manage = w.caps.manageMembers;
  const personOf = (m: MembershipView) => (m.personId !== undefined ? persons.data?.find((p) => p.id === m.personId) : undefined);
  const kindOf = (p?: PersonView) => (p?.orgId !== undefined ? orgs.data?.find((o) => o.id === p.orgId)?.kind : undefined);
  return (
    <section className="a-section" data-testid="wie-werkt-mee">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.werven.team}</h2>
        {manage && <Button icon="plus" onClick={() => setAdding(true)}>{W.add}</Button>}
      </div>
      <p className="bw-muted">{t.werven.teamLead}</p>
      <Loading q={members} />
      {members.data && members.data.length === 0 && <p className="a-empty">—</p>}
      {members.data && members.data.length > 0 && (
        <ul className="a-list">
          {members.data.slice().sort((a, b) => roleOrder(a.role) - roleOrder(b.role)).map((m) => {
            const p = personOf(m);
            const state = p ? login(p.id) : "?";
            const mayGive = manage && caps.inviteExternal && !!p && isExternal(p.roles) && !m.archived && state !== "ja" && state !== "wacht";
            return (
              <li key={String(m.id)} className="a-wrap">
                <span className="a-list__main">
                  <b>{m.name}</b>
                  <span className="a-row">
                    <RoleTags roles={[m.role]} />
                    {m.archived && <span className="a-tag a-tag--bad">{t.werven.archivedMember}</span>}
                    {m.orgId !== undefined && m.personId === undefined && <span className="a-tag">{W.firmAsWhole}</span>}
                    {p && state === "ja" && <span className="a-tag a-tag--ok">{t.team.accessActive}</span>}
                    {p && state === "wacht" && <span className="a-tag a-tag--warn">{t.team.accessPending}</span>}
                    {p && state === "nee" && <span className="a-tag">{t.team.accessNone}</span>}
                    {!manage && m.grants.map((g) => <span key={g} className="a-tag">{t.grants[g] ?? g}</span>)}
                  </span>
                  {manage && <GrantToggles m={m} />}
                </span>
                {mayGive && <Button variant="quiet" icon="key" onClick={() => setAccess(p)}>{t.team.giveAccess}</Button>}
                {manage && (m.role !== Role.werfleider || w.caps.setLeader) && <Button variant="quiet" busy={end.isPending && end.variables === m.id} onClick={() => end.mutate(m.id)}>{t.werven.endMember}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <Toevoegen w={w} caps={caps} members={members.data ?? []} onClose={() => setAdding(false)} />}
      {access && <ToegangGeven person={access} orgKind={kindOf(access)} workId={w.id} caps={caps} onClose={() => setAccess(null)} />}
    </section>
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Eén knop "Toevoegen": een bestaand contact (of een hele firma) zoeken, of een nieuw contact, met of zonder toegang. */
function Toevoegen({ w, caps, members, onClose }: { w: WorkView; caps: Caps; members: MembershipView[]; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const login = useLoginState(caps);
  const [mode, setMode] = useState<"bestaand" | "nieuw">("bestaand");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ kind: "p"; p: PersonView } | { kind: "o"; o: OrgView } | null>(null);
  const [role, setRole] = useState<Role>(Role.onderaannemer);
  const [withAccess, setWithAccess] = useState(false);
  const [nf, setNf] = useState({ org: "", name: "", phone: "", code: "" });
  const [code, setCode] = useState<{ name: string; c: NewCode } | null>(null);
  const firms = (orgs.data ?? []).filter((o) => o.kind !== OrgKind.bowaco);
  const orgName = (id?: bigint) => (id === undefined ? "BOWACO" : orgs.data?.find((o) => o.id === id)?.name ?? "");
  const newOrg = firms.find((o) => String(o.id) === nf.org);
  const newRole = roleForKind(newOrg?.kind);
  // Een klant heeft geen contactpersoon zonder login in de OA-database: dan altijd met een code.
  const mustAccess = mode === "nieuw" && newOrg?.kind === OrgKind.client;

  const hits = (() => {
    const f = fold(q.trim());
    if (f.length < 2) return [];
    const ps = (persons.data ?? []).filter((p) => fold(`${p.name} ${p.shortCode ?? ""} ${orgName(p.orgId)}`).includes(f)).slice(0, 8).map((p) => ({ kind: "p" as const, p }));
    const os = firms.filter((o) => fold(`${o.name} ${o.aliases.join(" ")}`).includes(f)).slice(0, 5).map((o) => ({ kind: "o" as const, o }));
    return [...ps, ...os];
  })();
  const choose = (h: NonNullable<typeof pick>) => {
    setPick(h);
    setWithAccess(false);
    if (h.kind === "p") setRole(h.p.roles.find((r) => MEMBER_ROLES.includes(r)) ?? Role.onderaannemer);
    else setRole(roleForKind(h.o.kind));
  };
  const already = (pid: bigint | undefined, oid: bigint | undefined, r: Role) => members.some((m) => m.role === r && m.endedAt === undefined && (pid !== undefined ? m.personId === pid : m.personId === undefined && m.orgId === oid));
  const pickedPerson = pick?.kind === "p" ? pick.p : null;
  const pickState = pickedPerson ? login(pickedPerson.id) : "?";
  const mayAccessPick = !!pickedPerson && caps.inviteExternal && isExternal(pickedPerson.roles) && pickState !== "ja" && pickState !== "wacht";
  const roleChoices = MEMBER_ROLES.filter((r) => (w.caps.setLeader || r !== Role.werfleider) && (pick?.kind !== "o" || r !== Role.werfleider));

  const save = useMutation({
    mutationFn: async (): Promise<{ name: string; c: NewCode } | null> => {
      if (mode === "bestaand") {
        if (!pick) throw new Error(W.search);
        if (pick.kind === "p" && withAccess && mayAccessPick) {
          // De code hangt aan de bestaande persoon; hij komt meteen op de werf met zijn eigen rol.
          return { name: pick.p.name, c: unwrap(await actor!.inviteExistingPerson({ personId: pick.p.id, workIds: [w.id], validDays: 0n, tag: "" })) };
        }
        if (already(pick.kind === "p" ? pick.p.id : undefined, pick.kind === "o" ? pick.o.id : undefined, role)) throw new Error(W.already);
        unwrap(await actor!.addMembership(w.id, pick.kind === "p" ? pick.p.id : null, pick.kind === "o" ? pick.o.id : null, role, defaultGrants(role)));
        return null;
      }
      if (!newOrg) throw new Error(W.pickFirm);
      if (withAccess || mustAccess) {
        return { name: nf.name, c: unwrap(await actor!.invitePerson({ name: nf.name, roles: [newRole], orgId: newOrg.id, shortCode: optText(nf.code), lang: "nl", phone: optText(nf.phone), workIds: [w.id], validDays: 0n, tag: "" })) };
      }
      const p = unwrap(await actor!.saveOaPerson(newOrg.id, { id: undefined, name: nf.name, shortCode: optText(nf.code), phone: optText(nf.phone), email: undefined, jobTitle: "", note: "" }));
      unwrap(await actor!.addMembership(w.id, p.id, null, newRole, defaultGrants(newRole)));
      return null;
    },
    // Een lid verandert ook de checklist (veiligheidscoördinator) en de werffiche: alles verversen.
    onSuccess: (r) => { void qc.invalidateQueries(); if (r) setCode(r); else onClose(); },
  });
  if (code) return <CodeShown title={`${t.team.codeTitle} ${code.name}`} code={code.c} onClose={onClose} />;
  const ok = mode === "bestaand" ? !!pick : !!newOrg && nf.name.trim() !== "" && (!mustAccess || caps.inviteExternal);
  return (
    <Sheet title={W.addTitle} open onClose={onClose} side footer={<>
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" disabled={!ok} busy={save.isPending} onClick={() => save.mutate()} data-testid="wie-toevoegen">{W.save}</Button>
    </>}>
      <div className="a-form">
        <Choice label={W.addTitle} value={mode} onChange={(m) => { setMode(m); setPick(null); setWithAccess(false); }} options={[{ value: "bestaand", label: W.existing }, { value: "nieuw", label: W.fresh }]} />
        {mode === "bestaand" ? (
          <>
            {!pick ? (
              <Field label={W.search}>
                <input className="bw-input" type="search" autoFocus value={q} placeholder={W.searchHint} onChange={(e) => setQ(e.target.value)} aria-label={W.search} />
                {q.trim().length >= 2 && hits.length === 0 && <span className="bw-muted">{W.noHit}</span>}
                {hits.length > 0 && (
                  <ul className="a-list">
                    {hits.map((h) => (
                      <li key={h.kind === "p" ? `p${h.p.id}` : `o${h.o.id}`}>
                        <button type="button" className="a-list__btn" onClick={() => choose(h)}>
                          <span className="a-list__main">
                            <b>{h.kind === "p" ? h.p.name : h.o.name}</b>
                            <span className="bw-muted">{h.kind === "p" ? `${orgName(h.p.orgId)} · ${h.p.roles.map((r) => t.roles[r] ?? r).join(", ")}` : `${t.orgKinds[h.o.kind]} · ${W.firmAsWhole}`}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            ) : (
              <Field label={W.picked}>
                <div className="a-row a-row--between">
                  <span><b>{pick.kind === "p" ? pick.p.name : pick.o.name}</b> <span className="bw-muted">{pick.kind === "p" ? orgName(pick.p.orgId) : `${t.orgKinds[pick.o.kind]} · ${W.firmAsWhole}`}</span></span>
                  <Button variant="quiet" onClick={() => setPick(null)}>{t.team.edit}</Button>
                </div>
              </Field>
            )}
            {pick && !(withAccess && mayAccessPick) && (
              <Field label={W.role}><Choice label={W.role} value={role} onChange={setRole} options={roleChoices.map((r) => ({ value: r, label: t.roles[r] }))} /></Field>
            )}
            {mayAccessPick && (
              <>
                <label className="a-check"><input type="checkbox" checked={withAccess} onChange={(e) => setWithAccess(e.target.checked)} /> {W.withAccess}</label>
                <span className="bw-muted">{withAccess ? T.noDouble : W.withAccessHint}</span>
              </>
            )}
          </>
        ) : (
          <>
            <Field label={W.firm}>
              <select className="bw-input" value={nf.org} onChange={(e) => setNf({ ...nf, org: e.target.value })}>
                <option value="">{W.pickFirm}</option>
                {firms.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name} ({t.orgKinds[o.kind]})</option>)}
              </select>
              <span className="bw-muted">{W.noFirm}</span>
            </Field>
            <Field label={T.name}><input className="bw-input" value={nf.name} maxLength={80} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></Field>
            <div className="a-grid2">
              <Field label={T.phone}><input className="bw-input" type="tel" value={nf.phone} maxLength={30} onChange={(e) => setNf({ ...nf, phone: e.target.value })} /></Field>
              <Field label={T.shortCode}><input className="bw-input bw-mono" value={nf.code} maxLength={20} onChange={(e) => setNf({ ...nf, code: e.target.value })} /></Field>
            </div>
            {newOrg && <Field label={`${T.role} (${T.roleFromFirm})`}><RoleTags roles={[newRole]} /></Field>}
            {mustAccess ? (
              <span className="bw-muted">{W.clientNeedsAccess}</span>
            ) : caps.inviteExternal && (
              <>
                <label className="a-check"><input type="checkbox" checked={withAccess} onChange={(e) => setWithAccess(e.target.checked)} /> {W.withAccess}</label>
                <span className="bw-muted">{W.withAccessHint}</span>
              </>
            )}
          </>
        )}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}
