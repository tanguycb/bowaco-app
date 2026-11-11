import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, GewoneKnoppen } from "./Button";

/** 4b.4: een Werklijst met `vast` geeft zijn rechterpaneel door: een Sheet daarbinnen (de fiche van een firma, een factuur) staat dan
 *  als vast paneel in de lijst in plaats van over het scherm. Een Sheet in dat paneel (een tweede venster) is weer gewoon een venster. */
export const VastPaneel = createContext<HTMLElement | null>(null);

/** Paneel over het scherm: onderaan op de gsm, rechts op de desktop (side). Esc en tik naast sluiten. */
/** wide = breder zijpaneel op de desktop (editors met tabellen); op de gsm blijft het een blad onderaan. */
export function Sheet({ title, open, onClose, children, footer, side, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose via een ref: een nieuwe functie bij elke render mag de focus niet terug naar het paneel trekken.
  const close = useRef(onClose);
  close.current = onClose;
  const host = useContext(VastPaneel);
  const vast = !!host && (side || wide);
  useEffect(() => {
    if (!open || vast) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, vast]);
  if (!open) return null;
  if (vast) {
    return createPortal(
      <VastPaneel.Provider value={null}>
        <div className="bw-vast" role="region" aria-label={title}>
          <div className="bw-vast__head">
            <span className="bw-h2">{title}</span>
            <Button variant="quiet" icon="close" iconOnly onClick={onClose}>Sluiten</Button>
          </div>
          <div className="bw-vast__body">{children}</div>
          {footer && <div className="bw-vast__foot">{footer}</div>}
        </div>
      </VastPaneel.Provider>,
      host!,
    );
  }
  return (
    <GewoneKnoppen.Provider value={false}>
      <div className="bw-sheet-back" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`bw-sheet${side ? " bw-sheet--side" : ""}${wide ? " bw-sheet--wide" : ""}`}>
        <div className="bw-sheet__head">
          <span className="bw-h2">{title}</span>
          <Button variant="quiet" icon="close" iconOnly onClick={onClose}>Sluiten</Button>
        </div>
        <div className="bw-sheet__body">{children}</div>
        {footer && <div className="bw-sheet__foot">{footer}</div>}
      </div>
    </GewoneKnoppen.Provider>
  );
}
