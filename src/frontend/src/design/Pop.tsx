import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { t } from "../texts/nl";
import { Icon, type IconName } from "./Icon";

/** Sluit een uitklapper bij een tik ernaast of Escape (zoals de ⓘ). */
export function useBuiten(open: boolean, box: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); };
  }, [open, box, close]);
}

export type MeerItem = { label: string; onClick: () => void; icon?: IconName; danger?: boolean; disabled?: boolean; testid?: string };

/** "⋯": de handelingen die geen hoofdknop zijn (L8). Leeg = niets tonen. */
export function Meer({ items, label = t.schil.meerLabel, size = "md" }: { items: (MeerItem | false | null | undefined)[]; label?: string; size?: "sm" | "md" }) {
  const list = items.filter(Boolean) as MeerItem[];
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useBuiten(open, box, () => setOpen(false));
  if (list.length === 0) return null;
  return (
    <span className="bw-meer" ref={box}>
      <button type="button" className={`bw-btn bw-btn--quiet bw-btn--icon${size === "sm" ? " bw-btn--sm" : ""}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="meer">
        <Icon name="more" size={18} />
      </button>
      {open && (
        <span className="bw-pop" role="menu">
          {list.map((x) => (
            <button key={x.label} type="button" role="menuitem" className={`bw-pop__item${x.danger ? " bw-pop__item--danger" : ""}`} disabled={x.disabled} data-testid={x.testid} onClick={() => { setOpen(false); x.onClick(); }}>
              {x.icon && <Icon name={x.icon} size={16} />}{x.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export type CijferRegel = { label: string; waarde: string; totaal?: boolean };

/** Uitleg bij een cijfer (richting A): een tik op het getal zegt wat meetelt, eventueel de opbouw, en waar de lijst staat. */
export function Cijfer({ children, naam, uitleg, regels, naar, go }: { children: ReactNode; naam: string; uitleg: string; regels?: CijferRegel[]; naar?: string; go?: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useBuiten(open, box, () => setOpen(false));
  return (
    <span className="bw-cijfer" ref={box}>
      <button type="button" className="bw-cijfer__btn" aria-label={`${typeof children === "string" || typeof children === "number" ? `${children} · ` : ""}${t.schil.cijferLabel(naam)}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} data-testid="cijfer">
        {children}
      </button>
      {open && (
        <span className="bw-pop bw-cijfer__pop" role="note" onClick={(e) => e.stopPropagation()}>
          <b>{naam}</b>
          <span>{uitleg}</span>
          {regels && regels.length > 0 && (
            <dl>{regels.map((r) => [<dt key={`t${r.label}`} className={r.totaal ? "bw-cijfer__tot" : undefined}>{r.label}</dt>, <dd key={`d${r.label}`} className={r.totaal ? "bw-cijfer__tot" : undefined}>{r.waarde}</dd>])}</dl>
          )}
          {naar && go && <button type="button" className="a-link" onClick={() => { setOpen(false); go(naar); }}>{t.schil.cijferOpen}</button>}
        </span>
      )}
    </span>
  );
}
