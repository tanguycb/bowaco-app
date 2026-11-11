// v3 (4b.3): de paginavorm Werklijst (L3). Links de lijst, rechts het gekozen stuk met zijn knoppen; pijltjes lopen door
// de lijst. Het gekozen stuk staat in de URL (bv. #/oa-facturen/12), zodat terug, vernieuwen en delen blijven werken.
// Op een smal scherm (gsm, kleine laptop) blijft het zoals vroeger: lijst → stuk → terug.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../texts/nl";
import { VastPaneel } from "./Sheet";
import { volgende } from "./tabel";

/** Een scherm dat in het paneel van een werklijst staat, toont een compacte kop (Page leest dit). */
export const PaneelContext = createContext(false);
export const useInPaneel = () => useContext(PaneelContext);

export const WERKLIJST_VANAF = 1100;

export function useBreed(px: number) {
  const q = `(min-width: ${px}px)`;
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

type Props<T> = {
  items: T[];
  rowKey: (x: T) => string;
  /** De inhoud van één regel (zonder knop eromheen). */
  row: (x: T, gekozen: boolean) => ReactNode;
  selected?: string;
  onSelect: (key: string) => void;
  /** Het gekozen stuk (meestal een scherm met eigen Page; in het paneel wordt de kop compact). */
  detail?: ReactNode;
  label: string;
  testid?: string;
  /** Het gekozen stuk is een Sheet (fiche, factuur): het staat dan als vast paneel rechts. */
  vast?: boolean;
  /** Boven de lijst (zoekveld, filters). */
  kop?: ReactNode;
};

export function Werklijst<T>({ items, rowKey, row, selected, onSelect, detail, label, testid, vast, kop }: Props<T>) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const breed = useBreed(WERKLIJST_VANAF);
  const list = useRef<HTMLUListElement>(null);
  const keys = items.map(rowKey);
  useEffect(() => {
    if (!breed || selected === undefined) return;
    list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [breed, selected]);
  // Smal: enkel de lijst. Het scherm dat de werklijst gebruikt, toont smal het gekozen stuk zelf (zonder de lijstpagina errond).
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const k = volgende(keys, selected, e.key === "ArrowDown" ? 1 : -1);
    if (k !== undefined && k !== selected) {
      onSelect(k);
      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`)?.focus());
    }
  };
  const lijst = (
    <ul className="a-list bw-wl__list" ref={list} aria-label={label} onKeyDown={key} data-testid={testid}>
      {items.map((x) => {
        const k = rowKey(x);
        const on = k === selected;
        return (
          <li key={k} className={on ? "bw-wl__on" : undefined}>
            <button type="button" className="a-list__btn" data-key={k} aria-current={on ? "true" : undefined} onClick={() => onSelect(k)}>
              {row(x, on)}
            </button>
          </li>
        );
      })}
    </ul>
  );
  if (!breed) return lijst;
  return (
    <div className="bw-wl">
      <div className="bw-wl__l">
        {kop}
        {lijst}
        <p className="bw-muted bw-wl__hint">{t.schil.werklijst.pijl}</p>
      </div>
      <div className="bw-wl__r" data-testid="werklijst-paneel" ref={vast ? setHost : undefined}>
        {detail && vast ? (host ? <VastPaneel.Provider value={host}>{detail}</VastPaneel.Provider> : null) : detail ? <PaneelContext.Provider value={true}>{detail}</PaneelContext.Provider> : <p className="a-empty">{t.schil.werklijst.kies}</p>}
      </div>
    </div>
  );
}
