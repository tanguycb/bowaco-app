// Aankoopfacturen zoals ze binnenkomen (stap 2c.7, ontwerp 2c §4.7; zonder AI). Kantoor registreert een factuur van een onderaannemer
// of een leverancier over één of meer werven (regel per werf of algemene kost, kostensoort, uren per dag, betaalkorting, vorderingsstaat
// van de OA als tweede bijlage). Bij een OA wordt elke werf een werfdeel (OA-factuur van 2.11) met zijn eigen controle en goedkeuring.
// Te betalen: eerst wat korting geeft. De werfleider bevestigt de uren per dag op de werf (tabblad Facturatie), zonder bedragen. De OA
// ziet de stand per factuur bij Mijn facturen. Geen nieuw menu-item: tabbladen in de werklijst OA-facturen en blokken op de werf.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PurchaseStatus, type Caps, type HourClaimView } from "../backend";
import { Button, Icon, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtDayNum, fmtEuro, fmtTime, inputToDay, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page } from "./common";
import { fmtQty } from "./Offertes";
import { TabBar } from "./Tabs";

export const TA = t.aankoop;
export const purchaseTag = (s: PurchaseStatus) => (s === PurchaseStatus.approved ? "a-tag--ok" : s === PurchaseStatus.disputed ? "a-tag--bad" : s === PurchaseStatus.withdrawn ? "" : "a-tag--accent");
const hhmm = (m: bigint) => `${String(Number(m) / 60 | 0).padStart(2, "0")}:${String(Number(m) % 60).padStart(2, "0")}`;
export const slotsText = (slots: { fromMin: bigint; toMin: bigint }[]) => slots.map((s) => `${hhmm(s.fromMin)}–${hhmm(s.toMin)}`).join(", ");

/** De tabbladen van de werklijst OA-facturen (kantoor): per werf (2.11) · aankoopfacturen · te betalen. */
export function PurchaseTabs({ caps, go, active }: { caps: Caps; go: (to: string) => void; active: "parts" | "purchases" | "pay" }) {
  if (!caps.purchases) return null;
  return <TabBar label={TA.tabPurchases} current={active} go={go} tabs={[{ key: "parts", to: "oa-facturen", label: TA.tabParts }, { key: "purchases", to: "oa-facturen/aankoop", label: TA.tabPurchases }, { key: "pay", to: "oa-facturen/te-betalen", label: TA.tabPay }]} />;
}

