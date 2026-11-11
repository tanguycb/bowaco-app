// Het rekenblad (stap 4b.3b, bouwplan §9 rij 4b.3b; optiedocument §2b.2): de offerte-editor als werkblad over het hele scherm.
// Links de inhoud (hoofdstukken), in het midden een dicht raster, rechts het paneel van de gekozen lijn (herkomst van de kost,
// marge, tekst), onderaan de totalen die altijd in beeld blijven. Rekenen, controleregels, versies en PDF zijn die van de
// klassieke editor (quote/calc.ts, rules.ts, Offertes.tsx); dit scherm verandert enkel de vorm. De zuivere kern (kolommen per
// rol, indeling, ongedaan maken, plakken, verplaatsen, klaar om te bewaren) staat in quote/blad.ts.
// Enkel #full (beheerder, calculator): wie geen aankoopprijs ziet, krijgt de klassieke weergave zonder prijzen per post.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent as RKE, type ReactNode } from "react";
import { QuoteScope, type Caps, type LibItemView, type LibPriceView, type OrgView, type QuotePrevPrice, type QuoteRead, type UnitView } from "../backend";
import { Button, Icon, Info, Meer, useToast, type MeerItem } from "../design";
import { Cijfer } from "../design/Pop";
import * as B from "../quote/blad.ts";
import type { LineOut, Totals } from "../quote/calc.ts";
import * as M from "../quote/model.ts";
import type { Finding } from "../quote/rules.ts";
import { t } from "../texts/nl";
import { errText, fmtBp, fmtDayNum, fmtEuro, parseEuro, parsePct, unwrap, useBackend } from "../util";
import { ChapterMargin, FormPanel } from "./OfferteVorm";
import { fmtQty, parseQty } from "./Offertes";

const T = t.blad;
const O = t.offertes;
const FORMS = ["vh", "fixed", "regie", "estimate", "budget", "perAttachment"];

export type BladActies = {
  versturen?: () => void;
  pdf?: () => void;
  nieuweVersie?: () => void;
  aanvaard?: () => void;
  geweigerd?: () => void;
  mail?: () => void;
  getekend?: () => void;
  archiveren?: () => void;
  dearchiveren?: () => void;
  kop?: () => void;
  soort?: () => void;
  bibHoofdstukken?: () => void;
  bib?: (chapterKey: string) => void;
  herlaad: () => void;
  klassiek: () => void;
  werf: () => void;
  werfStart?: ReactNode;
};
export type BladProps = {
  read: QuoteRead;
  m: M.Model;
  caps: Caps;
  editable: boolean;
  /** elke wijziging: één stap ongedaan maken */
  edit: (f: (m: M.Model) => void) => void;
  ongedaan: () => void;
  opnieuw: () => void;
  kanTerug: boolean;
  kanVooruit: boolean;
  units: UnitView[];
  orgs: OrgView[];
  findings: Finding[];
  rulesLoaded: boolean;
  totals: Totals;
  pending: number;
  bewaar: { saving: boolean; savedAt: number | null; fout: string | null; wacht: B.Probleem[]; serverOk: boolean | null; opnieuw: () => void };
  diff: { label: string | null; marks: Map<string, "new" | "changed"> | null; gone: number; laad: () => void };
  self: { failed: string[]; passed: number };
  acties: BladActies;
  go: (to: string) => void;
};

const euro2 = (c: bigint | null) => (c === null ? "" : (Number(c) / 100).toFixed(2).replace(".", ","));
const pct = (bp: bigint) => (Number(bp) / 100).toLocaleString("nl-BE");
const fmtMarge = (bp: bigint | null | undefined) => (bp === null || bp === undefined ? "—" : bp < 0n ? `−${fmtBp(-bp)}` : fmtBp(bp));
const tijd = (ms: number) => new Date(ms).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });

function useVenster() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

// ── Cellen ───────────────────────────────────────────────────────────────
/** Een cel die je intikt: de tekst blijft tot je de cel verlaat (Enter, Tab, pijltje); Esc zet terug. Eén wijziging = één stap
 *  ongedaan maken. Zolang je typt, is Ctrl+Z die van de browser (data-draft). */
