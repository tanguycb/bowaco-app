import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** §8.1 regel 6 "Niets gaat stil weg": meteen tonen, vinkje na de IC-call, bij fout invoer houden + "Opnieuw". */
type Kind = "wait" | "ok" | "error" | "info";
type ToastItem = { id: number; kind: Kind; text: string; action?: { label: string; run: () => void } };
type Api = {
  show: (t: Omit<ToastItem, "id">, ms?: number) => number;
  update: (id: number, t: Omit<ToastItem, "id">, ms?: number) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Api | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    window.clearTimeout(timers.current.get(id));
  }, []);
  const arm = useCallback((id: number, ms?: number) => {
    window.clearTimeout(timers.current.get(id));
    if (ms) timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
  }, [dismiss]);
  const show = useCallback((t: Omit<ToastItem, "id">, ms = t.kind === "error" ? 0 : 3500) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    arm(id, ms);
    return id;
  }, [arm]);
  const update = useCallback((id: number, t: Omit<ToastItem, "id">, ms = t.kind === "error" ? 0 : 3000) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...t, id } : x)));
    arm(id, ms);
  }, [arm]);
  return (
    <Ctx.Provider value={{ show, update, dismiss }}>
      {children}
      <div className="bw-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`bw-toast bw-toast--${t.kind}`}>
            <span className="bw-toast__icon">
              {t.kind === "wait" ? <span className="bw-spin" /> : <Icon name={t.kind === "ok" ? "check" : t.kind === "error" ? "alert" : "clock"} size={20} />}
            </span>
            <span className="bw-toast__text">{t.text}</span>
            {t.action && <button type="button" className="bw-toast__act" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("useToast buiten ToastProvider");
  return api;
}
