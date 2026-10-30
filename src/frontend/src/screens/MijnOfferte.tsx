// Mijn offerte (stap 2.7, bouwplan §9 rij 2.7 ⚖): het scherm van de klant (rol klant, lid van de werf, Internet Identity). Hij ziet
// de VERZONDEN versies van de offertes van zijn werf met enkel de verkoopprijzen (nooit een aankoopprijs of een marge), kan de PDF
// downloaden en klikt "Akkoord" op de exacte versie die hij zag. Dat akkoord geldt voor die versie (hash) en niet voor een latere;
// daarna staat ze vast. Wat hij ziet komt uit een update-call met een auditregel (bekeek:offerte-klant).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QuoteKind, QuoteLineKind, QuoteStatus, type MyQuoteBrief, type MyQuoteRead } from "../backend";
import { Button, Icon, Info, Sheet, useToast } from "../design";
import { makePdf, pdfName } from "../pdf/adapt.ts";
import { pdfFromMine } from "../pdf/adapt.ts";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, unwrap, useBackend } from "../util";
import { EmptyState, Frame, Loading, Page } from "./common";
import { fmtQty } from "./Offertes";

const T = t.mijnOfferte;
const statusWord = (s: QuoteStatus) => t.offertes.status[s] ?? s;
const statusTag = (s: QuoteStatus) => (s === QuoteStatus.accepted ? "a-tag--ok" : s === QuoteStatus.rejected || s === QuoteStatus.withdrawn ? "a-tag--bad" : s === QuoteStatus.sent ? "a-tag--accent" : "");

export function MijnOffertePage({ go, route }: { go: (to: string) => void; route: string[] }) {
  if (route[1] && /^\d+$/.test(route[1])) return <MyQuote key={route[1]} versionId={BigInt(route[1])} go={go} />;
  return <MyQuotes go={go} />;
}

