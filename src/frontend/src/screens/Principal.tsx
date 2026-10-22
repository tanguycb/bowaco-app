import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery } from "@tanstack/react-query";
import { loadConfig } from "../util";

// (b) Dit scherm toont wat de eigenaar op draft en live moet vergelijken.
export function PrincipalPanel() {
  const { identity } = useInternetIdentity();
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => loadConfig(), retry: false });
  const principal = identity?.getPrincipal().toText();
  const rows: [string, string | undefined][] = [
    ["Jouw principal", principal ?? "(niet ingelogd)"],
    ["Adres van deze pagina (origin)", window.location.origin],
    ["II-afleidingsadres (derivation origin)", cfg.data?.ii_derivation_origin ?? "(niet gezet: de origin hierboven telt)"],
    ["Backend-canister", cfg.data?.backend_canister_id],
    ["Opslag-gateway", cfg.data?.storage_gateway_url],
    ["Caffeine-project", cfg.data?.project_id],
  ];
  return (
    <section className="card">
      <h2>Principal</h2>
      <p>
        Noteer de principal hier en op de live-versie. Is hij gelijk, dan herkent de app je op beide met dezelfde
        login. Is hij verschillend, dan heb je op live een herstelcode nodig.
      </p>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v ?? "…"}</dd>
          </div>
        ))}
      </dl>
      {principal && (
        <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(principal)}>
          Principal kopiëren
        </button>
      )}
      {cfg.error && <p className="error">env.json niet gelezen: {String(cfg.error)}</p>}
    </section>
  );
}
