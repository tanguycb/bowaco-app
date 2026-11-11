// v3 (4b.3c): de paginavorm Werkvorm, het gedeelde skelet van het rekenblad (4b.3b) voor de andere schermen met een lijst
// van lijnen: OA-offertes vergelijken, opmeting, vorderingsstaat, min-meerstaat en OA-factuurcontrole.
//   kop (één regel) · inhoud links · raster in het midden · paneel van de gekozen lijn rechts · totalen onderaan.
// De totalen staan altijd in beeld (het blad vult de hoogte tot de onderkant van het venster). Inhoud en paneel staan vast
// open als het blad breed genoeg is en klappen anders in (ze openen dan zwevend over het raster); een klein document zonder
// inhoud (≤ 1 kopje) heeft geen inhoud links nodig. De breedte is die van het blad zelf (een tabblad van een werf is smaller
// dan het venster). De vorm kent geen gegevens en geen rechten: het scherm geeft zijn eigen rijen en bedragen door.
// De opmaak (rb-…) is die van het rekenblad (app/rekenblad.css), niet gekopieerd.
import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { indeling } from "../quote/blad";
import { t } from "../texts/nl";
import { Button } from "./Button";
import "../app/rekenblad.css";
import "../app/werkvorm.css";
import { VANZELF_MS, WERKVORM_VANAF, WERKVORM_VAST_VANAF, vanzelfKan, werkvormKan } from "./vormkern";

const W = t.werkvorm;
export { WERKVORM_VANAF, WERKVORM_VAST_VANAF, werkvormKan };
export function useWerkvormKan(): boolean {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const vinger = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
  return werkvormKan(w, vinger);
}

/** Het menu wordt op een werkblad vanzelf een rail (App zet de vlag); de vorm meldt zich aan en af. */
export const WerkbladVlag = createContext<(aan: boolean) => void>(() => {});

export type InhoudItem = { key: string; titel: ReactNode; sub?: ReactNode; aandacht?: boolean };
export type PaneelTab = { key: string; label: string; badge?: number; inhoud: ReactNode };
export type WerkvormHandle = { openPaneel: (tab?: string) => void; sluitInhoud: () => void };

