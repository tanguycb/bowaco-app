import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Variant_active_pending_anonymous_unlinked as Status, type Caps, type MeView } from "../backend";
import { Button, Icon, Sheet, Wordmark, type IconName } from "../design";
import { t } from "../texts/nl";
import { useBackend } from "../util";
import { CodeEntry, Login, Pending } from "../screens/Gate";
import { Home } from "../screens/Home";
import { Overzicht } from "../screens/Overzicht";
import { Werven } from "../screens/Werven";
import { WerfDetail } from "../screens/Werf";
import { Team } from "../screens/Team";
import { Codes } from "../screens/Codes";
import { Onderaannemers } from "../screens/Onderaannemers";
import { Organisaties } from "../screens/Organisaties";
import { Audit } from "../screens/Audit";
import { Instellingen } from "../screens/Instellingen";
import { MijnLogin } from "../screens/MijnLogin";

/** Hash-router (PWA, geen serverroutes): #/werven/3 → ["werven", "3"]. */
function useRoute(): [string[], (to: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [parts, (to: string) => { window.location.hash = `/${to}`; }];
}

/** Een code uit een uitnodigingslink (…/#code=BOW-…): het deel na # bereikt de server nooit. */
function codeFromLink(): string | null {
  const m = window.location.hash.match(/code=([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const { identity, isAuthenticated, isInitializing, isLoggingIn, isLoginError, loginError, login, clear } = useInternetIdentity();
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const [linkCode] = useState(codeFromLink);
  const me = useQuery({
    // De principal in de sleutel: na inloggen nooit het antwoord van de anonieme sessie hergebruiken.
    queryKey: ["me", identity?.getPrincipal().toText()],
    queryFn: () => actor!.me(),
    enabled: !!actor && !isFetching && isAuthenticated,
  });

  const logout = () => {
    qc.clear();
    clear();
  };

  if (isInitializing) return <Gate><p className="bw-muted">{t.common.loading}</p></Gate>;
  if (!isAuthenticated) {
    return (
      <Gate>
        <Login busy={isLoggingIn} error={isLoginError ? loginError?.message ?? t.common.error : null} onLogin={(google) => (google ? login({ provider: "google" }) : login())} hasCode={!!linkCode} />
      </Gate>
    );
  }
  if (!me.data) {
    return (
      <Gate>
        {me.error ? <p className="a-err">{String(me.error)}</p> : <p className="bw-muted">{t.common.loading}</p>}
      </Gate>
    );
  }
  const refresh = () => qc.invalidateQueries();
  const status = me.data.status;
  if (status === Status.unlinked || status === Status.anonymous) {
    return (
      <Gate onLogout={logout}>
        <CodeEntry initial={linkCode} blockedUntil={me.data.blockedUntil} onDone={refresh} />
      </Gate>
    );
  }
  if (status === Status.pending) {
    return (
      <Gate onLogout={logout}>
        <Pending name={me.data.person?.name ?? ""} onCheck={refresh} />
      </Gate>
    );
  }
  return <Shell me={me.data} onLogout={logout} />;
}

function Gate({ children, onLogout }: { children: ReactNode; onLogout?: () => void }) {
  return (
    <div className="a-gate">
      <Wordmark size={22} sub={t.app.sub} />
      <div className="a-gate__box">{children}</div>
      {onLogout && <Button variant="quiet" icon="logout" onClick={onLogout}>{t.common.logout}</Button>}
    </div>
  );
}

type NavItem = { key: string; label: string; icon: IconName };

/** Welke schermen iemand ziet, volgt uit de caps van de backend (Rights.mo), nooit uit de rollen. */
function navFor(caps: Caps): NavItem[] {
  const homeIcon: Record<string, IconName> = { overzicht: "grid", vandaag: "home", offertes: "doc", week: "calendar", werven: "building" };
  const items: NavItem[] = [{ key: caps.home, label: t.nav[caps.home as keyof typeof t.nav] ?? t.nav.werven, icon: homeIcon[caps.home] ?? "home" }];
  if (caps.home !== "werven") items.push({ key: "werven", label: t.nav.werven, icon: "building" });
  if (caps.readTeam) items.push({ key: "team", label: t.nav.team, icon: "people" });
  if (caps.inviteExternal || caps.manageAccess) items.push({ key: "codes", label: t.nav.codes, icon: "key" });
  if (caps.readOa) items.push({ key: "onderaannemers", label: t.nav.onderaannemers, icon: "building" });
  if (caps.readTeam) items.push({ key: "organisaties", label: t.nav.organisaties, icon: "list" });
  if (caps.readAudit) items.push({ key: "audit", label: t.nav.audit, icon: "receipt" });
  if (caps.manageSettings) items.push({ key: "instellingen", label: t.nav.instellingen, icon: "settings" });
  items.push({ key: "login", label: t.nav.login, icon: "permit" });
  return items;
}

function Shell({ me, onLogout }: { me: MeView; onLogout: () => void }) {
  const caps = me.caps!;
  const person = me.person!;
  const [route, go] = useRoute();
  const [menu, setMenu] = useState(false);
  const nav = navFor(caps);
  const allowed = new Set(nav.map((n) => n.key));
  const page = route[0] && allowed.has(route[0]) ? route[0] : caps.home;

  // Een externe die een #code=-link opent terwijl hij al gekoppeld is: de code is niet meer nodig.
  useEffect(() => {
    if (window.location.hash.includes("code=")) go(caps.home);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const screen = (() => {
    switch (page) {
      case "overzicht": return <Overzicht go={go} />;
      case "vandaag":
      case "week":
      case "offertes":
      case "werven":
        return route[0] === "werven" && route[1] ? <WerfDetail id={BigInt(route[1])} caps={caps} go={go} /> : page === "werven" ? <Werven caps={caps} go={go} /> : <Home kind={page} go={go} />;
      case "team": return <Team caps={caps} me={person} />;
      case "codes": return <Codes caps={caps} me={person} />;
      case "onderaannemers": return <Onderaannemers caps={caps} />;
      case "organisaties": return <Organisaties caps={caps} />;
      case "audit": return <Audit caps={caps} />;
      case "instellingen": return <Instellingen />;
      case "login": return <MijnLogin me={me} />;
      default: return <Home kind="werven" go={go} />;
    }
  })();

  const navList = (onPick?: () => void) => (
    <nav className="a-nav" aria-label="Hoofdmenu">
      {nav.map((n) => (
        <a key={n.key} href={`#/${n.key}`} className="a-nav__item" aria-current={page === n.key ? "page" : undefined} onClick={onPick}>
          <Icon name={n.icon} size={20} />
          {n.label}
        </a>
      ))}
    </nav>
  );

  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const roleText = person.roles.map((r) => t.roles[r] ?? r).join(", ");

  return (
    <div className="a-app">
      <aside className="a-side">
        <div className="a-side__brand"><Wordmark size={17} sub={t.app.sub} /></div>
        {navList()}
        <div className="a-me">
          <span className="a-avatar">{initials}</span>
          <span className="a-me__name">{person.name}<small>{roleText}</small></span>
          <Button variant="quiet" icon="logout" iconOnly onClick={onLogout}>{t.common.logout}</Button>
        </div>
      </aside>
      <div className="a-main">
        <header className="a-bar">
          <span className="a-bar__brand"><Wordmark size={16} sub={t.app.sub} /></span>
          <Button variant="quiet" icon="menu" iconOnly onClick={() => setMenu(true)}>Menu</Button>
        </header>
        {screen}
      </div>
      <Sheet title={`${person.name} · ${roleText}`} open={menu} onClose={() => setMenu(false)}>
        {navList(() => setMenu(false))}
        <Button variant="secondary" icon="logout" onClick={onLogout}>{t.common.logout}</Button>
      </Sheet>
    </div>
  );
}
