import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** Het woordmerk dient als logo zolang er geen ander is (bouwplan §8.6). */
export function Wordmark({ size }: { size?: number }) {
  return <span className="bw-wordmark" style={size ? { fontSize: size } : undefined}>BOWACO</span>;
}

/** Verbindingsstatus in de kop: "Online · 09:12" of "Geen bereik · 3 wachten" (architectuur §8.4). */
export function ConnectionStatus({ online, waiting, syncedAt, onClick }: { online: boolean; waiting: number; syncedAt?: string; onClick?: () => void }) {
  const text = online
    ? waiting > 0 ? `Verzenden… (${waiting})` : `Online${syncedAt ? ` · ${syncedAt}` : ""}`
    : waiting > 0 ? `Geen bereik · ${waiting} ${waiting === 1 ? "wacht" : "wachten"}` : "Geen bereik";
  return (
    <button type="button" className={`bw-conn${online ? "" : " bw-conn--off"}`} onClick={onClick} aria-live="polite">
      {online ? <span className="bw-conn__dot" /> : <Icon name="offline" size={14} />}
      {text}
    </button>
  );
}

/** Keuze uit een paar opties met grote tikvlakken; vervangt schuifregelaars en keuzelijsten op de werf. */
export function Choice<T extends string | number>({ options, value, onChange, fill, label }: { options: { value: T; label: ReactNode }[]; value: T | null; onChange: (v: T) => void; fill?: boolean; label: string }) {
  return (
    <div className={`bw-choice${fill ? " bw-choice--fill" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="bw-choice__opt" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** − waarde + : aantallen en uren zonder toetsenbord. */
export function Stepper({ value, onChange, min = 0, max = 99, step = 1, format, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string; label: string }) {
  return (
    <div className="bw-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} minder`} onClick={() => onChange(Math.max(min, value - step))}><Icon name="minus" /></button>
      <output>{format ? format(value) : value}</output>
      <button type="button" aria-label={`${label} meer`} onClick={() => onChange(Math.min(max, value + step))}><Icon name="plus" /></button>
    </div>
  );
}
