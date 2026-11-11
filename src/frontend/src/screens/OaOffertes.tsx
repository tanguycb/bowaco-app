// OA-offertes ontvangen en vergelijken (stap 2c.3, ontwerp 2c §4.3, §5, §6; prototype 2c: werf → Offerte → OA-offertes). Kantoor
// (beheerder, calculator) leest een teruggestuurde Excel in (tender/sheetread.ts: de verborgen sleutel, enkel waarden, voorbeeld met
// tellingen en markeringen), registreert een offerte met de hand naast de PDF (per post, hoofdstuktotalen of enkel het totaal) of
// los zonder prijsvraag, vergelijkt per prijsvraag (de server rekent, de browser rekent na met tender/compare.ts), kiest per
// hoofdstuk of per post, neemt over in een ontwerpversie van de offerte en sluit af (gekozen / bedankt, met het bericht volgens
// Beheer). De werfleider ziet enkel per hoofdstuk de gekozen firma. Bedragen enkel uit update-calls met een auditregel.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalBlob, OaQuoteSource, OrgKind, type Caps, type OaRegLine, type OaQuoteInput, type TenderCompareView, type TenderInviteView, type TenderStatusView, type TenderView, type CmpCell } from "../backend";
import { Button, Choice, Confirm, Meer, RasterKop, RasterRij, Sheet, Tag, Terug, Totaal, useToast, useWerkvormKan, Werkvorm, type WerkvormHandle } from "../design";
import { Cijfer } from "../design/Pop";
import * as G from "../design/vormkern";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, parseEuro, parsePct, todayDay, unwrap, useBackend } from "../util";
import { Loading } from "./common";
import { fmtQty, parseQty } from "./Offertes";
import { Field } from "./Werven";
import { TenderCheckPanel } from "./Nakijken";
import { QuoteSheet, download, unitOf } from "./Prijsvragen";
import { readTenderSheet, MAX_BYTES, type SheetResult } from "../tender/sheetread.ts";
import { roundDiv, totals, type Included } from "../tender/calc.ts";
import { compare, sameResult, type CInput, type CResult } from "../tender/compare.ts";
import "../app/prijsvraag.css";
import { prepareUpload } from "../lib/uploadPrep";
import type { OaReadFull, OaReadProposal } from "../backend";
import { ReadBanner, ReadList, StartReadSheet } from "./OaInlezen";

const O = t.oaOffertes;
const P = t.prijsvragen;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const pctText = (bp: bigint) => `${bp > 0n ? "+" : "−"}${(Math.abs(Number(bp)) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 0 })} %`;
const isOpenT = (s: { __kind__: string }) => s.__kind__ === "open";