function Cel({ value, onCommit, col, label, num, placeholder, bad, wide, max }: { value: string; onCommit: (s: string) => boolean; col: string; label: string; num?: boolean; placeholder?: string; bad?: boolean; wide?: boolean; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [fout, setFout] = useState(false);
  const afbreken = useRef(false); // Esc: blur mag de getikte waarde niet meer bewaren (review)
  const commit = () => {
    if (afbreken.current) { afbreken.current = false; return; }
    if (draft === null) return;
    if (draft === value) { setDraft(null); setFout(false); return; }
    if (onCommit(draft)) { setDraft(null); setFout(false); } else setFout(true);
  };
  return (
    <input
      className={`rb-in${num ? " rb-in--num" : ""}${fout || bad ? " rb-in--bad" : ""}${wide ? " rb-in--wide" : ""}`}
      data-col={col}
      data-draft={draft !== null ? "1" : undefined}
      aria-label={label}
      aria-invalid={fout || bad || undefined}
      title={fout ? O.badNumber : undefined}
      inputMode={num ? "decimal" : undefined}
      maxLength={max}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { afbreken.current = true; setDraft(null); setFout(false); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

// ── Het blad ─────────────────────────────────────────────────────────────
export function Rekenblad(p: BladProps) {
  const { read, m, caps, editable, edit, units, totals } = p;
  const toast = useToast();
  const { actor } = useBackend();
  const breedte = useVenster();
  const [weergave, setWeergave] = useState<B.Weergave>("calc");
  const [open, setOpen] = useState<{ inhoud?: boolean; paneel?: boolean }>({});
  const [tab, setTab] = useState<"lijn" | "controle" | "offerte">("lijn");
  const [cur, setCur] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anker = useRef<string | null>(null);
  const plek = useRef<{ chapter: string | null; na: string | null }>({ chapter: null, na: null });
  const [drop, setDrop] = useState<{ key: string; where: "voor" | "na" | "in" } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLDivElement>(null);

  const chapters = M.activeChapters(m);
  const ind = B.indeling(breedte, chapters.length, open);
  const kol = B.kolommen("full", weergave);
  const ro = !editable || weergave === "klant";
  const volgorde = M.activeLines(m).map((l) => l.key);
  const nr = new Map(volgorde.map((k, i) => [k, i + 1]));
  const wacht = new Set(p.bewaar.wacht.map((x) => x.key));
  const findingCh = new Set(p.findings.flatMap((f) => f.chapterIds));
  const findingLn = new Set(p.findings.flatMap((f) => f.lineIds));
  for (const l of M.activeLines(m)) if (findingLn.has(l.key)) findingCh.add(l.chapter);

  // De hoogte: van onder de bovenbalk tot de onderkant van het venster (de totalen blijven onderaan in beeld).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const zet = () => { el.style.height = `${Math.max(420, window.innerHeight - el.getBoundingClientRect().top - window.scrollY)}px`; };
    zet();
    window.addEventListener("resize", zet);
    return () => window.removeEventListener("resize", zet);
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z ook als de focus nergens staat (bv. na Esc in een cel of een klik naast het raster): de toets komt
  // dan op <body> binnen, buiten het blad (draftproef 11-11).
  const terugRef = useRef({ ongedaan: p.ongedaan, opnieuw: p.opnieuw });
  terugRef.current = { ongedaan: p.ongedaan, opnieuw: p.opnieuw };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target !== document.body || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) terugRef.current.opnieuw(); else terugRef.current.ongedaan(); }
      else if (k === "y") { e.preventDefault(); terugRef.current.opnieuw(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Een weergave zonder vorige versie kan niet; het verschil laadt de vorige versie één keer.
  useEffect(() => { if (weergave === "verschil" && !p.diff.marks) p.diff.laad(); }, [weergave]); // eslint-disable-line react-hooks/exhaustive-deps
  // Een gekozen lijn die weg is, telt niet meer.
  const curLine = cur ? m.lines.find((l) => l.key === cur && !l.removed) ?? null : null;

  const focusCel = (key: string, col: string) => requestAnimationFrame(() => {
    const el = raster.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"] [data-col="${col}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  });

  // ── toetsen ──
  const onKey = (e: RKE<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !el.dataset.draft) {
      if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !el.dataset.col)) return; // een gewoon veld: de browser
      e.preventDefault();
      if (e.shiftKey) p.opnieuw(); else p.ongedaan();
      return;
    }
    if (mod && e.key.toLowerCase() === "y" && !el.dataset.draft) { e.preventDefault(); p.opnieuw(); return; }
    // Pijltjes en Enter in een cel: naar dezelfde kolom erboven of eronder (zoals in een spreadsheet).
    const col = el.dataset.col;
    if (col && raster.current && el.tagName !== "SELECT") {
      const dir = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 0;
      if (dir && !(col === "nieuw" && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter"))) {
        const cells = [...raster.current.querySelectorAll<HTMLElement>(`[data-col="${col}"]`)];
        const next = cells[cells.indexOf(el) + dir];
        if (next) { e.preventDefault(); next.focus(); if (next instanceof HTMLInputElement) next.select(); }
        return;
      }
    }
    // Op een rijnummer: de gekozen rijen.
    if (el.dataset.greep) {
      const k = el.dataset.greep;
      if ((e.key === "Delete" || e.key === "Backspace") && editable && weergave !== "klant") { e.preventDefault(); weg([...(sel.size ? sel : new Set([k]))]); }
      else if (mod && e.key.toLowerCase() === "d" && editable) { e.preventDefault(); dupliceer([...(sel.size ? sel : new Set([k]))]); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = volgorde.indexOf(k) + (e.key === "ArrowDown" ? 1 : -1);
        const n = volgorde[i];
        if (n) { kies(n, e.shiftKey ? "bereik" : "een"); raster.current?.querySelector<HTMLElement>(`[data-greep="${CSS.escape(n)}"]`)?.focus(); }
      } else if (e.key === "Escape") { setSel(new Set()); }
    } else if (e.key === "Escape" && !col) {
      if (ind.paneel === "zwevend") setOpen((o) => ({ ...o, paneel: false }));
      else if (ind.inhoud === "zwevend") setOpen((o) => ({ ...o, inhoud: false }));
      else setSel(new Set());
    }
  };

  const kies = (k: string, how: "een" | "bereik" | "erbij") => {
    setCur(k);
    if (how === "bereik" && anker.current) setSel(new Set(B.bereik(volgorde, anker.current, k)));
    else if (how === "erbij") setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    else { setSel(new Set([k])); anker.current = k; }
    if (how !== "bereik") anker.current = k;
  };
  const weg = (keys: string[]) => {
    if (!keys.length) return;
    edit((mm) => B.verwijder(mm, keys));
    setSel(new Set());
    toast.show({ kind: "ok", text: `${keys.length} × ${O.remove.toLowerCase()}`, action: { label: T.ongedaan.split(" (")[0], run: p.ongedaan } });
  };
  const dupliceer = (keys: string[]) => {
    let nieuw: string[] = [];
    edit((mm) => { nieuw = B.dupliceer(mm, keys); });
    setSel(new Set(nieuw));
  };

  // ── plakken en kopiëren ──
  const onPaste = (e: React.ClipboardEvent) => {
    if (!editable || weergave === "klant") return;
    // enkel in het raster; een tekstvak of een veld in het paneel plakt gewoon (review)
    const doel = e.target as HTMLElement;
    if (doel.tagName === "TEXTAREA" || !raster.current?.contains(doel)) return;
    const tekst = e.clipboardData.getData("text/plain");
    if (!B.isPlak(tekst)) return;
    e.preventDefault();
    const pl = B.leesPlak(tekst, units.map((u) => ({ key: u.key, name: u.name })));
    if (!pl.rijen.length) { toast.show({ kind: "error", text: T.plakLeeg }); return; }
    let nieuw: string[] = [];
    edit((mm) => { nieuw = B.plakIn(mm, pl.rijen, plek.current.chapter, plek.current.na, { unit: units[0]?.key ?? "st", form: "vh", standaardTitel: T.standaardHoofdstuk }); });
    setSel(new Set(nieuw));
    if (nieuw.length) { setCur(nieuw[0]); anker.current = nieuw[0]; }
    toast.show({ kind: pl.onbekendeEenheden.length ? "error" : "ok", text: pl.onbekendeEenheden.length ? `${T.geplakt(pl.rijen.length)} ${T.plakEenheid(pl.onbekendeEenheden.join(", "))}` : T.geplakt(pl.rijen.length), action: { label: T.ongedaan.split(" (")[0], run: p.ongedaan } }, 8000);
  };
  const onCopy = (e: React.ClipboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    if (!el?.dataset.greep || !sel.size) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", B.alsTekst(m, [...sel], true));
    toast.show({ kind: "ok", text: T.gekopieerd(sel.size) });
  };

  // ── slepen ──
  const SOORT = "application/x-bowaco-rijen";
  const startSleep = (e: DragEvent, k: string) => {
    if (!editable || weergave === "klant") { e.preventDefault(); return; }
    const keys = sel.has(k) ? [...sel] : [k];
    if (!sel.has(k)) { setSel(new Set([k])); anker.current = k; }
    e.dataTransfer.setData(SOORT, keys.join(","));
    e.dataTransfer.effectAllowed = "move";
  };
  const over = (e: DragEvent, key: string, isChapter: boolean) => {
    if (!e.dataTransfer.types.includes(SOORT)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const where = isChapter ? "in" : e.clientY < r.top + r.height / 2 ? "voor" : "na";
    if (drop?.key !== key || drop.where !== where) setDrop({ key, where });
  };
  const neer = (e: DragEvent, key: string, isChapter: boolean) => {
    const raw = e.dataTransfer.getData(SOORT);
    setDrop(null);
    if (!raw) return;
    e.preventDefault();
    const keys = raw.split(",").filter(Boolean);
    if (isChapter) { edit((mm) => B.verplaats(mm, keys, key, null)); return; }
    const l = m.lines.find((x) => x.key === key);
    if (!l || keys.includes(key)) return;
    const rows = M.linesOf(m, l.chapter).filter((x) => !keys.includes(x.key));
    const i = rows.findIndex((x) => x.key === key);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const voor = e.clientY >= r.top + r.height / 2 ? rows[i + 1]?.key ?? null : key;
    edit((mm) => B.verplaats(mm, keys, l.chapter, voor));
  };

  // ── bibliotheek: een post overnemen ──
  const neemPost = async (it: LibItemView, chapterKey: string) => {
    try {
      const pr = caps.quotePrices ? unwrap(await actor!.readLibraryPrices([it.id])).prices[0] : undefined;
      let key = "";
      const rows = M.linesOf(m, chapterKey);
      edit((mm) => {
        key = M.addLine(mm, chapterKey, {
          kind: "item", code: it.code, title: it.title, text: it.text, unit: it.unit, form: it.form as string, qtyMilli: 0n, libItemId: it.id, libItemVersion: it.version,
          price: { cost: pr?.cost?.costCents ?? null, rule: pr?.rule ? (pr.rule.__kind__ === "margin" ? { margin: pr.rule.margin } : { price: pr.rule.price }) : null, reason: pr?.rule ? pr.reason : "", orgId: pr?.cost?.orgId ?? it.orgId ?? null, source: "bibliotheek", libCostId: pr?.cost?.id ?? null },
        }, rows.at(-1)?.key).key;
      });
      setCur(key);
      focusCel(key, "vh");
    } catch (e) {
      toast.show({ kind: "error", text: errText(e) });
    }
  };
  const nieuwePost = (titel: string, chapterKey: string) => {
    let key = "";
    edit((mm) => { key = M.addLine(mm, chapterKey, { kind: "item", title: titel.slice(0, 160), unit: units[0]?.key ?? "st", form: "vh" }, M.linesOf(mm, chapterKey).at(-1)?.key).key; });
    setCur(key);
    focusCel(key, "vh");
  };
  const nieuwHoofdstuk = () => {
    let key = "";
    edit((mm) => { key = M.addChapter(mm, { title: T.nieuwHoofdstuk }).key; });
    requestAnimationFrame(() => { const el = raster.current?.querySelector<HTMLElement>(`[data-ch="${CSS.escape(key)}"] [data-col="chtitel"]`); el?.focus(); if (el instanceof HTMLInputElement) el.select(); });
  };
  // Een lege offerte: één hoofdstuk om in te typen (bij een kleine offerte zonder hoofdstukken klapt de inhoud in).
  const eersteHoofdstuk = (): string => {
    let key = chapters[0]?.key ?? "";
    if (!key) edit((mm) => { key = M.addChapter(mm, { title: T.standaardHoofdstuk }).key; });
    return key;
  };

  const springNaar = (key: string) => {
    const el = raster.current?.querySelector<HTMLElement>(`[data-ch="${CSS.escape(key)}"], [data-row="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("rb-flits");
    window.setTimeout(() => el.classList.remove("rb-flits"), 1600);
    if (ind.inhoud === "zwevend") setOpen((o) => ({ ...o, inhoud: false }));
  };

  const v = read.version;
  const cols = kol.map((c) => COLW[c]).join(" ");
  const showLine = (l: M.Line) => weergave !== "klant" || M.shown(m, l);

  return (
    <div className={`rb rb--inhoud-${ind.inhoud} rb--paneel-${ind.paneel}`} ref={root} data-testid="rekenblad" data-weergave={weergave} onKeyDown={onKey} onPaste={onPaste} onCopy={onCopy} style={{ ["--rb-cols" as string]: `34px ${cols}` }}>
      <BladKop p={p} weergave={weergave} setWeergave={setWeergave} ind={ind} setOpen={setOpen} setTab={setTab} />

      {ind.inhoud !== "dicht" && (
        <nav className="rb-inhoud" aria-label={T.inhoud} data-testid="rb-inhoud">
          <div className="rb-inhoud__kop"><b>{T.inhoud}</b>{ind.inhoud === "zwevend" && <Button size="sm" variant="quiet" icon="close" iconOnly onClick={() => setOpen((o) => ({ ...o, inhoud: false }))}>{T.inhoudDicht}</Button>}</div>
          <ol className="rb-inhoud__lijst">
            {chapters.map((c) => {
              const ct = totals.chapters.find((x) => x.chapter === c.key);
              const mb = ct ? B.hoofdstukMarge(ct) : null;
              return (
                <li key={c.key}
                  draggable={editable}
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-bowaco-hoofdstuk", c.key); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-bowaco-hoofdstuk") || e.dataTransfer.types.includes(SOORT)) e.preventDefault(); }}
                  onDrop={(e) => {
                    const h = e.dataTransfer.getData("application/x-bowaco-hoofdstuk");
                    const r = e.dataTransfer.getData(SOORT);
                    if (h) { e.preventDefault(); if (h !== c.key) edit((mm) => B.verplaatsHoofdstuk(mm, h, c.key)); }
                    else if (r) { e.preventDefault(); edit((mm) => B.verplaats(mm, r.split(","), c.key, null)); }
                  }}>
                  <button type="button" onClick={() => springNaar(c.key)} className={findingCh.has(c.key) ? "rb-inhoud__aandacht" : undefined}>
                    <span className="rb-inhoud__t"><span className="bw-mono">{c.code}</span> {c.title || "…"}</span>
                    <span className="rb-inhoud__s bw-mono">{ct ? fmtEuro(ct.sell) : "—"}{mb !== null && <small> · {fmtMarge(mb)}</small>}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {editable && (
            <div className="rb-inhoud__voet">
              <Button size="sm" variant="quiet" icon="plus" onClick={nieuwHoofdstuk}>{T.hoofdstukToevoegen}</Button>
              {p.acties.bibHoofdstukken && <Button size="sm" variant="quiet" icon="list" onClick={p.acties.bibHoofdstukken}>{T.hoofdstukUitBib}</Button>}
            </div>
          )}
        </nav>
      )}

      <div className="rb-midden">
        {sel.size > 0 && editable && weergave !== "klant" && <Selectie m={m} sel={[...sel]} edit={edit} weg={weg} dupliceer={dupliceer} wis={() => setSel(new Set())} chapters={chapters} />}
        {weergave === "verschil" && p.diff.marks && <p className="rb-melding">{p.diff.label}: {[...p.diff.marks.values()].filter((x) => x === "new").length} {O.diffNew}, {[...p.diff.marks.values()].filter((x) => x === "changed").length} {O.diffChanged}{p.diff.gone > 0 ? ` · ${T.verwijderd(p.diff.gone)}` : ""}</p>}
        {weergave === "klant" && m.header.intro && <p className="rb-melding rb-melding--tekst">{m.header.intro}</p>}
        <div className="rb-raster" ref={raster} role="grid" aria-label={O.title} aria-rowcount={volgorde.length}>
          <div className="rb-r rb-r--kop" role="row">
            <span aria-hidden />
            {kol.map((c) => <span key={c} role="columnheader" className={NUM.has(c) ? "rb-rt" : undefined}>{KOP[c]}</span>)}
          </div>
          {chapters.length === 0 && <p className="rb-leeg">{T.leeg}</p>}
          {chapters.map((c) => {
            const ct = totals.chapters.find((x) => x.chapter === c.key);
            const groups = groepen(m, c.key);
            return (
              <section key={c.key} className="rb-ch" data-ch={c.key} role="rowgroup">
                <div className={`rb-r rb-r--ch${drop?.key === c.key ? " rb-drop--in" : ""}`} role="row"
                  onDragOver={(e) => over(e, c.key, true)} onDragLeave={() => setDrop(null)} onDrop={(e) => neer(e, c.key, true)}
                  onFocus={() => { plek.current = { chapter: c.key, na: null }; }}>
                  <span aria-hidden className="rb-ch__icon"><Icon name="list" size={14} /></span>
                  <span>{ro ? <span className="bw-mono">{c.code}</span> : <Cel col="chcode" label={O.code} value={c.code} onCommit={(s) => { edit((mm) => M.updateChapter(mm, c.key, { code: s.trim() })); return true; }} />}</span>
                  <span className="rb-ch__titel">
                    {ro ? <b>{c.title}</b> : <Cel col="chtitel" label={O.chapterTitlePh} placeholder={O.chapterTitlePh} bad={wacht.has(c.key)} value={c.title} onCommit={(s) => { edit((mm) => M.updateChapter(mm, c.key, { title: s })); return true; }} />}
                  </span>
                  <span className="rb-ch__rest">
                    {weergave !== "klant" && m.v2 && <ChapterMargin m={m} chapterKey={c.key} classes={read.terms?.classes ?? []} editable={editable} edit={edit} />}
                    <b className="bw-mono rb-ch__som">{ct ? fmtEuro(ct.sell) : "—"}</b>
                    {editable && weergave !== "klant" && (
                      <Meer size="sm" items={[
                        p.acties.bib && { label: T.uitBib, icon: "doc", onClick: () => p.acties.bib!(c.key) },
                        { label: T.tekstregel, icon: "plus", onClick: () => { let k = ""; edit((mm) => { k = M.addLine(mm, c.key, { kind: "text", unit: "", title: "" }).key; }); focusCel(k, "titel"); } },
                        m.v2 && { label: T.subgroepToevoegen, icon: "plus", onClick: () => edit((mm) => { M.addSubgroup(mm, c.key, ""); }) },
                        { label: T.hoofdstukWeg, icon: "close", danger: true, onClick: () => { edit((mm) => M.removeChapter(mm, c.key)); toast.show({ kind: "ok", text: T.hoofdstukWeg, action: { label: T.ongedaan.split(" (")[0], run: p.ongedaan } }); } },
                      ] as (MeerItem | false | undefined)[]} />
                    )}
                  </span>
                </div>
                {groups.map((g) => (
                  <div key={g.sub?.key ?? "los"} role="presentation">
                    {g.sub && (
                      <div className="rb-r rb-r--sub" role="row" data-sub={g.sub.key}>
                        <span aria-hidden />
                        <span className="rb-sub__titel">{ro ? <b>{g.sub.title}</b> : <Cel col="subtitel" label={t.vorm.subgroupField} placeholder={t.vorm.subgroupPh} value={g.sub.title} onCommit={(s) => { edit((mm) => M.updateSubgroup(mm, g.sub!.key, { title: s })); return true; }} />}</span>
                        <span className="rb-sub__rest">
                          <span className="bw-mono">{fmtEuro(g.rows.reduce((a, l) => a + (l.kind === "item" ? M.lineOut(m, l).lineSell : 0n), 0n))}</span>
                          {editable && weergave !== "klant" && <Button size="sm" variant="quiet" icon="close" iconOnly onClick={() => edit((mm) => M.removeSubgroup(mm, g.sub!.key))}>{T.subgroepWeg}</Button>}
                        </span>
                      </div>
                    )}
                    {g.rows.filter(showLine).map((l) => (
                      <Rij key={l.key} l={l} nr={nr.get(l.key) ?? 0} m={m} kol={kol} ro={ro} units={units} edit={edit}
                        gekozen={sel.has(l.key)} huidig={cur === l.key} wacht={wacht.has(l.key)} aandacht={findingLn.has(l.key)} mark={weergave === "verschil" ? p.diff.marks?.get(l.key) : undefined}
                        drop={drop?.key === l.key ? drop.where : null}
                        onKies={(how) => kies(l.key, how)} onFocus={() => { setCur(l.key); plek.current = { chapter: l.chapter, na: l.key }; }}
                        onDragStart={(e) => startSleep(e, l.key)} onDragOver={(e) => over(e, l.key, false)} onDragLeave={() => setDrop(null)} onDrop={(e) => neer(e, l.key, false)} />
                    ))}
                  </div>
                ))}
                {editable && weergave !== "klant" && <NieuweRij chapterKey={c.key} caps={caps} onFocus={() => { plek.current = { chapter: c.key, na: null }; }} onPost={(it) => void neemPost(it, c.key)} onVrij={(s) => nieuwePost(s, c.key)} />}
              </section>
            );
          })}
          {editable && weergave !== "klant" && chapters.length === 0 && (
            <NieuweRij chapterKey="" caps={caps} onFocus={() => { plek.current = { chapter: null, na: null }; }} onPost={(it) => void neemPost(it, eersteHoofdstuk())} onVrij={(s) => nieuwePost(s, eersteHoofdstuk())} />
          )}
          {editable && weergave !== "klant" && chapters.length > 0 && ind.inhoud === "dicht" && (
            <div className="rb-onder"><Button size="sm" variant="quiet" icon="plus" onClick={nieuwHoofdstuk}>{T.hoofdstukToevoegen}</Button></div>
          )}
          {weergave === "klant" && m.header.note && <p className="rb-melding rb-melding--tekst">{m.header.note}</p>}
        </div>
        <p className="rb-hint bw-muted">{T.sneltoetsen}</p>
      </div>

      {ind.paneel !== "dicht" && (
        <aside className="rb-paneel" aria-label={T.paneel} data-testid="rb-paneel">
          <div className="rb-tabs" role="tablist">
            {(["lijn", "controle", "offerte"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {T.tabs[k]}{k === "controle" && p.findings.length > 0 && <span className="rb-tel">{p.findings.length}</span>}
              </button>
            ))}
            {ind.paneel === "zwevend" && <Button size="sm" variant="quiet" icon="close" iconOnly onClick={() => setOpen((o) => ({ ...o, paneel: false }))}>{T.paneelDicht}</Button>}
          </div>
          <div className="rb-paneel__in">
            {tab === "lijn" && (curLine ? <LijnPaneel key={curLine.key} p={p} l={curLine} /> : <p className="bw-muted">{T.geenLijn}</p>)}
            {tab === "controle" && <ControlePaneel p={p} spring={springNaar} />}
            {tab === "offerte" && <OffertePaneel p={p} />}
          </div>
        </aside>
      )}

      <Totalen p={p} klant={weergave === "klant"} />
    </div>
  );
}

const COLW: Record<B.Kolom, string> = { code: "76px", titel: "minmax(220px, 1fr)", vorm: "70px", vh: "84px", eenheid: "66px", kost: "96px", marge: "66px", prijs: "96px", totaal: "112px" };
const NUM = new Set<B.Kolom>(["vh", "kost", "marge", "prijs", "totaal"]);
const KOP: Record<B.Kolom, string> = { code: O.code, titel: O.item, vorm: O.form, vh: O.qty, eenheid: O.unit, kost: O.cost, marge: O.margin, prijs: O.sellUnit, totaal: O.lineTotal };

/** De posten van een hoofdstuk: eerst wie geen subgroep heeft, dan per subgroep (zoals de klassieke editor en de PDF). */
function groepen(m: M.Model, chapterKey: string): { sub: M.Subgroup | null; rows: M.Line[] }[] {
  const rows = M.linesOf(m, chapterKey);
  if (!m.v2) return [{ sub: null, rows }];
  const out: { sub: M.Subgroup | null; rows: M.Line[] }[] = [{ sub: null, rows: rows.filter((l) => !M.lineSubgroup(m, l)) }];
  for (const g of M.activeSubgroups(m, chapterKey)) out.push({ sub: g, rows: rows.filter((l) => M.lineSubgroup(m, l)?.key === g.key) });
  return out.filter((g) => g.sub !== null || g.rows.length > 0);
}

// ── Eén rij ──────────────────────────────────────────────────────────────
type RijProps = {
  l: M.Line; nr: number; m: M.Model; kol: B.Kolom[]; ro: boolean; units: UnitView[]; edit: BladProps["edit"];
  gekozen: boolean; huidig: boolean; wacht: boolean; aandacht: boolean; mark?: "new" | "changed"; drop: "voor" | "na" | "in" | null;
  onKies: (how: "een" | "bereik" | "erbij") => void; onFocus: () => void;
  onDragStart: (e: DragEvent) => void; onDragOver: (e: DragEvent) => void; onDragLeave: () => void; onDrop: (e: DragEvent) => void;
};
function Rij({ l, nr, m, kol, ro, units, edit, gekozen, huidig, wacht, aandacht, mark, drop, onKies, onFocus, onDragStart, onDragOver, onDragLeave, onDrop }: RijProps) {
  const o: LineOut = M.lineOut(m, l);
  const base = M.lineBase(m, l);
  const std = base.pick?.marginBp ?? m.header.standardMarginBp;
  const regie = m.v2 && M.isRegie(l) && l.price.rule === null && m.form.regie ? m.form.regie : null;
  const up = (x: Parameters<typeof M.updateLine>[2]) => edit((mm) => M.updateLine(mm, l.key, x));
  const tekst = l.kind === "text";
  const vast = !!l.price.rule && "price" in l.price.rule;
  const cls = ["rb-r", "rb-rij", tekst && "rb-rij--tekst", l.kind === "option" && "rb-rij--optie", gekozen && "rb-rij--gekozen", huidig && "rb-rij--huidig", wacht && "rb-rij--wacht", mark && `rb-rij--${mark}`, drop && `rb-drop--${drop}`].filter(Boolean).join(" ");
  const tags: { k: string; c: string; t: string }[] = [];
  if (l.kind === "option") tags.push({ k: "opt", c: "", t: `${O.kinds.option} · ${o.lineSell < 0n ? O.optionMinus : O.optionPlus}` });
  if (!tekst && kol.includes("kost")) {
    if (o.noPrice) tags.push({ k: "np", c: "a-tag--warn", t: O.flags.noPrice });
    if (o.deviates) tags.push({ k: "dv", c: "a-tag--warn", t: vast ? O.flags.fixed : O.flags.deviates });
    if (o.deviates && l.price.reason.trim() === "") tags.push({ k: "nr", c: "a-tag--bad", t: O.flags.noReason });
    if (o.negative) tags.push({ k: "ng", c: "a-tag--bad", t: O.flags.negative });
    if (regie) tags.push({ k: "rg", c: "", t: t.vorm.regieTag(fmtEuro(regie.sell)) });
  }
  if (!tekst && l.kind === "item" && l.qtyMilli === 0n && kol.includes("kost")) tags.push({ k: "z", c: "", t: O.flags.zero });
  if (!M.shown(m, l) && kol.includes("kost")) tags.push({ k: "h", c: "", t: t.vorm.hiddenTag });
  if (mark) tags.push({ k: "mk", c: "a-tag--accent", t: mark === "new" ? O.diffNew : O.diffChanged });
  if (aandacht && kol.includes("kost")) tags.push({ k: "a", c: "a-tag--warn", t: "!" });
  const cell = (c: B.Kolom): ReactNode => {
    switch (c) {
      case "code": return <span key={c}>{ro ? <span className="bw-mono">{l.code}</span> : <Cel col="code" label={O.code} value={l.code} onCommit={(s) => { up({ code: s.trim() }); return true; }} />}</span>;
      case "titel": return (
        <span key={c} className="rb-titel" style={tekst ? { gridColumn: "3 / -1" } : undefined}>
          {ro ? <span className="rb-titel__t">{l.title || l.text.split("\n")[0]}{l.title && l.text && kol.length <= 6 && <small className="bw-muted"> · {l.text.split("\n")[0]}</small>}</span>
            : <Cel col="titel" label={O.item} placeholder={tekst ? O.textPh : O.itemTitlePh} bad={wacht && !l.title.trim() && !l.text.trim()} value={l.title} onCommit={(s) => { up({ title: s }); return true; }} />}
          {l.libItemId !== null && !ro && <span className="rb-bib" title={O.fromLib(String(l.libItemVersion ?? ""))}>bib</span>}
          {tags.length > 0 && <span className="rb-tags">{tags.map((x) => <span key={x.k} className={`a-tag ${x.c}`}>{x.t}</span>)}</span>}
        </span>
      );
      case "vorm": return <span key={c}>{ro ? <span className="rb-kort" title={O.forms[l.form]}>{O.formsShort[l.form]}</span> : (
        <select className="rb-in rb-sel" data-col="vorm" aria-label={O.form} title={O.forms[l.form]} value={l.form} onChange={(e) => up({ form: e.target.value })}>
          {FORMS.map((f) => <option key={f} value={f}>{O.formsShort[f]}</option>)}
        </select>)}</span>;
      case "vh": return <span key={c} className="rb-rt">{ro ? <span className="bw-mono">{fmtQty(l.qtyMilli)}</span> : <Cel num col="vh" label={O.qtyLong} value={fmtQty(l.qtyMilli)} onCommit={(s) => { const q = parseQty(s); if (q === null) return false; up({ qtyMilli: q }); return true; }} />}</span>;
      case "eenheid": return <span key={c}>{ro ? <span className="bw-mono">{l.unit}</span> : (
        <select className={`rb-in rb-sel${units.length && !units.some((u) => u.key === l.unit) ? " rb-in--bad" : ""}`} data-col="eenheid" aria-label={O.unit} value={l.unit} onChange={(e) => up({ unit: e.target.value })}>
          {!units.some((u) => u.key === l.unit) && <option value={l.unit}>{l.unit || "…"}</option>}
          {units.map((u) => <option key={u.key} value={u.key}>{u.key}</option>)}
        </select>)}</span>;
      case "kost": return <span key={c} className="rb-rt">{ro ? <span className="bw-mono">{l.price.cost !== null ? fmtEuro(l.price.cost) : "—"}</span> : (
        <Cel num col="kost" label={O.cost} value={euro2(l.price.cost)} placeholder="—" onCommit={(s) => { const x = parseEuro(s); if (x === null) return false; up({ price: { ...l.price, cost: x ?? null, source: x === undefined ? l.price.source : l.price.source || "handmatig" } }); return true; }} />)}</span>;
      case "marge": return <span key={c} className="rb-rt">{ro || vast ? <span className="bw-mono">{fmtMarge(o.marginBp)}</span> : (
        <Cel num col="marge" label={O.margin} value={l.price.rule && "margin" in l.price.rule ? pct(l.price.rule.margin) : ""} placeholder={pct(std)}
          onCommit={(s) => { if (s.trim() === "") { up({ price: { ...l.price, rule: null, reason: "" } }); return true; } const bp = parsePct(s); if (bp === null || bp > 9000n) return false; up({ price: { ...l.price, rule: bp === std ? null : { margin: bp } } }); return true; }} />)}</span>;
      case "prijs": return <span key={c} className="rb-rt bw-mono">{o.unitSell !== null ? fmtEuro(o.unitSell) : "—"}</span>;
      case "totaal": return <span key={c} className={`rb-rt bw-mono${l.kind === "option" ? " rb-opt" : ""}`}>{o.unitSell !== null ? fmtEuro(o.lineSell) : "—"}</span>;
    }
  };
  return (
    <div className={cls} role="row" data-row={l.key} aria-selected={gekozen} onFocus={onFocus} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button type="button" className="rb-greep" data-greep={l.key} draggable={!ro} onDragStart={onDragStart} aria-pressed={gekozen} aria-label={T.rij(nr)} title={T.rij(nr)}
        onClick={(e) => onKies(e.shiftKey ? "bereik" : e.metaKey || e.ctrlKey ? "erbij" : "een")}>{nr}</button>
      {(tekst ? kol.filter((c) => c === "code" || c === "titel") : kol).map(cell)}
    </div>
  );
}

// ── De lege rij onderaan een hoofdstuk: typen zoekt in de bibliotheek ────
function NieuweRij({ chapterKey, caps, onFocus, onPost, onVrij }: { chapterKey: string; caps: Caps; onFocus: () => void; onPost: (it: LibItemView) => void; onVrij: (s: string) => void }) {
  const { actor, isFetching } = useBackend();
  const [tekst, setTekst] = useState("");
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [open, setOpenZ] = useState(false);
  useEffect(() => { const h = setTimeout(() => setQ(tekst.trim()), 180); return () => clearTimeout(h); }, [tekst]);
  const lijst = useQuery({
    queryKey: ["library", "blad", q],
    queryFn: () => actor!.listLibrary({ text: q, offset: 0n, limit: 8n, includeArchived: false }),
    enabled: !!actor && !isFetching && caps.readLibrary && q.length >= 2,
    placeholderData: (prev) => prev,
  });
  const items = q.length >= 2 && tekst.trim().length >= 2 ? lijst.data?.items ?? [] : [];
  useEffect(() => setI(0), [q]);
  const klaar = () => { setTekst(""); setQ(""); setOpenZ(false); };
  const kies = (k: number, vrij = false) => {
    const s = tekst.trim();
    if (!s) return;
    if (!vrij && k < items.length) onPost(items[k]); else onVrij(s);
    klaar();
  };
  return (
    <div className="rb-r rb-r--nieuw" data-nieuw={chapterKey}>
      <span aria-hidden className="rb-plus"><Icon name="plus" size={14} /></span>
      <div className="rb-nieuw">
        <input className="rb-in rb-in--wide" data-col="nieuw" data-draft={tekst ? "1" : undefined} aria-label={T.nieuweRij} placeholder={T.nieuweRij} value={tekst} autoComplete="off"
          role="combobox" aria-expanded={open && !!tekst.trim()} aria-autocomplete="list"
          onFocus={() => { onFocus(); setOpenZ(true); }} onBlur={() => window.setTimeout(() => setOpenZ(false), 150)}
          onChange={(e) => { setTekst(e.target.value); setOpenZ(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, items.length)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); kies(i, e.shiftKey); }
            else if (e.key === "Escape") { if (tekst) { e.stopPropagation(); klaar(); } }
          }} />
        {open && tekst.trim().length > 0 && (
          <ul className="rb-zoek" role="listbox">
            {items.map((it, k) => (
              <li key={String(it.id)} role="option" aria-selected={k === i} onMouseDown={(e) => { e.preventDefault(); kies(k); }}>
                <span><span className="bw-mono">{it.code}</span> {it.title}</span>
                <small className="bw-muted">{it.chapterCode} {it.chapterTitle} · {it.unit}</small>
              </li>
            ))}
            <li role="option" aria-selected={i >= items.length} className="rb-zoek__vrij" onMouseDown={(e) => { e.preventDefault(); kies(items.length, true); }}>
              <span>{T.zoekNieuw(tekst.trim())}</span>
            </li>
            <li className="rb-zoek__hint" aria-hidden>{items.length === 0 && q.length >= 2 && !lijst.isFetching ? T.zoekGeen : T.zoekHint}</li>
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Gekozen rijen ────────────────────────────────────────────────────────
function Selectie({ m, sel, edit, weg, dupliceer, wis, chapters }: { m: M.Model; sel: string[]; edit: BladProps["edit"]; weg: (k: string[]) => void; dupliceer: (k: string[]) => void; wis: () => void; chapters: M.Chapter[] }) {
  const toast = useToast();
  const [marge, setMarge] = useState<{ v: string; r: string } | null>(null);
  const lines = sel.map((k) => m.lines.find((l) => l.key === k && !l.removed)).filter((l): l is M.Line => !!l);
  const allOpt = lines.length > 0 && lines.every((l) => l.kind === "option");
  const pasToe = () => {
    if (!marge) return;
    const bp = marge.v.trim() === "" ? null : parsePct(marge.v);
    if (bp !== null && bp > 9000n) return;
    if (marge.v.trim() !== "" && bp === null) return;
    let n = 0;
    edit((mm) => { n = B.zetMarge(mm, sel, bp, marge.r.trim()); });
    toast.show({ kind: "ok", text: `${T.margeZetten}: ${n}` });
    setMarge(null);
  };
  return (
    <div className="rb-sel" role="toolbar" aria-label={T.gekozen(sel.length)} data-testid="rb-selectie">
      <b>{T.gekozen(sel.length)}</b>
      <Button size="sm" onClick={() => setMarge(marge ? null : { v: "", r: "" })}>{T.margeZetten}</Button>
      <select className="bw-input rb-sel__naar" aria-label={T.verplaatsNaar} value="" onChange={(e) => { const k = e.target.value; if (k) edit((mm) => B.verplaats(mm, sel, k, null)); }}>
        <option value="">{T.verplaatsNaar}…</option>
        {chapters.map((c) => <option key={c.key} value={c.key}>{c.code} {c.title}</option>)}
      </select>
      <Button size="sm" onClick={() => edit((mm) => { B.zetSoort(mm, sel, allOpt ? "item" : "option"); })}>{allOpt ? T.postMaken : T.optieMaken}</Button>
      <Button size="sm" onClick={() => dupliceer(sel)}>{T.dupliceren}</Button>
      <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(B.alsTekst(m, sel, true)).then(() => toast.show({ kind: "ok", text: T.gekopieerd(sel.length) }), () => toast.show({ kind: "error", text: T.kopieren })); }}>{T.kopieren}</Button>
      <Button size="sm" variant="danger" onClick={() => weg(sel)}>{T.verwijderen}</Button>
      <Button size="sm" variant="quiet" icon="close" iconOnly onClick={wis}>{T.keuzeWeg}</Button>
      {marge && (
        <span className="rb-sel__marge">
          <input className="bw-input" aria-label={T.margeVoor(sel.length)} placeholder={T.margeVoor(sel.length)} value={marge.v} onChange={(e) => setMarge({ ...marge, v: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") pasToe(); }} autoFocus />
          <input className="bw-input" aria-label={T.margeReden} placeholder={T.margeRedenPh} value={marge.r} onChange={(e) => setMarge({ ...marge, r: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") pasToe(); }} />
          <Button size="sm" onClick={pasToe}>{T.margeToepassen}</Button>
        </span>
      )}
    </div>
  );
}

// ── Kop: waar, versie, bewaard, weergave, één hoofdknop ──────────────────
function BladKop({ p, weergave, setWeergave, ind, setOpen, setTab }: { p: BladProps; weergave: B.Weergave; setWeergave: (w: B.Weergave) => void; ind: B.Indeling; setOpen: (f: (o: { inhoud?: boolean; paneel?: boolean }) => { inhoud?: boolean; paneel?: boolean }) => void; setTab: (t: "lijn" | "controle" | "offerte") => void }) {
  const { read, m, acties: a, bewaar: s } = p;
  const v = read.version;
  const status = s.saving ? T.bewaren : s.fout ? T.bewaarFout : p.pending > 0 && s.wacht.length > 0 ? T.nietKlaar(new Set(s.wacht.map((x) => x.key)).size) : p.pending > 0 ? T.wacht(p.pending) : s.savedAt ? T.bewaard(tijd(s.savedAt)) : "";
  const meer: (MeerItem | false | undefined)[] = [
    a.versturen && a.pdf && { label: read.doc?.info.frozen ? O.pdf : O.pdfPreview, icon: "doc", disabled: p.pending > 0, onClick: a.pdf },
    a.nieuweVersie && { label: O.newVersion, icon: "plus", onClick: a.nieuweVersie },
    a.aanvaard && { label: O.accept, icon: "check", onClick: a.aanvaard },
    a.geweigerd && { label: O.reject, onClick: a.geweigerd },
    a.mail && { label: O.mailClient, icon: "share", onClick: a.mail },
    a.getekend && { label: O.signed, onClick: a.getekend },
    a.kop && { label: O.header, icon: "edit", onClick: a.kop },
    a.soort && { label: t.vorm.kindChange, icon: "edit", onClick: a.soort },
    { label: O.work, icon: "building", onClick: a.werf },
    { label: p.pending > 0 ? T.herlaadVerlies(p.pending) : O.reload, icon: "sync", onClick: a.herlaad },
    { label: T.klassiek, icon: "list", onClick: a.klassiek, testid: "naar-klassiek" },
    a.archiveren && { label: O.archive, danger: true, onClick: a.archiveren },
    a.dearchiveren && { label: O.unarchive, onClick: a.dearchiveren },
  ];
  return (
    <header className="rb-kop">
      <Button size="sm" variant="quiet" icon="list" iconOnly aria-pressed={ind.inhoud !== "dicht"} onClick={() => setOpen((o) => ({ ...o, inhoud: ind.inhoud === "dicht" }))} data-testid="rb-inhoud-knop">{ind.inhoud === "dicht" ? T.inhoudOpen : T.inhoudDicht}</Button>
      <div className="rb-kop__titel">
        <span className="bw-label">{read.quote.workCode} {read.quote.workName}</span>
        <h1 className="rb-h1" title={`${read.quote.number} · ${m.header.title}`}>{read.quote.number} · {m.header.title}</h1>
      </div>
      <span className="rb-versies" role="tablist" aria-label={O.versions}>
        {read.quote.versions.map((x) => (
          <button key={String(x.id)} type="button" role="tab" aria-selected={x.id === v.id} className="rb-ver" onClick={() => p.go(`offertes/${read.quote.id}/${x.id}`)}>
            {O.version(x.version)} <small>{O.status[x.status] ?? x.status}</small>
          </button>
        ))}
      </span>
      <span className={`rb-status${s.fout ? " rb-status--fout" : ""}`} role="status" data-testid="rb-status" title={s.fout ?? (p.editable ? T.vanzelf : undefined)}>
        {s.saving && <span className="rb-spin" aria-hidden />}{status}
        {s.fout && <Button size="sm" variant="quiet" onClick={s.opnieuw}>{T.opnieuwProberen}</Button>}
      </span>
      {p.editable && (
        <span className="rb-undo">
          <Button size="sm" variant="quiet" icon="undo" iconOnly disabled={!p.kanTerug} onClick={p.ongedaan}>{T.ongedaan}</Button>
          <Button size="sm" variant="quiet" icon="undo" iconOnly className="rb-redo" disabled={!p.kanVooruit} onClick={p.opnieuw}>{T.opnieuw}</Button>
        </span>
      )}
      <span className="rb-seg" role="radiogroup" aria-label={T.weergaveLabel}>
        <button type="button" role="radio" aria-checked={weergave === "calc"} onClick={() => setWeergave("calc")}>{T.weergaven.calc}</button>
        <button type="button" role="radio" aria-checked={weergave === "klant"} onClick={() => setWeergave("klant")}>{T.weergaven.klant}</button>
        {p.diff.label && <button type="button" role="radio" aria-checked={weergave === "verschil"} onClick={() => setWeergave("verschil")}>{p.diff.label}</button>}
      </span>
      <span className="rb-kop__vul" />
      {p.findings.length > 0 && <Button size="sm" variant="quiet" icon="alert" onClick={() => { setTab("controle"); setOpen((o) => ({ ...o, paneel: true })); }}>{T.controleN(p.findings.length)}</Button>}
      <Button size="sm" variant="quiet" icon="columns" iconOnly aria-pressed={ind.paneel !== "dicht"} onClick={() => setOpen((o) => ({ ...o, paneel: ind.paneel === "dicht" }))} data-testid="rb-paneel-knop">{ind.paneel === "dicht" ? T.paneelOpen : T.paneelDicht}</Button>
      <Meer size="sm" items={meer} />
      {a.versturen ? <Button variant="primary" size="sm" icon="share" disabled={p.pending > 0 || s.saving} onClick={a.versturen} data-testid="rb-versturen">{O.send}</Button>
        : a.werfStart ? a.werfStart
        : a.pdf ? <Button size="sm" icon="doc" onClick={a.pdf}>{read.doc?.info.frozen ? O.pdf : O.pdfPreview}</Button> : null}
    </header>
  );
}

// ── Bronnen van de kost (één keer per offerte geladen zodra het paneel een lijn toont; elk met een auditregel) ──
function useBronnen(read: QuoteRead, m: M.Model, caps: Caps) {
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching && read.scope === QuoteScope.full;
  const vid = read.version.id;
  // de lijnen met een id (een pas bewaarde lijn telt mee: de sleutel volgt de ids; elke lezing = één auditregel)
  const lineIds = m.lines.filter((l) => !l.removed && l.id !== null && l.kind !== "text").map((l) => String(l.id)).sort().join(",");
  const vorige = useQuery({
    queryKey: ["blad-vorige", String(vid), lineIds],
    queryFn: async () => new Map(unwrap(await actor!.readPreviousPrices(vid)).map((x) => [String(x.lineId), x])),
    enabled: on, staleTime: Infinity, gcTime: 10 * 60_000, placeholderData: (prev) => prev,
  });
  const libIds = [...new Set(m.lines.filter((l) => !l.removed && l.libItemId !== null).map((l) => String(l.libItemId)))].sort().slice(0, 300);
  const bib = useQuery({
    queryKey: ["blad-bib", String(vid), libIds.join(",")],
    queryFn: async () => new Map(unwrap(await actor!.readLibraryPrices(libIds.map(BigInt))).prices.map((x) => [String(x.itemId), x])),
    enabled: on && caps.quotePrices && libIds.length > 0, staleTime: Infinity, gcTime: 10 * 60_000, placeholderData: (prev) => prev,
  });
  const oa = useQuery({
    queryKey: ["blad-oa", String(read.quote.id)],
    queryFn: async () => {
      const ts = (await actor!.listTenders(read.quote.workId)).filter((x) => x.quoteId === read.quote.id);
      const out: B.OaVergelijking[] = [];
      for (const x of ts) {
        const r = await actor!.compareTender(x.id);
        if (r.__kind__ !== "ok") continue;
        const v = r.ok;
        const lib = new Map(v.input.items.map((i) => [String(i.id), i.libItemId ?? null]));
        out.push({
          tenderId: v.tenderId, code: v.code,
          items: v.items.map((i) => ({ id: i.id, lineId: i.lineId, libItemId: lib.get(String(i.id)) ?? null, unit: i.unit })),
          firmas: v.quotes.map((q) => ({ oaQuoteId: q.quote.id, orgId: q.quote.orgId, firma: q.quote.orgName, dag: q.quote.quoteDay })),
          cellen: v.calc.cells.map((c) => ({ itemId: c.itemId, oaQuoteId: c.oaQuoteId, unitCents: c.unitCents ?? null, lowest: c.lowest, unitChanged: c.unitChanged, vhChanged: c.vhChanged, alt: c.alt })),
          gekozen: v.choices.map((c) => ({ itemId: c.itemId, oaQuoteId: c.oaQuoteId ?? null })),
        });
      }
      return out;
    },
    enabled: on && caps.tenders, staleTime: Infinity, gcTime: 10 * 60_000,
  });
  return { vorige, bib, oa };
}

// ── Het paneel van de gekozen lijn ───────────────────────────────────────
function LijnPaneel({ p, l }: { p: BladProps; l: M.Line }) {
  const { m, edit, editable, read, orgs, caps } = p;
  const ro = !editable;
  const up = (x: Parameters<typeof M.updateLine>[2]) => edit((mm) => M.updateLine(mm, l.key, x));
  const o = M.lineOut(m, l);
  const base = M.lineBase(m, l);
  const std = base.pick?.marginBp ?? m.header.standardMarginBp;
  const ruleKind = l.price.rule === null ? "std" : "margin" in l.price.rule ? "margin" : "fixed";
  const tekst = l.kind === "text";
  const src = useBronnen(read, m, caps);
  const copied = l.id !== null ? read.lines.find((x) => x.id === l.id)?.copiedFrom : undefined;
  const lineIds = l.id !== null ? [l.id, ...(copied !== undefined ? [copied] : [])] : [];
  const oaP = B.oaPrijzen(lineIds, l.libItemId, src.oa.data ?? []);
  const prev: QuotePrevPrice | undefined = l.id !== null ? src.vorige.data?.get(String(l.id)) : undefined;
  const lib: LibPriceView | undefined = l.libItemId !== null ? src.bib.data?.get(String(l.libItemId)) : undefined;
  const orgName = l.price.orgId !== null ? orgs.find((x) => x.id === l.price.orgId)?.name ?? "" : "";
  const neem = (cost: bigint, orgId: bigint | null, source: string, libCostId: bigint | null = null) => up({ price: { ...l.price, cost, orgId, source, libCostId } });
  const subs = m.v2 ? M.activeSubgroups(m, l.chapter) : [];
  const show = m.form.lineShow.get(l.key);
  const oas = orgs.filter((x) => (x.kind === "subcontractor" || x.kind === "supplier") && x.archivedAt === undefined);
  const laden = src.vorige.isLoading || src.oa.isLoading || src.bib.isLoading;
  const Neem = ({ c, org, s, lc }: { c: bigint | null | undefined; org: bigint | null | undefined; s: string; lc?: bigint | null }) =>
    !ro && c !== null && c !== undefined && c !== l.price.cost ? <Button size="sm" variant="quiet" title={T.neemUitleg} onClick={() => neem(c, org ?? null, s, lc ?? null)}>{T.neem}</Button> : null;
  return (
    <div className="rb-lijn" data-testid="rb-lijn">
      <div className="rb-lijn__kop">
        <span className="bw-mono">{l.code}</span> <b>{l.title || l.text.split("\n")[0] || "…"}</b>
        {!ro && (
          <span className="rb-seg rb-seg--klein" role="radiogroup" aria-label={O.kind}>
            {(["item", "option", "text"] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={l.kind === k} onClick={() => { if (l.kind !== k) up(k === "text" ? { kind: k, price: M.emptyPrice(), qtyMilli: 0n } : { kind: k }); }}>{O.kinds[k]}</button>)}
          </span>
        )}
      </div>
      {!tekst && (
        <section className="rb-blok">
          <h3 className="bw-label">{T.herkomst}<Info text={T.neemUitleg} label={t.uitleg.label} /></h3>
          <div className="rb-bron rb-bron--nu"><span>{T.nu}</span><span className="bw-mono">{l.price.cost !== null ? fmtEuro(l.price.cost) : "—"}</span><small>{[orgName, O.sources[l.price.source] ?? l.price.source].filter(Boolean).join(" · ")}</small></div>
          {laden && <p className="bw-muted rb-klein">{T.herkomstLaden}</p>}
          <h4>{T.oaOffertes}</h4>
          {oaP.length === 0 ? <p className="bw-muted rb-klein">{T.oaGeen}</p> : oaP.map((x, k) => (
            <div key={k} className={`rb-bron${x.gekozen ? " rb-bron--gekozen" : ""}`} data-testid="rb-oa">
              <span>{x.firma}{x.gekozen && <span className="a-tag a-tag--ok">{T.oaGekozen}</span>}{x.laagste && <span className="a-tag">{T.oaLaagste}</span>}{x.anders && <span className="a-tag a-tag--warn" title={T.oaAnders}>≠</span>}</span>
              <span className="bw-mono">{x.unitCents !== null ? fmtEuro(x.unitCents) : "—"}</span>
              <small>{x.tenderCode}{x.dag !== null ? ` · ${fmtDayNum(x.dag)}` : ""}</small>
              <Neem c={x.unitCents} org={x.orgId} s="oa-offerte" />
            </div>
          ))}
          <h4>{T.vorigePrijs}</h4>
          {!prev ? <p className="bw-muted rb-klein">{l.id === null ? T.vorigeGeen : src.vorige.isLoading ? "…" : T.vorigeGeen}</p> : (
            <div className="rb-bron" data-testid="rb-vorige">
              <span>{T.vorigeVan(prev.quoteNumber, O.version(prev.version), new Date(Number(prev.at / 1_000_000n)).toLocaleDateString("nl-BE"))} <small className="bw-muted">{O.status[prev.status] ?? prev.status}{prev.byLibItem ? "" : ` · ${T.vorigeTitel}`}</small></span>
              <span className="bw-mono">{prev.costCents !== undefined ? fmtEuro(prev.costCents) : "—"}</span>
              <small>{[prev.orgName, prev.unitSellCents !== undefined ? `${T.bibVerkoop} ${fmtEuro(prev.unitSellCents)}/${prev.unit}` : ""].filter(Boolean).join(" · ")}</small>
              <Neem c={prev.costCents} org={prev.orgId} s={prev.quoteId === read.quote.id ? "vorige-versie" : "handmatig"} />
            </div>
          )}
          <h4>{T.bibPrijs}</h4>
          {l.libItemId === null ? <p className="bw-muted rb-klein">{T.bibGeen}</p> : !lib ? <p className="bw-muted rb-klein">…</p> : (
            <>
              <div className="rb-bron" data-testid="rb-bib">
                <span>{lib.cost?.orgName || O.sources.bibliotheek}{lib.cost && <small className="bw-muted"> · {fmtDayNum(lib.cost.day)}</small>}</span>
                <span className="bw-mono">{lib.cost?.costCents !== undefined ? fmtEuro(lib.cost.costCents) : "—"}</span>
                <small>{lib.sellCents !== undefined ? `${T.bibVerkoop} ${fmtEuro(lib.sellCents)}` : ""}{lib.marginBp !== undefined ? ` · ${fmtMarge(lib.marginBp)}` : ""}</small>
                <Neem c={lib.cost?.costCents} org={lib.cost?.orgId} s="bibliotheek" lc={lib.cost?.id} />
              </div>
              {lib.perOrg.filter((c) => c.id !== lib.cost?.id && !c.archived).slice(0, 5).map((c) => (
                <div key={String(c.id)} className="rb-bron rb-bron--sub">
                  <span>{c.orgName || "—"} <small className="bw-muted">· {fmtDayNum(c.day)}</small></span>
                  <span className="bw-mono">{c.costCents !== undefined ? fmtEuro(c.costCents) : "—"}</span>
                  <small>{T.bibPerFirma}</small>
                  <Neem c={c.costCents} org={c.orgId} s="bibliotheek" lc={c.id} />
                </div>
              ))}
            </>
          )}
          {!ro && (
            <label className="bw-field rb-veld"><span className="bw-label">{O.oaField}</span>
              <select className="bw-input" value={l.price.orgId !== null ? String(l.price.orgId) : ""} onChange={(e) => up({ price: { ...l.price, orgId: e.target.value ? BigInt(e.target.value) : null } })}>
                <option value="">{O.noOa}</option>
                {oas.map((x) => <option key={String(x.id)} value={String(x.id)}>{x.name}</option>)}
              </select>
            </label>
          )}
        </section>
      )}
      {!tekst && (
        <section className="rb-blok">
          <h3 className="bw-label">{T.marge}</h3>
          {!ro && (
            <span className="rb-seg rb-seg--klein rb-seg--blok" role="radiogroup" aria-label={O.rule}>
              <button type="button" role="radio" aria-checked={ruleKind === "std"} onClick={() => up({ price: { ...l.price, rule: null, reason: "" } })}>{base.pick ? t.vorm.baseRule(fmtBp(std), t.vorm.sources[base.source]) : O.ruleStandard(fmtBp(std))}</button>
              <button type="button" role="radio" aria-checked={ruleKind === "margin"} onClick={() => up({ price: { ...l.price, rule: { margin: l.price.rule && "margin" in l.price.rule ? l.price.rule.margin : std } } })}>{O.ruleMargin}</button>
              <button type="button" role="radio" aria-checked={ruleKind === "fixed"} onClick={() => up({ price: { ...l.price, rule: { price: o.unitSell ?? 0n } } })}>{O.ruleFixed}</button>
            </span>
          )}
          {!ro && ruleKind === "margin" && <label className="bw-field rb-veld"><span className="bw-label">{O.marginField}</span><Cel num col="p-marge" label={O.marginField} value={l.price.rule && "margin" in l.price.rule ? pct(l.price.rule.margin) : ""} onCommit={(s) => { const bp = parsePct(s); if (bp === null || bp > 9000n) return false; up({ price: { ...l.price, rule: { margin: bp } } }); return true; }} /></label>}
          {!ro && ruleKind === "fixed" && <label className="bw-field rb-veld"><span className="bw-label">{O.fixedField}</span><Cel num col="p-vast" label={O.fixedField} value={l.price.rule && "price" in l.price.rule ? euro2(l.price.rule.price) : ""} onCommit={(s) => { const c = parseEuro(s); if (c === null || c === undefined) return false; up({ price: { ...l.price, rule: { price: c } } }); return true; }} /></label>}
          {ruleKind !== "std" && (ro ? <p className="rb-klein">{O.reason}: {l.price.reason || "—"}</p> : <label className="bw-field rb-veld"><span className="bw-label">{O.reason}</span><Cel wide max={B.GRENS.reden} col="p-reden" label={O.reason} placeholder={O.reasonPh} bad={o.deviates && !l.price.reason.trim()} value={l.price.reason} onCommit={(s) => { up({ price: { ...l.price, reason: s } }); return true; }} /></label>)}
          <dl className="rb-dl">
            <dt>{O.sellUnit}</dt><dd className="bw-mono">{o.unitSell !== null ? fmtEuro(o.unitSell) : "—"}</dd>
            <dt>{O.lineTotal}</dt><dd className="bw-mono">{fmtEuro(o.lineSell)}</dd>
            <dt>{O.margin}</dt><dd className="bw-mono">{fmtMarge(o.marginBp)}</dd>
          </dl>
        </section>
      )}
      <section className="rb-blok">
        <h3 className="bw-label">{T.tekstKlant}</h3>
        <TekstVak ro={ro} value={l.text} onCommit={(s) => up({ text: s })} />
        {l.libItemId !== null && <p className="bw-muted rb-klein">{O.fromLib(String(l.libItemVersion ?? ""))}</p>}
        <label className="bw-field rb-veld"><span className="bw-label">{O.specRef}</span>{ro ? <span>{l.specRef || "—"}</span> : <Cel wide col="p-spec" label={O.specRef} value={l.specRef} onCommit={(s) => { up({ specRef: s }); return true; }} />}</label>
        {subs.length > 0 && (
          <label className="bw-field rb-veld"><span className="bw-label">{t.vorm.subgroupField}</span>
            <select className="bw-input" disabled={ro} value={M.lineSubgroup(m, l)?.key ?? ""} onChange={(e) => edit((mm) => M.setLineSubgroup(mm, l.key, e.target.value || null))}>
              <option value="">{t.vorm.subgroupNone}</option>
              {subs.map((g) => <option key={g.key} value={g.key}>{g.title || "…"}</option>)}
            </select>
          </label>
        )}
        {m.v2 && !tekst && l.qtyMilli === 0n && (
          <label className="bw-field rb-veld"><span className="bw-label">{t.vorm.showLine}</span>
            <select className="bw-input" disabled={ro} value={show === undefined ? "rule" : show ? "yes" : "no"} onChange={(e) => { const k = e.target.value; edit((mm) => M.setLineShow(mm, l.key, k === "rule" ? null : k === "yes")); }}>
              <option value="rule">{t.vorm.showRule(m.form.hideZeroLines)}</option>
              <option value="yes">{t.vorm.showYes}</option>
              <option value="no">{t.vorm.showNo}</option>
            </select>
          </label>
        )}
      </section>
    </div>
  );
}

/** De lastenboektekst: bewaart (één stap ongedaan maken) als je het vak verlaat. */
function TekstVak({ ro, value, onCommit }: { ro: boolean; value: string; onCommit: (s: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  return <textarea className="bw-input rb-tekst" rows={5} maxLength={4000} disabled={ro} aria-label={T.tekstKlant} value={d ?? value} onChange={(e) => setD(e.target.value)} onBlur={() => { if (d !== null && d !== value) onCommit(d); setD(null); }} />;
}

function ControlePaneel({ p, spring }: { p: BladProps; spring: (key: string) => void }) {
  const wat = new Map<string, string>();
  for (const x of p.bewaar.wacht) if (!wat.has(x.key)) wat.set(x.key, T.nietKlaarWat[x.wat]);
  return (
    <div className="rb-controle">
      {!p.rulesLoaded && <p className="bw-muted">{t.common.loading}</p>}
      {p.rulesLoaded && p.findings.length === 0 && <p className="q-ok"><Icon name="check" size={16} /> {O.controlsNone}</p>}
      <ul className="rb-find">
        {p.findings.map((f) => (
          <li key={f.rule} className={f.severity === "block" ? "rb-find--block" : "rb-find--warn"} data-rule={f.rule}>
            <button type="button" disabled={!f.lineIds.length && !f.chapterIds.length} onClick={() => spring(f.lineIds[0] ?? f.chapterIds[0])}>
              <span className="a-tag">{f.severity === "block" ? O.checkBlock : O.checkWarn}</span> {f.name}{f.count > 1 ? ` (${f.count})` : ""}
            </button>
          </li>
        ))}
      </ul>
      {wat.size > 0 && (
        <>
          <h3 className="bw-label">{T.nietKlaar(wat.size)}</h3>
          <ul className="rb-find">
            {[...wat].map(([k, w]) => <li key={k} className="rb-find--warn"><button type="button" onClick={() => spring(k)}>{w}</button></li>)}
          </ul>
        </>
      )}
      <p className="bw-muted rb-klein">{O.controlsLead}</p>
      <p className={p.self.failed.length ? "a-err" : "q-ok rb-klein"} role={p.self.failed.length ? "alert" : undefined}>{p.self.failed.length ? O.selfFail(p.self.failed.length, p.self.failed.join(" · ")) : O.selfOk(p.self.passed)}</p>
    </div>
  );
}

function OffertePaneel({ p }: { p: BladProps }) {
  const { read, m, orgs, editable, edit } = p;
  const v = read.version;
  const h = m.header;
  const klant = h.clientOrgId === null ? O.noClient : orgs.find((o) => o.id === h.clientOrgId)?.name ?? v.clientName;
  return (
    <div className="rb-offerte">
      {!v.editable && <p className="a-note">{T.alleenLezen(O.status[v.status] ?? v.status)} {v.hash && <> {v.intact ? O.intact : <b className="a-err">{O.notIntact}</b>}</>}</p>}
      {read.doc?.acceptance && <p className="a-note">{O.acceptance}. {O.acceptedLocked}</p>}
      <dl className="rb-dl">
        <dt>{O.client}</dt><dd>{klant}</dd>
        <dt>{O.vat}</dt><dd>{fmtBp(h.vatBp)}{h.vatBp !== v.workVatBp && <> <span className="a-tag a-tag--warn">{O.vatWork(fmtBp(v.workVatBp))}</span></>}</dd>
        <dt>{O.validDays}</dt><dd>{String(h.validDays)}</dd>
        <dt>{O.standardMargin}</dt><dd>{fmtBp(h.standardMarginBp)}</dd>
        {read.form && <><dt>{t.vorm.kind}</dt><dd>{t.vorm.kinds[read.form.kind]}</dd></>}
      </dl>
      <div className="a-row">
        {p.acties.kop && <Button size="sm" icon="edit" onClick={p.acties.kop}>{O.header}</Button>}
        {p.acties.soort && <Button size="sm" icon="edit" onClick={p.acties.soort}>{t.vorm.kindChange}</Button>}
      </div>
      {m.v2 && <FormPanel m={m} editable={editable} orgs={orgs} edit={edit} />}
      <p className="bw-muted rb-klein">{O.auditNote}</p>
    </div>
  );
}

// ── Totalen: altijd onderaan in beeld ────────────────────────────────────
function Totalen({ p, klant }: { p: BladProps; klant: boolean }) {
  const { totals: x, m } = p;
  const regels = M.activeChapters(m).map((c) => {
    const ct = x.chapters.find((y) => y.chapter === c.key);
    return { label: `${c.code} ${c.title}`.trim(), waarde: ct ? `${fmtEuro(ct.sellWithCost - ct.cost)} · ${fmtMarge(B.hoofdstukMarge(ct))}` : "—" };
  });
  return (
    <footer className="rb-tot" aria-label={O.total} data-testid="rb-totalen">
      {!klant && <span><small>{T.tot.kost}</small><b className="bw-mono">{fmtEuro(x.cost)}</b></span>}
      {!klant && <span><small>{T.tot.marge}</small>
        <Cijfer naam={T.tot.marge} uitleg={T.margeUitleg} regels={[...regels, { label: T.tot.marge, waarde: `${fmtEuro(x.margin)} · ${fmtMarge(x.marginBp)}`, totaal: true }]}>
          <b className="bw-mono" data-testid="rb-marge">{fmtEuro(x.margin)} · {fmtMarge(x.marginBp)}</b>
        </Cijfer>
      </span>}
      {x.discount !== 0n && <span><small>{T.tot.bruto}</small><b className="bw-mono">{fmtEuro(x.gross)}</b></span>}
      {x.discount !== 0n && <span><small>{T.tot.korting}</small><b className="bw-mono">−{fmtEuro(x.discount)}</b></span>}
      <span><small>{T.tot.excl}</small><b className="bw-mono" data-testid="rb-subtotaal">{fmtEuro(x.subtotal)}</b></span>
      <span><small>{T.tot.btw(fmtBp(m.header.vatBp))}</small><b className="bw-mono">{fmtEuro(x.vat)}</b></span>
      <span className="rb-tot__groot"><small>{T.tot.totaal}</small><b className="bw-mono" data-testid="rb-totaal">{fmtEuro(x.total)}</b></span>
      {(x.optionsPlus !== 0n || x.optionsMinus !== 0n) && <span><small>{T.tot.opties}</small><b className="bw-mono">+{fmtEuro(x.optionsPlus)} / {fmtEuro(x.optionsMinus)}</b></span>}
      {x.noPrice > 0 && <span className="a-tag a-tag--warn">{O.incomplete(x.noPrice)}</span>}
      {p.bewaar.serverOk === false && <span className="a-err" role="alert">{O.serverDiff}</span>}
    </footer>
  );
}
