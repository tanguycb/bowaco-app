// Instellingen voor de planning (1.3, R17: enkel de admin): de bedrijfskalender (bouwverlof, feestdagen)
// en de planningsjablonen. Het standaardsjabloon is VOORLOPIG tot 0.3 en de bevestiging van Alexis.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BlockKind, TaskKind, type TemplateStep, type TemplateView } from "../backend";
import { Button, Choice, Provisional, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, inputToDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { Field } from "./Werven";
import { belgianHolidays, fmtShort, today } from "./planUtil";

export function CompanyCalendar() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const blocks = useQuery({ queryKey: ["companyBlocks"], queryFn: () => actor!.listCalendarBlocks(null), enabled: !!actor && !isFetching });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<BlockKind>(BlockKind.bouwverlof);
  const [reason, setReason] = useState("");
  const year = new Date().getFullYear(); // dit jaar én volgend jaar (C3: in oktober ontbraken Allerheiligen … Kerstmis)
  const done = (text: string) => { void qc.invalidateQueries(); toast.show({ kind: "ok", text }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const add = useMutation({
    mutationFn: async () => {
      const f = inputToDay(from);
      const u = inputToDay(to || from);
      if (f === undefined || u === undefined) throw new Error(t.plan.blockFrom);
      return unwrap(await actor!.saveCalendarBlock({ scope: { __kind__: "company", company: null }, kind, from: f, to: u, reason }));
    },
    onSuccess: () => { setFrom(""); setTo(""); setReason(""); done(`${t.common.saved} · ${t.plan.afterBlock}`); },
    onError: fail,
  });
  const holidays = useMutation({
    mutationFn: async (y: number) => {
      const have = new Set((blocks.data ?? []).map((b) => Number(b.from)));
      let n = 0;
      for (const h of belgianHolidays(y)) {
        if (have.has(h.day)) continue;
        unwrap(await actor!.saveCalendarBlock({ scope: { __kind__: "company", company: null }, kind: BlockKind.feestdag, from: BigInt(h.day), to: BigInt(h.day), reason: h.name }));
        n++;
      }
      return n;
    },
    onSuccess: (n) => done(t.plan.holidaysAdded(n)),
    onError: fail,
  });
  const del = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.archiveCalendarBlock(id)), onSuccess: () => done(t.common.saved), onError: fail });
  const list = [...(blocks.data ?? [])].sort((a, b) => Number(a.from) - Number(b.from)).filter((b) => Number(b.to) >= today() - 60);
  return (
    <section className="a-section">
      <h2 className="bw-h2">{t.plan.settingsCal}</h2>
      <p className="bw-muted">{t.plan.settingsCalLead}</p>
      <Loading q={blocks} />
      {list.length > 0 && (
        <ul className="a-list">
          {list.map((b) => (
            <li key={String(b.id)}>
              <span className="a-list__main"><b>{b.reason}</b><span className="bw-num bw-muted">{fmtShort(b.from)}{b.to !== b.from ? ` – ${fmtShort(b.to)}` : ""} {new Date(Number(b.to) * 86_400_000).getUTCFullYear()} · {t.plan.blockKinds[b.kind]}</span></span>
              <Button variant="quiet" icon="close" iconOnly busy={del.isPending && del.variables === b.id} onClick={() => del.mutate(b.id)}>{t.common.close}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="a-row">
        {[year, year + 1].map((y) => <Button key={y} icon="calendar" busy={holidays.isPending && holidays.variables === y} onClick={() => holidays.mutate(y)}>{t.plan.addHolidays(y)}</Button>)}
      </div>
      <div className="a-form a-sub" style={{ maxWidth: 560 }}>
        <Choice label={t.plan.addBlock} value={kind} onChange={setKind} options={[BlockKind.bouwverlof, BlockKind.feestdag, BlockKind.other].map((k) => ({ value: k, label: t.plan.blockKinds[k] }))} />
        <div className="a-grid2">
          <Field label={t.plan.blockFrom}><input className="bw-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t.plan.blockTo}><input className="bw-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label={t.plan.blockReason}><input className="bw-input" value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} placeholder="Zomerbouwverlof 2027" /></Field>
        <div><Button icon="plus" disabled={!from || !reason.trim()} busy={add.isPending} onClick={() => add.mutate()}>{t.plan.addBlock}</Button></div>
      </div>
    </section>
  );
}

export function Templates() {
  const { actor, isFetching } = useBackend();
  const tpls = useQuery({ queryKey: ["templates"], queryFn: () => actor!.listTemplates(), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<TemplateView | "new" | null>(null);
  return (
    <section className="a-section">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.plan.settingsTpl}</h2>
        <Button icon="plus" onClick={() => setEdit("new")}>{t.plan.tplNew}</Button>
      </div>
      <p className="bw-muted">{t.plan.settingsTplLead}</p>
      <Loading q={tpls} />
      {tpls.data && (
        <ul className="a-list">
          {tpls.data.map((x) => (
            <li key={x.key}>
              <button type="button" className="a-list__btn" onClick={() => setEdit(x)}>
                <span className="a-tag">{x.key}</span>
                <span className="a-list__main"><b>{x.name}</b><span className="bw-muted">{x.steps.length} {t.plan.tplSteps.toLowerCase()}{x.stored ? "" : ` · ${t.plan.tplDefault}`}</span></span>
                {x.provisional && <Provisional label={t.plan.provisional} reason={t.uitleg.redenPlanning} infoLabel={t.uitleg.provisionalLabel} />}
                {x.archived && <span className="a-tag a-tag--bad">{t.plan.tplArchived}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <TemplateEditor tpl={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

type Row = { key: string; title: string; trade: string; kind: TaskKind; workdays: string; leadDays: string; after: string; lagDays: string; note: string };

const toRow = (s: TemplateStep): Row => ({ key: s.key, title: s.title, trade: s.trade ?? "", kind: s.kind, workdays: String(s.workdays), leadDays: String(s.leadDays), after: s.after.join(", "), lagDays: String(s.lagDays), note: s.note });

function TemplateEditor({ tpl, onClose }: { tpl: TemplateView | null; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const trades = useQuery({ queryKey: ["trades", false], queryFn: () => actor!.listTrades(false), enabled: !!actor && !isFetching });
  const [key, setKey] = useState(tpl?.key ?? "");
  const [name, setName] = useState(tpl?.name ?? "");
  const [prov, setProv] = useState(tpl?.provisional ?? true);
  const [rows, setRows] = useState<Row[]>(tpl ? tpl.steps.map(toRow) : [{ key: "stap-1", title: "", trade: "", kind: TaskKind.work, workdays: "5", leadDays: "0", after: "", lagDays: "0", note: "" }]);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRow = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  const save = useMutation({
    mutationFn: async (archived: boolean) => unwrap(await actor!.saveTemplate({
      key, name, provisional: prov, archived,
      steps: rows.map((r) => ({
        key: r.key.trim(), title: r.title, trade: r.trade || undefined, kind: r.kind,
        workdays: r.kind === TaskKind.work ? BigInt(Math.max(1, Number(r.workdays) || 1)) : 0n,
        leadDays: r.kind === TaskKind.delivery ? BigInt(Math.max(0, Number(r.leadDays) || 0)) : 0n,
        after: r.after.split(",").map((x) => x.trim()).filter(Boolean),
        lagDays: BigInt(Math.max(0, Number(r.lagDays) || 0)),
        note: r.note,
      })),
    })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["templates"] }); toast.show({ kind: "ok", text: t.common.saved }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet side wide title={tpl ? `${t.plan.tplEdit} · ${tpl.name}` : t.plan.tplNew} open onClose={onClose} footer={<>
      {tpl?.stored && !tpl.archived && <Button variant="danger" busy={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>{t.settings.archiveKind}</Button>}
      <Button onClick={onClose}>{t.common.cancel}</Button>
      <Button variant="primary" busy={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>{t.common.save}</Button>
    </>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={t.plan.tplKey}><input className="bw-input bw-mono" value={key} disabled={!!tpl} onChange={(e) => setKey(e.target.value)} /></Field>
          <Field label={t.plan.tplName}><input className="bw-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <label className="a-check"><input type="checkbox" checked={prov} onChange={(e) => setProv(e.target.checked)} />{t.plan.tplProvisional}</label>
      </div>
      <h3 className="bw-label">{t.plan.tplSteps}</h3>
      <ol className="a-tplsteps">
        {rows.map((r, i) => (
          <li key={i} className="a-tplstep">
            <div className="a-grid3">
              <Field label={t.plan.field.title}><input className="bw-input" value={r.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} /></Field>
              <Field label={t.plan.tplKey}><input className="bw-input bw-mono" value={r.key} maxLength={40} onChange={(e) => set(i, { key: e.target.value.toLowerCase() })} /></Field>
              <Field label={t.plan.field.trade}>
                <select className="bw-input" value={r.trade} onChange={(e) => set(i, { trade: e.target.value })}>
                  <option value="">{t.plan.field.noTrade}</option>
                  {(trades.data ?? []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="a-row">
              <Choice label={t.plan.field.kind} value={r.kind} onChange={(k) => set(i, { kind: k })} options={[TaskKind.work, TaskKind.milestone, TaskKind.delivery].map((k) => ({ value: k, label: t.plan.kinds[k] }))} />
              {r.kind === TaskKind.work && <Field label={t.plan.field.workdays}><input className="bw-input bw-num a-narrow" type="number" min={1} value={r.workdays} onChange={(e) => set(i, { workdays: e.target.value })} /></Field>}
              {r.kind === TaskKind.delivery && <Field label={t.plan.field.lead}><input className="bw-input bw-num a-narrow" type="number" min={0} value={r.leadDays} onChange={(e) => set(i, { leadDays: e.target.value })} /></Field>}
              <Field label={t.plan.tplAfter}><input className="bw-input bw-mono" value={r.after} onChange={(e) => set(i, { after: e.target.value })} /></Field>
              <Field label={t.plan.lag}><input className="bw-input bw-num a-narrow" type="number" min={0} value={r.lagDays} onChange={(e) => set(i, { lagDays: e.target.value })} /></Field>
            </div>
            <div className="a-row">
              <Button variant="quiet" disabled={i === 0} onClick={() => moveRow(i, -1)}>↑</Button>
              <Button variant="quiet" disabled={i === rows.length - 1} onClick={() => moveRow(i, 1)}>↓</Button>
              <Button variant="quiet" icon="close" onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t.plan.tplRemoveStep}</Button>
              {r.note && <span className="bw-muted">{r.note}</span>}
            </div>
          </li>
        ))}
      </ol>
      <div><Button icon="plus" onClick={() => setRows([...rows, { key: `stap-${rows.length + 1}`, title: "", trade: "", kind: TaskKind.work, workdays: "5", leadDays: "0", after: rows.length ? rows[rows.length - 1].key : "", lagDays: "0", note: "" }])}>{t.plan.tplAddStep}</Button></div>
    </Sheet>
  );
}
