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
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Http "mo:caffeineai-http-endpoints/Http";
import Mcp "mo:caffeineai-mcp-server/Mcp";
import Reply "mo:caffeineai-mcp-server/Reply";
import Tool "mo:caffeineai-mcp-server/Tool";
import Json "mo:jayson/Json";
import Base64 "mo:core/Base64";
import OAuth "mo:caffeineai-mcp-server/OAuth";
import Types "../types";
import BotViews "../types/botviews";
import Access "../lib/Access";
import Bots "../lib/Bots";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Proof "../lib/Proof";
import Rights "../lib/Rights";
import OaRead "../lib/OaRead";

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
  proof : Types.ProofState,
  oa : Types.OaState,
  quotes : Types.QuotesState,
  oaDeals : Types.OaDealState,
  oaRead : Types.OaReadState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  purchases : Types.PurchaseState,
  invCheck : Types.InvCheckState,
  permits : Types.PermitState,
  siteAdmin : Types.SiteAdminState,
  minMeer : Types.MinMeerState,
  library : Types.LibraryState,
  quoteForms : Types.QuoteFormState,
  aiCheck : Types.AiCheckState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func botEnv() : Bots.Env { { settings; access; org; works; files; dossier; tenders; oaInvoices; bots; proof; oa; quotes; oaDeals; oaRead; plan; reports; workStarts; surveys; purchases; invCheck; permits; siteAdmin; minMeer; library; quoteForms; aiCheck; audit; ctr } };

  func requireBotAdmin(caller : Principal) : Types.Person {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBots, null);
    p;
  };

  // ── HTTP: /mcp en de OAuth-adressen (alles via de update-weg, zie Mcp.handleQuery) ──
  public query func http_request(req : Http.Request) : async Http.Response {
    // 3.12 (review H1): een te groot lichaam of token gaat nooit naar de update-weg (de weigering hier kost niets).
    switch (tooBig(req)) { case (?r) return r; case null {} };
    switch (Mcp.handleQuery(req)) { case (?r) r; case null Http.notFound() };
  };

  // 3.12 (review H1): de grootte per adres, vóór er iets van het lichaam gelezen wordt. Zonder deze grens kostte één verzoek van
  // 1,5 MB aan /token (zonder token) ± 900 MB geheugen en 30 miljard cycles, en een tool-oproep van 400 kB met token ± 1,2 GB.
  func tooBig(req : Http.Request) : ?Http.Response {
    let path = Http.path(req.url);
    let max = if (path == "/mcp" or path == "/mcp/") Config.mcpMaxBody else if (path == "/register" or path == "/token") Config.mcpMaxAuthBody else 1_024;
    if (req.body.size() > max) return ?Reply.oauthError(413, "invalid_request", "Request body too large");
    if (req.url.size() > 2_048) return ?Reply.oauthError(414, "invalid_request", "Request URL too long");
    switch (Http.header(req, "authorization")) {
      case (?v) { if (v.size() > Config.mcpMaxToken) return ?Reply.oauthError(401, "invalid_token", "Invalid token") };
      case null {};
    };
    null;
  };

  func rpcRefusal(status : Nat16, code : Int, message : Text) : Http.Response {
    Reply.json(status, #Object([("jsonrpc", #String("2.0")), ("id", #Null), ("error", #Object([("code", #Number(#Int(code))), ("message", #String(message))]))]));
  };

  // Het eerste teken van het lichaam dat geen witruimte is (zonder het lichaam als tekst te lezen).
  func firstByte(body : Blob) : Nat8 {
    for (x in body.values()) { if (x != 32 and x != 9 and x != 10 and x != 13) return x };
    0;
  };

  // 3.12 (review M3): een geldig token van een principal die geen actieve bot (meer) is, bv. een code die vlak vóór het intrekken
  // werd goedgekeurd en erna ingewisseld. Zulke koppelingen gaan meteen weg (ze gaven al geen tools, maar bleven wel verversbaar).
  func dropInactiveGrants() {
    let gone = List.empty<(Principal, Text)>();
    for ((id, g) in bots.oauth.grants.entries()) { if (Bots.activeBot(bots, g.user) == null) gone.add((g.user, id)) };
    for ((u, id) in gone.values()) OAuth.revoke(bots.oauth, u, id);
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
    // 3.12 (review H1): ook hier de grootte eerst (deze functie is ook rechtstreeks aan te roepen, zonder de query ervoor).
    switch (tooBig(req)) { case (?r) return r; case null {} };
    let path0 = Http.path(req.url);
    let isMcp = path0 == "/mcp" or path0 == "/mcp/";
    if (not isMcp and not OAuth.owns(path0)) return Http.notFound();
    // tools/list toont enkel de tools op de fiche van de bot achter het token; elke oproep controleert alles opnieuw (Bots.call).
    let who : ?Types.Bot = switch (bearerOf(req)) {
      case (?t) switch (OAuth.authenticate(bots.oauth, t, Time.now())) {
        case (?p) switch (Bots.activeBot(bots, p)) {
          case (?b) ?b;
          case null {
            // 3.12 (review M3): een geldig token zonder actieve bot = de koppeling weg en "niet aangemeld".
            dropInactiveGrants();
            return Reply.raw(401, [("www-authenticate", "Bearer error=\"invalid_token\""), ("content-type", "application/json")], "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32001,\"message\":\"Sign in required\"}}");
          };
        };
        case null null;
      };
      case null null;
    };
    switch (who) {
      case (?b) if (isMcp and req.method.toUpper() == "POST") {
        // 3.12 (review L): elk verzoek van een bot telt (ook tools/list, ping en initialize, die de dagteller van de tools niet raken).
        let key = b.id.toText() # ":" # Bots.today(Time.now()).toText() # ":http";
        let n = bots.daily.get(key) ?? 0;
        if (n >= Config.mcpMaxHttpPerDay(b.callsPerDay)) return rpcRefusal(429, -32000, "Te veel verzoeken vandaag. Probeer morgen opnieuw.");
        bots.daily.add(key, n + 1);
        // 3.12 (review L): een batch is zelden nodig (sinds MCP 2025-06-18 bestaat hij niet meer); hoogstens enkele berichten.
        if (firstByte(req.body) == 91) {
          let size = switch (Http.bodyText(req)) { case (?t) switch (Json.parse(t)) { case (?#Array(xs)) xs.size(); case _ 0 }; case null 0 };
          if (size > Config.mcpMaxBatch) return rpcRefusal(200, -32600, "Invalid Request: hoogstens " # Config.mcpMaxBatch.toText() # " berichten per batch");
        };
      };
      case null {};
    };
    // 3.8: een bestand als bijlage (inleesbestand, proef_bestand). Het pakket geeft enkel tekstinhoud terug; deze ene oproep
    // beantwoorden we zelf met MCP-inhoud (image of resource met base64). Enkel een gewone POST op /mcp met een geldig token en
    // één JSON-RPC-bericht; al de rest (ook een batch) gaat naar het pakket.
    switch (who) {
      case (?_) switch (mcpContent(req)) { case (?r) return r; case null {} };
      case null {};
    };
    let server : Mcp.Server = { name = "BOWACO"; version = "3.12"; instructions = Bots.instructions(); tools = Bots.toolsFor(botEnv(), who) };
    let out = switch (await* Mcp.handleUpdate(bots.oauth, server, req)) { case (?r) r; case null Http.notFound() };
    // 3.12 (review M3): een code van een intussen ingetrokken bot leverde bij het inwisselen nog een koppeling op: die gaat hier weg.
    if (path0 == "/token") dropInactiveGrants();
    out;
  };

  func mcpContent(req : Http.Request) : ?Http.Response {
    let path = Http.path(req.url);
    if ((path != "/mcp" and path != "/mcp/") or req.method.toUpper() != "POST") return null;
    // 3.12 (review H1): een oproep van een bijlagetool is klein. Een groot lichaam doorzoeken we hier nooit (dat kostte het meest).
    if (req.body.size() > Config.mcpMaxContentCall) return null;
    let body = Http.bodyText(req) ?? return null;
    // Snel: enkel als de naam van een bijlagetool erin staat (anders niets ontleden).
    if (not body.contains(#text "inleesbestand") and not body.contains(#text "proef_bestand") and not body.contains(#text "controlebestand")) return null;
    let #Object(fs) = Json.parse(body) ?? return null else return null;
    let get = func(xs : [(Text, Json.Json)], k : Text) : ?Json.Json { switch (xs.find(func((a, _) : (Text, Json.Json)) : Bool = a == k)) { case (?(_, v)) ?v; case null null } };
    if (get(fs, "method") != ?#String("tools/call")) return null;
    if (get(fs, "jsonrpc") != ?#String("2.0")) return null;
    // Review 3.8 L6: enkel een tekst of getal als id (anders antwoordt het pakket).
    let id = switch (get(fs, "id")) { case (?#String(t)) #String(t); case (?#Number(n)) #Number(n); case _ return null };
    let #Object(params) = get(fs, "params") ?? return null else return null;
    let name = switch (get(params, "name")) { case (?#String(n)) n; case _ return null };
    if (name != "inleesbestand" and name != "proef_bestand" and name != "controlebestand") return null;
    let args : [(Text, Json.Json)] = switch (get(params, "arguments")) { case (?#Object(a)) a; case _ [] };
    let token = bearerOf(req) ?? return null;
    let caller = OAuth.authenticate(bots.oauth, token, Time.now()) ?? return null;
    // De tool moet ook in tools/list van deze bot staan (fiche of open proefronde).
    if (not Bots.toolsFor(botEnv(), Bots.activeBot(bots, caller)).any(func(t : Tool.Tool) : Bool = t.name == name)) return null;
    let idText = id.stringify();
    switch (Bots.contentCall(botEnv(), caller, name, args)) {
      case (#err(m)) ?Reply.json(200, #Object([("jsonrpc", #String("2.0")), ("id", id), ("result", #Object([("content", #Array([#Object([("type", #String("text")), ("text", #String(m))])])), ("isError", #Bool(true))]))]));
      case (#ok(c)) {
        let b64 = Base64.encode(c.bytes);
        let note = (#String(c.note) : Json.Json).stringify();
        // 3.12 (review L): het type gaat als JSON-tekst mee (nu een witte lijst bij het opladen; zo blijft het ook later veilig).
        let mime = (#String(c.mime) : Json.Json).stringify();
        let part = if (c.mime.startsWith(#text "image/")) {
          "{\"type\":\"image\",\"data\":\"" # b64 # "\",\"mimeType\":" # mime # "}";
        } else {
          "{\"type\":\"resource\",\"resource\":{\"uri\":\"bowaco://bestand/" # name # "\",\"mimeType\":" # mime # ",\"blob\":\"" # b64 # "\"}}";
        };
        ?Reply.raw(200, [("content-type", "application/json")], "{\"jsonrpc\":\"2.0\",\"id\":" # idText # ",\"result\":{\"content\":[{\"type\":\"text\",\"text\":" # note # "}," # part # "],\"isError\":false}}");
      };
    };
  };

  // ── De koppeling (zelfde namen als het npm-pakket @caffeineai/mcp-server) ──
  // Anders dan het pakket: een Result (geen trap), en enkel #manageBots. De pagina zet dit niet vanzelf: de beheerder kiest het.
  public shared ({ caller }) func _caffeineMcpSetSignInOrigin(origin : Text) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    if (not OAuth.validSignInOrigin(origin)) { return #err("Ongeldig adres: https://<host> zonder pad") };
    bots.oauth.signInOrigin := ?origin;
    Access.audit(audit, caller, ?p.id, null, "mcp-inlogpagina", origin);
    #ok;
  };

  public query func _caffeineMcpSignInOrigin() : async ?Text { bots.oauth.signInOrigin };

  // 3.12 (review M1): enkel de terugkeeradressen die de beheerder toelaat (Bots.redirectOk). De toestemmingspagina toont dan voor een
  // onbekende toepassing geen knoppen; goedkeuren controleert het opnieuw.
  public query func _caffeineMcpClient(clientId : Text) : async ?{ name : Text; redirectUris : [Text] } {
    if (clientId.size() > 128) return null;
    let c = OAuth.client(bots.oauth, clientId) ?? return null;
    ?{ name = OaRead.txt(c.name, 100); redirectUris = c.redirectUris.filter(func(u : Text) : Bool = Bots.redirectOk(settings, u)) };
  };

  // De toegelaten toepassingen (hosts of schema's). Een lege lijst zet de standaard terug.
  public shared ({ caller }) func setMcpRedirectHosts(hosts : [Text]) : async Result.Result<(), Text> {
    let p = requireBotAdmin(caller);
    if (hosts.size() > Config.botMaxRedirectHosts) { return #err("Hoogstens " # Config.botMaxRedirectHosts.toText() # " toepassingen") };
    let out = List.empty<Text>();
    for (h in hosts.values()) {
      if (h.size() > 200) { return #err("Ongeldig adres") };
      let c = Bots.cleanRedirectHost(h) ?? return #err("Ongeldig adres: geef enkel de host (bv. claude.ai), zonder https:// en zonder pad");
      if (not out.values().any(func(x : Text) : Bool = x == c)) out.add(c);
    };
    if (out.size() == 0) settings.values.remove("mcp.terugkeer") else settings.values.add("mcp.terugkeer", out.values().join(","));
    Access.audit(audit, caller, ?p.id, null, "mcp-toepassingen", if (out.size() == 0) "standaard" else out.values().join(", "));
    #ok;
  };

  // Enkel een gekoppelde, actieve bot keurt een koppeling goed; elke tool-oproep loopt later als die bot.
  public shared ({ caller }) func _caffeineMcpApprove(request : OAuth.Approval) : async { #ok : Text; #err : Text } {
    let b = switch (Bots.activeBot(bots, caller)) { case (?x) x; case null return #err("Geen toegang: enkel een gekoppelde bot kan een koppeling goedkeuren. Log in met de Internet Identity van de bot en geef eerst de koppelcode in.") };
    // 3.12 (review M1): enkel terug naar een toegelaten toepassing (anders gaat de code naar wie de koppelvraag opstelde).
    if (request.clientId.size() > 128 or request.redirectUri.size() > 512 or request.codeChallenge.size() > 128 or request.codeChallengeMethod.size() > 16) { return #err("Ongeldige koppelvraag") };
    if (not Bots.redirectOk(settings, request.redirectUri)) {
      Access.audit(audit, caller, null, null, "bot-koppeling-geweigerd", "bot #" # b.id.toText() # " → " # OaRead.txt(Bots.redirectLabel(request.redirectUri), 120));
      return #err("Deze toepassing keert terug naar " # OaRead.txt(Bots.redirectLabel(request.redirectUri), 120) # ". Dat adres staat niet bij de toegelaten toepassingen (Beheer → Bots → Koppeling).");
    };
    let r = await* OAuth.approve(bots.oauth, caller, request, Time.now());
    // Review 3.13 L2 (R33): intussen ingetrokken → de koppeling meteen weer weg.
    if (Bots.activeBot(bots, caller) == null) {
      for (c in OAuth.connections(bots.oauth, caller).values()) OAuth.revoke(bots.oauth, caller, c.id);
      return #err("Geen toegang: deze bot is intussen ingetrokken");
    };
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
    // 3.12 (review H1): een code is 23 tekens; een lange tekst wordt nooit doorlopen (elke identiteit kan deze functie aanroepen).
    if (code.size() > 64) { return #err("Deze koppelcode klopt niet, is verlopen of is al gebruikt") };
    if (access.links.containsKey(caller)) { return #err("Deze Internet Identity hoort bij een persoon. Gebruik een aparte identiteit voor de bot.") };
    if (robot.robots.containsKey(caller)) { return #err("Geen toegang") };
    if (bots.byPrincipal.containsKey(caller)) { return #err("Deze Internet Identity hoort al bij een bot") };
    // Review 3.13 M3: dezelfde pogingenteller en globale remming als redeemCode (geen onbegrensde auditregels per misser).
    switch (Access.blockedUntil(access, caller)) {
      case (?until) { return #err("Te veel pogingen; probeer opnieuw na " # until.toText()) };
      case null {};
    };
    let fail = func() : Result.Result<BotViews.MyBot, Text> {
      if (Access.countFailure(access, caller)) {
        Access.notifyAdmins(access, audit, ctr, "remming", "Veel foute codes in het afgelopen uur (" # Access.failuresThisHour(access).toText() # "). Bekijk de auditlog.");
      };
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
      redirectHosts = Bots.redirectHosts(settings);
      redirectDefault = Config.botRedirectHosts();
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
      effective = Config.botTasks().map<(Text, { #auto; #proposal }), (Text, Types.BotLevel)>(func((k, _)) = (k, Bots.effectiveLevel(botEnv(), b, k)));
      instruction = Bots.instructionOf(b);
      proof = Proof.tasks().map<Proof.TaskDef, BotViews.BotProofView>(func d {
        let last = Proof.latestClosed(proof, #bot(b.id), d.key);
        let open = switch (Proof.openRoundOf(proof, #bot(b.id))) { case (?r) if (r.task == d.key) ?r.id else null; case null null };
        switch last {
          case (?r) {
            let same = Proof.sameLabels(r, b.vendor, b.model, Bots.instructionOf(b)) and Proof.scopeOk(r, { allWorks = b.allWorks; works = b.works; kinds = b.docKinds });
            { task = d.key; roundId = ?r.id; right = r.right; counted = r.counted; passed = Proof.passed(r); sameLabels = same; autoAllowed = same and Proof.passed(r); openRound = open };
          };
          case null ({ task = d.key; roundId = null; right = 0; counted = 0; passed = false; sameLabels = false; autoAllowed = false; openRound = open });
        };
      });
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
    switch (i.instruction) { case (?x) { if (x.size() > Config.maxProofLabel) return #err("Instructieversie: hoogstens " # Config.maxProofLabel.toText() # " tekens") }; case null {} };
    for ((k, l) in i.tasks.values()) {
      if (Config.botNeverTasks().any(func n = n == k)) { return #err("Deze taak staat vast op Nooit") };
      let cap = switch (Config.botTasks().find(func((x, _) : (Text, { #auto; #proposal })) : Bool = x == k)) { case (?(_, c)) c; case null return #err("Onbekende taak: " # k) };
      if (l == #auto and cap != #auto) { return #err("De taak " # k # " kan hoogstens Voorstel zijn (ze raakt geld of afspraken)") };
    };
    // 3.5: Zelf doen pas na een geslaagde LAATSTE proefronde met dezelfde leverancier, hetzelfde model en dezelfde instructieversie.
    let instructionNew = switch (i.instruction) {
      case (?x) Access.cleanText(x, Config.maxProofLabel) ?? "";
      case null switch (i.id) { case (?id) switch (bots.bots.get(id)) { case (?b) Bots.instructionOf(b); case null "" }; case null "" };
    };
    for ((k, l) in i.tasks.values()) {
      if (l == #auto) {
        let id = switch (i.id) { case (?x) x; case null return #err("Zelf doen kan pas na een geslaagde proefronde: bewaar de bot eerst op Voorstel") };
        switch (Proof.gate(proof, #bot(id), k, vendor, model, instructionNew, ?{ allWorks = i.allWorks; works = i.works; kinds = i.docKinds })) { case (#err(m)) return #err(m); case (#ok) {} };
      };
    };
    let withInstr = func(x : Types.Extra) : Types.Extra {
      x.filter(func((a, _) : (Text, Text)) : Bool = a != "instructie").concat(if (instructionNew == "") [] else [("instructie", instructionNew)]);
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
          extra = withInstr([]);
        });
        Access.audit(audit, caller, ?p.id, null, "bot-gemaakt", "bot #" # id.toText() # " " # name);
        #ok(id);
      };
      case (?id) {
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        if (b.revokedAt != null) { return #err("Deze bot is ingetrokken") };
        if (b.rev != i.rev) { return #err("Intussen gewijzigd: herlaad de fiche") };
        bots.bots.add(id, { b with name; vendor; model; tools = i.tools; allWorks = i.allWorks; works = i.works; docKinds = i.docKinds; callsPerDay = i.callsPerDay; tasks = i.tasks; rev = b.rev + 1; updatedAt = now; updatedBy = p.id; extra = withInstr(b.extra) });
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
    // 3.12 (review M3): ook een goedgekeurde maar nog niet ingewisselde code van deze identiteit vervalt.
    switch (b.principal) {
      case (?pr) {
        let pending = List.empty<Text>();
        for ((h, c) in bots.oauth.codes.entries()) { if (c.user == pr) pending.add(h) };
        for (h in pending.values()) bots.oauth.codes.remove(h);
      };
      case null {};
    };
    switch (b.codeHash) { case (?h) bots.byCode.remove(h); case null {} };
    let now = Time.now();
    bots.bots.add(botId, { b with revokedAt = ?now; revokedBy = ?p.id; codeHash = null; codeExpiresAt = 0; rev = b.rev + 1; updatedAt = now; updatedBy = p.id });
    // 3.5: een open proefronde van deze bot stopt (telt niet mee).
    switch (Proof.openRoundOf(proof, #bot(botId))) { case (?r) Proof.close(Bots.proofEnv(botEnv()), r, ?p.id, now, true); case null {} };
    // 3.12 (review M3): zijn open opdrachten sluiten en zijn onbesliste voorstellen weigeren (een ingetrokken bot is mogelijk gekaapt).
    let closed = Bots.onRevoke(botEnv(), botId, p.id, now);
    Access.audit(audit, caller, ?p.id, null, "bot-ingetrokken", "bot #" # botId.toText() # (if (closed > 0) " (" # closed.toText() # " open opdrachten en voorstellen gesloten)" else ""));
    #ok;
  };

  public query ({ caller }) func botConnections(botId : Nat) : async [BotViews.BotConnectionView] {
    ignore requireBotAdmin(caller);
    let b = bots.bots.get(botId) ?? return [];
    connectionsOf(b).map<OAuth.Connection, BotViews.BotConnectionView>(func c {
      let target = switch (bots.oauth.grants.get(c.id)) {
        case (?g) switch (OAuth.client(bots.oauth, g.clientId)) { case (?cl) cl.redirectUris.values().map(Bots.redirectLabel).join(", "); case null "" };
        case null "";
      };
      { id = c.id; clientName = OaRead.txt(c.clientName, 100); target = OaRead.txt(target, 200); createdAt = c.createdAt; expiresAt = c.expiresAt };
    });
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
    // 3.12 (review M2): ook een offerte die de app zelf registreerde (Zelf doen), is hier met één klik ongedaan te maken (= intrekken).
    let isAutoRead = switch (a.action) { case (#other(x)) x.tool == "voorstel_oa_offerte" and x.data.any(func((k, _) : (Text, Text)) : Bool = k == "oaOfferte"); case _ false };
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
      canUndo = (isDoc and a.docId != null and (a.state == #done or a.state == #accepted)) or (isAutoRead and a.state == #done);
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
    // 3.8: een ingelezen OA-offerte beslist kantoor in het formulier (werf → Offerte → OA-offertes), niet hier.
    switch (a.action) {
      case (#other(x)) {
        if (x.tool == "voorstel_oa_offerte") return #err("Beslis dit voorstel bij de werf: Offerte → OA-offertes → Ingelezen offertes");
        // 3.9 + 3.11: een vergelijking kies je bij de prijsvraag, opmerkingen bij een offerte lees je bij het versturen.
        if (x.tool == "voorstel_vergelijking") return #err("Bekijk dit voorstel bij de prijsvraag: Offerte → OA-offertes → Vergelijken");
        if (x.tool == "opmerkingen_offerte") return #err("Bekijk deze opmerkingen bij de offerte (Versturen)");
      };
      // 3.10: een factuurcontrole bij een opdracht volgt de beslissing over de factuur zelf (OA-facturen), niet hier.
      case (#invoiceCheck(_)) { if (a.extra.any(func((k, _) : (Text, Text)) : Bool = k == "controleopdracht")) return #err("Beslis over de factuur zelf: OA-facturen → de factuur (goedkeuren of betwisten)") };
      case _ {};
    };
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
    let undo = switch (a.action) { case (#other(x)) { if (x.tool == "voorstel_oa_offerte") Bots.undoOaRead(botEnv(), a, caller, p.id, Time.now()) else #err("Niets om ongedaan te maken") }; case _ Bots.undoDocLink(botEnv(), a, p.id, Time.now()) };
    switch undo { case (#err(m)) return #err(m); case (#ok) {} };
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
