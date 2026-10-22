import { Icon } from "./Icon";
import { STATUS_ICON, STATUS_WORD, type Status } from "./tokens";

/** Status = kleur + vast woord + vorm (§8.1 regel 5). Een andere tekst mag alleen als aanvulling ("vertraagd · 2 d"). */
export function StatusBadge({ status, extra, small }: { status: Status; extra?: string; small?: boolean }) {
  return (
    <span className={`bw-status bw-status--${status}${small ? " bw-status--sm" : ""}`}>
      <Icon name={STATUS_ICON[status]} size={small ? 14 : 18} />
      {STATUS_WORD[status]}
      {extra && <span style={{ fontWeight: 500 }}>· {extra}</span>}
    </span>
  );
}
