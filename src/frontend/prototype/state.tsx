// Gedeelde toestand van het prototype: bereik, wachtrij, planning en taken. Geen backend; alles in het geheugen.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useToast } from "../src/design";
import { ASSIGNMENTS, ENGEL_TASKS, type Assignment, type Task } from "./data";

type Store = {
  online: boolean; setOnline: (v: boolean) => void;
  waiting: number; setWaiting: (f: (n: number) => number) => void;
  syncedAt: string; setSyncedAt: (s: string) => void;
  assignments: Assignment[]; setAssignments: (f: (a: Assignment[]) => Assignment[]) => void;
  tasks: Task[]; setTasks: (f: (t: Task[]) => Task[]) => void;
  reportDone: "none" | "sent" | "waiting"; setReportDone: (v: "none" | "sent" | "waiting") => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  const [syncedAt, setSyncedAt] = useState("07:42");
  const [assignments, setAssignments] = useState(ASSIGNMENTS);
  const [tasks, setTasks] = useState(ENGEL_TASKS);
  const [reportDone, setReportDone] = useState<"none" | "sent" | "waiting">("none");
  return (
    <Ctx.Provider value={{ online, setOnline, waiting, setWaiting, syncedAt, setSyncedAt, assignments, setAssignments, tasks, setTasks, reportDone, setReportDone }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore buiten StoreProvider");
  return s;
}

const now = () => new Date().toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });

/** Bewaren volgens §8.1 regel 6: meteen zichtbaar, vinkje na de IC-call (2–4 s), zonder bereik in de wachtrij. */
export function useSave() {
  const { online, setWaiting } = useStore();
  const toast = useToast();
  return useCallback((okText: string, onSent?: () => void) => {
    if (!online) {
      setWaiting((n) => n + 1);
      toast.show({ kind: "info", text: `${okText}. Bewaard op de gsm, wordt verzonden zodra er bereik is.` }, 4000);
      return false;
    }
    const id = toast.show({ kind: "wait", text: "Opslaan…" }, 0);
    window.setTimeout(() => { toast.update(id, { kind: "ok", text: okText }); onSent?.(); }, 1600);
    return true;
  }, [online, setWaiting, toast]);
}

/** Zodra er weer bereik is: wachtrij verzenden en dat zeggen. */
export function SyncWatcher() {
  const { online, waiting, setWaiting, setSyncedAt, reportDone, setReportDone } = useStore();
  const toast = useToast();
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current && waiting > 0) {
      const n = waiting;
      const id = toast.show({ kind: "wait", text: `${n} ${n === 1 ? "wijziging" : "wijzigingen"} verzenden…` }, 0);
      window.setTimeout(() => {
        setWaiting(() => 0);
        setSyncedAt(now());
        if (reportDone === "waiting") setReportDone("sent");
        toast.update(id, { kind: "ok", text: `${n} ${n === 1 ? "wijziging" : "wijzigingen"} verzonden · ${now()}` });
      }, 2200);
    }
    was.current = online;
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
