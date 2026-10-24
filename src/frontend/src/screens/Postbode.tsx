// Postbode (stap 1b.3, sinds mail-caffeine): de app verstuurt de mails zelf via de maildienst van Caffeine. De
// beheerder zet de testmodus (alle mail naar één testadres, of droog), de weekmail en de herinneringen, bekijkt een mail
// vooraf zoals ze vertrekt, zet een proefmail klaar en verstuurt meteen, volgt de wachtrij en het logboek (zonder
// adressen), en kiest per firma aan/uit en de taal. Robots (de gateway) blijven voor fase 3; ze krijgen geen mail meer.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import type { JobView, MailLogView, MailPreview } from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtTime, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const S = t.postbode;
const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const nextMonday = () => { const d = todayDay(); const wd = (Number(d) + 3) % 7; return d + BigInt(7 - wd); };
const fmtCycles = (n: bigint) => (n >= 1_000_000_000n ? `${(Number(n) / 1e9).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} miljard` : `${(Number(n) / 1e6).toLocaleString("nl-BE", { maximumFractionDigits: 1 })} miljoen`);

function stateText(j: JobView): { text: string; tone: string } {
  const s = j.state;
  switch (s.__kind__) {
    case "queued": return { text: S.states.queued, tone: "a-tag--accent" };
    case "leased": return { text: S.states.leased, tone: "a-tag--accent" };
    case "done": {
      const skip = s.done.result.startsWith("overgeslagen") || s.done.result.startsWith("droog");
      return { text: skip ? s.done.result : s.done.result.startsWith("verstuurd") ? s.done.result : S.states.done, tone: skip ? "" : "a-tag--ok" };
    }
    case "failed": return { text: `${s.failed.why.startsWith("onzeker") ? S.states.unsure : S.states.failed}: ${s.failed.why}`, tone: "a-tag--bad" };
    case "cancelled": return { text: S.states.cancelled, tone: "" };
  }
}

function outcomeText(l: MailLogView): { text: string; tone: string } {
  const o = l.outcome;
  switch (o.__kind__) {
    case "sent": return { text: l.test ? S.log.sentTest : S.log.sent, tone: "a-tag--ok" };
    case "dryRun": return { text: S.log.dry, tone: "" };
    case "failed": return { text: `${S.log.failed}: ${o.failed}`, tone: "a-tag--bad" };
    case "unsure": return { text: `${S.log.unsure}: ${o.unsure}`, tone: "a-tag--bad" };
  }
}

