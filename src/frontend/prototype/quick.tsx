// Snelle acties vanaf elke werfkaart (bouwplan §8.3): foto, probleem melden, vergunning tonen, bellen.
import { useState } from "react";
import { Button, Choice, Icon, Sheet, StatusBadge, Stepper, useToast, type Status } from "../src/design";
import { CONTACTS, PERMIT, type Task } from "./data";
import { fmtBytes, shrink } from "./photos";
import { useSave, useStore } from "./state";

export type Issue = { id: string; kind: string; text: string; days?: number; shifts: string[] };

const ISSUE_KINDS = [
  { value: "problem", label: "Probleem" },
  { value: "delay", label: "Vertraging" },
  { value: "safety", label: "Veiligheid" },
  { value: "extra", label: "Meerwerk" },
];
export const issueWord = (k: string) => ISSUE_KINDS.find((x) => x.value === k)?.label ?? k;

export function IssueSheet({ open, onClose, start = "problem", onSaved }: { open: boolean; onClose: () => void; start?: string; onSaved?: (i: Issue) => void }) {
  const { tasks } = useStore();
  const save = useSave();
  const [kind, setKind] = useState(start);
  const [text, setText] = useState("");
  const [days, setDays] = useState(2);
  const [shifts, setShifts] = useState<string[]>([]);
  const upcoming = tasks.filter((t) => t.status === "planned" && !t.today).slice(0, 4);
  const submit = () => {
    const i: Issue = { id: `i${Date.now()}`, kind, text: text || (kind === "delay" ? "Vertraging" : "Probleem"), days: kind === "delay" ? days : undefined, shifts };
    save(kind === "delay" ? `Vertraging gemeld (+${days} wd)` : `${issueWord(kind)} gemeld aan Alexis`);
    onSaved?.(i);
    setText(""); setShifts([]);
    onClose();
  };
  return (
    <Sheet
      title="Melden"
      open={open}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Annuleren</Button><Button variant="primary" icon="check" onClick={submit}>Melden</Button></>}
    >
      <Choice label="Soort" options={ISSUE_KINDS} value={kind} onChange={setKind} fill />
      <label className="bw-field">
        <span className="bw-label">Wat is er?</span>
        <textarea id="issue-text" className="bw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "delay" ? "bv. regen, putten staan vol water" : "bv. leiding niet volgens plan"} />
      </label>
      {kind === "delay" && (
        <>
          <div className="bw-field">
            <span className="bw-label">Hoeveel werkdagen?</span>
            <Stepper label="Werkdagen" value={days} onChange={setDays} min={1} max={30} format={(v) => `${v} wd`} />
          </div>
          <div className="bw-field">
            <span className="bw-label">Wat schuift mee op?</span>
            {upcoming.map((t) => (
              <button key={t.id} type="button" className="m-check" aria-pressed={shifts.includes(t.id)} onClick={() => setShifts((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}>
                <span className="m-check__box">{shifts.includes(t.id) && <Icon name="check" size={18} />}</span>
                <span><b>{t.title}</b><br /><span className="bw-muted">{t.oa} · {t.weeks}</span></span>
              </button>
            ))}
            <span className="bw-muted">Alexis ziet de vertraging meteen bij "Vraagt aandacht"; de OA's van wat opschuift krijgen pas een melding als hij de planning aanpast.</span>
          </div>
        </>
      )}
    </Sheet>
  );
}

export function PermitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet title="Vergunning" open={open} onClose={onClose}>
      <div className="m-permit">
        <span className="bw-label">{PERMIT.by}</span>
        <span className="bw-h2">{PERMIT.kind}</span>
        <dl className="m-dl">
          <dt>Nummer</dt><dd className="bw-num">{PERMIT.nr}</dd>
          <dt>Geldig</dt><dd className="bw-num">{PERMIT.from} t.e.m. {PERMIT.to}</dd>
          <dt>Plaats</dt><dd>{PERMIT.where}</dd>
        </dl>
        <StatusBadge status="done" extra="geldig vandaag" />
      </div>
      <p className="bw-muted m-row"><Icon name="check" size={18} /> Ook zonder bereik te tonen: de vergunningen van de werven van deze week staan op de gsm.</p>
    </Sheet>
  );
}

export function CallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet title="Bellen" open={open} onClose={onClose}>
      {CONTACTS.map((c) => (
        <div key={c.role} className="m-contact">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="bw-label">{c.role}</span>
            <div className="bw-h3">{c.name}</div>
            <div className="bw-num bw-muted" style={{ userSelect: "all" }}>{c.phone}</div>
          </div>
          <a className="bw-btn bw-btn--secondary bw-btn--icon" href={`tel:${c.phone.replace(/\s/g, "")}`} aria-label={`Bel ${c.name}`}><Icon name="phone" /></a>
        </div>
      ))}
      <p className="bw-muted">Namen en nummers in dit prototype zijn verzonnen.</p>
    </Sheet>
  );
}

export function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { setTasks } = useStore();
  const save = useSave();
  if (!task) return null;
  const set = (status: Status) => {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status, percent: status === "done" ? 100 : t.percent } : t)));
    save(`Taak op "${status === "done" ? "klaar" : status === "busy" ? "bezig" : status === "delayed" ? "vertraagd" : status === "blocked" ? "geblokkeerd" : "gepland"}" gezet`);
    onClose();
  };
  const opts: Status[] = ["busy", "done", "delayed", "blocked", "planned"];
  return (
    <Sheet title={task.title} open onClose={onClose}>
      <span className="bw-muted">{task.oa} · {task.weeks}</span>
      <div className="m-status-pick">
        {opts.map((s) => (
          <button key={s} type="button" className="m-status-opt" aria-pressed={task.status === s} onClick={() => set(s)}>
            <StatusBadge status={s} />
          </button>
        ))}
      </div>
      <span className="bw-muted">Eén tik bewaart. Voor een vertraging met uitleg: gebruik Melden.</span>
    </Sheet>
  );
}

/** De vier knoppen. De fotoknop is een echte bestandskeuze: op de gsm opent ze meteen de camera. */
export function QuickActions({ place }: { place: string }) {
  const [sheet, setSheet] = useState<"" | "issue" | "permit" | "call">("");
  const save = useSave();
  const toast = useToast();
  const onPhoto = async (files: FileList | null) => {
    if (!files?.length) return;
    const r = await shrink(files[0]);
    save(`Foto bewaard bij ${place} (${fmtBytes(r.before)} → ${fmtBytes(r.after)})`);
    if (r.after === r.before) toast.show({ kind: "info", text: "Dit bestand kon niet verkleind worden." });
  };
  return (
    <>
      <div className="m-quick">
        <label className="m-quick__btn m-quick__btn--photo">
          <Icon name="camera" size={28} />Foto
          <input type="file" accept="image/*" capture="environment" aria-label={`Foto bij ${place}`} onChange={(e) => { void onPhoto(e.target.files); e.target.value = ""; }} />
        </label>
        <button type="button" className="m-quick__btn" onClick={() => setSheet("issue")}><Icon name="alert" size={28} />Melden</button>
        <button type="button" className="m-quick__btn" onClick={() => setSheet("permit")}><Icon name="permit" size={28} />Vergunning</button>
        <button type="button" className="m-quick__btn" onClick={() => setSheet("call")}><Icon name="phone" size={28} />Bellen</button>
      </div>
      <IssueSheet open={sheet === "issue"} onClose={() => setSheet("")} />
      <PermitSheet open={sheet === "permit"} onClose={() => setSheet("")} />
      <CallSheet open={sheet === "call"} onClose={() => setSheet("")} />
    </>
  );
}
