import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Principal } from "@icp-sdk/core/principal";
import { Variant_active_pending_anonymous_unlinked as Status, type Caps, type MeView } from "../backend";
import { Button, ConnectionStatus, Icon, Sheet, useToast, Wordmark, type IconName } from "../design";
import { cacheGet, cachePut, openDb } from "../offline/db";
import { OutboxProvider, useOutbox } from "../offline/outbox";
import { t } from "../texts/nl";
import { useBackend } from "../util";
import { CodeEntry, Login, Pending } from "../screens/Gate";
import { Home } from "../screens/Home";
import { Overzicht } from "../screens/Overzicht";
import { Werven } from "../screens/Werven";
import { WerfDetail } from "../screens/Werf";
import { PlanningPage } from "../screens/Planning";
import { Team } from "../screens/Team";
import { Codes } from "../screens/Codes";
import { Onderaannemers } from "../screens/Onderaannemers";
import { Organisaties } from "../screens/Organisaties";
import { Audit } from "../screens/Audit";
import { Instellingen } from "../screens/Instellingen";
import { MijnLogin } from "../screens/MijnLogin";
import { Weekbord } from "../screens/Weekbord";
import { Vandaag } from "../screens/Vandaag";
import { Werfverslag } from "../screens/Werfverslag";
import { OutboxSheet } from "../screens/Verslagen";
import { MijnUren } from "../screens/Extern";
import { Bell } from "../screens/Meldingen";
import { DashboardPage } from "../screens/Dashboard";
import { GemeentenPage, VergunningenPage } from "../screens/Vergunningen";
import { BoetesPage } from "../screens/Boetes";
import { PostbodePage } from "../screens/Postbode";
import { WadmPage } from "../screens/Werfadministratie";
import { Posten } from "../screens/Posten";
import { OffertesPage } from "../screens/Offertes";
import { MijnOffertePage } from "../screens/MijnOfferte";
import { WerfStartPage } from "../screens/WerfStart";
import { OpmetingPage } from "../screens/Opmeting";

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

/** De wachtrij van de gsm leeft rond de hele app (ook tijdens laden zonder bereik). */
export default function App() {
  const toast = useToast();
  return (
    <OutboxProvider onNotice={(n) => toast.show({ kind: "ok", text: n.text })}>
      <AppInner />
    </OutboxProvider>
  );
}

/** me() met vangnet: zonder bereik de laatste bewaarde stand van deze principal (enkel naam, rollen en caps). */
async function meWithCache(actor: { me: () => Promise<MeView> }, principal: string): Promise<MeView> {
  // Zonder lokale opslag (geblokkeerd, privévenster) gaat de app online verder.
  await openDb(principal).catch(() => undefined);
  try {
    const m = await actor.me();
    if (m.person) void cachePut("me", { ...m, principal: principal });
    return m;
  } catch (e) {
    const c = await cacheGet<MeView & { principal: string }>("me");
    if (c && c.value.principal === principal) return { ...c.value, principal: Principal.fromText(principal) } as MeView;
    throw e;
  }
}

