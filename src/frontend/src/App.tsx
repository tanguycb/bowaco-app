import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Variant_active_pending_anonymous_unlinked as Status } from "./backend";
import { AdminPanel, CodeEntry } from "./screens/Access";
import { FilesPanel } from "./screens/Files";
import { PdfPanel } from "./screens/Pdf";
import { PrincipalPanel } from "./screens/Principal";
import { ProbePanel } from "./screens/Probe";
import { TicketPanel } from "./screens/Tickets";
import { useBackend } from "./util";

type Tab = "principal" | "toegang" | "bestanden" | "pdf" | "ticket" | "proef";

export default function App() {
  const { identity, isAuthenticated, isInitializing, isLoggingIn, isLoginError, loginError, login, clear } =
    useInternetIdentity();
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const me = useQuery({
    // De principal in de sleutel: na inloggen nooit het antwoord van de anonieme sessie hergebruiken.
    queryKey: ["me", identity?.getPrincipal().toText()],
    queryFn: () => actor!.me(),
    enabled: !!actor && !isFetching && isAuthenticated,
  });
  const [tab, setTab] = useState<Tab>("principal");

  if (isInitializing) return <Shell><p>Even laden…</p></Shell>;

  if (!isAuthenticated) {
    return (
      <Shell>
        <section className="card">
          <h2>Inloggen</h2>
          <p>BOWACO gebruikt alleen Internet Identity. Er wordt geen e-mailadres gevraagd.</p>
          <div className="stack">
            <button type="button" disabled={isLoggingIn} onClick={() => login()}>
              Inloggen met Internet Identity
            </button>
            <button type="button" className="secondary" disabled={isLoggingIn} onClick={() => login({ provider: "google" })}>
              Doorgaan met Google (via Internet Identity)
            </button>
          </div>
          {isLoggingIn && <p>Inloggen bij Internet Identity…</p>}
          {isLoginError && (
            <div className="error">
              <p>Inloggen mislukt: {loginError?.message ?? "onbekende fout"}</p>
              <button type="button" className="secondary" onClick={() => window.location.reload()}>
                Pagina opnieuw laden
              </button>
            </div>
          )}
        </section>
        <PrincipalPanel />
      </Shell>
    );
  }

  const status = me.data?.status;
  const person = me.data?.person;
  const isAdmin = !!person?.roles.includes("admin" as never);
  const refresh = () => qc.invalidateQueries();

  return (
    <Shell onLogout={clear} who={person?.name}>
      {(me.isLoading || !actor || isFetching) && !me.data && <p>Even laden…</p>}
      {me.error && <p className="error">{String(me.error)}</p>}
      {status === Status.unlinked && <CodeEntry onDone={refresh} blockedUntil={me.data?.blockedUntil} />}
      {status === Status.pending && (
        <section className="card">
          <h2>Wacht op bevestiging</h2>
          <p>Je koppeling als {person?.name} is ontvangen. Een admin moet ze nog bevestigen.</p>
          <button type="button" onClick={refresh}>Opnieuw kijken</button>
        </section>
      )}
      {status === Status.active && (
        <>
          <nav className="tabs">
            {(
              [
                ["principal", "Principal"],
                ["toegang", "Toegang"],
                ["bestanden", "Bestanden"],
                ["pdf", "PDF"],
                ["ticket", "Ticket"],
                ["proef", "Proef"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === "principal" && <PrincipalPanel />}
          {tab === "toegang" && <AdminPanel isAdmin={isAdmin} />}
          {tab === "bestanden" && <FilesPanel />}
          {tab === "pdf" && <PdfPanel />}
          {tab === "ticket" && <TicketPanel />}
          {tab === "proef" && <ProbePanel />}
        </>
      )}
      {status !== Status.active && <PrincipalPanel />}
    </Shell>
  );
}

function Shell(props: { children: React.ReactNode; onLogout?: () => void; who?: string }) {
  return (
    <div className="app">
      <header>
        <span className="brand">BOWACO</span>
        <span className="tag">haalbaarheidstest 0.2</span>
        {props.onLogout && (
          <span className="right">
            {props.who && <span className="who">{props.who}</span>}
            <button type="button" className="link" onClick={props.onLogout}>Uitloggen</button>
          </span>
        )}
      </header>
      <main>{props.children}</main>
    </div>
  );
}