export function PostbodePage() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({ queryKey: ["postSettings"], queryFn: () => actor!.postSettings(), enabled: on, refetchInterval: 30_000 });
  const [filter, setFilter] = useState("open");
  const jobs = useQuery({ queryKey: ["jobs", filter], queryFn: () => actor!.listJobs(filter, 0n, 100n), enabled: on, refetchInterval: 30_000 });
  const log = useQuery({ queryKey: ["mailLog"], queryFn: () => actor!.listMailLog(0n, 50n), enabled: on, refetchInterval: 30_000 });
  const oas = useQuery({ queryKey: ["oas-post"], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: on });
  const [weekmail, setWeekmail] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [day, setDay] = useState(4);
  const [hour, setHour] = useState("14");
  const [rDay, setRDay] = useState(2);
  const [url, setUrl] = useState("");
  const [contact, setContact] = useState("");
  const [testOn, setTestOn] = useState(true);
  const [testAddr, setTestAddr] = useState("");
  useEffect(() => {
    if (!st.data) return;
    const d = st.data;
    setWeekmail(d.weekmail); setReminders(d.reminders); setDay(Number(d.day)); setHour(String(d.hour)); setRDay(Number(d.reminderDay)); setUrl(d.appUrl); setContact(d.contact);
    setTestOn(d.testMode); setTestAddr(d.testAddress);
  }, [st.data]);
  const refresh = () => { for (const k of ["postSettings", "jobs", "mailLog"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const done = (text: string = t.common.saved) => { toast.show({ kind: "ok", text }); refresh(); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({ mutationFn: async () => unwrap(await actor!.setPostSettings({ weekmail, reminders, day: BigInt(day), hour: BigInt(hour || "0"), reminderDay: BigInt(rDay), appUrl: url.trim(), contact: contact.trim() })), onSuccess: () => done(), onError: fail });
  const [confirmOff, setConfirmOff] = useState(false);
  const saveTest = useMutation({ mutationFn: async () => unwrap(await actor!.setMailTest(testOn, testOn ? testAddr.trim() : "")), onSuccess: () => { setConfirmOff(false); done(); }, onError: fail });
  const [testTo, setTestTo] = useState("");
  const test = useMutation({ mutationFn: async () => unwrap(await actor!.queueTestMail(testTo.trim() || (st.data?.testAddress ?? ""))), onSuccess: () => { setTestTo(""); done(S.testQueued); }, onError: fail });
  const now = useMutation({
    mutationFn: async () => unwrap(await actor!.sendMailNow()),
    onSuccess: (r) => done(r.busy ? S.roundBusy : S.round(Number(r.sent), Number(r.dry), Number(r.skipped), Number(r.failed))),
    onError: fail,
  });
  const [preview, setPreview] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const qAll = useMutation({ mutationFn: async () => unwrap(await actor!.queueWeekMails(nextMonday(), null)), onSuccess: (n) => { setConfirmAll(false); done(S.queued(Number(n))); }, onError: fail });
  const cancel = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.cancelJob(id)), onSuccess: () => done(), onError: fail });
  const retry = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.retryJob(id)), onSuccess: () => done(), onError: fail });
  const optOut = useMutation({ mutationFn: async ([id, v]: [bigint, boolean]) => unwrap(await actor!.setOrgMail(id, v)), onSuccess: () => done(), onError: fail });
  const setLang = useMutation({ mutationFn: async ([id, l]: [bigint, string]) => unwrap(await actor!.setOrgMailLang(id, l)), onSuccess: () => done(), onError: fail });
  const s = st.data;
  const withMail = (oas.data ?? []).filter((o) => o.org.kind === "subcontractor");
  const testSaved = s ? s.testMode === testOn && s.testAddress === testAddr.trim() : true;
  return (
    <Page title={S.title}>
      <p className="bw-muted">{S.lead}</p>
      <Loading q={st} />
      {s && (
        <>
          <div className="a-counters">
            <div className="a-counter"><span className="a-counter__n">{String(s.queued)}</span><span className="a-counter__l">{S.states.queued}</span></div>
            <div className="a-counter"><span className="a-counter__n">{String(s.leased)}</span><span className="a-counter__l">{S.states.leased}</span></div>
            <div className={`a-counter${s.failed > 0n ? " a-counter--warn" : ""}`}><span className="a-counter__n">{String(s.failed)}</span><span className="a-counter__l">{S.states.failed}</span></div>
            <div className="a-counter"><span className="a-counter__n">{String(s.sent)}</span><span className="a-counter__l">{S.sentCount}</span></div>
            <div className="a-counter"><span className="a-counter__n a-counter__n--small">{s.sent > 0n ? fmtCycles(s.cyclesSent / s.sent) : "–"}</span><span className="a-counter__l">{S.cyclesPerMail}</span></div>
            <div className="a-counter"><span className="a-counter__n a-counter__n--small">{fmtCycles(s.cyclesBalance)}</span><span className="a-counter__l">{S.cyclesBalance}</span></div>
          </div>

          <section className="a-section" style={{ maxWidth: 640 }}>
            <h2 className="bw-h2">{S.testTitle}</h2>
            <p className={`a-note${s.testMode ? "" : " a-note--bad"}`}>
              <Icon name="alert" size={16} /> {s.testMode ? (s.testAddress ? S.testOnTo : S.testOnDry) : S.testOff}
            </p>
            {s.draft && <p className="bw-muted">{S.testDraft}</p>}
            {!s.draft && !s.liveMail && <p className="bw-muted">{S.testNotLive}</p>}
            <Field label={S.testMode}><Choice label={S.testMode} value={testOn ? "aan" : "uit"} onChange={(v) => setTestOn(v === "aan" || !s.liveMail)} options={[{ value: "aan", label: S.on }, ...(s.liveMail ? [{ value: "uit", label: S.off }] : [])]} /></Field>
            {testOn && <Field label={S.testAddress}><input className="bw-input" type="email" value={testAddr} placeholder={S.testAddressPh} onChange={(e) => setTestAddr(e.target.value)} /></Field>}
            <p className="bw-muted">{S.testHelp}</p>
            <div><Button variant="primary" disabled={testSaved} busy={saveTest.isPending} onClick={() => (testOn ? saveTest.mutate() : setConfirmOff(true))}>{t.common.save}</Button></div>
          </section>

          <section className="a-section" style={{ maxWidth: 640 }}>
            <h2 className="bw-h2">{S.settings}</h2>
            <Field label={S.appUrl}><input className="bw-input" value={url} placeholder="https://app.bowaco.eu" onChange={(e) => setUrl(e.target.value)} /></Field>
            <Field label={S.contact}><input className="bw-input" type="email" value={contact} placeholder="info@bowaco.eu" onChange={(e) => setContact(e.target.value)} /></Field>
            <Field label={S.weekmail}><Choice label={S.weekmail} value={weekmail ? "aan" : "uit"} onChange={(v) => setWeekmail(v === "aan")} options={[{ value: "aan", label: S.on }, { value: "uit", label: S.off }]} /></Field>
            <div className="a-row">
              <Field label={S.day}><select className="bw-input" value={day} onChange={(e) => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
              <Field label={S.hour}><input className="bw-input bw-num" style={{ maxWidth: 90 }} inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value.replace(/\D/g, ""))} /></Field>
            </div>
            <p className="bw-muted">{S.weekmailHelp}</p>
            <Field label={S.reminders}><Choice label={S.reminders} value={reminders ? "aan" : "uit"} onChange={(v) => setReminders(v === "aan")} options={[{ value: "aan", label: S.on }, { value: "uit", label: S.off }]} /></Field>
            <Field label={S.reminderDay}><select className="bw-input" value={rDay} onChange={(e) => setRDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
            <p className="bw-muted">{S.remindersHelp}</p>
            <div><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
          </section>

          <section className="a-section" style={{ maxWidth: 640 }}>
            <h2 className="bw-h2">{S.tryTitle}</h2>
            <div className="a-row">
              <Button icon="doc" onClick={() => setPreview(true)}>{S.preview}</Button>
              <Button onClick={() => setConfirmAll(true)}>{S.queueAll}</Button>
            </div>
            <div className="a-row">
              <Field label={S.testTo}><input className="bw-input" type="email" value={testTo} placeholder={s.testMode && s.testAddress ? s.testAddress : ""} onChange={(e) => setTestTo(e.target.value)} /></Field>
              <Button busy={test.isPending} disabled={!(testTo.includes("@") || (s.testMode && !!s.testAddress))} onClick={() => test.mutate()}>{S.testSend}</Button>
            </div>
            <p className="bw-muted">{S.testMailHelp}</p>
            <div className="a-row">
              <Button variant="primary" icon="sync" busy={now.isPending} disabled={s.sending} onClick={() => now.mutate()}>{S.sendNow}</Button>
              <span className="bw-muted">{s.sending ? S.roundBusy : S.sendNowHelp}</span>
            </div>
          </section>
        </>
      )}

      <section className="a-section">
        <div className="a-row a-row--between">
          <h2 className="bw-h2">{S.queue}</h2>
          <Choice label={S.queue} value={filter} onChange={setFilter} options={[{ value: "open", label: S.filter.open }, { value: "mislukt", label: S.filter.failed }, { value: "alles", label: S.filter.all }]} />
        </div>
        <Loading q={jobs} />
        {jobs.data && jobs.data.length === 0 && <p className="a-empty">{S.noJobs}</p>}
        {jobs.data && jobs.data.length > 0 && (
          <ul className="a-list">
            {jobs.data.map((j) => {
              const x = stateText(j);
              return (
                <li key={String(j.id)}>
                  <span className="a-list__main">
                    <b>#{String(j.id)} · {S.kinds[j.kind] ?? j.kind}{j.orgName ? ` · ${j.orgName}` : ""}</b>
                    <span className="bw-muted">{j.ref ? `${S.week} ${fmtDayNum(BigInt(j.ref))} · ` : ""}{S.attempts(Number(j.attempts))} · {fmtTime(j.updatedAt)} · {j.createdByName}</span>
                  </span>
                  <span className={`a-tag ${x.tone}`}>{x.text}</span>
                  {j.state.__kind__ === "queued" && <Button variant="quiet" onClick={() => cancel.mutate(j.id)}>{S.cancel}</Button>}
                  {j.state.__kind__ === "failed" && <Button variant="quiet" onClick={() => retry.mutate(j.id)}>{S.retry}</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="a-section">
        <h2 className="bw-h2">{S.logTitle}</h2>
        <p className="bw-muted">{S.logLead}</p>
        <Loading q={log} />
        {log.data && log.data.length === 0 && <p className="a-empty">{S.noLog}</p>}
        {log.data && log.data.length > 0 && (
          <ul className="a-list">
            {log.data.map((l) => {
              const x = outcomeText(l);
              return (
                <li key={String(l.id)}>
                  <span className="a-list__main">
                    <b>{fmtTime(l.at)} · {S.kinds[l.kind] ?? l.kind}{l.orgName ? ` · ${l.orgName}` : ""}</b>
                    <span className="bw-muted">#{String(l.jobId)} · {S.attempts(Number(l.attempt))} · {S.addresses(Number(l.recipients))} · {l.lang}{l.cycles > 0n ? ` · ${fmtCycles(l.cycles)} cycles` : ""}</span>
                  </span>
                  <span className={`a-tag ${x.tone}`}>{x.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="a-section">
        <h2 className="bw-h2">{S.orgs}</h2>
        <p className="bw-muted">{S.orgsLead}</p>
        <ul className="a-list">
          {withMail.map((o) => {
            const out = s?.optedOut.some((x) => x === o.org.id) ?? false;
            const mail = o.contact?.email ?? o.persons.find((p) => p.email)?.email;
            const lang = s?.langs.find(([id]) => id === o.org.id)?.[1] ?? "";
            return (
              <li key={String(o.org.id)}>
                <span className="a-list__main"><b>{o.org.name}</b><span className="bw-muted">{mail ?? S.noMail}</span></span>
                <select className="bw-input" style={{ maxWidth: 150 }} aria-label={S.lang} value={lang} disabled={!mail} onChange={(e) => setLang.mutate([o.org.id, e.target.value])}>
                  <option value="">{S.langAuto}</option>
                  {Object.entries(S.langs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <label className="a-check"><input type="checkbox" checked={!out} disabled={!mail} onChange={(e) => optOut.mutate([o.org.id, e.target.checked])} /> {S.gets}</label>
              </li>
            );
          })}
        </ul>
      </section>

      {s && <Robots />}

      {preview && <PreviewSheet onClose={() => setPreview(false)} orgs={withMail.map((o) => ({ id: o.org.id, name: o.org.name }))} />}
      <Confirm open={confirmAll} title={S.queueAllTitle} text={S.queueAllText(fmtDayNum(nextMonday()), !!s?.testMode)} confirmLabel={S.queueAll} busy={qAll.isPending} onConfirm={() => qAll.mutate()} onClose={() => setConfirmAll(false)} />
      <Confirm open={confirmOff} title={S.testOffTitle} text={S.testOffText} confirmLabel={S.testOffConfirm} busy={saveTest.isPending} onConfirm={() => saveTest.mutate()} onClose={() => setConfirmOff(false)} />
    </Page>
  );
}

function PreviewSheet({ onClose, orgs }: { onClose: () => void; orgs: { id: bigint; name: string }[] }) {
  const { actor } = useBackend();
  const [kind, setKind] = useState("weekplanning");
  const [org, setOrg] = useState(orgs[0] ? String(orgs[0].id) : "");
  const [monday, setMonday] = useState(dayToInput(nextMonday()));
  const q = useMutation({ mutationFn: async (): Promise<MailPreview> => {
    const d = inputToDay(monday) ?? nextMonday();
    const m = d - BigInt((Number(d) + 3) % 7);
    return unwrap(await actor!.mailPreview(kind, kind === "proef" ? null : BigInt(org), m));
  } });
  const p = q.data;
  return (
    <Sheet title={S.preview} open onClose={onClose} side wide>
      <Field label={S.kind}><select className="bw-input" value={kind} onChange={(e) => setKind(e.target.value)}>{["weekplanning", "herinnering-planning", "herinnering-uren", "proef"].map((k) => <option key={k} value={k}>{S.kinds[k]}</option>)}</select></Field>
      {kind !== "proef" && <Field label={S.org}><select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select></Field>}
      {kind === "weekplanning" && <Field label={S.weekOf}><input className="bw-input" type="date" value={monday} onChange={(e) => setMonday(e.target.value)} /></Field>}
      <div><Button variant="primary" busy={q.isPending} onClick={() => q.mutate()}>{S.show}</Button></div>
      {q.error && <p className="a-err">{errText(q.error)}</p>}
      {p && (
        <div className="p-mail">
          <p className="bw-muted">{S.to}: {p.mail.to.map((x) => x.email).join(", ")} · {S.langs[p.lang] ?? p.lang}</p>
          <p className="bw-muted"><Icon name="alert" size={14} /> {p.deliver}</p>
          <p><b>{p.mail.subject}</b></p>
          {/* De mail precies zoals ze vertrekt; sandbox zonder scripts, enkel opmaak. */}
          <iframe className="p-mail__frame" title={S.preview} sandbox="" srcDoc={p.html} />
        </div>
      )}
    </Sheet>
  );
}

const KINDS = ["proef", "inhoudingsplicht"];

function Robots() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const robots = useQuery({ queryKey: ["robots"], queryFn: () => actor!.listRobots(), enabled: !!actor && !isFetching });
  const [rp, setRp] = useState("");
  const [rn, setRn] = useState("Gateway");
  const [kinds, setKinds] = useState<string[]>(["proef"]);
  const [revoking, setRevoking] = useState<Principal | null>(null);
  const ok = () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const add = useMutation({ mutationFn: async () => unwrap(await actor!.addRobot(Principal.fromText(rp.trim()), rn, kinds)), onSuccess: () => { setRp(""); ok(); }, onError: fail });
  const revoke = useMutation({ mutationFn: async (p: Principal) => unwrap(await actor!.revokeRobot(p)), onSuccess: () => { setRevoking(null); ok(); }, onError: fail });
  return (
    <section className="a-section" style={{ maxWidth: 720 }}>
      <h2 className="bw-h2">{t.settings.robots}</h2>
      <p className="bw-muted">{S.robotsLead}</p>
      <Loading q={robots} />
      <ul className="a-list">
        {(robots.data ?? []).map((r) => (
          <li key={r.principal.toText()}>
            <span className="a-list__main"><b>{r.name} · {r.kinds.map((k) => S.robotKinds[k] ?? k).join(", ")}</b><span className="a-mono">{r.principal.toText()}</span><span className="bw-muted">{fmtTime(r.addedAt)}{r.revokedAt !== undefined ? ` · ${S.revokedAt} ${fmtTime(r.revokedAt)}` : ""}</span></span>
            {r.revokedAt === undefined && <Button variant="quiet" onClick={() => setRevoking(r.principal)}>{t.settings.revoke}</Button>}
          </li>
        ))}
      </ul>
      <div className="a-grid2">
        <Field label={t.settings.principal}><input className="bw-input bw-mono" value={rp} onChange={(e) => setRp(e.target.value)} /></Field>
        <Field label={t.team.name}><input className="bw-input" value={rn} onChange={(e) => setRn(e.target.value)} /></Field>
      </div>
      <div className="a-row">{KINDS.map((k) => <label key={k} className="a-check"><input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((xs) => (e.target.checked ? [...xs, k] : xs.filter((x) => x !== k)))} /> {S.robotKinds[k]}</label>)}</div>
      <div><Button icon="plus" disabled={!rp || !rn || kinds.length === 0} busy={add.isPending} onClick={() => add.mutate()}>{t.settings.addRobot}</Button></div>
      <Confirm open={revoking !== null} title={S.revokeTitle} text={S.revokeText} confirmLabel={t.settings.revoke} busy={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking)} onClose={() => setRevoking(null)} />
    </section>
  );
}
