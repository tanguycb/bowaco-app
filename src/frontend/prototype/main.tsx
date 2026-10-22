// Klikbaar prototype van stap 0.5 (geen backend). Bouwt op het design system in src/design.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/design/design.css";
import "./proto.css";
import { Button, Choice, ToastProvider, Wordmark, applyTheme, type Theme } from "../src/design";
import { Bouwstenen } from "./bouwstenen";
import { DesktopApp, type DeskScreen } from "./desktop";
import { PhoneApp } from "./phone";
import { StoreProvider, SyncWatcher, useStore } from "./state";

type View = "gsm" | "desk" | "ds";
type PhoneScreen = "dag" | "verslag" | "werf";

const GUIDE: Record<PhoneScreen, { title: string; tries: string[] }> = {
  dag: {
    title: "Mijn dag",
    tries: [
      "Zo opent de app voor de werfleider: de werven van vandaag, wie er komt, de vergunning en wat misloopt.",
      "Tik op Foto: op een gsm opent de camera meteen.",
      "Zet bovenaan 'Bereik' uit en open het werfverslag: alles blijft werken.",
    ],
  },
  verslag: {
    title: "Werfverslag in vier stappen",
    tries: [
      "Ploegen en uren komen uit de planning. Tik op GILS om personen, tijdvakken en regie aan te passen.",
      "Stap 2: tik hoe ver elke taak staat. Stap 3: foto's. Stap 4: materialen (de zes soorten van het papieren verslag), problemen en de rit.",
      "Terug gaan verliest niets. Afsluiten zonder bereik: het verslag wacht en vertrekt zodra er bereik is.",
    ],
  },
  werf: {
    title: "Werfkaart",
    tries: [
      "Alles over één werf: snelle acties, wie er vandaag is, taken, foto's en de laatste verslagen.",
      "Tik op een taak en kies 'klaar': drie tikken vanaf het openen van de werf.",
      "Vergunning werkt ook zonder bereik; Bellen toont de nummers (verzonnen).",
    ],
  },
};

function Proto() {
  const { online, setOnline } = useStore();
  const [view, setView] = useState<View>("gsm");
  const [theme, setTheme] = useState<Theme>("system");
  const [ps, setPs] = useState<PhoneScreen>("dag");
  const [ds, setDs] = useState<DeskScreen>("dash");
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => { document.querySelector(".m-scroll")?.scrollTo({ top: 0 }); }, [ps]);

  return (
    <div className="p-root bw-root">
      <header className="p-bar">
        <div className="p-bar__brand"><Wordmark sub="prototype 0.5 · ter goedkeuring" /></div>
        <nav className="p-tabs" aria-label="Weergave">
          {([["gsm", "Werfleider · gsm"], ["desk", "Zaakvoerder · desktop"], ["ds", "Bouwstenen"]] as [View, string][]).map(([k, l]) => (
            <button key={k} type="button" className="p-tab" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
          ))}
        </nav>
        <div className="p-ctrl">
          <Choice label="Thema" value={theme} onChange={setTheme} options={[{ value: "system", label: "Auto" }, { value: "light", label: "Licht" }, { value: "dark", label: "Donker" }]} />
          <button type="button" className="p-switch" aria-pressed={online} onClick={() => setOnline(!online)}>
            <span className="p-switch__knob" />Bereik {online ? "aan" : "uit"}
          </button>
        </div>
      </header>
      <p className="p-note">Voorbeelddag: donderdag 22 oktober 2026. Werfadressen, taken en OA-codes komen uit de planning van BOWACO; personen, klanten, nummers en statussen zijn verzonnen. Niets wordt bewaard.</p>

      {view === "gsm" && (
        <div className="p-gsm">
          <div className="p-phone">
            <ToastProvider>
              <SyncWatcher />
              <div className="m-scroll"><PhoneApp screen={ps} go={setPs} /></div>
            </ToastProvider>
          </div>
          <aside className="p-guide">
            <span className="bw-label">Toelichting</span>
            <h2 className="bw-h1">{GUIDE[ps].title}</h2>
            <ul>{GUIDE[ps].tries.map((t) => <li key={t}>{t}</li>)}</ul>
            <div className="p-guide__jump">
              <Button onClick={() => setPs("dag")} disabled={ps === "dag"}>Mijn dag</Button>
              <Button onClick={() => setPs("verslag")} disabled={ps === "verslag"}>Werfverslag</Button>
              <Button onClick={() => setPs("werf")} disabled={ps === "werf"}>Werfkaart</Button>
            </div>
          </aside>
        </div>
      )}
      {view === "desk" && (
        <div className="p-desk">
          <ToastProvider>
            <SyncWatcher />
            <DesktopApp screen={ds} go={setDs} />
          </ToastProvider>
        </div>
      )}
      {view === "ds" && (
        <ToastProvider>
          <Bouwstenen />
        </ToastProvider>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <Proto />
  </StoreProvider>,
);
