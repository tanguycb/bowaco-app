// Min-meerstaat (stap 2c.5, ontwerp 2c §3.1 en §4.5): werf → Facturatie → Min-meer. Kantoor (admin, calculator) ziet de levende staat
// met bedragen (readMinMeer: update-call met auditregel), voegt regels toe, prijst voorstellen, past automatische regels aan (met
// reden), zet het regietarief van de werf met datum, maakt een versie onder een controlecode, deelt ze met de klant en maakt een
// meerwerkofferte uit de gekozen regels (⚖3). De werfleider ziet de staat in hoeveelheden en uren (minMeerQty: geen enkel bedrag) en
// stelt meer- of minwerk voor. De klant (en de architect met de grant vorderingsstaten) ziet de gedeelde versies (MijnMinMeer).
// De browser rekent de totalen na met minmeer/calc.ts (dezelfde regels als de server); een verschil geeft een melding.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Caps, MinMeerFullView, MmRowView, MmEntryView, MmVersionBrief, MmFrozen, MmChange } from "../backend";
import { Button, Cijfer, Info, Meer, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtDayNum, fmtEuro, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { download } from "./Prijsvragen";
import { recheck } from "../minmeer/calc";
import { EntrySheet, OverrideSheet, RatesSheet, QuoteSheet } from "./MinMeerForms";

const T = t.minmeer;

/** 2 500 → "2,5"; duizendsten als getal. */
export const qtyText = (m: bigint) => (Number(m) / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 3 });
/** "2,5" → 2500n; ongeldig → null; leeg → 0n. */
export function parseQty(s: string): bigint | null {
  const v = s.replace(/\s/g, "").replace(",", ".");
  if (v === "") return 0n;
  if (!/^-?\d+(\.\d{1,3})?$/.test(v)) return null;
  const neg = v.startsWith("-");
  const [i, d = ""] = v.replace("-", "").split(".");
  const x = BigInt(i) * 1000n + BigInt((d + "000").slice(0, 3));
  return neg ? -x : x;
}
const flagText = (f: string) => T.flag[f] ?? f;

/** Werf → Facturatie → Min-meer: kantoor met bedragen, de werfleider in hoeveelheden. */
export function WorkMinMeer({ workId, caps, go }: { workId: bigint; caps: Caps; go?: (to: string) => void }) {
  return caps.minMeer ? <OfficeMinMeer workId={workId} go={go} /> : <QtyMinMeer workId={workId} />;
}

