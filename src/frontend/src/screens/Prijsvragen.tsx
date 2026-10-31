// Prijsvraag naar onderaannemers (stap 2c.2, ontwerp 2c §4.2; prototype 2c: werf → Offerte → Prijsvragen, werklijst Offertes →
// Prijsvragen, Mijn prijsvragen van de OA). Kantoor (beheerder, calculator) zet een prijsvraag klaar uit posten van een
// offerteversie, kiest firma's, deadline, herinnering, bijlagen en wat de firma van de werf ziet; per firma PDF en Excel (in de
// browser), toegang in de app (toegangscode, zonder werf) en "Markeer als verstuurd" zolang de mail in testmodus staat. De werfleider
// van de werf ziet welke firma's, de stand en de deadline, nooit een prijs. De OA ziet enkel de prijsvragen aan zijn firma; hij vult
// in, bewaart (enkel zijn firma ziet het ontwerp), dient in tot de deadline, laadt zijn eigen PDF op of zegt geen interesse.
// Bedragen komen enkel uit update-calls met een auditregel (readOaQuote, readMyTenderAnswer). Bevestigen in een paneel.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ExternalBlob, OrgKind, QuoteLineKind, QuoteStatus, TenderAddressMode, TenderInviteStatus, type Caps, type MyTenderAnswer, type MyTenderView, type OaIncluded, type OaQuoteFull, type TenderInviteView, type TenderStatus, type TenderStatusView, type TenderView } from "../backend";
import { Button, Choice, Confirm, Icon, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, fmtDayNum, fmtEuro, fmtTime, inputToDay, parseEuro, todayDay, unwrap, useBackend } from "../util";
import { EmptyState, Loading, Page } from "./common";
import { OpenConfidential } from "./Dossier";
import { fmtQty } from "./Offertes";
import { makeSheet, sheetFileName } from "../tender/sheet.ts";
import { totals, type Included } from "../tender/calc.ts";
import "../app/prijsvraag.css";

const P = t.prijsvragen;
const unitOf = (u: string) => (u === "m2" ? "m²" : u === "m3" ? "m³" : u);
const statusKey = (s: TenderStatus) => s.__kind__;
const isOpen = (s: TenderStatus) => s.__kind__ === "open";
const answered = (st: TenderInviteStatus) => st === TenderInviteStatus.received || st === TenderInviteStatus.declined;
const inviteTag = (st: TenderInviteStatus) => (st === TenderInviteStatus.received ? "a-tag--ok" : st === TenderInviteStatus.declined || st === TenderInviteStatus.noAnswer ? "a-tag--bad" : st === TenderInviteStatus.ready ? "" : "a-tag--accent");

/** De stand van een prijsvraag in één woord: loopt · te kiezen (alles binnen of deadline voorbij) · afgesloten · geannuleerd. */
export function tenderStand(s: TenderStatusView, today: bigint): "open" | "choose" | "closed" | "cancelled" {
  if (s.status.__kind__ === "cancelled") return "cancelled";
  if (s.status.__kind__ === "closed") return "closed";
  const sent = s.invites.filter((i) => i.status !== TenderInviteStatus.ready);
  if (sent.length > 0 && (sent.every((i) => answered(i.status) || i.status === TenderInviteStatus.noAnswer) || s.deadlineDay < today)) return "choose";
  return "open";
}
const standTag = (k: string) => (k === "choose" ? "a-tag--warn" : k === "open" ? "a-tag--accent" : k === "cancelled" ? "a-tag--bad" : "");

