// Instellingen (R17): werfleider ziet alles, geldigheid van codes, drempels en documentsoorten (1.1),
// bedrijfskalender en planningsjablonen (1.3) en de robots (R28).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import type { DocKindView, ImportBatch, RollbackReport, TradeView } from "../backend";
import { Button, Choice, Confirm, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, fmtTime, parseEuro, unwrap, useBackend } from "../util";
import { Loading, Page } from "./common";
import { Field } from "./Werven";
import { CompanyCalendar, Templates } from "./PlanSettings";

export function Instellingen() {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => actor!.getSettings(), enabled: on });
  const [all, setAll] = useState(true);
  const [days, setDays] = useState("7");
  const [t30, setT30] = useState("");
  const [tCi, setTCi] = useState("");
  useEffect(() => {
    if (settings.data) {
      setAll(settings.data.werfleiderZietAlles);
      setDays(String(settings.data.inviteDays));
      setT30(fmtEuro(settings.data.threshold30bisCents).replace(/[€\s]/g, "").replace(/,00$/, ""));
      setTCi(fmtEuro(settings.data.thresholdCheckinatworkCents).replace(/[€\s]/g, "").replace(/,00$/, ""));
    }
  }, [settings.data]);
  const ok = () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries(); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const save = useMutation({
    mutationFn: async () => {
      const a = parseEuro(t30);
      const b = parseEuro(tCi);
      if (!a || !b) throw new Error(t.settings.thresholds + ": ongeldig bedrag");
      return unwrap(await actor!.setSettings({ werfleiderZietAlles: all, inviteDays: BigInt(days || "0"), threshold30bisCents: a, thresholdCheckinatworkCents: b }));
    },
    onSuccess: ok,
    onError: fail,
  });
  return (
    <Page title={t.settings.title}>
      <Loading q={settings} />
      {settings.data && (
        <section className="a-form" style={{ maxWidth: 560 }}>
          <Field label={t.settings.wlAll}>
            <Choice label={t.settings.wlAll} value={all ? "ja" : "nee"} onChange={(v) => setAll(v === "ja")} options={[{ value: "ja", label: t.common.yes }, { value: "nee", label: t.common.no }]} />
          </Field>
          <p className="bw-muted">{t.settings.wlAllHelp}</p>
          <Field label={t.settings.inviteDays}><input className="bw-input bw-num" style={{ maxWidth: 120 }} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /></Field>
          <span className="bw-label">{t.settings.thresholds}</span>
          <div className="a-grid2">
            <Field label={t.settings.t30bis}><input className="bw-input bw-num" value={t30} onChange={(e) => setT30(e.target.value)} inputMode="decimal" /></Field>
            <Field label={t.settings.tCiaw}><input className="bw-input bw-num" value={tCi} onChange={(e) => setTCi(e.target.value)} inputMode="decimal" /></Field>
          </div>
          <div><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></div>
        </section>
      )}
      <CompanyCalendar />
      <Templates />
      <DocKinds />
      <Trades />
      <ImportBatches />
      <Vehicles />
      <section className="a-section" style={{ maxWidth: 720 }}>
        <h2 className="bw-h2">{t.settings.robots}</h2>
        <p className="bw-muted">{t.settings.robotsMoved} <a className="wb-link" href="#/postbode">{t.nav.postbode}</a></p>
      </section>
    </Page>
  );
}

const RULES = ["altijd", "btw6", "30bis", "checkinatwork", "vc", "oplevering", "optioneel"];
const DELIVERERS = ["bowaco", "klant", "architect", "veiligheidscoordinator", "onderaannemer"];