function AppInner() {
  const { identity, isAuthenticated, isInitializing, isLoggingIn, isLoginError, loginError, login, clear } = useInternetIdentity();
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const [linkCode, setLinkCode] = useState(codeFromLink);
  const me = useQuery({
    // De principal in de sleutel: na inloggen nooit het antwoord van de anonieme sessie hergebruiken.
    queryKey: ["me", identity?.getPrincipal().toText()],
    queryFn: () => meWithCache(actor!, identity!.getPrincipal().toText()),
    enabled: !!actor && !isFetching && isAuthenticated,
  });

  // II-test punt 6: wie afgezet wordt terwijl de app openstaat, krijgt bij de volgende oproep "geen actieve
  // koppeling". Dan meteen me() opnieuw vragen (→ codescherm), en een #code=-link die later binnenkomt (zonder
  // herladen, enkel het deel na #) ook meteen gebruiken.
  useEffect(() => {
    const unlinked = (e: unknown) => /geen actieve koppeling/i.test(e instanceof Error ? e.message : String(e));
    const recheck = () => void qc.invalidateQueries({ queryKey: ["me"] });
    const onHash = () => {
      const c = codeFromLink();
      if (c) { setLinkCode(c); recheck(); }
    };
    window.addEventListener("hashchange", onHash);
    const offQ = qc.getQueryCache().subscribe((ev) => {
      if (ev.type === "updated" && ev.action.type === "error" && ev.query.queryKey[0] !== "me" && unlinked(ev.action.error)) recheck();
    });
    const offM = qc.getMutationCache().subscribe((ev) => {
      if (ev.type === "updated" && ev.action.type === "error" && unlinked(ev.action.error)) recheck();
    });
    return () => { window.removeEventListener("hashchange", onHash); offQ(); offM(); };
  }, [qc]);

  const ob = useOutbox();
  const logout = async () => {
    // Uitloggen wist de lokale gegevens van deze principal (§8.5); de wachtrij is dan al verzonden of bewust weg.
    await ob.wipe().catch(() => {});
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
      <Gate onLogout={() => void logout()}>
        <CodeEntry key={linkCode ?? ""} initial={linkCode} blockedUntil={me.data.blockedUntil} onDone={refresh} />
      </Gate>
    );
  }
  if (status === Status.pending) {
    return (
      <Gate onLogout={() => void logout()}>
        <Pending name={me.data.person?.name ?? ""} onCheck={refresh} />
      </Gate>
    );
  }
  return <Shell me={me.data} onLogout={() => void logout()} />;
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
  const homeIcon: Record<string, IconName> = { overzicht: "grid", vandaag: "home", offertes: "euro", week: "calendar", werven: "building" };
  const items: NavItem[] = [{ key: caps.home, label: t.nav[caps.home as keyof typeof t.nav] ?? t.nav.werven, icon: homeIcon[caps.home] ?? "home" }];
  // 1.6: wie verslagen schrijft maar een ander startscherm heeft (admin), krijgt Vandaag erbij.
  if (caps.writeReports && caps.home !== "vandaag") items.push({ key: "vandaag", label: t.nav.vandaag, icon: "home" });
  if (caps.home !== "werven") items.push({ key: "werven", label: t.nav.werven, icon: "building" });
  // 1.7: de OA bevestigt zijn uren uit de werfverslagen.
  if (caps.home === "week") items.push({ key: "uren", label: t.nav.uren, icon: "clock" });
  // 1.8: het dashboard voor kantoor (de admin heeft het op zijn startscherm Overzicht).
  if (caps.readOrgPlanning && caps.home !== "overzicht") items.push({ key: "dashboard", label: t.nav.dashboard, icon: "grid" });
  if (caps.readOrgPlanning) items.push({ key: "weekbord", label: t.nav.weekbord, icon: "calendar" });
  // 2.4: de offertes (interne rollen; de werfleider ziet hoeveelheden en hoofdstuktotalen). De calculator heeft ze als start.
  // 2.7: de klant leest zijn verzonden offerte(s) en geeft akkoord.
  if (caps.myQuotes) items.push({ key: "mijn-offerte", label: t.nav.mijnOfferte, icon: "euro" });
  if (caps.quotes && caps.home !== "offertes") items.push({ key: "offertes", label: t.nav.offertes, icon: "euro" });
  // 2.9: opmeting ter plaatse (hoeveelheden, geen prijzen): interne rollen en OA; architect en klant enkel als de beheerder het toelaat.
  if (caps.measureRead) items.push({ key: "opmeting", label: t.nav.opmeting, icon: "ruler" });
  // 2.2: de postenbibliotheek (interne rollen lezen zonder prijzen; beheerder en calculator bewerken en zien de prijzen).
  if (caps.readLibrary) items.push({ key: "posten", label: t.nav.posten, icon: "doc" });
  // 1b.1: vergunningen over alle werven (admin, werfleider) en de kennisbank per gemeente (interne rollen).
  if (caps.permits) items.push({ key: "vergunningen", label: t.nav.vergunningen, icon: "permit" });
  if (caps.readMunicipalities) items.push({ key: "gemeenten", label: t.nav.gemeenten, icon: "pin" });
  // 1b.4: werfadministratie (30bis, Checkinatwork, inhoudingsplicht) voor interne rollen.
  if (caps.wadm) items.push({ key: "werfadministratie", label: t.nav.werfadministratie, icon: "receipt" });
  // 1b.2: boete opzoeken op de ritten (R14: admin alle ritten, werfleider de zijne).
  if (caps.readTrips) items.push({ key: "boetes", label: t.nav.boetes, icon: "truck" });
  if (caps.readTeam) items.push({ key: "team", label: t.nav.team, icon: "people" });
  if (caps.inviteExternal || caps.manageAccess) items.push({ key: "codes", label: t.nav.codes, icon: "key" });
  if (caps.readOa) items.push({ key: "onderaannemers", label: t.nav.onderaannemers, icon: "building" });
  if (caps.readTeam) items.push({ key: "organisaties", label: t.nav.organisaties, icon: "list" });
  if (caps.readAudit) items.push({ key: "audit", label: t.nav.audit, icon: "receipt" });
  // 1b.3: de postbode (mails, wachtrij, robots): enkel de admin.
  if (caps.manageRobots) items.push({ key: "postbode", label: t.nav.postbode, icon: "share" });
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
  if (caps.writeReports) allowed.add("verslag");
  // 2.8: het voorstel "Werf starten" (geen menu-item: je komt er via de werf, het overzicht of de offerte).
  if (caps.workStarts) allowed.add("werfstart");
  const ob = useOutbox();
  const [outbox, setOutbox] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const askLogout = () => (ob.ops.length > 0 ? setLeaving(true) : onLogout());
  const page = route[0] && allowed.has(route[0]) ? route[0] : caps.home;

  // Een externe die een #code=-link opent terwijl hij al gekoppeld is: de code is niet meer nodig.
  useEffect(() => {
    if (window.location.hash.includes("code=")) go(caps.home);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const screen = (() => {
    switch (page) {
      case "overzicht": return <Overzicht go={go} caps={caps} />;
      case "vandaag":
        if (caps.writeReports) return <Vandaag go={go} caps={caps} />;
        return <Home kind={page} go={go} caps={caps} />;
      case "verslag":
        if (route[1] && route[2] && /^\d+$/.test(route[1]) && /^\d+$/.test(route[2])) return <Werfverslag key={`${route[1]}-${route[2]}`} workId={BigInt(route[1])} day={BigInt(route[2])} go={go} />;
        return <Vandaag go={go} caps={caps} />;
      case "werfstart":
        if (caps.workStarts && route[1] && /^\d+$/.test(route[1])) return <WerfStartPage key={route[1]} versionId={BigInt(route[1])} caps={caps} go={go} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "opmeting":
        return <OpmetingPage go={go} route={route} />;
      case "mijn-offerte":
        if (caps.myQuotes) return <MijnOffertePage go={go} route={route} />;
        return null;
      case "offertes":
        if (caps.quotes) return <OffertesPage caps={caps} go={go} route={route} />;
        return <Home kind={page} go={go} caps={caps} />;
      case "week":
      case "werven":
        if (route[0] === "werven" && route[1] && /^\d+$/.test(route[1])) {
          return route[2] === "planning" ? <PlanningPage id={BigInt(route[1])} caps={caps} go={go} /> : <WerfDetail id={BigInt(route[1])} caps={caps} go={go} />;
        }
        return page === "werven" ? <Werven caps={caps} go={go} /> : <Home kind={page} go={go} caps={caps} />;
      case "uren": return <MijnUren />;
      case "dashboard": return <DashboardPage go={go} />;
      case "weekbord": return <Weekbord key={window.location.hash} caps={caps} go={go} />;
      case "vergunningen": return <VergunningenPage caps={caps} go={go} />;
      case "gemeenten": return <GemeentenPage caps={caps} />;
      case "boetes": return <BoetesPage go={go} />;
      case "postbode": return <PostbodePage />;
      case "werfadministratie": return <WadmPage go={go} canRules={caps.manageSettings} />;
      case "posten": return <Posten caps={caps} />;
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
        <div className="a-row--tight"><Bell go={go} home={caps.home} />
        {(caps.writeReports || caps.measure || ob.ops.length > 0) && <ConnectionStatus online={ob.online} waiting={ob.pending + ob.failed.length} syncedAt={ob.syncedAt ? new Date(ob.syncedAt).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) : undefined} onClick={() => setOutbox(true)} />}</div>
        {navList()}
        <div className="a-me">
          <span className="a-avatar">{initials}</span>
          <span className="a-me__name">{person.name}<small>{roleText}</small></span>
          <Button variant="quiet" icon="logout" iconOnly onClick={askLogout}>{t.common.logout}</Button>
        </div>
      </aside>
      <div className="a-main">
        <header className="a-bar">
          <span className="a-bar__brand"><Wordmark size={16} sub={t.app.sub} /></span>
          <Bell go={go} home={caps.home} />
          {(caps.writeReports || caps.measure || ob.ops.length > 0) && <ConnectionStatus online={ob.online} waiting={ob.pending + ob.failed.length} syncedAt={ob.syncedAt ? new Date(ob.syncedAt).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) : undefined} onClick={() => setOutbox(true)} />}
          <Button variant="quiet" icon="menu" iconOnly onClick={() => setMenu(true)}>Menu</Button>
        </header>
        {screen}
      </div>
      <Sheet title={`${person.name} · ${roleText}`} open={menu} onClose={() => setMenu(false)}>
        {navList(() => setMenu(false))}
        <Button variant="secondary" icon="logout" onClick={askLogout}>{t.common.logout}</Button>
      </Sheet>
      {outbox && <OutboxSheet onClose={() => setOutbox(false)} />}
      {leaving && (
        <Sheet title={t.outbox.logoutTitle} open onClose={() => setLeaving(false)}
          footer={<>
            <Button variant="danger" onClick={() => { setLeaving(false); onLogout(); }}>{t.outbox.logoutAnyway}</Button>
            <Button variant="primary" icon="sync" busy={ob.syncing} onClick={() => void ob.sync().then(() => setLeaving(false))}>{t.outbox.logoutSend}</Button>
          </>}>
          <p>{t.outbox.logoutLead(ob.ops.length)}</p>
        </Sheet>
      )}
    </div>
  );
}
