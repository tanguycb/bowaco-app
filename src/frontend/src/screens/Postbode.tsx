// Postbode (stap 1b.3): de beheerder zet de weekmail en de herinneringen aan, bekijkt een mail vooraf (zonder te
// versturen), zet een proefmail klaar, volgt de wachtrij (open, mislukt, klaar) en beheert de robots (de gateway).
// De mails zelf verstuurt de gateway (docs/postbode-installatie.md); de app verstuurt nooit zelf.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import type { JobView, MailOut } from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtTime, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const S = t.postbode;
const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
/** Laatste lease van een robot (de meest recente), als tijd. */
function lastSeen(xs: (bigint | undefined)[]): string {
  const v = xs.filter((x): x is bigint => x !== undefined).sort((a, b) => (a < b ? 1 : -1))[0];
  return v === undefined ? "–" : fmtTime(v);
}
const nextMonday = () => { const d = todayDay(); const wd = (Number(d) + 3) % 7; return d + BigInt(7 - wd); };

function stateText(j: JobView): { text: string; tone: string } {
  const s = j.state;
  switch (s.__kind__) {
    case "queued": return { text: S.states.queued, tone: "a-tag--accent" };
    case "leased": return { text: S.states.leased, tone: "a-tag--accent" };
    case "done": return { text: s.done.result.startsWith("overgeslagen") ? s.done.result : S.states.done, tone: s.done.result.startsWith("overgeslagen") ? "" : "a-tag--ok" };
    case "failed": return { text: `${S.states.failed}: ${s.failed.why}`, tone: "a-tag--bad" };
    case "cancelled": return { text: S.states.cancelled, tone: "" };
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
  const oas = useQuery({ queryKey: ["oas-post"], queryFn: () => actor!.listOas({ text: undefined, trade: undefined, kind: undefined, includeArchived: false }), enabled: on });
  const [weekmail, setWeekmail] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [day, setDay] = useState(4);
  const [hour, setHour] = useState("14");
  const [rDay, setRDay] = useState(2);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!st.data) return;
    setWeekmail(st.data.weekmail); setReminders(st.data.reminders); setDay(Number(st.data.day)); setHour(String(st.data.hour)); setRDay(Number(st.data.reminderDay)); setUrl(st.data.appUrl);
  }, [st.data]);
  const done = (text: string = t.common.saved) => { toast.show({ kind: "ok", text }); void qc.invalidateQueries({ queryKey: ["postSettings"] }); void qc.invalidateQueries({ queryKey: ["jobs"] }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({ mutationFn: async () => unwrap(await actor!.setPostSettings({ weekmail, reminders, day: BigInt(day), hour: BigInt(hour || "0"), reminderDay: BigInt(rDay), appUrl: url.trim() })), onSuccess: () => done(), onError: fail });
  const [testTo, setTestTo] = useState("");
  const test = useMutation({ mutationFn: async () => unwrap(await actor!.queueTestMail(testTo.trim())), onSuccess: () => { setTestTo(""); done(S.testQueued); }, onError: fail });
  const [preview, setPreview] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const qAll = useMutation({ mutationFn: async () => unwrap(await actor!.queueWeekMails(nextMonday(), null)), onSuccess: (n) => { setConfirmAll(false); done(S.queued(Number(n))); }, onError: fail });
  const cancel = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.cancelJob(id)), onSuccess: () => done(), onError: fail });
  const retry = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.retryJob(id)), onSuccess: () => done(), onError: fail });
  const optOut = useMutation({ mutationFn: async ([id, v]: [bigint, boolean]) => unwrap(await actor!.setOrgMail(id, v)), onSuccess: () => done(), onError: fail });
  const s = st.data;
  const withMail = (oas.data ?? []).filter((o) => o.org.kind === "subcontractor");
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
            <div className="a-counter"><span className="a-counter__n a-counter__n--small">{lastSeen(s.robots.map((r) => r.lastSeen))}</span><span className="a-counter__l">{S.lastSeen}</span></div>
          </div>
          {s.robots.length === 0 && <p className="a-note"><Icon name="alert" size={16} /> {S.noRobot}</p>}

          <section className="a-section" style={{ maxWidth: 640 }}>
            <h2 className="bw-h2">{S.settings}</h2>
            <Field label={S.appUrl}><input className="bw-input" value={url} placeholder="https://app.bowaco.eu" onChange={(e) => setUrl(e.target.value)} /></Field>
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
              <Field label={S.testTo}><input className="bw-input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
              <Button busy={test.isPending} disabled={!testTo.includes("@")} onClick={() => test.mutate()}>{S.testSend}</Button>
            </div>
            <p className="bw-muted">{S.testHelp}</p>
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
                  {(j.state.__kind__ === "queued" || j.state.__kind__ === "leased") && <Button variant="quiet" onClick={() => cancel.mutate(j.id)}>{S.cancel}</Button>}
                  {j.state.__kind__ === "failed" && <Button variant="quiet" onClick={() => retry.mutate(j.id)}>{S.retry}</Button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {s && <Robots />}

      <section className="a-section">
        <h2 className="bw-h2">{S.orgs}</h2>
        <p className="bw-muted">{S.orgsLead}</p>
        <ul className="a-list">
          {withMail.map((o) => {
            const out = s?.optedOut.some((x) => x === o.org.id) ?? false;
            const mail = o.contact?.email ?? o.persons.find((p) => p.email)?.email;
            return (
              <li key={String(o.org.id)}>
                <span className="a-list__main"><b>{o.org.name}</b><span className="bw-muted">{mail ?? S.noMail}</span></span>
                <label className="a-check"><input type="checkbox" checked={!out} disabled={!mail} onChange={(e) => optOut.mutate([o.org.id, e.target.checked])} /> {S.gets}</label>
              </li>
            );
          })}
        </ul>
      </section>
      {preview && <PreviewSheet onClose={() => setPreview(false)} orgs={withMail.map((o) => ({ id: o.org.id, name: o.org.name }))} />}
      <Confirm open={confirmAll} title={S.queueAllTitle} text={S.queueAllText(fmtDayNum(nextMonday()))} confirmLabel={S.queueAll} busy={qAll.isPending} onConfirm={() => qAll.mutate()} onClose={() => setConfirmAll(false)} />
    </Page>
  );
}

