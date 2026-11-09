// AiConnector (stap 3.1, ontwerp 3.1 §2): één laag voor de twee wegen. De caffeine-weg doet de outcall in de update-call van
// de gebruiker (§2.2.1); de gateway-weg geeft een ticket en de gateway schrijft het voorstel (§2.2.2). Hier: de fiches, het
// budget (reservering vóór de oproep, afrekening erna), het logboek ZONDER inhoud, de afloop van een caffeine-oproep, de
// opruiming (oproepen zonder afloop na 15 min, logboek na 400 dagen) en de views.
//
// Budget (§2.5): per fiche en per (lokale) maand `spent` en `reserved` in eurocent. reserve = min(maxCallCents, budget − spent −
// reserved); minder dan Config.aiMinReserveCents = "maandbudget op". Afrekenen gebeurt precies één keer per oproep (marker
// "afgerekend" in extra): spent += kost, reserved −= reservering. Een onzekere uitkomst wordt geraamd op de reservering.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Sha256 "mo:sha2/Sha256";
import { JSON } "mo:serde-core";
import Types "../../types";
import AiViews "../../types/aiviews";
import Access "../Access";
import AiPrompts "../AiPrompts";
import Codes "../Codes";
import Config "../Config";
import Ids "../Ids";
import Post "../Post";
import Caffeine "Caffeine";