/** Documentsoorten en wanneer ze verplicht zijn (A5, voorlopig): de admin past de lijst aan. */
function DocKinds() {
  const { actor, isFetching } = useBackend();
  const kinds = useQuery({ queryKey: ["docKinds", true], queryFn: () => actor!.listDocKinds(true), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<DocKindView | null>(null);
  const fresh: DocKindView = { key: "", name: "", rule: "optioneel", deliverer: "bowaco", oaVisible: false, confidential: false, order: BigInt(((kinds.data?.length ?? 0) + 1) * 10), archived: false };
  return (
    <section className="a-section" style={{ maxWidth: 860 }}>
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.settings.docKinds}</h2>
        <Button icon="plus" onClick={() => setEdit(fresh)}>{t.settings.newKind}</Button>
      </div>
      <p className="bw-muted">{t.settings.docKindsLead}</p>
      <Loading q={kinds} />
      {kinds.data && (
        <ul className="a-list">
          {kinds.data.map((k) => (
            <li key={k.key}>
              <span className="a-list__main">
                <b>{k.name}</b>
                <span className="a-row">
                  <span className="a-tag">{t.docs.rules[k.rule] ?? k.rule}</span>
                  <span className="a-tag">{t.docs.deliverer[k.deliverer] ?? k.deliverer}</span>
                  {k.oaVisible && <span className="a-tag">{t.settings.kindOa}</span>}
                  {k.confidential && <span className="a-tag a-tag--warn">{t.werven.confidential}</span>}
                  {k.archived && <span className="a-tag a-tag--bad">{t.settings.kindArchived}</span>}
                </span>
              </span>
              <Button variant="quiet" onClick={() => setEdit(k)}>{t.team.edit}</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <EditKind k={edit} isNew={edit.key === ""} onClose={() => setEdit(null)} />}
    </section>
  );
}

function EditKind({ k, isNew, onClose }: { k: DocKindView; isNew: boolean; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [f, setF] = useState(k);
  const save = useMutation({
    mutationFn: async (x: DocKindView) => unwrap(await actor!.setDocKind(x)),
    onSuccess: () => { void qc.invalidateQueries(); onClose(); },
  });
  return (
    <Sheet title={isNew ? t.settings.newKind : t.settings.editKind} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(f)}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={t.settings.kindName}><input className="bw-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: isNew ? e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : f.key })} /></Field>
        <Field label={t.settings.kindKey}><input className="bw-input bw-mono" value={f.key} disabled={!isNew} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
        <Field label={t.settings.kindRule}>
          <select className="bw-input" value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })}>
            {RULES.map((r) => <option key={r} value={r}>{t.docs.rules[r]}</option>)}
          </select>
        </Field>
        <Field label={t.settings.kindDeliverer}>
          <select className="bw-input" value={f.deliverer} onChange={(e) => setF({ ...f, deliverer: e.target.value })}>
            {DELIVERERS.map((r) => <option key={r} value={r}>{t.docs.deliverer[r]}</option>)}
          </select>
        </Field>
        <label className="a-check"><input type="checkbox" checked={f.oaVisible} onChange={(e) => setF({ ...f, oaVisible: e.target.checked })} />{t.settings.kindOa}</label>
        <label className="a-check"><input type="checkbox" checked={f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} />{t.settings.kindConf}</label>
        {!isNew && <div><Button variant="quiet" busy={save.isPending} onClick={() => save.mutate({ ...f, archived: !f.archived })}>{f.archived ? t.settings.restoreKind : t.settings.archiveKind}</Button></div>}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

/** Vakgebieden van de onderaannemers (1.2, D9): de admin past de keuzelijst aan. */
function Trades() {
  const { actor, isFetching } = useBackend();
  const list = useQuery({ queryKey: ["trades", true], queryFn: () => actor!.listTrades(true), enabled: !!actor && !isFetching });
  const [edit, setEdit] = useState<TradeView | null>(null);
  const fresh: TradeView = { key: "", name: "", order: BigInt(((list.data?.length ?? 0) + 1) * 10), archived: false };
  return (
    <section className="a-section" style={{ maxWidth: 860 }}>
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{t.oa.tradesTitle}</h2>
        <Button icon="plus" onClick={() => setEdit(fresh)}>{t.oa.newTrade}</Button>
      </div>
      <p className="bw-muted">{t.oa.tradesLead}</p>
      <Loading q={list} />
      {list.data && (
        <ul className="a-list">
          {list.data.map((x) => (
            <li key={x.key}>
              <span className="a-list__main"><b>{x.name}</b><span className="a-row"><span className="a-tag">{x.key}</span>{x.archived && <span className="a-tag a-tag--bad">{t.oa.tradeArchived}</span>}</span></span>
              <Button variant="quiet" onClick={() => setEdit(x)}>{t.team.edit}</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <EditTrade x={edit} isNew={edit.key === ""} onClose={() => setEdit(null)} />}
    </section>
  );
}

function EditTrade({ x, isNew, onClose }: { x: TradeView; isNew: boolean; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [f, setF] = useState(x);
  const save = useMutation({
    mutationFn: async (v: TradeView) => unwrap(await actor!.setTrade(v)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["trades"] }); onClose(); },
  });
  return (
    <Sheet title={isNew ? t.oa.newTrade : t.oa.editTrade} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(f)}>{t.common.save}</Button></>}>
      <div className="a-form">
        <Field label={t.oa.tradeName}><input className="bw-input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value, key: isNew ? e.target.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : f.key })} /></Field>
        <Field label={t.oa.tradeKey}><input className="bw-input bw-mono" value={f.key} disabled={!isNew} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
        {!isNew && <div><Button variant="quiet" busy={save.isPending} onClick={() => save.mutate({ ...f, archived: !f.archived })}>{f.archived ? t.oa.restoreTrade : t.oa.archiveTrade}</Button></div>}
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

/** Importbatches van de planning (1.5): alleen de admin ziet dit; terugdraaien = alles van de batch archiveren. */
function ImportBatches() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["importBatches"], queryFn: () => actor!.listImportBatches(), enabled: !!actor && !isFetching, retry: false });
  const [target, setTarget] = useState<ImportBatch | null>(null);
  const [preview, setPreview] = useState<RollbackReport | null>(null);
  const open = useMutation({
    mutationFn: async (b: ImportBatch) => unwrap(await actor!.rollbackImport(b.id, true)),
    onSuccess: (r, b) => { setPreview(r); setTarget(b); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const run = useMutation({
    mutationFn: async () => unwrap(await actor!.rollbackImport(target!.id, false)),
    onSuccess: () => { toast.show({ kind: "ok", text: t.imp.done }); setTarget(null); setPreview(null); void qc.invalidateQueries(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (list.isError || !list.data) return null;
  return (
    <section className="a-section" style={{ maxWidth: 860 }}>
      <h2 className="bw-h2">{t.imp.title}</h2>
      <p className="bw-muted">{t.imp.lead}</p>
      {list.data.length === 0 && <p className="a-empty">{t.imp.none}</p>}
      {list.data.length > 0 && (
        <ul className="a-list">
          {list.data.map((b) => (
            <li key={b.id}>
              <span className="a-list__main">
                <b>{b.title}</b>
                <span className="a-row">
                  <span className="a-tag bw-mono">{b.id}</span>
                  <span className="a-tag">{t.imp.counts(Number(b.works), Number(b.tasks), Number(b.assignments), Number(b.appointments))}</span>
                  {b.rolledBackAt !== undefined && <span className="a-tag a-tag--bad">{t.imp.rolledBack}</span>}
                </span>
                <span className="bw-muted">{fmtTime(b.at)}</span>
              </span>
              {b.rolledBackAt === undefined && <Button variant="quiet" busy={open.isPending} onClick={() => open.mutate(b)}>{t.imp.rollback}</Button>}
            </li>
          ))}
        </ul>
      )}
      <Confirm
        open={!!target && !!preview}
        title={t.imp.rollbackTitle}
        text={preview ? t.imp.rollbackText(preview.works === 0n ? 0 : Number(preview.works), Number(preview.tasks), Number(preview.assignments), Number(preview.appointments), preview.keptWorks) : ""}
        confirmLabel={t.imp.rollback}
        busy={run.isPending}
        onConfirm={() => run.mutate()}
        onClose={() => { setTarget(null); setPreview(null); }}
      />
    </section>
  );
}

/** Voertuigen voor de rit in het werfverslag (1.6): nummerplaat en naam; archiveren in plaats van wissen. */
function Vehicles() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["vehicles"], queryFn: () => actor!.listVehicles(true), enabled: !!actor && !isFetching });
  const [plate, setPlate] = useState("");
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: async (v: { id?: bigint; plate: string; name: string; archived: boolean }) => unwrap(await actor!.saveVehicle(v)),
    onSuccess: () => { setPlate(""); setName(""); toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["vehicles"] }); void qc.invalidateQueries({ queryKey: ["myDay"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section" style={{ maxWidth: 720 }}>
      <h2 className="bw-h2">{t.vehicles.title}</h2>
      <p className="bw-muted">{t.vehicles.lead}</p>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="a-empty">{t.vehicles.none}</p>}
      {q.data && q.data.length > 0 && (
        <ul className="a-list">
          {q.data.map((v) => (
            <li key={String(v.id)}>
              <span className="a-tag">{v.plate}</span>
              <span className="a-list__main"><span>{v.name || "—"}</span>{v.archived && <span className="a-tag a-tag--bad">{t.common.archived}</span>}</span>
              <Button variant="quiet" busy={save.isPending && save.variables?.id === v.id} onClick={() => save.mutate({ id: v.id, plate: v.plate, name: v.name, archived: !v.archived })}>{v.archived ? t.vehicles.restore : t.vehicles.archive}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="a-grid2">
        <Field label={t.vehicles.plate}><input id="veh-plate" className="bw-input bw-mono" value={plate} maxLength={20} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></Field>
        <Field label={t.vehicles.name}><input id="veh-name" className="bw-input" value={name} maxLength={60} placeholder={t.vehicles.namePh} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <div><Button icon="plus" disabled={!plate.trim()} busy={save.isPending && save.variables?.id === undefined} onClick={() => save.mutate({ plate, name, archived: false })}>{t.vehicles.add}</Button></div>
    </section>
  );
}
