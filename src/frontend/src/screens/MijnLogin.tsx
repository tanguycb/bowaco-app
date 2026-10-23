// Mijn login: principal (nodig bij herstel en voor de vergelijking draft ↔ live, 0.2 test T2),
// versie, rollen, weergave.
import { useState } from "react";
import type { MeView } from "../backend";
import { applyTheme, Choice, type Theme } from "../design";
import { t } from "../texts/nl";
import { Page, RoleTags } from "./common";
import { Field } from "./Werven";

export function MijnLogin({ me }: { me: MeView }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("bw-theme") as Theme | null) ?? "system";
    } catch {
      return "system";
    }
  });
  const pick = (v: Theme) => {
    setTheme(v);
    applyTheme(v);
    try {
      localStorage.setItem("bw-theme", v);
    } catch {
      /* privévenster: alleen voor deze sessie */
    }
  };
  return (
    <Page title={t.me.title}>
      <section className="a-form" style={{ maxWidth: 640 }}>
        <Field label={t.me.roles}><RoleTags roles={me.person?.roles ?? []} /></Field>
        <Field label={t.me.principal}><span className="a-mono">{me.principal.toText()}</span></Field>
        <p className="bw-muted">{t.me.principalHelp}</p>
        <Field label={t.me.version}><span className="bw-mono">{me.version}</span></Field>
        <Field label={t.me.theme}>
          <Choice label={t.me.theme} value={theme} onChange={pick} options={(["system", "light", "dark"] as Theme[]).map((v) => ({ value: v, label: t.me.themes[v] }))} />
        </Field>
      </section>
    </Page>
  );
}