function OfficeMinMeer({ workId, go }: { workId: bigint; go?: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["minmeer", String(workId)], queryFn: async () => unwrap(await actor!.readMinMeer(workId)), enabled: !!actor && !isFetching, retry: false });
  const [entry, setEntry] = useState<MmEntryView | "new" | null>(null);
  const [override, setOverride] = useState<MmRowView | null>(null);
  const [rates, setRates] = useState(false);
  const [quote, setQuote] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [note, setNote] = useState("");
  const [openVersion, setOpenVersion] = useState<bigint | null>(null);
  const v = q.data;
  const check = useMemo(() => (v ? recheck(v) : null), [v]);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["minmeer", String(workId)] }); void qc.invalidateQueries({ queryKey: ["minmeerQty", String(workId)] }); };
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.makeMinMeerVersion(workId, note, { balanceCents: check!.totals.balanceCents, toInvoiceCents: check!.totals.toInvoiceCents })),
    onSuccess: () => { toast.show({ kind: "ok", text: T.made((v?.versions.length ?? 0) + 1) }); setConfirmVersion(false); setNote(""); refresh(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!v) return <section className="a-section"><h2 className="bw-h2">{T.title}</h2><Loading q={q} /></section>;
  const entryOf = (id: bigint | undefined) => (id === undefined ? undefined : v.entries.find((e) => e.id === id));
  return (
    <section className="a-section" data-testid="minmeer">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{T.title}<Info text={T.lead} label={t.uitleg.label} /></h2>
        <div className="a-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <Button icon="plus" onClick={() => setEntry("new")}>{T.add}</Button>
          <Button variant="primary" onClick={() => setConfirmVersion(true)} disabled={!check?.ok}>{T.makeVersion}</Button>
          <Meer items={[{ label: T.regieRates, onClick: () => setRates(true) }, { label: T.makeQuote, onClick: () => setQuote(true) }]} />
        </div>
      </div>
      <p className="bw-muted">{v.baseQuote ? T.base(v.baseQuote) : T.noBase}</p>
      {check && !check.ok && <p className="a-err" role="alert">{T.recheck}</p>}
      {v.findings.length > 0 && (
        <div className="a-note" role="note">
          <b>{T.attention}</b>
          <ul>{v.findings.map((f) => <li key={f.key}>{f.text}{f.count > 0n ? ` (${f.count})` : ""}</li>)}</ul>
        </div>
      )}
      {confirmVersion && (
        <div className="a-confirm" role="group" aria-label={T.makeVersion}>
          <p>{T.versionConfirm}</p>
          <label className="bw-field"><span className="bw-label">{T.versionNote}</span><textarea className="bw-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="a-row"><Button variant="primary" busy={make.isPending} onClick={() => make.mutate()}>{T.makeVersion}</Button><Button variant="quiet" onClick={() => setConfirmVersion(false)}>{t.common.cancel}</Button></div>
        </div>
      )}
      <Totals totals={v.totals} invoiced={v.invoiced} />
      <RowsTable rows={v.rows} discs={v.discs} office onRow={(r) => { const e = entryOf(r.entryId); if (e) setEntry(e); else if (r.overridable) setOverride(r); }} />
      <Versions workId={workId} versions={v.versions} office onOpen={setOpenVersion} onChanged={refresh} />
      {entry !== null && <EntrySheet workId={workId} view={v} entry={entry === "new" ? null : entry} office onClose={() => setEntry(null)} onSaved={refresh} />}
      {override && <OverrideSheet workId={workId} row={override} onClose={() => setOverride(null)} onSaved={refresh} />}
      {rates && <RatesSheet workId={workId} view={v} onClose={() => setRates(false)} onSaved={refresh} />}
      {quote && <QuoteSheet workId={workId} view={v} onClose={() => setQuote(false)} onSaved={refresh} go={go} />}
      {openVersion !== null && <VersionSheet id={openVersion} onClose={() => setOpenVersion(null)} />}
    </section>
  );
}

/** De totalen onderaan, zoals de Excel. */
function Totals({ totals: x, invoiced }: { totals: MinMeerFullView["totals"]; invoiced: MinMeerFullView["invoiced"] }) {
  const row = (l: string, c: bigint, strong = false) => <div className="a-row a-row--between"><span>{strong ? <b>{l}</b> : l}</span><span className="bw-num">{strong ? <b>{fmtEuro(c)}</b> : fmtEuro(c)}</span></div>;
  return (
    <div className="a-cols" style={{ marginBlock: 12 }}>
      <div className="a-card" style={{ minWidth: 260 }}>
        {row(T.totals.offer, x.offerCents)}
        {row(T.totals.less, x.lessCents)}
        {row(T.totals.extra, x.extraCents)}
        {row(T.totals.balance, x.balanceCents, true)}
        {row(T.totals.contract, x.contractCents, true)}
        {row(T.totals.invoiced, x.invoicedCents)}
        {/* 4b.3: uitleg bij het cijfer: de opbouw enkel als de som klopt met wat de backend rekende (anders enkel de zin). */}
        <div className="a-row a-row--between"><b>{T.totals.toInvoice}</b><b className="bw-num"><Cijfer naam={T.totals.toInvoice} uitleg={t.schil.cijfer.nogTeFactureren}
          regels={x.contractCents - x.invoicedCents === x.toInvoiceCents ? [{ label: T.totals.contract, waarde: fmtEuro(x.contractCents) }, { label: T.totals.invoiced, waarde: `− ${fmtEuro(x.invoicedCents)}` }, { label: T.totals.toInvoice, waarde: fmtEuro(x.toInvoiceCents), totaal: true }] : undefined}>{fmtEuro(x.toInvoiceCents)}</Cijfer></b></div>
        {x.pendingCents !== 0n && <p className="bw-muted">{T.totals.pending}: {fmtEuro(x.pendingCents)}</p>}
        {x.revisionCents !== 0n && <p className="bw-muted">{T.totals.revision}: {fmtEuro(x.revisionCents)}</p>}
      </div>
      {invoiced.length > 0 && (
        <div className="a-card" style={{ minWidth: 260 }}>
          <span className="bw-label">{T.invoicedTitle}</span>
          {invoiced.map((i, k) => <div key={k} className="a-row a-row--between"><span>{i.title} · {fmtDayNum(i.day)}{i.revisionCents !== 0n ? ` (+ ${fmtEuro(i.revisionCents)} prijsherziening)` : ""}</span><span className="bw-num">{fmtEuro(i.cents)}</span></div>)}
        </div>
      )}
    </div>
  );
}

