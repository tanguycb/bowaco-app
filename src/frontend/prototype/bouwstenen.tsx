// Het design system op één pagina: kleuren, letters, onderdelen en de toetsing aan de zeven regels.
import { useState } from "react";
import { Button, Card, Choice, PhotoGrid, StatusBadge, Steps, Stepper, Table, STATUSES, STATUS_WORD, useToast } from "../src/design";
import { SAMPLE_PHOTOS } from "./photos";

const COLORS = [
  { t: "--bw-navy", name: "Marineblauw", role: "merk, titels, kopbalk", light: "#1E1F41", dark: "#C9CBF2" },
  { t: "--bw-bg", name: "Gebroken wit", role: "achtergrond", light: "#F5F4EF", dark: "#10112A" },
  { t: "--bw-surface", name: "Vlak", role: "kaarten, panelen", light: "#FFFFFF", dark: "#1E1F41" },
  { t: "--bw-ink", name: "Inkt", role: "tekst", light: "#16172E", dark: "#F1F0EA" },
  { t: "--bw-accent", name: "Signaalgeel RAL 1003", role: "één actie per scherm", light: "#F9A800", dark: "#FFB81C" },
];
const STATUS_RAL: Record<string, string> = { planned: "venstergrijs", busy: "verkeersblauw RAL 5017", delayed: "signaaloranje RAL 2010", done: "signaalgroen RAL 6032", blocked: "verkeersrood RAL 3020" };

const RULES = [
  ["Open = antwoord", "Werfleider opent op Mijn dag (de werven van vandaag), Alexis op Vraagt aandacht met vier tellers."],
  ["Drie tikken", "Foto: 1 tik op Foto + de sluiter. Taak klaar: werf → taak → klaar. Uren OA: verslag → ploeg → bewaren. Vertraging: Melden → Vertraging → Melden."],
  ["Voorstellen, niet vragen", "Ploegen en uren uit de planning, taken van vandaag, voertuig en bestuurder van de vorige keer, datum en werf staan al ingevuld."],
  ["Eén ding per scherm", "Het verslag is vier stappen met een balk; terug verliest niets; geen tabbladen op de gsm."],
  ["Status in kleur en woord", "Vijf statussen, elk met vaste kleur, vast woord en een eigen vorm (cirkel, half, klok, vinkje, streep)."],
  ["Niets gaat stil weg", "Elke actie toont meteen een melding, een vinkje na het bewaren, zonder bereik 'wacht op verbinding', bij een fout de knop Opnieuw."],
  ["Gewone woorden", "\"Wie was er?\", \"Wat is er gedaan?\", \"Melden\", \"Kan niet\". Enkel VH en OA als afkorting."],
];

