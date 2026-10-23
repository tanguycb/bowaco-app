import { Button } from "./Button";
import { Sheet } from "./Sheet";

/** Bevestigen van een onomkeerbare of ingrijpende handeling, in de stijl van de app (geen window.confirm). */
export function Confirm({ open, title, text, confirmLabel, cancelLabel = "Annuleren", busy, onConfirm, onClose }: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} open={open} onClose={onClose} footer={<><Button onClick={onClose}>{cancelLabel}</Button><Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p>{text}</p>
    </Sheet>
  );
}
