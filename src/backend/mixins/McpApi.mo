// Bots via MCP (stap 3.4 + 3.13, bouwplan §6 "Bots via MCP" en "Autonomie per taak", eigenaar 08-11).
// - De MCP-server: caffeineai-mcp-server 0.1.0 (Streamable HTTP op /mcp, OAuth 2.1 met PKCE, inloggen met Internet Identity op de
//   pagina /mcp-authorize van de app). We gebruiken de modules Mcp en OAuth, NIET MixinMcpServer: die hangt aan AccessControl.
//   Hier dezelfde Candid-namen (_caffeineMcp*), maar met onze eigen regels: de inlogpagina zetten = #manageBots, goedkeuren = enkel
//   een gekoppelde, actieve bot (nooit een persoon).
// - Het beheer van de bots: enkel de beheerder (#manageBots). Fiche, koppelcode, koppelingen, intrekken, voorstellen beslissen en
//   Zelf doen ongedaan maken.
// Elke tool-oproep: lib/Bots.mo (Rights.mayBot + fiche + dagteller + logboek zonder inhoud).
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Http "mo:caffeineai-http-endpoints/Http";
import Mcp "mo:caffeineai-mcp-server/Mcp";
import OAuth "mo:caffeineai-mcp-server/OAuth";
import Types "../types";
import BotViews "../types/botviews";
import Access "../lib/Access";
import Bots "../lib/Bots";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  tenders : Types.TenderState,
  oaInvoices : Types.OaInvoiceState,
  robot : Types.RobotState,
  bots : Types.BotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func botEnv() : Bots.Env { { settings; access; org; works; files; dossier; tenders; oaInvoices; bots; audit; ctr } };

  func requireBotAdmin(caller : Principal) : Types.Person {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBots, null);
    p;
  };

  // ── HTTP: /mcp en de OAuth-adressen (alles via de update-weg, zie Mcp.handleQuery) ──
  public query func http_request(req : Http.Request) : async Http.Response {
    switch (Mcp.handleQuery(req)) { case (?r) r; case null Http.notFound() };
  };

  func bearerOf(req : Http.Request) : ?Text {
    let v = Http.header(req, "authorization") ?? return null;
    let parts = v.split(#char ' ');
    let scheme = parts.next() ?? return null;
    if (scheme.toLower() != "bearer") return null;
    let rest = v.stripStart(#text(scheme # " ")) ?? return null;
    ?rest.trim(#char ' ');
  };

  public func http_request_update(req : Http.Request) : async Http.Response {
    // tools/list toont enkel de tools op de fiche van de bot achter het token; elke oproep controleert alles opnieuw (Bots.call).
    let who : ?Types.Bot = switch (bearerOf(req)) {
      case (?t) switch (OAuth.authenticate(bots.oauth, t, Time.now())) { case (?p) Bots.activeBot(bots, p); case null null };
      case null null;
    };
    let server : Mcp.Server = { name = "BOWACO"; version = "3.13"; instructions = Bots.instructions(); tools = Bots.toolsFor(botEnv(), who) };
    switch (await* Mcp.handleUpdate(bots.oauth, server, req)) { case (?r) r; case null Http.notFound() };
  };

  // ── De koppeling (zelfde namen als het npm-pakket @caffeineai/mcp-server) ──
  public shared ({ caller }) func _caffeineMcpSetSignInOrigin(origin : Text) : async () {
    let p = requireBotAdmin(caller);
    if (not OAuth.validSignInOrigin(origin)) { Runtime.trap("Ongeldig adres: https://<host> zonder pad") };
    bots.oauth.signInOrigin := ?origin;
    Access.audit(audit, caller, ?p.id, null, "mcp-inlogpagina", origin);
  };

  public query func _caffeineMcpSignInOrigin() : async ?Text { bots.oauth.signInOrigin };

  public query func _caffeineMcpClient(clientId : Text) : async ?{ name : Text; redirectUris : [Text] } {
    OAuth.client(bots.oauth, clientId);
  };

  // Enkel een gekoppelde, actieve bot keurt een koppeling goed; elke tool-oproep loopt later als die bot.
  public shared ({ caller }) func _caffeineMcpApprove(request : OAuth.Approval) : async { #ok : Text; #err : Text } {
    let b = switch (Bots.activeBot(bots, caller)) { case (?x) x; case null return #err("Enkel een gekoppelde bot kan een koppeling goedkeuren. Log in met de Internet Identity van de bot en geef eerst de koppelcode in.") };
    let r = await* OAuth.approve(bots.oauth, caller, request, Time.now());
    switch r { case (#ok(_)) Access.audit(audit, caller, null, null, "bot-koppeling", "bot #" # b.id.toText()); case (#err(_)) {} };
    r;
  };

  // Wie is deze identiteit voor de toestemmingspagina?
  public query ({ caller }) func myBot() : async BotViews.MyBot {
    if (caller.isAnonymous()) return #none;
    if (access.links.containsKey(caller)) return #person;
    let id = bots.byPrincipal.get(caller) ?? return #none;
    let b = bots.bots.get(id) ?? return #none;
    if (Rights.botActive(b)) #bot({ name = b.name; vendor = b.vendor }) else #revoked;
  };

  // De koppelcode uit Beheer: bindt deze Internet Identity aan de bot (eenmalig). Een identiteit van een persoon, robot of
  // andere bot kan nooit een bot worden.
  public shared ({ caller }) func claimBotCode(code : Text) : async Result.Result<BotViews.MyBot, Text> {
    Access.requireAuthenticated(caller);
    if (access.links.containsKey(caller)) { return #err("Deze Internet Identity hoort bij een persoon. Gebruik een aparte identiteit voor de bot.") };
    if (robot.robots.containsKey(caller)) { return #err("Geen toegang") };
    if (bots.byPrincipal.containsKey(caller)) { return #err("Deze Internet Identity hoort al bij een bot") };
    let fail = func() : Result.Result<BotViews.MyBot, Text> {
      Access.audit(audit, caller, null, null, "bot-code-fout", "");
      #err("Deze koppelcode klopt niet, is verlopen of is al gebruikt");
    };
    let body = Bots.normalizeCode(code) ?? return fail();
    let h = Bots.codeHash(body);
    let id = bots.byCode.get(h) ?? return fail();
    let b = bots.bots.get(id) ?? return fail();
    let now = Time.now();
    if (b.revokedAt != null or b.principal != null or b.codeHash != ?h or now > b.codeExpiresAt) { return fail() };
    bots.byCode.remove(h);
    bots.bots.add(id, { b with principal = ?caller; codeHash = null; codeExpiresAt = 0; updatedAt = now });
    bots.byPrincipal.add(caller, id);
    Access.audit(audit, caller, null, null, "bot-gekoppeld", "bot #" # id.toText());
    #ok(#bot({ name = b.name; vendor = b.vendor }));
  };

  // ── Beheer van de bots (#manageBots) ───────────────────────────────────
  public query ({ caller }) func mcpInfo() : async BotViews.McpInfo {
    ignore requireBotAdmin(caller);
    {
      signInOrigin = bots.oauth.signInOrigin;
      tools = Config.botTools().map<(Text, Text), BotViews.BotToolInfo>(func((n, t)) = { name = n; task = t; readOnly = t == "" });
      tasks = Config.botTasks().map<(Text, { #auto; #proposal }), BotViews.BotTaskInfo>(func((k, c)) = { key = k; maxAuto = c == #auto });
      never = Config.botNeverTasks();
    };
  };

  func connectionsOf(b : Types.Bot) : [OAuth.Connection] {
    switch (b.principal) { case (?p) OAuth.connections(bots.oauth, p); case null [] };
  };

  func botView(b : Types.Bot, now : Int) : BotViews.BotView {
    var open = 0;
    for (a in bots.actions.values()) if (a.botId == b.id and a.state == #proposed) open += 1;
    {
      id = b.id;
      name = b.name;
      vendor = b.vendor;
      model = b.model;
      principal = b.principal;
      codePending = b.codeHash != null and now <= b.codeExpiresAt;
      codeExpiresAt = b.codeExpiresAt;
      tools = b.tools;
      allWorks = b.allWorks;
      works = b.works;
      docKinds = b.docKinds;
      callsPerDay = b.callsPerDay;
      callsToday = Bots.callsToday(bots, b.id, now);
      tasks = Config.botTasks().map<(Text, { #auto; #proposal }), (Text, Types.BotLevel)>(func((k, _)) = (k, Rights.botLevel(b, k)));
      openActions = open;
      connections = connectionsOf(b).size();
      revokedAt = b.revokedAt;
      rev = b.rev;
      createdAt = b.createdAt;
      updatedAt = b.updatedAt;
    };
  };

  public query ({ caller }) func listBots() : async [BotViews.BotView] {
    ignore requireBotAdmin(caller);
    let now = Time.now();
    bots.bots.values().map(func(b : Types.Bot) : BotViews.BotView = botView(b, now)).toArray();
  };

  func uniq<T>(xs : [T], eq : (T, T) -> Bool) : Bool {
    var i = 0;
    for (x in xs.values()) {
      var j = 0;
      for (y in xs.values()) { if (j > i and eq(x, y)) return false; j += 1 };
      i += 1;
    };
    true;
  };

  // Een fiche bewaren (nieuw of wijzigen, met rev-controle). Een nieuwe taak start op Voorstel; Zelf doen enkel waar de taak
  // het toelaat (Config.botTasks); Nooit-taken zijn niet in te stellen.
  public shared ({ caller }) func saveBot(i : BotViews.BotInput) : async Result.Result<Nat, Text> {
    let p = requireBotAdmin(caller);
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (i.vendor.size() > 40 or i.model.size() > 60) { return #err("Leverancier of model te lang") };
    let vendor = Access.cleanText(i.vendor, 40) ?? "";
    let model = Access.cleanText(i.model, 60) ?? "";
    if (i.tools.size() > 20 or not uniq<Text>(i.tools, Text.equal)) { return #err("Tools: elke tool hoogstens één keer") };
    for (t in i.tools.values()) {
      if (Rights.botTaskOf(t) == null) { return #err("Onbekende tool: " # t) };
    };
    if (i.works.size() > 500 or not uniq<Nat>(i.works, Nat.equal)) { return #err("Werven: elke werf hoogstens één keer") };
    for (w in i.works.values()) {
      switch (works.works.get(w)) { case (?x) { if (x.archivedAt != null) return #err("Werf #" # w.toText() # " is gearchiveerd") }; case null return #err("Onbekende werf #" # w.toText()) };
    };
    if (i.docKinds.size() > 50 or not uniq<Text>(i.docKinds, Text.equal)) { return #err("Documentsoorten: elke soort hoogstens één keer") };
    for (k in i.docKinds.values()) {
      let kv = Dossier.kind(settings, k) ?? return #err("Onbekende documentsoort: " # k);
      if (kv.confidential) { return #err("Een vertrouwelijke documentsoort kan nooit op de fiche van een bot (" # kv.name # ")") };
      if (kv.archived) { return #err("Gearchiveerde documentsoort: " # kv.name) };
    };
    if (i.callsPerDay == 0 or i.callsPerDay > Config.botMaxCallsPerDay) { return #err("Oproepen per dag: 1 tot " # Config.botMaxCallsPerDay.toText()) };
    if (not uniq<(Text, Types.BotLevel)>(i.tasks, func(a, b) = a.0 == b.0)) { return #err("Elke taak hoogstens één keer") };
    for ((k, l) in i.tasks.values()) {
      if (Config.botNeverTasks().any(func n = n == k)) { return #err("Deze taak staat vast op Nooit") };
      let cap = switch (Config.botTasks().find(func((x, _) : (Text, { #auto; #proposal })) : Bool = x == k)) { case (?(_, c)) c; case null return #err("Onbekende taak: " # k) };
      if (l == #auto and cap != #auto) { return #err("De taak " # k # " kan hoogstens Voorstel zijn (ze raakt geld of afspraken)") };
    };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (bots.bots.size() >= Config.maxBots) { return #err("Te veel bots (hoogstens " # Config.maxBots.toText() # ")") };
        let id = Ids.next(ctr, "bot");
        bots.bots.add(id, {
          id;
          name;
          vendor;
          model;
          principal = null;
          codeHash = null;
          codeExpiresAt = 0;
          tools = i.tools;
          allWorks = i.allWorks;
          works = i.works;
          docKinds = i.docKinds;
          callsPerDay = i.callsPerDay;
          tasks = i.tasks;
          revokedAt = null;
          revokedBy = null;
          rev = 1;
          createdAt = now;
          createdBy = p.id;
          updatedAt = now;
          updatedBy = p.id;
          extra = [];
        });
        Access.audit(audit, caller, ?p.id, null, "bot-gemaakt", "bot #" # id.toText() # " " # name);
        #ok(id);
      };
      case (?id) {
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        if (b.revokedAt != null) { return #err("Deze bot is ingetrokken") };
        if (b.rev != i.rev) { return #err("Intussen gewijzigd: herlaad de fiche") };
        bots.bots.add(id, { b with name; vendor; model; tools = i.tools; allWorks = i.allWorks; works = i.works; docKinds = i.docKinds; callsPerDay = i.callsPerDay; tasks = i.tasks; rev = b.rev + 1; updatedAt = now; updatedBy = p.id });
        Access.audit(audit, caller, ?p.id, null, "bot-fiche", "bot #" # id.toText() # " rev " # (b.rev + 1).toText());
        #ok(id);
      };
    };
  };

  // Een eenmalige koppelcode (24 u) voor een bot die nog geen Internet Identity heeft. De code staat enkel in dit antwoord.
  public shared ({ caller }) func newBotCode(botId : Nat) : async Result.Result<BotViews.NewBotCode, Text> {
    ignore requireBotAdmin(caller);
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken.
    let p = requireBotAdmin(caller);
    let b = bots.bots.get(botId) ?? return #err("Onbekende bot");
    if (b.revokedAt != null) { return #err("Deze bot is ingetrokken") };
    if (b.principal != null) { return #err("Deze bot is al gekoppeld. Trek hem in en maak een nieuwe als je een andere identiteit wilt.") };
    let body = Bots.codeFromEntropy(entropy);
    if (body == "") { return #err("Probeer opnieuw") };
    switch (b.codeHash) { case (?old) bots.byCode.remove(old); case null {} };
    let h = Bots.codeHash(body);
    let now = Time.now();
    let expiresAt = now + Config.botCodeValid;
    bots.byCode.add(h, botId);
    bots.bots.add(botId, { b with codeHash = ?h; codeExpiresAt = expiresAt; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, null, "bot-koppelcode", "bot #" # botId.toText());
    #ok({ code = Bots.displayCode(body); expiresAt });
  };

  // Intrekken: de bot kan niets meer (Rights.botActive), alle koppelingen (tokens) vervallen meteen, en zijn identiteit wordt nooit
  // een persoon of een andere bot. Niets wordt gewist; open voorstellen blijven te beslissen.
  public shared ({ caller }) func revokeBot(botId : Nat) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    let b = bots.bots.get(botId) ?? return #err("Onbekende bot");
    if (b.revokedAt != null) { return #err("Al ingetrokken") };
    for (c in connectionsOf(b).values()) switch (b.principal) { case (?pr) OAuth.revoke(bots.oauth, pr, c.id); case null {} };
    switch (b.codeHash) { case (?h) bots.byCode.remove(h); case null {} };
    let now = Time.now();
    bots.bots.add(botId, { b with revokedAt = ?now; revokedBy = ?p.id; codeHash = null; codeExpiresAt = 0; rev = b.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, null, "bot-ingetrokken", "bot #" # botId.toText());
    #ok;
  };

  public query ({ caller }) func botConnections(botId : Nat) : async [BotViews.BotConnectionView] {
    ignore requireBotAdmin(caller);
    let b = bots.bots.get(botId) ?? return [];
    connectionsOf(b).map<OAuth.Connection, BotViews.BotConnectionView>(func c = { id = c.id; clientName = c.clientName; createdAt = c.createdAt; expiresAt = c.expiresAt });
  };

  // Eén koppeling intrekken (bv. een oud toestel of een tweede leverancier), de bot blijft bestaan.
  public shared ({ caller }) func revokeBotConnection(botId : Nat, connectionId : Text) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    let b = bots.bots.get(botId) ?? return #err("Onbekende bot");
    let pr = b.principal ?? return #err("Niet gekoppeld");
    if (not connectionsOf(b).any(func c = c.id == connectionId)) { return #err("Onbekende koppeling") };
    OAuth.revoke(bots.oauth, pr, connectionId);
    Access.audit(audit, caller, ?p.id, null, "bot-koppeling-ingetrokken", "bot #" # botId.toText());
    #ok;
  };

  func botName(id : Nat) : Text { switch (bots.bots.get(id)) { case (?b) b.name; case null "#" # id.toText() } };

  func actionView(a : Types.BotAction) : BotViews.BotActionView {
    let detail : BotViews.BotActionDetail = switch (a.action) {
      case (#docLink(x)) #docLink({ fileId = x.fileId; fileName = switch (files.files.get(x.fileId)) { case (?f) f.name; case null "#" # x.fileId.toText() }; kind = x.kind; title = x.title });
      case (#invoiceCheck(x)) {
        let (number, firm) = switch (oaInvoices.invoices.get(x.invoiceId)) {
          case (?inv) (inv.number, switch (org.orgs.get(inv.orgId)) { case (?o) o.name; case null "" });
          case null ("#" # x.invoiceId.toText(), "");
        };
        #invoiceCheck({ invoiceId = x.invoiceId; number; firm; verdict = x.verdict; remarks = x.remarks });
      };
      case (#other(x)) #other({ tool = x.tool });
    };
    let isDoc = switch (a.action) { case (#docLink(_)) true; case _ false };
    {
      id = a.id;
      botId = a.botId;
      botName = botName(a.botId);
      task = a.task;
      workId = a.workId;
      workCode = switch (a.workId) { case (?w) switch (works.works.get(w)) { case (?x) x.code; case null "" }; case null "" };
      detail;
      reason = a.reason;
      at = a.at;
      state = a.state;
      docId = a.docId;
      createdDoc = a.createdDoc;
      appliedAt = a.appliedAt;
      decidedBy = a.decidedBy;
      decidedAt = a.decidedAt;
      note = a.note;
      canUndo = isDoc and a.docId != null and (a.state == #done or a.state == #accepted);
    };
  };

  // Nieuwste eerst, hoogstens 200. onlyOpen = enkel de voorstellen die nog op een beslissing wachten.
  public query ({ caller }) func botActions(onlyOpen : Bool) : async [BotViews.BotActionView] {
    ignore requireBotAdmin(caller);
    bots.actions.reverseEntries().map(func((_, a) : (Nat, Types.BotAction)) : Types.BotAction = a).filter(func(a : Types.BotAction) : Bool = not onlyOpen or a.state == #proposed).take(200).map(actionView).toArray();
  };

  // Een voorstel aanvaarden (en uitvoeren: een documentkoppeling) of weigeren. Een factuurcontrole aanvaarden wijzigt niets aan de
  // factuur: goedkeuren of betwisten doet een mens in OA-facturen (Nooit voor een bot).
  public shared ({ caller }) func decideBotAction(id : Nat, accept : Bool, note : Text) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    let a = bots.actions.get(id) ?? return #err("Onbekend voorstel");
    if (a.state != #proposed) { return #err("Al beslist") };
    if (note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    if (accept) {
      switch (a.action) {
        case (#docLink(_)) switch (Bots.applyDocLink(botEnv(), a, p.id, now)) { case (#err(m)) return #err(m); case (#ok) {} };
        case _ {};
      };
    };
    a.state := if accept #accepted else #rejected;
    a.decidedBy := ?p.id;
    a.decidedAt := ?now;
    a.note := Access.cleanText(note, Config.maxText) ?? "";
    Access.audit(audit, caller, ?p.id, a.workId, if accept "bot-voorstel-aanvaard" else "bot-voorstel-geweigerd", "#" # id.toText());
    #ok;
  };

  // Ongedaan maken met één klik: wat de bot zelf deed (of een aanvaarde koppeling), zolang niemand het document intussen wijzigde.
  public shared ({ caller }) func undoBotAction(id : Nat) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    let a = bots.actions.get(id) ?? return #err("Onbekende actie");
    if (a.state != #done and a.state != #accepted) { return #err("Niets om ongedaan te maken") };
    switch (Bots.undoDocLink(botEnv(), a, p.id, Time.now())) { case (#err(m)) return #err(m); case (#ok) {} };
    a.state := #undone;
    a.decidedBy := ?p.id;
    a.decidedAt := ?Time.now();
    Access.audit(audit, caller, ?p.id, a.workId, "bot-ongedaan", "#" # id.toText());
    #ok;
  };

  // Het logboek van de tool-oproepen (nieuwste eerst), zonder inhoud.
  public query ({ caller }) func botLog(from : Nat, n : Nat) : async [BotViews.BotCallView] {
    ignore requireBotAdmin(caller);
    bots.log.reverseEntries().map(func((_, c) : (Nat, Types.BotCall)) : Types.BotCall = c).drop(from).take(Nat.min(n, 200)).map(
      func(c : Types.BotCall) : BotViews.BotCallView = { id = c.id; botId = c.botId; botName = botName(c.botId); tool = c.tool; workId = c.workId; argsSha256 = c.argsSha256; at = c.at; outcome = c.outcome; actionId = c.actionId }
    ).toArray();
  };
};
