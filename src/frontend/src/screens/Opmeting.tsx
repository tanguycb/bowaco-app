// Opmeting ter plaatse (stap 2.9, bouwplan §5.1, §8.3): per werf de posten van de getekende offerte opmeten op de gsm. Per
// post: de gemeten hoeveelheid (deelopmetingen tellen op), datum en wie mat, een notitie, foto's of een schets, en het verschil
// met de VH met een markering boven de drempel. Alles wat je bewaart gaat eerst naar de wachtrij van de gsm (offline/outbox.tsx,
// dezelfde als het werfverslag) en vandaar naar de backend zodra er bereik is. Hoeveelheden, nooit een prijs.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeasureEntryView, MeasureOp, MeasurePostView, MeasureSummaryView, SurveyBrief, SurveyDetail, MeasureWorkBrief } from "../backend";
import { Button, Icon, Info, Sheet, useToast } from "../design";
import { blobUrlOf, useCached } from "../offline/cached";
import { useOutbox, type QueuedOp } from "../offline/outbox";
import { shrink } from "../offline/photos";
import { t } from "../texts/nl";
import { errText, fmtDay, fmtDayNum, inputToDay, dayToInput, todayDay, useBackend } from "../util";
import { EmptyState, Frame, Loading, Page } from "./common";

const T = t.opmeting;