/** De offertes van de klant; 2b.3: in het tabblad Offerte van zijn werf enkel die van die werf (workName). */
export function MyQuotes({ go, embedded, workName }: { go: (to: string) => void; embedded?: boolean; workName?: string }) {
  const { actor, isFetching } = useBackend();
  const list = useQuery({ queryKey: ["myQuotes"], queryFn: () => actor!.listMyQuotes(), enabled: !!actor && !isFetching });
  const rows: MyQuoteBrief[] = (list.data ?? []).filter((x) => workName === undefined || x.workName === workName);
  return (
    <Frame embedded={embedded} label={T.label} title={T.title}>
      <p className="bw-muted" style={{ maxWidth: 680 }}>{T.lead}</p>
      <Loading q={list} />
      {list.data && rows.length === 0 && <EmptyState title={t.leeg.mijnWerf.t} text={t.leeg.mijnWerf.d} />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="my-quotes">
          {rows.map((x) => (
            <li key={String(x.versionId)}>
              <button type="button" className="a-list__btn" onClick={() => go(`mijn-offerte/${x.versionId}`)}>
                <span className="a-tag">{x.number}</span>
                <span className="a-list__main">
                  <b>{x.title}</b>
                  <span className="bw-muted">{x.workName} · {t.offertes.version(x.version)} · {T.sentOn(fmtTime(x.sentAt))}{x.newerExists ? ` · ${T.replaced}` : ""}</span>
                </span>
                <span className={`a-tag ${statusTag(x.status)}`}>{statusWord(x.status)}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function MyQuote({ versionId, go }: { versionId: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["myQuote", String(versionId)], queryFn: async () => unwrap(await actor!.readMyQuote(versionId)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const [sheet, setSheet] = useState<null | "accept" | "decline">(null);
  const [busy, setBusy] = useState(false);
  const r = q.data;
  const list = useQuery({ queryKey: ["myQuotes"], queryFn: () => actor!.listMyQuotes(), enabled: !!actor && !isFetching && !!r?.newerExists });
  const newer = r && list.data ? list.data.find((x) => x.quoteId === r.quoteId && x.version > r.version) : undefined;

  const pdf = async (open: boolean) => {
    if (!r) return;
    try {
      const d = pdfFromMine(r);
      const blob = await makePdf(d);
      const url = URL.createObjectURL(blob);
      if (open) window.open(url, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = pdfName(d);
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  };

  const answer = async (accept: boolean, note: string) => {
    if (!r) return;
    setBusy(true);
    try {
      if (accept) unwrap(await actor!.acceptMyQuote(r.versionId, r.hash));
      else unwrap(await actor!.declineMyQuote(r.versionId, r.hash, note));
      toast.show({ kind: "ok", text: accept ? T.accepted : T.declined });
      setSheet(null);
      void qc.invalidateQueries({ queryKey: ["myQuotes"] });
      await q.refetch();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (q.error) return <Page label={T.label} title={T.title}><p className="a-err" role="alert">{errText(q.error)}</p><Button icon="back" onClick={() => go("mijn-offerte")}>{t.common.back}</Button></Page>;
  if (!r) return <Page label={T.label} title={T.title}><p className="bw-muted">{t.common.loading}</p></Page>;
  const opts = r.lines.filter((l) => l.kind === QuoteLineKind.option);
  const chOf = (id: bigint) => r.chapters.find((c) => c.id === id);
  // 2c.1: subgroepen per hoofdstuk, tekstblokken, korting, regietekst en soort (enkel een versie met de nieuwe rekenregels).
  const f = r.form;
  const subOf = new Map((f?.lineSubgroups ?? []).map(([l, g]) => [String(l), String(g)]));
  const blocksAt = (place: string) => (f?.blocks ?? []).filter((b) => (b.place.__kind__ === "chapter" ? b.place.chapter : b.place.__kind__) === place).map((b) => (
    <section key={b.key} className="mq-block" data-testid={`mq-block-${b.key}`}>{b.title && <b>{b.title}</b>}<p className="mq-intro">{b.text}</p></section>
  ));
  return (
    <Page
      wide
      label={`${T.label} · ${r.doc.workCode} ${r.doc.workName}`}
      title={`${r.number} · ${r.title}`}
      actions={<><Button icon="back" onClick={() => go("mijn-offerte")}>{t.common.back}</Button><Button icon="doc" onClick={() => void pdf(false)}>{T.pdf}</Button></>}
    >
      <div className="mq-status" data-testid="mq-status">
        <span className={`a-tag ${statusTag(r.status)}`}>{t.offertes.version(r.version)} · {statusWord(r.status)}</span>
        <span className="bw-muted">{T.sentOn(fmtTime(r.sentAt))} · {T.validUntil(fmtDayNum(r.doc.validUntil))}</span>
        {r.expired && r.status === QuoteStatus.sent && <span className="a-tag a-tag--warn">{T.expired}</span>}
      </div>
      {r.newerExists && (
        <p className="a-note" data-testid="mq-replaced">{T.replacedNote} {newer && <Button variant="quiet" onClick={() => go(`mijn-offerte/${newer.versionId}`)}>{T.openNewer(t.offertes.version(newer.version))}</Button>}</p>
      )}
      {!r.intact && <p className="a-err" role="alert">{T.notIntact}</p>}
      {r.acceptance && (
        <p className="a-note mq-accepted" data-testid="mq-accepted">
          <Icon name="check" size={16} />{" "}
          {r.acceptance.digital ? T.acceptedDigital(r.acceptance.digital.byName, fmtTime(r.acceptance.digital.at)) : T.acceptedSigned(fmtTime(r.acceptance.signed?.at))}
          {r.acceptance.digital && r.acceptance.signed ? ` ${T.acceptedAlsoSigned}` : ""}
        </p>
      )}
      {r.status === QuoteStatus.rejected && <p className="a-note" data-testid="mq-rejected">{T.rejectedNote}{r.decisionNote ? ` “${r.decisionNote}”` : ""}</p>}

      <div className="q-layout">
        <div className="q-main">
          <section className="mq-head">
            <dl className="q-facts">
              <div><dt>{T.client}</dt><dd>{r.doc.clientName}</dd></div>
              <div><dt>{T.work}</dt><dd>{r.doc.workName}</dd></div>
              <div><dt>{T.vat}</dt><dd>{r.vatBp === 0n ? t.vorm.vatZero : fmtBp(r.vatBp)}</dd></div>
              {f?.kind === QuoteKind.damage && <div><dt>{t.vorm.kinds.damage}</dt><dd data-testid="mq-damage">{[f.claimRef, f.insurerName].filter(Boolean).join(" · ") || "—"}</dd></div>}
              <div><dt>{T.payment}</dt><dd>{T.paymentDays(Number(r.doc.paymentDays))}</dd></div>
            </dl>
            {r.intro && <p className="mq-intro">{r.intro}</p>}
          </section>
          {blocksAt("top")}

          {r.chapters.map((c) => {
            const ls = r.lines.filter((l) => l.chapterId === c.id && l.kind !== QuoteLineKind.option);
            if (ls.length === 0) return null;
            return (
              <section key={String(c.id)} className="q-ch mq-ch">
                <div className="q-ch__head"><h2 className="bw-h2 q-ch__title"><span className="bw-mono">{c.code}</span> {c.title}</h2><span className="q-ch__sum bw-mono">{fmtEuro(c.sellCents)}</span></div>
                {c.code && blocksAt(c.code)}
                {ls.filter((l) => !subOf.has(String(l.id))).map((l) => <MqRow key={String(l.id)} l={l} />)}
                {(f?.subgroups ?? []).filter((g) => g.chapterId === c.id).sort((a, b) => (a.order < b.order ? -1 : 1)).map((g) => {
                  const gl = ls.filter((l) => subOf.get(String(l.id)) === String(g.id));
                  if (!gl.length) return null;
                  return (
                    <div key={String(g.id)} data-testid={`mq-subgroup-${g.id}`}>
                      <div className="q-sub"><b>{g.title}</b><span className="q-ch__sum bw-mono">{fmtEuro(gl.reduce((a, l) => a + (l.kind === QuoteLineKind.item ? l.lineSellCents : 0n), 0n))}</span></div>
                      {gl.map((l) => <MqRow key={String(l.id)} l={l} />)}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {opts.length > 0 && (
            <section className="q-ch mq-ch" data-testid="mq-options">
              <div className="q-ch__head"><h2 className="bw-h2 q-ch__title">{T.options}</h2><span className="bw-muted">{T.optionsNote}</span></div>
              {opts.map((l) => <MqRow key={String(l.id)} l={l} chapter={chOf(l.chapterId)?.title} />)}
            </section>
          )}

          {blocksAt("end")}
          {f?.regieSellCents !== undefined && <p className="mq-intro" data-testid="mq-regie">{t.vorm.regieSentence(fmtEuro(f.regieSellCents))}</p>}
          <details className="mq-terms">
            <summary>{T.terms(Number(r.doc.termsVersion), r.doc.termsProvisional)}</summary>
            {r.doc.termsProvisional && <p className="a-tag a-tag--warn">{T.termsProvisional}</p>}
            <pre className="mq-terms__text">{r.doc.termsText}</pre>
          </details>
        </div>

        <aside className="q-side">
          <section className="q-totals mq-totals" data-testid="mq-totals">
            <dl className="a-dl">
              {f && f.discountCents !== 0n && <><dt>{t.vorm.gross}</dt><dd className="bw-mono">{fmtEuro(f.grossCents)}</dd><dt data-testid="mq-discount">{t.vorm.discountLine(f.discountText)}</dt><dd className="bw-mono">−{fmtEuro(f.discountCents)}</dd></>}
              <dt>{t.offertes.subtotal}</dt><dd className="bw-mono">{fmtEuro(r.subtotalCents)}</dd>
              <dt>{r.vatBp === 0n ? t.vorm.vatZero : t.offertes.vatLine(fmtBp(r.vatBp))}</dt><dd className="bw-mono">{fmtEuro(r.vatCents)}</dd>
              <dt><b>{t.offertes.total}</b></dt><dd className="bw-mono"><b>{fmtEuro(r.totalCents)}</b></dd>
              {(r.optionsPlusCents !== 0n || r.optionsMinusCents !== 0n) && <><dt className="bw-muted">{t.offertes.options}</dt><dd className="bw-mono bw-muted">{fmtEuro(r.optionsPlusCents)} / {fmtEuro(r.optionsMinusCents)}</dd></>}
            </dl>
            {r.vatBp === 600n && r.doc.vatNote && <p className="bw-muted q-small">{T.vatGround(r.doc.vatNote)}</p>}
          </section>
          <p className="bw-muted q-small mq-hash" data-testid="mq-hash">{T.hash} <span className="bw-mono">{r.hash.slice(0, 16)}…</span><Info text={t.uitleg.controlecode} label={t.uitleg.label} /></p>
          {r.canAnswer && (
            <div className="mq-answer">
              <Button variant="primary" icon="check" onClick={() => setSheet("accept")}>{T.accept}</Button>
              <Button variant="quiet" onClick={() => setSheet("decline")}>{T.decline}</Button>
              <p className="bw-muted q-small">{T.answerHelp}</p>
            </div>
          )}
          {!r.canAnswer && r.status === QuoteStatus.sent && r.expired && <p className="bw-muted q-small">{T.expiredHelp}</p>}
        </aside>
      </div>

      {sheet === "accept" && <AcceptSheet r={r} busy={busy} onDone={() => answer(true, "")} onClose={() => setSheet(null)} />}
      {sheet === "decline" && <DeclineSheet busy={busy} onDone={(note) => answer(false, note)} onClose={() => setSheet(null)} />}
    </Page>
  );
}

function MqRow({ l, chapter }: { l: MyQuoteRead["lines"][number]; chapter?: string }) {
  if (l.kind === QuoteLineKind.text) return <div className="mq-row mq-row--text"><span className="bw-muted">{l.title}{l.title && l.text ? " — " : ""}{l.text}</span></div>;
  const pm = l.qtyMilli === 0n;
  return (
    <div className="mq-row">
      <span className="bw-mono mq-code">{l.code}</span>
      <span className="mq-desc">
        <b>{l.title || l.text.split("\n")[0]}</b>
        {l.title && l.text && <span className="bw-muted mq-text">{l.text}</span>}
        <span className="mq-sub">
          <span className="a-tag" title={t.offertes.forms[l.form]}>{t.offertes.formsShort[l.form]}</span>
          {chapter && <span className="bw-muted">{chapter}</span>}
          {l.specRef && <span className="bw-muted bw-mono">{T.specRef(l.specRef)}</span>}
        </span>
      </span>
      <span className="bw-mono mq-qty" data-l={T.qty}>{fmtQty(l.qtyMilli)} {l.unit}</span>
      <span className="bw-mono mq-unit" data-l={T.unitPrice}>{l.unitSellCents !== undefined ? fmtEuro(l.unitSellCents) : "—"}</span>
      <span className="bw-mono mq-line" data-l={T.lineTotal}><b>{pm ? T.pm : fmtEuro(l.lineSellCents)}</b></span>
    </div>
  );
}

function AcceptSheet({ r, busy, onDone, onClose }: { r: MyQuoteRead; busy: boolean; onDone: () => void; onClose: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <Sheet title={T.acceptTitle} open onClose={onClose} side footer={<Button variant="primary" icon="check" busy={busy} disabled={!ok} onClick={onDone}>{T.acceptNow}</Button>}>
      <div className="a-form">
        <p>{T.acceptLead(r.number, Number(r.version), fmtEuro(r.totalCents), Number(r.doc.termsVersion))}</p>
        <p className="bw-muted q-small">{T.acceptExact} <span className="bw-mono">{r.hash.slice(0, 16)}…</span></p>
        <label className="a-check mq-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="mq-agree" /> {T.agree}</label>
      </div>
    </Sheet>
  );
}

function DeclineSheet({ busy, onDone, onClose }: { busy: boolean; onDone: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <Sheet title={T.declineTitle} open onClose={onClose} side footer={<Button variant="primary" busy={busy} onClick={() => onDone(note.trim())}>{T.declineNow}</Button>}>
      <div className="a-form">
        <p>{T.declineLead}</p>
        <label className="bw-field"><span className="bw-label">{T.declineNote}</span><textarea className="bw-input" rows={4} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Sheet>
  );
}
