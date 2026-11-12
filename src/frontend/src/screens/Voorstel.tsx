// 4b.6 Het voorstelscherm en "wie deed wat" (bouwplan §9 fase 4b; optiedocument richting B punt 2–3).
// Eén vorm voor elk voorstel van een assistent: per punt NU → NA AANVAARDEN met de BRON, aanpassen vóór aanvaarden, aanvaarden of
// weigeren, ongedaan maken, en de tijdlijn van de taak. Het model komt uit listTasksFor (Rights.taskSight: de rechten van het
// bronscherm; geen bedragen, geen tekst van een assistent). De waarden met bedragen en de opmerkingen komen uit het dossier van de
// soort (readAiCheck, readInvCheck: update-calls met auditregel), enkel bij volle rechten. Beslissen gebeurt met DEZELFDE
// backendacties als in 3.8–3.11 (finishOaRead, applyTenderCheck, finishAiCheck, finishInvCheck, decideBotAction, undoBotAction,
// withdrawOaQuote): het gedrag en de rekenresultaten veranderen niet.
// Waar het voorstel landt: in het paneel van het werkblad (rekenblad: nalezen; werkvorm: vergelijken en factuurcontrole), elders
// (Te doen, de werf) in het eigen voorstelvenster hieronder.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AiCheckOutcome, InvCheckOutcome, type AiCheckFull, type AssistTaskForQuery, type AssistTaskSeen, type InvCheckFull, type TenderDraftRef, type TenderItemView } from "../backend";
import { Button, Confirm, Sheet, Tag, useToast } from "../design";
import { t } from "../texts/nl";
import { errText, fmtEuro, fmtTime, unwrap, useBackend } from "../util";
import * as V from "../app/voorstel";
import { Field } from "./Werven";
import "../app/voorstel.css";

const T = t.voorstel;

