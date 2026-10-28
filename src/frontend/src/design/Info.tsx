import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** Kleine ⓘ naast een vakwoord (stap 2b.5). Tikken of Enter toont een korte uitleg; buiten tikken of Escape sluit. */
export function Info({ text, label }: { text: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("touchstart", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <span className="bw-info" ref={box}>
      <button
        type="button"
        className="bw-info__btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="info" size={15} />
      </button>
      {open && (
        <span className="bw-info__tip" role="note" id={id}>
          {text}
        </span>
      )}
    </span>
  );
}

/** Label "nog na te kijken" met de reden in een ⓘ (vervangt het woord VOORLOPIG). */
export function Provisional({ label, reason, infoLabel }: { label: string; reason: ReactNode; infoLabel: string }) {
  return (
    <span className="bw-provisional">
      {label}
      <Info text={reason} label={infoLabel} />
    </span>
  );
}
