import type { ReactNode } from "react";

type Props = {
  title?: ReactNode;
  /** Regel onder de titel: adres, wie, wanneer. */
  meta?: ReactNode;
  /** Rechts in de kop, meestal een StatusBadge. */
  aside?: ReactNode;
  /** Knoppen onderaan (snelle acties). */
  actions?: ReactNode;
  /** Hele kaart klikbaar: wordt een <button>. Gebruik dan geen knoppen in de kaart. */
  onOpen?: () => void;
  raised?: boolean;
  children?: ReactNode;
  className?: string;
};

export function Card({ title, meta, aside, actions, onOpen, raised, children, className }: Props) {
  const cls = ["bw-card", raised && "bw-card--raised", onOpen && "bw-card--action", className].filter(Boolean).join(" ");
  const head = (title || aside) && (
    <div className="bw-card__head">
      <div className="bw-card__titles">
        {title && <span className="bw-h2">{title}</span>}
        {meta && <span className="bw-muted">{meta}</span>}
      </div>
      {aside}
    </div>
  );
  if (onOpen) {
    return (
      <button type="button" className={cls} onClick={onOpen}>
        {head}
        {children}
      </button>
    );
  }
  return (
    <section className={cls}>
      {head}
      {children}
      {actions && <div className="bw-card__foot">{actions}</div>}
    </section>
  );
}