module {
  public type Env = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    robot : Types.RobotState;
    ai : Types.AiState;
    audit : Types.AuditState;
    ctr : Types.Counters;
  };

  // ── Maand en sleutels ───────────────────────────────────────────────────
  func civil(day : Nat) : (Nat, Nat) {
    let z = day + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if (mp < 10) mp + 3 else mp - 9;
    (yoe + era * 400 + (if (m <= 2) 1 else 0), m);
  };
  public func month(now : Int) : Text {
    let (y, m) = civil(Post.local(now).day);
    y.toText() # "-" # (if (m < 10) "0" else "") # m.toText();
  };
  public func bkey(worker : Text, m : Text) : Text { worker # ":" # m };

  public func sha(t : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, t.encodeUtf8())) };

  public func isLive(self : Principal, draft : Bool) : Bool {
    if draft return false;
    let t = self.toText();
    Config.aiLiveAnyCanister or Config.aiLiveBackends().any(func x = x == t);
  };

  public func usdEurMilli(s : Types.SettingsState) : Nat {
    switch (s.values.get("ai.usdEurMilli")) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n >= 100 and n <= 10_000) n else 1_000 }; case null 1_000 } }; case null 1_000 };
  };
  public func gatewayUrl(s : Types.SettingsState) : ?Text {
    let u = s.values.get("ai.gatewayUrl") ?? return null;
    if (not u.startsWith(#text "https://") or u.size() > Config.maxUrl) return null;
    for (c in u.chars()) { if (c == ' ' or c == '\"' or c == '\'' or c == '<' or c == '>' or c == '\\') return null };
    ?u;
  };

  // ── Fiches ──────────────────────────────────────────────────────────────
  public func knownKey(k : Text) : Bool { Config.aiWorkerKeys().any(func x = x == k) };

  // Een sleutel zonder fiche: uit (budget 0), caffeine "auto", geen terugval, geen klantgegevens.
  public func defaultWorker(k : Text) : Types.AiWorker {
    { key = k; name = k; route = #caffeine; modelAlias = "auto"; fallback = false; fallbackModel = null; budgetMonthCents = 0; maxCallCents = 0; clientData = false; autonomy = #proposal; instructionVersion = 1; enabled = false; rev = 0; updatedAt = 0; updatedBy = 0; extra = [] };
  };

  public func spentOf(ai : Types.AiState, k : Text, m : Text) : Nat { ai.spent.get(bkey(k, m)) ?? 0 };
  public func reservedOf(ai : Types.AiState, k : Text, m : Text) : Nat { ai.reserved.get(bkey(k, m)) ?? 0 };

  func dayFlag(s : Types.SettingsState, key : Text, now : Int) : Bool {
    let last = switch (s.values.get(key)) { case (?t) (Int.fromText(t) ?? 0); case null 0 };
    if (now - last <= Config.day) return false;
    s.values.add(key, Int.toText(now));
    true;
  };

  // Reservering vóór de oproep. #err = de tekst voor de gebruiker (en een melding aan de admins, één per fiche per dag).
  public func reserve(e : Env, w : Types.AiWorker, who : Principal, personId : ?Nat, workId : ?Nat, now : Int) : { #ok : Nat; #err : Text } {
    let m = month(now);
    let k = bkey(w.key, m);
    let used = spentOf(e.ai, w.key, m) + reservedOf(e.ai, w.key, m);
    let free = if (w.budgetMonthCents > used) Nat.sub(w.budgetMonthCents, used) else 0;
    let r = Nat.min(w.maxCallCents, free);
    if (r < Config.aiMinReserveCents) {
      Access.audit(e.audit, who, personId, workId, "ai-budget-op", w.key # " " # m);
      if (dayFlag(e.settings, "ai.budgetMelding." # w.key, now)) {
        Access.notifyAdmins(e.access, e.audit, e.ctr, "ai", "Het maandbudget van de AI-medewerker " # w.name # " is op (" # m # "). Verhoog het budget onder AI of wacht tot volgende maand.");
      };
      return #err("Het maandbudget van " # w.name # " is op");
    };
    e.ai.reserved.add(k, reservedOf(e.ai, w.key, m) + r);
    #ok(r);
  };

  public func settled(c : Types.AiCall) : Bool { c.extra.any(func(p : (Text, Text)) : Bool = p.0 == "afgerekend") };

  // Precies één keer per oproep. Kost boven de reservering wordt toch geboekt (gateway: de leverancier rekent achteraf).
  public func settle(e : Env, c : Types.AiCall, cost : Nat, now : Int) {
    if (settled(c)) return;
    let m = month(c.startedAt);
    let k = bkey(c.workerKey, m);
    let res = reservedOf(e.ai, c.workerKey, m);
    let left = if (res > c.reservedCents) Nat.sub(res, c.reservedCents) else 0;
    if (left == 0) e.ai.reserved.remove(k) else e.ai.reserved.add(k, left);
    if (cost > 0) e.ai.spent.add(k, spentOf(e.ai, c.workerKey, m) + cost);
    c.costCents := cost;
    c.extra := c.extra.concat([("afgerekend", Int.toText(now))]).concat(if (cost > c.reservedCents) [("overschrijding", Nat.sub(cost, c.reservedCents).toText())] else []);
    // 80 % van het maandbudget: één melding per fiche per maand.
    switch (e.ai.workers.get(c.workerKey)) {
      case (?w) {
        if (w.budgetMonthCents > 0 and spentOf(e.ai, c.workerKey, m) * 10 >= w.budgetMonthCents * 8 and e.settings.values.get("ai.80." # c.workerKey) != ?m) {
          e.settings.values.add("ai.80." # c.workerKey, m);
          Access.notifyAdmins(e.access, e.audit, e.ctr, "ai", "De AI-medewerker " # w.name # " heeft 80 % van zijn maandbudget gebruikt (" # m # ").");
        };
      };
      case null {};
    };
  };

  public func newCall(e : Env, w : Types.AiWorker, route : Types.AiRoute, origin : Types.AiOrigin, personId : ?Nat, workId : ?Nat, model : Text, inputSha256 : Text, inputBytes : Nat, reserved : Nat, fellBack : Bool, now : Int) : Types.AiCall {
    let id = Ids.next(e.ctr, "aiCall");
    let c : Types.AiCall = {
      id;
      workerKey = w.key;
      route;
      origin;
      personId;
      workId;
      ticketId = null;
      var proposalId = null;
      model;
      instructionVersion = w.instructionVersion;
      inputSha256;
      var outputSha256 = null;
      inputBytes;
      var promptTokens = 0;
      var completionTokens = 0;
      var cachedTokens = 0;
      reservedCents = reserved;
      var costCents = 0;
      var cycles = 0;
      startedAt = now;
      var endedAt = null;
      var state = #running;
      fellBack;
      var extra = [];
    };
    e.ai.log.add(id, c);
    c;
  };

  // Een kopie met het ticket erbij (het veld is niet veranderlijk: de oproep wordt vóór het ticket gemaakt).
  public func withTicket(e : Env, c : Types.AiCall, ticketId : Nat) : Types.AiCall {
    let x : Types.AiCall = {
      id = c.id; workerKey = c.workerKey; route = c.route; origin = c.origin; personId = c.personId; workId = c.workId; ticketId = ?ticketId;
      var proposalId = c.proposalId; model = c.model; instructionVersion = c.instructionVersion; inputSha256 = c.inputSha256;
      var outputSha256 = c.outputSha256; inputBytes = c.inputBytes; var promptTokens = c.promptTokens; var completionTokens = c.completionTokens;
      var cachedTokens = c.cachedTokens; reservedCents = c.reservedCents; var costCents = c.costCents; var cycles = c.cycles; startedAt = c.startedAt;
      var endedAt = c.endedAt; var state = c.state; fellBack = c.fellBack; var extra = c.extra;
    };
    e.ai.log.add(c.id, x);
    e.ai.callByTicket.add(ticketId, c.id);
    x;
  };

  public func end(c : Types.AiCall, s : Types.AiCallState, now : Int) {
    c.state := s;
    c.endedAt := ?now;
  };

  // ── JSON-controle van een antwoord: een object met de verplichte velden ──
  public func validJson(content : Text, required : [Text]) : Bool {
    switch (JSON.toCandid(content)) {
      case (#ok(#Record fields)) required.all(func(k : Text) : Bool = fields.any(func f = f.0 == k));
      case (#ok(#Map fields)) required.all(func(k : Text) : Bool = fields.any(func f = f.0 == k));
      case _ false;
    };
  };

  // ── De afloop van één caffeine-oproep ───────────────────────────────────
  public type Run = { #proposal : Nat; #fallback : Text; #failed : Text };

  func writeProposal(e : Env, c : Types.AiCall, content : Text, now : Int) : Nat {
    let pid = Ids.next(e.ctr, "proposal");
    let x : Types.Proposal = { id = pid; ticketId = null; jobId = switch (c.origin) { case (#job j) ?j; case _ null }; personId = c.personId; workId = c.workId; kind = "ai:" # c.workerKey; content; by = Principal.fromText(Config.appSender); at = now; var decision = null };
    e.robot.proposals.add(pid, x);
    e.ai.callByProposal.add(pid, c.id);
    c.proposalId := ?pid;
    c.outputSha256 := ?sha(content);
    pid;
  };

  // Testmodus (draft, testbouw zonder live, elke canister buiten Config.aiLiveBackends): nooit een outcall, een vast
  // voorbeeld als voorstel, kost 0.
  public func dryRun(e : Env, c : Types.AiCall, v : AiPrompts.Version, who : Principal) : Nat {
    let now = Time.now();
    let pid = writeProposal(e, c, v.dryRun, now);
    end(c, #dryRun, now);
    settle(e, c, 0, now);
    Access.audit(e.audit, who, c.personId, c.workId, "ai-voorstel", c.workerKey # " #" # c.id.toText() # " (testmodus, droog)");
    pid;
  };

  func costOf(e : Env, c : Types.AiCall, u : ?Caffeine.Usage) : Nat {
    switch u {
      case (?x) {
        c.promptTokens := x.promptTokens;
        c.completionTokens := x.completionTokens;
        c.cachedTokens := x.cachedTokens;
        switch (e.ai.models.get(c.model)) {
          case (?m) Caffeine.costCents(x, m.promptPer1e10, m.completionPer1e10, m.cacheReadPer1e10, usdEurMilli(e.settings));
          case null c.reservedCents; // geen prijs gekend: geraamd op de reservering
        };
      };
      case null c.reservedCents;
    };
  };

  // Na de outcall: `allowed` = R33 (de persoon is nog actief en mag nog; anders wordt het antwoord weggegooid).
  public func finish(e : Env, c : Types.AiCall, v : AiPrompts.Version, out : Caffeine.Outcome, allowed : Bool, who : Principal) : Run {
    let now = Time.now();
    let tag = c.workerKey # " #" # c.id.toText();
    switch out {
      case (#ok r) {
        c.cycles := r.cycles;
        let cost = costOf(e, c, r.usage);
        if (not allowed) {
          end(c, #dropped, now);
          settle(e, c, cost, now);
          Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": weggegooid (geen toegang meer)");
          return #failed("Geen toegang meer");
        };
        if (r.content.size() > Config.maxProposalBytes or not validJson(r.content, v.required)) {
          end(c, #invalid(if (r.content.size() > Config.maxProposalBytes) "antwoord te groot" else "antwoord past niet in het schema"), now);
          c.outputSha256 := ?sha(r.content);
          settle(e, c, cost, now);
          Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": ongeldig antwoord");
          return #failed("De AI gaf een ongeldig antwoord; probeer het opnieuw of pas de invoer aan");
        };
        let pid = writeProposal(e, c, r.content, now);
        end(c, #done, now);
        settle(e, c, cost, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-voorstel", tag # " voorstel #" # pid.toText() # " (" # cost.toText() # " cent)");
        #proposal(pid);
      };
      case (#refused r) {
        c.cycles := r.cycles;
        let cost = costOf(e, c, r.usage);
        end(c, #refused, now);
        settle(e, c, cost, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": geweigerd door het model");
        #failed("Het model weigerde deze taak");
      };
      case (#invalid x) {
        end(c, #invalid(x.why), now);
        settle(e, c, if (x.charged) c.reservedCents else 0, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": " # x.why);
        #failed("De AI-dienst weigerde de vraag: " # x.why);
      };
      case (#unsure why) {
        end(c, #unsure(why), now);
        settle(e, c, c.reservedCents, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": onzeker: " # why);
        Access.notifyAdmins(e.access, e.audit, e.ctr, "ai", "AI-oproep #" # c.id.toText() # " (" # c.workerKey # ") zonder zeker antwoord: misschien aangerekend. Nooit vanzelf opnieuw.");
        #failed("Geen zeker antwoord van de AI-dienst; probeer later opnieuw");
      };
      case (#noFunds why) {
        end(c, #failed("geen tegoed: " # why), now);
        settle(e, c, 0, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": " # why);
        if (dayFlag(e.settings, "ai.cyclesMelding", now)) Access.notifyAdmins(e.access, e.audit, e.ctr, "ai", "AI-oproepen lukken niet: " # why # ".");
        #failed("De AI-dienst is nu niet beschikbaar (tegoed); de beheerder kreeg een melding");
      };
      case (#retry why or #rateLimited why) {
        end(c, #failed(why), now);
        settle(e, c, 0, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": " # why);
        #fallback(why);
      };
      case (#modelUnknown why) {
        end(c, #failed("model onbekend: " # why), now);
        settle(e, c, 0, now);
        Access.audit(e.audit, who, c.personId, c.workId, "ai-mislukt", tag # ": model onbekend");
        #fallback("model onbekend");
      };
    };
  };

  // 3.5: de afloop van een proefoproep (proefbank op de Caffeine AI-weg). Zoals finish, maar ZONDER voorstel: de inhoud gaat enkel
  // terug naar de proefbank (die er een antwoord van maakt en vergelijkt). Afrekenen en het logboek zonder inhoud blijven gelijk.
  public func finishProof(e : Env, c : Types.AiCall, v : AiPrompts.Version, out : Caffeine.Outcome, allowed : Bool, who : Principal) : { #ok : Text; #err : Text } {
    let now = Time.now();
    let tag = c.workerKey # " #" # c.id.toText() # " (proefbank)";
    switch out {
      case (#ok r) {
        c.cycles := r.cycles;
        let cost = costOf(e, c, r.usage);
        c.outputSha256 := ?sha(r.content);
        if (not allowed) { end(c, #dropped, now); settle(e, c, cost, now); return #err("Geen toegang meer") };
        if (r.content.size() > Config.maxProposalBytes or not validJson(r.content, v.required)) {
          end(c, #invalid("antwoord past niet in het schema"), now);
          settle(e, c, cost, now);
          Access.audit(e.audit, who, c.personId, null, "ai-mislukt", tag # ": ongeldig antwoord");
          return #ok(""); // telt als fout antwoord (geen geldige velden)
        };
        end(c, #done, now);
        settle(e, c, cost, now);
        #ok(r.content);
      };
      case (#refused r) { c.cycles := r.cycles; end(c, #refused, now); settle(e, c, costOf(e, c, r.usage), now); #ok("") };
      case (#invalid x) { end(c, #invalid(x.why), now); settle(e, c, if (x.charged) c.reservedCents else 0, now); #err("De AI-dienst weigerde de vraag: " # x.why) };
      case (#unsure why) { end(c, #unsure(why), now); settle(e, c, c.reservedCents, now); #err("Geen zeker antwoord van de AI-dienst; probeer later opnieuw") };
      case (#noFunds why) { end(c, #failed("geen tegoed: " # why), now); settle(e, c, 0, now); #err("De AI-dienst is nu niet beschikbaar (tegoed)") };
      case (#retry why or #rateLimited why) { end(c, #failed(why), now); settle(e, c, 0, now); #err("De AI-dienst is nu niet beschikbaar; probeer later opnieuw") };
      case (#modelUnknown _) { end(c, #failed("model onbekend"), now); settle(e, c, 0, now); #err("Het model van de fiche is onbekend bij Caffeine") };
    };
  };

  // ── De catalogus (§2.3): één outcall; de vorige blijft staan als het ophalen mislukt ──
  public func refresh<system>(ai : Types.AiState, now : Int) : async* { #ok : Nat; #err : Text } {
    switch (await* Caffeine.models<system>()) {
      case (#err t) #err(t);
      case (#ok xs) {
        let fresh = Map.empty<Text, Types.AiModel>();
        for (x in xs.values()) {
          if (fresh.size() < Config.aiMaxModels and x.alias.size() > 0 and x.alias.size() <= 80) {
            switch (Caffeine.per1e10(x.prompt), Caffeine.per1e10(x.completion), Caffeine.per1e10(x.cacheRead), Caffeine.per1e10(x.cacheWrite)) {
              case (?a, ?b, ?c, ?d) fresh.add(x.alias, { alias = x.alias; promptPer1e10 = a; completionPer1e10 = b; cacheReadPer1e10 = c; cacheWritePer1e10 = d; seenAt = now });
              case _ {}; // een prijs die geen gewone decimale tekst is: dat model niet (anders zou de kost 0 lijken)
            };
          };
        };
        if (fresh.size() == 0) return #err("lege of onleesbare catalogus");
        for (k in ai.models.keys().toArray().values()) { if (not fresh.containsKey(k)) ai.models.remove(k) };
        for ((k, v) in fresh.entries()) ai.models.add(k, v);
        #ok(fresh.size());
      };
    };
  };

  public func modelsOld(ai : Types.AiState, now : Int) : Bool {
    var last : Int = 0;
    for (m in ai.models.values()) { if (m.seenAt > last) last := m.seenAt };
    now - last >= Config.aiModelsEvery;
  };

  // ── Opruiming (Housekeeping.tick, elke 10 min) ─────────────────────────
  // Een oproep zonder afrekening na 15 min: caffeine (trap na de await) of gateway zonder afloop → onzeker, geraamd op de
  // reservering; een gateway-ticket dat nooit gebruikt werd → mislukt, kost 0; een voorstel zonder gemelde kost → afgerekend
  // op de reservering. Nooit automatisch opnieuw.
  public func idle(e : Env, now : Int) : Nat {
    var n = 0;
    let open = List.empty<Types.AiCall>();
    label scan for ((_, c) in e.ai.log.reverseEntries()) {
      if (c.startedAt < now - 2 * Config.day or open.size() >= 200) break scan;
      if (not settled(c) and now - c.startedAt > Config.aiRunningIdle) open.add(c);
    };
    for (c in open.values()) {
      let unused = switch (c.ticketId) {
        case (?t) { switch (e.robot.tickets.get(t)) { case (?tk) { switch (tk.state) { case (#used _) false; case _ true } }; case null true } };
        case null false;
      };
      switch (c.state) {
        case (#running) {
          if unused { end(c, #failed("ticket niet gebruikt"), now); settle(e, c, 0, now) } else {
            end(c, #unsure("geen afloop binnen 15 min"), now);
            settle(e, c, c.reservedCents, now);
          };
        };
        case _ { settle(e, c, c.reservedCents, now) };
      };
      switch (c.personId) { case (?p) { if (e.ai.runningByPerson.get(p) == ?c.id) e.ai.runningByPerson.remove(p) }; case null {} };
      n += 1;
    };
    // Een lopende caffeine-oproep die er niet meer is (of al afgerekend): niemand blijft geblokkeerd.
    let stale = List.empty<Nat>();
    for ((p, id) in e.ai.runningByPerson.entries()) {
      switch (e.ai.log.get(id)) { case (?c) { if (settled(c) or now - c.startedAt > Config.aiRunningIdle) stale.add(p) }; case null stale.add(p) };
    };
    for (p in stale.values()) e.ai.runningByPerson.remove(p);
    prune(e, now);
    n;
  };

  func prune(e : Env, now : Int) {
    let cutoff = now - Config.aiLogKeepDays * Config.day;
    let old = List.empty<Types.AiCall>();
    label scan for ((_, c) in e.ai.log.entries()) {
      if (c.startedAt >= cutoff or old.size() >= Config.aiLogPrunePerRound) break scan;
      old.add(c);
    };
    for (c in old.values()) {
      e.ai.log.remove(c.id);
      switch (c.ticketId) { case (?t) e.ai.callByTicket.remove(t); case null {} };
      switch (c.proposalId) { case (?p) e.ai.callByProposal.remove(p); case null {} };
    };
  };

  // ── Views ───────────────────────────────────────────────────────────────
  public func callView(c : Types.AiCall, full : Bool) : AiViews.AiCallView {
    {
      id = c.id; workerKey = c.workerKey; route = c.route; origin = c.origin; personId = c.personId; workId = c.workId; ticketId = c.ticketId;
      proposalId = c.proposalId; model = c.model; instructionVersion = c.instructionVersion; inputSha256 = if full ?c.inputSha256 else null;
      outputSha256 = c.outputSha256; inputBytes = c.inputBytes; promptTokens = c.promptTokens; completionTokens = c.completionTokens;
      cachedTokens = c.cachedTokens; reservedCents = c.reservedCents; costCents = c.costCents; cycles = c.cycles; startedAt = c.startedAt;
      endedAt = c.endedAt; state = c.state; fellBack = c.fellBack; extra = if full c.extra else [];
    };
  };

  public func exportOf(c : Types.AiCall) : AiViews.AiCallExport {
    {
      id = c.id; workerKey = c.workerKey; route = c.route; origin = c.origin; personId = c.personId; workId = c.workId; ticketId = c.ticketId;
      proposalId = c.proposalId; model = c.model; instructionVersion = c.instructionVersion; inputSha256 = c.inputSha256;
      outputSha256 = c.outputSha256; inputBytes = c.inputBytes; promptTokens = c.promptTokens; completionTokens = c.completionTokens;
      cachedTokens = c.cachedTokens; reservedCents = c.reservedCents; costCents = c.costCents; cycles = c.cycles; startedAt = c.startedAt;
      endedAt = c.endedAt; state = c.state; fellBack = c.fellBack; extra = c.extra;
    };
  };

  // Herstel: het record terug, de koppelingen en het verbruik per maand opnieuw opgebouwd. Een oproep zonder afrekening
  // komt terug als onzeker en afgerekend op haar reservering (de reservering zelf leeft niet verder na een herstel).
  public func restore(ai : Types.AiState, x : AiViews.AiCallExport) {
    let done = x.extra.any(func(p : (Text, Text)) : Bool = p.0 == "afgerekend");
    let c : Types.AiCall = {
      id = x.id; workerKey = x.workerKey; route = x.route; origin = x.origin; personId = x.personId; workId = x.workId; ticketId = x.ticketId;
      var proposalId = x.proposalId; model = x.model; instructionVersion = x.instructionVersion; inputSha256 = x.inputSha256;
      var outputSha256 = x.outputSha256; inputBytes = x.inputBytes; var promptTokens = x.promptTokens; var completionTokens = x.completionTokens;
      var cachedTokens = x.cachedTokens; reservedCents = x.reservedCents; var costCents = if done x.costCents else x.reservedCents; var cycles = x.cycles;
      startedAt = x.startedAt; var endedAt = x.endedAt; var state = if (done or x.state != #running) x.state else #unsure("hersteld zonder afloop");
      fellBack = x.fellBack; var extra = if done x.extra else x.extra.concat([("afgerekend", "herstel")]);
    };
    let had = ai.log.containsKey(x.id);
    ai.log.add(x.id, c);
    switch (x.ticketId) { case (?t) ai.callByTicket.add(t, x.id); case null {} };
    switch (x.proposalId) { case (?p) ai.callByProposal.add(p, x.id); case null {} };
    if (not had and c.costCents > 0) {
      let k = bkey(x.workerKey, month(x.startedAt));
      ai.spent.add(k, (ai.spent.get(k) ?? 0) + c.costCents);
    };
  };
};
