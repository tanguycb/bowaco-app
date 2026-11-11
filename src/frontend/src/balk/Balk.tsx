// De balk (stap 4b.2): zoeken en doen. Losstaand onderdeel: <BalkKnop/> voor de bovenbalk (veld op desktop, icoon op de gsm), <Venster/>
// voor het venster en useBalkSneltoets voor de toetsen; stap 4b.3 hangt het in de nieuwe bovenbalk zonder iets te wijzigen. ⌘K / Ctrl+K opent het
// venster overal (de offerte-editor gebruikt enkel Ctrl+S); "/" opent het enkel buiten een invoerveld. Pijltjes + Enter, Esc sluit.
// De index wordt pas geladen bij de eerste opening en 5 minuten bewaard (alleen in het geheugen, niet op schijf).
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Caps } from "../backend";
import { Icon } from "../design";
import { t } from "../texts/nl";
import { useBackend } from "../util";
import { laadIndex, zoek, type Regel, type Soort } from "./zoek";
import "./balk.css";

const B = t.balk;
const ICON: Record<Soort, "plus" | "grid" | "building" | "people" | "euro" | "receipt" | "doc"> = { handeling: "plus", scherm: "grid", werf: "building", firma: "building", persoon: "people", offerte: "euro", factuur: "receipt", document: "doc" };
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** De sneltoetsen, één keer in de schil: ⌘K / Ctrl+K wisselt, "/" opent buiten een invoerveld. */
export function useBalkSneltoets(setOpen: (f: (o: boolean) => boolean) => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("[role=dialog]")) { e.preventDefault(); setOpen(() => true); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [setOpen]);
}

/** De knop: veld met sneltoets op desktop, enkel een zoekicoon op de gsm (CSS). Mag op meerdere plaatsen staan (zijbalk, bovenbalk). */
export function BalkKnop({ onOpen, testid }: { onOpen: () => void; testid?: string }) {
  return (
    <button type="button" className="k-trigger" onClick={onOpen} aria-label={B.open} data-testid={testid ?? "balk-open"}>
      <Icon name="search" size={18} />
      <span className="k-trigger__text">{B.placeholder}</span>
      <kbd className="k-trigger__key">{isMac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

export function Venster({ caps, userKey, go, onVerslag, onClose }: { caps: Caps; userKey: string; go: (to: string) => void; onVerslag: () => void; onClose: () => void }) {
  const { actor, isFetching } = useBackend();
  // De principal in de sleutel: nooit de index van een andere persoon hergebruiken.
  const idx = useQuery({ queryKey: ["balk", userKey], queryFn: () => laadIndex(actor!, caps), enabled: !!actor && !isFetching, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: 0 });
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hits = useMemo(() => zoek(idx.data ?? [], text), [idx.data, text]);
  // Focus naar het veld en bij sluiten terug naar wat focus had.
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; input.current?.focus(); return () => prev?.focus?.(); }, []);
  useEffect(() => { setSel(0); }, [text]);
  useEffect(() => { (list.current?.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const kies = (r: Regel) => { onClose(); if (r.to === "verslag") onVerslag(); else go(r.to); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.max(0, Math.min(hits.length - 1, s + 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); kies(hits[sel]); }
  };
  return (
    <>
      <div className="bw-sheet-back" onClick={onClose} />
      <div className="k-dlg" role="dialog" aria-modal="true" aria-label={B.titel} onKeyDown={key}>
        <div className="k-dlg__head">
          <Icon name="search" size={20} />
          <input ref={input} className="k-dlg__in" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={B.placeholder} aria-label={B.placeholder} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls="k-list" aria-activedescendant={hits[sel] ? `k-${sel}` : undefined} data-testid="balk-in" />
          <button type="button" className="k-dlg__x" onClick={onClose} aria-label={B.sluit}><Icon name="close" size={20} /></button>
        </div>
        {idx.isLoading && <p className="k-dlg__msg bw-muted">{B.laden}</p>}
        {idx.data && hits.length === 0 && <p className="k-dlg__msg bw-muted">{B.niets(text.trim())}</p>}
        <ul id="k-list" ref={list} className="k-dlg__list" role="listbox">
          {hits.map((r, i) => (
            <li key={r.id} id={`k-${i}`} role="option" aria-selected={i === sel} className={`k-row${i === sel ? " k-row--sel" : ""}`} onMouseMove={() => setSel(i)} onClick={() => kies(r)} data-testid="balk-rij" data-soort={r.soort}>
              <Icon name={ICON[r.soort]} size={18} />
              <span className="k-row__main"><b>{r.titel}</b><small className="bw-muted">{r.sub}</small></span>
              <span className="k-row__kind">{B.soort[r.soort]}</span>
            </li>
          ))}
        </ul>
        <p className="k-dlg__foot bw-muted"><kbd>↑</kbd> <kbd>↓</kbd> {B.kies} · <kbd>Enter</kbd> {B.open2} · <kbd>Esc</kbd> {B.sluit}</p>
      </div>
    </>
  );
}