// ── Hoeveelheden (duizendsten) en verschillen ──
export function parseQty(s: string): bigint | null {
  const v = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,3})?$/.test(v)) return null;
  const neg = v.startsWith("-");
  const [i, d = ""] = v.replace("-", "").split(".");
  const m = BigInt(i) * 1000n + BigInt((d + "000").slice(0, 3));
  return neg ? -m : m;
}
export function fmtQty(m: bigint): string {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const whole = (a / 1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (a % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "−" : ""}${whole}${frac ? "," + frac : ""}`;
}
export function fmtSigned(m: bigint): string {
  return m > 0n ? `+${fmtQty(m)}` : fmtQty(m);
}
export function fmtPct(bp: bigint | undefined): string {
  if (bp === undefined) return "–";
  const n = Number(bp) / 100;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("nl-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
const thresholdText = (bp: bigint) => `${(Number(bp) / 100).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} %`;
const unitOf = (p: { unit: string }) => p.unit;
const flagKey = (f: unknown): string => (typeof f === "string" ? f : "none");
const flagClass = (f: string) => (f === "more" ? "a-tag--warn" : f === "less" ? "a-tag--accent" : "");
const keyOf = (x: bigint) => String(x);

/** Een wachtende (nog niet verzonden) opdracht van de opmeting voor deze werf. */
const measureOps = (ops: QueuedOp[], workId: bigint) => ops.filter((o) => o.channel === "measure" && o.workId === workId);

// ═════════════ Lijst van werven ═════════════
export function OpmetingPage({ go, route }: { go: (to: string) => void; route: string[] }) {
  if (route[1] && /^\d+$/.test(route[1])) return <OpmetingWerf key={route[1]} workId={BigInt(route[1])} go={go} />;
  return <OpmetingLijst go={go} />;
}

function OpmetingLijst({ go }: { go: (to: string) => void }) {
  const { actor } = useBackend();
  const q = useCached<MeasureWorkBrief[]>(["measureWorks"], () => actor!.listMeasureWorks());
  const list = q.data?.value ?? [];
  return (
    <Page title={T.title} label={T.label}>
      <p className="bw-muted">{T.lead}<Info text={t.uitleg.opmeting} label={t.uitleg.label} /></p>
      <Loading q={q} />
      {q.data?.fromCache && <p className="m-banner"><Icon name="offline" size={18} />{T.offlineStand(new Date(q.data.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }))}</p>}
      {q.data && list.length === 0 && <EmptyState title={t.leeg.opmeting.t} text={t.leeg.opmeting.d} action={<Button onClick={() => go("werven/lopend")}>{t.nav.werven}</Button>} />}
      <ul className="a-list">
        {list.map((w) => (
          <li key={keyOf(w.workId)}>
            <button type="button" className="a-list__btn" onClick={() => go(`werven/${w.workId}/opmeting`)}>
              <span className="a-tag">{w.code}</span>
              <span className="a-list__main">
                <b>{w.name}</b>
                <span className="bw-muted">
                  {T.measured(Number(w.measuredPosts), Number(w.posts))}
                  {w.openSurveyNumber !== undefined ? ` · ${T.surveyNr(w.openSurveyNumber)} ${T.openWord}` : ""}
                </span>
                {(w.moreCount > 0n || w.lessCount > 0n || w.pending > 0n) && (
                  <span className="a-row">
                    {w.moreCount > 0n && <span className="a-tag a-tag--warn">{T.more(Number(w.moreCount))}</span>}
                    {w.lessCount > 0n && <span className="a-tag a-tag--accent">{T.less(Number(w.lessCount))}</span>}
                    {w.pending > 0n && <span className="a-tag a-tag--warn">{T.proposals(Number(w.pending))}</span>}
                  </span>
                )}
              </span>
              <Icon name="next" size={18} />
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}

// ═════════════ Eén werf ═════════════
/** De opmeting van één werf; 2b.3: ook als tabblad Opmeting van de werf (embedded, zonder eigen kop). */
export function OpmetingWerf({ workId, go, embedded }: { workId: bigint; go: (to: string) => void; embedded?: boolean }) {
  const { actor } = useBackend();
  const ob = useOutbox();
  const toast = useToast();
  const qc = useQueryClient();
  const sum = useCached<MeasureSummaryView>(["measureSummary", keyOf(workId)], () => actor!.measureSummary(workId));
  const s = sum.data?.value;
  const [pick, setPick] = useState<bigint | null>(null); // root van de gekozen post
  const [filter, setFilter] = useState("");
  const [closing, setClosing] = useState(false);
  const [viewSurvey, setViewSurvey] = useState<bigint | null>(null);
  const waiting = measureOps(ob.ops, workId);

  const open = s?.openSurveyId;
  const detail = useQuery({
    queryKey: ["measureSurvey", keyOf(workId), open === undefined ? "" : keyOf(open)],
    queryFn: () => actor!.getMeasureSurvey(open!),
    enabled: !!actor && open !== undefined && !!s?.canReview,
    retry: 0,
  });
  const proposals = (detail.data?.entries ?? []).filter((e) => e.status === "voorstel" && !e.archived);

  const posts = s?.posts ?? [];
  const f = filter.trim().toLowerCase();
  const shown = f ? posts.filter((p) => `${p.title} ${p.code} ${p.chapterTitle}`.toLowerCase().includes(f)) : posts;
  const chapters = useMemo(() => {
    const m = new Map<string, MeasurePostView[]>();
    for (const p of shown) {
      const k = `${p.chapterCode} ${p.chapterTitle}`.trim() || "–";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()];
  }, [shown]);
  const waitFor = (p: MeasurePostView) => waiting.filter((o) => o.payload.__kind__ === "entry" && (o.payload as Extract<MeasureOp, { __kind__: "entry" }>).entry.lineId === p.lineId);
  const picked = posts.find((p) => p.root === pick);

  const send = async (op: MeasureOp, label: string, extra?: Parameters<typeof ob.enqueue>[0]["attachments"]) => {
    try {
      const clientKey = await ob.ensureSurvey(workId, T.openLabel(s?.workCode ?? ""));
      await ob.enqueue({ clientKey, workId, day: 0n, channel: "measure", label, op, attachments: extra });
      toast.show({ kind: "ok", text: ob.online ? T.saved : T.savedQueued });
      return true;
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
      return false;
    }
  };

  if (!s) {
    return (
      <Frame embedded={embedded} title={T.title} label={T.label}>
        <Loading q={sum} />
        {!embedded && <Button variant="quiet" icon="back" onClick={() => go("opmeting")}>{T.title}</Button>}
      </Frame>
    );
  }
  const closedSurveys = s.surveys.filter((x) => !x.open);
  const openSurvey = s.surveys.find((x) => x.open);
  return (
    <Frame embedded={embedded} title={`${s.workCode} · ${s.workName}`} label={T.label} actions={embedded ? undefined : <Button variant="quiet" icon="back" onClick={() => go("opmeting")}>{T.title}</Button>}>
      {sum.data?.fromCache && <p className="m-banner"><Icon name="offline" size={18} />{T.offlineStand(new Date(sum.data.at).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }))}</p>}
      <div className="om-head">
        <span className="bw-muted">{s.scope === "firm" ? T.scope.firm(s.orgName) : s.scope === "closed" ? T.scope.closed : T.scope.full}</span>
        <span className="a-row">
          <span className="a-tag">{openSurvey ? `${T.surveyNr(openSurvey.number)} · ${T.openFrom(fmtDay(openSurvey.openedAt))}` : T.noOpen}</span>
          <span className="a-tag">{T.threshold(thresholdText(s.thresholdBp))}</span>
          {s.quotes.map((q) => <span key={q} className="a-tag">{q}</span>)}
        </span>
        {s.note && <p className="a-empty">{s.note === "geen getekende offerte" ? T.noQuote : T.noFirmPosts}</p>}
        {s.canPropose && <p className="bw-muted">{T.proposeLead}</p>}
      </div>
      <div className="om-totals">
        <span>{T.measuredLong(Number(s.totals.measuredPosts), Number(s.totals.posts))}</span>
        {s.totals.moreCount > 0n && <span className="a-tag a-tag--warn">{T.more(Number(s.totals.moreCount))}</span>}
        {s.totals.lessCount > 0n && <span className="a-tag a-tag--accent">{T.less(Number(s.totals.lessCount))}</span>}
        {s.totals.openProposals > 0n && <span className="a-tag a-tag--warn">{T.proposals(Number(s.totals.openProposals))}</span>}
        {waiting.length > 0 && <span className="m-tag m-tag--warn"><Icon name="clock" size={12} />{waiting.length} {T.waitTag}</span>}
      </div>

      {s.canReview && proposals.length > 0 && (
        <section className="om-proposals">
          <h2 className="bw-h2">{T.review}</h2>
          {proposals.map((e) => (
            <ProposalCard key={keyOf(e.id)} e={e} post={posts.find((p) => p.root === e.root)} onApprove={() => void send({ __kind__: "review", review: { entryId: e.id, ok: true, note: "" } }, `${T.approve}: ${e.byName}`)} onDecline={(why) => send({ __kind__: "review", review: { entryId: e.id, ok: false, note: why } }, `${T.decline}: ${e.byName}`)} />
          ))}
        </section>
      )}

      {posts.length > 0 && (
        <label className="bw-field om-filter">
          <span className="bw-label">{T.filter}</span>
          <input className="bw-input" value={filter} placeholder={T.filterPh} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}
      {chapters.map(([ch, ps]) => (
        <section key={ch} className="om-chapter">
          <h2 className="bw-label">{ch}</h2>
          <ul className="om-posts">
            {ps.map((p) => {
              const fl = flagKey(p.flag);
              const wait = waitFor(p);
              return (
                <li key={keyOf(p.root)}>
                  <button type="button" className={`om-post om-post--${fl}`} onClick={() => setPick(p.root)}>
                    <span className="om-post__main">
                      <b>{p.title}</b>
                      <span className="bw-muted">
                        {p.code ? `${p.code} · ` : ""}{T.vh} {fmtQty(p.vhMilli)} {unitOf(p)}
                        {p.option ? ` · ${T.option}` : ""}{!p.inOffer ? ` · ${T.notInOffer}` : ""}
                      </span>
                    </span>
                    <span className="om-post__nums">
                      <span className="bw-num om-post__got">{p.entryCount > 0n || p.pendingCount > 0n ? `${fmtQty(p.measuredMilli)} ${unitOf(p)}` : "–"}</span>
                      {p.entryCount > 0n && (
                        <span className={`bw-num om-post__diff ${flagClass(fl)}`}>
                          {fmtSigned(p.diffMilli)} · {fmtPct(p.diffBp)}
                        </span>
                      )}
                      <span className="om-post__tags">
                        {fl !== "none" && <span className={`a-tag ${flagClass(fl)}`}>{T.flag[fl]}</span>}
                        {p.complete && <span className="a-tag a-tag--ok">{T.complete}</span>}
                        {p.pendingCount > 0n && <span className="a-tag a-tag--warn" data-testid="om-pending">{T.pendingTag} ({String(p.pendingCount)}){p.pendingMilli !== 0n ? ` · ${T.proposedQty(`${fmtSigned(p.pendingMilli)} ${unitOf(p)}`)}` : ""}</span>}
                        {wait.length > 0 && <span className="m-tag m-tag--warn"><Icon name="clock" size={12} />{T.waitTag}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {s.canReview && openSurvey && (
        <div className="om-close">
          <Button variant="primary" icon="check" onClick={() => setClosing(true)}>{T.close}</Button>
        </div>
      )}

      {closedSurveys.length > 0 && (
        <section className="om-prev">
          <h2 className="bw-h2">{T.previous}</h2>
          <ul className="a-list">
            {closedSurveys.map((x) => (
              <li key={keyOf(x.id)}>
                <button type="button" className="a-list__btn" onClick={() => setViewSurvey(x.id)}>
                  <span className="a-tag">{T.surveyNr(x.number)}</span>
                  <span className="a-list__main"><b>{T.closedAt(fmtDay(x.closedAt), x.closedByName)}</b>{x.closeNote && <span className="bw-muted">{x.closeNote}</span>}</span>
                  <Icon name="next" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picked && <PostSheet key={keyOf(picked.root)} workId={workId} post={picked} summary={s} send={send} onClose={() => setPick(null)} />}
      {closing && openSurvey && (
        <CloseSheet survey={openSurvey} blocked={s.totals.openProposals > 0n} onClose={() => setClosing(false)} onDo={async (note) => {
          if (await send({ __kind__: "close", close: { note } }, `${T.close}: ${s.workCode}`)) {
            setClosing(false);
            void qc.invalidateQueries({ queryKey: ["measureSummary"] });
          }
        }} />
      )}
      {viewSurvey !== null && <SurveySheet surveyId={viewSurvey} onClose={() => setViewSurvey(null)} />}
    </Frame>
  );
}

// ═════════════ Voorstel van een onderaannemer ═════════════
function ProposalCard({ e, post, onApprove, onDecline }: { e: MeasureEntryView; post?: MeasurePostView; onApprove: () => void; onDecline: (why: string) => Promise<boolean> }) {
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  return (
    <div className="om-prop">
      <div className="m-line__head"><b>{post?.title ?? `#${e.root}`}</b><span className="a-tag a-tag--warn">{e.proposedByOrg}</span></div>
      <span className="bw-num">{fmtQty(e.qtyMilli)} {post?.unit ?? ""} · {T.by(e.byName, fmtDayNum(e.day))}</span>
      {e.note && <span className="bw-muted">{e.note}</span>}
      <Files e={e} />
      {declining ? (
        <>
          <label className="bw-field"><span className="bw-label">{T.declineReason}</span><textarea className="bw-input" rows={2} value={why} maxLength={1000} onChange={(x) => setWhy(x.target.value)} /></label>
          <div className="a-row">
            <Button onClick={() => setDeclining(false)}>{t.common.cancel}</Button>
            <Button variant="danger" disabled={!why.trim()} onClick={async () => { if (await onDecline(why.trim())) setDeclining(false); }}>{T.decline}</Button>
          </div>
        </>
      ) : (
        <div className="a-row">
          <Button variant="primary" icon="check" onClick={onApprove}>{T.approve}</Button>
          <Button onClick={() => setDeclining(true)}>{T.decline}</Button>
        </div>
      )}
    </div>
  );
}

