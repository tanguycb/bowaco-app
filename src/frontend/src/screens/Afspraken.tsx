// Afspraken met de gekozen OA (stap 2c.4, ontwerp 2c §3.1 en §4.4): in de werf onder "Wie werkt mee" per onderaannemer de
// afspraak (ontstaat bij Werf starten), het contract (ontwerp · te tekenen · getekend) en de attesten (geldig tot). De werfleider
// ziet enkel de stand (listDeals, zonder bedragen); kantoor opent de afspraak (readDeal: update-call met auditregel) met de posten,
// prijzen, tarieven met datum op deze werf (⚖9: de werf houdt haar tarief; een nieuw tarief enkel vanaf een datum), voorschot (max.
// 20 %) en betaling, en maakt het contract (controlecode), downloadt de PDF en laadt het getekende bewijs op (aanhangsel = nieuwe versie).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, OrgKind, type Caps, type OaContractView, type DealStatusView, type WorkView } from "../backend";
import { Button, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, inputToDay, parseEuro, parsePct, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { download } from "./Prijsvragen";
import { Field } from "./Werven";

const A = t.afspraken;

export function StateTag({ state }: { state: string }) {
  const cls = state === "geldig" ? "a-tag--ok" : state === "vervalt" || state === "te-keuren" ? "a-tag--warn" : "a-tag--bad";
  return <span className={`a-tag ${cls}`}>{A.state[state] ?? state}</span>;
}

export function AttestTags({ d }: { d: { attests: { kind: string; name: string; state: string; validUntil?: bigint }[] } }) {
  return (
    <span className="a-row" style={{ flexWrap: "wrap", gap: 4 }}>
      {d.attests.map((a) => <span key={a.kind} title={a.validUntil !== undefined ? `${a.name}: ${A.validUntil.toLowerCase()} ${fmtDayNum(a.validUntil)}` : a.name}><span className="bw-muted">{a.name.split(" ")[0]} </span><StateTag state={a.state} /></span>)}
    </span>
  );
}

/** De PDF van een contractversie, uit wat in de app vastligt (kantoor en de OA voor zijn eigen contract). */
export async function contractDownload(c: OaContractView, firm: string, work: string) {
  const [{ contractPdf }, { loadPdfFonts }] = await Promise.all([import("../pdf/contract.ts"), import("../pdf/fonts.ts")]);
  const fld = Object.fromEntries(c.fields);
  const bytes = await contractPdf({
    title: c.title, version: Number(c.version), provisional: c.provisional, firm: fld.firma ?? firm, work: [fld.werf, fld["werf.adres"]].filter(Boolean).join(" · ") || work, text: c.text,
    posts: c.posts.map((p) => ({ title: p.title, unit: p.unit, qtyMilli: p.qtyMilli, unitCents: p.unitCents ?? null })),
    rates: c.rates.map((r) => ({ name: r.kindName, unit: r.unit, cents: r.cents, from: fmtDayNum(r.validFrom) })),
    total: c.totalCents ?? null, advance: fld.voorschot ?? "", hash: c.hash, madeOn: new Date(Number(c.at / 1_000_000n)).toLocaleDateString("nl-BE"),
    signedOn: c.signedAt !== undefined ? new Date(Number(c.signedAt / 1_000_000n)).toLocaleDateString("nl-BE") : null,
  }, await loadPdfFonts());
  download(bytes, `Overeenkomst ${firm} v${c.version}.pdf`, "application/pdf");
}

/** Wie werkt mee → Afspraken met onderaannemers (werfleider: stand; kantoor: ook openen en met de hand maken). */
export function Afspraken({ w, caps }: { w: WorkView; caps: Caps }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching && caps.readTeam;
  const q = useQuery({ queryKey: ["deals", String(w.id)], queryFn: () => actor!.listDeals(w.id), enabled: on, retry: false });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.deals });
  const [open, setOpen] = useState<DealStatusView | null>(null);
  const [pick, setPick] = useState("");
  const create = useMutation({
    mutationFn: async () => unwrap(await actor!.createDeal(w.id, BigInt(pick))),
    onSuccess: (r) => { setPick(""); void qc.invalidateQueries({ queryKey: ["deals", String(w.id)] }); toast.show({ kind: "ok", text: [A.made, ...r.warnings].join(" ") }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!caps.readTeam || q.error) return null;
  const deals = q.data ?? [];
  const firms = (orgs.data ?? []).filter((o) => o.kind === OrgKind.subcontractor && !deals.some((d) => d.orgId === o.id));
  return (
    <section className="a-section">
      <h2 className="bw-h2">{A.title}</h2>
      <p className="bw-muted">{caps.deals ? A.lead : A.leaderNote}</p>
      <Loading q={q} />
      {q.data && deals.length === 0 && <p className="bw-muted">{A.none}</p>}
      {deals.length > 0 && (
        <div className="a-blist">
          {deals.map((d) => (
            <div key={String(d.id)} className="a-bli" style={{ display: "grid", gap: 6 }}>
              <div className="a-row a-row--between">
                <strong>{d.orgName}</strong>
                {caps.deals && <Button variant="quiet" onClick={() => setOpen(d)}>{A.open}</Button>}
              </div>
              <div className="a-row" style={{ flexWrap: "wrap", gap: 10 }}>
                <span><span className="bw-label">{A.status} </span>{A.posts(Number(d.posts))}{d.startDay !== undefined ? ` · ${A.since(fmtDayNum(d.startDay))}` : ""}</span>
                <span><span className="bw-label">{A.contract} </span><span className={`a-tag ${d.status === "getekend" ? "a-tag--ok" : d.status === "te tekenen" ? "a-tag--warn" : ""}`}>{A.deal[d.status] ?? d.status}</span>{d.contractVersion > 0n ? ` · ${A.version(Number(d.contractVersion))}` : ""}</span>
              </div>
              <div><span className="bw-label">{A.attests} </span><AttestTags d={d} /></div>
            </div>
          ))}
        </div>
      )}
      {caps.deals && firms.length > 0 && (
        <div className="a-row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <select className="bw-input" aria-label={A.pickFirm} value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">{A.pickFirm}…</option>
            {firms.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
          <Button icon="plus" disabled={!pick} busy={create.isPending} onClick={() => create.mutate()}>{A.newDeal}</Button>
        </div>
      )}
      {open && <DealSheet d={open} work={`${w.code}`} onClose={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["deals", String(w.id)] }); }} />}
    </section>
  );
}

