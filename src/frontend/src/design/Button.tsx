import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = signaalgeel, één per scherm; secondary = omlijnd; quiet = tekst; danger = onomkeerbaar. */
  variant?: "primary" | "secondary" | "quiet" | "danger";
  /** lg = 60 px, de hoofdknop op de werf (handschoenen). */
  size?: "md" | "lg";
  block?: boolean;
  icon?: IconName;
  /** Alleen icoon: label wordt aria-label (verplicht voor schermlezers). */
  iconOnly?: boolean;
  /** Toont een draaiertje en blokkeert dubbel tikken (§8.1 regel 6). */
  busy?: boolean;
  children?: ReactNode;
};

export function Button({ variant = "secondary", size = "md", block, icon, iconOnly, busy, children, className, disabled, ...rest }: Props) {
  const cls = [
    "bw-btn",
    `bw-btn--${variant}`,
    size === "lg" && "bw-btn--lg",
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
      {busy ? <span className="bw-spin" aria-hidden /> : icon && <Icon name={icon} size={size === "lg" ? 26 : 22} />}
      {!iconOnly && children}
    </button>
  );
}