type Props = {
  testid: string;
  /** De kop: titel en knoppen, op één regel (de hoofdknop zwart, de rest onder ⋯). Komt na de twee paneelknoppen. */
  kop: ReactNode;
  /** Wat er onder de kop staat (meldingen, waarschuwingen), boven het raster. */
  melding?: ReactNode;
  inhoud?: { titel?: string; items: InhoudItem[]; onKies: (key: string) => void; voet?: ReactNode; sleep?: boolean };
  tabs: PaneelTab[];
  tab?: string;
  onTab?: (k: string) => void;
  paneelLabel?: string;
  /** De totalen onderaan: kinderen van de voetregel (elk een <span><small>label</small><b>waarde</b></span>). */
  totalen: ReactNode;
  hint?: string;
  /** Het raster zelf: de rijen. Het scherm zet --rb-cols via `kolommen` en gebruikt Raster/RasterKop/RasterRij. */
  kolommen: string;
  rasterLabel: string;
  /** Brengt het blad bij het openen naar boven (zodat de totalen onderaan in beeld staan); uit in een paneel van een werklijst. */
  naarBoven?: boolean;
  rasterRef?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

export const Werkvorm = forwardRef<WerkvormHandle, Props>(function Werkvorm(p, ref) {
  const root = useRef<HTMLDivElement>(null);
  const [breedte, setBreedte] = useState(0);
  const [open, setOpen] = useState<{ inhoud?: boolean; paneel?: boolean }>({});
  const [eigen, setEigen] = useState<string | undefined>(undefined);
  const tab = p.tab ?? eigen ?? p.tabs[0]?.key;
  const zetTab = (k: string) => { setEigen(k); p.onTab?.(k); };
  const vlag = useContext(WerkbladVlag);
  useEffect(() => { vlag(true); return () => vlag(false); }, [vlag]);

  // De hoogte: van de bovenkant van het blad tot de onderkant van het venster; de breedte is die van het blad zelf.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const zet = () => {
      el.style.height = `${Math.max(460, window.innerHeight - el.getBoundingClientRect().top - 8)}px`;
      setBreedte(el.getBoundingClientRect().width);
    };
    // Een blad in een tabblad staat lager op de pagina: breng het naar boven zodat de totalen onderaan in beeld staan.
    if (p.naarBoven !== false && el.getBoundingClientRect().top > 120) el.scrollIntoView({ block: "start" });
    zet();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(zet) : null;
    ro?.observe(el);
    window.addEventListener("resize", zet);
    return () => { ro?.disconnect(); window.removeEventListener("resize", zet); };
  }, []);

  const kopjes = p.inhoud?.items.length ?? 0;
  // Zonder inhoud links is er niets om open te klappen: dan ook geen knop en geen kolom.
  const ind = indeling(breedte, kopjes, open, WERKVORM_VAST_VANAF);
  const heeftInhoud = !!p.inhoud && kopjes > 0;
  const inhoudStand = heeftInhoud ? ind.inhoud : "dicht";
  const paneelStand = p.tabs.length > 0 ? ind.paneel : "dicht";

  useImperativeHandle(ref, () => ({
    openPaneel: (k) => { if (k) zetTab(k); setOpen((o) => ({ ...o, paneel: true })); },
    sluitInhoud: () => setOpen((o) => ({ ...o, inhoud: false })),
  }));

  const actief = p.tabs.find((x) => x.key === tab) ?? p.tabs[0];
  return (
    <div className={`rb rb--inhoud-${inhoudStand} rb--paneel-${paneelStand} wv`} ref={root} data-testid={p.testid} style={{ ["--rb-cols" as string]: p.kolommen }}>
      <header className="rb-kop">
        {heeftInhoud && <Button size="sm" variant="quiet" icon="list" iconOnly aria-pressed={inhoudStand !== "dicht"} onClick={() => setOpen((o) => ({ ...o, inhoud: inhoudStand === "dicht" }))} data-testid="wv-inhoud-knop">{inhoudStand === "dicht" ? W.inhoudOpen : W.inhoudDicht}</Button>}
        {p.kop}
        {p.tabs.length > 0 && <Button size="sm" variant="quiet" icon="columns" iconOnly aria-pressed={paneelStand !== "dicht"} onClick={() => setOpen((o) => ({ ...o, paneel: paneelStand === "dicht" }))} data-testid="wv-paneel-knop">{paneelStand === "dicht" ? W.paneelOpen : W.paneelDicht}</Button>}
      </header>

      {heeftInhoud && inhoudStand !== "dicht" && p.inhoud && (
        <nav className="rb-inhoud" aria-label={p.inhoud.titel ?? W.inhoud} data-testid="wv-inhoud">
          <div className="rb-inhoud__kop"><b>{p.inhoud.titel ?? W.inhoud}</b>{inhoudStand === "zwevend" && <Button size="sm" variant="quiet" icon="close" iconOnly onClick={() => setOpen((o) => ({ ...o, inhoud: false }))}>{W.inhoudDicht}</Button>}</div>
          <ol className="rb-inhoud__lijst">
            {p.inhoud.items.map((x) => (
              <li key={x.key}>
                <button type="button" className={x.aandacht ? "rb-inhoud__aandacht" : undefined} onClick={() => { p.inhoud!.onKies(x.key); if (inhoudStand === "zwevend") setOpen((o) => ({ ...o, inhoud: false })); }}>
                  <span className="rb-inhoud__t">{x.titel}</span>
                  {x.sub !== undefined && <span className="rb-inhoud__s bw-mono">{x.sub}</span>}
                </button>
              </li>
            ))}
          </ol>
          {p.inhoud.voet && <div className="rb-inhoud__voet">{p.inhoud.voet}</div>}
        </nav>
      )}

      <div className="rb-midden">
        {p.melding}
        <div className="rb-raster" ref={p.rasterRef} role="grid" aria-label={p.rasterLabel}>
          {p.children}
        </div>
        {p.hint && <p className="rb-hint bw-muted">{p.hint}</p>}
      </div>

      {paneelStand !== "dicht" && actief && (
        <aside className="rb-paneel" aria-label={p.paneelLabel ?? W.paneel} data-testid="wv-paneel">
          <div className="rb-tabs" role="tablist">
            {p.tabs.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={x.key === actief.key} onClick={() => zetTab(x.key)}>
                {x.label}{x.badge !== undefined && x.badge > 0 && <span className="rb-tel">{x.badge}</span>}
              </button>
            ))}
            {paneelStand === "zwevend" && <Button size="sm" variant="quiet" icon="close" iconOnly onClick={() => setOpen((o) => ({ ...o, paneel: false }))}>{W.paneelDicht}</Button>}
          </div>
          <div className="rb-paneel__in">{actief.inhoud}</div>
        </aside>
      )}

      <footer className="rb-tot" aria-label={W.totalen} data-testid="wv-totalen">{p.totalen}</footer>
    </div>
  );
});

