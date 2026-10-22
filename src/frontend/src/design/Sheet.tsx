import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Paneel over het scherm: onderaan op de gsm, rechts op de desktop (side). Esc en tik naast sluiten. */
export function Sheet({ title, open, onClose, children, footer, side }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="bw-sheet-back" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`bw-sheet${side ? " bw-sheet--side" : ""}`}>
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