// ── De werf → Offerte → OA-offertes ─────────────────────────────────────────
export function WorkOaQuotes({ workId, caps }: { workId: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const office = caps.tenders;
  const list = useQuery({ queryKey: ["tenders", String(workId)], queryFn: () => actor!.listTenders(workId), enabled: !!actor && !isFetching, retry: 0 });
  const [loose, setLoose] = useState(false);
  const [readLoose, setReadLoose] = useState(false);
  const [use, setUse] = useState<OaReadFull | null>(null);
  if (list.error) return <p className="a-empty">{O.noRight}</p>;
  const rows = (list.data ?? []).filter((s) => s.status.__kind__ !== "cancelled");
  if (!office) return <LeaderPicks rows={rows} q={list} />;
  return (
    <section className="a-section" data-testid="oq-werf">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{O.title}</h2>
        <div className="a-row">
          <Button icon="plus" onClick={() => setLoose(true)} data-testid="oq-loose">{O.loose}</Button>
          <Button variant="quiet" onClick={() => setReadLoose(true)} data-testid="or-loose">{t.oaInlezen.startLoose}</Button>
        </div>
      </div>
      <p className="bw-muted pv-lead">{O.lead}</p>
      <Loading q={list} />
      {list.data && rows.length === 0 && <p className="a-empty">{O.none}</p>}
      {rows.map((s) => <TenderOaPanel key={String(s.id)} s={s} />)}
      <ReadList workId={workId} onUse={setUse} />
      <LooseList workId={workId} />
      {loose && <HandSheet workId={workId} v={null} inv={null} onClose={() => setLoose(false)} />}
      {readLoose && <StartReadSheet target={{ workId }} onClose={() => setReadLoose(false)} />}
      {use && <ReadUse workId={workId} full={use} onClose={() => setUse(null)} />}
    </section>
  );
}

/** De werfleider: per prijsvraag en per hoofdstuk wie gekozen is (wie komt werken); nooit een prijs. */
function LeaderPicks({ rows, q }: { rows: TenderStatusView[]; q: Parameters<typeof Loading>[0]["q"] }) {
  return (
    <section className="a-section" data-testid="oq-leader">
      <h2 className="bw-h2">{O.title}</h2>
      <p className="bw-muted pv-lead">{O.leadLeader}</p>
      <Loading q={q} />
      {rows.map((s) => (
        <div key={String(s.id)} className="pv-card">
          <div className="pv-card__h"><div><b className="bw-mono">{s.code}</b> · <b>{s.title}</b></div><span className="a-tag">{P.status[s.status.__kind__] ?? s.status.__kind__}</span></div>
          {s.picks.length === 0 ? <p className="bw-muted">{O.noneLeader}</p> : (
            <ul className="a-list">
              {s.picks.map((p) => <li key={p.chapter}><span className="a-list__main"><b>{p.chapter || O.leaderWhole}</b><span className="bw-muted">{O.leaderChosen}: {p.orgNames.join(", ")}</span></span></li>)}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function LooseList({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["oaQuotes", String(workId)], queryFn: () => actor!.listOaQuotes(workId), enabled: !!actor && !isFetching, retry: 0 });
  const [open, setOpen] = useState<bigint | null>(null);
  const rows = (q.data ?? []).filter((x) => x.tenderId === undefined);
  return (
    <div className="pv-card" data-testid="oq-loose-list">
      <b>{O.looseTitle}</b>
      {q.data && rows.length === 0 && <p className="bw-muted">{O.looseNone}</p>}
      <ul className="a-list">
        {rows.map((x) => (
          <li key={String(x.id)}>
            {x.status.__kind__ === "withdrawn" && <span className="a-tag a-tag--bad">{O.withdrawnTag}</span>}
            <span className="a-list__main"><b>{x.orgName}</b><span className="bw-muted">{[x.number, fmtDayNum(x.quoteDay), x.validUntil !== undefined ? `${P.validUntil} ${fmtDayNum(x.validUntil)}` : ""].filter(Boolean).join(" · ")}</span></span>
            <Button variant="quiet" onClick={() => setOpen(x.id)}>{O.view}</Button>
          </li>
        ))}
      </ul>
      {open !== null && <QuoteSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 3.8: het formulier met het voorstel (op een prijsvraag: eerst de prijsvraag lezen voor de posten). */
function ReadUse({ workId, full, onClose }: { workId: bigint; full: OaReadFull; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const tid = full.brief.tenderId;
  const q = useQuery({ queryKey: ["tender", String(tid)], queryFn: async () => unwrap(await actor!.readTender(tid!)), enabled: !!actor && !isFetching && tid !== undefined });
  if (tid === undefined) return <HandSheet workId={workId} v={null} inv={null} read={full} orgPreset={full.brief.orgId} onClose={onClose} />;
  const v = q.data;
  const inv = v?.invites.find((i) => i.id === full.brief.inviteId) ?? null;
  if (!v || !inv) return null;
  return <HandSheet workId={workId} v={v} inv={inv} read={full} onClose={onClose} />;
}

type Sh = { k: "excel"; inv: TenderInviteView | null } | { k: "hand"; inv: TenderInviteView } | { k: "quote"; id: bigint } | { k: "read"; inv: TenderInviteView };

function TenderOaPanel({ s }: { s: TenderStatusView }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["tender", String(s.id)], queryFn: async () => unwrap(await actor!.readTender(s.id)), enabled: !!actor && !isFetching });
  const [sheet, setSheet] = useState<Sh | null>(null);
  const [cmp, setCmp] = useState(false);
  const v = q.data;
  const got = s.invites.filter((i) => String(i.status) === "received").length;
  return (
    <div className="pv-card" data-testid="oq-tender">
      <div className="pv-card__h">
        <div><b className="bw-mono">{s.code}</b> · <b>{s.title}</b><div className="bw-muted">{O.received(got, s.invites.length)} · {P.before(fmtDayNum(s.deadlineDay))}</div></div>
        <span className="a-tag">{P.status[s.status.__kind__] ?? s.status.__kind__}</span>
      </div>
      <Loading q={q} />
      {v && (
        <ul className="a-list">
          {v.invites.map((inv) => {
            const cur = [...inv.oaQuotes].filter((x) => x.current)[0];
            return (
              <li key={String(inv.id)} data-testid="oq-invite">
                <span className="a-list__main">
                  <b>{inv.orgName}</b>
                  <span className="bw-muted">{cur ? `${O.version(Number(cur.version))} · ${cur.byBot ? O.byBot : O.source[cur.source] ?? cur.source}${cur.number ? ` · ${cur.number}` : ""} · ${fmtDayNum(cur.quoteDay)}${cur.validUntil !== undefined ? ` · ${P.validUntil} ${fmtDayNum(cur.validUntil)}` : ""}` : O.noAnswer}{inv.oaQuotes.length > 1 ? ` · ${O.cmpHistory(inv.oaQuotes.length - 1)}` : ""}</span>
                </span>
                {inv.outcome.__kind__ !== "open" && <span className="a-tag">{P.outcome[inv.outcome.__kind__]}</span>}
                {cur?.status.__kind__ === "withdrawn" && <span className="a-tag a-tag--bad" data-testid="oq-withdrawn-tag">{O.withdrawnTag}</span>}
                {cur && <Button variant="quiet" onClick={() => setSheet({ k: "quote", id: cur.id })}>{O.view}</Button>}
                {isOpenT(v.status) && <Button onClick={() => setSheet({ k: "excel", inv })} data-testid="oq-excel">{O.readExcel}</Button>}
                {isOpenT(v.status) && <Button variant="quiet" onClick={() => setSheet({ k: "hand", inv })} data-testid="oq-hand">{O.byHand}</Button>}
                {isOpenT(v.status) && <Button variant="quiet" onClick={() => setSheet({ k: "read", inv })} data-testid="or-start">{t.oaInlezen.start}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="a-row"><Button variant={cmp ? "quiet" : "primary"} onClick={() => setCmp(!cmp)} data-testid="oq-compare">{cmp ? O.hideCompare : O.compare}</Button></div>
      {cmp && v && <Compare tenderId={s.id} v={v} />}
      {sheet?.k === "excel" && v && <ExcelSheet v={v} inv={sheet.inv} onHand={(inv) => setSheet({ k: "hand", inv })} onClose={() => setSheet(null)} />}
      {sheet?.k === "hand" && v && <HandSheet workId={v.workId} v={v} inv={sheet.inv} onClose={() => setSheet(null)} />}
      {sheet?.k === "quote" && <QuoteSheet id={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.k === "read" && v && <StartReadSheet target={{ workId: v.workId, inviteId: sheet.inv.id, orgId: sheet.inv.orgId, orgName: sheet.inv.orgName }} onClose={() => setSheet(null)} />}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => { for (const k of ["tender", "tenders", "oaQuotes", "tenderCompare", "oaReads"]) void qc.invalidateQueries({ queryKey: [k] }); };
}

// ── Excel inlezen ───────────────────────────────────────────────────────────
function ExcelSheet({ v, inv, onHand, onClose }: { v: TenderView; inv: TenderInviteView | null; onHand: (inv: TenderInviteView) => void; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const [res, setRes] = useState<SheetResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = async (f: File) => {
    setRes(null);
    if (f.size > MAX_BYTES) { setRes({ ok: false, error: "Het bestand is groter dan 5 MB." }); return; }
    const b = new Uint8Array(await f.arrayBuffer());
    setFile(f);
    setBytes(b);
    setRes(await readTenderSheet(b, f.name, {
      tenderId: v.id, code: v.code,
      items: v.items.map((x) => ({ id: x.id, pos: Number(x.pos), chapter: x.chapter, title: x.title, unit: unitOf(x.unit), unitName: x.unit, qtyMilli: x.qtyMilli })),
      invites: v.invites.map((i) => ({ id: i.id, orgName: i.orgName, sheetKey: i.sheetKey })),
      expectInviteId: inv?.id ?? null,
    }));
  };
  const ok = res && res.ok ? res : null;
  const target = ok ? v.invites.find((i) => i.id === ok.inviteId) ?? null : null;
  const save = async () => {
    if (!ok || !target || !file || !bytes) return;
    setBusy(true);
    try {
      const sent = ok.lines.filter((l) => l.row > 0 && !l.error);
      const lines: OaRegLine[] = sent.map((l) => ({ itemId: l.itemId ?? undefined, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents ?? undefined, included: l.included as OaRegLine["included"], remark: l.remark }));
      const chapterOf = (id: bigint) => v.items.find((x) => x.id === id)?.chapter ?? "";
      const net = totals(sent.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli, unitCents: l.unitCents, included: l.included })), ok.header.discountBp, chapterOf).net;
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, XLSX, file.name).withUploadProgress(setProgress);
      const input: OaQuoteInput = {
        inviteId: target.id, workId: v.workId, orgId: target.orgId, source: OaQuoteSource.sheet, sheetKey: target.sheetKey,
        number: ok.header.number, quoteDay: ok.header.quoteDay ?? todayDay(), validUntil: ok.header.validUntil ?? undefined, discountBp: ok.header.discountBp ?? undefined, reverse: ok.header.reverse,
        prices: { __kind__: "lines", lines }, remark: "", note: "", file: { name: file.name, mime: XLSX, size: BigInt(bytes.length), blob },
      };
      unwrap(await actor!.registerOaQuote(input, net));
      toast.show({ kind: "ok", text: O.excelSaved });
      refresh();
      onClose();
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); setProgress(null); }
  };
  return (
    <Sheet title={O.excelTitle(v.code)} open onClose={onClose} side wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button>{ok && <Button variant="primary" busy={busy} disabled={ok.counts.errors > 0 || !target} onClick={() => void save()} data-testid="oq-excel-save">{progress !== null ? P.yourPdfBusy(progress) : O.excelSave}</Button>}</>}>
      <p className="bw-muted">{O.excelLead}</p>
      <label className="bw-field"><span className="bw-label">{O.excelPick}</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} data-testid="oq-excel-file" /></label>
      {res && !res.ok && (
        <div className="a-note" role="alert" data-testid="oq-excel-err">
          <p>{res.error}</p>
          {inv && <Button onClick={() => onHand(inv)}>{O.excelHandInstead}</Button>}
        </div>
      )}
      {ok && (
        <>
          <div className="oq-strip" data-testid="oq-excel-preview">
            <div><span className="bw-label">{O.excelFirm}</span><b>{ok.orgName}</b></div>
            <div><span className="bw-label">{O.excelRead}</span><b>{ok.counts.read}/{v.items.length}</b></div>
            <div><span className="bw-label">{O.excelWithPrice}</span><b>{ok.lines.filter((l) => l.itemId !== null && l.unitCents !== null).length}</b></div>
            <div><span className="bw-label">{O.excelNoPrice}</span><b>{ok.counts.noPrice}</b></div>
            <div><span className="bw-label">{O.excelNotIncl}</span><b>{ok.counts.notIncluded}</b></div>
            <div><span className="bw-label">{O.excelChanged}</span><b>{ok.counts.changed}</b></div>
            <div><span className="bw-label">{O.excelOwn}</span><b>{ok.counts.own}</b></div>
            <div><span className="bw-label">{O.excelMissing}</span><b>{ok.counts.missing}</b></div>
            <div><span className="bw-label">{O.excelErrors}</span><b>{ok.counts.errors}</b></div>
          </div>
          <p className="bw-muted">{O.excelHead(ok.header.number, ok.header.quoteDay !== null ? fmtDayNum(ok.header.quoteDay) : "–", ok.header.validUntil !== null ? fmtDayNum(ok.header.validUntil) : "–", ok.header.reverse ? t.common.yes : t.common.no)}{ok.header.discountBp !== null ? ` · ${P.discount} ${fmtBp(ok.header.discountBp)}` : ""}</p>
          {ok.flags.map((f) => <p key={f} className="a-note">{f}</p>)}
          {ok.counts.errors > 0 && <p className="a-err" role="alert">{O.excelErrorsBlock}</p>}
          <div className="bw-table-wrap">
            <table className="bw-table bw-table--stack">
              <thead><tr><th>{P.colPost}</th><th className="bw-right">{P.colQty}</th><th className="bw-right">{P.colPrice}</th><th>{O.colCheck}</th></tr></thead>
              <tbody>
                {ok.lines.map((l, k) => (
                  <tr key={k}>
                    <td data-label={P.colPost}><b>{l.description}</b>{l.remark && <span className="bw-muted vs-sub">{l.remark}</span>}</td>
                    <td data-label={P.colQty} className="bw-right bw-mono">{fmtQty(l.qtyMilli)} {unitOf(l.unit)}</td>
                    <td data-label={P.colPrice} className="bw-right bw-mono">{l.unitCents !== null ? fmtEuro(l.unitCents) : "—"}</td>
                    <td data-label={O.colCheck}>{l.error ? <span className="a-err">{l.error}</span> : l.flags.length ? <span className="oq-flag">{l.flags.map((f) => O.flag[f] ?? f).join(" · ")}</span> : <span className="bw-muted">✓</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── Met de hand (op een prijsvraag of los) ──────────────────────────────────
type HandLine = { itemId: bigint | null; desc: string; unit: string; qty: string; price: string; incl: "yes" | "no" | "alt"; remark: string };

const centsIn = (c: bigint | undefined) => (c === undefined ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));
const pctIn = (bp: bigint | undefined) => (bp === undefined ? "" : (Number(bp) / 100).toString().replace(".", ","));
const inclKey = (i: { __kind__: string }): HandLine["incl"] => (i.__kind__ === "no" ? "no" : i.__kind__ === "alt" ? "alt" : "yes");

/** De regels van het formulier uit een voorstel (3.8): de posten van de prijsvraag met de prijs uit het voorstel, daarna de eigen regels. */
function linesFrom(v: TenderView | null, inv: TenderInviteView | null, p: OaReadProposal): HandLine[] {
  const own = p.lines.filter((l) => l.itemId === undefined || !(v && inv)).map((l) => ({ itemId: null, desc: l.description, unit: l.unit, qty: fmtQty(l.qtyMilli), price: centsIn(l.unitCents), incl: inclKey(l.included), remark: l.remark }));
  if (!(v && inv)) return own.length ? own : [{ itemId: null, desc: "", unit: "", qty: "1", price: "", incl: "yes", remark: "" }];
  const posts = v.items.map((x) => {
    const l = p.lines.find((y) => y.itemId === x.id);
    return { itemId: x.id, desc: x.title, unit: x.unit, qty: l ? fmtQty(l.qtyMilli) : fmtQty(x.qtyMilli), price: l ? centsIn(l.unitCents) : "", incl: l ? inclKey(l.included) : ("yes" as const), remark: l?.remark ?? "" };
  });
  return [...posts, ...own];
}

export function HandSheet({ workId, v, inv, onClose, read, orgPreset }: { workId: bigint; v: TenderView | null; inv: TenderInviteView | null; onClose: () => void; read?: OaReadFull; orgPreset?: bigint }) {
  const pr = read?.proposal;
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  const loose = v === null || inv === null;
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching && loose });
  const [form, setForm] = useState<"posten" | "hoofdstukken" | "totaal">(pr && (pr.form === "hoofdstukken" || pr.form === "totaal") && v && inv ? pr.form : "posten");
  const [orgId, setOrgId] = useState(orgPreset !== undefined ? String(orgPreset) : "");
  const [no, setNo] = useState(pr?.number ?? "");
  const [day, setDay] = useState(dayToInput(pr?.quoteDay ?? todayDay()));
  const [valid, setValid] = useState(dayToInput(pr?.validUntil));
  const [disc, setDisc] = useState(pctIn(pr?.discountBp));
  const [rev, setRev] = useState(pr?.reverse ?? true);
  const [remark, setRemark] = useState("");
  const [note, setNote] = useState("");
  const [total, setTotal] = useState(centsIn(pr?.totalCents));
  const chapters = useMemo(() => [...new Set((v?.items ?? []).map((x) => x.chapter))], [v]);
  const [chs, setChs] = useState<Record<string, string>>(() => Object.fromEntries((pr?.chapterTotals ?? []).map(([n, c]) => [n, centsIn(c)])));
  const [lines, setLines] = useState<HandLine[]>(() => pr ? linesFrom(v, inv, pr) : (v && inv ? v.items.map((x) => ({ itemId: x.id, desc: x.title, unit: x.unit, qty: fmtQty(x.qtyMilli), price: "", incl: "yes" as const, remark: "" })) : [{ itemId: null, desc: "", unit: "", qty: "1", price: "", incl: "yes" as const, remark: "" }]));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const bp = parsePct(disc);
  const set = (k: number, p: Partial<HandLine>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...p } : l)));
  const incl = (l: HandLine): Included => (l.incl === "no" ? { no: null } : l.incl === "alt" ? { alt: l.remark } : { yes: null });
  // De prijzen en het netto zoals de server ze rekent.
  const calc = useMemo(() => {
    if (bp === null) return null;
    const dbp = bp === 0n ? null : bp;
    if (form === "totaal" && !loose) { const x = parseEuro(total); return x === null || x === undefined ? null : { net: x, prices: { __kind__: "total" as const, total: x } }; }
    if (form === "hoofdstukken" && !loose) {
      const out: [string, bigint][] = [];
      for (const ch of chapters) { const raw = chs[ch] ?? ""; if (raw.trim() === "") continue; const x = parseEuro(raw); if (x === null || x === undefined) return null; out.push([ch, x]); }
      if (out.length === 0) return null;
      const gross = out.reduce((s, [, x]) => s + x, 0n);
      return { net: gross - (dbp === null ? 0n : roundDiv(gross * dbp, 10_000n)), prices: { __kind__: "chapters" as const, chapters: out } };
    }
    const out: OaRegLine[] = [];
    const cl: { itemId: bigint | null; qtyMilli: bigint; unitCents: bigint | null; included: Included }[] = [];
    for (const l of lines) {
      const blank = l.price.trim() === "" && l.incl !== "no";
      if (l.itemId !== null && blank) continue; // post zonder prijs: niet ingevuld
      if (l.itemId === null && l.desc.trim() === "" && l.price.trim() === "") continue;
      const price = l.price.trim() === "" ? undefined : parseEuro(l.price);
      if (price === null) return null;
      const qty = parseQty(l.qty);
      if (qty === null) return null;
      out.push({ itemId: l.itemId ?? undefined, description: l.desc, unit: l.unit, qtyMilli: qty, unitCents: price ?? undefined, included: (l.incl === "no" ? { __kind__: "no", no: null } : l.incl === "alt" ? { __kind__: "alt", alt: l.remark } : { __kind__: "yes", yes: null }) as OaRegLine["included"], remark: l.remark });
      cl.push({ itemId: l.itemId, qtyMilli: qty, unitCents: price ?? null, included: incl(l) });
    }
    if (out.length === 0) return null;
    const chapterOf = (id: bigint) => v?.items.find((x) => x.id === id)?.chapter ?? "";
    const tt = totals(cl, dbp, chapterOf);
    return { net: tt.net, prices: { __kind__: "lines" as const, lines: out } };
  }, [form, total, chs, lines, bp, chapters, loose, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!calc && inputToDay(day) !== undefined && (!loose || orgId !== "");
  const save = async () => {
    if (!calc) return;
    setBusy(true);
    try {
      let f: OaQuoteInput["file"] = undefined;
      if (file) {
        const pf = await prepareUpload(file);
        if (pf.type !== "application/pdf") throw new Error(P.yourPdf);
        const b = new Uint8Array(await file.arrayBuffer());
        setProgress(0);
        f = { name: file.name, mime: "application/pdf", size: BigInt(b.length), blob: ExternalBlob.fromBytes(b, "application/pdf", file.name).withUploadProgress(setProgress) };
      }
      const input: OaQuoteInput = {
        inviteId: inv?.id, workId, orgId: inv ? inv.orgId : BigInt(orgId), source: OaQuoteSource.hand, sheetKey: "",
        number: no.trim(), quoteDay: inputToDay(day)!, validUntil: inputToDay(valid), discountBp: bp === null || bp === 0n || (!loose && form === "totaal") ? undefined : bp, reverse: rev,
        prices: calc.prices, remark, note, file: f,
      };
      // 3.8: met een voorstel in één keer registreren en de opdracht sluiten (het bestand van de opdracht hangt aan de offerte).
      if (read) unwrap(await actor!.applyOaRead(read.brief.id, input, calc.net));
      else unwrap(await actor!.registerOaQuote(input, calc.net));
      toast.show({ kind: "ok", text: O.handSaved });
      refresh();
      onClose();
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); } finally { setBusy(false); setProgress(null); }
  };
  const subs = (orgs.data ?? []).filter((o) => o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Sheet title={loose ? O.handLooseTitle : O.handTitle(inv!.orgName)} open onClose={onClose} side wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={() => void save()} data-testid="oq-hand-save">{progress !== null ? O.handFileBusy(progress) : O.handSave}</Button></>}>
      <p className="bw-muted">{loose ? O.handLooseLead : O.handLead}</p>
      {read && pr && <ReadBanner read={read} />}
      {loose && (
        <Field label={O.handFirm}>
          <select className="bw-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="oq-hand-org">
            <option value="">{O.handPick}</option>
            {subs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
        </Field>
      )}
      {!loose && <Field label={O.handForm}><Choice label={O.handForm} value={form} onChange={(x) => setForm(x)} options={(["posten", "hoofdstukken", "totaal"] as const).map((k) => ({ value: k, label: O.handForms[k] }))} /></Field>}
      <div className="a-grid2">
        <Field label={O.handNo}><input className="bw-input" value={no} maxLength={40} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label={O.handDay}><input className="bw-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label={O.handValid}><input className="bw-input" type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
        {(loose || form !== "totaal") && <Field label={O.handDiscount}><input className="bw-input bw-num" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>}
      </div>
      <label className="a-check"><input type="checkbox" checked={rev} onChange={(e) => setRev(e.target.checked)} /> {O.handReverse}</label>
      {!loose && form === "totaal" && <Field label={O.handTotal}><input className="bw-input bw-num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="oq-hand-total" /></Field>}
      {!loose && form === "hoofdstukken" && chapters.map((ch) => <Field key={ch} label={`${ch} · ${O.handChapter}`}><input className="bw-input bw-num" inputMode="decimal" value={chs[ch] ?? ""} onChange={(e) => setChs((x) => ({ ...x, [ch]: e.target.value }))} /></Field>)}
      {(loose || form === "posten") && (
        // flexShrink 0: in .bw-sheet__body (een flexkolom) kromp de tabel anders tot 0 px (in Chrome gezien bij 3.8; zelfde les als 3.13).
        <div className="bw-table-wrap" style={{ flexShrink: 0 }}>
          <table className="bw-table bw-table--stack pv-fill">
            <thead><tr><th>{P.colPost}</th><th className="bw-right">{O.handQty}</th><th className="bw-right">{O.handPrice}</th><th>{O.handIncluded}</th><th>{P.colRemark}</th></tr></thead>
            <tbody>
              {lines.map((l, k) => (
                <tr key={k}>
                  <td data-label={P.colPost}>{l.itemId !== null ? <b>{l.desc}</b> : <input className="bw-input" placeholder={O.handDesc} value={l.desc} onChange={(e) => set(k, { desc: e.target.value })} />}{l.itemId === null && <input className="bw-input pv-sm" placeholder={O.handUnit} value={l.unit} onChange={(e) => set(k, { unit: e.target.value })} />}</td>
                  <td data-label={O.handQty} className="bw-right">{l.itemId !== null ? <span className="bw-mono">{l.qty} {unitOf(l.unit)}</span> : <input className="bw-input bw-num pv-sm" inputMode="decimal" value={l.qty} onChange={(e) => set(k, { qty: e.target.value })} />}</td>
                  <td data-label={O.handPrice}><input className="bw-input bw-num pv-in" inputMode="decimal" value={l.price} onChange={(e) => set(k, { price: e.target.value })} data-testid="oq-hand-price" /></td>
                  <td data-label={O.handIncluded}><select className="bw-input" value={l.incl} onChange={(e) => set(k, { incl: e.target.value as HandLine["incl"] })}><option value="yes">{P.included.yes}</option><option value="no">{P.included.no}</option><option value="alt">{P.included.alt}</option></select></td>
                  <td data-label={P.colRemark}><input className="bw-input" value={l.remark} onChange={(e) => set(k, { remark: e.target.value })} />{l.itemId === null && <Button variant="quiet" onClick={() => setLines((ls) => ls.filter((_, i) => i !== k))}>{O.handRemove}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(loose || form === "posten") && <Button icon="plus" variant="quiet" onClick={() => setLines((ls) => [...ls, { itemId: null, desc: "", unit: "", qty: "1", price: "", incl: "yes", remark: "" }])}>{O.handAddLine}</Button>}
      <Field label={O.handRemark}><input className="bw-input" value={remark} onChange={(e) => setRemark(e.target.value)} /></Field>
      <Field label={O.handNote}><input className="bw-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {!read?.brief.fileId && <Field label={O.handFile}><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
      {calc ? <p className="bw-mono"><b>{O.handNet(fmtEuro(calc.net))}</b></p> : <p className="bw-muted">{O.handBad}</p>}
    </Sheet>
  );
}

// ── Vergelijken, kiezen, overnemen, afsluiten ───────────────────────────────
function cellText(c: CmpCell | undefined, unit: string): { main: string; sub: string; flag: string } {
  if (!c) return { main: O.cmpMissing, sub: "", flag: "" };
  switch (c.state) {
    case "prijs": {
      const flags: string[] = [];
      if (c.alt) flags.push(O.cmpAlt);
      if (c.unitChanged) flags.push(O.cmpUnit(unit));
      if (c.vhChanged) flags.push("VH ≠");
      if (c.deviates) {
        if (c.devLastBp !== undefined) flags.push(O.cmpDev(pctText(c.devLastBp), O.cmpDevLast));
        else if (c.devMedianBp !== undefined) flags.push(O.cmpDev(pctText(c.devMedianBp), O.cmpDevMedian));
      }
      return { main: fmtEuro(c.unitCents), sub: fmtEuro(c.amountCents), flag: flags.join(" · ") };
    }
    case "niet-inbegrepen": return { main: O.cmpNotIncl, sub: "", flag: "" };
    case "geen-prijs": return { main: O.cmpNoPrice, sub: "", flag: c.alt ? O.cmpAlt : "" };
    case "geen-detail": return { main: "", sub: "", flag: "" };
    default: return { main: O.cmpMissing, sub: "", flag: "" };
  }
}

function Compare({ tenderId, v }: { tenderId: bigint; v: TenderView }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const refresh = useRefresh();
  // Bedragen: update-call met auditregel (R38); enkel in het geheugen van dit paneel.
  const q = useQuery({ queryKey: ["tenderCompare", String(tenderId)], queryFn: async () => unwrap(await actor!.compareTender(tenderId)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const d = q.data;
  if (!d) return <Loading q={q} />;
  return <CompareBody key={`${String(d.rev)}-${d.choices.length}-${d.quotes.map((x) => String(x.quote.id)).join(",")}`} d={d} v={v} onSaved={() => { void q.refetch(); refresh(); }} toast={toast} />;
}

function CompareBody({ d, v, onSaved, toast }: { d: TenderCompareView; v: TenderView; onSaved: () => void; toast: ReturnType<typeof useToast> }) {
  const { actor } = useBackend();
  const init = () => new Map(d.choices.filter((c) => c.oaQuoteId !== undefined).map((c) => [String(c.itemId), c.oaQuoteId as bigint]));
  // 4b.3c: de keuzes en redenen staan in een geschiedenis, zodat het werkblad ze ongedaan kan maken (ze blijven lokaal tot Bewaren).
  type Keuze = { picks: Map<string, bigint>; reasons: Record<string, string> };
  const [gesch, setGesch] = useState<G.Geschiedenis<Keuze>>(() => G.begin({ picks: init(), reasons: Object.fromEntries(d.choices.map((c) => [String(c.itemId), c.reason])) }));
  const picks = gesch.nu.picks;
  const reasons = gesch.nu.reasons;
  const setPicks = (f: Map<string, bigint> | ((m: Map<string, bigint>) => Map<string, bigint>)) => setGesch((g) => G.zet(g, { ...g.nu, picks: typeof f === "function" ? f(g.nu.picks) : f }));
  const setReasons = (f: Record<string, string> | ((r: Record<string, string>) => Record<string, string>)) => setGesch((g) => G.zet(g, { ...g.nu, reasons: typeof f === "function" ? f(g.nu.reasons) : f }));
  const wide = useWerkvormKan();
  const [target, setTarget] = useState(d.drafts.length ? String(d.drafts[d.drafts.length - 1].versionId) : "");
  const [confirm, setConfirm] = useState<"apply" | "close" | null>(null);
  const [closeSel, setCloseSel] = useState<bigint[]>([]);
  // De browser rekent na (G4); de keuze rekent hij live met dezelfde module.
  const input = d.input as unknown as CInput;
  const mine: CResult = useMemo(() => compare(input), [input]);
  const mismatch = !sameResult(mine, d.calc as unknown as CResult);
  const live = useMemo(() => compare({ ...input, picks: [...picks.entries()].map(([itemId, oaQuoteId]) => ({ itemId: BigInt(itemId), oaQuoteId })) }), [input, picks]);
  const quotes = d.quotes;
  const cellOf = (itemId: bigint, qid: bigint) => d.calc.cells.find((c) => c.itemId === itemId && c.oaQuoteId === qid);
  const chapters = [...new Set(d.items.map((x) => x.chapter))];
  const saved = init();
  const dirty = picks.size !== saved.size || [...picks.entries()].some(([k, x]) => saved.get(k) !== x) || d.choices.some((c) => (reasons[String(c.itemId)] ?? "") !== c.reason) || [...picks.keys()].some((k) => !d.choices.some((c) => String(c.itemId) === k) && (reasons[k] ?? "") !== "");
  const pickable = (c: CmpCell | undefined) => !!c && c.state === "prijs" && !c.unitChanged;
  const pickChapter = (ch: string, qid: bigint) => d.status.__kind__ === "open" && setPicks((m) => { const n = new Map(m); for (const x of d.items.filter((y) => y.chapter === ch)) { if (pickable(cellOf(x.id, qid))) n.set(String(x.id), qid); } return n; });
  const pickItem = (itemId: bigint, qid: bigint) => d.status.__kind__ === "open" && setPicks((m) => { const n = new Map(m); if (n.get(String(itemId)) === qid) n.delete(String(itemId)); else n.set(String(itemId), qid); return n; });
  const nonLowest = d.items.filter((x) => { const qid = picks.get(String(x.id)); if (qid === undefined) return false; const c = cellOf(x.id, qid); return !!c && !c.lowest && d.calc.cells.some((y) => y.itemId === x.id && y.lowest); });
  const firmOf = (qid: bigint) => quotes.find((x) => x.quote.id === qid)?.quote.orgName ?? "";
  const stale = d.choices.filter((c) => c.stale).length;
  const save = useMutation({
    mutationFn: async () => {
      const ps = d.items.filter((x) => picks.has(String(x.id)) || d.choices.some((c) => c.itemId === x.id)).map((x) => ({ itemId: x.id, oaQuoteId: picks.get(String(x.id)), reason: reasons[String(x.id)] ?? "" }));
      return unwrap(await actor!.saveTenderChoices(d.tenderId, ps));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: O.cmpSaved }); onSaved(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const apply = useMutation({
    mutationFn: async () => unwrap(await actor!.applyTenderChoices(d.tenderId, BigInt(target))),
    onSuccess: (r) => { toast.show({ kind: "ok", text: O.cmpApplied(Number(r.lines), Number(r.libCosts)) }); if (r.skipped.length) toast.show({ kind: "error", text: `${O.cmpSkipped}: ${r.skipped.join("; ")}` }); setConfirm(null); onSaved(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const close = useMutation({
    mutationFn: async () => unwrap(await actor!.updateTender(d.tenderId, d.rev, { __kind__: "close", close: closeSel })),
    onSuccess: () => { toast.show({ kind: "ok", text: O.cmpClosed }); setConfirm(null); onSaved(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  // De firma's met een keuze per post zijn sowieso gekozen (de server neemt ze mee): hun vinkje staat vast.
  const fixedInv = new Set<string>();
  for (const qid of picks.values()) { const iq = quotes.find((x) => x.quote.id === qid)?.quote.inviteId; if (iq !== undefined) fixedInv.add(String(iq)); }
  const openClose = () => { setCloseSel(d.invites.filter((i) => fixedInv.has(String(i.id))).map((i) => i.id)); setConfirm("close"); };
  const pdf = async () => {
    try {
      const [{ comparePdf }, { loadPdfFonts }] = await Promise.all([import("../pdf/vergelijking.ts"), import("../pdf/fonts.ts")]);
      const tot = (k: number) => d.calc.quotes[k];
      const lowT = (qid: bigint) => d.calc.lowestTotal.includes(qid);
      const bytes = await comparePdf({
        code: d.code, title: d.title, work: `${v.workCode} ${v.workName}`, made: fmtTime(BigInt(Date.now()) * 1_000_000n),
        firms: quotes.map((x) => ({ name: x.quote.orgName, meta: [x.quote.number, fmtDayNum(x.quote.quoteDay), O.version(Number(x.quote.version)), x.quote.byBot ? O.byBot : O.source[x.quote.source] ?? ""].filter(Boolean).join(" · ") })),
        rows: d.items.map((x) => {
          const pick = picks.get(String(x.id));
          return {
            chapter: x.chapter, code: x.code, title: x.title, qty: `${fmtQty(x.qtyMilli)} ${unitOf(x.unit)}`,
            cells: quotes.map((qq) => { const c = cellOf(x.id, qq.quote.id); const tx = cellText(c, x.unit); return { main: tx.main, sub: tx.sub, flag: tx.flag, lowest: !!c?.lowest, chosen: pick === qq.quote.id }; }),
            choice: pick !== undefined ? firmOf(pick) : "", reason: reasons[String(x.id)] ?? "",
          };
        }),
        chapterSums: chapters.map((ch) => ({ chapter: ch, sum: { label: ch, values: quotes.map((_, k) => { const c = tot(k).chapters.find(([n]) => n === ch); return c ? fmtEuro(c[1]) : "—"; }), lowest: quotes.map((qq) => d.calc.chapters.find((c) => c.chapter === ch)?.lowest.includes(qq.quote.id) ?? false) } })),
        totals: [
          { label: O.cmpOwn, values: quotes.map((_, k) => fmtEuro(tot(k).ownCents)), lowest: quotes.map(() => false) },
          { label: O.cmpGross, values: quotes.map((_, k) => fmtEuro(tot(k).gross)), lowest: quotes.map(() => false) },
          { label: O.cmpDiscount, values: quotes.map((_, k) => fmtEuro(tot(k).discount)), lowest: quotes.map(() => false) },
          { label: O.cmpNet, values: quotes.map((_, k) => fmtEuro(tot(k).net)), lowest: quotes.map((qq) => lowT(qq.quote.id)) },
          { label: O.cmpComplete, values: quotes.map((_, k) => (d.input.quotes[k].form === "posten" ? O.cmpCompleteN(Number(tot(k).priced), Number(tot(k).items)) : d.input.quotes[k].form === "hoofdstukken" ? O.cmpCompleteChapters : O.cmpCompleteTotal)), lowest: quotes.map(() => false) },
        ],
        choice: O.cmpChoice(Number(live.choice.chosen), d.items.length, fmtEuro(live.choice.total)),
        legend: O.cmpLegend,
      }, await loadPdfFonts());
      download(bytes, `Vergelijking ${d.code.replace(/\//g, "-")} (vertrouwelijk).pdf`, "application/pdf");
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); }
  };
  if (quotes.length === 0) return <p className="a-empty">{O.cmpNoQuotes}</p>;
  const open = d.status.__kind__ === "open";
  const closed = d.status.__kind__ === "closed";
  const dialogs = (
    <>
      <Confirm open={confirm === "apply"} title={O.cmpApplyTitle} text={O.cmpApplyText(Number(d.drafts.find((x) => String(x.versionId) === target)?.version ?? 0n))} confirmLabel={O.cmpApply} busy={apply.isPending} onConfirm={() => apply.mutate()} onClose={() => setConfirm(null)} />
      {confirm === "close" && (
        <Sheet title={O.cmpCloseTitle} open onClose={() => setConfirm(null)} side footer={<><Button onClick={() => setConfirm(null)}>{t.common.cancel}</Button><Button variant="primary" busy={close.isPending} onClick={() => close.mutate()} data-testid="oq-close-ok">{O.cmpClose}</Button></>}>
          <p>{O.cmpCloseLead}</p>
          {d.invites.map((i) => { const fixed = fixedInv.has(String(i.id)); return <label key={String(i.id)} className="a-check"><input type="checkbox" checked={fixed || closeSel.includes(i.id)} disabled={fixed} onChange={(e) => setCloseSel((x) => (e.target.checked ? [...x, i.id] : x.filter((y) => y !== i.id)))} /> {i.orgName} <span className="bw-muted">({P.invite[i.status]}{fixed ? ` · ${O.cmpCloseFixed}` : ""})</span></label>; })}
          <p className="a-note">{O.cmpCloseMsg[d.thanksMode] ?? d.thanksMode}</p>
        </Sheet>
      )}
    </>
  );
  if (wide) {
    return (
      <>
        <CompareBlad d={d} v={v} quotes={quotes} chapters={chapters} picks={picks} reasons={reasons} setReasons={setReasons} pickItem={pickItem} pickChapter={pickChapter} pickable={pickable} cellOf={cellOf}
          live={live} mismatch={mismatch} stale={stale} dirty={dirty} open={open} nonLowest={nonLowest} firmOf={firmOf} target={target} setTarget={setTarget} setConfirm={setConfirm} openClose={openClose}
          save={() => save.mutate()} saving={save.isPending} pdf={() => void pdf()} gesch={gesch} setGesch={setGesch}
          onUse={(m, rs) => { setPicks(m); setReasons((r) => ({ ...r, ...rs })); }} />
        {dialogs}
      </>
    );
  }
  return (
    <div className="pv-detail" data-testid="oq-cmp">
      <p className="bw-muted">{O.cmpLead}</p>
      {mismatch && <p className="a-err" role="alert" data-testid="oq-mismatch">{O.cmpMismatch}</p>}
      {stale > 0 && <p className="a-note">{O.cmpStale(stale)}</p>}
      <div className="bw-table-wrap">
        <table className="bw-table oq-matrix" data-testid="oq-matrix">
          <thead>
            <tr><th>{P.colNr}</th><th>{O.cmpPost}</th><th className="bw-right">{O.cmpQty}</th>{quotes.map((x) => <th key={String(x.quote.id)} className="bw-right">{x.quote.orgName}<span className="oq-sub">{[x.quote.number, O.version(Number(x.quote.version)), x.quote.byBot ? O.byBot : O.source[x.quote.source]].filter(Boolean).join(" · ")}</span></th>)}</tr>
          </thead>
          <tbody>
            {chapters.map((ch) => (
              <ChapterRows key={ch} ch={ch} d={d} picks={picks} onChapter={pickChapter} onItem={pickItem} pickable={pickable} cellOf={cellOf} />
            ))}
            {[["own", O.cmpOwn], ["gross", O.cmpGross], ["discount", O.cmpDiscount], ["net", O.cmpNet], ["complete", O.cmpComplete]].map(([k, lab]) => (
              <tr key={k} className="oq-sum">
                <td colSpan={3}><b>{lab}</b></td>
                {d.calc.quotes.map((tq, i) => {
                  const val = k === "own" ? fmtEuro(tq.ownCents) : k === "gross" ? fmtEuro(tq.gross) : k === "discount" ? fmtEuro(tq.discount) : k === "net" ? fmtEuro(tq.net) : d.input.quotes[i].form === "posten" ? O.cmpCompleteN(Number(tq.priced), Number(tq.items)) : tq.chapters.length ? O.cmpCompleteChapters : O.cmpCompleteTotal;
                  return <td key={String(tq.oaQuoteId)} className={`bw-right bw-mono ${k === "net" && d.calc.lowestTotal.includes(tq.oaQuoteId) ? "oq-low" : ""}`}>{val}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nonLowest.length > 0 && (
        <details open>
          <summary>{O.cmpReasons}</summary>
          {nonLowest.map((x) => <Field key={String(x.id)} label={`${x.code ? `${x.code} ` : ""}${x.title} · ${O.chosenOf(firmOf(picks.get(String(x.id))!))}`}><input className="bw-input" maxLength={300} value={reasons[String(x.id)] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [String(x.id)]: e.target.value }))} /></Field>)}
        </details>
      )}
      {(() => { const n = d.history.filter((x) => !x.current).length; return n > 0 ? <p className="bw-muted">{O.cmpHistory(n)}</p> : null; })()}
      <TenderCheckPanel tenderId={d.tenderId} items={d.items} drafts={d.drafts} target0={target} isOpen={open} onUse={(m, rs) => { setPicks(m); setReasons((r) => ({ ...r, ...rs })); }} />
      <div className="oq-bar">
        <span className="bw-mono" data-testid="oq-choice">{O.cmpChoice(Number(live.choice.chosen), d.items.length, fmtEuro(live.choice.total))}</span>
        {dirty && <span className="a-tag a-tag--warn">{O.cmpUnsaved}</span>}
        {!open && <span className="bw-muted">{O.cmpFixed}</span>}
        {open && <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate()} data-testid="oq-save">{O.cmpSave}</Button>}
        {!open ? null : d.drafts.length > 0 ? (
          <>
            <select className="bw-input pv-sm" aria-label={O.cmpApplyTo} value={target} onChange={(e) => setTarget(e.target.value)}>{d.drafts.map((x) => <option key={String(x.versionId)} value={String(x.versionId)}>{t.offertes.version(Number(x.version))}</option>)}</select>
            <Button disabled={dirty || picks.size === 0 || stale > 0} onClick={() => setConfirm("apply")} data-testid="oq-apply">{O.cmpApply}</Button>
          </>
        ) : <span className="bw-muted">{O.cmpApplyNone}</span>}
        <Button variant="quiet" onClick={() => void pdf()} data-testid="oq-pdf">{O.cmpPdf}</Button>
        {open && <Button variant="quiet" disabled={dirty || stale > 0} onClick={openClose} data-testid="oq-close">{O.cmpClose}</Button>}
      </div>
      {dialogs}
    </div>
  );
}

function ChapterRows({ ch, d, picks, onChapter, onItem, pickable, cellOf }: { ch: string; d: TenderCompareView; picks: Map<string, bigint>; onChapter: (ch: string, qid: bigint) => void; onItem: (itemId: bigint, qid: bigint) => void; pickable: (c: CmpCell | undefined) => boolean; cellOf: (itemId: bigint, qid: bigint) => CmpCell | undefined }) {
  const items = d.items.filter((x) => x.chapter === ch);
  const low = d.calc.chapters.find((c) => c.chapter === ch)?.lowest ?? [];
  return (
    <>
      <tr className="oq-ch">
        <td colSpan={3}>{ch || "—"}</td>
        {d.quotes.map((x, k) => {
          const v = d.calc.quotes[k].chapters.find(([n]) => n === ch);
          const can = items.some((y) => pickable(cellOf(y.id, x.quote.id)));
          return (
            <td key={String(x.quote.id)} className={`bw-right ${low.includes(x.quote.id) ? "oq-low" : ""}`}>
              <span className="bw-mono">{v ? fmtEuro(v[1]) : "—"}</span>
              {can && <Button variant="quiet" onClick={() => onChapter(ch, x.quote.id)} data-testid="oq-pick-ch">{O.cmpChapterPick(x.quote.orgName)}</Button>}
            </td>
          );
        })}
      </tr>
      {items.map((x) => (
        <tr key={String(x.id)}>
          <td className="bw-mono">{x.code}</td>
          <td>{x.title}{x.subgroup ? <span className="oq-sub">{x.subgroup}</span> : null}</td>
          <td className="bw-right bw-mono">{fmtQty(x.qtyMilli)} {unitOf(x.unit)}</td>
          {d.quotes.map((qq, qi) => {
            const c = cellOf(x.id, qq.quote.id);
            const line = d.input.quotes[qi].lines.find((l) => l.itemId === x.id);
            const tx = cellText(c, line?.unit ?? "");
            const chosen = picks.get(String(x.id)) === qq.quote.id;
            const can = pickable(c);
            return (
              <td key={String(qq.quote.id)} className={`oq-cell ${can ? "oq-cell--pick" : ""} ${c?.lowest ? "oq-low" : ""} ${chosen ? "oq-chosen" : ""}`} onClick={can ? () => onItem(x.id, qq.quote.id) : undefined} title={can ? O.chosenOf(qq.quote.orgName) : undefined} data-testid="oq-cell">
                <span className="bw-mono">{tx.main}</span>
                {tx.sub && <span className="oq-sub bw-mono">{tx.sub}</span>}
                {c?.vhChanged && line && <span className="oq-flag">{O.cmpVh(`${fmtQty(line.qtyMilli)} ${unitOf(line.unit)}`)}</span>}
                {tx.flag && <span className="oq-flag">{tx.flag}</span>}
                {line?.remark && <span className="oq-sub">{line.remark}</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// ── Beheer → Opmeting & facturatie → Prijsvragen ────────────────────────────
export function TenderSettingsAdmin() {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const cur = useQuery({ queryKey: ["tenderSettings"], queryFn: () => actor!.tenderSettings(), enabled: !!actor && !isFetching });
  const [form, setForm] = useState<{ deadline: string; remind: string; thanks: string; dev: string } | null>(null);
  const f = form ?? (cur.data ? { deadline: String(cur.data.deadlineDays), remind: String(cur.data.remindDays), thanks: cur.data.thanksMode, dev: (Number(cur.data.deviationBp) / 100).toLocaleString("nl-BE") } : null);
  const dev = f ? parsePct(f.dev) : null;
  const dl = f ? Number(f.deadline) : 0;
  const rm = f ? Number(f.remind) : 0;
  const valid = !!f && Number.isInteger(dl) && dl >= 1 && dl <= 60 && Number.isInteger(rm) && rm >= 0 && (rm === 0 || rm < dl) && dev !== null && dev >= 100n && dev <= 10_000n;
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.saveTenderSettings({ deadlineDays: BigInt(dl), remindDays: BigInt(rm), thanksMode: f!.thanks, deviationBp: dev! })),
    onSuccess: () => { toast.show({ kind: "ok", text: O.setSaved }); setForm(null); void qc.invalidateQueries({ queryKey: ["tenderSettings"] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <section className="a-section a-form" style={{ maxWidth: 560 }} data-testid="tender-settings">
      <h2 className="bw-h2">{O.setTitle}</h2>
      <p className="bw-muted">{O.setLead}</p>
      <Loading q={cur} />
      {f && (
        <>
          <div className="a-grid2">
            <Field label={O.setDeadline}><input className="bw-input bw-num" inputMode="numeric" value={f.deadline} onChange={(e) => setForm({ ...f, deadline: e.target.value })} /></Field>
            <Field label={O.setRemind}><input className="bw-input bw-num" inputMode="numeric" value={f.remind} onChange={(e) => setForm({ ...f, remind: e.target.value })} /></Field>
          </div>
          <Field label={O.setThanks}><Choice label={O.setThanks} value={f.thanks} onChange={(x) => setForm({ ...f, thanks: x })} options={["melding", "mail", "niets"].map((k) => ({ value: k, label: O.setThanksOpts[k] }))} /></Field>
          <Field label={O.setDeviation}><input className="bw-input bw-num" inputMode="decimal" value={f.dev} onChange={(e) => setForm({ ...f, dev: e.target.value })} /></Field>
          {!valid && <p className="a-err" role="alert">{O.setBad}</p>}
          <div><Button variant="primary" busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{O.setSave}</Button></div>
        </>
      )}
    </section>
  );
}

// ── 4b.3c: vergelijken als werkblad (inhoud · raster · paneel van de post · totalen onderaan) ──────────────────────────
type BladProps = {
  d: TenderCompareView; v: TenderView; quotes: TenderCompareView["quotes"]; chapters: string[];
  picks: Map<string, bigint>; reasons: Record<string, string>; setReasons: (f: (r: Record<string, string>) => Record<string, string>) => void;
  pickItem: (itemId: bigint, qid: bigint) => void; pickChapter: (ch: string, qid: bigint) => void; pickable: (c: CmpCell | undefined) => boolean;
  cellOf: (itemId: bigint, qid: bigint) => CmpCell | undefined; live: CResult; mismatch: boolean; stale: number; dirty: boolean; open: boolean;
  nonLowest: TenderCompareView["items"]; firmOf: (qid: bigint) => string; target: string; setTarget: (s: string) => void;
  setConfirm: (c: "apply" | "close" | null) => void; openClose: () => void; save: () => void; saving: boolean; pdf: () => void;
  gesch: G.Geschiedenis<{ picks: Map<string, bigint>; reasons: Record<string, string> }>;
  setGesch: (f: (g: G.Geschiedenis<{ picks: Map<string, bigint>; reasons: Record<string, string> }>) => G.Geschiedenis<{ picks: Map<string, bigint>; reasons: Record<string, string> }>) => void;
  onUse: (m: Map<string, bigint>, rs: Record<string, string>) => void;
};

function CompareBlad(p: BladProps) {
  const { d, v, quotes, chapters, picks, cellOf } = p;
  const W = t.werkvorm;
  const [cur, setCur] = useState<string | null>(null);
  const [tab, setTab] = useState("lijn");
  const raster = useRef<HTMLDivElement>(null);
  const vorm = useRef<WerkvormHandle>(null);
  // Ctrl+Z / Ctrl+Shift+Z (enkel de keuzes; typen in een veld blijft van de browser).
  const terug = useRef(p);
  terug.current = p;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (!(e.metaKey || e.ctrlKey) || (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); terug.current.setGesch(G.ongedaan); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); terug.current.setGesch(G.opnieuw); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const item = cur ? d.items.find((x) => String(x.id) === cur) ?? null : null;
  const kolommen = `76px minmax(220px, 1fr) 96px ${quotes.map(() => "140px").join(" ")}`;
  const springNaar = (ch: string) => {
    const el = raster.current?.querySelector<HTMLElement>(`[data-ch="${CSS.escape(ch)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.add("rb-flits");
    window.setTimeout(() => el.classList.remove("rb-flits"), 1600);
  };
  const keuzeTekst = O.cmpChoice(Number(p.live.choice.chosen), d.items.length, fmtEuro(p.live.choice.total));
  const lijnPaneel = !item ? <p className="bw-muted">{W.cmp.kiesLijn}</p> : (
    <div className="rb-lijn" data-testid="oq-lijn">
      <div className="rb-lijn__kop"><b>{item.code ? `${item.code} ` : ""}{item.title}</b><span className="bw-muted">{fmtQty(item.qtyMilli)} {unitOf(item.unit)}{item.subgroup ? ` · ${item.subgroup}` : ""}</span></div>
      <div className="rb-blok">
        <h4>{W.cmp.perFirma}</h4>
        {quotes.map((qq, qi) => {
          const c = cellOf(item.id, qq.quote.id);
          const line = d.input.quotes[qi].lines.find((l) => l.itemId === item.id);
          const tx = cellText(c, line?.unit ?? item.unit);
          const gekozen = picks.get(String(item.id)) === qq.quote.id;
          const can = p.pickable(c);
          return (
            <div key={String(qq.quote.id)} className={`rb-bron${gekozen ? " rb-bron--gekozen" : ""}`}>
              <span><b>{qq.quote.orgName}</b>{c?.lowest && <Tag tone="ok">{W.cmp.laagste}</Tag>}{gekozen && <Tag tone="accent">{W.cmp.gekozen}</Tag>}</span>
              <span className="bw-mono">{tx.main || "—"}</span>
              <small>{[tx.sub, tx.flag, line?.remark].filter(Boolean).join(" · ")}</small>
              {p.open && can && <Button size="sm" variant={gekozen ? "quiet" : "secondary"} onClick={() => p.pickItem(item.id, qq.quote.id)}>{gekozen ? W.cmp.weg : W.cmp.kies}</Button>}
            </div>
          );
        })}
      </div>
      {p.nonLowest.some((x) => x.id === item.id) && picks.get(String(item.id)) !== undefined && (
        <label className="bw-field rb-veld"><span className="bw-label">{W.cmp.reden}</span>
          <ReasonField key={String(item.id)} value={p.reasons[String(item.id)] ?? ""} readOnly={!p.open} onCommit={(s) => p.setReasons((r) => ({ ...r, [String(item.id)]: s }))} />
        </label>
      )}
    </div>
  );
  return (
    <Werkvorm ref={vorm} testid="oq-blad" rasterRef={raster} tab={tab} onTab={setTab} rasterLabel={O.cmpPost} kolommen={kolommen} hint={W.sneltoets}
      kop={<>
        <div className="rb-kop__titel"><span className="bw-label">{v.workCode} {v.workName}</span><h1 className="rb-h1">{d.code} · {d.title}</h1></div>
        <Tag tone={p.open ? "accent" : "neutral"}>{P.status[d.status.__kind__] ?? d.status.__kind__}</Tag>
        <span className="rb-status" role="status">{p.dirty ? <Tag tone="warn">{O.cmpUnsaved}</Tag> : !p.open ? O.cmpFixed : ""}</span>
        {p.open && <Terug kan={p.gesch.terug.length > 0} kanVooruit={p.gesch.vooruit.length > 0} ongedaan={() => p.setGesch(G.ongedaan)} opnieuw={() => p.setGesch(G.opnieuw)} />}
        <span className="rb-kop__vul" />
        {p.open && d.drafts.length > 0 && (
          <>
            <select className="bw-input pv-sm" aria-label={O.cmpApplyTo} value={p.target} onChange={(e) => p.setTarget(e.target.value)}>{d.drafts.map((x) => <option key={String(x.versionId)} value={String(x.versionId)}>{t.offertes.version(Number(x.version))}</option>)}</select>
            <Button size="sm" disabled={p.dirty || picks.size === 0 || p.stale > 0} onClick={() => p.setConfirm("apply")} data-testid="oq-apply">{O.cmpApply}</Button>
          </>
        )}
        {p.open && d.drafts.length === 0 && <span className="bw-muted">{O.cmpApplyNone}</span>}
        <Meer size="sm" items={[
          { label: O.cmpPdf, icon: "doc", onClick: p.pdf, testid: "oq-pdf" },
          p.open && { label: O.cmpClose, disabled: p.dirty || p.stale > 0, onClick: p.openClose, testid: "oq-close" },
        ]} />
        {p.open && <Button variant="primary" size="sm" busy={p.saving} disabled={!p.dirty} onClick={p.save} data-testid="oq-save">{O.cmpSave}</Button>}
      </>}
      melding={<>
        {p.mismatch && <p className="rb-melding a-err" role="alert" data-testid="oq-mismatch">{O.cmpMismatch}</p>}
        {p.stale > 0 && <p className="rb-melding">{O.cmpStale(p.stale)}</p>}
      </>}
      inhoud={{
        titel: W.inhoud, onKies: springNaar,
        items: chapters.map((ch) => {
          const its = d.items.filter((x) => x.chapter === ch);
          return { key: ch, titel: ch || "—", sub: `${its.filter((x) => picks.has(String(x.id))).length}/${its.length}` };
        }),
      }}
      tabs={[
        { key: "lijn", label: W.cmp.tabLijn, inhoud: lijnPaneel },
        { key: "nalezen", label: W.cmp.tabNalezen, inhoud: <TenderCheckPanel tenderId={d.tenderId} items={d.items} drafts={d.drafts} target0={p.target} isOpen={p.open} onUse={p.onUse} /> },
      ]}
      totalen={<>
        {d.calc.quotes.map((tq, i) => {
          const qq = quotes[i];
          const laagste = d.calc.lowestTotal.includes(tq.oaQuoteId);
          const regels = [
            { label: O.cmpOwn, waarde: fmtEuro(tq.ownCents) }, { label: O.cmpGross, waarde: fmtEuro(tq.gross) }, { label: O.cmpDiscount, waarde: fmtEuro(tq.discount) },
            { label: O.cmpNet, waarde: fmtEuro(tq.net), totaal: true },
            { label: O.cmpComplete, waarde: d.input.quotes[i].form === "posten" ? O.cmpCompleteN(Number(tq.priced), Number(tq.items)) : tq.chapters.length ? O.cmpCompleteChapters : O.cmpCompleteTotal },
          ];
          return (
            <span key={String(tq.oaQuoteId)} className={laagste ? "wv-laagste" : undefined}>
              <small>{qq.quote.orgName}</small>
              <Cijfer naam={`${qq.quote.orgName} · ${O.cmpNet}`} uitleg={O.cmpLead} regels={regels}><b className="bw-mono" data-testid="oq-net">{fmtEuro(tq.net)}</b></Cijfer>
            </span>
          );
        })}
        <Totaal label={W.cmp.keuze} groot><span data-testid="oq-choice">{p.live.choice.chosen > 0 ? keuzeTekst : W.cmp.geenKeuze}</span></Totaal>
      </>}>
      <RasterKop kolommen={[{ label: W.cmp.kolomNr }, { label: O.cmpPost }, { label: O.cmpQty, num: true }, ...quotes.map((x) => ({ label: x.quote.orgName, num: true }))]} />
      {chapters.map((ch) => {
        const its = d.items.filter((x) => x.chapter === ch);
        const low = d.calc.chapters.find((c) => c.chapter === ch)?.lowest ?? [];
        return (
          <section key={ch} className="rb-ch" data-ch={ch}>
            <RasterRij kop>
              <span style={{ gridColumn: "1 / span 3", padding: "0 8px" }}><b>{ch || "—"}</b></span>
              {quotes.map((x, k) => {
                const tv = d.calc.quotes[k].chapters.find(([n]) => n === ch);
                const can = p.open && its.some((y) => p.pickable(cellOf(y.id, x.quote.id)));
                return (
                  <span key={String(x.quote.id)} className={`rb-rt${low.includes(x.quote.id) ? " wv-laagste" : ""}`}>
                    <span className="bw-mono">{tv ? fmtEuro(tv[1]) : "—"}</span>
                    {can && <button type="button" className="bw-btn bw-btn--quiet bw-btn--sm" title={O.cmpChapterPick(x.quote.orgName)} aria-label={O.cmpChapterPick(x.quote.orgName)} onClick={() => p.pickChapter(ch, x.quote.id)} data-testid="oq-pick-ch">{W.cmp.kiesKort}</button>}
                  </span>
                );
              })}
            </RasterRij>
            {its.map((x) => (
              <RasterRij key={String(x.id)} gekozen={cur === String(x.id)} onKies={() => setCur(String(x.id))} testid="oq-rij">
                <span className="bw-mono">{x.code}</span>
                <span className="rb-titel__t" title={x.title}>{x.title}{x.subgroup ? ` · ${x.subgroup}` : ""}</span>
                <span className="rb-rt bw-mono">{fmtQty(x.qtyMilli)} {unitOf(x.unit)}</span>
                {quotes.map((qq, qi) => {
                  const c = cellOf(x.id, qq.quote.id);
                  const line = d.input.quotes[qi].lines.find((l) => l.itemId === x.id);
                  const tx = cellText(c, line?.unit ?? "");
                  const gekozen = picks.get(String(x.id)) === qq.quote.id;
                  const can = p.open && p.pickable(c);
                  return (
                    <button key={String(qq.quote.id)} type="button" disabled={!can} tabIndex={-1}
                      className={`wv-cel${can ? " wv-cel--pick" : ""}${c?.lowest ? " wv-laagste" : ""}${gekozen ? " wv-gekozen" : ""}`}
                      title={tx.flag || undefined} data-testid="oq-cell"
                      onClick={(e) => { e.stopPropagation(); setCur(String(x.id)); p.pickItem(x.id, qq.quote.id); }}>
                      <span className="bw-mono">{tx.main}</span>{tx.flag && <i aria-hidden className="wv-vlag" />}
                    </button>
                  );
                })}
              </RasterRij>
            ))}
          </section>
        );
      })}
    </Werkvorm>
  );
}

/** Een tekstveld dat zijn waarde pas bewaart als je het verlaat (één stap ongedaan maken per reden). */
function ReasonField({ value, onCommit, readOnly }: { value: string; onCommit: (s: string) => void; readOnly: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="bw-input" maxLength={300} readOnly={readOnly} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }} />;
}