function download(data: Uint8Array | Blob, name: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const placeLines = (a: { street: string; number: string; zip: string; city: string }, mode: TenderAddressMode) => {
  const l1 = String(mode) === "full" ? `${a.street} ${a.number}`.trim() : "";
  const l2 = `${a.zip} ${a.city}`.trim();
  return [l1, l2].filter(Boolean);
};

// ── De werf → Offerte → Prijsvragen ─────────────────────────────────────────
export function WorkTenders({ workId, caps, go }: { workId: bigint; caps: Caps; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const office = caps.tenders;
  const list = useQuery({ queryKey: ["tenders", String(workId)], queryFn: () => actor!.listTenders(workId), enabled: !!actor && !isFetching, retry: 0, refetchOnWindowFocus: true });
  const [creating, setCreating] = useState(false);
  if (list.error) return <p className="a-empty">{P.noRight}</p>;
  const rows = list.data ?? [];
  return (
    <section className="a-section" data-testid="pv-werf">
      <div className="a-row a-row--between">
        <h2 className="bw-h2">{P.title}</h2>
        {office && <Button variant="primary" icon="plus" onClick={() => setCreating(true)} data-testid="pv-new">{P.add}</Button>}
      </div>
      <p className="bw-muted pv-lead">{office ? P.lead : P.leadLeader}</p>
      <Loading q={list} />
      {list.data && rows.length === 0 && <p className="a-empty">{P.none}</p>}
      {rows.map((s) => <TenderCard key={String(s.id)} s={s} office={office} go={go} />)}
      {creating && <NewTender workId={workId} onClose={() => setCreating(false)} />}
    </section>
  );
}

function TenderCard({ s, office, go }: { s: TenderStatusView; office: boolean; go: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const stand = tenderStand(s, todayDay());
  const got = s.invites.filter((i) => answered(i.status)).length;
  return (
    <div className="pv-card" data-testid="pv-card">
      <div className="pv-card__h">
        <div>
          <b className="bw-mono">{s.code}</b> · <b>{s.title}</b>
          <div className="bw-muted">{P.items(Number(s.items))} · {P.before(fmtDayNum(s.deadlineDay))} · {P.answers(got, s.invites.length)}</div>
        </div>
        <span className={`a-tag ${standTag(stand)}`}>{P.stand[stand]}</span>
      </div>
      {!open && (
        <ul className="a-list pv-firms">
          {s.invites.map((i) => (
            <li key={String(i.id)}>
              <span className="a-list__main"><b>{i.orgName}</b><span className="bw-muted">{[i.contactName, i.askedDay !== undefined ? P.askedOn(fmtDayNum(i.askedDay)) : "", i.remindedDay !== undefined ? P.remindedOn(fmtDayNum(i.remindedDay)) : "", i.deadlineDay !== s.deadlineDay ? P.ownDeadline(fmtDayNum(i.deadlineDay)) : ""].filter(Boolean).join(" · ")}</span></span>
              <span className={`a-tag ${inviteTag(i.status)}`}>{P.invite[i.status]}</span>
              {i.outcome.__kind__ !== "open" && <span className="a-tag">{P.outcome[i.outcome.__kind__]}</span>}
            </li>
          ))}
        </ul>
      )}
      {office && <div className="a-row"><Button variant="quiet" icon={open ? "up" : "down"} onClick={() => setOpen(!open)} data-testid="pv-open">{open ? P.hide : P.open}</Button></div>}
      {office && open && <TenderDetail id={s.id} go={go} />}
    </div>
  );
}

type OpenSheet =
  | { k: "access"; inv: TenderInviteView }
  | { k: "sent"; inv: TenderInviteView }
  | { k: "more"; inv: TenderInviteView }
  | { k: "quote"; id: bigint }
  | { k: "extend" }
  | { k: "add" }
  | { k: "close" }
  | { k: "cancel" };

function TenderDetail({ id }: { id: bigint; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tender", String(id)], queryFn: async () => unwrap(await actor!.readTender(id)), enabled: !!actor && !isFetching });
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  // De toegangscode staat enkel hier en enkel één keer (de app bewaart er enkel de controlecode van).
  const [codes, setCodes] = useState<Record<string, { code: string; until: bigint }>>({});
  const [done, setDone] = useState<Record<string, string[]>>({});
  const v = q.data;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["tender", String(id)] }); void qc.invalidateQueries({ queryKey: ["tenders"] }); };
  if (!v) return <Loading q={q} />;
  const mark = (inv: TenderInviteView, ch: string) => setDone((d) => ({ ...d, [String(inv.id)]: [...new Set([...(d[String(inv.id)] ?? []), ch])] }));
  const place = placeLines(v.workAddress, v.addressMode);
  const pdf = async (inv: TenderInviteView) => {
    try {
      const [{ tenderPdf }, { loadPdfFonts }] = await Promise.all([import("../pdf/prijsvraag.ts"), import("../pdf/fonts.ts")]);
      const bytes = await tenderPdf({
        code: v.code, title: v.title, firm: inv.orgName, firmContact: inv.contactName, place, deadlineDay: Number(inv.deadlineDay),
        contact: v.contact, message: v.noteForOa, files: v.files.map((f) => f.name), accessCode: codes[String(inv.id)]?.code ?? null, appUrl: window.location.origin, hash: v.sentHash,
        items: v.items.map((x) => ({ chapter: x.chapter, subgroup: x.subgroup, code: x.code, title: x.title, text: x.text, unit: unitOf(x.unit), qtyMilli: x.qtyMilli, form: x.form })),
      }, await loadPdfFonts());
      download(bytes, sheetFileName({ code: v.code, title: v.title, firm: inv.orgName }).replace(/\.xlsx$/, ".pdf"), "application/pdf");
      mark(inv, "pdf");
    } catch (e) { toast.show({ kind: "error", text: errText(e) }); }
  };
  const excel = (inv: TenderInviteView) => {
    const bytes = makeSheet({
      sheetKey: inv.sheetKey, sentHash: v.sentHash, code: v.code, title: v.title, firm: inv.orgName, place: place.join(", "),
      deadline: fmtDayNum(inv.deadlineDay), contact: [v.contact.name, v.contact.phone, v.contact.email].filter(Boolean).join(" · "),
      items: v.items.map((x) => ({ pos: Number(x.pos), chapter: x.chapter, subgroup: x.subgroup, code: x.code, title: x.title, text: x.text, unit: unitOf(x.unit), qtyMilli: x.qtyMilli })),
    });
    download(bytes, sheetFileName({ code: v.code, title: v.title, firm: inv.orgName }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    mark(inv, "excel");
  };
  const open = isOpen(v.status);
  return (
    <div className="pv-detail" data-testid="pv-detail">
      <p className="bw-muted">{P.madeBy(v.createdByName, fmtTime(v.createdAt))} · {P.addressShown(P.address[v.addressMode])} · <span className="bw-mono">{P.hashLine(v.sentHash.slice(0, 16))}</span></p>
      {v.status.__kind__ === "cancelled" && <p className="a-note">{P.status.cancelled}: {v.status.cancelled.reason}</p>}
      {v.internalNote && <p className="a-note">{P.internalNote}: {v.internalNote}</p>}
      <div className="bw-table-wrap">
        <table className="bw-table bw-table--stack pv-table">
          <thead><tr><th>{P.firm}</th><th>{P.stateCol}</th>{open && <th>{P.actions}</th>}</tr></thead>
          <tbody>
            {v.invites.map((inv) => (
              <tr key={String(inv.id)} data-testid="pv-invite">
                <td data-label={P.firm}>
                  <b>{inv.orgName}</b>
                  <span className="bw-muted vs-sub">{inv.contactName || P.contactNone.split(".")[0]}{inv.linked ? ` · ${P.accessLinkedShort}` : inv.accessState ? ` · ${P.accessState[inv.accessState] ?? inv.accessState}` : ""}</span>
                </td>
                <td data-label={P.stateCol}>
                  <span className={`a-tag ${inviteTag(inv.status)}`}>{P.invite[inv.status]}</span>
                  {inv.outcome.__kind__ !== "open" && <span className="a-tag">{P.outcome[inv.outcome.__kind__]}</span>}
                  <span className="bw-muted vs-sub">{[inv.askedDay !== undefined ? P.askedOn(fmtDayNum(inv.askedDay)) : "", inv.remindedDay !== undefined ? P.remindedOn(fmtDayNum(inv.remindedDay)) : "", inv.ownDeadline !== undefined ? P.ownDeadline(fmtDayNum(inv.ownDeadline)) : "", inv.channels.map((c) => P.channels[c] ?? c).join(", "), inv.declineReason].filter(Boolean).join(" · ")}</span>
                  {inv.oaQuotes.map((oq) => (
                    <span key={String(oq.id)} className="pv-oq">
                      <Button variant="quiet" onClick={() => setSheet({ k: "quote", id: oq.id })} data-testid="pv-oq">{P.version(Number(oq.version))} · {P.source[oq.source] ?? oq.source}{oq.number ? ` · ${oq.number}` : ""}</Button>
                    </span>
                  ))}
                </td>
                {open && (
                  <td data-label={P.actions}>
                    <div className="a-row pv-acts">
                      <Button onClick={() => void pdf(inv)} data-testid="pv-pdf">{P.pdf}</Button>
                      <Button onClick={() => excel(inv)} data-testid="pv-excel">{P.excel}</Button>
                      <Button onClick={() => setSheet({ k: "access", inv })} data-testid="pv-access">{P.access}</Button>
                      <Button variant={inv.status === TenderInviteStatus.ready ? "primary" : "secondary"} onClick={() => setSheet({ k: "sent", inv })} data-testid="pv-sent">{P.markSent}</Button>
                      <Button variant="quiet" onClick={() => setSheet({ k: "more", inv })}>{P.more}</Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="pv-posts">
        <summary>{P.posts} ({v.items.length}) · {P.attachments} ({v.files.length})</summary>
        <ul className="a-list">
          {v.items.map((x) => (
            <li key={String(x.id)}><span className="a-list__main"><b>{x.code ? `${x.code} ` : ""}{x.title}</b><span className="bw-muted">{x.chapter}{x.subgroup ? ` · ${x.subgroup}` : ""} · {fmtQty(x.qtyMilli)} {unitOf(x.unit)}</span></span></li>
          ))}
        </ul>
        {v.files.length === 0 ? <p className="bw-muted">{P.noAttachments}</p> : <p className="bw-muted">{v.files.map((f) => f.name).join(" · ")}</p>}
        {v.noteForOa && <p><b>{P.message}:</b> {v.noteForOa}</p>}
      </details>
      {open && (
        <div className="a-row">
          <Button onClick={() => setSheet({ k: "extend" })}>{P.extend}</Button>
          <Button icon="plus" onClick={() => setSheet({ k: "add" })}>{P.addFirm}</Button>
          <Button onClick={() => setSheet({ k: "close" })} data-testid="pv-close">{P.close}</Button>
          <Button variant="quiet" onClick={() => setSheet({ k: "cancel" })}>{P.cancel}</Button>
        </div>
      )}
      {sheet?.k === "access" && <AccessSheet v={v} inv={sheet.inv} code={codes[String(sheet.inv.id)] ?? null} onCode={(c) => { setCodes((x) => ({ ...x, [String(sheet.inv.id)]: c })); mark(sheet.inv, "app"); refresh(); }} onPdf={() => void pdf(sheet.inv)} onClose={() => setSheet(null)} />}
      {sheet?.k === "sent" && <SentSheet inv={sheet.inv} pre={done[String(sheet.inv.id)] ?? []} onDone={refresh} onClose={() => setSheet(null)} />}
      {sheet?.k === "more" && <MoreSheet inv={sheet.inv} onDone={refresh} onClose={() => setSheet(null)} />}
      {sheet?.k === "quote" && <QuoteSheet id={sheet.id} onClose={() => setSheet(null)} />}
      {(sheet?.k === "extend" || sheet?.k === "add" || sheet?.k === "close" || sheet?.k === "cancel") && <TenderOpSheet v={v} kind={sheet.k} onDone={refresh} onClose={() => setSheet(null)} />}
    </div>
  );
}

function AccessSheet({ v, inv, code, onCode, onPdf, onClose }: { v: TenderView; inv: TenderInviteView; code: { code: string; until: bigint } | null; onCode: (c: { code: string; until: bigint }) => void; onPdf: () => void; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [linked, setLinked] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: async () => unwrap(await actor!.tenderAccess(inv.id, 0n)),
    onSuccess: (r) => { if (r.alreadyLinked) setLinked(r.personName); else if (r.code && r.expiresAt !== undefined) onCode({ code: r.code, until: r.expiresAt }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(P.mailText(code.code, v.code, v.title, fmtDayNum(inv.deadlineDay), window.location.origin)); toast.show({ kind: "ok", text: t.common.copied }); } catch (e) { toast.show({ kind: "error", text: errText(e) }); }
  };
  return (
    <Sheet title={P.accessTitle(inv.orgName)} open onClose={onClose} side footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      <p>{P.accessLead}</p>
      {inv.contactPersonId === undefined && <p className="a-note">{P.contactNone}</p>}
      {(linked || inv.linked) && <p className="a-note" data-testid="pv-linked">{P.accessLinked(linked ?? inv.contactName)}</p>}
      {code ? (
        <div className="pv-code" data-testid="pv-code">
          <span className="bw-label">{P.accessCode(inv.contactName)}</span>
          <span className="bw-mono pv-code__v">{code.code}</span>
          <span className="bw-muted">{P.accessValid(fmtTime(code.until))} {P.accessOnce}</span>
          <div className="a-row"><Button onClick={() => void copy()}>{P.copyMail}</Button><Button onClick={onPdf}>{P.pdfWithCode}</Button></div>
        </div>
      ) : (!inv.linked && !linked && inv.contactPersonId !== undefined && <Button variant="primary" busy={make.isPending} onClick={() => make.mutate()} data-testid="pv-access-make">{inv.accessState === "open" ? P.accessNew : P.accessMake}</Button>)}
    </Sheet>
  );
}

function SentSheet({ inv, pre, onDone, onClose }: { inv: TenderInviteView; pre: string[]; onDone: () => void; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [chs, setChs] = useState<string[]>(pre.length ? pre : ["pdf", "excel"]);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.updateTenderInvite(inv.id, { __kind__: "markSent", markSent: chs })),
    onSuccess: () => { toast.show({ kind: "ok", text: P.sentDone }); onDone(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={P.markSentTitle(inv.orgName)} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={chs.length === 0} onClick={() => save.mutate()} data-testid="pv-sent-ok">{P.markSent}</Button></>}>
      <p>{P.markSentLead}</p>
      {["pdf", "excel", "app"].map((c) => (
        <label key={c} className="a-check"><input type="checkbox" checked={chs.includes(c)} onChange={(e) => setChs((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} /> {P.channels[c]}</label>
      ))}
    </Sheet>
  );
}

function MoreSheet({ inv, onDone, onClose }: { inv: TenderInviteView; onDone: () => void; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [contact, setContact] = useState(inv.contactPersonId !== undefined ? String(inv.contactPersonId) : "");
  const [own, setOwn] = useState(dayToInput(inv.ownDeadline));
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: async (op: Parameters<NonNullable<typeof actor>["updateTenderInvite"]>[1]) => unwrap(await actor!.updateTenderInvite(inv.id, op)),
    onSuccess: () => { toast.show({ kind: "ok", text: P.done }); onDone(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  return (
    <Sheet title={P.moreTitle(inv.orgName)} open onClose={onClose} side footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      <label className="bw-field">
        <span className="bw-label">{P.contact}</span>
        {inv.contacts.length === 0 ? <p className="a-note">{P.contactNone}</p> : (
          <select className="bw-input" value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">{P.contactPick}</option>
            {inv.contacts.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.name}{c.linked ? ` (${P.accessLinkedShort})` : ""}</option>)}
          </select>
        )}
      </label>
      {inv.contacts.length > 0 && <Button disabled={contact === (inv.contactPersonId !== undefined ? String(inv.contactPersonId) : "")} busy={run.isPending} onClick={() => run.mutate({ __kind__: "contact", contact: contact ? BigInt(contact) : null })}>{t.common.save}</Button>}
      <label className="bw-field">
        <span className="bw-label">{P.ownDeadlineLabel}</span>
        <input className="bw-input" type="date" value={own} onChange={(e) => setOwn(e.target.value)} />
      </label>
      <div className="a-row">
        <Button busy={run.isPending} disabled={!own} onClick={() => run.mutate({ __kind__: "extend", extend: inputToDay(own) ?? null })}>{t.common.save}</Button>
      </div>
      {inv.status !== TenderInviteStatus.received && inv.status !== TenderInviteStatus.declined && (
        <>
          <label className="bw-field">
            <span className="bw-label">{P.declinedReason}</span>
            <input className="bw-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button variant="quiet" onClick={() => setConfirm(true)}>{P.declined}</Button>
        </>
      )}
      <Confirm open={confirm} title={P.declinedConfirm(inv.orgName)} text={P.declinedText} confirmLabel={P.declined} busy={run.isPending} onConfirm={() => run.mutate({ __kind__: "declined", declined: reason })} onClose={() => setConfirm(false)} />
    </Sheet>
  );
}

function QuoteLinesTable({ lines, chapterOf }: { lines: OaQuoteFull["lines"]; chapterOf?: (id: bigint) => string }) {
  return (
    <div className="bw-table-wrap">
      <table className="bw-table bw-table--stack">
        <thead><tr><th>{P.colPost}</th><th className="bw-right">{P.colQty}</th><th className="bw-right">{P.colPrice}</th><th className="bw-right">{P.colTotal}</th><th>{P.colIncluded}</th></tr></thead>
        <tbody>
          {lines.map((l, k) => (
            <tr key={k}>
              <td data-label={P.colPost}><b>{l.description}</b><span className="bw-muted vs-sub">{l.itemId === undefined ? P.ownPosts : chapterOf?.(l.itemId) ?? ""}{l.remark ? ` · ${l.remark}` : ""}</span></td>
              <td data-label={P.colQty} className="bw-right bw-mono">{fmtQty(l.qtyMilli)} {unitOf(l.unit)}</td>
              <td data-label={P.colPrice} className="bw-right bw-mono">{l.unitCents !== undefined ? fmtEuro(l.unitCents) : P.noPrice}</td>
              <td data-label={P.colTotal} className="bw-right bw-mono">{l.amountCents !== undefined ? fmtEuro(l.amountCents) : "–"}</td>
              <td data-label={P.colIncluded}>{l.included.__kind__ === "alt" ? `${P.included.alt}: ${l.included.alt}` : P.included[l.included.__kind__]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteSheet({ id, onClose }: { id: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  // Bedragen: update-call met auditregel (R38); enkel in het geheugen van dit paneel.
  const q = useQuery({ queryKey: ["oaQuote", String(id)], queryFn: async () => unwrap(await actor!.readOaQuote(id)), enabled: !!actor && !isFetching, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const v = q.data;
  return (
    <Sheet title={v ? P.quoteTitle(v.quote.orgName, Number(v.quote.version)) : P.received} open onClose={onClose} side wide footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      <Loading q={q} />
      {v && (
        <>
          <p className="bw-muted">{P.quoteLead}</p>
          <dl className="pv-kv">
            <dt>{P.quoteNo}</dt><dd>{v.quote.number || "–"}</dd>
            <dt>{P.quoteDay}</dt><dd>{fmtDayNum(v.quote.quoteDay)}</dd>
            <dt>{P.validUntil}</dt><dd>{v.quote.validUntil !== undefined ? fmtDayNum(v.quote.validUntil) : "–"}</dd>
            <dt>{P.reverse}</dt><dd>{v.quote.vatRegime.__kind__ === "reverse" ? t.common.yes : P.vatNormal(fmtBp(v.quote.vatRegime.normal))}</dd>
            {v.discountBp !== undefined && <><dt>{P.discount}</dt><dd>{fmtBp(v.discountBp)}</dd></>}
            <dt>{P.net}</dt><dd className="bw-mono"><b>{fmtEuro(v.netCents)}</b></dd>
            {v.file && v.fileId !== undefined && <><dt>{P.ownPdf}</dt><dd>{v.file.name} <OpenConfidential fileId={v.fileId} /></dd></>}
          </dl>
          {v.remark && <p>{v.remark}</p>}
          <QuoteLinesTable lines={v.lines} />
        </>
      )}
    </Sheet>
  );
}

function TenderOpSheet({ v, kind, onDone, onClose }: { v: TenderView; kind: "extend" | "add" | "close" | "cancel"; onDone: () => void; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const toast = useToast();
  const [day, setDay] = useState(dayToInput(v.deadlineDay));
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<bigint[]>([]);
  const [org, setOrg] = useState("");
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching && kind === "add" });
  const run = useMutation({
    mutationFn: async () => {
      if (kind === "add") return unwrap(await actor!.addTenderFirm(v.id, { orgId: BigInt(org), contactPersonId: undefined }));
      const op = kind === "extend" ? { __kind__: "extend" as const, extend: inputToDay(day) ?? 0n } : kind === "cancel" ? { __kind__: "cancel" as const, cancel: reason } : { __kind__: "close" as const, close: chosen };
      return unwrap(await actor!.updateTender(v.id, v.rev, op));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: P.done }); onDone(); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const title = kind === "extend" ? P.extendTitle : kind === "add" ? P.addFirmTitle : kind === "close" ? P.closeTitle : P.cancelTitle;
  const invited = new Set(v.invites.map((i) => String(i.orgId)));
  const subs = (orgs.data ?? []).filter((o) => (o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier) && !invited.has(String(o.id))).sort((a, b) => a.name.localeCompare(b.name));
  const ok = kind === "extend" ? !!day : kind === "add" ? !!org : kind === "cancel" ? reason.trim().length >= 3 : true;
  return (
    <Sheet title={title} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant={kind === "cancel" ? "danger" : "primary"} busy={run.isPending} disabled={!ok} onClick={() => run.mutate()} data-testid="pv-op-ok">{kind === "extend" ? t.common.save : kind === "add" ? P.addFirm : kind === "close" ? P.close : P.cancel}</Button></>}>
      {kind === "extend" && <label className="bw-field"><span className="bw-label">{P.newDeadline}</span><input className="bw-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>}
      {kind === "add" && (
        <label className="bw-field">
          <span className="bw-label">{P.newOtherPick}</span>
          <select className="bw-input" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="" />
            {subs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
        </label>
      )}
      {kind === "close" && (
        <>
          <p>{P.closeLead}</p>
          {v.invites.map((i) => (
            <label key={String(i.id)} className="a-check"><input type="checkbox" checked={chosen.includes(i.id)} onChange={(e) => setChosen((x) => (e.target.checked ? [...x, i.id] : x.filter((y) => y !== i.id)))} /> {i.orgName} <span className="bw-muted">({P.invite[i.status]})</span></label>
          ))}
          {chosen.length === 0 && <p className="bw-muted">{P.closeNone}</p>}
        </>
      )}
      {kind === "cancel" && (<><p>{P.cancelLead}</p><label className="bw-field"><span className="bw-label">{P.cancelReason}</span><input className="bw-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label></>)}
    </Sheet>
  );
}

// ── Nieuwe prijsvraag ───────────────────────────────────────────────────────
function NewTender({ workId, onClose }: { workId: bigint; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  const quotes = useQuery({ queryKey: ["quotes", String(workId), "pv"], queryFn: () => actor!.listQuotes(workId, false), enabled: on });
  const versions = (quotes.data ?? []).flatMap((q) => q.versions.filter((x) => x.status !== QuoteStatus.withdrawn && x.status !== QuoteStatus.rejected && x.status !== QuoteStatus.superseded && x.lines > 0n).map((x) => ({ q, x })));
  const [vid, setVid] = useState<string>("");
  useEffect(() => { if (!vid && versions.length) setVid(String((versions.find((x) => x.x.status === QuoteStatus.draft) ?? versions[0]).x.id)); }, [versions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = useQuery({ queryKey: ["quoteRead", vid, "pv"], queryFn: async () => unwrap(await actor!.readQuoteVersion(BigInt(vid))), enabled: on && vid !== "", staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const files = useQuery({ queryKey: ["files", String(workId)], queryFn: () => actor!.listFiles(workId), enabled: on });
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [firms, setFirms] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [remind, setRemind] = useState("3");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [mode, setMode] = useState<TenderAddressMode>(TenderAddressMode.full);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const r = read.data;
  const items = (r?.lines ?? []).filter((l) => l.kind !== QuoteLineKind.text);
  const chapters = r?.chapters ?? [];
  useEffect(() => { setSel(new Set()); }, [vid]);
  const lineIds = useMemo(() => [...sel].sort().map((x) => BigInt(x)), [sel]);
  const sug = useQuery({ queryKey: ["tenderSug", vid, lineIds.join(",")], queryFn: async () => unwrap(await actor!.tenderSuggestions(BigInt(vid), lineIds)), enabled: on && vid !== "" });
  useEffect(() => { if (sug.data && !deadline) { setDeadline(dayToInput(sug.data.deadlineDay)); setRemind(String(sug.data.remindDays)); } }, [sug.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleChapter = (cid: bigint, on2: boolean) => setSel((s) => { const n = new Set(s); for (const l of items.filter((x) => x.chapterId === cid)) { if (on2) n.add(String(l.id)); else n.delete(String(l.id)); } return n; });
  const toggleLine = (id: bigint, on2: boolean) => setSel((s) => { const n = new Set(s); if (on2) n.add(String(id)); else n.delete(String(id)); return n; });
  const autoTitle = chapters.filter((c) => items.some((l) => l.chapterId === c.id && sel.has(String(l.id)))).map((c) => c.title).join(", ");
  const subs = (orgs.data ?? []).filter((o) => (o.kind === OrgKind.subcontractor || o.kind === OrgKind.supplier) && !firms.includes(String(o.id))).sort((a, b) => a.name.localeCompare(b.name));
  const orgName = (id: string) => orgs.data?.find((o) => String(o.id) === id)?.name ?? sug.data?.firms.find((f) => String(f.orgId) === id)?.orgName ?? id;
  const plain = (files.data ?? []).filter((f) => !f.confidential);
  const save = useMutation({
    mutationFn: async () => unwrap(await actor!.createTender({
      versionId: BigInt(vid), lineIds, title: (title || autoTitle).trim(), noteForOa: msg, internalNote: note, deadlineDay: inputToDay(deadline) ?? 0n, remindDays: BigInt(Math.max(0, Number(remind) || 0)),
      fileIds: fileIds.map((x) => BigInt(x)), addressMode: mode, firms: firms.map((f) => ({ orgId: BigInt(f), contactPersonId: undefined })),
    })),
    onSuccess: () => { toast.show({ kind: "ok", text: P.newDone }); void qc.invalidateQueries({ queryKey: ["tenders"] }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const ready = vid !== "" && sel.size > 0 && firms.length > 0 && (title || autoTitle).trim() !== "" && !!deadline;
  return (
    <Sheet title={P.newTitle} open onClose={onClose} side wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} disabled={!ready} onClick={() => save.mutate()} data-testid="pv-new-ok">{P.newSubmit}</Button></>}>
      <p className="bw-muted">{P.newLead}</p>
      <Loading q={quotes} />
      {quotes.data && versions.length === 0 && <p className="a-note">{P.newNoQuote}</p>}
      {versions.length > 0 && (
        <label className="bw-field">
          <span className="bw-label">{P.newVersion}</span>
          <select className="bw-input" value={vid} onChange={(e) => setVid(e.target.value)}>
            {versions.map(({ q, x }) => <option key={String(x.id)} value={String(x.id)}>{q.number} · {t.offertes.version(Number(x.version))} · {t.offertes.status[x.status] ?? x.status}</option>)}
          </select>
        </label>
      )}
      <Loading q={read} />
      {r && (
        <fieldset className="pv-pick" data-testid="pv-pick">
          <legend className="bw-label">{P.newPosts}</legend>
          <p className="bw-muted">{P.newPostsHint}</p>
          {chapters.map((c) => {
            const ls = items.filter((l) => l.chapterId === c.id);
            if (ls.length === 0) return null;
            const all = ls.every((l) => sel.has(String(l.id)));
            return (
              <details key={String(c.id)} className="pv-ch">
                <summary>
                  <label className="a-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={all} onChange={(e) => toggleChapter(c.id, e.target.checked)} data-testid="pv-ch" /> <b>{c.code} {c.title}</b> <span className="bw-muted">· {P.items(ls.length)}</span></label>
                </summary>
                {ls.map((l) => (
                  <label key={String(l.id)} className="a-check pv-line"><input type="checkbox" checked={sel.has(String(l.id))} onChange={(e) => toggleLine(l.id, e.target.checked)} /> {l.code ? <span className="bw-mono">{l.code}</span> : null} {l.title} <span className="bw-muted">· {fmtQty(l.qtyMilli)} {unitOf(l.unit)}</span></label>
                ))}
              </details>
            );
          })}
        </fieldset>
      )}
      <label className="bw-field"><span className="bw-label">{P.newTitleLabel}</span><input className="bw-input" value={title} placeholder={autoTitle} onChange={(e) => setTitle(e.target.value)} data-testid="pv-title" /></label>
      <fieldset className="pv-pick">
        <legend className="bw-label">{P.newFirms}</legend>
        <p className="bw-muted">{P.newFirmsHint}</p>
        {(sug.data?.firms ?? []).map((f) => (
          <label key={String(f.orgId)} className="a-check"><input type="checkbox" checked={firms.includes(String(f.orgId))} onChange={(e) => setFirms((x) => (e.target.checked ? [...x, String(f.orgId)] : x.filter((y) => y !== String(f.orgId))))} data-testid="pv-sug" /> <b>{f.orgName}</b> <span className="bw-muted">· {f.reasons.map((x) => P.reasons[x] ?? x).join(", ")} · {f.quotes > 0n ? P.sugLine(Number(f.quotes), Number(f.chosen), f.lastQuoteDay !== undefined ? fmtDayNum(f.lastQuoteDay).slice(3) : "") : P.newNever}</span></label>
        ))}
        {firms.filter((f) => !(sug.data?.firms ?? []).some((x) => String(x.orgId) === f)).map((f) => (
          <label key={f} className="a-check"><input type="checkbox" checked onChange={() => setFirms((x) => x.filter((y) => y !== f))} /> <b>{orgName(f)}</b></label>
        ))}
        <div className="a-row">
          <select className="bw-input" value={other} onChange={(e) => setOther(e.target.value)} aria-label={P.newOther} data-testid="pv-other">
            <option value="">{P.newOtherPick}</option>
            {subs.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
          </select>
          <Button icon="plus" disabled={!other} onClick={() => { setFirms((x) => [...x, other]); setOther(""); }} data-testid="pv-other-add">{P.newOther}</Button>
        </div>
      </fieldset>
      <div className="a-row">
        <label className="bw-field"><span className="bw-label">{P.newDeadline}</span><input className="bw-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} data-testid="pv-deadline" /></label>
        <label className="bw-field"><span className="bw-label">{P.newRemind}</span><input className="bw-input" inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, ""))} /></label>
      </div>
      <fieldset className="pv-pick">
        <legend className="bw-label">{P.newFiles}</legend>
        {plain.length === 0 && <p className="bw-muted">{P.newNoFiles}</p>}
        {plain.map((f) => <label key={String(f.id)} className="a-check"><input type="checkbox" checked={fileIds.includes(String(f.id))} onChange={(e) => setFileIds((x) => (e.target.checked ? [...x, String(f.id)] : x.filter((y) => y !== String(f.id))))} /> {f.name}</label>)}
      </fieldset>
      <div className="bw-field"><span className="bw-label">{P.newAddress}</span><Choice label={P.newAddress} value={mode} onChange={setMode} options={[{ value: TenderAddressMode.full, label: P.address.full }, { value: TenderAddressMode.city, label: P.address.city }]} /><span className="bw-muted">{P.addressShown(P.address[mode])}</span></div>
      <label className="bw-field"><span className="bw-label">{P.newMessage}</span><textarea className="bw-input" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
      <label className="bw-field"><span className="bw-label">{P.newInternal}</span><textarea className="bw-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {!ready && <p className="bw-muted">{P.newNeed}</p>}
    </Sheet>
  );
}

// ── Werklijst Offertes → Prijsvragen ────────────────────────────────────────
export function TendersOverview({ go }: { go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["tenders", "all"], queryFn: () => actor!.listTenders(null), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const [all, setAll] = useState(false);
  const today = todayDay();
  const rows = (q.data ?? []).filter((s) => all || s.status.__kind__ === "open");
  return (
    <Page label={P.label} title={P.title}>
      <p className="bw-muted pv-lead">{P.overviewLead}</p>
      <Choice label={P.title} value={all ? "all" : "open"} onChange={(x) => setAll(x === "all")} options={[{ value: "open", label: P.filterOpen }, { value: "all", label: P.filterAll }]} />
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={P.noneAll} text={P.lead} />}
      {rows.length > 0 && (
        <ul className="a-list" data-testid="pv-overview">
          {rows.map((s) => {
            const stand = tenderStand(s, today);
            return (
              <li key={String(s.id)}>
                <button type="button" className="a-list__btn" onClick={() => go(`werven/${s.workId}/offerte/prijsvragen`)}>
                  <span className="a-tag bw-mono">{s.code}</span>
                  <span className="a-list__main"><b>{s.title}</b><span className="bw-muted">{s.workCode} {s.workName} · {P.answers(s.invites.filter((i) => answered(i.status)).length, s.invites.length)} · {P.before(fmtDayNum(s.deadlineDay))}</span></span>
                  <span className={`a-tag ${standTag(stand)}`}>{P.stand[stand]}</span>
                  <Icon name="next" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

// ── De onderaannemer: Mijn prijsvragen ──────────────────────────────────────
const mineTag = (st: TenderInviteStatus) => (st === TenderInviteStatus.received ? "a-tag--ok" : st === TenderInviteStatus.asked || st === TenderInviteStatus.reminded ? "a-tag--warn" : "");

/** De lijst (ook als blok op Mijn week). Leeg en embedded = niets tonen. */
export function MyTenderList({ go, embedded }: { go: (to: string) => void; embedded?: boolean }) {
  const { actor, isFetching } = useBackend();
  const q = useQuery({ queryKey: ["myTenders"], queryFn: () => actor!.listMyTenders(), enabled: !!actor && !isFetching, refetchOnWindowFocus: true });
  const rows = q.data ?? [];
  if (embedded && rows.length === 0) return null;
  const list = (
    <ul className="a-list" data-testid="pv-mine">
      {rows.map((b) => (
        <li key={b.ref}>
          <button type="button" className="a-list__btn" onClick={() => go(`prijsvragen/${b.ref}`)}>
            <span className="a-list__main"><b>{b.code} · {b.title}</b><span className="bw-muted">{b.place} · {P.items(Number(b.items))} · {P.before(fmtDayNum(b.deadlineDay))}</span></span>
            {b.outcome.__kind__ !== "open" ? <span className={`a-tag ${b.outcome.__kind__ === "chosen" ? "a-tag--ok" : ""}`}>{P.outcome[b.outcome.__kind__]}</span> : <span className={`a-tag ${mineTag(b.status)}`}>{P.stateMine[b.status]}</span>}
            <Icon name="next" size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
  if (embedded) return <section className="a-section"><h2 className="bw-h2">{P.mine}</h2>{list}</section>;
  return (
    <Page label={P.mineFrom} title={P.mine}>
      <p className="bw-muted pv-lead">{P.mineLead}</p>
      <Loading q={q} />
      {q.data && rows.length === 0 && <EmptyState title={P.mine} text={P.mineNone} />}
      {rows.length > 0 && list}
    </Page>
  );
}

export function MyTendersPage({ go, route }: { go: (to: string) => void; route: string[] }) {
  if (route[1] && /^[0-9A-Z]{16}$/.test(route[1])) return <MyTender key={route[1]} tref={route[1]} go={go} />;
  return <MyTenderList go={go} />;
}

type Row = { price: string; incl: "yes" | "no" | "alt"; remark: string };
type Own = { desc: string; unit: string; qty: string; price: string; remark: string };
const euroIn = (c: bigint | undefined) => (c === undefined ? "" : `${c / 100n},${String(c % 100n).padStart(2, "0")}`);
const inclOf = (r: Row): Included => (r.incl === "no" ? { no: null } : r.incl === "alt" ? { alt: r.remark } : { yes: null });
const inclTs = (r: Row): OaIncluded => (r.incl === "no" ? { __kind__: "no", no: null } : r.incl === "alt" ? { __kind__: "alt", alt: r.remark } : { __kind__: "yes", yes: null });
const parseQtyMilli = (s: string): bigint | null => {
  const v = s.replace(/\s/g, "");
  if (v === "") return 1000n;
  const norm = v.includes(",") ? v.replaceAll(".", "").replace(",", ".") : v;
  if (!/^\d+(\.\d{1,3})?$/.test(norm)) return null;
  const [i, d = ""] = norm.split(".");
  return BigInt(i) * 1000n + BigInt((d + "000").slice(0, 3));
};

function MyTender({ tref, go }: { tref: string; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const on = !!actor && !isFetching;
  // Niet verversen bij terugkeren naar het venster: dat zou wat de OA aan het invullen is, overschrijven.
  const view = useQuery({ queryKey: ["myTender", tref], queryFn: async () => unwrap(await actor!.readMyTender(tref)), enabled: on, refetchOnWindowFocus: false });
  // Zijn eigen ontwerp en ingediende prijzen: update-call met auditregel; enkel in het geheugen van deze pagina.
  const ans = useQuery({ queryKey: ["myTenderAnswer", tref], queryFn: async () => unwrap(await actor!.readMyTenderAnswer(tref)), enabled: on, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const v = view.data;
  if (!v) return <Page label={P.mineFrom} title={P.mine} actions={<Button icon="back" onClick={() => go("prijsvragen")}>{P.backToList}</Button>}><Loading q={view} /></Page>;
  return (
    <Page label={P.mineFrom} title={`${v.code} · ${v.title}`} actions={<Button icon="back" onClick={() => go("prijsvragen")}>{P.backToList}</Button>}>
      <MyTenderBody v={v} ans={ans.data} loading={ans.isLoading} onChange={() => { void qc.invalidateQueries({ queryKey: ["myTender", tref] }); void qc.invalidateQueries({ queryKey: ["myTenderAnswer", tref] }); void qc.invalidateQueries({ queryKey: ["myTenders"] }); }} toast={toast} />
    </Page>
  );
}

function MyTenderBody({ v, ans, loading, onChange, toast }: { v: MyTenderView; ans?: MyTenderAnswer; loading: boolean; onChange: () => void; toast: ReturnType<typeof useToast> }) {
  const { actor } = useBackend();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [own, setOwn] = useState<Own[]>([]);
  const [head, setHead] = useState({ number: "", day: "", valid: "", discount: "", reverse: true, remark: "" });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"submit" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  // Vullen: het ontwerp, anders de laatste ingediende versie, anders leeg.
  useEffect(() => {
    if (!ans) return;
    const last = ans.versions.length ? ans.versions[ans.versions.length - 1] : undefined;
    const src = ans.draft ?? last;
    const r: Record<string, Row> = {};
    for (const it of v.items) r[String(it.pos)] = { price: "", incl: "yes", remark: "" };
    const ownRows: Own[] = [];
    for (const l of src?.lines ?? []) {
      if (l.pos !== undefined) r[String(l.pos)] = { price: euroIn(l.unitCents), incl: l.included.__kind__, remark: l.included.__kind__ === "alt" ? l.included.alt || l.remark : l.remark };
      else ownRows.push({ desc: l.description, unit: l.unit, qty: fmtQty(l.qtyMilli), price: euroIn(l.unitCents), remark: l.remark });
    }
    setRows(r);
    setOwn(ownRows);
    const d = ans.draft;
    const q = last;
    setHead({
      number: d?.number ?? q?.number ?? "",
      day: dayToInput(d?.quoteDay ?? q?.quoteDay),
      valid: dayToInput(d?.validUntil ?? q?.validUntil),
      discount: (d?.discountBp ?? q?.discountBp) !== undefined ? String(Number(d?.discountBp ?? q?.discountBp) / 100).replace(".", ",") : "",
      reverse: d ? d.reverse : q ? q.vatRegime.__kind__ === "reverse" : true,
      remark: d?.remark ?? q?.remark ?? "",
    });
    setEditing(!!ans.draft || ans.versions.length === 0);
  }, [ans]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = v.canAnswer && editing;
  // Invoer → regels (dezelfde rekenregels als de server, tender/calc.ts).
  const build = (): { lines: { pos: bigint | null; itemId: bigint | null; qtyMilli: bigint; unitCents: bigint | null; included: Included; desc: string; unit: string; remark: string; inclTs: OaIncluded }[]; error: string | null; discountBp: bigint | null } => {
    const lines = [];
    for (const it of v.items) {
      const r = rows[String(it.pos)] ?? { price: "", incl: "yes" as const, remark: "" };
      const p = r.price.trim() === "" ? undefined : parseEuro(r.price);
      if (p === null) return { lines: [], error: P.badPrice(it.code || it.title), discountBp: null };
      if (p === undefined && r.incl === "yes" && r.remark.trim() === "") continue; // niets ingevuld
      lines.push({ pos: it.pos, itemId: it.pos, qtyMilli: it.qtyMilli, unitCents: p ?? null, included: inclOf(r), desc: it.title, unit: it.unit, remark: r.remark, inclTs: inclTs(r) });
    }
    for (const o of own) {
      if (o.desc.trim() === "") continue;
      const p = o.price.trim() === "" ? undefined : parseEuro(o.price);
      if (p === null) return { lines: [], error: P.badPrice(o.desc), discountBp: null };
      const q = parseQtyMilli(o.qty);
      if (q === null) return { lines: [], error: P.badQty(o.desc), discountBp: null };
      lines.push({ pos: null, itemId: null, qtyMilli: q, unitCents: p ?? null, included: { yes: null } as Included, desc: o.desc, unit: o.unit, remark: o.remark, inclTs: { __kind__: "yes", yes: null } as OaIncluded });
    }
    let discountBp: bigint | null = null;
    if (head.discount.trim() !== "") {
      const n = Number(head.discount.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 50) return { lines: [], error: P.badPct, discountBp: null };
      discountBp = BigInt(Math.round(n * 100));
    }
    return { lines, error: null, discountBp };
  };
  const b = build();
  const chapterOf = (pos: bigint) => v.items.find((x) => x.pos === pos)?.chapter ?? "";
  const tot = b.error ? null : totals(b.lines, b.discountBp, chapterOf);
  const priced = b.lines.filter((l) => l.itemId !== null && l.unitCents !== null).length;
  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      if (b.error || !tot) throw new Error(b.error ?? t.common.error);
      return unwrap(await actor!.saveMyTender(v.ref, {
        number: head.number, quoteDay: inputToDay(head.day), validUntil: inputToDay(head.valid), discountBp: b.discountBp ?? undefined, reverse: head.reverse, remark: head.remark,
        lines: b.lines.map((l) => ({ pos: l.pos ?? undefined, description: l.desc, unit: l.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents ?? undefined, included: l.inclTs, remark: l.remark })),
      }, submit, tot.net));
    },
    onSuccess: (r) => { setConfirm(null); toast.show({ kind: "ok", text: r.version !== undefined ? P.submitted(Number(r.version)) : P.savedDraft }); onChange(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const decline = useMutation({
    mutationFn: async () => unwrap(await actor!.declineMyTender(v.ref, reason)),
    onSuccess: () => { setConfirm(null); toast.show({ kind: "ok", text: P.done }); onChange(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, "application/pdf", file.name).withUploadProgress(setProgress);
      return unwrap(await actor!.addMyTenderFile(v.ref, file.name, "application/pdf", BigInt(bytes.length), blob));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); onChange(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  const openFile = useMutation({
    mutationFn: async (pos: bigint) => { const f = unwrap(await actor!.readTenderFile(v.ref, pos)); const u = f.blob.getDirectURL(); if (!u) throw new Error(t.common.error); return u; },
    onSuccess: (u) => window.open(u, "_blank", "noopener"),
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const setRow = (pos: bigint, x: Partial<Row>) => setRows((r) => ({ ...r, [String(pos)]: { ...(r[String(pos)] ?? { price: "", incl: "yes", remark: "" }), ...x } }));
  const addr = [v.address.street, v.address.number].filter(Boolean).join(" ") + (v.address.city ? `${v.address.street ? ", " : ""}${v.address.zip} ${v.address.city}` : "");
  const draftFile = ans?.draft?.file;
  return (
    <div className="pv-mine" data-testid="pv-mine-detail">
      <p className="bw-muted">{P.mineWork(addr)} · {P.before(fmtDayNum(v.deadlineDay))}</p>
      {v.outcome.__kind__ === "chosen" && <p className="a-note pv-ok">{P.outcomeChosen}</p>}
      {v.outcome.__kind__ === "thanked" && <p className="a-note">{P.outcomeThanked}</p>}
      {!v.canAnswer && v.outcome.__kind__ === "open" && <p className="a-note">{P.readOnly}</p>}
      <dl className="pv-kv">
        <dt>{P.contactBowaco}</dt><dd>{[v.contact.name, v.contact.phone, v.contact.email].filter(Boolean).join(" · ")}</dd>
        {v.noteForOa && <><dt>{P.mineMessage}</dt><dd>{v.noteForOa}</dd></>}
        {v.files.length > 0 && <><dt>{P.mineFiles}</dt><dd>{v.files.map((f) => <Button key={String(f.pos)} variant="quiet" busy={openFile.isPending && openFile.variables === f.pos} onClick={() => openFile.mutate(f.pos)} data-testid="pv-file">{f.name}</Button>)}</dd></>}
      </dl>
      {loading && <p className="bw-muted">{t.common.loading}</p>}
      <section className="a-section">
        <div className="a-row a-row--between"><h2 className="bw-h2">{P.minePrices}</h2><span className="bw-muted">{P.minePricesHint}</span></div>
        <div className="bw-table-wrap">
          <table className="bw-table bw-table--stack pv-fill">
            <thead><tr><th>{P.colNr}</th><th>{P.colPost}</th><th className="bw-right">{P.colQty}</th><th>{P.colPrice}</th><th className="bw-right">{P.colTotal}</th><th>{P.colIncluded}</th><th>{P.colRemark}</th></tr></thead>
            <tbody>
              {v.items.map((it, k) => {
                const r = rows[String(it.pos)] ?? { price: "", incl: "yes" as const, remark: "" };
                const p = r.price.trim() === "" ? undefined : parseEuro(r.price);
                const amount = p ? totals([{ itemId: it.pos, qtyMilli: it.qtyMilli, unitCents: p, included: inclOf(r) }], null, () => "").gross : null;
                const newCh = k === 0 || v.items[k - 1].chapter !== it.chapter;
                const newSub = it.subgroup && (k === 0 || v.items[k - 1].subgroup !== it.subgroup || newCh);
                return [
                  newCh ? <tr key={`c${k}`} className="pv-chrow"><td colSpan={7}><b>{it.chapter}</b></td></tr> : null,
                  newSub ? <tr key={`s${k}`} className="pv-subrow"><td colSpan={7}><i>{it.subgroup}</i></td></tr> : null,
                  <tr key={String(it.pos)} data-testid="pv-fill-row">
                    <td data-label={P.colNr} className="bw-mono">{it.code}</td>
                    <td data-label={P.colPost}><b>{it.title}</b>{it.text && <span className="bw-muted vs-sub pv-text">{it.text}</span>}</td>
                    <td data-label={P.colQty} className="bw-right bw-mono">{fmtQty(it.qtyMilli)} {unitOf(it.unit)}</td>
                    <td data-label={P.colPrice}>{canEdit ? <input className="bw-input pv-in" inputMode="decimal" placeholder="0,00" value={r.price} onChange={(e) => setRow(it.pos, { price: e.target.value })} aria-label={`${P.colPrice} ${it.code || it.title}`} data-testid="pv-price" /> : <span className="bw-mono">{r.price ? `€ ${r.price}` : "–"}</span>}</td>
                    <td data-label={P.colTotal} className="bw-right bw-mono">{amount !== null && p ? fmtEuro(amount) : "–"}</td>
                    <td data-label={P.colIncluded}>{canEdit ? (
                      <select className="bw-input pv-in" value={r.incl} onChange={(e) => setRow(it.pos, { incl: e.target.value as Row["incl"] })} aria-label={`${P.colIncluded} ${it.code || it.title}`}>
                        <option value="yes">{P.included.yes}</option><option value="no">{P.included.no}</option><option value="alt">{P.included.alt}</option>
                      </select>
                    ) : P.included[r.incl]}</td>
                    <td data-label={P.colRemark}>{canEdit ? <input className="bw-input pv-in" value={r.remark} placeholder={r.incl === "alt" ? P.altWhat : ""} onChange={(e) => setRow(it.pos, { remark: e.target.value })} aria-label={`${P.colRemark} ${it.code || it.title}`} /> : r.remark}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        <h3 className="bw-h3">{P.ownPosts}</h3>
        {own.map((o, k) => (
          <div key={k} className="a-row pv-own">
            <input className="bw-input" placeholder={P.ownDesc} value={o.desc} disabled={!canEdit} onChange={(e) => setOwn((x) => x.map((y, i) => (i === k ? { ...y, desc: e.target.value } : y)))} />
            <input className="bw-input pv-sm" placeholder={P.colUnit} value={o.unit} disabled={!canEdit} onChange={(e) => setOwn((x) => x.map((y, i) => (i === k ? { ...y, unit: e.target.value } : y)))} />
            <input className="bw-input pv-sm" placeholder={P.colQty} inputMode="decimal" value={o.qty} disabled={!canEdit} onChange={(e) => setOwn((x) => x.map((y, i) => (i === k ? { ...y, qty: e.target.value } : y)))} />
            <input className="bw-input pv-sm" placeholder={P.colPrice} inputMode="decimal" value={o.price} disabled={!canEdit} onChange={(e) => setOwn((x) => x.map((y, i) => (i === k ? { ...y, price: e.target.value } : y)))} />
            <input className="bw-input" placeholder={P.colRemark} value={o.remark} disabled={!canEdit} onChange={(e) => setOwn((x) => x.map((y, i) => (i === k ? { ...y, remark: e.target.value } : y)))} />
            {canEdit && <Button variant="quiet" onClick={() => setOwn((x) => x.filter((_, i) => i !== k))}>{P.ownRemove}</Button>}
          </div>
        ))}
        {canEdit && <Button icon="plus" onClick={() => setOwn((x) => [...x, { desc: "", unit: "", qty: "1", price: "", remark: "" }])}>{P.ownAdd}</Button>}
        {b.error ? <p className="a-err" role="alert">{b.error}</p> : tot && (
          <p className="pv-total"><span>{P.totalLine(priced, v.items.length)}</span> <b className="bw-mono">{fmtEuro(tot.gross)}</b>{tot.discount !== 0n && <> · {P.afterDiscount} <b className="bw-mono" data-testid="pv-net">{fmtEuro(tot.net)}</b></>}</p>
        )}
      </section>
      <section className="a-section pv-head">
        <div className="a-row">
          <label className="bw-field"><span className="bw-label">{P.yourNo}</span><input className="bw-input" value={head.number} disabled={!canEdit} onChange={(e) => setHead({ ...head, number: e.target.value })} /></label>
          <label className="bw-field"><span className="bw-label">{P.yourDay}</span><input className="bw-input" type="date" value={head.day} disabled={!canEdit} onChange={(e) => setHead({ ...head, day: e.target.value })} /></label>
          <label className="bw-field"><span className="bw-label">{P.yourValid}</span><input className="bw-input" type="date" value={head.valid} disabled={!canEdit} onChange={(e) => setHead({ ...head, valid: e.target.value })} /></label>
          <label className="bw-field"><span className="bw-label">{P.yourDiscount}</span><input className="bw-input pv-sm" inputMode="decimal" value={head.discount} disabled={!canEdit} onChange={(e) => setHead({ ...head, discount: e.target.value })} /></label>
          <label className="a-check"><input type="checkbox" checked={head.reverse} disabled={!canEdit} onChange={(e) => setHead({ ...head, reverse: e.target.checked })} /> {P.yourReverse}</label>
        </div>
        <label className="bw-field"><span className="bw-label">{P.yourRemark}</span><textarea className="bw-input" rows={2} value={head.remark} disabled={!canEdit} onChange={(e) => setHead({ ...head, remark: e.target.value })} /></label>
        <div className="bw-field">
          <span className="bw-label">{P.yourPdf}</span>
          {draftFile && <span className="bw-muted">{draftFile.name} · {(Number(draftFile.size) / 1024).toFixed(0)} KB</span>}
          {canEdit && (
            <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
              {upload.isPending ? P.yourPdfBusy(progress ?? 0) : P.yourPdfUp}
              <input type="file" accept="application/pdf" disabled={upload.isPending} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} data-testid="pv-upload" />
            </label>
          )}
        </div>
        {canEdit && (
          <>
            <div className="a-row">
              <Button busy={save.isPending && save.variables === false} disabled={!!b.error} onClick={() => save.mutate(false)} data-testid="pv-save">{t.common.save}</Button>
              <Button variant="primary" disabled={!!b.error || b.lines.length === 0} onClick={() => setConfirm("submit")} data-testid="pv-submit">{P.submit}</Button>
              {v.status !== TenderInviteStatus.received && v.versions === 0n && <Button variant="quiet" onClick={() => setConfirm("decline")}>{P.decline}</Button>}
            </div>
            <p className="bw-muted">{P.saveHint}</p>
          </>
        )}
        {v.canAnswer && !editing && <Button onClick={() => setEditing(true)} data-testid="pv-newversion">{P.newVersionBtn}</Button>}
      </section>
      {ans && ans.versions.length > 0 && (
        <section className="a-section">
          <h2 className="bw-h2">{P.yourVersions}</h2>
          <ul className="a-list">
            {[...ans.versions].reverse().map((x) => (
              <li key={String(x.version)}><span className="a-list__main"><b>{P.version(Number(x.version))}{x.number ? ` · ${x.number}` : ""}</b><span className="bw-muted">{fmtTime(x.createdAt)} · {P.source[x.source] ?? x.source}</span></span><span className="bw-mono">{fmtEuro(x.netCents)}</span></li>
            ))}
          </ul>
        </section>
      )}
      <Confirm open={confirm === "submit"} title={P.submitTitle} text={P.submitText} confirmLabel={P.submit} busy={save.isPending} onConfirm={() => save.mutate(true)} onClose={() => setConfirm(null)} />
      <Sheet title={P.declineTitle} open={confirm === "decline"} onClose={() => setConfirm(null)} footer={<><Button onClick={() => setConfirm(null)}>{t.common.cancel}</Button><Button variant="danger" busy={decline.isPending} onClick={() => decline.mutate()}>{P.decline}</Button></>}>
        <p>{P.declineText}</p>
        <label className="bw-field"><span className="bw-label">{P.declinedReason}</span><input className="bw-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </Sheet>
    </div>
  );
}