/** Alle schermen die een voorstel of zijn dossier tonen, opnieuw laden na een beslissing. */
export function useVoorstelVernieuw() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["taken", "aiChecks", "tenderCompare", "invChecks", "oaInvoiceFull", "oaReads", "oaQuotes", "tender", "tenders", "todo", "botActions", "dossierVoorstel"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

const Q0: AssistTaskForQuery = { workId: undefined, key: "", subject: "", openOnly: false, kind: "", offset: 0n, limit: 0n };

/** De taken die deze persoon ziet (Rights.taskSight). Zolang een assistent werkt, elke 15 s opnieuw (geen push op Caffeine). */
export function useTaken(q: Partial<AssistTaskForQuery>, enabled = true) {
  const { actor, isFetching } = useBackend();
  const full: AssistTaskForQuery = { ...Q0, ...q };
  return useQuery({
    queryKey: ["taken", String(full.workId ?? ""), full.key, full.subject, full.kind, full.openOnly, String(full.offset), String(full.limit)],
    queryFn: async () => { const r = await actor!.listTasksFor(full); return { total: Number(r.total), items: r.items as unknown as V.Gezien[] }; },
    enabled: !!actor && !isFetching && enabled,
    retry: 0,
    refetchInterval: (qq) => (qq.state.data?.items ?? []).some((g) => g.task.state === "wacht" || g.task.state === "bezig") ? 15_000 : false,
  });
}

// ── De kaart ─────────────────────────────────────────────────────────────
export function Assistent({ naam }: { naam: string }) {
  return <span className="vp-wie"><span className="a-todo__sq" aria-hidden="true" />{naam}</span>;
}

/** De kop, de punten (nu → na · bron) en de knoppen; `kolom` = een extra kolom per punt (bv. de keuze per post bij vergelijken). */
export function VoorstelKaart({ g, rijen, knoppen, onder, kolom, testid = "vp-kaart" }: {
  g: V.Gezien; rijen: V.Regel[]; knoppen?: ReactNode; onder?: ReactNode; kolom?: (r: V.Regel) => ReactNode; testid?: string;
}) {
  const k = g.task;
  const p = k.proposal;
  const stand = p ? (V.VOORSTEL_STAND[p.state] ?? p.state) : (T.stand[k.state] ?? k.state);
  const tone = p?.state === "open" ? "accent" : p?.state === "geweigerd" || p?.state === "ongedaan" || k.state === "mislukt" ? "warn" : "neutral";
  return (
    <div className="vp" data-testid={testid} data-key={k.key} data-stand={p?.state ?? k.state} data-full={g.full ? "1" : "0"}>
      <div className="vp-kop">
        <Assistent naam={k.name} />
        <Tag tone={tone}>{stand}</Tag>
        {p?.confidence !== undefined && <span className="bw-muted">{T.zekerheid(Number(p.confidence))}</span>}
      </div>
      <p className="bw-muted vp-meta">
        {[V.SOORT[k.kind] ?? k.kind, g.subjectLabel, k.workCode, T.gegeven(k.givenByName || "BOWACO"), p ? T.vanWie(p.byName, fmtTime(p.at)) : ""].filter(Boolean).join(" · ")}
      </p>
      {!p && (k.state === "wacht" || k.state === "bezig") && <p className="bw-muted">{T.wacht}</p>}
      {p && !g.full && <p className="bw-muted" data-testid="vp-kort">{T.kort}</p>}
      {rijen.length > 0 && (
        <table className="vp-tabel" data-testid="vp-punten">
          <thead><tr><th>{T.kolPunt}</th><th>{T.kolNu}</th><th aria-hidden="true" /><th>{T.kolNa}</th><th>{T.kolBron}</th>{kolom && <th />}</tr></thead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.key} data-punt={r.key} className={r.aangepast ? "vp-rij--aangepast" : undefined}>
                <td>{r.label}{r.aangepast && <> <Tag tone="warn">{T.aangepast}</Tag></>}</td>
                <td>{r.nu}</td>
                <td aria-hidden="true">→</td>
                <td data-geheim={r.geheim ? "1" : undefined}>{r.geheim ? <i>{T.geheim}</i> : r.na}</td>
                <td className="bw-muted">{r.bron}</td>
                {kolom && <td>{kolom(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {onder}
      {knoppen && <div className="a-row vp-knoppen">{knoppen}</div>}
      <Tijdlijn regels={V.wieDeedWat([g])} kort />
    </div>
  );
}

/** Wie deed wat: de mens of de assistent, en wat er veranderde. */
export function Tijdlijn({ regels, kort, max = 40, onKies }: { regels: V.TijdRegel[]; kort?: boolean; max?: number; onKies?: (key: string) => void }) {
  const [alles, setAlles] = useState(false);
  if (regels.length === 0) return null;
  const toon = alles ? regels : regels.slice(0, max);
  return (
    <div className="vp-tijd" data-testid="vp-tijdlijn">
      {kort && <span className="bw-label">{T.wieTitel}</span>}
      <ol>
        {toon.map((r, i) => (
          <li key={`${r.key}${i}`} data-wie={r.assistent ? "assistent" : "mens"}>
            <span className="bw-mono vp-tijd__at">{fmtTime(r.at)}</span>
            {r.assistent ? <Assistent naam={r.wie} /> : <b>{r.wie}</b>}
            <span>{r.wat}</span>
            {!kort && (onKies
              ? <button type="button" className="bw-link" onClick={() => onKies(r.key)} data-testid="vp-tijd-open">{[r.taak, r.stuk].filter(Boolean).join(" · ")}</button>
              : <span className="bw-muted">{[r.taak, r.stuk].filter(Boolean).join(" · ")}</span>)}
          </li>
        ))}
      </ol>
      {!alles && regels.length > max && <Button size="sm" variant="quiet" onClick={() => setAlles(true)}>{T.wieMeer}</Button>}
    </div>
  );
}

/** Per werf (of per stuk): elke taak van een assistent, nieuwste eerst. */
export function WieDeedWat({ workId, subject, titel = true, go, verberg }: { workId?: bigint; subject?: string; titel?: boolean; go?: (to: string) => void; verberg?: boolean }) {
  const q = useTaken({ workId, subject: subject ?? "" });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isError) return null;
  const regels = V.wieDeedWat(q.data?.items ?? []);
  if (verberg && regels.length === 0) return null;
  return (
    <section className="a-section vp-wie" data-testid="vp-wie">
      {titel && <h2 className="bw-h2">{T.wieTitel}</h2>}
      {titel && <p className="bw-muted">{T.wieLead}</p>}
      {q.data && regels.length === 0 && <p className="bw-muted">{T.wieGeen}</p>}
      <Tijdlijn regels={regels} max={12} onKies={go ? setOpen : undefined} />
      {open && go && <VoorstelVenster taskKey={open} go={go} onClose={() => setOpen(null)} />}
    </section>
  );
}

// ── Beslissen: dezelfde backendacties als vroeger ───────────────────────
function useBeslis() {
  const { actor } = useBackend();
  const toast = useToast();
  const vernieuw = useVoorstelVernieuw();
  const fail = (e: unknown) => toast.show({ kind: "error", text: errText(e) });
  return useMutation({
    mutationFn: async (x: { g: V.Gezien; doe: "aanvaard" | "weiger" | "ongedaan"; reden?: string; oaQuoteId?: bigint }) => {
      const k = x.g.task;
      const b = V.bronVan(k.key);
      if (!b) throw new Error("Onbekende taak");
      if (b.soort === "check") {
        unwrap(await actor!.finishAiCheck(b.id, x.doe === "aanvaard" ? AiCheckOutcome.seen : AiCheckOutcome.cancelled));
      } else if (b.soort === "invcheck") {
        unwrap(await actor!.finishInvCheck(b.id, x.doe === "aanvaard" ? InvCheckOutcome.seen : InvCheckOutcome.cancelled));
      } else if (b.soort === "oaread") {
        if (x.doe === "weiger") unwrap(await actor!.finishOaRead(b.id, { __kind__: "rejected", rejected: x.reden ?? "" }));
        else if (x.doe === "ongedaan") {
          if (x.oaQuoteId === undefined) throw new Error("De offerte van dit voorstel is niet gevonden");
          unwrap(await actor!.withdrawOaQuote(x.oaQuoteId, x.reden ?? "", false));
        } else throw new Error(T.aanpassen);
      } else if (b.soort === "bot") {
        if (x.doe === "ongedaan") unwrap(await actor!.undoBotAction(b.id));
        else unwrap(await actor!.decideBotAction(b.id, x.doe === "aanvaard", ""));
      }
      return x.doe;
    },
    onSuccess: (d) => { toast.show({ kind: "ok", text: d === "aanvaard" ? T.aanvaardOk : d === "weiger" ? T.weigerOk : T.ongedaanOk }); vernieuw(); },
    onError: fail,
  });
}

/** Weigeren of ongedaan maken vraagt een bevestiging (nooit window.confirm); intrekken en weigeren bij inlezen vragen een reden. */
function BeslisKnoppen({ g, naarStuk, aanvaard, extra }: { g: V.Gezien; naarStuk?: () => void; aanvaard?: ReactNode; extra?: ReactNode }) {
  const { actor, isFetching } = useBackend();
  const beslis = useBeslis();
  const [vraag, setVraag] = useState<"weiger" | "ongedaan" | null>(null);
  const [reden, setReden] = useState("");
  const b = V.bronVan(g.task.key);
  const open = V.kanBeslissen(g);
  const undo = V.ongedaanHandeling(g);
  const inlezen = b?.soort === "oaread";
  // Ongedaan maken van een ingelezen offerte = intrekken: de offerte zoeken in de opdrachten van de werf (enkel kantoor).
  const reads = useQuery({ queryKey: ["oaReads", String(g.task.workId ?? "")], queryFn: () => actor!.listOaReads(g.task.workId!), enabled: !!actor && !isFetching && inlezen && undo === "intrekken" && g.task.workId !== undefined, retry: 0 });
  const oaQuoteId = reads.data?.find((r) => r.id === b?.id)?.oaQuoteId;
  const redenNodig = inlezen;
  const doe = (d: "aanvaard" | "weiger" | "ongedaan") => beslis.mutate({ g, doe: d, reden: reden.trim(), oaQuoteId }, { onSuccess: () => { setVraag(null); setReden(""); } });
  return (
    <>
      {open && (aanvaard ?? (inlezen
        ? naarStuk && <Button variant="secondary" onClick={naarStuk} data-testid="vp-aanpassen">{T.aanpassen}</Button>
        : <Button variant="secondary" busy={beslis.isPending && beslis.variables?.doe === "aanvaard"} onClick={() => doe("aanvaard")} data-testid="vp-aanvaard">{b?.soort === "bot" ? T.aanvaarden : T.gezien}</Button>))}
      {open && <Button variant="quiet" onClick={() => setVraag("weiger")} data-testid="vp-weiger">{T.weigeren}</Button>}
      {undo !== "" && undo !== "gedaan" && <Button variant="quiet" icon="back" onClick={() => setVraag("ongedaan")} data-testid="vp-ongedaan">{T.ongedaan}</Button>}
      {extra}
      {naarStuk && !(open && inlezen) && <Button variant="quiet" icon="next" onClick={naarStuk} data-testid="vp-naar">{T.naarStuk}</Button>}
      {vraag && !(redenNodig || (vraag === "ongedaan" && undo === "intrekken")) && (
        <Confirm open title={vraag === "weiger" ? T.weigerTitel : T.ongedaanTitel} text={vraag === "weiger" ? T.weigerTekst : T.ongedaanOntkoppelen} confirmLabel={vraag === "weiger" ? T.weigeren : T.ongedaan} cancelLabel={t.common.cancel} busy={beslis.isPending} onConfirm={() => doe(vraag)} onClose={() => setVraag(null)} />
      )}
      {vraag && (redenNodig || (vraag === "ongedaan" && undo === "intrekken")) && (
        <Sheet title={vraag === "weiger" ? T.weigerTitel : T.ongedaanTitel} open onClose={() => setVraag(null)} footer={<>
          <Button onClick={() => setVraag(null)}>{t.common.cancel}</Button>
          <Button variant="danger" busy={beslis.isPending} disabled={reden.trim().length < 3 || (vraag === "ongedaan" && oaQuoteId === undefined)} onClick={() => doe(vraag)} data-testid="vp-reden-ok">{vraag === "weiger" ? T.weigeren : T.ongedaan}</Button>
        </>}>
          <p className="bw-muted">{vraag === "weiger" ? T.weigerTekst : T.ongedaanIntrekken}</p>
          <Field label={T.reden}><input className="bw-input" value={reden} maxLength={300} onChange={(e) => setReden(e.target.value)} data-testid="vp-reden" /></Field>
        </Sheet>
      )}
    </>
  );
}

/** Waar het stuk van een taak staat (dezelfde routes als Te doen). */
export function stukRoute(g: V.Gezien): string | null {
  const k = g.task;
  const w = k.workId !== undefined ? String(k.workId) : null;
  const [soort, id] = k.subject.split(":");
  switch (k.kind) {
    case "oa-offerte-inlezen": return w ? `werven/${w}/offerte/oa-offertes` : null;
    case "offertes-vergelijken": return w ? `werven/${w}/offerte/prijsvragen` : null;
    case "offerte-nalezen": return w ? `werven/${w}/offerte` : null;
    case "factuurcontrole": return soort === "oa-factuur" && id ? `oa-facturen/${id}` : w ? `werven/${w}/facturatie` : null;
    default: return k.key.startsWith("bot:") ? "beheer/ai" : null;
  }
}

/** Het eigen voorstelvenster (Te doen, de werf, Beheer): het model, en het dossier waar het voorstel niet in een werkblad landt. */
export function VoorstelVenster({ taskKey, go, onClose }: { taskKey: string; go?: (to: string) => void; onClose: () => void }) {
  const q = useTaken({ key: taskKey });
  const g = q.data?.items[0];
  return (
    <Sheet title={g ? T.venster(g.task.name) : T.titel} open side onClose={onClose} footer={<Button onClick={onClose}>{t.common.close}</Button>}>
      {q.data && !g && <p className="a-empty">{T.geen}</p>}
      {g && <VoorstelInhoud g={g} go={go ? (to) => { onClose(); go(to); } : undefined} />}
    </Sheet>
  );
}

/** Kaart + knoppen voor één taak, zonder werkblad. Bij een open voorstel van nalezen, vergelijken of factuurcontrole leest het
 *  venster het dossier (zoals de knop Bekijken van 3.9–3.11), zodat niemand aanvaardt zonder de opmerkingen of keuzes te zien;
 *  een vergelijking aanvaard je in het werkblad (per post, met de huidige keuze ernaast). */
export function VoorstelInhoud({ g, go }: { g: V.Gezien; go?: (to: string) => void }) {
  const { actor } = useBackend();
  const route = stukRoute(g);
  const b = V.bronVan(g.task.key);
  const open = V.kanBeslissen(g);
  const ac = useDossier<AiCheckFull>("check", b?.id, async (x) => unwrap(await actor!.readAiCheck(x)), open && b?.soort === "check");
  const ic = useDossier<InvCheckFull>("invcheck", b?.id, async (x) => unwrap(await actor!.readInvCheck(x)), open && b?.soort === "invcheck");
  const vergelijk = g.task.kind === "offertes-vergelijken";
  const firma = new Map((ac.data?.picks ?? []).filter((p) => p.oaQuoteId !== undefined).map((p) => [String(p.oaQuoteId), p.orgName]));
  const rijen = V.regels(g.task, { firmaVan: (q) => firma.get(q), postNaam: (it) => { const p = ac.data?.picks.find((x) => String(x.itemId) === it); return p ? t.nakijken.post(Number(p.pos)) : `Post ${it}`; } });
  const fs = ac.data?.findings ?? [];
  const onder = ac.data ? (
    <>
      {ac.data.brief.stale && <p className="a-tag a-tag--warn">{T.stale}</p>}
      {ac.data.summary && <p>{ac.data.summary}</p>}
      {fs.length > 0 && <ul className="vs-findings">{fs.map((f, k) => <li key={k}><b>{t.nakijken.kinds[f.kind] ?? f.kind}</b>{f.pos !== undefined ? ` (${t.nakijken.post(Number(f.pos))})` : ""}: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}</ul>}
      <p className="bw-muted">{t.nakijken.notChecked}</p>
    </>
  ) : ic.data?.result ? (
    <>
      {ic.data.result.summary && <p>{ic.data.result.summary}</p>}
      {ic.data.result.findings.length > 0 && <ul className="vs-findings">{ic.data.result.findings.map((f, k) => <li key={k}><b>{t.factuurControle.kinds[f.kind] ?? f.kind}</b>: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}</ul>}
      <p className="bw-muted">{t.factuurControle.notChecked}</p>
    </>
  ) : undefined;
  const naar = route && go ? () => go(route) : undefined;
  return <VoorstelKaart g={g} rijen={rijen} onder={onder} knoppen={g.full ? <BeslisKnoppen g={g} naarStuk={naar} aanvaard={vergelijk && naar ? <Button variant="secondary" onClick={naar} data-testid="vp-aanpassen">{T.aanpassen}</Button> : undefined} /> : undefined} />;
}

/** In de kaart van Te doen: het voorstel van de assistent achter deze regel (sleutel = de sleutel van de taak). */
export function TodoVoorstel({ todoKey, go }: { todoKey: string; go: (to: string) => void }) {
  const ok = /^(oaread|check|invcheck|bot):\d+$/.test(todoKey);
  const q = useTaken({ key: todoKey }, ok);
  const g = q.data?.items[0];
  if (!ok || !g) return null;
  return <VoorstelInhoud g={g} go={go} />;
}

// ── Landing in het werkblad ──────────────────────────────────────────────
/** Het dossier van een open voorstel één keer lezen (update-call met auditregel, zoals de knop Bekijken van 3.9–3.11). */
function useDossier<T>(soort: string, id: bigint | undefined, lees: (id: bigint) => Promise<T>, aan: boolean) {
  const { actor, isFetching } = useBackend();
  return useQuery({ queryKey: ["dossierVoorstel", soort, String(id ?? "")], queryFn: () => lees(id!), enabled: !!actor && !isFetching && aan && id !== undefined, retry: 0, staleTime: Infinity, gcTime: 0 });
}

/** 3.9 in de werkvorm Vergelijken: het voorstel per post (nu = de keuze in het blad → na = de firma van de assistent). */
export type VergelijkVoorstel = { g?: V.Gezien; full?: AiCheckFull; perPost: Map<string, { oaQuoteId?: bigint; orgName: string; reason: string }> };

export function useVergelijkVoorstel(tenderId: bigint, lees: boolean): VergelijkVoorstel {
  const { actor } = useBackend();
  const q = useTaken({ subject: `prijsvraag:${tenderId}`, kind: "offertes-vergelijken" });
  const g = V.huidige(q.data?.items ?? []);
  const id = g ? V.bronVan(g.task.key)?.id : undefined;
  // Review 4b.6 L5: het dossier pas lezen als iemand het tabblad Voorstel opent (elke lezing = een auditregel, zoals Bekijken in 3.9).
  const d = useDossier("check", id, async (x) => unwrap(await actor!.readAiCheck(x)), lees && !!g && V.kanBeslissen(g));
  const perPost = useMemo(() => new Map((d.data?.picks ?? []).map((p) => [String(p.itemId), { oaQuoteId: p.oaQuoteId, orgName: p.orgName, reason: p.reason }])), [d.data]);
  return { g, full: d.data, perPost };
}

/** Het blok in het lijnpaneel van de gekozen post. */
export function VergelijkLijn({ vv, itemId, nuOrg, open, onNeem }: { vv: VergelijkVoorstel; itemId: bigint; nuOrg?: string; open: boolean; onNeem: (oaQuoteId: bigint) => void }) {
  const x = vv.perPost.get(String(itemId));
  if (!vv.g || !x || !V.kanBeslissen(vv.g)) return null;
  const gelijk = nuOrg !== undefined && nuOrg === x.orgName;
  return (
    <div className="rb-blok vp-lijn" data-testid="vp-lijn">
      <h4><Assistent naam={vv.g.task.name} /></h4>
      <p className="bw-mono">{T.lijnNu(nuOrg ?? T.lijnGeenKeuze)} → {T.lijnNa(x.oaQuoteId !== undefined ? x.orgName : T.lijnGeenKeuze)}</p>
      {x.reason && <p className="bw-muted">{x.reason}</p>}
      {open && x.oaQuoteId !== undefined && !gelijk && <Button size="sm" onClick={() => onNeem(x.oaQuoteId!)} data-testid="vp-lijn-neem">{T.lijnNeem}</Button>}
    </div>
  );
}

type Keus = "voorstel" | "huidig" | "geen";

/** Het tabblad Voorstel in Vergelijken: alle posten nu → na, per post een keuze, dan overnemen (applyTenderCheck). */
export function VergelijkVoorstelTab({ vv, items, drafts, target0, isOpen, dirty, huidig, firmaVan, onKlaar }: {
  vv: VergelijkVoorstel; items: TenderItemView[]; drafts: TenderDraftRef[]; target0: string; isOpen: boolean; dirty: boolean;
  huidig: Map<string, bigint>; firmaVan: (oaQuoteId: string) => string | undefined; onKlaar: (picks: Map<string, bigint>, reasons: Record<string, string>) => void;
}) {
  const { actor } = useBackend();
  const toast = useToast();
  const vernieuw = useVoorstelVernieuw();
  const [keus, setKeus] = useState<Record<string, Keus>>({});
  const [doel, setDoel] = useState(target0);
  const [vraag, setVraag] = useState(false);
  useEffect(() => { setDoel(target0); }, [target0]);
  const g = vv.g;
  const postNaam = (itemId: string) => { const x = items.find((i) => String(i.id) === itemId); return x ? `${x.code ? `${x.code} ` : ""}${x.title}` : `Post ${itemId}`; };
  const picks = useMemo(() => {
    const out: { itemId: bigint; oaQuoteId?: bigint; reason: string }[] = [];
    for (const [it, x] of vv.perPost) {
      const k = keus[it] ?? "voorstel";
      const nu = huidig.get(it);
      if (k === "voorstel" && x.oaQuoteId !== undefined) out.push({ itemId: BigInt(it), oaQuoteId: x.oaQuoteId, reason: "" });
      else if (k === "huidig" && nu !== undefined) out.push({ itemId: BigInt(it), oaQuoteId: nu, reason: "" });
    }
    return out;
  }, [vv.perPost, keus, huidig]);
  const neem = useMutation({
    mutationFn: async () => unwrap(await actor!.applyTenderCheck(V.bronVan(g!.task.key)!.id, picks, BigInt(doel))),
    onSuccess: (r) => {
      toast.show({ kind: "ok", text: T.overnemenOk(Number(r.lines)) });
      if (r.skipped.length) toast.show({ kind: "error", text: r.skipped.join("; ") });
      setVraag(false);
      // Review 4b.6 M2: het blad krijgt dezelfde keuzes als de server (de overgenomen posten met de reden van het voorstel, zoals
      // applyTenderCheck ze bewaart), anders staat het blad als "niet bewaard" en zou Bewaren de overname overschrijven.
      const m = new Map(huidig);
      const rs: Record<string, string> = {};
      for (const k of picks) { if (k.oaQuoteId !== undefined) { m.set(String(k.itemId), k.oaQuoteId); const why = vv.perPost.get(String(k.itemId))?.reason ?? ""; rs[String(k.itemId)] = why ? `[voorstel] ${why}`.slice(0, 300) : ""; } }
      onKlaar(m, rs);
      vernieuw();
    },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  if (!g) return <p className="bw-muted">{T.geen}</p>;
  const open = V.kanBeslissen(g);
  const rijen = V.regels(g.task, {
    postNaam, firmaVan,
    nu: (key) => key.startsWith("post:") ? (huidig.has(key.slice(5)) ? firmaVan(String(huidig.get(key.slice(5)))) ?? T.lijnGeenKeuze : T.lijnGeenKeuze) : undefined,
    na: (key) => key.startsWith("post:") ? vv.perPost.get(key.slice(5))?.orgName || undefined : undefined,
  });
  const versie = Number(drafts.find((x) => String(x.versionId) === doel)?.version ?? 0n);
  const overneem = isOpen && drafts.length > 0 && picks.length > 0 && !vv.full?.brief.stale ? (
    <>
      <select className="bw-input pv-sm" aria-label={t.nakijken.applyTo} value={doel} onChange={(e) => setDoel(e.target.value)} data-testid="vp-doel">{drafts.map((x) => <option key={String(x.versionId)} value={String(x.versionId)}>{t.offertes.version(Number(x.version))}</option>)}</select>
      <Button variant="secondary" disabled={dirty || !doel} title={dirty ? T.eerstBewaren : undefined} onClick={() => setVraag(true)} data-testid="vp-overnemen">{T.overnemen(versie)}</Button>
    </>
  ) : undefined;
  const zetGezien = () => { void (async () => { try { unwrap(await actor!.finishAiCheck(V.bronVan(g.task.key)!.id, AiCheckOutcome.seen)); toast.show({ kind: "ok", text: T.aanvaardOk }); vernieuw(); } catch (e) { toast.show({ kind: "error", text: errText(e) }); } })(); };
  return (
    <>
      {vv.full?.brief.stale && <p className="a-tag a-tag--warn">{T.stale}</p>}
      <VoorstelKaart g={g} rijen={rijen}
        kolom={open && isOpen ? (r) => r.key.startsWith("post:") ? (
          <select className="bw-input pv-sm" aria-label={`${T.perPost}: ${r.label}`} value={keus[r.key.slice(5)] ?? "voorstel"} onChange={(e) => setKeus((k) => ({ ...k, [r.key.slice(5)]: e.target.value as Keus }))} data-testid="vp-keus">
            <option value="voorstel">{T.keusVoorstel}</option>
            {huidig.has(r.key.slice(5)) && <option value="huidig">{T.keusHuidig}</option>}
            <option value="geen">{T.keusGeen}</option>
          </select>
        ) : null : undefined}
        onder={vv.full && vv.full.summary ? <p className="bw-muted">{vv.full.summary}</p> : undefined}
        knoppen={<BeslisKnoppen g={g} aanvaard={overneem} extra={overneem && open ? <Button variant="quiet" onClick={zetGezien} data-testid="vp-gezien">{T.gezien}</Button> : undefined} />}
      />
      <Confirm open={vraag} title={T.overnemenTitel} text={T.overnemenTekst(picks.length, versie)} confirmLabel={T.overnemen(versie)} cancelLabel={t.common.cancel} busy={neem.isPending} onConfirm={() => neem.mutate()} onClose={() => setVraag(false)} />
    </>
  );
}

/** 3.10 in de werkvorm Factuurcontrole: nu = de stand van de factuur → na = het oordeel van de assistent, met de opmerkingen. */
export function FactuurVoorstelTab({ invoiceId, standNu }: { invoiceId: bigint; standNu: string }) {
  const { actor } = useBackend();
  const q = useTaken({ subject: `oa-factuur:${invoiceId}`, kind: "factuurcontrole" });
  const g = V.huidige(q.data?.items ?? []);
  const id = g ? V.bronVan(g.task.key)?.id : undefined;
  const d = useDossier<InvCheckFull>("invcheck", id, async (x) => unwrap(await actor!.readInvCheck(x)), !!g && V.kanBeslissen(g));
  if (!g) return q.data ? <p className="bw-muted">{T.geen}</p> : null;
  const r = d.data?.result;
  const rijen = V.regels(g.task, { nu: (key) => key === "oordeel" ? T.nuFactuur(standNu) : undefined });
  return (
    <VoorstelKaart g={g} rijen={rijen} testid="vp-factuur"
      onder={r ? (
        <>
          {r.summary && <p>{r.summary}</p>}
          {r.findings.length > 0 && <ul className="vs-findings">{r.findings.map((f, k) => <li key={k}><b>{t.factuurControle.kinds[f.kind] ?? f.kind}</b>: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}</ul>}
          <p className="bw-muted">{t.factuurControle.notChecked}</p>
        </>
      ) : undefined}
      knoppen={g.full ? <BeslisKnoppen g={g} /> : undefined} />
  );
}

/** 3.11 in het rekenblad: de opmerkingen bij het nalezen, per lijn (pos = de plaats van de lijn in de bewaarde versie). */
export function useNalezenVoorstel(versionId: bigint, lees: boolean) {
  const { actor } = useBackend();
  const q = useTaken({ subject: `offerteversie:${versionId}`, kind: "offerte-nalezen" });
  const g = V.huidige(q.data?.items ?? []);
  const id = g ? V.bronVan(g.task.key)?.id : undefined;
  // Het dossier pas lezen als iemand het tabblad Voorstel opent (elke lezing = een auditregel).
  const d = useDossier<AiCheckFull>("check", id, async (x) => unwrap(await actor!.readAiCheck(x)), lees && !!g && V.kanBeslissen(g));
  return { g, full: d.data, loaded: !!q.data };
}

export function NalezenVoorstelTab({ nv, lijnNaam, spring }: { nv: ReturnType<typeof useNalezenVoorstel>; lijnNaam: (pos: number) => string | undefined; spring: (pos: number) => void }) {
  const { g, full } = nv;
  if (!g) return nv.loaded ? <p className="bw-muted">{T.geen}</p> : null;
  return (
    <VoorstelKaart g={g} rijen={V.regels(g.task)} testid="vp-nalezen"
      onder={full ? (
        <>
          {full.brief.stale && <p className="a-tag a-tag--warn">{T.stale}</p>}
          {full.summary && <p>{full.summary}</p>}
          {full.findings.length > 0 && (
            <ul className="vs-findings" data-testid="vp-opmerkingen">
              {full.findings.map((f, k) => {
                const pos = f.pos !== undefined ? Number(f.pos) : undefined;
                const naam = pos !== undefined ? lijnNaam(pos) : undefined;
                return <li key={k}><b>{t.nakijken.kinds[f.kind] ?? f.kind}</b>{naam ? <> (<button type="button" className="bw-link" onClick={() => spring(pos!)}>{naam}</button>)</> : pos !== undefined ? ` (${t.nakijken.post(pos)})` : ""}: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>;
              })}
            </ul>
          )}
          <p className="bw-muted">{t.nakijken.notChecked}</p>
        </>
      ) : undefined}
      knoppen={g.full ? <BeslisKnoppen g={g} /> : undefined} />
  );
}

/** In het lijnpaneel van het rekenblad: de opmerkingen van het nalezen bij deze lijn (als het tabblad Voorstel ze al las). */
export function NalezenLijn({ nv, pos }: { nv: ReturnType<typeof useNalezenVoorstel>; pos: number | undefined }) {
  if (pos === undefined || !nv.g || !nv.full || nv.full.brief.stale || !V.kanBeslissen(nv.g)) return null;
  const fs = nv.full.findings.filter((f) => f.pos !== undefined && Number(f.pos) === pos);
  if (fs.length === 0) return null;
  return (
    <div className="rb-blok vp-lijn" data-testid="vp-lijn">
      <h4><Assistent naam={nv.g.task.name} /></h4>
      <ul className="vs-findings">{fs.map((f, k) => <li key={k}><b>{t.nakijken.kinds[f.kind] ?? f.kind}</b>: {f.text}{f.cents !== undefined ? ` (${fmtEuro(f.cents)})` : ""}</li>)}</ul>
    </div>
  );
}