type DiscLike = { entryId: bigint; chapter: string; description: string; pctBp?: bigint; lessCents: bigint; counted: boolean };

/** De regels per hoofdstuk (kantoor: met bedragen, kostprijs en marge; een klik opent de regel of de aanpassing). */
function RowsTable({ rows, discs, office, onRow }: { rows: MmRowView[]; discs: DiscLike[]; office: boolean; onRow: (r: MmRowView) => void }) {
  const chapters: string[] = [];
  for (const r of rows) if (!chapters.includes(r.chapter)) chapters.push(r.chapter);
  for (const d of discs) if (!chapters.includes(d.chapter)) chapters.push(d.chapter);
  return (
    <div className="a-tablewrap" style={{ overflowX: "auto" }}>
      <table className="a-table" style={{ minWidth: 860 }}>
        <thead>
          <tr><th>{T.cols.desc}</th><th>{T.cols.unit}</th><th className="bw-num">{T.cols.qty}</th><th className="bw-num">{T.cols.unitPrice}</th><th className="bw-num">{T.cols.offer}</th><th className="bw-num">{T.cols.less}</th><th className="bw-num">{T.cols.extra}</th><th>{T.cols.note}</th></tr>
        </thead>
        {chapters.map((ch) => (
          <tbody key={ch}>
            <tr className="a-table__group"><th colSpan={8}>{ch || T.general}</th></tr>
            {rows.filter((r) => r.chapter === ch).map((r) => {
              const dim = !r.counted || !r.inVersion;
              const click = office && (r.entryId !== undefined || r.overridable);
              return (
                <tr key={r.key} className={dim ? "bw-muted" : ""} onClick={click ? () => onRow(r) : undefined} style={click ? { cursor: "pointer" } : undefined} data-testid={`mm-${r.key}`}>
                  <td>
                    <div>{r.description}</div>
                    <div className="bw-muted" style={{ fontSize: 12 }}>
                      {[r.sourceText, r.day !== undefined ? fmtDayNum(r.day) : "", r.chapterFrom ? T.moved(r.chapterFrom) : "", r.costCents !== undefined ? T.costLine(fmtEuro(r.costCents), r.marginBp !== undefined ? fmtBp(r.marginBp) : "–") : ""].filter(Boolean).join(" · ")}
                    </div>
                    {r.flags.length > 0 && <div className="a-row" style={{ flexWrap: "wrap", gap: 4 }}>{r.flags.map((f) => <span key={f} className="a-tag a-tag--warn">{flagText(f)}</span>)}</div>}
                  </td>
                  <td>{r.unit}</td>
                  <td className="bw-num">{r.qtyMilli !== 0n ? qtyText(r.qtyMilli) : ""}{r.pctBp !== undefined ? ` × ${fmtBp(r.pctBp)}` : ""}</td>
                  <td className="bw-num">{r.unitCents !== 0n ? fmtEuro(r.unitCents) : ""}</td>
                  <td className="bw-num">{r.offerCents !== 0n ? fmtEuro(r.offerCents) : ""}</td>
                  <td className="bw-num">{r.lessCents !== 0n ? fmtEuro(r.lessCents) : ""}</td>
                  <td className="bw-num">{r.extraCents !== 0n ? fmtEuro(r.extraCents) : ""}</td>
                  <td>{[r.approval !== "niet nodig" ? r.approval : "", r.note].filter(Boolean).join(" — ")}{dim ? ` (${r.excluded ? T.excluded : T.notCounted})` : ""}</td>
                </tr>
              );
            })}
            {discs.filter((d) => d.chapter === ch).map((d) => (
              <tr key={`d${d.entryId}`} className={d.counted ? "" : "bw-muted"}>
                <td>{d.description}{d.pctBp !== undefined ? ` (${fmtBp(d.pctBp)})` : ""}</td><td /><td /><td /><td /><td className="bw-num">{fmtEuro(d.lessCents)}</td><td /><td>{d.counted ? "" : T.notCounted}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** De versies: nummer, datum, gedeeld, antwoord; kantoor: bekijken, PDF, delen (bevestiging in het scherm). */
function Versions({ workId, versions, office, onOpen, onChanged }: { workId: bigint; versions: MmVersionBrief[]; office: boolean; onOpen?: (id: bigint) => void; onChanged?: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [share, setShare] = useState<bigint | null>(null);
  const doShare = useMutation({
    mutationFn: async (id: bigint) => unwrap(await actor!.shareMinMeerVersion(id)),
    onSuccess: () => { toast.show({ kind: "ok", text: T.sharedOk }); setShare(null); onChanged?.(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const pdf = async (id: bigint) => {
    try {
      const r = unwrap(await actor!.readMinMeerVersion(id));
      await versionPdf(r.frozen, r.hash, r.changes, false, null, workId);
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h3 className="bw-h3">{T.versions}</h3>
      {versions.length === 0 ? <p className="a-empty">{T.noVersions}</p> : (
        <ul className="a-list">
          {[...versions].reverse().map((x) => (
            <li key={String(x.id)} className="a-row a-row--between" style={{ flexWrap: "wrap", gap: 6 }}>
              <span><b>{T.version(x.number)}</b> · {fmtDayNum(x.day)} · {x.isShared ? T.shared : T.notShared}{x.answer !== undefined ? ` · ${x.answer ? T.answerOk : T.answerNote}` : ""}{x.note ? ` · ${x.note}` : ""}</span>
              {office && (
                <span className="a-row" style={{ gap: 6 }}>
                  <Button variant="quiet" onClick={() => onOpen?.(x.id)}>{T.open}</Button>
                  <Button variant="quiet" onClick={() => void pdf(x.id)}>{T.pdf}</Button>
                  {!x.isShared && <Button onClick={() => setShare(x.id)}>{T.share}</Button>}
                </span>
              )}
              {share === x.id && (
                <div className="a-confirm" role="group" aria-label={T.share} style={{ flexBasis: "100%" }}>
                  <p>{T.shareConfirm}</p>
                  <div className="a-row"><Button variant="primary" busy={doShare.isPending} onClick={() => doShare.mutate(x.id)}>{T.share}</Button><Button variant="quiet" onClick={() => setShare(null)}>{t.common.cancel}</Button></div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Een vastgelegde versie (kantoor): controlecode, wat veranderde, akkoord. */
function VersionSheet({ id, onClose }: { id: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["minmeerVersion", String(id)], queryFn: async () => unwrap(await actor!.readMinMeerVersion(id)), enabled: !!actor && !isFetching, retry: false });
  const r = q.data;
  return (
    <Sheet title={r ? T.version(r.brief.number) : T.versions} open onClose={onClose} wide>
      <Loading q={q} />
      {r && (
        <div className="a-form">
          {!r.intact && <p className="a-err" role="alert">{T.notIntact}</p>}
          <p className="bw-muted">{T.hash}: <code>{r.hash.slice(0, 32)}…</code></p>
          <Changes changes={r.changes} prev={r.prevNumber !== undefined} />
          <FrozenTable fr={r.frozen} />
          <Totals totals={r.frozen.totals} invoiced={r.frozen.invoiced} />
        </div>
      )}
    </Sheet>
  );
}

function Changes({ changes, prev }: { changes: MmChange[]; prev: boolean }) {
  return (
    <div>
      <span className="bw-label">{T.changes}</span>
      {!prev ? <p className="bw-muted">{T.noChanges}</p> : changes.length === 0 ? <p className="bw-muted">–</p> : (
        <ul className="a-list">{changes.map((c, k) => <li key={k} className="a-row a-row--between"><span>{T.change[c.kind] ?? c.kind} · {c.chapter ? `${c.chapter} · ` : ""}{c.description}</span><span className="bw-num">{fmtEuro(c.balanceDeltaCents)}</span></li>)}</ul>
      )}
    </div>
  );
}

type FrozenLike = { lines: Array<{ chapter: string; source: string; day?: bigint; description: string; unit: string; qtyMilli: bigint; unitCents: bigint; offerCents: bigint; lessCents: bigint; extraCents: bigint; counted: boolean; approval: string; note: string }> };

/** De regels van een vastgelegde versie (kantoor en klant: dezelfde inhoud, zonder kostprijs of OA-naam). */
function FrozenTable({ fr }: { fr: FrozenLike }) {
  const chapters: string[] = [];
  for (const l of fr.lines) if (!chapters.includes(l.chapter)) chapters.push(l.chapter);
  return (
    <div className="a-tablewrap" style={{ overflowX: "auto" }}>
      <table className="a-table" style={{ minWidth: 760 }}>
        <thead><tr><th>{T.cols.desc}</th><th>{T.cols.unit}</th><th className="bw-num">{T.cols.qty}</th><th className="bw-num">{T.cols.unitPrice}</th><th className="bw-num">{T.cols.offer}</th><th className="bw-num">{T.cols.less}</th><th className="bw-num">{T.cols.extra}</th><th>{T.cols.note}</th></tr></thead>
        {chapters.map((ch) => (
          <tbody key={ch}>
            <tr className="a-table__group"><th colSpan={8}>{ch || T.general}</th></tr>
            {fr.lines.filter((l) => l.chapter === ch).map((l, k) => (
              <tr key={k} className={l.counted ? "" : "bw-muted"}>
                <td><div>{l.description}</div><div className="bw-muted" style={{ fontSize: 12 }}>{[l.source, l.day !== undefined ? fmtDayNum(l.day) : ""].filter(Boolean).join(" · ")}</div></td>
                <td>{l.unit}</td>
                <td className="bw-num">{l.qtyMilli !== 0n ? qtyText(l.qtyMilli) : ""}</td>
                <td className="bw-num">{l.unitCents !== 0n ? fmtEuro(l.unitCents) : ""}</td>
                <td className="bw-num">{l.offerCents !== 0n ? fmtEuro(l.offerCents) : ""}</td>
                <td className="bw-num">{l.lessCents !== 0n ? fmtEuro(l.lessCents) : ""}</td>
                <td className="bw-num">{l.extraCents !== 0n ? fmtEuro(l.extraCents) : ""}</td>
                <td>{[l.approval !== "niet nodig" ? l.approval : "", l.note].filter(Boolean).join(" — ")}{l.counted ? "" : ` (${T.notCounted})`}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** De PDF van een versie (kantoor en klant: uit wat vastligt). */
async function versionPdf(fr: MmFrozen | MyFrozen, hash: string, changes: MmChange[], client: boolean, answer: { ok: boolean; at: bigint; byName: string; note: string } | null, _workId?: bigint) {
  const [{ minMeerPdf }, { loadPdfFonts }] = await Promise.all([import("../pdf/minmeer.ts"), import("../pdf/fonts.ts")]);
  const bytes = await minMeerPdf({
    number: fr.number, day: fr.day, hash, issuer: fr.issuer, clientName: fr.clientName, workCode: fr.workCode, workName: fr.workName, workAddress: fr.workAddress, quoteRefs: fr.quoteRefs, note: fr.note,
    lines: fr.lines.map((l) => ({ chapter: l.chapter, source: l.source, day: l.day ?? null, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents, offerCents: l.offerCents, lessCents: l.lessCents, extraCents: l.extraCents, counted: l.counted, approval: l.approval, note: l.note })),
    chapters: fr.chapters, invoiced: fr.invoiced, totals: fr.totals, changes, client,
    answer: answer ? { ok: answer.ok, atDay: Math.floor(Number(answer.at / 1_000_000n) / 86_400_000), byName: answer.byName, note: answer.note } : null,
  }, await loadPdfFonts());
  download(bytes, `Min-meerstaat ${fr.workCode} versie ${fr.number}.pdf`, "application/pdf");
}

/** De werfleider: de staat in hoeveelheden en uren (nooit een bedrag), zijn voorstellen, de versies (zonder bedrag). */
function QtyMinMeer({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["minmeerQty", String(workId)], queryFn: () => actor!.minMeerQty(workId), enabled: !!actor && !isFetching, retry: false });
  const [propose, setPropose] = useState(false);
  const v = q.data;
  if (!v) return <section className="a-section"><h2 className="bw-h2">{T.title}</h2><Loading q={q} /></section>;
  const chapters: string[] = [];
  for (const r of v.rows) if (!chapters.includes(r.chapter)) chapters.push(r.chapter);
  return (
    <section className="a-section" data-testid="minmeer-qty">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{T.title}</h2>
        {v.canPropose && <Button icon="plus" onClick={() => setPropose(true)}>{T.propose}</Button>}
      </div>
      <p className="bw-muted">{T.leadQty}</p>
      <div className="a-tablewrap" style={{ overflowX: "auto" }}>
        <table className="a-table" style={{ minWidth: 560 }}>
          <thead><tr><th>{T.cols.desc}</th><th>{T.cols.unit}</th><th className="bw-num">{T.cols.qty}</th><th>{T.cols.note}</th></tr></thead>
          {chapters.map((ch) => (
            <tbody key={ch}>
              <tr className="a-table__group"><th colSpan={4}>{ch || T.general}</th></tr>
              {v.rows.filter((r) => r.chapter === ch).map((r) => (
                <tr key={r.key} className={r.counted ? "" : "bw-muted"}>
                  <td><div>{r.description}</div><div className="bw-muted" style={{ fontSize: 12 }}>{[r.sourceText, r.day !== undefined ? fmtDayNum(r.day) : ""].filter(Boolean).join(" · ")}</div>{r.flags.length > 0 && <div className="a-row" style={{ flexWrap: "wrap", gap: 4 }}>{r.flags.map((f) => <span key={f} className="a-tag a-tag--warn">{flagText(f)}</span>)}</div>}</td>
                  <td>{r.unit}</td>
                  <td className="bw-num">{qtyText(r.qtyMilli)}</td>
                  <td>{r.approval !== "niet nodig" ? r.approval : ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <Versions workId={workId} versions={v.versions} office={false} />
      {propose && <EntrySheet workId={workId} posts={v.posts} entry={null} office={false} onClose={() => setPropose(false)} onSaved={() => void qc.invalidateQueries({ queryKey: ["minmeerQty", String(workId)] })} />}
    </section>
  );
}

type MyFrozen = { number: bigint; day: bigint; issuer: string; clientName: string; workCode: string; workName: string; workAddress: MmFrozen["workAddress"]; quoteRefs: string[]; note: string; lines: FrozenLike["lines"]; chapters: MmFrozen["chapters"]; invoiced: MmFrozen["invoiced"]; totals: MmFrozen["totals"] };

/** De klant (en de architect met de grant vorderingsstaten): de gedeelde versies van de min-meerstaat van zijn werf. */
export function MyMinMeer({ workId, hideEmpty }: { workId?: bigint; hideEmpty?: boolean }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["myMinMeer"], queryFn: () => actor!.listMyMinMeer(), enabled: !!actor && !isFetching, retry: false });
  const [open, setOpen] = useState<bigint | null>(null);
  const list = (q.data ?? []).filter((x) => workId === undefined || x.workId === workId);
  if (q.isError || (hideEmpty && list.length === 0)) return null;
  return (
    <section className="a-section" data-testid="my-minmeer">
      <h2 className="bw-h2">{T.mine.title}<Info text={T.mine.lead} label={t.uitleg.label} /></h2>
      {list.length === 0 ? <p className="a-empty">{T.mine.none}</p> : (
        <ul className="a-list">
          {list.map((x) => (
            <li key={String(x.id)}>
              <button type="button" className="a-list__btn" onClick={() => setOpen(x.id)}>
                <span className="a-list__main"><b>{T.version(x.number)}</b><span className="bw-muted">{x.workName} · {fmtDayNum(x.day)}{x.answered !== undefined ? ` · ${x.answered ? T.answerOk : T.answerNote}` : ""}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <MyVersionSheet id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function MyVersionSheet({ id, onClose }: { id: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["myMinMeer", String(id)], queryFn: async () => unwrap(await actor!.readMyMinMeer(id)), enabled: !!actor && !isFetching, retry: false });
  const [mode, setMode] = useState<"ok" | "remark" | null>(null);
  const [text, setText] = useState("");
  const r = q.data;
  const answer = useMutation({
    mutationFn: async () => unwrap(await actor!.answerMyMinMeer(id, r!.hash, mode === "ok", mode === "ok" ? "" : text)),
    onSuccess: () => { toast.show({ kind: "ok", text: T.mine.thanks }); setMode(null); void qc.invalidateQueries({ queryKey: ["myMinMeer"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={r ? `${T.mine.title} · ${T.version(r.number)}` : T.mine.title} open onClose={onClose} wide>
      <Loading q={q} />
      {r && (
        <div className="a-form">
          {!r.intact && <p className="a-err" role="alert">{T.notIntact}</p>}
          <p className="bw-muted">{r.workName} · {fmtDayNum(r.day)} · {r.quoteRefs.join(", ")}</p>
          {r.note && <p>{r.note}</p>}
          <Totals totals={r.totals} invoiced={r.invoiced} />
          <FrozenTable fr={r} />
          <Changes changes={r.changes} prev={r.changes.length > 0} />
          <div className="a-row"><Button onClick={() => void versionPdf(r, r.hash, r.changes, true, r.answer ? { ok: r.answer.ok, at: r.answer.at, byName: r.answer.byName, note: r.answer.note } : null).catch((e) => toast.show({ kind: "error", text: errText(e) }))}>{T.pdf}</Button></div>
          {r.answer && <p className="bw-muted">{T.mine.answered(r.answer.ok, fmtDayNum(BigInt(Math.floor(Number(r.answer.at / 1_000_000n) / 86_400_000))))}{r.answer.note ? `: ${r.answer.note}` : ""}</p>}
          {r.canAnswer && mode === null && <div className="a-row"><Button variant="primary" onClick={() => setMode("ok")}>{T.mine.ok}</Button><Button onClick={() => setMode("remark")}>{T.mine.remark}</Button></div>}
          {mode !== null && (
            <div className="a-confirm" role="group" aria-label={mode === "ok" ? T.mine.ok : T.mine.remark}>
              {mode === "ok" ? <p>{T.mine.confirmOk}</p> : <label className="bw-field"><span className="bw-label">{T.mine.remarkText}</span><textarea className="bw-input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></label>}
              <div className="a-row"><Button variant="primary" busy={answer.isPending} disabled={mode === "remark" && text.trim().length < 5} onClick={() => answer.mutate()}>{T.mine.send}</Button><Button variant="quiet" onClick={() => setMode(null)}>{t.common.cancel}</Button></div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
