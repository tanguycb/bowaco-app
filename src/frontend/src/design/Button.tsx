import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** v3 (4b.3): primary = hoofdknop (zwart), één per scherm; secondary = gewoon (omlijnd); quiet = stil (dunne rand of
   *  icoon); danger = onomkeerbaar, rood omlijnd en apart. */
  variant?: "primary" | "secondary" | "quiet" | "danger";
  /** sm · md · lg: ruim 40 · 48 · 56 px (gsm, handschoenen), dicht 28 · 34 · 42 px (kantoor). */
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: IconName;
  /** Alleen icoon: label wordt aria-label (verplicht voor schermlezers). */
  iconOnly?: boolean;
  /** Toont een draaiertje en blokkeert dubbel tikken (§8.1 regel 6). */
  busy?: boolean;
  children?: ReactNode;
};

/** v3 (4b.3): één hoofdknop per scherm. Een scherm met veel losse blokken die elk apart bewaren (Beheer) zet dit op true:
 *  een hoofdknop wordt daar een gewone knop. Een paneel (Sheet) zet het terug op false: daar blijft de hoofdknop. */
export const GewoneKnoppen = createContext(false);

export function Button({ variant = "secondary", size = "md", block, icon, iconOnly, busy, children, className, disabled, ...rest }: Props) {
  const gewoon = useContext(GewoneKnoppen);
  const v = gewoon && variant === "primary" ? "secondary" : variant;
  const cls = [
    "bw-btn",
    `bw-btn--${v}`,
    size === "lg" && "bw-btn--lg",
    size === "sm" && "bw-btn--sm",
    block && "bw-btn--block",
    iconOnly && "bw-btn--icon",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={iconOnly && typeof children === "string" ? children : rest["aria-label"]}
      {...rest}
    >
      {busy ? <span className="bw-spin" aria-hidden /> : icon && <Icon name={icon} size={size === "lg" ? 24 : size === "sm" ? 16 : 18} />}
      {!iconOnly && children}
    </button>
  );
}
