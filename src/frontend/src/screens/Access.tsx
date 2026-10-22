import type { Principal } from "@icp-sdk/core/principal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type NewCode, Role } from "../backend";
import { errText, fmtTime, unwrap, useBackend } from "../util";

// Code uit de link …/#code=BOW-… (het deel na # bereikt de server nooit).
function codeFromHash(): string {
  const m = window.location.hash.match(/code=([A-Za-z0-9-]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function bodyLength(code: string): number {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^BOW(?=.{12}$|.{16}$)/, "").length;
}

export function CodeEntry(props: { onDone: () => void; blockedUntil?: bigint }) {
  const { actor } = useBackend();
  const [code, setCode] = useState(codeFromHash);
  const [name, setName] = useState("");
  const isBootstrap = bodyLength(code) === 16;
  const run = useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("Nog niet verbonden");
      if (isBootstrap) return unwrap(await actor.claimBootstrap(code, name));
      return unwrap(await actor.redeemCode(code));
    },
    onSuccess: () => {
      history.replaceState(null, "", window.location.pathname);
      props.onDone();
    },
  });
  return (
    <section className="card">
      <h2>Voer je code in</h2>
      <p>Je bent ingelogd, maar nog niet gekoppeld. Gebruik de code die je van BOWACO kreeg.</p>
      {props.blockedUntil && <p className="error">Te veel pogingen. Opnieuw proberen na {fmtTime(props.blockedUntil)}.</p>}
      <div className="stack">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="BOW-XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        {isBootstrap && (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Je naam (opstartcode = eerste admin)" />
        )}
        <button type="button" disabled={!code || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Bezig…" : isBootstrap ? "Opstartcode gebruiken" : "Koppelen"}
        </button>
      </div>
      {run.error && <p className="error">{errText(run.error)}</p>}
    </section>
  );
}

const ROLES: [Role, string][] = [
  [Role.admin, "admin"],
  [Role.werfleider, "werfleider"],
  [Role.calculator, "calculator"],
  [Role.architect, "architect"],
  [Role.onderaannemer, "onderaannemer"],
  [Role.klant, "klant"],
];

export function AdminPanel(props: { isAdmin: boolean }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>([Role.onderaannemer]);
  const [days, setDays] = useState(7);
  const [made, setMade] = useState<NewCode | null>(null);
  const ready = !!actor;
  const invites = useQuery({ queryKey: ["invites"], queryFn: () => actor!.listInvites(), enabled: ready });
  const links = useQuery({ queryKey: ["links"], queryFn: () => actor!.listLinks(), enabled: ready && props.isAdmin });
  const persons = useQuery({ queryKey: ["persons"], queryFn: () => actor!.listPersons(), enabled: ready && props.isAdmin });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => actor!.auditLog(50n), enabled: ready && props.isAdmin });
  const done = () => qc.invalidateQueries();

  const invite = useMutation({
    mutationFn: async () => unwrap(await actor!.invitePerson(name, roles, BigInt(days))),
    onSuccess: (c) => {
      setMade(c);
      setName("");
      done();
    },
  });
  const recovery = useMutation({
    mutationFn: async (personId: bigint) => unwrap(await actor!.createRecoveryCode(personId, 7n)),
    onSuccess: (c) => {
      setMade(c);
      done();
    },
  });
  const act = useMutation({
    mutationFn: async (f: () => Promise<{ __kind__: "ok"; ok: null } | { __kind__: "err"; err: string }>) => unwrap(await f()),
    onSuccess: done,
  });
  const link = made ? `${window.location.origin}/#code=${made.code}` : "";

  return (
    <>
      <section className="card">
        <h2>Iemand uitnodigen</h2>
        <div className="stack">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam (testpersoon, geen klantgegevens)" />
          <div className="chips">
            {ROLES.map(([r, label]) => (
              <label key={r} className="chip">
                <input
                  type="checkbox"
                  checked={roles.includes(r)}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            Geldig (dagen){" "}
            <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <button type="button" disabled={!name || roles.length === 0 || invite.isPending} onClick={() => invite.mutate()}>
            {invite.isPending ? "Code maken…" : "Code maken"}
          </button>
        </div>
        {invite.error && <p className="error">{errText(invite.error)}</p>}
        {made && (
          <div className="code">
            <p>Code (wordt maar één keer getoond):</p>
            <p className="big mono">{made.code}</p>
            <p className="mono small">{link}</p>
            <p>Geldig tot {fmtTime(made.expiresAt)}.</p>
            <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(link)}>
              Link kopiëren
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Codes</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Voor</th><th>Soort</th><th>Einde</th><th>Stand</th><th></th></tr>
          </thead>
          <tbody>
            {(invites.data ?? []).map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.id)}</td>
                <td>{i.personName} <span className="mono small">…{i.hint}</span></td>
                <td>{i.kind}</td>
                <td>{fmtTime(i.expiresAt)}</td>
                <td>{i.state.__kind__ === "used" ? `gebruikt ${fmtTime(i.state.used.at)}` : i.state.__kind__ === "revoked" ? "ingetrokken" : "open"}</td>
                <td>
                  {i.state.__kind__ === "open" && (
                    <button type="button" className="link" onClick={() => act.mutate(() => actor!.revokeInvite(i.id))}>
                      intrekken
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {props.isAdmin && (
        <>
          <section className="card">
            <h2>Koppelingen</h2>
            <table>
              <thead>
                <tr><th>Persoon</th><th>Principal</th><th>Stand</th><th></th></tr>
              </thead>
              <tbody>
                {(links.data ?? []).map((l) => (
                  <tr key={l.principal.toText()}>
                    <td>{l.personName}<br /><span className="small">{fmtTime(l.linkedAt)} met code …{l.codeHint}</span></td>
                    <td className="mono small">{short(l.principal)}</td>
                    <td>{l.status === "active" ? "actief" : "wacht"}</td>
                    <td>
                      {l.status !== "active" && (
                        <button type="button" className="link" onClick={() => act.mutate(() => actor!.confirmLink(l.principal))}>
                          bevestigen
                        </button>
                      )}{" "}
                      <button type="button" className="link danger" onClick={() => act.mutate(() => actor!.revokeLink(l.principal))}>
                        afzetten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {act.error && <p className="error">{errText(act.error)}</p>}
          </section>

          <section className="card">
            <h2>Personen</h2>
            <ul className="plain">
              {(persons.data ?? []).map((p) => (
                <li key={String(p.id)}>
                  {p.name} <span className="small">({p.roles.join(", ")})</span>{" "}
                  <button type="button" className="link" onClick={() => recovery.mutate(p.id)}>herstelcode</button>
                </li>
              ))}
            </ul>
            {recovery.error && <p className="error">{errText(recovery.error)}</p>}
          </section>

          <section className="card">
            <h2>Auditlog (laatste 50)</h2>
            <ul className="plain small">
              {(audit.data ?? []).slice().reverse().map((a, n) => (
                <li key={n}>
                  {fmtTime(a.at)} · <b>{a.action}</b> {a.detail} <span className="mono">{short(a.who)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function short(p: Principal): string {
  const t = p.toText();
  return t.length > 20 ? `${t.slice(0, 11)}…${t.slice(-5)}` : t;
}