function PreviewSheet({ onClose, orgs }: { onClose: () => void; orgs: { id: bigint; name: string }[] }) {
  const { actor } = useBackend();
  const [kind, setKind] = useState("weekplanning");
  const [org, setOrg] = useState(orgs[0] ? String(orgs[0].id) : "");
  const [monday, setMonday] = useState(dayToInput(nextMonday()));
  const q = useMutation({ mutationFn: async (): Promise<MailOut> => {
    const d = inputToDay(monday) ?? nextMonday();
    const m = d - BigInt((Number(d) + 3) % 7);
    return unwrap(await actor!.previewMail(kind, kind === "proef" ? null : BigInt(org), m));
  } });
  const m = q.data;
  return (
    <Sheet title={S.preview} open onClose={onClose} side wide>
      <Field label={S.kind}><select className="bw-input" value={kind} onChange={(e) => setKind(e.target.value)}>{["weekplanning", "herinnering-planning", "herinnering-uren", "proef"].map((k) => <option key={k} value={k}>{S.kinds[k]}</option>)}</select></Field>
      {kind !== "proef" && <Field label={S.org}><select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)}>{orgs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select></Field>}
      {kind === "weekplanning" && <Field label={S.weekOf}><input className="bw-input" type="date" value={monday} onChange={(e) => setMonday(e.target.value)} /></Field>}
      <div><Button variant="primary" busy={q.isPending} onClick={() => q.mutate()}>{S.show}</Button></div>
      {q.error && <p className="a-err">{errText(q.error)}</p>}
      {m && (
        <div className="p-mail">
          <p className="bw-muted">{S.to}: {m.to.map((x) => x.email).join(", ")}</p>
          <p><b>{m.subject}</b></p>
          <h3 className="bw-h2">{m.heading}</h3>
          <p>{m.intro}</p>
          {m.sections.map((x, i) => (
            <div key={i} className="p-mail__sec">
              <b>{x.title}</b>
              {x.subtitle && <div className="bw-muted">{x.subtitle}</div>}
              <ul>{x.lines.map((l, k) => <li key={k}>{l}</li>)}</ul>
            </div>
          ))}
          <p>{m.outro}</p>
          {m.link && <p className="bw-muted">{S.button}: {m.link}</p>}
        </div>
      )}
    </Sheet>
  );
}

const KINDS = ["mail", "proef", "inhoudingsplicht"];

function Robots() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const robots = useQuery({ queryKey: ["robots"], queryFn: () => actor!.listRobots(), enabled: !!actor && !isFetching });
  const [rp, setRp] = useState("");
  const [rn, setRn] = useState("Postbode");
  const [kinds, setKinds] = useState<string[]>(["mail"]);
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
            <span className="a-list__main"><b>{r.name} · {r.kinds.join(", ")}</b><span className="a-mono">{r.principal.toText()}</span><span className="bw-muted">{fmtTime(r.addedAt)}{r.revokedAt !== undefined ? ` · ${S.revokedAt} ${fmtTime(r.revokedAt)}` : ""}</span></span>
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
