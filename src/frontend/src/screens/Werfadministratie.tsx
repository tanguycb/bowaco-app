// Werfadministratie (stap 1b.4, bouwplan §5.4): op de werfpagina de aangifte van werken (30bis: nodig? waarom?
// klaarzetten, bijhouden), Checkinatwork (nodig? export van de aanwezigheden als CSV), de vergunningen (1b.1) en de
// inhoudingsplicht van elke onderaannemer (link naar checkinhoudingsplicht.be met het KBO-nummer + resultaat
// vastleggen). Over alle werven: wat nog te doen is. Indienen doet altijd een mens op het portaal (eID/itsme).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { WithholdingResult, type CiawExport, type DeclarationDraft, type DeclarationView, type OaWithholding, type WorkAdminView, type WorkView } from "../backend";
import { Button, Choice, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";

const A = t.wadm;
const N = Number;

const STATE_TAG: Record<string, string> = { ok: "a-tag--ok", verouderd: "a-tag--warn", inhoudingsplicht: "a-tag--bad", onbekend: "a-tag--warn", nooit: "a-tag--warn", "geen-kbo": "" };

export function OaState({ o }: { o: OaWithholding }) {
  return <span className={`a-tag ${STATE_TAG[o.state] ?? ""}`}>{A.states[o.state] ?? o.state}{o.last ? ` · ${fmtDayNum(o.last.consultedOn)}` : ""}</span>;
}

function declText(d: DeclarationView): string {
  switch (d.status.__kind__) {
    case "todo": return A.declStatus.todo;
    case "done": return `${A.declStatus.done} ${fmtDayNum(d.status.done.on)} · nr. ${d.status.done.number}`;
    case "notNeeded": return `${A.declStatus.notNeeded}: ${d.status.notNeeded.reason}`;
  }
}

const yesNo = (b?: boolean) => (b === undefined ? A.unknown : b ? A.yes : A.no);

// ── Op de werfpagina (interne rollen) ─────────────────────────────────────────
export function WorkAdmin({ w }: { w: WorkView }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["workAdmin", String(w.id)], queryFn: () => actor!.workAdmin(w.id), enabled: !!actor && !isFetching && w.facts !== undefined, refetchOnWindowFocus: true, retry: 0 });
  const [decl, setDecl] = useState(false);
  const [check, setCheck] = useState<OaWithholding | null>(null);
  const [ciaw, setCiaw] = useState(false);
  if (w.facts === undefined || q.error) return null; // externen: geen werfadministratie
  const v = q.data;
  return (
    <section className="a-section">
      <h2 className="bw-h2">{A.title}</h2>
      <Loading q={q} />
      {v && (
        <>
          <ul className="a-list">
            <li className="a-doc">
              <span className="a-list__main">
                <b>{A.art30bis}: {yesNo(v.art30bis)}</b>
                <span className="bw-muted">{v.reason} · {A.oaCount(N(v.oaCount))}{v.declaration.deadline !== undefined && v.art30bis !== false ? ` · ${A.deadline} ${fmtDayNum(v.declaration.deadline)}` : ""}</span>
                <span className="bw-muted">{declText(v.declaration)}{v.declaration.asbestos ? ` · ${A.asbestos}` : ""}</span>
              </span>
              {v.art30bis !== false && v.declaration.status.__kind__ === "todo" && <span className="a-tag a-tag--warn">{A.declStatus.todo}</span>}
              {v.declaration.status.__kind__ === "done" && <span className="a-tag a-tag--ok">{A.declStatus.done}</span>}
              <Button variant="quiet" onClick={() => setDecl(true)}>{A.open}</Button>
            </li>
            <li className="a-doc">
              <span className="a-list__main">
                <b>{A.checkinatwork}: {yesNo(v.checkinatwork)}</b>
                <span className="bw-muted">{A.ciawLead}</span>
              </span>
              {v.canEdit && <Button variant="quiet" onClick={() => setCiaw(true)}>{A.export}</Button>}
            </li>
            <li className="a-doc">
              <span className="a-list__main">
                <b>{A.permits}: {v.permitsGranted}/{v.permitsTotal} {A.granted}</b>
                <span className="bw-muted">{v.permitsAttention > 0 ? A.permitsAttention(N(v.permitsAttention)) : A.permitsOk}</span>
              </span>
              {v.permitsAttention > 0n && <span className="a-tag a-tag--warn">{A.attention}</span>}
            </li>
          </ul>
          <span className="bw-label">{A.withholding}</span>
          <p className="bw-muted">{A.withholdingLead(fmtDayNum(v.dbUpdated))}</p>
          {v.oas.length === 0 && <p className="a-empty">{A.noOas}</p>}
          {v.oas.length > 0 && (
            <ul className="a-list">
              {v.oas.map((o) => (
                <li key={String(o.orgId)} className="a-doc">
                  <span className="a-list__main"><b>{o.name}</b><span className="bw-muted bw-num">{o.kbo ? `KBO ${o.kbo}` : A.noKbo}{o.last ? ` · ${A.lastCheck} ${fmtDayNum(o.last.consultedOn)} (${o.last.byName})` : ""}</span></span>
                  <OaState o={o} />
                  {o.link && <a className="bw-btn bw-btn--quiet" href={o.link} target="_blank" rel="noreferrer">{A.consult} ↗</a>}
                  {v.canCheck && o.kbo && <Button variant="quiet" onClick={() => setCheck(o)}>{A.record}</Button>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {decl && v && <DeclarationSheet w={w} v={v} onClose={() => setDecl(false)} />}
      {check && <WithholdingSheet o={check} workId={w.id} onClose={() => setCheck(null)} />}
      {ciaw && <CiawSheet w={w} onClose={() => setCiaw(false)} />}
    </section>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function DeclarationSheet({ w, v, onClose }: { w: WorkView; v: WorkAdminView; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const draft = useMutation({ mutationFn: async (): Promise<DeclarationDraft> => unwrap(await actor!.declarationDraft(w.id)) });
  useEffect(() => { draft.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d0 = v.declaration;
  const [state, setState] = useState<string>(d0.status.__kind__);
  const [nature, setNature] = useState(d0.nature);
  const [asb, setAsb] = useState(d0.asbestos);
  const [on, setOn] = useState(dayToInput(d0.status.__kind__ === "done" ? d0.status.done.on : todayDay()));
  const [number, setNumber] = useState(d0.status.__kind__ === "done" ? d0.status.done.number : "");
  const [reason, setReason] = useState(d0.status.__kind__ === "notNeeded" ? d0.status.notNeeded.reason : "");
  const [note, setNote] = useState(d0.note);
  const save = useMutation({
    mutationFn: async () => {
      const status = state === "done" ? { __kind__: "done" as const, done: { on: inputToDay(on) ?? todayDay(), number: number.trim() } } : state === "notNeeded" ? { __kind__: "notNeeded" as const, notNeeded: { reason: reason.trim() } } : { __kind__: "todo" as const, todo: null };
      return unwrap(await actor!.saveDeclaration(w.id, { status, nature, asbestos: asb, note }));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["workAdmin"] }); void qc.invalidateQueries({ queryKey: ["dossier", String(w.id)] }); void qc.invalidateQueries({ queryKey: ["wadm"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const d = draft.data;
  const addr = (a?: { street: string; number: string; zip: string; city: string }) => (a ? `${a.street} ${a.number}, ${a.zip} ${a.city}`.trim() : "–");
  const rows: [string, string][] = d ? [
    [A.d.client, d.client || "–"],
    [A.d.clientAddress, d.clientAddress ? addr(d.clientAddress) : A.d.onlyOffice],
    [A.d.site, addr(d.workAddress)],
    [A.d.nature, d.nature],
    [A.d.period, `${fmtDayNum(d.start)} – ${fmtDayNum(d.end)}`],
    [A.d.amount, d.amountCents !== undefined ? fmtEuro(d.amountCents) : A.d.onlyOffice],
    [A.d.regie, d.regie ? A.yes : A.no],
    [A.d.oas, d.oas.length ? d.oas.map((o) => `${o.name}${o.kbo ? ` (KBO ${o.kbo})` : ` (${A.noKbo})`}`).join("; ") : A.noOas],
    [A.d.architect, d.architect || "–"],
    [A.d.vc, d.safetyCoordinator || "–"],
    [A.asbestos, d.asbestos ? A.yes : A.no],
  ] : [];
  return (
    <Sheet title={`${A.art30bis} · ${w.code}`} open onClose={onClose} side wide footer={v.canEdit ? <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button> : undefined}>
      <p className="bw-muted">{A.d.lead}</p>
      {draft.isPending && <p className="bw-muted">{t.common.loading}</p>}
      {draft.error && <p className="a-err">{errText(draft.error)}</p>}
      {d && (
        <>
          <p><b>{A.art30bis}: {yesNo(v.art30bis)}</b> · {d.reason}{d.deadline !== undefined ? ` · ${A.deadline} ${fmtDayNum(d.deadline)}` : ""}</p>
          <dl className="a-dl">
            {rows.map(([k, val]) => <Fragment key={k}><dt>{k}</dt><dd>{val} <button type="button" className="wb-link" onClick={() => copy(val)} title={A.d.copy}>⧉</button></dd></Fragment>)}
          </dl>
          <a className="bw-btn bw-btn--secondary" href={d.portal} target="_blank" rel="noreferrer"><Icon name="share" size={18} /> {A.d.portal} ↗</a>
        </>
      )}
      {v.canEdit && (
        <>
          <span className="bw-label">{A.d.track}</span>
          <Field label={A.d.status}><Choice label={A.d.status} value={state} onChange={setState} options={[{ value: "todo", label: A.declStatus.todo }, { value: "done", label: A.declStatus.done }, { value: "notNeeded", label: A.declStatus.notNeeded }]} /></Field>
          {state === "done" && (
            <div className="a-row">
              <Field label={A.d.on}><input className="bw-input" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
              <Field label={A.d.number}><input className="bw-input bw-num" value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
            </div>
          )}
          {state === "notNeeded" && <Field label={A.d.reason}><input className="bw-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          <Field label={A.d.nature}><Choice label={A.d.nature} value={nature} onChange={setNature} options={[{ value: "eenmalig", label: A.d.once }, { value: "doorlopend", label: A.d.ongoing }]} /></Field>
          <label className="a-check"><input type="checkbox" checked={asb} onChange={(e) => setAsb(e.target.checked)} /> {A.d.asbestos}</label>
          <Field label={A.d.note}><textarea className="bw-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>
      )}
    </Sheet>
  );
}

const RESULTS: WithholdingResult[] = [WithholdingResult.clear, WithholdingResult.social, WithholdingResult.fiscal, WithholdingResult.both, WithholdingResult.unknown];

function WithholdingSheet({ o, workId, onClose }: { o: OaWithholding; workId?: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const hist = useQuery({ queryKey: ["withholding", String(o.orgId)], queryFn: () => actor!.withholdingHistory(o.orgId), enabled: !!actor && !isFetching });
  const [result, setResult] = useState<WithholdingResult>(WithholdingResult.clear);
  const [on, setOn] = useState(dayToInput(todayDay()));
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.recordWithholdingCheck(o.orgId, { result, consultedOn: inputToDay(on) ?? todayDay(), reference: ref, note, workId })),
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["workAdmin"] }); void qc.invalidateQueries({ queryKey: ["withholding"] }); void qc.invalidateQueries({ queryKey: ["wadm"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={`${A.withholding} · ${o.name}`} open onClose={onClose} side footer={<Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button>}>
      <p className="bw-muted">{A.recordLead}</p>
      {o.link && <a className="bw-btn bw-btn--secondary" href={o.link} target="_blank" rel="noreferrer">{A.consult} (KBO {o.kbo}) ↗</a>}
      <Field label={A.result}>
        <select className="bw-input" value={result} onChange={(e) => setResult(e.target.value as WithholdingResult)}>{RESULTS.map((r) => <option key={r} value={r}>{A.results[r]}</option>)}</select>
      </Field>
      <div className="a-row">
        <Field label={A.consultedOn}><input className="bw-input" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field label={A.reference}><input className="bw-input bw-num" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <Field label={A.note}><input className="bw-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <span className="bw-label">{A.history}</span>
      {hist.data && hist.data.length === 0 && <p className="a-empty">{A.noHistory}</p>}
      <ul className="a-hist">{(hist.data ?? []).map((c) => <li key={String(c.id)}><span className="bw-num">{fmtDayNum(c.consultedOn)}</span> {A.results[c.result]}{c.reference ? ` · ${c.reference}` : ""} · {c.byName}</li>)}</ul>
    </Sheet>
  );
}

function csvCell(s: string): string {
  // Ook tegen formules in een rekenblad (CSV-injectie): een cel die met = + - @ begint, krijgt een apostrof.
  const v = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function CiawSheet({ w, onClose }: { w: WorkView; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const today = todayDay();
  const [from, setFrom] = useState(dayToInput(today - 30n));
  const [to, setTo] = useState(dayToInput(today));
  const ex = useMutation({
    mutationFn: async (): Promise<CiawExport> => unwrap(await actor!.checkinatworkExport(w.id, inputToDay(from) ?? today, inputToDay(to) ?? today)),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const download = (x: CiawExport) => {
    const head = ["datum", "firma", "kbo", "namen", "aantal", "tijdvakken", "minuten", "regie", "werf", "aangifte 30bis"];
    const lines = x.rows.map((r) => [fmtDayNum(r.day), r.orgName, r.kbo, r.names, String(r.headcount), r.slots, String(r.minutes), r.regie ? "ja" : "nee", x.workCode, x.declarationNumber].map(csvCell).join(";"));
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkinatwork-${x.workCode}-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const x = ex.data;
  return (
    <Sheet title={`${A.checkinatwork} · ${w.code}`} open onClose={onClose} side wide footer={<Button variant="primary" busy={ex.isPending} onClick={() => ex.mutate()}>{A.show}</Button>}>
      <p className="bw-muted">{A.ciawWarn}</p>
      <div className="a-row">
        <Field label={A.from}><input className="bw-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={A.to}><input className="bw-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {x && (
        <>
          <p className="bw-muted">{A.ciawCount(x.rows.length)}{x.declarationNumber ? ` · ${A.d.number} ${x.declarationNumber}` : ""} · {A.checkinatwork}: {yesNo(x.required)}</p>
          <Button icon="doc" disabled={x.rows.length === 0} onClick={() => download(x)}>{A.csv}</Button>
          <ul className="a-hist">{x.rows.slice(0, 50).map((r, i) => <li key={i}><span className="bw-num">{fmtDayNum(r.day)}</span> {r.orgName} · {r.names || `${r.headcount} p.`} · {r.slots}{r.regie ? " · regie" : ""}</li>)}</ul>
        </>
      )}
    </Sheet>
  );
}

// ── Over alle werven ───────────────────────────────────────────────────────
export function WadmPage({ go, canRules }: { go: (to: string) => void; canRules: boolean }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["wadm"], queryFn: () => actor!.wadmOverview(), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [check, setCheck] = useState<OaWithholding | null>(null);
  const v = q.data;
  return (
    <Page title={A.title}>
      <p className="bw-muted">{A.pageLead}</p>
      <Loading q={q} />
      {v && (
        <>
          <section className="a-section">
            <h2 className="bw-h2">{A.art30bis}</h2>
            {v.declarations.length === 0 && <p className="a-empty">{A.noDecl}</p>}
            <ul className="a-list">
              {v.declarations.map((d) => (
                <li key={String(d.workId)}>
                  <button type="button" className="a-list__btn" onClick={() => go(`werven/${d.workId}`)}>
                    <span className="a-list__main"><b>{d.workCode} · {d.workName}</b><span className="bw-muted">{d.reason}{d.deadline !== undefined ? ` · ${A.deadline} ${fmtDayNum(d.deadline)}` : ""}</span></span>
                    <span className={`a-tag ${d.status === "te doen" ? "a-tag--warn" : ""}`}>{d.status}</span>
                    <Icon name="next" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="a-section">
            <h2 className="bw-h2">{A.withholding}</h2>
            <p className="bw-muted">{A.withholdingLead(fmtDayNum(v.dbUpdated))}</p>
            {v.oas.length === 0 && <p className="a-empty">{A.allOk}</p>}
            <ul className="a-list">
              {v.oas.map((o) => (
                <li key={String(o.orgId)} className="a-doc">
                  <span className="a-list__main"><b>{o.name}</b><span className="bw-muted bw-num">{o.kbo ? `KBO ${o.kbo}` : A.noKbo}</span></span>
                  <OaState o={o} />
                  {o.link && <a className="bw-btn bw-btn--quiet" href={o.link} target="_blank" rel="noreferrer">{A.consult} ↗</a>}
                  {o.kbo && <Button variant="quiet" onClick={() => setCheck(o)}>{A.record}</Button>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {canRules && <Rules />}
      {check && <WithholdingSheet o={check} onClose={() => setCheck(null)} />}
    </Page>
  );
}

function Rules() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const r = useQuery({ queryKey: ["wadmRules"], queryFn: () => actor!.wadmRules(), enabled: !!actor && !isFetching });
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [n, setN] = useState("");
  const [c, setC] = useState("");
  useEffect(() => {
    if (!r.data) return;
    const e = (x: bigint) => (N(x) / 100).toLocaleString("nl-BE");
    setA(e(r.data.threshold30bisCents)); setB(e(r.data.threshold30bisWithOaCents)); setN(String(r.data.oaCountAlways)); setC(e(r.data.thresholdCheckinatworkCents));
  }, [r.data]);
  const save = useMutation({
    mutationFn: async () => {
      const [x, y, z] = [parseEuro(a), parseEuro(b), parseEuro(c)];
      if (!x || !y || !z) throw new Error(A.rulesBad);
      return unwrap(await actor!.setWadmRules({ threshold30bisCents: x, threshold30bisWithOaCents: y, oaCountAlways: BigInt(n || "0"), thresholdCheckinatworkCents: z }));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section" style={{ maxWidth: 640 }}>
      <h2 className="bw-h2">{A.rules}</h2>
      <p className="bw-muted">{A.rulesLead}</p>
      <div className="a-grid2">
        <Field label={A.r30}><input className="bw-input bw-num" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label={A.r30oa}><input className="bw-input bw-num" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        <Field label={A.rOa}><input className="bw-input bw-num" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label={A.rCiaw}><input className="bw-input bw-num" inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></Field>
      </div>
      <div><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
    </section>
  );
}
