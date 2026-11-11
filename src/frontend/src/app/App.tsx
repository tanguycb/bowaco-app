import { useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Principal } from "@icp-sdk/core/principal";
import { Variant_active_pending_anonymous_unlinked as Status, type Caps, type MeView } from "../backend";
import { Button, ConnectionStatus, Icon, Sheet, useToast, Wordmark, WerkbladVlag } from "../design";
import { cacheGet, cachePut, openDb } from "../offline/db";
import { OutboxProvider, useOutbox } from "../offline/outbox";
import { t } from "../texts/nl";
import { useBackend } from "../util";
import { CodeEntry, Login, Pending } from "../screens/Gate";
import { isMcpAuthorize, McpKoppelen } from "../screens/McpKoppelen";
import { Home } from "../screens/Home";
import { Overzicht } from "../screens/Overzicht";
import { Werven } from "../screens/Werven";
import { WerfDetail } from "../screens/Werf";
import { Team } from "../screens/Team";
import { Adresboek } from "../screens/Adresboek";
import { Beheer } from "../screens/Beheer";
import { TabBar } from "../screens/Tabs";
import { VerslagKies } from "../screens/VerslagKies";
import { activeKey, bottomBar, hubTabs, navFor, resolveRoute } from "./nav";
import { isWerkblad, kruimels, leesKeuze, menuStand, paginaUitleg, toontUitleg } from "./schil";
import { UitlegContext, useWorks } from "../screens/common";
import { t as tt } from "../texts/nl";
import { MijnLogin } from "../screens/MijnLogin";
import { Vandaag } from "../screens/Vandaag";
import { Werfverslag } from "../screens/Werfverslag";
import { OutboxSheet } from "../screens/Verslagen";
import { MijnUren } from "../screens/Extern";
import { TodoPage, TodoTeller } from "../screens/TeDoen";
import { BalkKnop, useBalkSneltoets, Venster as BalkVenster } from "../balk/Balk";
import { PlanningHub } from "../screens/PlanningTabs";
import { IntroCard, StartBanner, useStartState } from "../screens/Start";
import { introKind, startParam } from "./start";
import { forgetUnsaved } from "../screens/Offertes";
import { GemeentenPage, VergunningenPage } from "../screens/Vergunningen";
import { WadmPage } from "../screens/Werfadministratie";
import { Posten } from "../screens/Posten";
import { OffertesPage } from "../screens/Offertes";
import { MijnOffertePage } from "../screens/MijnOfferte";
import { WerfStartPage } from "../screens/WerfStart";
import { OpmetingPage } from "../screens/Opmeting";
import { MijnVorderingPage, VorderingenPage } from "../screens/Vorderingen";
import { MijnFacturenPage, OaFacturenPage } from "../screens/OaFacturen";
import { SalesWorklist } from "../screens/FacturenLijst";
import { NacalcPage } from "../screens/Nacalc";
import { BriefingPage } from "../screens/Briefing";
import { MyTendersPage, TendersOverview } from "../screens/Prijsvragen";

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

  // II-test punt 6: wie afgezet wordt terwijl de app openstaat, krijgt bij de volgende oproep "je toegang is nog niet bevestigd of is stopgezet". Dan meteen me() opnieuw vragen (→ codescherm), en een #code=-link die later binnenkomt (zonder
  // herladen, enkel het deel na #) ook meteen gebruiken.
  useEffect(() => {
    const unlinked = (e: unknown) => /toegang is nog niet bevestigd of is stopgezet/i.test(e instanceof Error ? e.message : String(e));
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
      // 2b.3: na elke geslaagde handeling de stand van de werven opnieuw (stappenbalk en volgende stap)
      if (ev.type === "updated" && ev.action.type === "success") { void qc.invalidateQueries({ queryKey: ["stages"] }); void qc.invalidateQueries({ queryKey: ["balk"] }); }
    });
    return () => { window.removeEventListener("hashchange", onHash); offQ(); offM(); };
  }, [qc]);

  const ob = useOutbox();
  const logout = async () => {
    // Uitloggen wist de lokale gegevens van deze principal (§8.5); de wachtrij is dan al verzonden of bewust weg.
    await ob.wipe().catch(() => {});
    qc.clear();
    forgetUnsaved();
    clear();
  };

  if (isInitializing) return <Gate><p className="bw-muted">{t.common.loading}</p></Gate>;
  // 3.13: de toestemmingspagina voor een bot (OAuth van de MCP-connector) staat los van de gewone app: een bot is geen persoon.
  // 3.12 (review L): geen losse uitlogknop in de kop op deze pagina: McpKoppelen waarschuwt eerst als er nog handelingen wachten.
  if (isMcpAuthorize()) return <Gate><McpKoppelen onLogout={logout} /></Gate>;
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

