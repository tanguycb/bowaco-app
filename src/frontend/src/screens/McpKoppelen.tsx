// 3.13: de toestemmingspagina /mcp-authorize (OAuth 2.1 van caffeineai-mcp-server). Claude of Grok stuurt de beheerder hierheen
// bij "connector toevoegen". Enkel met de Internet Identity van een BOT: eerst (eenmalig) de koppelcode uit Beheer, daarna toestaan.
// Zelfde regels als useMcpAuthorize van @caffeineai/mcp-server: niet in een kader, enkel terug naar een geregistreerd adres van
// die toepassing, PKCE verplicht (de backend aanvaardt enkel S256). Een identiteit van een persoon kan hier nooit goedkeuren.
import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../design";
import { t } from "../texts/nl";
import { errText, unwrap, useBackend } from "../util";

const A = t.bots.authorize;

type Req = { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod: string; state: string | null };

function requestFromLocation(): Req | null {
  if (typeof window === "undefined" || window.self !== window.top) return null;
  const p = new URLSearchParams(window.location.search);
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  const codeChallenge = p.get("code_challenge");
  if (p.get("response_type") !== "code" || !clientId || !redirectUri || !codeChallenge) return null;
  return { clientId, redirectUri, codeChallenge, codeChallengeMethod: p.get("code_challenge_method") ?? "plain", state: p.get("state") };
}

function redirectTo(uri: string, params: Record<string, string | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  window.location.assign(u.toString());
}

function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:" ? u.host : `${u.protocol}//${u.host}`;
  } catch {
    return "?";
  }
}

export const isMcpAuthorize = () => window.location.pathname === "/mcp-authorize" || window.location.pathname === "/mcp-authorize/";

export function McpKoppelen({ onLogout }: { onLogout: () => void }) {
  const { isAuthenticated, login, isLoggingIn } = useInternetIdentity();
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching && isAuthenticated;
  const [req] = useState(requestFromLocation);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const who = useQuery({ queryKey: ["myBot"], queryFn: () => actor!.myBot(), enabled: on });
  const client = useQuery({ queryKey: ["mcpClient", req?.clientId], queryFn: () => actor!._caffeineMcpClient(req!.clientId), enabled: on && !!req });

  if (window.self !== window.top) return <p className="a-err">{A.framed}</p>;
  const head = (
    <>
      <h1 className="bw-h1">{A.title}</h1>
      <p className="bw-muted">{A.lead}</p>
    </>
  );
  if (!req) return <>{head}<p className="a-err">{A.invalid}</p></>;
  if (!isAuthenticated) return <>{head}<Button variant="primary" size="lg" block busy={isLoggingIn} onClick={() => login()}>{A.login}</Button></>;
  if (!who.data || client.isLoading) return <>{head}<p className="bw-muted">{t.common.loading}</p></>;
  const c = client.data;
  if (!c || !c.redirectUris.includes(req.redirectUri)) return <>{head}<p className="a-err">{A.invalid}</p></>;
  const w = who.data;
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try { await f(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  if (w.__kind__ === "person") return <>{head}<p className="a-note a-note--bad">{A.person}</p><Button variant="secondary" onClick={onLogout}>{A.logout}</Button></>;
  if (w.__kind__ === "revoked") return <>{head}<p className="a-note a-note--bad">{A.revoked}</p></>;
  if (w.__kind__ === "none") {
    return (
      <>
        {head}
        <label className="bw-field"><span className="bw-label">{A.code}</span>
          <input className="bw-input" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BOT-XXXX-XXXX-XXXX-XXXX" />
        </label>
        <Button variant="primary" block busy={busy} disabled={code.trim().length < 16} onClick={() => run(async () => { unwrap(await actor!.claimBotCode(code)); setCode(""); await who.refetch(); })}>{A.claim}</Button>
        {err && <p className="a-err">{err}</p>}
        <Button variant="quiet" onClick={onLogout}>{A.logout}</Button>
      </>
    );
  }
  const approve = () => run(async () => {
    const r = unwrap(await actor!._caffeineMcpApprove({ clientId: req.clientId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, codeChallengeMethod: req.codeChallengeMethod }));
    setGoing(true);
    redirectTo(req.redirectUri, { code: r, state: req.state });
  });
  const deny = () => { setGoing(true); redirectTo(req.redirectUri, { error: "access_denied", state: req.state }); };
  return (
    <>
      {head}
      <p><b>{A.ask(c.name, w.bot.name)}</b></p>
      <p className="bw-muted">{A.redirect(hostOf(req.redirectUri))}</p>
      {going ? <p className="bw-muted">{A.redirecting}</p> : (
        <div className="a-row">
          <Button variant="primary" busy={busy} onClick={approve}>{A.allow}</Button>
          <Button variant="secondary" disabled={busy} onClick={deny}>{A.deny}</Button>
        </div>
      )}
      {err && <p className="a-err">{err}</p>}
    </>
  );
}
