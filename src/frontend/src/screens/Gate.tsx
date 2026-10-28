import { useState } from "react";
import { Button, Info } from "../design";
import { t } from "../texts/nl";
import { errText, fmtTime, unwrap, useBackend } from "../util";

export function Login({ busy, error, onLogin, hasCode }: { busy: boolean; error: string | null; onLogin: (google: boolean) => void; hasCode: boolean }) {
  return (
    <>
      <h1 className="bw-h1">{t.login.title}</h1>
      <p className="bw-muted">{t.login.lead}<Info text={t.uitleg.ii} label={t.uitleg.label} /></p>
      {hasCode && <p className="a-note">{t.login.codeHint}</p>}
      <Button variant="primary" size="lg" block busy={busy} onClick={() => onLogin(false)}>{t.login.ii}</Button>
      <Button variant="secondary" block disabled={busy} onClick={() => onLogin(true)}>{t.login.google}</Button>
      {busy && <p className="bw-muted">{t.login.busy}</p>}
      {error && (
        <div className="a-stack">
          <p className="a-err">{t.login.failed}: {error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>{t.login.reload}</Button>
        </div>
      )}
    </>
  );
}

/** Code invoeren na de eerste login (§3.3.3). De opstartcode zit achter een knop: die is er maar één keer. */
export function CodeEntry({ initial, blockedUntil, onDone }: { initial: string | null; blockedUntil?: bigint; onDone: () => void }) {
  const { actor } = useBackend();
  const [code, setCode] = useState(initial ?? "");
  const [boot, setBoot] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blocked = blockedUntil !== undefined;

  const submit = async () => {
    if (!actor) return;
    setBusy(true);
    setErr(null);
    try {
      if (boot) unwrap(await actor.claimBootstrap(code, name));
      else unwrap(await actor.redeemCode(code));
      // De code uit de link is gebruikt: weg uit het adres.
      if (window.location.hash.includes("code=")) window.history.replaceState(null, "", window.location.pathname);
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="a-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1 className="bw-h1">{boot ? t.code.bootstrapTitle : t.code.title}</h1>
      <p className="bw-muted">{boot ? t.code.bootstrapLead : t.code.lead}</p>
      {initial && !boot && <p className="a-note">{t.code.fromLink}</p>}
      {blocked && <p className="a-err">{t.code.blocked(fmtTime(blockedUntil))}</p>}
      <label className="bw-field">
        <span className="bw-label">{t.code.label}</span>
        <input className="bw-input bw-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t.code.placeholder} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </label>
      {boot && (
        <label className="bw-field">
          <span className="bw-label">{t.code.bootstrapName}</span>
          <input className="bw-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
      )}
      {err && <p className="a-err" role="alert">{err}</p>}
      <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={blocked || code.trim().length < 12}>
        {boot ? t.code.bootstrapSubmit : t.code.submit}
      </Button>
      <Button variant="quiet" onClick={() => { setBoot(!boot); setErr(null); }}>{boot ? t.code.title : t.code.bootstrapTitle}</Button>
    </form>
  );
}

export function Pending({ name, onCheck }: { name: string; onCheck: () => void }) {
  return (
    <>
      <h1 className="bw-h1">{t.pending.title}</h1>
      <p>{t.pending.lead(name)}</p>
      <Button variant="primary" onClick={onCheck}>{t.pending.check}</Button>
    </>
  );
}
