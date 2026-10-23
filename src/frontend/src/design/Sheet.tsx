import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Paneel over het scherm: onderaan op de gsm, rechts op de desktop (side). Esc en tik naast sluiten. */
/** wide = breder zijpaneel op de desktop (editors met tabellen); op de gsm blijft het een blad onderaan. */
export function Sheet({ title, open, onClose, children, footer, side, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose via een ref: een nieuwe functie bij elke render mag de focus niet terug naar het paneel trekken.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="bw-sheet-back" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`bw-sheet${side ? " bw-sheet--side" : ""}${wide ? " bw-sheet--wide" : ""}`}>
        <div className="bw-sheet__head">
          <span className="bw-h2">{title}</span>
          <Button variant="quiet" icon="close" iconOnly onClick={onClose}>Sluiten</Button>
        </div>
        <div className="bw-sheet__body">{children}</div>
        {footer && <div className="bw-sheet__foot">{footer}</div>}
      </div>
    </>
  );
}
