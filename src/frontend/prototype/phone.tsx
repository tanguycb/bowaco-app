// Werfleider op de gsm: Mijn dag → Werfverslag (4 stappen) → Werfkaart.
import { useMemo, useState } from "react";
import { Button, Card, Choice, ConnectionStatus, Icon, PhotoGrid, Sheet, StatusBadge, Steps, Stepper, Wordmark, type PhotoItem } from "../src/design";
import { ATTENDEES, CONTACTS, MATERIAL_KINDS, MATERIALS, OAS, REPORTS, TODAY, VEHICLES, fmtDur, fmtMin, slotsMinutes, type Attendee, type Task } from "./data";
import { RECEIPT_PHOTO, SAMPLE_PHOTOS, WORK_PHOTOS, fmtBytes, shrink } from "./photos";
import { IssueSheet, QuickActions, TaskSheet, issueWord, type Issue } from "./quick";
import { useSave, useStore } from "./state";

type Screen = "dag" | "verslag" | "werf";

export function PhoneApp({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const { online, waiting, syncedAt } = useStore();
  const titles: Record<Screen, string> = { dag: "", verslag: "Werfverslag", werf: "Werf" };
  return (
    <div className="m-app">
      <header className="m-bar">
        {screen === "dag" ? <Wordmark /> : (
          <button type="button" className="m-bar__back" onClick={() => go("dag")}><Icon name="back" />Mijn dag</button>
        )}
        <span className="m-bar__title">{titles[screen]}</span>
        <ConnectionStatus online={online} waiting={waiting} syncedAt={online ? syncedAt : undefined} />
      </header>
      {/* alle schermen blijven bestaan: terug gaan verliest niets (§8.1 regel 4) */}
      <div hidden={screen !== "dag"}><MijnDag go={go} /></div>
      <div hidden={screen !== "verslag"}><Werfverslag go={go} /></div>
      <div hidden={screen !== "werf"}><Werfkaart go={go} /></div>
    </div>
  );
}

/* ------------------------------------------------------------------ Mijn dag */

function MijnDag({ go }: { go: (s: Screen) => void }) {
  const { online, syncedAt, reportDone, tasks } = useStore();
  const todayOpen = tasks.filter((t) => t.today && t.status !== "done").length;
  return (
    <div className="m-screen">
      <div className="m-hello">
        <span className="bw-label">{TODAY.label} · week {TODAY.week}</span>
        <h1 className="bw-h1">Goedemorgen, Jonas</h1>
        {!online && <span className="bw-muted">Geen bereik. Je ziet de stand van {syncedAt}; wat je invult, wordt bewaard.</span>}
      </div>

      <Card
        raised
        title={<button type="button" className="m-titlelink" onClick={() => go("werf")}>Engelhoekstraat 29 <Icon name="next" size={20} /></button>}
        meta="Sint-Martens-Leerne"
        aside={<StatusBadge status="busy" />}
      >
        <ul className="m-facts">
          <li><Icon name="people" size={20} /><span><b>GILS</b> (3) vanaf 07:30 · jij</span></li>
          <li><Icon name="list" size={20} /><span>{todayOpen} taken voor vandaag</span></li>
          <li className="m-facts--ok"><Icon name="permit" size={20} /><span>Vergunning container geldig t.e.m. 30-11</span></li>
          <li className="m-facts--warn"><Icon name="alert" size={20} /><span><b>Let op:</b> GILS staat om 13:00 ook op Onderbergen 50 (balustrade). Alexis is verwittigd.</span></li>
          {reportDone !== "none" && (
            <li className={reportDone === "sent" ? "m-facts--ok" : "m-facts--warn"}>
              <Icon name={reportDone === "sent" ? "check" : "clock"} size={20} />
              <span>Verslag van vandaag {reportDone === "sent" ? "afgesloten en verzonden" : "afgesloten, wacht op verbinding"}</span>
            </li>
          )}
        </ul>
        <QuickActions place="Engelhoekstraat" />
      </Card>

      <Card
        title="Onderbergen 50"
        meta="9000 Gent"
        aside={<StatusBadge status="delayed" extra="+5 wd" />}
      >
        <ul className="m-facts">
          <li><Icon name="clock" size={20} /><span><b>GILS</b> om 13:00: balustrade ophangen</span></li>
          <li><Icon name="alert" size={20} /><span>Crepi buurman wacht op droog weer</span></li>
          <li><Icon name="permit" size={20} /><span>Geen vergunning nodig deze week</span></li>
        </ul>
      </Card>

      <p className="bw-muted m-center">Laatste verslag: woensdag 21-10, 16:42 · verzonden</p>

      <div className="m-foot">
        <Button variant={reportDone === "none" ? "primary" : "secondary"} size="lg" block icon="edit" onClick={() => go("verslag")}>
          {reportDone === "none" ? "Werfverslag" : "Verslag aanvullen"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Werfverslag */

const STEPS = ["Wie was er?", "Wat is er gedaan?", "Foto's", "Bijzonderheden"];

function Werfverslag({ go }: { go: (s: Screen) => void }) {
  const { online, tasks, setTasks, setReportDone } = useStore();
  const save = useSave();
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(0);
  const [people, setPeople] = useState<Attendee[]>(ATTENDEES);
  const [edit, setEdit] = useState<Attendee | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>(SAMPLE_PHOTOS);
  const [photo, setPhoto] = useState<PhotoItem | null>(null);
  const [materials, setMaterials] = useState(MATERIALS.map((m) => ({ ...m })));
  const [matSheet, setMatSheet] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issueKind, setIssueKind] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState(VEHICLES[0]);
  const [driverOut, setDriverOut] = useState("Jonas");
  const [driverBack, setDriverBack] = useState("Jonas");

  const todayTasks = tasks.filter((t) => t.today);
  const regie = people.filter((p) => p.regie).map((p) => ({ org: p.org, min: slotsMinutes(p.slots) * p.count }));
  const goStep = (i: number) => { setStep(i); setSeen((s) => Math.max(s, i)); document.querySelector(".m-scroll")?.scrollTo({ top: 0 }); };

  const finish = () => {
    setReportDone("waiting");
    save("Werfverslag afgesloten", () => setReportDone("sent"));
    goStep(0); setSeen(0);
    go("dag");
  };

  const onFiles = async (files: File[]) => {
    for (const f of files) {
      const r = await shrink(f);
      setPhotos((ps) => [{ id: `u${Date.now()}${Math.random()}`, src: r.src, caption: `Nieuw · ${fmtBytes(r.after)}`, pending: !online }, ...ps]);
    }
    save(files.length === 1 ? "Foto toegevoegd" : `${files.length} foto's toegevoegd`);
  };

  return (
    <div className="m-screen">
      <div className="m-hello">
        <span className="bw-label">Engelhoekstraat 29 · {TODAY.short}</span>
        <Steps steps={STEPS} current={step} visited={seen} onGo={goStep} />
      </div>

      {step === 0 && (
        <section className="m-section">
          <h1 className="bw-h1">Wie was er?</h1>
          <p className="bw-muted">Ingevuld uit de planning van vandaag. Tik op een ploeg om de uren aan te passen.</p>
          {people.map((p) => (
            <button key={p.id} type="button" className="m-person" onClick={() => setEdit(p)}>
              <span className="m-person__code">{p.org}</span>
              <span className="m-person__main">
                <span className="bw-h3">{p.who}</span>
                <span className="bw-muted bw-num">{p.slots.map(([a, b]) => `${fmtMin(a)}–${fmtMin(b)}`).join(" · ")}</span>
                <span className="m-person__tags">
                  {p.fromPlan && <span className="m-tag">uit planning</span>}
                  {p.regie && <span className="m-tag m-tag--regie">regie</span>}
                </span>
              </span>
              <span className="m-person__sum bw-num">{p.count > 1 && <small>{p.count} × </small>}{fmtDur(slotsMinutes(p.slots))}</span>
            </button>
          ))}
          <Button block icon="plus" onClick={() => setAdding(true)}>Iemand toevoegen</Button>
          <div className="m-total">
            <span className="bw-label">Regie-uren vandaag</span>
            {regie.length === 0 ? <span>geen</span> : regie.map((r) => <span key={r.org} className="bw-num"><b>{r.org}</b> {fmtDur(r.min)}</span>)}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="m-section">
          <h1 className="bw-h1">Wat is er gedaan?</h1>
          <p className="bw-muted">De taken van vandaag. Tik hoe ver ze staan.</p>
          {todayTasks.map((t) => (
            <div key={t.id} className="m-taskdo">
              <div className="m-taskdo__head">
                <span className="bw-h3">{t.title}</span>
                <StatusBadge small status={t.status} />
              </div>
              <span className="bw-muted">{t.oa}</span>
              <Choice
                label={`Voortgang ${t.title}`}
                fill
                value={t.percent ?? 0}
                options={[0, 25, 50, 75, 100].map((v) => ({ value: v, label: v === 100 ? "klaar" : `${v}%` }))}
                onChange={(v) => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, percent: v, status: v === 100 ? "done" : v === 0 ? "planned" : "busy" } : x)))}
              />
            </div>
          ))}
          <label className="bw-field">
            <span className="bw-label">Kort verslag (mag leeg)</span>
            <textarea id="report-note" className="bw-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="bv. putten achterzijde geplaatst, terras uitgezet" />
          </label>
          <Button icon="mic" disabled>Spraakmemo (komt in fase 3)</Button>
        </section>
      )}

      {step === 2 && (
        <section className="m-section">
          <h1 className="bw-h1">Foto's</h1>
          <p className="bw-muted">De camera opent meteen. Neem er zoveel je wil; ze worden op de gsm verkleind.</p>
          <PhotoGrid photos={photos} onFiles={(f) => void onFiles(f)} onOpen={setPhoto} addLabel="Foto nemen" />
          {!online && <p className="bw-muted m-row"><Icon name="clock" size={18} />Foto's met een klokje wachten op verbinding.</p>}
        </section>
      )}

      {step === 3 && (
        <section className="m-section">
          <h1 className="bw-h1">Bijzonderheden</h1>

          <h2 className="bw-h2 m-sub"><Icon name="box" />Materialen</h2>
          {materials.map((m) => (
            <div key={m.id} className="m-line">
              <span className="m-tag">{MATERIAL_KINDS.find((k) => k.key === m.kind)?.label}</span>
              <span>{m.text}</span>
            </div>
          ))}
          <Button block icon="plus" onClick={() => setMatSheet(true)}>Materiaal of bon</Button>

          <h2 className="bw-h2 m-sub"><Icon name="alert" />Problemen en vertraging</h2>
          {issues.length === 0 && <p className="bw-muted">Niets gemeld vandaag.</p>}
          {issues.map((i) => (
            <div key={i.id} className="m-line">
              <span className={`m-tag ${i.kind === "delay" ? "m-tag--warn" : ""}`}>{issueWord(i.kind)}{i.days ? ` +${i.days} wd` : ""}</span>
              <span>{i.text}{i.shifts.length > 0 && <span className="bw-muted"> · schuift: {i.shifts.map((s) => tasks.find((t) => t.id === s)?.title).join(", ")}</span>}</span>
            </div>
          ))}
          <div className="m-two">
            <Button icon="alert" onClick={() => setIssueKind("problem")}>Probleem</Button>
            <Button icon="clock" onClick={() => setIssueKind("delay")}>Vertraging</Button>
          </div>

          <h2 className="bw-h2 m-sub"><Icon name="truck" />Rit</h2>
          <div className="bw-field">
            <span className="bw-label">Voertuig <span className="m-tag">laatste keuze</span></span>
            <Choice label="Voertuig" value={vehicle} onChange={setVehicle} options={VEHICLES.map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="bw-field">
            <span className="bw-label">Bestuurder heen</span>
            <Choice label="Bestuurder heen" fill value={driverOut} onChange={setDriverOut} options={["Jonas", "Gils", "Yannick"].map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="bw-field">
            <span className="bw-label">Bestuurder terug</span>
            <Choice label="Bestuurder terug" fill value={driverBack} onChange={setDriverBack} options={["Jonas", "Gils", "Yannick"].map((v) => ({ value: v, label: v }))} />
          </div>
        </section>
      )}

      <div className="m-foot m-foot--two">
        <Button size="lg" icon="back" onClick={() => (step === 0 ? go("dag") : goStep(step - 1))}>Terug</Button>
        {step < 3
          ? <Button size="lg" variant="primary" onClick={() => goStep(step + 1)}>Volgende<Icon name="next" /></Button>
          : <Button size="lg" variant="primary" icon="check" onClick={finish}>Afsluiten</Button>}
      </div>

      <AttendeeSheet a={edit} onClose={() => setEdit(null)} onSave={(a) => { setPeople((ps) => ps.map((p) => (p.id === a.id ? a : p))); setEdit(null); save(`Uren ${a.org} aangepast`); }} onRemove={(a) => { setPeople((ps) => ps.filter((p) => p.id !== a.id)); setEdit(null); save(`${a.org} uit het verslag gehaald`); }} />
      <Sheet title="Wie was er nog?" open={adding} onClose={() => setAdding(false)}>
        <p className="bw-muted">OA's van deze werf staan eerst. De uren staan op 07:30–16:00; pas ze daarna aan.</p>
        <div className="bw-choice">
          {OAS.filter((o) => !people.some((p) => p.org === o.code)).map((o) => (
            <button key={o.code} type="button" className="bw-choice__opt" onClick={() => {
              const a: Attendee = { id: `p${Date.now()}`, org: o.code, who: o.trade, count: 1, slots: [[450, 720], [750, 960]], regie: false, fromPlan: false };
              setPeople((ps) => [...ps, a]); setAdding(false); setEdit(a);
            }}>{o.code}</button>
          ))}
        </div>
      </Sheet>
      <Sheet title="Foto" open={!!photo} onClose={() => setPhoto(null)}
        footer={<><Button variant="danger" onClick={() => { setPhotos((ps) => ps.filter((p) => p.id !== photo?.id)); setPhoto(null); save("Foto verwijderd"); }}>Verwijderen</Button><Button variant="primary" icon="check" onClick={() => setPhoto(null)}>Klaar</Button></>}>
        {photo && <img src={photo.src} alt="" className="m-bigphoto" />}
        <span className="bw-label">Bij welke taak? (mag leeg)</span>
        <PhotoTaskPick tasks={todayTasks} />
      </Sheet>
      <MaterialSheet open={matSheet} onClose={() => setMatSheet(false)} onAdd={(m) => { setMaterials((ms) => [...ms, m]); save("Materiaal toegevoegd"); }} />
      {issueKind && <IssueSheet open start={issueKind} onClose={() => setIssueKind(null)} onSaved={(i) => setIssues((is) => [...is, i])} />}
    </div>
  );
}

function PhotoTaskPick({ tasks }: { tasks: Task[] }) {
  const [v, setV] = useState<string>("");
  return <Choice label="Taak" value={v} onChange={setV} options={[{ value: "", label: "Geen" }, ...tasks.map((t) => ({ value: t.id, label: t.title.split(/[,+]/)[0] }))]} />;
}

function AttendeeSheet({ a, onClose, onSave, onRemove }: { a: Attendee | null; onClose: () => void; onSave: (a: Attendee) => void; onRemove: (a: Attendee) => void }) {
  const [d, setD] = useState<Attendee | null>(null);
  const cur = d && a && d.id === a.id ? d : a;
  if (!a || !cur) return null;
  const upd = (p: Partial<Attendee>) => setD({ ...cur, ...p });
  const setSlot = (i: number, j: 0 | 1, v: number) => upd({ slots: cur.slots.map((s, k) => (k === i ? (j === 0 ? [v, s[1]] : [s[0], v]) : s)) as [number, number][] });
  const per = slotsMinutes(cur.slots);
  return (
    <Sheet title={`${cur.org} vandaag`} open onClose={() => { setD(null); onClose(); }}
      footer={<><Button variant="danger" onClick={() => { setD(null); onRemove(cur); }}>Niet geweest</Button><Button variant="primary" icon="check" onClick={() => { setD(null); onSave(cur); }}>Bewaren</Button></>}>
      <div className="bw-field">
        <span className="bw-label">Hoeveel personen?</span>
        <Stepper label="Personen" value={cur.count} min={1} max={12} onChange={(v) => upd({ count: v })} />
      </div>
      <label className="bw-field">
        <span className="bw-label">Namen (mag leeg)</span>
        <input id="att-names" className="bw-input" value={cur.who} onChange={(e) => upd({ who: e.target.value })} />
      </label>
      {cur.slots.map((s, i) => (
        <div key={i} className="bw-field">
          <span className="bw-label">{i === 0 ? "Voormiddag" : "Namiddag"}</span>
          <div className="m-two">
            <Stepper label="Van" value={s[0]} step={15} min={300} max={1320} format={fmtMin} onChange={(v) => setSlot(i, 0, v)} />
            <Stepper label="Tot" value={s[1]} step={15} min={300} max={1320} format={fmtMin} onChange={(v) => setSlot(i, 1, v)} />
          </div>
        </div>
      ))}
      {cur.slots.length === 1
        ? <Button icon="plus" onClick={() => upd({ slots: [...cur.slots, [750, 960]] })}>Tweede tijdvak</Button>
        : <Button variant="quiet" onClick={() => upd({ slots: [cur.slots[0]] })}>Eén tijdvak</Button>}
      <div className="bw-field">
        <span className="bw-label">Telt als regie-uren?</span>
        <Choice label="Regie" fill value={cur.regie ? "ja" : "nee"} onChange={(v) => upd({ regie: v === "ja" })} options={[{ value: "ja", label: "Ja, regie" }, { value: "nee", label: "Nee" }]} />
      </div>
      <div className="m-total"><span className="bw-label">Samen</span><span className="bw-num"><b>{cur.count} × {fmtDur(per)} = {fmtDur(per * cur.count)}</b></span></div>
    </Sheet>
  );
}

function MaterialSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (m: { id: string; kind: string; text: string }) => void }) {
  const [kind, setKind] = useState<string>("receipt");
  const [text, setText] = useState("");
  const [bon, setBon] = useState(false);
  return (
    <Sheet title="Materiaal" open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>Annuleren</Button><Button variant="primary" icon="check" onClick={() => { onAdd({ id: `m${Date.now()}`, kind, text: text || (bon ? "Foto van de bon" : "—") }); setText(""); setBon(false); onClose(); }}>Toevoegen</Button></>}>
      <Choice label="Soort" value={kind} onChange={setKind} options={MATERIAL_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
      <label className="bw-field">
        <span className="bw-label">Wat?</span>
        <input id="mat-text" className="bw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="bv. 4 zakken mortel" />
      </label>
      {kind === "receipt" && (bon
        ? <img src={RECEIPT_PHOTO} alt="Foto van de bon" className="m-bigphoto" style={{ maxHeight: 160, objectFit: "cover" }} />
        : <Button icon="receipt" onClick={() => setBon(true)}>Foto van de bon</Button>)}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Werfkaart (gsm) */

function Werfkaart({ go }: { go: (s: Screen) => void }) {
  const { tasks } = useStore();
  const [filter, setFilter] = useState<"nu" | "alles">("nu");
  const [task, setTask] = useState<Task | null>(null);
  const shown = useMemo(() => (filter === "nu" ? tasks.filter((t) => t.today || t.status === "blocked" || t.status === "delayed" || t.weeks.includes("44")) : tasks), [tasks, filter]);
  const live = task ? tasks.find((t) => t.id === task.id) ?? null : null;
  return (
    <div className="m-screen">
      <div className="m-hello">
        <span className="bw-label">Werf · klant Fam. Mertens</span>
        <h1 className="bw-h1">Engelhoekstraat 29</h1>
        <div className="m-row"><span className="bw-muted">Sint-Martens-Leerne</span><StatusBadge status="busy" /></div>
      </div>
      <QuickActions place="Engelhoekstraat" />

      <section className="m-section">
        <h2 className="bw-h2">Vandaag</h2>
        <ul className="m-facts">
          <li><Icon name="people" size={20} /><span><b>GILS</b> (3) · 07:30–16:30 · riolering, wachtbuizen, terras</span></li>
          <li><Icon name="people" size={20} /><span><b>BOWACO</b> · Jonas</span></li>
        </ul>
      </section>

      <section className="m-section">
        <div className="m-row m-row--between">
          <h2 className="bw-h2">Taken</h2>
          <Choice label="Filter" value={filter} onChange={setFilter} options={[{ value: "nu", label: "Nu" }, { value: "alles", label: `Alles (${tasks.length})` }]} />
        </div>
        <div className="m-tasks">
          {shown.map((t) => (
            <button key={t.id} type="button" className="m-task" onClick={() => setTask(t)}>
              <span className="m-task__main">
                <span className="m-task__title">{t.title}</span>
                <span className="bw-muted">{t.oa} · {t.weeks}{t.reason ? ` · ${t.reason}` : ""}</span>
              </span>
              <StatusBadge small status={t.status} extra={t.status === "busy" && t.percent ? `${t.percent}%` : undefined} />
            </button>
          ))}
        </div>
      </section>

      <section className="m-section">
        <h2 className="bw-h2">Foto's</h2>
        <PhotoGrid photos={WORK_PHOTOS} />
      </section>

      <section className="m-section">
        <h2 className="bw-h2">Laatste verslagen</h2>
        {REPORTS.map((r) => (
          <div key={r.day} className="m-report">
            <span className="bw-label">{r.day} · {r.by}</span>
            <span>{r.note}</span>
            <span className="bw-muted bw-num">{r.people} · regie {r.regie} · {r.photos} foto's</span>
          </div>
        ))}
      </section>

      <p className="bw-muted m-center">Werfleider {CONTACTS[0].name}</p>
      <div className="m-foot">
        <Button variant="primary" size="lg" block icon="edit" onClick={() => go("verslag")}>Werfverslag</Button>
      </div>
      <TaskSheet task={live} onClose={() => setTask(null)} />
    </div>
  );
}