// ── Het raster: kop en rijen met dezelfde kolommen ───────────────────────
/** De kolomkop (kleeft bovenaan). `num` = rechts uitgelijnd. */
export function RasterKop({ kolommen }: { kolommen: { label: string; num?: boolean }[] }) {
  return (
    <div className="rb-r rb-r--kop" role="row">
      {kolommen.map((k, i) => <span key={i} role="columnheader" className={k.num ? "rb-rt" : undefined}>{k.label}</span>)}
    </div>
  );
}
/** Een rij; `gekozen` = de lijn waarvan het paneel open staat, `stand` kleurt de rand links. Een klik of Enter kiest de rij. */
export function RasterRij({ children, gekozen, stand, kop, onKies, testid, extra }: { children: ReactNode; gekozen?: boolean; stand?: "wacht" | "nieuw" | "gewijzigd"; kop?: boolean; onKies?: () => void; testid?: string; extra?: string }) {
  const cls = `rb-r ${kop ? "rb-r--ch" : "rb-rij"}${gekozen ? " rb-rij--huidig rb-rij--gekozen" : ""}${stand ? ` rb-rij--${stand === "nieuw" ? "new" : stand === "gewijzigd" ? "changed" : "wacht"}` : ""}${extra ? ` ${extra}` : ""}`;
  return (
    <div className={cls} role="row" tabIndex={onKies ? 0 : undefined} aria-selected={gekozen || undefined} data-testid={testid}
      onClick={onKies}
      onKeyDown={onKies ? (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onKies(); } } : undefined}>
      {children}
    </div>
  );
}
/** Een totaal onderaan (label klein, waarde vet). */
export function Totaal({ label, children, groot, tag }: { label: string; children: ReactNode; groot?: boolean; tag?: "warn" | "bad" }) {
  return <span className={groot ? "rb-tot__groot" : undefined}><small>{label}</small><b className={`bw-mono${tag ? ` wv-${tag}` : ""}`}>{children}</b></span>;
}
/** Ongedaan maken en opnieuw voor schermen die hun lijnen lokaal bijhouden voor ze bewaard worden (de kop van de vorm). */
export function Terug({ kan, kanVooruit, ongedaan, opnieuw }: { kan: boolean; kanVooruit: boolean; ongedaan: () => void; opnieuw: () => void }) {
  return (
    <span className="rb-undo">
      <Button size="sm" variant="quiet" icon="undo" iconOnly disabled={!kan} onClick={ongedaan} data-testid="wv-ongedaan">{W.ongedaan}</Button>
      <Button size="sm" variant="quiet" icon="undo" iconOnly className="rb-redo" disabled={!kanVooruit} onClick={opnieuw} data-testid="wv-opnieuw">{W.opnieuw}</Button>
    </span>
  );
}

/** Vanzelf bewaren (enkel waar het scherm zijn lijnen nu al bewaart): ± 2,5 s na de laatste wijziging, stil; een fout stopt het tot
 *  "Opnieuw proberen". `sleutel` verandert bij elke wijziging (de timer begint dan opnieuw). `bewaar` geeft terug of het lukte. */
export function useVanzelf(s: { bewerkbaar: boolean; wijzigingen: number; geldig: boolean; bezig: boolean; sleutel: unknown; bewaar: () => Promise<boolean>; uit?: () => boolean }) {
  const ref = useRef(s);
  ref.current = s;
  const [fout, setFout] = useState(false);
  const [om, setOm] = useState<number | null>(null);
  const [bewaren, setBewaren] = useState(false);
  useEffect(() => {
    if (!vanzelfKan({ bewerkbaar: s.bewerkbaar, wijzigingen: s.wijzigingen, bezig: s.bezig || bewaren, geldig: s.geldig, fout })) return;
    const id = window.setTimeout(async () => {
      // Typen in een veld van het paneel (periode, notitie, index) laat het scherm met rust.
      if (ref.current.uit?.()) return;
      setBewaren(true);
      const ok = await ref.current.bewaar();
      setBewaren(false);
      if (ok) setOm(Date.now()); else setFout(true);
    }, VANZELF_MS);
    return () => window.clearTimeout(id);
  }, [s.sleutel, s.bewerkbaar, s.wijzigingen, s.geldig, s.bezig, bewaren, fout]); // eslint-disable-line react-hooks/exhaustive-deps
  return { fout, om, bewaren, opnieuw: () => setFout(false) };
}
