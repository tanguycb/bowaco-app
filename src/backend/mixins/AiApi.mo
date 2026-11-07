// AI-connector (stap 3.1, ontwerp 3.1 §2.9): AI-taken starten (askAi), de proeftaak, het logboek zonder inhoud, de fiches en
// de catalogus (admin), en de twee robotfuncties van de gateway (reportAiUsage, failAiTicket). AI wijzigt niets: elke uitkomst
// is een voorstel (Proposal, soort "ai:<fiche>") dat een mens beslist met decideProposal en zelf toepast via de gewone API.
//
// R33: persoon en rechten vóór elke await én erna opnieuw; is de persoon intussen afgezet, dan wordt het antwoord weggegooid.
// Testmodus: buiten Config.aiLiveBackends (en de testbouw) belt de caffeine-weg NOOIT echt: een droog voorbeeld, kost 0.
import Array "mo:core/Array";
import Cycles "mo:core/Cycles";
import Iter "mo:core/Iter";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import AiViews "../types/aiviews";
import Access "../lib/Access";
import AiPrompts "../lib/AiPrompts";
import Config "../lib/Config";
import Rights "../lib/Rights";
import Caffeine "../lib/ai/Caffeine";
import Connector "../lib/ai/Connector";
import Gateway "../lib/ai/Gateway";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  robot : Types.RobotState,
  ai : Types.AiState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  isDraft : () -> Bool,
  isAiLive : () -> Bool,
) {

  func aiEnv() : Connector.Env { { settings; access; robot; ai; audit; ctr } };

  // Belt deze canister nu echt? Enkel een livecanister (of de testbouw), en niet als de beheerder de testmodus aanzette.
  func aiReal() : Bool { isAiLive() and settings.values.get("ai.testmodus") != ?"aan" };

  // De taak zelf vraagt haar eigen rechten bovenop #useAi (AiPrompts.requires), en de werf moet zichtbaar zijn.
  func aiTaskOk(p : Types.Person, key : Text, workId : ?Nat) : ?Text {
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #useAi, null)) return ?"Geen toegang";
    switch workId { case (?w) { if (not Rights.may(ctx, p, #readWork, ?w)) return ?"Geen toegang" }; case null {} };
    for ((a, onWork) in AiPrompts.requires(key).values()) {
      if (onWork and workId == null) return ?"Kies eerst een werf voor deze AI-taak";
      if (not Rights.may(ctx, p, a, if onWork workId else null)) return ?"Geen toegang";
    };
    null;
  };

  func aiStillOk(caller : Principal, key : Text, workId : ?Nat) : Bool {
    switch (Access.activePerson(access, caller)) { case (?q) aiTaskOk(q, key, workId) == null; case null false };
  };

  // De robot van de gateway: een robotprincipal met de soort "ai" (R28: een robot krijgt nooit meer dan nodig).
  func aiRobot(caller : Principal) : Bool {
    switch (robot.robots.get(caller)) { case (?r) r.revokedAt == null and r.kinds.any(func k = k == "ai"); case null false };
  };

  func aiGateway(caller : Principal, p : Types.Person, w : Types.AiWorker, workId : ?Nat, model : Text, inputSha : Text, inputBytes : Nat, fellBack : Bool) : async* Result.Result<AiViews.AiAnswer, Text> {
    let url = Connector.gatewayUrl(settings) ?? return #err("De gateway is nog niet ingesteld (AI, instelling ai.gatewayUrl)");
    if (not Gateway.validModel(model)) return #err("Het model van de gateway is ongeldig: kies <leverancier>/<model>");
    let e = aiEnv();
    let now = Time.now();
    let reserve = switch (Connector.reserve(e, w, caller, ?p.id, workId, now)) { case (#ok r) r; case (#err t) return #err(t) };
    let c = Connector.newCall(e, w, #gateway, #user(p.id), ?p.id, workId, model, inputSha, inputBytes, reserve, fellBack, now);
    Access.audit(audit, caller, ?p.id, workId, if fellBack "ai-terugval" else "ai-oproep", w.key # " #" # c.id.toText() # " gateway " # model);
    let entropy = await Random.blob();
    if (not aiStillOk(caller, w.key, workId)) {
      Connector.end(c, #dropped, Time.now());
      Connector.settle(e, c, 0, Time.now());
      return #err("Geen toegang meer");
    };
    let t = Gateway.ticket(robot, ctr, p.id, w.key, workId, c.id, reserve, entropy, Time.now());
    ignore Connector.withTicket(e, c, t.ticketId);
    #ok(#ticket({ callId = c.id; ticketId = t.ticketId; ticket = t.ticket; expiresAt = t.expiresAt; gatewayUrl = url }));
  };

  func aiRun<system>(caller : Principal, p : Types.Person, key : Text, workId : ?Nat, text : Text, refs : [Text], forceRoute : ?Types.AiRoute) : async* Result.Result<AiViews.AiAnswer, Text> {
    let w = ai.workers.get(key) ?? return #err("Deze AI-medewerker is nog niet ingericht (AI, fiches)");
    if (not w.enabled or w.budgetMonthCents == 0) return #err(w.name # " staat uit");
    if (w.autonomy != #proposal) return #err("Enkel voorstellen zijn toegelaten");
    let v = AiPrompts.version(w.key, w.instructionVersion) ?? return #err("Onbekende instructieversie voor " # w.name);
    var route = w.route;
    var model = w.modelAlias;
    var forced = false;
    switch forceRoute {
      case (?r) {
        if (r != w.route) {
          let fm = w.fallbackModel ?? return #err("Terugval staat uit voor " # w.name);
          if (not w.fallback) return #err("Terugval staat uit voor " # w.name);
          route := r;
          model := fm;
          forced := true;
        };
      };
      case null {};
    };
    let userText = AiPrompts.user(text, refs);
    let inputSha = Connector.sha(userText);
    let inputBytes = userText.size();
    if (route == #gateway) return await* aiGateway(caller, p, w, workId, model, inputSha, inputBytes, forced);
    // ── caffeine-weg ──
    if (ai.runningByPerson.containsKey(p.id)) return #err("Je hebt al een AI-oproep lopen; wacht even");
    if (ai.runningByPerson.size() >= Config.aiMaxConcurrent) return #err("AI is bezig, probeer zo meteen");
    let e = aiEnv();
    let live = aiReal();
    let now = Time.now();
    let reserve = switch (Connector.reserve(e, w, caller, ?p.id, workId, now)) { case (#ok r) r; case (#err t) return #err(t) };
    let c = Connector.newCall(e, w, #caffeine, #user(p.id), ?p.id, workId, model, inputSha, inputBytes, reserve, forced, now);
    Access.audit(audit, caller, ?p.id, workId, if forced "ai-terugval" else "ai-oproep", w.key # " #" # c.id.toText() # " caffeine " # model # (if live "" else " (testmodus)"));
    if (not live) {
      let pid = Connector.dryRun(e, c, v, caller);
      return #ok(#proposal({ callId = c.id; proposalId = pid }));
    };
    let r = if (not ai.models.containsKey(model)) {
      Connector.finish(e, c, v, #modelUnknown(model), true, caller);
    } else {
      ai.runningByPerson.add(p.id, c.id);
      var out = await* Caffeine.chat<system>(model, v, userText);
      switch out { case (#retry _ or #rateLimited _) { out := await* Caffeine.chat<system>(model, v, userText) }; case _ {} };
      if (ai.runningByPerson.get(p.id) == ?c.id) ai.runningByPerson.remove(p.id);
      Connector.finish(e, c, v, out, aiStillOk(caller, w.key, workId), caller);
    };
    switch r {
      case (#proposal pid) #ok(#proposal({ callId = c.id; proposalId = pid }));
      case (#failed t) #err(t);
      case (#fallback why) {
        // §2.6: terugval caffeine → gateway enkel bij #retry, #rateLimited (na de ene herhaling) en "model onbekend".
        switch (w.fallbackModel) {
          case (?fm) {
            if (w.fallback and not forced and w.route == #caffeine and aiStillOk(caller, w.key, workId)) {
              return await* aiGateway(caller, p, w, workId, fm, inputSha, inputBytes, true);
            };
          };
          case null {};
        };
        #err("De AI-dienst is nu niet beschikbaar (" # why # "); probeer later opnieuw");
      };
    };
  };

  // ── Een AI-taak starten ──────────────────────────────────────────────────
  public shared ({ caller }) func askAi(worker : Text, workId : ?Nat, input : AiViews.AiInput) : async Result.Result<AiViews.AiAnswer, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #useAi, null);
    if (not Connector.knownKey(worker)) return #err("Onbekende AI-medewerker");
    switch (aiTaskOk(p, worker, workId)) { case (?t) return #err(t); case null {} };
    if (input.text.size() == 0) return #err("Geef de tekst voor de AI-taak");
    if (input.refs.size() > Config.aiMaxRefs) return #err("Te veel verwijzingen");
    var bytes = input.text.size();
    for (r in input.refs.values()) {
      if (r.size() == 0 or r.size() > 60 or r.contains(#text "://") or r.contains(#text "!caf!")) return #err("Ongeldige verwijzing");
      bytes += r.size();
    };
    if (bytes > Config.aiMaxInputBytes) return #err("De invoer is te groot voor deze AI-taak");
    await* aiRun<system>(caller, p, worker, workId, input.text, input.refs, input.forceRoute);
  };

  // De proeftaak (admin): een vaste verzonnen tekst door de echte weg van de fiche; bewijst de weg, de sleutel, de cycles en het
  // logboek zonder echte gegevens. Antwoord = het oproepnummer (het voorstel staat in de oproep).
  public shared ({ caller }) func aiTestCall(worker : Text) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAi, null);
    let w = ai.workers.get(worker) ?? return #err("Deze AI-medewerker is nog niet ingericht");
    if (w.route != #caffeine) return #err("De proeftaak van de gateway-weg loopt via het scherm (ticket naar de gateway)");
    switch (await* aiRun<system>(caller, p, worker, null, AiPrompts.testText, [], null)) {
      case (#ok(#proposal x)) #ok(x.callId);
      case (#ok(#ticket x)) #ok(x.callId);
      case (#err t) #err(t);
    };
  };

  // ── Lezen ────────────────────────────────────────────────────────────────
  public query ({ caller }) func aiCall(id : Nat) : async ?AiViews.AiCallView {
    let p = Access.requireActive(access, caller);
    let c = ai.log.get(id) ?? return null;
    let full = Rights.may({ works; settings }, p, #readAiLog, null);
    if (not full and c.personId != ?p.id) return null;
    ?Connector.callView(c, full);
  };

  public query ({ caller }) func myAiCalls() : async [AiViews.AiCallView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #useAi, null);
    let full = Rights.may({ works; settings }, p, #readAiLog, null);
    ai.log.reverseEntries().filter(func((_, c) : (Nat, Types.AiCall)) : Bool = c.personId == ?p.id).take(100).map(func((_, c) : (Nat, Types.AiCall)) : AiViews.AiCallView = Connector.callView(c, full)).toArray();
  };

  public query ({ caller }) func aiLog(from : Nat, n : Nat) : async [AiViews.AiCallView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readAiLog, null);
    ai.log.reverseEntries().drop(from).take(Nat.min(n, Config.maxListPage)).map(func((_, c) : (Nat, Types.AiCall)) : AiViews.AiCallView = Connector.callView(c, true)).toArray();
  };

  public query ({ caller }) func listAiWorkers() : async [AiViews.AiWorkerView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #useAi, null);
    let manage = Rights.may(ctx, p, #manageAi, null);
    let m = Connector.month(Time.now());
    Config.aiWorkerKeys().map(func(k : Text) : AiViews.AiWorkerView {
      let w = ai.workers.get(k) ?? Connector.defaultWorker(k);
      {
        key = w.key; name = w.name; route = w.route; modelAlias = w.modelAlias; fallback = w.fallback; fallbackModel = w.fallbackModel;
        clientData = w.clientData; autonomy = w.autonomy; instructionVersion = w.instructionVersion; versions = AiPrompts.versionNumbers(k);
        enabled = w.enabled; configured = ai.workers.containsKey(k); rev = w.rev; updatedAt = w.updatedAt;
        budget = if manage ?{ budgetMonthCents = w.budgetMonthCents; maxCallCents = w.maxCallCents; spentCents = Connector.spentOf(ai, k, m); reservedCents = Connector.reservedOf(ai, k, m); month = m } else null;
      };
    });
  };

  public query ({ caller }) func aiOverview() : async AiViews.AiOverview {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAi, null);
    let m = Connector.month(Time.now());
    let calls = Map.empty<Text, (Nat, Nat, ?Int)>();
    label scan for ((_, c) in ai.log.reverseEntries().take(5_000)) {
      if (Connector.month(c.startedAt) != m) break scan;
      let (n, errs, last) = calls.get(c.workerKey) ?? (0, 0, null);
      let bad = switch (c.state) { case (#failed _ or #invalid _ or #unsure _ or #refused) 1; case _ 0 };
      calls.add(c.workerKey, (n + 1, errs + bad, switch last { case null ?c.startedAt; case x x }));
    };
    var seen : ?Int = null;
    for (x in ai.models.values()) { seen := switch seen { case (?s) ?Int.max(s, x.seenAt); case null ?x.seenAt } };
    {
      month = m;
      workers = Config.aiWorkerKeys().map(func(k : Text) : AiViews.AiWorkerStats {
        let w = ai.workers.get(k) ?? Connector.defaultWorker(k);
        let (n, errs, last) = calls.get(k) ?? (0, 0, null);
        { key = k; name = w.name; enabled = w.enabled; route = w.route; budgetMonthCents = w.budgetMonthCents; spentCents = Connector.spentOf(ai, k, m); reservedCents = Connector.reservedOf(ai, k, m); lastCallAt = last; calls = n; errors = errs };
      });
      cyclesBalance = Cycles.balance();
      cyclesFloor = Config.aiCyclesFloor;
      models = ai.models.values().toArray();
      modelsSeenAt = seen;
      live = aiReal();
      draft = isDraft();
      running = ai.runningByPerson.size();
      usdEurMilli = Connector.usdEurMilli(settings);
      gatewayUrl = Connector.gatewayUrl(settings);
    };
  };

  // ── Beheer (admin) ───────────────────────────────────────────────────────
  public shared ({ caller }) func saveAiWorker(x : AiViews.AiWorkerInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAi, null);
    if (not Connector.knownKey(x.key)) return #err("Onbekende AI-medewerker");
    let name = x.name.trim(#char ' ');
    if (name.size() == 0 or name.size() > Config.maxName) return #err("Geef een naam (hoogstens " # Config.maxName.toText() # " tekens)");
    if (x.autonomy != #proposal) return #err("Enkel voorstellen zijn toegelaten (autonomie: voorstel)");
    if (AiPrompts.version(x.key, x.instructionVersion) == null) return #err("Onbekende instructieversie");
    if (x.budgetMonthCents > Config.aiMaxBudgetCents) return #err("Maandbudget te hoog");
    if (x.maxCallCents > x.budgetMonthCents) return #err("Het plafond per oproep is hoger dan het maandbudget");
    if (x.enabled and x.maxCallCents < Config.aiMinReserveCents) return #err("Het plafond per oproep moet minstens " # Config.aiMinReserveCents.toText() # " cent zijn");
    let okModel = func(route : Types.AiRoute, m : Text) : Bool {
      if (m.size() == 0 or m.size() > 80) return false;
      switch route { case (#caffeine) m == "auto" or ai.models.containsKey(m); case (#gateway) Gateway.validModel(m) };
    };
    if (not okModel(x.route, x.modelAlias)) return #err(if (x.route == #caffeine) "Kies een model uit de catalogus (of auto)" else "Kies een model van de gateway: <leverancier>/<model>");
    let other : Types.AiRoute = if (x.route == #caffeine) #gateway else #caffeine;
    switch (x.fallbackModel) {
      case (?fm) {
        if (fm == "auto") return #err("Het terugvalmodel moet expliciet zijn (niet auto)");
        if (not okModel(other, fm)) return #err("Het terugvalmodel past niet bij de andere weg");
      };
      case null { if (x.fallback) return #err("Kies een terugvalmodel of zet de terugval uit") };
    };
    let cur = ai.workers.get(x.key);
    let rev = switch cur { case (?w) w.rev; case null 0 };
    if (x.rev != rev) return #err("Iemand anders wijzigde deze fiche intussen; laad opnieuw");
    let w : Types.AiWorker = {
      key = x.key; name; route = x.route; modelAlias = x.modelAlias; fallback = x.fallback; fallbackModel = x.fallbackModel;
      budgetMonthCents = x.budgetMonthCents; maxCallCents = x.maxCallCents; clientData = x.clientData; autonomy = #proposal;
      instructionVersion = x.instructionVersion; enabled = x.enabled; rev = rev + 1; updatedAt = Time.now(); updatedBy = p.id;
      extra = switch cur { case (?c) c.extra; case null [] };
    };
    ai.workers.add(x.key, w);
    Access.audit(audit, caller, ?p.id, null, "ai-fiche-gewijzigd", x.key # " rev " # w.rev.toText() # (if (x.enabled) " aan" else " uit") # " " # (if (x.route == #caffeine) "caffeine " else "gateway ") # x.modelAlias # " budget " # x.budgetMonthCents.toText() # " cent");
    #ok;
  };

  // De instellingen van de AI (settings.values, geen migratie): het adres van de gateway (enkel https://), de koers USD→EUR in
  // milli (920 = 0,920) en de testmodus (aan = ook een livecanister antwoordt droog; op een draft staat ze altijd aan).
  public shared ({ caller }) func setAiSettings(gatewayUrl : ?Text, usdEurMilli : ?Nat, testMode : ?Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAi, null);
    switch gatewayUrl {
      case (?u) {
        if (u == "") settings.values.remove("ai.gatewayUrl") else {
          if (not u.startsWith(#text "https://") or u.size() > Config.maxUrl) return #err("Het adres van de gateway moet met https:// beginnen");
          for (c in u.chars()) { if (c == ' ' or c == '\"' or c == '\'' or c == '<' or c == '>' or c == '\\') return #err("Ongeldig adres") };
          settings.values.add("ai.gatewayUrl", u);
        };
      };
      case null {};
    };
    switch usdEurMilli {
      case (?n) { if (n < 100 or n > 10_000) return #err("Koers tussen 0,100 en 10,000"); settings.values.add("ai.usdEurMilli", n.toText()) };
      case null {};
    };
    switch testMode { case (?true) settings.values.add("ai.testmodus", "aan"); case (?false) settings.values.remove("ai.testmodus"); case null {} };
    Access.audit(audit, caller, ?p.id, null, "ai-instellingen", (switch gatewayUrl { case (?_) "gateway "; case null "" }) # (switch usdEurMilli { case (?n) "koers " # n.toText() # " "; case null "" }) # (switch testMode { case (?b) if b "testmodus aan" else "testmodus uit"; case null "" }));
    #ok;
  };

  // De catalogus van Caffeine (één outcall). In de testmodus: enkel "auto" zonder prijs (er vertrekt niets).
  public shared ({ caller }) func refreshAiModels() : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageAi, null);
    if (not aiReal()) {
      if (not ai.models.containsKey("auto")) ai.models.add("auto", { alias = "auto"; promptPer1e10 = 0; completionPer1e10 = 0; cacheReadPer1e10 = 0; cacheWritePer1e10 = 0; seenAt = Time.now() });
      Access.audit(audit, caller, ?p.id, null, "ai-modellen-vernieuwd", "testmodus: enkel auto, niets opgehaald");
      return #ok(ai.models.size());
    };
    let r = await* Connector.refresh<system>(ai, Time.now());
    switch (Access.activePerson(access, caller)) { case null return #err("Geen toegang meer"); case (?_) {} };
    switch r {
      case (#ok n) { Access.audit(audit, caller, ?p.id, null, "ai-modellen-vernieuwd", n.toText() # " modellen"); #ok(n) };
      case (#err t) { Access.audit(audit, caller, ?p.id, null, "ai-modellen-vernieuwd", "mislukt: " # t); #err("Catalogus ophalen mislukt: " # t) };
    };
  };

  // ── Robot "ai" (de gateway) ──────────────────────────────────────────────
  // Kost, tokens en model van een gateway-taak; één keer per ticket, vóór of na submitProposal. Kan enkel kost TOEVOEGEN.
  public shared ({ caller }) func reportAiUsage(ticketId : Nat, u : AiViews.AiUsage) : async Result.Result<(), Text> {
    if (not aiRobot(caller)) return #err("Geen toegang");
    let id = ai.callByTicket.get(ticketId) ?? return #err("Geen AI-oproep voor dit ticket");
    let c = ai.log.get(id) ?? return #err("Geen AI-oproep voor dit ticket");
    let t = robot.tickets.get(ticketId) ?? return #err("Onbekend ticket");
    switch (t.state) { case (#used _) {}; case _ return #err("Ticket eerst controleren") };
    if (c.extra.any(func(x : (Text, Text)) : Bool = x.0 == "gebruik")) return #err("Al gemeld");
    if (u.model.size() > 80 or u.costCents > Config.aiMaxBudgetCents or u.promptTokens > 1_000_000_000 or u.completionTokens > 1_000_000_000 or u.cachedTokens > u.promptTokens or u.durationMs > 3_600_000) return #err("Ongeldige melding");
    switch (u.outputSha256) {
      case (?h) { if (h.size() != 64 or not h.chars().all(func ch = (ch >= '0' and ch <= '9') or (ch >= 'a' and ch <= 'f'))) return #err("Ongeldige hash") };
      case null {};
    };
    let now = Time.now();
    c.promptTokens := u.promptTokens;
    c.completionTokens := u.completionTokens;
    c.cachedTokens := u.cachedTokens;
    if (c.outputSha256 == null) c.outputSha256 := u.outputSha256;
    c.extra := c.extra.concat([("gebruik", Int.toText(now)), ("modelGemeld", Caffeine.scrub(u.model)), ("duurMs", u.durationMs.toText())]);
    Connector.settle(aiEnv(), c, u.costCents, now);
    if (c.proposalId != null and c.state == #running) Connector.end(c, #done, now);
    Access.audit(audit, caller, null, c.workId, "ai-kost", c.workerKey # " #" # c.id.toText() # " " # u.costCents.toText() # " cent");
    #ok;
  };

  // De gateway kon de taak niet doen (geen voorstel): de oproep mislukt, de reservering komt vrij. why = "onzeker" (of begint
  // ermee) wanneer de leverancier misschien gerekend heeft: dan wordt geraamd op de reservering.
  public shared ({ caller }) func failAiTicket(ticketId : Nat, why : Text) : async Result.Result<(), Text> {
    if (not aiRobot(caller)) return #err("Geen toegang");
    let id = ai.callByTicket.get(ticketId) ?? return #err("Geen AI-oproep voor dit ticket");
    let c = ai.log.get(id) ?? return #err("Geen AI-oproep voor dit ticket");
    if (c.state != #running) return #err("Deze AI-oproep is al afgesloten");
    let now = Time.now();
    let w = Caffeine.scrub(why);
    let unsure = why.startsWith(#text "onzeker");
    Connector.end(c, if unsure #unsure(w) else #failed(w), now);
    Connector.settle(aiEnv(), c, if unsure c.reservedCents else 0, now);
    Access.audit(audit, caller, null, c.workId, "ai-mislukt", c.workerKey # " #" # c.id.toText() # " (gateway): " # w);
    #ok;
  };
};
