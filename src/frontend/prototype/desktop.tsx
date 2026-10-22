// Zaakvoerder op de desktop: Dashboard (Vraagt aandacht) → Weekbord per OA → Werfpagina.
import { useMemo, useState } from "react";
import { Button, Card, Choice, ConnectionStatus, Icon, PhotoGrid, Sheet, StatusBadge, Table, Wordmark, useToast, type IconName, type Status } from "../src/design";
import { DAYS, OAS, PERMIT, REPORTS, WEEKS, WORKS, conflicts, workById, type Assignment, type Conf, type Work } from "./data";
import { WORK_PHOTOS } from "./photos";
import { useSave, useStore } from "./state";

export type DeskScreen = "dash" | "board" | "werf";

export function DesktopApp({ screen, go }: { screen: DeskScreen; go: (s: DeskScreen) => void }) {
  const { online, waiting, syncedAt } = useStore();
  const nav: { key: DeskScreen | string; label: string; icon: IconName; off?: boolean }[] = [
    { key: "dash", label: "Vraagt aandacht", icon: "home" },
    { key: "board", label: "Weekbord", icon: "calendar" },
    { key: "werf", label: "Werven", icon: "grid" },
    { key: "gantt", label: "Planning per werf", icon: "list", off: true },
    { key: "team", label: "Team en OA's", icon: "people", off: true },
  ];
  return (
    <div className="d-app bw-desk">
      <aside className="d-side">
        <div className="d-side__brand"><Wordmark size={17} sub="werven" /></div>
        <nav className="d-nav">
          {nav.map((n) => (
            <button key={n.key} type="button" className="d-nav__item" aria-current={screen === n.key ? "page" : undefined} disabled={n.off} onClick={() => !n.off && go(n.key as DeskScreen)} title={n.off ? "Volgt na 0.5" : undefined}>
              <Icon name={n.icon} size={20} />{n.label}{n.off && <small>later</small>}
            </button>
          ))}
        </nav>
        <div className="d-side__me"><span className="d-avatar">A</span><span>Alexis<br /><small>zaakvoerder</small></span></div>
      </aside>
      <main className="d-main">
        <div className="d-top"><ConnectionStatus online={online} waiting={waiting} syncedAt={syncedAt} /></div>
        {screen === "dash" && <Dashboard go={go} />}
        {screen === "board" && <Weekbord />}
        {screen === "werf" && <Werfpagina />}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ Dashboard */

function Dashboard({ go }: { go: (s: DeskScreen) => void }) {
  const { assignments } = useStore();
  const save = useSave();
  const toast = useToast();
  const [filter, setFilter] = useState<"alle" | Status>("alle");
  const conflict = conflicts(assignments, 43).size > 0;
  const openConf = assignments.filter((a) => a.week >= 43 && a.conf === "open").length;
  const busy = WORKS.filter((w) => w.status === "busy").length;
  const delayed = WORKS.filter((w) => w.status === "delayed").length;
  const [reminded, setReminded] = useState(false);
  const rows = WORKS.filter((w) => filter === "alle" || w.status === filter);

  const attention: { status: Status; extra?: string; title: string; body: string; act: string; run: () => void }[] = [
    ...(conflict ? [{ status: "blocked" as Status, title: "GILS staat vandaag op twee werven", body: "Do 22-10: Engelhoekstraat 29 (riolering) én Onderbergen 50 (balustrade, 13:00).", act: "Oplossen", run: () => go("board") }] : []),
    { status: "delayed", title: "Onderbergen 50 loopt 5 werkdagen achter", body: "Crepi buurman wacht op droog weer. Gemeld door Jonas op 20-10.", act: "Bekijken", run: () => toast.show({ kind: "info", text: "In de app opent hier de werfpagina van Onderbergen 50." }) },
    ...(!reminded ? [{ status: "planned" as Status, extra: "open", title: "KEVIN heeft week 44 nog niet bevestigd", body: "Engelhoekstraat 29: ventilatiebuizen + boringen, ma 26 – vr 30 okt.", act: "Herinneren", run: () => { setReminded(true); save("Herinnering klaargezet voor KEVIN"); } }] : []),
    { status: "blocked", title: "GANDAK kan niet in week 44", body: "Duifhuisstraat 49, terras en lijngoot: \"materiaal pas wk 45\".", act: "Herplannen", run: () => go("board") },
    { status: "delayed", title: "Vergunning container Duifhuisstraat 49 vervalt op 31-10", body: "Chape en tegels lopen tot week 44.", act: "Bekijken", run: () => toast.show({ kind: "info", text: "Vergunningen worden een module in fase 1b." }) },
    { status: "delayed", title: "Geen werfverslag op 21-10", body: "Dieleghemdreef 79, Jette (werfleider Sander).", act: "Vragen", run: () => save("Vraag gestuurd naar Sander") },
  ];

  return (
    <div className="d-page">
      <header className="d-head">
        <div>
          <span className="bw-label">do 22.10.2026 · week 43 · Alexis, zaakvoerder</span>
          <h1 className="bw-h1">Overzicht</h1>
        </div>
      </header>

      <div className="d-counters">
        <Counter n={busy} label="werven bezig" />
        <Counter n={delayed} label="vertraagd" status="delayed" />
        <Counter n={openConf} label="OA-bevestigingen open" status={openConf ? "planned" : undefined} />
        <Counter n={2} label="vergunningen deze maand" />
      </div>

      <div className="d-cols">
        <section className="d-attn">
          <h2 className="bw-h2">Vraagt aandacht <span className="bw-muted bw-num">({attention.length})</span></h2>
          <ol className="d-attn__list">
            {attention.map((a) => (
              <li key={a.title} className="d-attn__item">
                <StatusBadge status={a.status} extra={a.extra} small />
                <div className="d-attn__text"><b>{a.title}</b><span className="bw-muted">{a.body}</span></div>
                <Button onClick={a.run}>{a.act}</Button>
              </li>
            ))}
          </ol>
        </section>
        <section className="d-week">
          <h2 className="bw-h2">Vandaag op de werven</h2>
          <ul className="d-today">
            {assignments.filter((a) => a.week === 43 && a.from <= 3 && a.to >= 3).map((a) => (
              <li key={a.id}><b>{a.oa}</b><span>{workById(a.work).short}</span><span className="bw-muted">{a.task}</span></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="d-block">
        <div className="d-row">
          <h2 className="bw-h2">Werven</h2>
          <Choice label="Filter op status" value={filter} onChange={setFilter} options={[{ value: "alle", label: "Alle" }, { value: "busy", label: "Bezig" }, { value: "delayed", label: "Vertraagd" }, { value: "planned", label: "Gepland" }, { value: "done", label: "Klaar" }]} />
        </div>
        <Table<Work>
          rowKey={(w) => w.id}
          rows={rows}
          onRow={(w) => (w.id === "engel" ? go("werf") : toast.show({ kind: "info", text: "In het prototype is alleen Engelhoekstraat 29 uitgewerkt." }))}
          columns={[
            { key: "w", label: "Werf", render: (w) => <span><b>{w.name}</b><br /><span className="bw-muted">{w.place}</span></span> },
            { key: "s", label: "Status", render: (w) => <StatusBadge small status={w.status} extra={w.statusExtra} /> },
            { key: "l", label: "Werfleider", render: (w) => w.lead },
            { key: "n", label: "Volgende stap", render: (w) => w.next },
            { key: "x", label: "Let op", render: (w) => (w.warn ? <span className="d-warn"><Icon name="alert" size={16} />{w.warn}</span> : <span className="bw-muted">—</span>) },
          ]}
        />
      </section>
    </div>
  );
}

function Counter({ n, label, status }: { n: number; label: string; status?: Status }) {
  return (
    <div className={`d-counter${status ? ` d-counter--${status}` : ""}`}>
      <span className="d-counter__n bw-num">{n}</span>
      <span className="d-counter__l">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ Weekbord */

const CONF: Record<Conf, { word: string; icon: IconName }> = {
  ok: { word: "bevestigd", icon: "check" },
  open: { word: "niet bevestigd", icon: "clock" },
  no: { word: "kan niet", icon: "close" },
};

function Weekbord() {
  const { assignments, setAssignments } = useStore();
  const toast = useToast();
  const [week, setWeek] = useState(43);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [sel, setSel] = useState<Assignment | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const clash = useMemo(() => conflicts(assignments, week), [assignments, week]);
  const inWeek = assignments.filter((a) => a.week === week);
  const rows = OAS.filter((o) => !onlyIssues || inWeek.some((a) => a.oa === o.code && (clash.has(a.id) || a.conf !== "ok")));

  const move = (a: Assignment, to: Partial<Assignment>, text: string) => {
    const before = assignments;
    setAssignments((xs) => xs.map((x) => (x.id === a.id ? { ...x, ...to, conf: "open" } : x)));
    setSel(null);
    const id = toast.show({ kind: "wait", text: "Opslaan…" }, 0);
    window.setTimeout(() => toast.update(id, { kind: "ok", text: `${text} · ${a.oa} moet opnieuw bevestigen`, action: { label: "Ongedaan maken", run: () => setAssignments(() => before) } }, 6000), 1400);
  };

  return (
    <div className="d-page">
      <header className="d-head">
        <div>
          <span className="bw-label">Weekbord per OA</span>
          <h1 className="bw-h1">Week {week} <span className="d-head__sub bw-num">{WEEKS[week].label}</span></h1>
        </div>
        <div className="d-row">
          <Button iconOnly icon="back" disabled={week <= 42} onClick={() => setWeek(week - 1)}>Vorige week</Button>
          <Button onClick={() => setWeek(43)} disabled={week === 43}>Deze week</Button>
          <Button iconOnly icon="next" disabled={week >= 44} onClick={() => setWeek(week + 1)}>Volgende week</Button>
        </div>
      </header>

      <div className="d-row d-row--wrap">
        <Choice label="Toon" value={onlyIssues ? "issues" : "all"} onChange={(v) => setOnlyIssues(v === "issues")} options={[{ value: "all", label: `Alle OA's (${OAS.length})` }, { value: "issues", label: "Alleen wat aandacht vraagt" }]} />
        <div className="d-legend">
          <span><span className="d-chip d-chip--clash d-chip--mini" />dubbel geboekt</span>
          {(Object.keys(CONF) as Conf[]).map((c) => <span key={c}><Icon name={CONF[c].icon} size={16} />{CONF[c].word}</span>)}
        </div>
      </div>

      {clash.size > 0 && (
        <div className="d-alert" role="alert">
          <Icon name="alert" />
          <span><b>Dubbele boeking:</b> {[...new Set(inWeek.filter((a) => clash.has(a.id)).map((a) => a.oa))].join(", ")} staat op dezelfde dag op twee werven. Klik op een rood blok om het te verplaatsen.</span>
        </div>
      )}

      <div className="d-board-wrap">
        <div className="d-board" role="grid" aria-label={`Weekbord week ${week}`}>
          <div className="d-board__row d-board__row--head">
            <div className="d-board__corner bw-label" style={{ gridColumn: 1 }}>OA</div>
            {DAYS.map((d, i) => (
              <div key={d} style={{ gridColumn: i + 2 }} className={`d-board__day${week === 43 && i === 3 ? " d-board__day--today" : ""}`}>
                <span className="bw-label">{d}</span><span className="bw-num">{WEEKS[week].dates[i]}</span>
              </div>
            ))}
            <div className="d-board__corner" style={{ gridColumn: 7 }} />
          </div>
          {rows.map((o) => {
            const mine = inWeek.filter((a) => a.oa === o.code);
            const lanes: Assignment[][] = [];
            for (const a of [...mine].sort((x, y) => x.from - y.from)) {
              const lane = lanes.find((l) => l.every((b) => b.to < a.from || b.from > a.to));
              if (lane) lane.push(a); else lanes.push([a]);
            }
            return (
              <div key={o.code} className="d-board__row" style={{ gridTemplateRows: `repeat(${Math.max(1, lanes.length)}, minmax(56px, auto))` }}>
                <div className="d-board__oa" style={{ gridRow: `1 / span ${Math.max(1, lanes.length)}` }}>
                  <b>{o.code}</b><span className="bw-muted">{o.trade}</span>
                </div>
                {DAYS.map((_, i) => <div key={i} className={`d-board__cell${week === 43 && i === 3 ? " d-board__cell--today" : ""}`} style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, lanes.length)}` }} />)}
                {mine.length === 0 && <div className="d-board__free bw-muted" style={{ gridColumn: "2 / span 5", gridRow: 1 }}>vrij deze week</div>}
                {lanes.map((lane, li) => lane.map((a) => {
                  const bad = clash.has(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`d-chip${bad ? " d-chip--clash" : a.conf === "ok" ? " d-chip--ok" : ""}${a.conf === "no" ? " d-chip--no" : ""}${a.status === "delayed" ? " d-chip--delayed" : ""}`}
                      style={{ gridColumn: `${a.from + 2} / ${a.to + 3}`, gridRow: li + 1 }}
                      onClick={() => setSel(a)}
                    >
                      <span className="d-chip__werf">{workById(a.work).short}</span>
                      <span className="d-chip__task">{a.task}{a.note ? ` · ${a.note}` : ""}</span>
                      <span className="d-chip__conf" title={CONF[a.conf].word}><Icon name={bad ? "alert" : CONF[a.conf].icon} size={16} label={bad ? "dubbel geboekt" : CONF[a.conf].word} /></span>
                    </button>
                  );
                }))}
                <div className="d-board__share" style={{ gridRow: `1 / span ${Math.max(1, lanes.length)}` }}>
                  <Button variant="quiet" iconOnly icon="share" disabled={mine.length === 0} onClick={() => setShare(o.code)}>{`Deel week met ${o.code}`}</Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="bw-muted">Klik op een blok om het te verplaatsen. Slepen kan later als extra; klikken werkt altijd, ook op een tablet.</p>

      <Sheet side title={sel ? `${sel.oa} · ${workById(sel.work).short}` : ""} open={!!sel} onClose={() => setSel(null)}>
        {sel && (
          <>
            <dl className="m-dl">
              <dt>Werf</dt><dd>{workById(sel.work).name}, {workById(sel.work).place}</dd>
              <dt>Taak</dt><dd>{sel.task}</dd>
              <dt>Wanneer</dt><dd className="bw-num">{DAYS[sel.from]} {WEEKS[sel.week].dates[sel.from]}{sel.to > sel.from ? ` – ${DAYS[sel.to]} ${WEEKS[sel.week].dates[sel.to]}` : ""} okt (week {sel.week})</dd>
              <dt>OA</dt><dd><span className="d-conf"><Icon name={CONF[sel.conf].icon} size={16} />{CONF[sel.conf].word}{sel.note ? ` · ${sel.note}` : ""}</span></dd>
            </dl>
            {clash.has(sel.id) && (
              <div className="d-alert"><Icon name="alert" /><span>{sel.oa} staat dan ook op {inWeek.filter((a) => a.oa === sel.oa && a.id !== sel.id && clash.has(a.id)).map((a) => workById(a.work).short).join(", ")}.</span></div>
            )}
            <span className="bw-label">Verplaatsen</span>
            <div className="d-movegrid">
              {sel.week < 44 && <Button variant={clash.has(sel.id) ? "primary" : "secondary"} onClick={() => move(sel, { week: sel.week + 1, from: 0, to: sel.to - sel.from }, `Naar week ${sel.week + 1} verplaatst`)}>Naar volgende week (ma)</Button>}
              {DAYS.map((d, i) => i !== sel.from && sel.to - sel.from === 0 && (
                <Button key={d} onClick={() => move(sel, { from: i, to: i }, `Verplaatst naar ${d} ${WEEKS[sel.week].dates[i]}`)}>{d} {WEEKS[sel.week].dates[i]}</Button>
              ))}
            </div>
            <span className="bw-label">Andere OA</span>
            <div className="bw-choice">
              {OAS.filter((o) => o.code !== sel.oa && o.code !== "BOWACO").slice(0, 6).map((o) => (
                <button key={o.code} type="button" className="bw-choice__opt" onClick={() => move(sel, { oa: o.code }, `Toegewezen aan ${o.code}`)}>{o.code}</button>
              ))}
            </div>
            <span className="bw-muted">Elke verschuiving wordt bewaard met wie, wanneer en waarom; de OA moet opnieuw bevestigen.</span>
          </>
        )}
      </Sheet>

      <Sheet side title={share ? `Week ${week} delen met ${share}` : ""} open={!!share} onClose={() => setShare(null)}
        footer={<><Button onClick={() => setShare(null)}>Sluiten</Button><Button variant="primary" icon="share" onClick={() => { const txt = shareText(share!, week, inWeek); navigator.clipboard?.writeText(txt).then(() => toast.show({ kind: "ok", text: "Tekst gekopieerd: plak hem in WhatsApp" }), () => toast.show({ kind: "info", text: "Kopiëren lukt hier niet; selecteer de tekst." })); }}>Kopieer voor WhatsApp</Button></>}>
        {share && (
          <>
            <div className="d-sharecard">
              <Wordmark size={16} />
              <span className="bw-h2">{share} · week {week}</span>
              <span className="bw-muted bw-num">{WEEKS[week].label}</span>
              <pre className="d-sharetext">{shareText(share, week, inWeek)}</pre>
            </div>
            <span className="bw-muted">In de app gaat dit via de deelknop van de gsm of pc (beeld of PDF + link). De OA bevestigt in de app met één tik.</span>
          </>
        )}
      </Sheet>
    </div>
  );
}

function shareText(oa: string, week: number, list: Assignment[]) {
  const mine = list.filter((a) => a.oa === oa).sort((a, b) => a.from - b.from);
  const lines = mine.map((a) => `${DAYS[a.from]} ${WEEKS[week].dates[a.from]}${a.to > a.from ? `–${DAYS[a.to]} ${WEEKS[week].dates[a.to]}` : ""}: ${workById(a.work).name} – ${a.task}${a.note ? ` (${a.note})` : ""}`);
  return [`BOWACO planning week ${week} voor ${oa}`, ...lines, "Bevestigen of 'kan niet': in de BOWACO-app."].join("\n");
}

/* ------------------------------------------------------------------ Werfpagina (desktop) */

const TABS = ["Overzicht", "Planning", "Verslagen", "Documenten", "Vergunningen", "Team"];

function Werfpagina() {
  const { tasks } = useStore();
  const [tab, setTab] = useState("Overzicht");
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <div className="d-page">
      <header className="d-head">
        <div>
          <span className="bw-label">Werf · werfleider Jonas · klant Fam. Mertens · architect Atelier Noord</span>
          <h1 className="bw-h1">Engelhoekstraat 29 <span className="d-head__sub">Sint-Martens-Leerne</span></h1>
        </div>
        <StatusBadge status="busy" extra={`${done}/${tasks.length} taken klaar`} />
      </header>
      <div className="d-tabs" role="tablist">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className="d-tab" onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "Overzicht" && (
        <div className="d-cols d-cols--werf">
          <section className="d-block">
            <div className="d-progress" aria-label={`${done} van ${tasks.length} taken klaar`}>
              {tasks.map((t) => <span key={t.id} className={`d-progress__seg d-progress__seg--${t.status}`} title={`${t.title}: ${t.status}`} />)}
            </div>
            <Table
              rowKey={(t) => t.id}
              rows={tasks}
              columns={[
                { key: "t", label: "Taak", render: (t) => <span><b>{t.title}</b>{t.reason && <><br /><span className="bw-muted">{t.reason}</span></>}</span> },
                { key: "o", label: "Wie", render: (t) => t.oa },
                { key: "w", label: "Wanneer", render: (t) => t.weeks },
                { key: "s", label: "Status", render: (t) => <StatusBadge small status={t.status} extra={t.status === "busy" && t.percent ? `${t.percent}%` : undefined} /> },
              ]}
            />
          </section>
          <aside className="d-stack">
            <Card title="Laatste verslag" meta={`${REPORTS[0].day} · ${REPORTS[0].by}`}>
              <span>{REPORTS[0].note}</span>
              <span className="bw-muted bw-num">{REPORTS[0].people} · regie {REPORTS[0].regie}</span>
            </Card>
            <Card title="Foto's" meta="deze week">
              <PhotoGrid photos={WORK_PHOTOS} />
            </Card>
            <Card title="Vergunning" meta={PERMIT.by} aside={<StatusBadge small status="done" extra="geldig" />}>
              <span>{PERMIT.kind}</span>
              <span className="bw-muted bw-num">{PERMIT.nr} · t.e.m. {PERMIT.to}</span>
            </Card>
          </aside>
        </div>
      )}
      {tab === "Verslagen" && (
        <div className="d-timeline">
          {REPORTS.map((r) => (
            <Card key={r.day} title={r.day} meta={`door ${r.by} · ${r.photos} foto's`}>
              <span>{r.note}</span>
              <span className="bw-muted bw-num">{r.people} · regie {r.regie}</span>
            </Card>
          ))}
        </div>
      )}
      {tab !== "Overzicht" && tab !== "Verslagen" && (
        <p className="bw-muted d-later">"{tab}" hoort bij de werfpagina (bouwplan §8.4) maar valt buiten dit prototype: {tab === "Planning" ? "de Gantt per werf komt in stap 1.4." : tab === "Vergunningen" ? "vergunningen worden een module in fase 1b." : "dit scherm wordt gebouwd in fase 1."}</p>
      )}
    </div>
  );
}