function Shell({ me, onLogout }: { me: MeView; onLogout: () => void }) {
  const caps = me.caps!;
  const person = me.person!;
  const [route, go] = useRoute();
  const [menu, setMenu] = useState(false);
  const groups = navFor(caps);
  const bar = bottomBar(caps);
  const ob = useOutbox();
  const [outbox, setOutbox] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [kies, setKies] = useState(false);
  const [balk, setBalk] = useState(false); // 4b.2: zoeken en doen
  useBalkSneltoets(setBalk);
  // 4b.3: het menu als rail. De keuze (open of rail) onthoudt dit toestel; zonder keuze beslist de breedte.
  const breedte = useBreedte();
  const [keuze, setKeuze] = useState(() => { try { return leesKeuze(localStorage.getItem("bw-menu")); } catch { return null; } });
  // 4b.3b: op het rekenblad vanzelf een rail; de knop klapt het daar even open (de keuze van het toestel blijft).
  // 4b.3c: ook een werkvorm in een tabblad (vergelijken, vorderingsstaat, …) meldt zich aan en het menu wordt dan een rail.
  const [vormVlag, setVormVlag] = useState(false);
  const werkblad = isWerkblad(route) || vormVlag;
  const [werkbladOpen, setWerkbladOpen] = useState(false);
  const rail = (werkblad && werkbladOpen ? menuStand(breedte, "open") : menuStand(breedte, keuze, werkblad)) === "rail";
  const wisselMenu = () => {
    if (werkblad) { setWerkbladOpen(rail); return; }
    const n = rail ? "open" : "rail";
    setKeuze(n);
    try { localStorage.setItem("bw-menu", n); } catch { /* enkel gemak */ }
  };
  const askLogout = () => (ob.ops.length > 0 ? setLeaving(true) : onLogout());
  // 2b.2: de oude adressen (Instellingen, Codes, Auditlog, Postbode, Boete opzoeken, Organisaties, Onderaannemers)
  // openen hun nieuwe plaats en de adresbalk volgt.
  const { page, redirect } = resolveRoute(route, caps);
  const active = activeKey(groups, redirect ? redirect.split("/") : route);
  const tabs = route.length <= 1 || (toontUitleg(route) && route[0] !== "werven") ? hubTabs(page, caps) : []; // 4b.3: ook met een gekozen regel in de werklijst
  // 2b.4: de uitlegbalk van Aan de slag (?start=3) en "Zo werkt het voor jou" op het startscherm, één keer per persoon.
  const startN = caps.manageSettings ? startParam(window.location.hash) : null;
  const startState = useStartState();
  const kind = introKind(person.roles);
  const atHome = route.length <= 1 && (page === caps.home || (caps.home === "werven" && page === "werven"));
  const showIntro = !!kind && atHome && !!startState.data && !startState.data.introSeen;

  // Een externe die een #code=-link opent terwijl hij al gekoppeld is: de code is niet meer nodig.
  useEffect(() => {
    if (window.location.hash.includes("code=")) go(caps.home);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!redirect) return;
    const q = window.location.hash.split("?")[1];
    window.location.replace(`#/${redirect}${q ? `?${q}` : ""}`);
  }, [redirect]);

  const screen = (() => {
    switch (page) {
      case "overzicht": return <Overzicht go={go} caps={caps} />;
      case "te-doen": return <TodoPage go={go} home={caps.home} />;
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
      case "vorderingen":
        if (caps.progress) return <VorderingenPage caps={caps} go={go} route={route} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "mijn-vordering":
        if (caps.myProgress) return <MijnVorderingPage go={go} route={route} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "oa-facturen":
        if (caps.oaInvoices) return <OaFacturenPage caps={caps} go={go} route={route} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "facturen":
        if (caps.sales) return <SalesWorklist caps={caps} go={go} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "briefing":
        if (caps.manageSettings) return <BriefingPage go={go} caps={caps} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "nacalculatie":
        if (caps.minMeer) return <NacalcPage go={go} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "mijn-facturen":
        if (caps.myOaInvoices) return <MijnFacturenPage />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "mijn-offerte":
        if (caps.myQuotes) return <MijnOffertePage go={go} route={route} />;
        return null;
      case "offertes":
        if (caps.quotes) return <OffertesPage caps={caps} go={go} route={route} />;
        return <Home kind={page} go={go} caps={caps} />;
      // 2c.2: kantoor = de werklijst Offertes → Prijsvragen; een OA = Mijn prijsvragen (enkel zijn firma).
      case "prijsvragen":
        if (caps.tenders) return <TendersOverview go={go} />;
        if (caps.myTenders) return <MyTendersPage go={go} route={route} />;
        return <Home kind={caps.home} go={go} caps={caps} />;
      case "week":
      case "werven":
        // 2b.3: de werf met het tabblad in de URL (#/werven/12/planning); de planning is het tabblad Planning.
        if (route[0] === "werven" && route[1] && /^\d+$/.test(route[1])) {
          return <WerfDetail key={route[1]} id={BigInt(route[1])} caps={caps} go={go} tab={route[2]} sub={route[3]} />;
        }
        return page === "werven" ? <Werven caps={caps} go={go} route={route} /> : <Home kind={page} go={go} caps={caps} />;
      case "uren": return <MijnUren />;
      case "weekbord": return <PlanningHub caps={caps} go={go} sub={route[1]} />;
      case "vergunningen": return <VergunningenPage caps={caps} go={go} />;
      case "gemeenten": return <GemeentenPage caps={caps} />;
      case "werfadministratie": return <WadmPage go={go} canRules={caps.manageSettings} />;
      case "posten": return <Posten caps={caps} />;
      case "team": return <Team caps={caps} me={person} />;
      case "adresboek": return <Adresboek caps={caps} route={route} go={go} />;
      case "beheer": return <Beheer caps={caps} me={person} route={route} go={go} />;
      case "login": return <MijnLogin me={me} />;
      default: return <Home kind="werven" go={go} />;
    }
  })();

  const navList = (onPick?: () => void) => (
    <nav className="a-nav" aria-label={t.menu.hoofdmenu}>
      {groups.map((g) => (
        <div key={g.id} className={`a-nav__group a-nav__group--${g.id}`} role="group" aria-label={g.label ?? undefined}>
          {g.label && <span className="a-nav__label">{g.label}</span>}
          {g.items.map((n) => (
            <a key={n.key} href={`#/${n.to}`} className="a-nav__item" aria-current={active === n.key ? "page" : undefined} onClick={onPick} title={rail && !onPick ? n.label : undefined}>
              <Icon name={n.icon} size={20} />
              <span className="a-nav__t">{n.label}</span>
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  // 4b.3: de ⓘ van het scherm (enkel op het scherm zelf of een tabblad ervan, niet op een stuk dat erin openstaat).
  const r = redirect ? redirect.split("/") : route;
  const uitleg = toontUitleg(r) ? paginaUitleg(page, caps, r[1]) : null;
  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const roleText = person.roles.map((r) => t.roles[r] ?? r).join(", ");

  return (
    <div className={`a-app${bar.length > 0 ? " a-app--bottom" : ""}${rail ? " a-app--rail" : ""}`} data-testid="schil" data-menu={rail ? "rail" : "open"}>
      <aside className="a-side">
        <div className="a-side__brand"><Wordmark size={17} sub={t.app.sub} /><span className="a-side__mono" aria-hidden>B</span></div>
        {navList()}
        <div className="a-me">
          <a href="#/login" className="a-me__link" aria-current={page === "login" ? "page" : undefined} title={t.nav.login}>
            <span className="a-avatar">{initials}</span>
            <span className="a-me__name">{person.name}<small>{t.nav.login}</small></span>
          </a>
          <Button variant="quiet" icon="logout" iconOnly onClick={askLogout}>{t.common.logout}</Button>
        </div>
      </aside>
      <div className="a-main">
        <header className="a-top" data-testid="bovenbalk">
          <span className="a-top__brand"><Wordmark size={16} sub={t.app.sub} /></span>
          <span className="a-top__rail"><Button variant="quiet" size="sm" icon="rail" iconOnly onClick={wisselMenu} aria-expanded={!rail} data-testid="menu-wissel">{rail ? tt.schil.menuUit : tt.schil.menuIn}</Button></span>
          <Kruimelpad route={redirect ? redirect.split("/") : route} caps={caps} />
          <BalkKnop onOpen={() => setBalk(true)} testid="balk-open" />
          <TodoTeller go={go} />
          {(caps.writeReports || caps.measure || ob.ops.length > 0) && <ConnectionStatus online={ob.online} waiting={ob.pending + ob.failed.length} syncedAt={ob.syncedAt ? new Date(ob.syncedAt).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) : undefined} onClick={() => setOutbox(true)} />}
          {bar.length === 0 && <span className="a-top__menu"><Button variant="quiet" icon="menu" iconOnly onClick={() => setMenu(true)}>Menu</Button></span>}
        </header>
        <TabBar tabs={tabs} current={page} go={go} label={t.menu.tabs} />
        {startN !== null && <StartBanner key={startN} n={startN} caps={caps} go={go} />}
        {showIntro && kind && <IntroCard kind={kind} />}
        <WerkbladVlag.Provider value={setVormVlag}><UitlegContext.Provider value={uitleg}>{screen}</UitlegContext.Provider></WerkbladVlag.Provider>
      </div>
      <Sheet title={`${person.name} · ${roleText}`} open={menu} onClose={() => setMenu(false)}>
        <a href="#/login" className="a-me__link a-me__link--sheet" onClick={() => setMenu(false)}>
          <span className="a-avatar">{initials}</span>
          <span className="a-me__name">{person.name}<small>{t.nav.login}</small></span>
        </a>
        {navList(() => setMenu(false))}
        <Button variant="secondary" icon="logout" onClick={askLogout}>{t.common.logout}</Button>
      </Sheet>
      {bar.length > 0 && (
        <nav className="a-bottom" aria-label={t.menu.snelmenu}>
          {bar.map((k) => k === "verslag" ? (
            <button key={k} type="button" className="a-bottom__item a-bottom__main" onClick={() => setKies(true)}><Icon name="plus" size={22} />{t.menu.verslag}</button>
          ) : k === "meer" ? (
            <button key={k} type="button" className="a-bottom__item" onClick={() => setMenu(true)}><Icon name="menu" size={22} />{t.menu.more}</button>
          ) : (
            <a key={k} href={`#/${k}`} className="a-bottom__item" aria-current={active === k ? "page" : undefined}><Icon name={k === "vandaag" ? "home" : "building"} size={22} />{k === "vandaag" ? t.nav.vandaag : t.nav.werven}</a>
          ))}
        </nav>
      )}
      {balk && <BalkVenster caps={caps} userKey={person.id.toString()} go={go} onVerslag={() => setKies(true)} onClose={() => setBalk(false)} />}
      {kies && <VerslagKies go={go} onClose={() => setKies(false)} />}
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

/** 4b.3: de breedte van het venster (voor de rail). */
function useBreedte(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** 4b.3: waar je bent, in de bovenbalk (desktop). Een werf krijgt haar code uit de werflijst van de rol zelf. */
function Kruimelpad({ route, caps }: { route: string[]; caps: Caps }) {
  const works = useWorks();
  const k = kruimels(route, caps);
  const wid = route[0] === "werven" && route[1] && /^\d+$/.test(route[1]) ? route[1] : null;
  const w = wid ? works.data?.find((x) => String(x.id) === wid) : undefined;
  if (w) k.push({ label: `${w.code} · ${w.name}`, to: `werven/${w.id}` });
  return (
    <nav className="a-top__crumbs" aria-label={tt.schil.waar} data-testid="kruimels">
      {k.map((x, i) => (
        <span key={`${i}-${x.to}`} className="a-row--tight" style={{ display: "inline-flex", gap: 6, minWidth: 0 }}>
          {i > 0 && <span className="a-top__sep" aria-hidden>/</span>}
          <a href={`#/${x.to}`} aria-current={i === k.length - 1 ? "page" : undefined}>{x.label}</a>
        </span>
      ))}
    </nav>
  );
}
