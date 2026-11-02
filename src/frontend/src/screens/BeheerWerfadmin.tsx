// Beheer → Opmeting & facturatie (stap 2c.8): de werfcode P.nnn, de premietarieven per soort, de jaarpolis en de bibliotheek van
// technische fiches. Geen nieuw menu-item; staat naast het blok Aankoopfacturen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Choice, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, parseEuro, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { InsuranceBlock, uploadPlain } from "./Werfbeheer";
import { Field } from "./Werven";

const T = t.siteAdmin.settings;
const S = t.siteAdmin.sheets;

function SettingsBlock() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const cur = useQuery({ queryKey: ["siteAdminSettings"], queryFn: () => actor!.siteAdminSettings(), enabled: !!actor && !isFetching });
  const [codeP, setCodeP] = useState(false);
  const [rows, setRows] = useState<{ slot: string; rate: string; min: string }[]>([]);
  useEffect(() => {
    if (cur.data) {
      setCodeP(cur.data.codeP);
      setRows(cur.data.rates.map(([slot, rate, min]) => ({ slot, rate: (Number(rate) / 1000).toString().replace(".", ","), min: fmtEuro(min) })));
    }
  }, [cur.data]);
  const parsed = rows.map((r) => ({ slot: r.slot, rate: /^\d+([.,]\d{1,3})?$/.test(r.rate.trim()) ? BigInt(Math.round(Number(r.rate.replace(",", ".")) * 1000)) : null, min: parseEuro(r.min) }));
  const valid = parsed.every((r) => r.rate !== null && r.min !== null && r.min !== undefined);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveSiteAdminSettings({ codeP, rates: parsed.map((r) => [r.slot, r.rate ?? 0n, r.min ?? 0n] as [string, bigint, bigint]) })),
    onSuccess: () => { toast.show({ kind: "ok", text: T.saved }); void qc.invalidateQueries({ queryKey: ["siteAdminSettings"] }); void qc.invalidateQueries({ queryKey: ["nextWorkCode"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section a-form" style={{ maxWidth: 560 }} data-testid="siteadmin-settings">
      <h2 className="bw-h2">{T.title}</h2>
      <Loading q={cur} />
      {cur.data && (
        <>
          <Field label={T.codeP}><Choice label={T.codeP} value={codeP ? "ja" : "nee"} onChange={(v) => setCodeP(v === "ja")} options={[{ value: "ja", label: t.common.yes }, { value: "nee", label: t.common.no }]} /></Field>
          <p className="bw-muted">{T.codePHelp} {codeP ? T.next(cur.data.nextCode) : ""}</p>
          <h3 className="bw-h3">{T.rates}</h3>
          {rows.map((r, i) => (
            <div key={r.slot} className="a-grid3" style={{ alignItems: "end" }}>
              <b>{t.siteAdmin.insurance.kinds[r.slot as "rc10" | "ba10" | "abr"]}</b>
              <Field label={T.rate}><input className="bw-input bw-mono" value={r.rate} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} /></Field>
              <Field label={T.minimum}><input className="bw-input bw-mono" value={r.min} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} /></Field>
            </div>
          ))}
          <div><Button variant="primary" busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{T.save}</Button></div>
        </>
      )}
    </section>
  );
}

function SheetLibrary() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["techSheets"], queryFn: () => actor!.listTechSheets(false), enabled: !!actor && !isFetching });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const [f, setF] = useState({ material: "", title: "", supplier: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["techSheets"] });
  const add = useMutation({
    mutationFn: async (x: File) => { const fid = await uploadPlain(actor!, x, undefined); return unwrap(await actor!.saveTechSheet({ materialKey: f.material, title: f.title, fileId: fid, supplierOrgId: f.supplier ? BigInt(f.supplier) : undefined })); },
    onSuccess: () => { setF({ material: "", title: "", supplier: "" }); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const arch = useMutation({ mutationFn: async (id: bigint) => unwrap(await actor!.archiveTechSheet(id)), onSuccess: refresh, onError: (e) => toast.show({ kind: "error", text: errText(e) }) });
  const suppliers = (orgs.data ?? []).filter((o) => o.kind === "supplier");
  return (
    <section className="a-section a-form" style={{ maxWidth: 720 }} data-testid="sheet-library">
      <h2 className="bw-h2">{S.library}</h2>
      <Loading q={q} />
      {q.data && q.data.length === 0 && <p className="bw-muted">{S.none}</p>}
      {q.data && q.data.length > 0 && (
        <ul className="a-list">{q.data.map((x) => <li key={String(x.id)} className="a-doc"><span className="a-list__main"><b>{x.materialKey}</b><span className="bw-muted">{x.title}{x.supplierName ? ` · ${x.supplierName}` : ""} · {x.fileName}</span></span><Button variant="quiet" onClick={() => arch.mutate(x.id)}>{S.archive}</Button></li>)}</ul>
      )}
      <div className="a-grid3" style={{ alignItems: "end" }}>
        <Field label={S.material}><input className="bw-input" maxLength={80} value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></Field>
        <Field label={S.sheetTitle}><input className="bw-input" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={S.supplier}><select className="bw-input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">—</option>{suppliers.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}</select></Field>
      </div>
      <label className="bw-field"><span className="bw-label">{S.file}</span><input type="file" accept="application/pdf" disabled={add.isPending || !f.material.trim() || !f.title.trim()} onChange={(e) => { const x = e.target.files?.[0]; if (x) add.mutate(x); e.target.value = ""; }} /></label>
    </section>
  );
}

export function WerfadminBeheer() {
  return (
    <>
      <SettingsBlock />
      <InsuranceBlock title={T.annual} />
      <SheetLibrary />
    </>
  );
}
