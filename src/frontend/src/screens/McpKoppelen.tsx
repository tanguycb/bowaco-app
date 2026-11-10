// 3.13: de toestemmingspagina /mcp-authorize (OAuth 2.1 van caffeineai-mcp-server). Claude of Grok stuurt de beheerder hierheen
// bij "connector toevoegen". Enkel met de Internet Identity van een BOT: eerst (eenmalig) de koppelcode uit Beheer, daarna toestaan.
// Zelfde regels als useMcpAuthorize van @caffeineai/mcp-server: niet in een kader, enkel terug naar een geregistreerd adres van
// die toepassing, PKCE verplicht (de backend aanvaardt enkel S256). Een identiteit van een persoon kan hier nooit goedkeuren.
import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../design";
import { useOutbox } from "../offline/outbox";
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
  // 3.12 (review L): de hele vraag nakijken vóór er iets getoond wordt: PKCE S256, lengtes, en een adres dat de browser kan lezen.
  if (p.get("code_challenge_method") !== "S256" || codeChallenge.length < 43 || codeChallenge.length > 128) return null;
  if (clientId.length > 128 || redirectUri.length > 512 || (p.get("state") ?? "").length > 2048) return null;
  try { new URL(redirectUri); } catch { return null; }
  return { clientId, redirectUri, codeChallenge, codeChallengeMethod: "S256", state: p.get("state") };
}

function redirectTo(uri: string, params: Record<string, string | null>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  window.location.assign(u.toString());
}

function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return u.host;
    if (u.protocol === "http:") return `${u.host} (dit toestel)`;
    return `${u.protocol}//${u.host}`;
  } catch {
    return "?";
  }
}

export const isMcpAuthorize = () => window.location.pathname === "/mcp-authorize" || window.location.pathname === "/mcp-authorize/";

export function McpKoppelen({ onLogout }: { onLogout: () => Promise<void> }) {
  const { isAuthenticated, login, isLoggingIn } = useInternetIdentity();
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching && isAuthenticated;
  const ob = useOutbox();
  const [leave, setLeave] = useState(false);
  const [req] = useState(requestFromLocation);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const who = useQuery({ queryKey: ["myBot"], queryFn: () => actor!.myBot(), enabled: on });
  // 3.12 (review L): de toepassing opzoeken kan al vóór het inloggen (publieke query): een ongeldige vraag vraagt geen login.
  const client = useQuery({ queryKey: ["mcpClient", req?.clientId], queryFn: () => actor!._caffeineMcpClient(req!.clientId), enabled: !!actor && !isFetching && !!req });

  if (window.self !== window.top) return <p className="a-err">{A.framed}</p>;
  const head = (
    <>
      <h1 className="bw-h1">{A.title}</h1>
      <p className="bw-muted">{A.lead}</p>
    </>
  );
  // 3.12 (review M2): na Toestaan of Weigeren is de bot hier uitgelogd; dit scherm blijft staan tot de browser doorstuurt.
  if (going) return <>{head}<p className="bw-muted">{A.redirecting}</p></>;
  if (!req) return <>{head}<p className="a-err">{A.invalid}</p></>;
  // De toepassing is gekend zodra de (publieke) opzoeking klaar is. Lukt die vóór het inloggen, dan krijgt een ongeldige of niet
  // toegelaten vraag geen loginknop; anders volgt dezelfde controle meteen na het inloggen.
  const c = client.data;
  if (client.isFetched) {
    if (!c) return <>{head}<p className="a-err">{A.invalid}</p></>;
    // De backend geeft enkel de adressen terug die de beheerder toelaat (3.12, review M1): een ander adres krijgt geen knoppen.
    if (!c.redirectUris.includes(req.redirectUri)) return <>{head}<p className="a-note a-note--bad">{A.notAllowed(hostOf(req.redirectUri))}</p></>;
  }
  if (!isAuthenticated) return <>{head}<p><b>{A.redirect(hostOf(req.redirectUri))}</b></p><Button variant="primary" size="lg" block busy={isLoggingIn} onClick={() => login()}>{A.login}</Button></>;
  if (!who.data || !client.isFetched || !c) return <>{head}<p className="bw-muted">{t.common.loading}</p></>;
  const w = who.data;
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try { await f(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  if (w.__kind__ === "person") {
    // 3.12 (review L): uitloggen wist de lokale wachtrij van deze persoon; eerst waarschuwen als er nog iets wacht.
    const waiting = ob.ops.length;
    return (
      <>
        {head}
        <p className="a-note a-note--bad">{A.person}</p>
        {waiting > 0 && leave && <p className="a-note a-note--bad">{A.personQueue(waiting)}</p>}
        <Button variant="secondary" onClick={() => (waiting > 0 && !leave ? setLeave(true) : void onLogout())}>{waiting > 0 && leave ? A.logoutAnyway : A.logout}</Button>
      </>
    );
  }
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
        <Button variant="quiet" onClick={() => void onLogout()}>{A.logout}</Button>
      </>
    );
  }
  const approve = () => run(async () => {
    const r = unwrap(await actor!._caffeineMcpApprove({ clientId: req.clientId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, codeChallengeMethod: req.codeChallengeMethod }));
    setGoing(true);
    // 3.12 (review M2): de identiteit van de bot blijft niet ingelogd in deze browser (anders volstaat later één klik op een
    // nieuwe koppelvraag, zonder login en zonder koppelcode). Eerst uitloggen, dan terug naar de toepassing.
    await onLogout().catch(() => {});
    redirectTo(req.redirectUri, { code: r, state: req.state });
  });
  const deny = () => run(async () => {
    setGoing(true);
    await onLogout().catch(() => {});
    redirectTo(req.redirectUri, { error: "access_denied", state: req.state });
  });
  return (
    <>
      {head}
      <p><b>{A.redirect(hostOf(req.redirectUri))}</b></p>
      <p>{A.ask(c.name, w.bot.name)}</p>
      <p className="bw-muted">{A.redirectHint}</p>
      <div className="a-row">
        <Button variant="primary" busy={busy} onClick={approve}>{A.allow}</Button>
        <Button variant="secondary" disabled={busy} onClick={deny}>{A.deny}</Button>
      </div>
      {err && <p className="a-err">{err}</p>}
    </>
  );
}