// ── Lijst ──────────────────────────────────────────────────────────────────
export function PurchaseList({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["purchases", status], queryFn: () => actor!.listPurchases(null, status ? (status as PurchaseStatus) : null), enabled: !!actor && !isFetching });
  const rows = q.data ?? [];
  return (
    <Page label={t.oaFacturen.label} title={TA.title} actions={<Button variant="primary" icon="plus" onClick={() => go("oa-facturen/aankoop/nieuw")} data-testid="pu-new">{TA.register}</Button>}>
      <PurchaseTabs caps={caps} go={go} active="purchases" />
      <p className="bw-muted" style={{ maxWidth: 720 }}>{TA.lead}</p>
      <label className="bw-field" style={{ maxWidth: 240 }}>
        <span className="bw-label">{t.oaFacturen.statusFilter}</span>
        <select className="bw-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t.oaFacturen.allOpen}</option>
          {[PurchaseStatus.registered, PurchaseStatus.checking, PurchaseStatus.disputed, PurchaseStatus.approved, PurchaseStatus.withdrawn].map((s) => <option key={s} value={s}>{TA.status[s]}</option>)}
        </select>
      </label>
      <Loading q={q} />
      {q.data && rows.length === 0 && <p className="a-empty">{TA.none}</p>}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="pu-list">
          {rows.map((b) => (
            <li key={String(b.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`oa-facturen/aankoop/${b.id}`)}>
                <span className="a-tag bw-mono">{b.number}</span>
                <span className="a-list__main">
                  <b>{b.orgName}</b>
                  <span className="bw-muted">{TA.kinds[b.kind]} · {fmtDayNum(b.invoiceDay)} · {b.works.map((w) => w.workCode).join(", ") || TA.general}{b.discountUntil !== undefined ? ` · ${TA.discountUntil.toLowerCase()} ${fmtDayNum(b.discountUntil)}` : ""}{b.paidDay !== undefined ? ` · ${TA.paidOn(fmtDayNum(b.paidDay))}` : ""}{b.openClaims > 0n ? ` · ${b.openClaims} ${TA.claimStates["te-bevestigen"]}` : ""}</span>
                </span>
                <span className={`a-tag ${purchaseTag(b.status)}`}>{TA.status[b.status]}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

// ── Te betalen ─────────────────────────────────────────────────────────────
// Aankoopfacturen (na hun goedgekeurde creditnota's), een creditnota apart als haar factuur al betaald was (negatief), en de OA-facturen
// van 2.11 die geen werfdeel zijn: die markeert men hier betaald (een aankoop in haar eigen scherm).
export function PayList({ caps, go }: { caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["purchasesToPay"], queryFn: async () => unwrap(await actor!.listPurchasesToPay()), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0 });
  const rows = q.data ?? [];
  const [open, setOpen] = useState<bigint | null>(null);
  return (
    <Page label={t.oaFacturen.label} title={TA.payTitle}>
      <PurchaseTabs caps={caps} go={go} active="pay" />
      <p className="bw-muted" style={{ maxWidth: 720 }}>{TA.payLead}</p>
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={TA.payNone} text="" />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="pu-pay">
          {rows.map((r) => {
            const b = r.brief;
            const oi = r.oaInvoice;
            const key = b ? `p${b.id}` : `o${oi?.id}`;
            return (
              <li key={key}>
                <button type="button" className="a-list__btn" onClick={() => (b ? go(`oa-facturen/aankoop/${b.id}`) : oi && setOpen(open === oi.id ? null : oi.id))}>
                  <span className="a-tag bw-mono">{b ? b.number : oi?.number}</span>
                  <span className="a-list__main">
                    <b>{b ? b.orgName : oi?.orgName}</b>
                    <span className="bw-muted">{oi ? `${TA.payOa} · ${oi.workCode} · ` : ""}{r.text}</span>
                    {r.warnings.map((w) => <span key={w} className="a-tag a-tag--warn">{TA.payWarnings[w] ?? w}</span>)}
                  </span>
                  <span className="bw-mono">{fmtEuro(r.payCents)}</span>
                  <Icon name={b ? "next" : open === oi?.id ? "close" : "receipt"} size={18} />
                </button>
                {oi && open === oi.id && <OaPayPanel row={r} onDone={() => { setOpen(null); void q.refetch(); }} />}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

/** Een OA-factuur van 2.11 betaald markeren (en de inhouding doorgestort), in de lijst zelf. */
function OaPayPanel({ row, onDone }: { row: { oaInvoice?: { id: bigint; rev: bigint; invoiceDay: bigint }; paidDay?: bigint; withheldDay?: bigint; withholdCents: bigint }; onDone: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [day, setDay] = useState(dayToInput(row.paidDay ?? todayDay()));
  const [wday, setWday] = useState(dayToInput(row.withheldDay));
  const [busy, setBusy] = useState(false);
  const oi = row.oaInvoice!;
  const save = async (paid: boolean) => {
    setBusy(true);
    try {
      unwrap(await actor!.markOaInvoicePaid(oi.id, oi.rev, paid ? inputToDay(day) ?? null : null, paid && row.withholdCents > 0n ? inputToDay(wday) ?? null : null));
      toast.show({ kind: "ok", text: TA.paidOk });
      onDone();
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-card" style={{ margin: "4px 0 8px" }} data-testid="oa-pay">
      <div className="a-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="bw-field"><span className="bw-label">{TA.pay}</span><input className="bw-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        {row.withholdCents > 0n && <label className="bw-field"><span className="bw-label">{TA.withheld}</span><input className="bw-input" type="date" value={wday} onChange={(e) => setWday(e.target.value)} /></label>}
      </div>
      <div className="a-row" style={{ gap: 8 }}>
        <Button variant="primary" busy={busy} disabled={inputToDay(day) === undefined} onClick={() => void save(true)}>{TA.payMark}</Button>
        {row.paidDay !== undefined && <Button busy={busy} onClick={() => void save(false)}>{TA.unpay}</Button>}
      </div>
    </div>
  );
}

/** De aankoopfacturen van één werf en de kosten die doorgerekend worden (werf → Facturatie; kantoor). */
export function WorkPurchases({ workId, go }: { workId: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const list = useQuery({ queryKey: ["purchases", "werf", String(workId)], queryFn: () => actor!.listPurchases(workId, null), enabled: !!actor && !isFetching, retry: 0 });
  const [showCosts, setShowCosts] = useState(false);
  const costs = useQuery({ queryKey: ["purchaseCosts", String(workId)], queryFn: async () => unwrap(await actor!.purchaseCosts(workId)), enabled: !!actor && !isFetching && showCosts, staleTime: 0, gcTime: 0 });
  if (list.error) return null;
  const rows = list.data ?? [];
  return (
    <section className="a-section" data-testid="pu-work">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{TA.workTitle}</h2>
        <Button icon="plus" onClick={() => go(`oa-facturen/aankoop/nieuw?w=${workId}`)}>{TA.register}</Button>
      </div>
      <Loading q={list} />
      {list.data && rows.length === 0 && <p className="a-empty">{TA.none}</p>}
      {rows.length > 0 && (
        <ul className="a-list">
          {rows.map((b) => (
            <li key={String(b.id)}>
              <button type="button" className="a-list__btn" onClick={() => go(`oa-facturen/aankoop/${b.id}`)}>
                <span className="a-tag bw-mono">{b.number}</span>
                <span className="a-list__main"><b>{b.orgName}</b><span className="bw-muted">{TA.kinds[b.kind]} · {fmtDayNum(b.invoiceDay)}{b.works.length > 1 ? ` · ${b.works.map((w) => w.workCode).join(", ")}` : ""}</span></span>
                <span className={`a-tag ${purchaseTag(b.status)}`}>{TA.status[b.status]}</span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="a-row"><Button variant="quiet" icon={showCosts ? "close" : "receipt"} onClick={() => setShowCosts(!showCosts)} data-testid="pu-costs-toggle">{TA.costs}</Button></div>
      {showCosts && (
        <>
          <p className="bw-muted">{TA.costsLead}</p>
          <Loading q={costs} />
          {costs.data && costs.data.length === 0 && <p className="a-empty">{TA.costsNone}</p>}
          {costs.data && costs.data.length > 0 && (
            <ul className="vs-facts" data-testid="pu-costs">
              {costs.data.map((c) => <li key={c.key}>{fmtDayNum(c.day)} · {c.kindName} · {c.description} · {fmtQty(c.qtyMilli)} {c.unit} · <span className="bw-mono">{fmtEuro(c.costCents)}</span> <span className="bw-muted">({c.orgName} {c.number}, {TA.status[c.status]})</span></li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** De werfleider (en de beheerder): uren van onderaannemers bevestigen, naast het werfverslag, zonder bedragen. */
export function WorkHourClaims({ workId }: { workId: bigint }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hourClaims", String(workId)], queryFn: () => actor!.listHourClaims(workId), enabled: !!actor && !isFetching, retry: 0 });
  const [open, setOpen] = useState<bigint | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.error) return null;
  const rows = q.data ?? [];
  if (q.data && rows.length === 0) return null;
  const answer = async (c: HourClaimView, ok: boolean) => {
    setBusy(true);
    try {
      unwrap(await actor!.reviewHourClaim(c.id, ok, ok ? "" : why));
      toast.show({ kind: "ok", text: TA.reviewedOk });
      setOpen(null);
      setWhy("");
      void qc.invalidateQueries({ queryKey: ["hourClaims"] });
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="a-section" data-testid="pu-claims">
      <h2 className="bw-h2">{TA.hoursTitle}</h2>
      <p className="bw-muted">{TA.hoursLead}</p>
      <Loading q={q} />
      <ul className="a-list">
        {rows.map((c) => (
          <li key={String(c.id)} className="pu-claim" data-testid="pu-claim">
            <div className="a-list__main">
              <b>{fmtDayNum(c.day)} · {c.orgName}</b>
              <span className="bw-muted">{c.number} · {TA.hoursInvoice}: {String(c.persons)} × {slotsText(c.slots)}{c.pauseMin > 0n ? `, ${TA.pause} ${c.pauseMin}` : ""} = {fmtQty(c.hoursMilli)} u</span>
              <span className="bw-muted">{TA.hoursReport}: {String(c.reportPersons)} pers., {fmtQty(c.reportMilli)} u · {TA.hoursDiff}: <b className={c.diffMilli !== 0n ? "a-err" : ""}>{fmtQty(c.diffMilli)} u</b></span>
              {c.reviewByName && <span className="bw-muted">{TA.claimStates[c.state]} · {c.reviewByName}{c.reviewedAt !== undefined ? ` · ${fmtTime(c.reviewedAt)}` : ""}{c.reviewNote ? ` · ${c.reviewNote}` : ""}</span>}
            </div>
            <span className={`a-tag ${c.state === "klopt" ? "a-tag--ok" : c.state === "klopt-niet" ? "a-tag--bad" : "a-tag--accent"}`}>{TA.claimStates[c.state]}</span>
            {c.canReview && (
              <div className="a-row">
                <Button icon="check" busy={busy} onClick={() => void answer(c, true)} data-testid="pu-claim-ok">{TA.ok}</Button>
                <Button icon="alert" onClick={() => { setOpen(open === c.id ? null : c.id); setWhy(""); }} data-testid="pu-claim-no">{TA.notOk}</Button>
              </div>
            )}
            {open === c.id && (
              <div className="a-form">
                <label className="bw-field"><span className="bw-label">{TA.notOkReason}</span><textarea className="bw-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} data-testid="pu-claim-why" /></label>
                <div className="a-row"><Button onClick={() => setOpen(null)}>{t.common.cancel}</Button><Button variant="danger" busy={busy} disabled={why.trim().length < 5} onClick={() => void answer(c, false)} data-testid="pu-claim-no-go">{TA.notOk}</Button></div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** De OA: de stand van zijn facturen per factuur (niet per werfdeel) en de dagen waarvan de uren niet kloppen. */
export function MyPurchasesBlock() {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["myPurchases"], queryFn: () => actor!.myPurchases(), enabled: !!actor && !isFetching, retry: 0 });
  const rows = q.data ?? [];
  if (q.error || rows.length === 0) return null;
  return (
    <section className="a-section" data-testid="my-pu">
      <h2 className="bw-h3">{TA.mineTitle}</h2>
      <ul className="a-list">
        {rows.map((x, i) => (
          <li key={i} className="oi-mine">
            <span className="a-tag bw-mono">{x.number}</span>
            <span className="a-list__main">
              <b>{x.works.join(", ")}</b>
              <span className="bw-muted">{fmtDayNum(x.invoiceDay)}{x.decidedAt !== undefined ? ` · ${fmtTime(x.decidedAt)}` : ""}{x.reason ? ` · ${x.reason}` : ""}</span>
              {x.disputedDays.map((d, k) => <span key={k} className="a-err">{TA.mineDisputed(fmtDayNum(d.day), fmtQty(d.hoursMilli), d.note)}</span>)}
            </span>
            <span className={`a-tag ${purchaseTag(x.status)}`}>{TA.status[x.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