function Files({ e }: { e: MeasureEntryView }) {
  const [big, setBig] = useState<string | null>(null);
  if (e.files.length === 0) return null;
  return (
    <>
      <div className="om-files">
        {e.files.map((f, i) => {
          const thumb = blobUrlOf((f.thumb ?? f.file).blob);
          const full = blobUrlOf(f.file.blob);
          return (
            <button key={i} type="button" className="om-file" onClick={() => full && setBig(full)} aria-label={f.caption || (f.role === "sketch" ? T.sketch : t.common.photo)}>
              {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="camera" size={20} />}
              <span className="om-file__tag">{f.role === "sketch" ? T.sketch : f.caption || t.common.photo}</span>
            </button>
          );
        })}
      </div>
      {big && (
        <Sheet title={t.common.photo} open onClose={() => setBig(null)}>
          <img src={big} alt="" className="m-bigphoto" />
        </Sheet>
      )}
    </>
  );
}

// ═════════════ Een post: geschiedenis + invoer ═════════════
type Draft = { photos: { blob: Blob; thumb: Blob; url: string; sketch: boolean }[] };

function PostSheet({ workId, post, summary, send, onClose }: { workId: bigint; post: MeasurePostView; summary: MeasureSummaryView; send: (op: MeasureOp, label: string, att?: Parameters<ReturnType<typeof useOutbox>["enqueue"]>[0]["attachments"]) => Promise<boolean>; onClose: () => void }) {
  const { actor } = useBackend();
  const detail = useQuery({ queryKey: ["measurePost", keyOf(workId), keyOf(post.root)], queryFn: () => actor!.measurePost(workId, post.root), enabled: !!actor && summary.scope !== "closed", retry: 0 });
  const [qty, setQty] = useState("");
  const [day, setDay] = useState(dayToInput(todayDay()));
  const [complete, setComplete] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Draft["photos"]>([]);
  const [busy, setBusy] = useState(false);
  const [sketching, setSketching] = useState(false);
  const [correcting, setCorrecting] = useState<MeasureEntryView | null>(null);
  const [error, setError] = useState("");
  const q = parseQty(qty);
  const canWrite = summary.canWrite;
  const toast = useToast();
  const preview = q !== null ? post.measuredMilli + q : null;

  const addPhotos = async (list: File[]) => {
    for (const f of list) {
      try {
        const s = await shrink(f);
        setFiles((x) => [...x, { blob: s.full, thumb: s.thumb, url: URL.createObjectURL(s.thumb), sketch: false }]);
      } catch (e) {
        toast.show({ kind: "error", text: errText(e) });
      }
    }
  };
  const att = () => files.map((x, i) => ({
    blob: x.blob,
    thumb: { blob: x.thumb, name: `${x.sketch ? "schets" : "foto"}-${Date.now()}-${i}-t.jpg`, mime: "image/jpeg" },
    role: (x.sketch ? "sketch" : "photo") as "photo" | "sketch",
    name: `${x.sketch ? "schets" : "foto"}-${Date.now()}-${i}.jpg`,
    mime: "image/jpeg",
    caption: x.sketch ? T.sketch : "",
  }));
  const tooMany = files.filter((x) => !x.sketch).length > 6 || files.filter((x) => x.sketch).length > 1;
  const dayN = inputToDay(day);
  const dayOk = dayN !== undefined && dayN >= todayDay() - 60n && dayN <= todayDay() + 1n;

  const save = async () => {
    if (q === null) return setError(T.qtyBad);
    if (!dayOk) return setError(T.dayBad);
    if (tooMany) return setError(T.tooMany);
    setBusy(true);
    setError("");
    const ok = await send(
      { __kind__: "entry", entry: { lineId: post.lineId, qtyMilli: q, day: dayN!, complete, note: note.trim(), files: [], corrects: undefined, reason: "" } },
      `${post.title}: ${fmtQty(q)} ${post.unit}`,
      files.length ? att() : undefined,
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet title={post.title} open onClose={onClose}
      footer={canWrite ? <Button variant="primary" size="lg" icon="check" busy={busy} disabled={q === null || !dayOk || tooMany} onClick={() => void save()}>{summary.canPropose ? T.propose : T.addLine}</Button> : undefined}>
      <div className="om-facts">
        <span className="a-tag">{T.vh} {fmtQty(post.vhMilli)} {post.unit}</span>
        <span className="a-tag">{T.gemeten} {fmtQty(post.measuredMilli)} {post.unit}</span>
        {post.entryCount > 0n && <span className={`a-tag ${flagClass(flagKey(post.flag))}`}>{fmtSigned(post.diffMilli)} · {fmtPct(post.diffBp)}</span>}
        {post.complete ? <span className="a-tag a-tag--ok">{T.complete}</span> : post.entryCount > 0n ? <span className="a-tag">{T.notComplete}</span> : null}
      </div>
      {canWrite && (
        <>
          {summary.canPropose && <p className="bw-muted">{T.proposeLead}</p>}
          <label className="bw-field">
            <span className="bw-label">{T.qty(post.unit)}</span>
            <input id="om-qty" className="bw-input om-qty" inputMode="decimal" autoComplete="off" value={qty} placeholder="0" onChange={(e) => { setQty(e.target.value); setError(""); }} />
            <small className="bw-muted">{T.qtyHint}</small>
          </label>
          {preview !== null && <p className="om-preview bw-num">{T.after(fmtQty(preview), fmtPct(post.vhMilli === 0n ? undefined : ((preview - post.vhMilli) * 10000n) / (post.vhMilli < 0n ? -post.vhMilli : post.vhMilli)), post.unit)}</p>}
          <div className="m-two">
            <label className="bw-field"><span className="bw-label">{T.day}</span><input id="om-day" type="date" className="bw-input" value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <button type="button" className="m-check" aria-pressed={complete} onClick={() => setComplete((c) => !c)}>
              <span className="m-check__box">{complete && <Icon name="check" size={18} />}</span>
              <span>{T.completeBox}</span>
            </button>
          </div>
          <label className="bw-field"><span className="bw-label">{T.note}</span><textarea id="om-note" className="bw-input" rows={2} value={note} maxLength={1000} placeholder={T.notePh} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="bw-field">
            <span className="bw-label">{T.photos}</span>
            <div className="om-files">
              <label className="om-file om-file--add">
                <Icon name="camera" size={26} />{T.takePhoto}
                <input type="file" accept="image/*" capture="environment" multiple aria-label={T.takePhoto} onChange={(e) => { const l = Array.from(e.target.files ?? []); if (l.length) void addPhotos(l); e.target.value = ""; }} />
              </label>
              <button type="button" className="om-file om-file--add" onClick={() => setSketching(true)}><Icon name="edit" size={26} />{T.sketchAdd}</button>
              {files.map((x, i) => (
                <div key={i} className="om-file">
                  <img src={x.url} alt="" />
                  <span className="om-file__tag">{x.sketch ? T.sketch : t.common.photo}</span>
                  <button type="button" className="om-file__x" aria-label={T.removeFile} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
            <small className="bw-muted">{T.sketchPaper}</small>
          </div>
          {error && <p className="a-err" role="alert"><Icon name="alert" size={16} /> {error}</p>}
        </>
      )}
      <h3 className="bw-h2 om-hist">{T.history}</h3>
      {summary.scope === "closed" && <p className="bw-muted">{T.scope.closed}</p>}
      {detail.isLoading && <p className="bw-muted">{t.common.loading}</p>}
      {detail.error && summary.scope !== "closed" && <p className="bw-muted">{errText(detail.error)}</p>}
      {detail.data && detail.data.entries.length === 0 && <p className="a-empty">{T.noLines}</p>}
      {detail.data && detail.data.post.entryCount >= 0n && detail.data.text && <details className="om-text"><summary>{post.title}</summary><p>{detail.data.text}</p></details>}
      <ul className="om-entries">
        {(detail.data?.entries ?? []).map((e) => (
          <li key={keyOf(e.id)} className={`om-entry${e.archived ? " om-entry--gone" : ""}${e.superseded ? " om-entry--old" : ""}`}>
            <div className="m-line__head">
              <b className="bw-num">{fmtQty(e.qtyMilli)} {post.unit}</b>
              <span className="a-row">
                {e.corrects !== undefined && <span className="a-tag a-tag--accent">{T.correction}</span>}
                {e.status !== "geldig" && <span className={`a-tag ${e.status === "afgewezen" ? "a-tag--bad" : "a-tag--warn"}`}>{T.status[e.status] ?? e.status}</span>}
                {e.superseded && <span className="a-tag">{T.superseded}</span>}
                {e.archived && <span className="a-tag a-tag--bad">{T.removed}</span>}
                {e.complete && <span className="a-tag a-tag--ok">{T.complete}</span>}
                <span className="a-tag">{T.surveyNr(e.surveyNumber)}{e.surveyClosed ? "" : " · open"}</span>
              </span>
            </div>
            <span className="bw-muted">{T.by(e.byName, fmtDayNum(e.day))}{e.corrects !== undefined ? ` · ${T.contributes(fmtSigned(e.contributionMilli))}` : ""}</span>
            {e.proposedByOrg && <span className="bw-muted">{e.proposedByOrg}</span>}
            {e.note && <span>{e.note}</span>}
            {e.reason && <span className="bw-muted">{T.reasonLabel}: {e.reason}</span>}
            {e.reviewNote && <span className="bw-muted">{e.reviewedByName}: {e.reviewNote}</span>}
            <Files e={e} />
            <div className="a-row">
              {e.canCorrect && canWrite && <Button onClick={() => setCorrecting(e)}>{T.correct}</Button>}
              {e.canRemove && canWrite && <Button variant="quiet" onClick={() => void send({ __kind__: "remove", remove: { entryId: e.id } }, `${T.remove}: ${post.title}`)}>{T.remove}</Button>}
            </div>
          </li>
        ))}
      </ul>
      {sketching && <SketchSheet onClose={() => setSketching(false)} onSave={(blob) => { void (async () => { const s = await shrink(new File([blob], "schets.jpg", { type: "image/jpeg" })); setFiles((x) => [...x.filter((y) => !y.sketch), { blob: s.full, thumb: s.thumb, url: URL.createObjectURL(s.thumb), sketch: true }]); setSketching(false); })(); }} />}
      {correcting && <CorrectSheet e={correcting} post={post} onClose={() => setCorrecting(null)} onSave={async (value, reason) => {
        const ok = await send({ __kind__: "entry", entry: { lineId: post.lineId, qtyMilli: value, day: todayDay(), complete: correcting.complete, note: "", files: [], corrects: correcting.id, reason } }, `${T.correct}: ${post.title} → ${fmtQty(value)} ${post.unit}`);
        if (ok) { setCorrecting(null); onClose(); }
      }} />}
    </Sheet>
  );
}

function CorrectSheet({ e, post, onClose, onSave }: { e: MeasureEntryView; post: MeasurePostView; onClose: () => void; onSave: (v: bigint, reason: string) => Promise<void> }) {
  const [qty, setQty] = useState(fmtQty(e.qtyMilli).replace(/\./g, "").replace("−", "-"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const q = parseQty(qty);
  return (
    <Sheet title={T.correctTitle} open onClose={onClose}
      footer={<Button variant="primary" icon="check" busy={busy} disabled={q === null || !reason.trim()} onClick={async () => { setBusy(true); await onSave(q!, reason.trim()); setBusy(false); }}>{T.correctSave}</Button>}>
      <p className="bw-muted">{T.correctLead}</p>
      <p className="bw-num">{T.by(e.byName, fmtDayNum(e.day))}: <b>{fmtQty(e.qtyMilli)} {post.unit}</b></p>
      <label className="bw-field"><span className="bw-label">{T.correctQty(post.unit)}</span><input id="om-corr-qty" className="bw-input om-qty" inputMode="decimal" value={qty} onChange={(x) => setQty(x.target.value)} /></label>
      <label className="bw-field"><span className="bw-label">{T.reason}</span><textarea id="om-corr-reason" className="bw-input" rows={3} maxLength={1000} value={reason} placeholder={T.reasonPh} onChange={(x) => setReason(x.target.value)} /></label>
      {q === null && <p className="a-err" role="alert"><Icon name="alert" size={16} /> {T.qtyBad}</p>}
    </Sheet>
  );
}

function CloseSheet({ survey, blocked, onClose, onDo }: { survey: SurveyBrief; blocked: boolean; onClose: () => void; onDo: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={T.closeTitle(survey.number)} open onClose={onClose}
      footer={<Button variant="primary" icon="check" busy={busy} disabled={blocked || survey.entryCount === 0n} onClick={async () => { setBusy(true); await onDo(note.trim()); setBusy(false); }}>{T.closeDo}</Button>}>
      <p>{T.closeLead}</p>
      {blocked && <p className="a-err" role="alert"><Icon name="alert" size={16} /> {T.closeBlocked}</p>}
      {survey.entryCount === 0n && <p className="a-err" role="alert"><Icon name="alert" size={16} /> {T.closeEmpty}</p>}
      <label className="bw-field"><span className="bw-label">{T.closeNote}</span><textarea className="bw-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Sheet>
  );
}

// ═════════════ Een afgesloten opmeting bekijken ═════════════
function SurveySheet({ surveyId, onClose }: { surveyId: bigint; onClose: () => void }) {
  const { actor } = useBackend();
  const q = useQuery<SurveyDetail>({ queryKey: ["measureSurvey", "x", keyOf(surveyId)], queryFn: () => actor!.getMeasureSurvey(surveyId), enabled: !!actor, retry: 0 });
  const d = q.data;
  return (
    <Sheet title={d ? T.surveyTitle(d.survey.number) : T.title} open onClose={onClose} wide>
      <Loading q={q} />
      {d && (
        <>
          <p className="bw-muted">{T.closedAt(fmtDay(d.survey.closedAt), d.survey.closedByName)}{d.survey.thresholdBp !== undefined ? ` · ${T.thresholdThen(thresholdText(d.survey.thresholdBp))}` : ""}</p>
          {d.survey.closeNote && <p>{d.survey.closeNote}</p>}
          <h3 className="bw-h2">{T.snapshot}</h3>
          <div className="om-snap">
            <div className="om-snap__row om-snap__row--head"><span>{T.colPost}</span><span>{T.snapCols.vh}</span><span>{T.snapCols.total}</span><span>{T.snapCols.delta}</span><span>{T.snapCols.diff}</span></div>
            {d.snapshot.map((x) => {
              const fl = flagKey(x.flag);
              return (
                <div key={keyOf(x.root)} className="om-snap__row">
                  <span><b>{x.title}</b><small className="bw-muted"> {x.code}</small></span>
                  <span className="bw-num">{fmtQty(x.vhMilli)} {x.unit}</span>
                  <span className="bw-num">{fmtQty(x.measuredMilli)} {x.unit}</span>
                  <span className="bw-num">{fmtSigned(x.deltaMilli)}</span>
                  <span className={`bw-num ${flagClass(fl)}`}>{x.measuredMilli === 0n && x.deltaMilli === 0n && !x.complete ? "–" : `${fmtSigned(x.diffMilli)} · ${fmtPct(x.diffBp)}${fl !== "none" ? ` · ${T.flag[fl]}` : ""}`}</span>
                </div>
              );
            })}
          </div>
          {d.entries.length > 0 && (
            <>
              <h3 className="bw-h2">{T.surveyLines}</h3>
              <ul className="om-entries">
                {d.entries.filter((e) => !e.archived).map((e) => (
                  <li key={keyOf(e.id)} className="om-entry">
                    <div className="m-line__head"><b className="bw-num">{fmtQty(e.qtyMilli)}</b><span className="bw-muted">{T.by(e.byName, fmtDayNum(e.day))}</span></div>
                    {e.note && <span>{e.note}</span>}
                    {e.reason && <span className="bw-muted">{T.reasonLabel}: {e.reason}</span>}
                    <Files e={e} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ═════════════ Eenvoudige schets op het scherm ═════════════
type Pt = { x: number; y: number };

function SketchSheet({ onClose, onSave }: { onClose: () => void; onSave: (jpeg: Blob) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const cur = useRef<Pt[] | null>(null);
  const [n, setN] = useState(0);
  const W = 1000;
  const H = 750;

  const paint = () => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    // raster van 50 px (een ruwe maatstok, de schets blijft vrij)
    g.strokeStyle = "#e5e7ec";
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 50) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = "#101114";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      if (s.length === 0) continue;
      g.beginPath();
      g.moveTo(s[0].x, s[0].y);
      if (s.length === 1) g.lineTo(s[0].x + 0.1, s[0].y);
      for (const p of s.slice(1)) g.lineTo(p.x, p.y);
      g.stroke();
    }
  };
  useEffect(paint, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = requestAnimationFrame(paint); return () => cancelAnimationFrame(id); }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  return (
    <Sheet title={T.sketchTitle} open onClose={onClose}
      footer={<><Button variant="quiet" onClick={() => { strokes.current.pop(); setN((x) => x + 1); }} disabled={n === 0 && strokes.current.length === 0}>{T.sketchUndo}</Button><Button onClick={() => { strokes.current = []; setN((x) => x + 1); }}>{T.sketchClear}</Button><Button variant="primary" icon="check" onClick={() => ref.current?.toBlob((b) => b && onSave(b), "image/jpeg", 0.85)}>{T.sketchSave}</Button></>}>
      <p className="bw-muted">{T.sketchLead}</p>
      <canvas
        ref={ref}
        width={W}
        height={H}
        className="om-canvas"
        aria-label={T.sketchTitle}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = [at(e)]; paint(); }}
        onPointerMove={(e) => { if (cur.current) { cur.current.push(at(e)); paint(); } }}
        onPointerUp={() => { if (cur.current) { strokes.current.push(cur.current); cur.current = null; setN((x) => x + 1); } }}
        onPointerCancel={() => { cur.current = null; paint(); }}
      />
    </Sheet>
  );
}