/** De afspraak met bedragen (enkel kantoor; readDeal = update-call met auditregel). */
function DealSheet({ d, work, onClose }: { d: DealStatusView; work: string; onClose: () => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["deal", String(d.id)];
  const q = useQuery({ queryKey: key, queryFn: async () => unwrap(await actor!.readDeal(d.id)), enabled: !!actor, retry: false });
  const setup = useQuery({ queryKey: ["dealSetup"], queryFn: () => actor!.dealSetup(), enabled: !!actor });
  const [rate, setRate] = useState({ kind: "regie", unit: "", euro: "", from: dayToInput(todayDay()), fromRateId: undefined as bigint | undefined });
  const [terms, setTerms] = useState<{ adv: string; days: string; eom: boolean } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const done = (text: string) => { void qc.invalidateQueries({ queryKey: key }); toast.show({ kind: "ok", text }); };
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  const rev = () => q.data!.deal.rev;
  const addRate = useMutation({
    mutationFn: async () => {
      const cents = parseEuro(rate.euro);
      const from = inputToDay(rate.from);
      if (!cents || from === undefined) throw new Error(t.common.error);
      return unwrap(await actor!.addDealRate(d.id, { kind: rate.kind, unit: rate.unit, cents, validFrom: from, fromRateId: rate.fromRateId, note: "" }, rev()));
    },
    onSuccess: () => { setRate((r) => ({ ...r, euro: "", fromRateId: undefined })); done(t.common.saved); },
    onError: fail,
  });
  const saveTerms = useMutation({
    mutationFn: async () => {
      const bp = parsePct(terms!.adv);
      if (bp === null || !/^\d+$/.test(terms!.days)) throw new Error(t.common.error);
      return unwrap(await actor!.saveDealTerms(d.id, { advanceBp: bp, paymentDays: BigInt(terms!.days), endOfMonth: terms!.eom }, rev()));
    },
    onSuccess: () => { setTerms(null); done(t.common.saved); },
    onError: fail,
  });
  const make = useMutation({ mutationFn: async () => unwrap(await actor!.makeOaContract(d.id, rev())), onSuccess: () => done(A.madeOk), onError: fail });
  const pdf = useMutation({ mutationFn: async (v: bigint) => contractDownload(unwrap(await actor!.readOaContract(d.id, v)), d.orgName, work), onError: fail });
  const sign = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, file.type || "application/pdf", file.name).withUploadProgress(setProgress);
      const fid = unwrap(await actor!.addDealFile(file.name, file.type || "application/pdf", BigInt(bytes.length), blob, { __kind__: "signed", signed: d.id }));
      return unwrap(await actor!.markOaContractSigned(d.id, q.data!.deal.contractVersion, fid, "", rev()));
    },
    onSuccess: () => done(A.signedOk),
    onError: fail,
    onSettled: () => setProgress(null),
  });
  const x = q.data;
  return (
    <Sheet open title={`${d.orgName} · ${work}`} onClose={onClose} side wide>
      <Loading q={q} />
      {x && (
        <div style={{ display: "grid", gap: 18 }}>
          {x.warnings.length > 0 && <div className="a-alert"><strong>{A.warnings}: </strong>{x.warnings.join(" · ")}</div>}
          <div>
            <h3 className="bw-h3">{A.prices}</h3>
            <div className="bw-table-wrap"><table className="bw-table"><tbody>
              {x.prices.map((p) => <tr key={String(p.root)}><td>{p.title}</td><td className="bw-num">{(Number(p.qtyMilli) / 1000).toLocaleString("nl-BE")} {p.unit}</td><td className="bw-num">{p.cents !== undefined ? fmtEuro(p.cents) : "—"}</td></tr>)}
            </tbody></table></div>
            {x.amountCents !== undefined && <p><span className="bw-label">{A.total} </span><span className="bw-num">{fmtEuro(x.amountCents)}</span></p>}
            {x.oaQuotes.length > 0 && <p className="bw-muted">{A.oaQuotes}: {x.oaQuotes.map(([, n]) => n).join(", ")}</p>}
          </div>
          <div>
            <h3 className="bw-h3">{A.rates}</h3>
            <p className="bw-muted">{A.keep}</p>
            <ul className="a-list">{x.rates.map((r, i) => <li key={i}>{r.kindName}: <span className="bw-num">{fmtEuro(r.cents)}</span> / {r.unit} · {A.from.toLowerCase()} {fmtDayNum(r.validFrom)}{r.note ? <span className="bw-muted"> · {r.note}</span> : null}</li>)}</ul>
            {x.firmRatesNow.length > 0 && <>
              <span className="bw-label">{A.firmNow}</span>
              <ul className="a-list">{x.firmRatesNow.map((r, i) => <li key={i}>{r.kindName}: <span className="bw-num">{fmtEuro(r.cents)}</span> / {r.unit} · {A.from.toLowerCase()} {fmtDayNum(r.validFrom)} <Button variant="quiet" onClick={() => setRate((s) => ({ ...s, kind: r.kind, unit: r.unit, euro: (Number(r.cents) / 100).toFixed(2).replace(".", ","), fromRateId: r.fromRateId }))}>{A.takeOver}</Button></li>)}</ul>
            </>}
            <div className="a-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
              <Field label={A.kind}><select className="bw-input" value={rate.kind} onChange={(e) => setRate({ ...rate, kind: e.target.value, fromRateId: undefined })}>{(setup.data?.rateKinds ?? []).map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select></Field>
              <Field label={A.amount}><input className="bw-input" inputMode="decimal" value={rate.euro} onChange={(e) => setRate({ ...rate, euro: e.target.value })} style={{ width: 110 }} /></Field>
              <Field label={A.newRate}><input className="bw-input" type="date" value={rate.from} onChange={(e) => setRate({ ...rate, from: e.target.value })} /></Field>
              <Button icon="plus" busy={addRate.isPending} disabled={!rate.euro} onClick={() => addRate.mutate()}>{A.addRate}</Button>
            </div>
          </div>
          <div>
            <h3 className="bw-h3">{A.terms}</h3>
            {terms === null
              ? <p>{A.advance}: {(Number(x.advanceBp) / 100).toLocaleString("nl-BE")} %{x.advanceCents !== undefined ? ` (${fmtEuro(x.advanceCents)})` : ""} · {String(x.paymentDays)} d{x.endOfMonth ? ` ${A.endOfMonth}` : ""} <Button variant="quiet" onClick={() => setTerms({ adv: (Number(x.advanceBp) / 100).toString().replace(".", ","), days: String(x.paymentDays), eom: x.endOfMonth })}>{A.edit}</Button></p>
              : <div className="a-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
                  <Field label={`${A.advance} (${A.advanceMax})`}><input className="bw-input" inputMode="decimal" value={terms.adv} onChange={(e) => setTerms({ ...terms, adv: e.target.value })} style={{ width: 90 }} /></Field>
                  <Field label={A.payDays}><input className="bw-input" inputMode="numeric" value={terms.days} onChange={(e) => setTerms({ ...terms, days: e.target.value })} style={{ width: 90 }} /></Field>
                  <label className="a-row" style={{ gap: 6 }}><input type="checkbox" checked={terms.eom} onChange={(e) => setTerms({ ...terms, eom: e.target.checked })} /> {A.endOfMonth}</label>
                  <Button variant="primary" busy={saveTerms.isPending} onClick={() => saveTerms.mutate()}>{t.common.save}</Button>
                </div>}
          </div>
          <div>
            <h3 className="bw-h3">{A.versions}</h3>
            <ul className="a-list">{x.versions.map((v) => <li key={String(v.version)} className="a-row" style={{ gap: 8, flexWrap: "wrap" }}><span>{A.version(Number(v.version))} · <span className="bw-mono">{v.hash.slice(0, 12)}</span> · {v.byName}</span>{v.signedAt !== undefined && <span className="a-tag a-tag--ok">{A.signed}</span>}<Button variant="quiet" busy={pdf.isPending} onClick={() => pdf.mutate(v.version)}>{A.pdf}</Button></li>)}</ul>
            <div className="a-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {x.deal.status !== "beëindigd" && x.deal.status !== "te tekenen" && <Button variant="primary" busy={make.isPending} onClick={() => make.mutate()}>{x.deal.contractVersion > 0n ? A.addendum : A.make}</Button>}
              {x.deal.status === "te tekenen" && <label className="bw-btn bw-btn--secondary">{progress !== null ? `${Math.round(progress)} %` : A.signUpload}<input type="file" accept="application/pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sign.mutate(f); e.target.value = ""; }} /></label>}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