export function Bouwstenen() {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [n, setN] = useState(3);
  const [pick, setPick] = useState<string>("50");
  const demoError = () => {
    const id = toast.show({ kind: "wait", text: "Opslaan…" }, 0);
    window.setTimeout(() => toast.update(id, { kind: "error", text: "Niet bewaard: de verbinding viel weg. Je invoer staat er nog.", action: { label: "Opnieuw", run: () => { const j = toast.show({ kind: "wait", text: "Opslaan…" }, 0); window.setTimeout(() => toast.update(j, { kind: "ok", text: "Bewaard" }), 1400); } } }), 1400);
  };
  return (
    <div className="b-page">
      <section className="b-sec">
        <h2 className="bw-h1">Kleuren</h2>
        <p className="bw-muted b-lead">Marineblauw en gebroken wit van bowaco.eu. Eén actiekleur, signaalgeel uit de werfsignalisatie: op een gsm in de zon springt die eruit, en marineblauwe tekst erop haalt 8:1 contrast.</p>
        <div className="b-swatches">
          {COLORS.map((c) => (
            <div key={c.t} className="b-swatch">
              <span className="b-swatch__chip" style={{ background: `var(${c.t})` }} />
              <b>{c.name}</b>
              <span className="bw-muted">{c.role}</span>
              <code className="bw-num">{c.light} · donker {c.dark}</code>
            </div>
          ))}
        </div>
        <h3 className="bw-h3">Vijf statussen</h3>
        <div className="b-statuses">
          {STATUSES.map((s) => (
            <div key={s} className="b-status"><StatusBadge status={s} /><span className="bw-muted">{STATUS_RAL[s]}</span></div>
          ))}
        </div>
        <p className="bw-muted">Altijd kleur + woord ({STATUSES.map((s) => STATUS_WORD[s]).join(" · ")}) + vorm. Zonder kleur blijft de status leesbaar.</p>
      </section>

      <section className="b-sec">
        <h2 className="bw-h1">Letters</h2>
        <div className="b-type">
          <div><span className="bw-label">Playfair Display · titels</span><p className="b-type__display">Engelhoekstraat 29</p></div>
          <div><span className="bw-label">Montserrat · tekst, 17 px op de gsm</span><p className="b-type__text">Wie was er vandaag? GILS met 3 personen, 07:30 tot 16:30, regie 25u30.</p></div>
          <div><span className="bw-label">Woordmerk</span><p className="b-type__mark">BOWACO</p></div>
        </div>
      </section>

      <section className="b-sec">
        <h2 className="bw-h1">Knoppen</h2>
        <p className="bw-muted b-lead">Minstens 48 px hoog; de hoofdknop op de werf 60 px, te raken met handschoenen. Eén gele knop per scherm.</p>
        <div className="b-row">
          <Button variant="primary" size="lg" icon="edit">Werfverslag</Button>
          <Button variant="primary" icon="check">Bewaren</Button>
          <Button icon="plus">Iemand toevoegen</Button>
          <Button variant="quiet" icon="undo">Ongedaan maken</Button>
          <Button variant="danger">Niet geweest</Button>
          <Button busy>Bewaren</Button>
          <Button iconOnly icon="share">Delen</Button>
        </div>
      </section>

      <section className="b-sec b-grid2">
        <div className="b-stack">
          <h2 className="bw-h1">Kaart</h2>
          <Card raised title="Onderbergen 50" meta="9000 Gent · werfleider Jonas" aside={<StatusBadge status="delayed" extra="+5 wd" />}
            actions={<><Button icon="camera">Foto</Button><Button icon="phone">Bellen</Button></>}>
            <span>Crepi buurman wacht op droog weer.</span>
          </Card>
        </div>
        <div className="b-stack">
          <h2 className="bw-h1">Stappen, keuze, teller</h2>
          <Steps steps={["Wie was er?", "Wat is er gedaan?", "Foto's", "Bijzonderheden"]} current={step} visited={3} onGo={setStep} />
          <Choice label="Voortgang" fill value={pick} onChange={setPick} options={["0", "25", "50", "75", "100"].map((v) => ({ value: v, label: v === "100" ? "klaar" : `${v}%` }))} />
          <Stepper label="Personen" value={n} onChange={setN} min={1} />
        </div>
      </section>

      <section className="b-sec">
        <h2 className="bw-h1">Meldingen</h2>
        <p className="bw-muted b-lead">Regel 6, "niets gaat stil weg": eerst "Opslaan…", na de bevestiging (2 à 4 s op het Internet Computer) een vinkje. Bij een fout blijft de invoer staan, met één knop Opnieuw.</p>
        <div className="b-row">
          <Button onClick={() => { const id = toast.show({ kind: "wait", text: "Opslaan…" }, 0); window.setTimeout(() => toast.update(id, { kind: "ok", text: "Bewaard" }), 1600); }}>Toon: bewaard</Button>
          <Button onClick={() => toast.show({ kind: "info", text: "Bewaard op de gsm, wordt verzonden zodra er bereik is." })}>Toon: zonder bereik</Button>
          <Button onClick={demoError}>Toon: fout</Button>
        </div>
      </section>

      <section className="b-sec b-grid2">
        <div className="b-stack">
          <h2 className="bw-h1">Tabel</h2>
          <Table
            rowKey={(r) => r.oa}
            rows={[{ oa: "GILS", n: 3, u: "25u30" }, { oa: "BOWACO", n: 1, u: "8u00" }]}
            columns={[{ key: "o", label: "Ploeg", render: (r) => <b>{r.oa}</b> }, { key: "n", label: "Pers.", right: true, render: (r) => r.n }, { key: "u", label: "Uren", right: true, render: (r) => r.u }]}
          />
          <span className="bw-muted">Op de gsm wordt elke rij een blok: geen horizontale scroll.</span>
        </div>
        <div className="b-stack">
          <h2 className="bw-h1">Foto's</h2>
          <PhotoGrid photos={SAMPLE_PHOTOS.map((p, i) => ({ ...p, pending: i === 0 }))} onFiles={() => toast.show({ kind: "ok", text: "In het prototype wordt de foto niet bewaard." })} />
        </div>
      </section>

      <section className="b-sec">
        <h2 className="bw-h1">Getoetst aan de zeven regels</h2>
        <ol className="b-rules">
          {RULES.map(([t, b], i) => (
            <li key={t}><span className="b-rules__n bw-num">{i + 1}</span><div><b>{t}</b><span className="bw-muted">{b}</span></div></li>
          ))}
        </ol>
      </section>
    </div>
  );
}
