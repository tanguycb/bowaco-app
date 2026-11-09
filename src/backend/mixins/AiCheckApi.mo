// Nakijkopdrachten (bouwplan rijen 3.9 en 3.11, §6 "Twee wegen voor AI", "Bots via MCP", "Autonomie per taak").
// - 3.9 (#tender): de OA-offertes op een prijsvraag laten controleren en vergelijken. Enkel kantoor met de aankoopprijzen
//   (#editTenders + #readCosts + het volle zicht op de prijsvragen van die werf, zoals compareTender). Het voorstel = per post een
//   firma + bevindingen; een mens kiest en neemt over met applyTenderCheck (mixin OaQuotesApi: één klik = kiezen + overnemen).
// - 3.11 (#quote): een ontwerpversie van de klantofferte laten nalezen vóór verzending. Enkel wie de marges ziet (#editQuote +
//   #readCosts + #readQuotes op de werf, zoals checkQuoteVersion). Het resultaat = opmerkingen; niet blokkerend, er wordt nooit
//   iets gewijzigd of verstuurd.
// Twee wegen: een bot via MCP (lib/Bots.mo: vergelijkopdrachten/voorstel_vergelijking, naleesopdrachten/opmerkingen_offerte) of
// Caffeine AI op hetzelfde dossier (runAiCheckAi: één oproep, AI-logboek zonder inhoud, budget per maand, testmodus = droog voorbeeld).
// De lijst (query) heeft geen bedragen; het resultaat komt enkel uit readAiCheck (update-call, auditregel "bekeek:<soort>:<id>").
// Een onbekende opdracht of geen toegang geeft dezelfde weigering (geen orakel).
// Private hulpfuncties dragen het voorvoegsel `ac` (ze delen één blok met alle andere mixins).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Json "mo:jayson/Json";
import Types "../types";
import AV "../types/aicheckviews";
import Access "../lib/Access";
import AiCheck "../lib/AiCheck";
import AiPrompts "../lib/AiPrompts";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Post "../lib/Post";
import Rights "../lib/Rights";
import Tenders "../lib/Tenders";
import Caffeine "../lib/ai/Caffeine";
import Connector "../lib/ai/Connector";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  quoteForms : Types.QuoteFormState,
  tenders : Types.TenderState,
  oaDeals : Types.OaDealState,
  surveys : Types.SurveyState,
  robot : Types.RobotState,
  ai : Types.AiState,
  bots : Types.BotState,
  aiCheck : Types.AiCheckState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  isAiLive : () -> Bool,
) {

  func acTenderCtx() : AiCheck.TenderCtx { { settings; library; quotes; tenders; oaDeals; org; today = Post.local(Time.now()).day } };
  func acQuoteCtx() : AiCheck.QuoteCtx { { settings; quotes; quoteForms; works; org; tenders; surveys } };
  func acTarget(t : AV.AiCheckTargetIn) : Types.AiCheckTarget { switch t { case (#tender x) #tender(x); case (#quote x) #quote(x) } };
  func acWorker(t : Types.AiCheckTarget) : Text { switch t { case (#tender _) "oa-offertes-vergelijken"; case _ "offerte-review" } };

  // De werf van het doel als deze persoon het mag nakijken, anders null (zelfde weigering voor onbekend en geen toegang).
  func acWork(p : Types.Person, t : Types.AiCheckTarget) : ?Nat {
    let ctx = { works; settings };
    switch t {
      case (#tender id) {
        let x = tenders.tenders.get(id) ?? return null;
        if (Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null) and Rights.tenderScope(ctx, p, x.workId) == #full) ?x.workId else null;
      };
      case (#quote id) {
        let v = quotes.versions.get(id) ?? return null;
        let q = quotes.quotes.get(v.quoteId) ?? return null;
        if (Rights.may(ctx, p, #editQuote, null) and Rights.may(ctx, p, #readCosts, null) and Rights.may(ctx, p, #readQuotes, ?q.workId)) ?q.workId else null;
      };
      case (#other _) null;
    };
  };
  func acJob(p : Types.Person, id : Nat) : { #ok : Types.AiCheckJob; #err : Text } {
    let j = aiCheck.jobs.get(id) ?? return #err("Geen toegang");
    if (acWork(p, j.target) == ?j.workId) #ok(j) else #err("Geen toegang");
  };

  func acBotTools(t : Types.AiCheckTarget) : [Text] {
    switch t { case (#tender _) ["vergelijkopdrachten", "voorstel_vergelijking"]; case _ ["naleesopdrachten", "opmerkingen_offerte"] };
  };
  func acBotOk(b : Types.Bot, t : Types.AiCheckTarget, workId : Nat) : Bool {
    let ctx = { works; settings };
    acBotTools(t).all(func(tool : Text) : Bool = Rights.mayBot(ctx, b, tool, ?workId));
  };

  // De stand van nu (verouderd = het voorstel rekende op een andere stand).
  func acBasisNow(j : Types.AiCheckJob) : ?Text {
    switch (j.target) {
      case (#tender id) switch (tenders.tenders.get(id)) { case (?t) ?AiCheck.tenderBasis(tenders, t); case null null };
      case (#quote id) switch (quotes.versions.get(id)) { case (?v) ?AiCheck.quoteBasis(v); case null null };
      case (#other _) null;
    };
  };
  func acBasisOf(j : Types.AiCheckJob) : Text { AiCheck.basisOf(j) };
  // Kan het doel nog nagekeken worden (prijsvraag loopt, versie is een ontwerp)?
  func acTargetOpen(t : Types.AiCheckTarget) : Bool {
    switch t { case (#tender id) AiCheck.openTender(tenders, id) != null; case (#quote id) AiCheck.draftVersion(quotes, id) != null; case (#other _) false };
  };

  func acBrief(j : Types.AiCheckJob) : AV.AiCheckBrief {
    let (way, botId, botName) = switch (j.via) {
      case (#bot(b)) ("bot", ?b, switch (bots.bots.get(b)) { case (?x) x.name; case null "bot #" # b.toText() });
      case (#ai) ("caffeine", null, "Caffeine");
      case (#other(t)) (t, null, "");
    };
    // Een query kan niets sluiten: een opdracht waarvan het doel niet meer open is, toont "afgesloten" (de klok sluit ze).
    let open = acTargetOpen(j.target);
    let (status, reason) = if (AiCheck.isLive(j) and not open) ("afgesloten", "niet meer open") else (AiCheck.statusKey(j.status), switch (j.status) { case (#closed r) r; case (#failed r) r; case _ "" });
    {
      id = j.id;
      workId = j.workId;
      kind = AiCheck.kindKey(j.target);
      targetId = switch (j.target) { case (#tender x) x; case (#quote x) x; case (#other _) 0 };
      way;
      botId;
      botName;
      status;
      reason;
      verdict = switch (j.result) { case (?r) r.verdict; case null "" };
      findings = switch (j.result) { case (?r) r.findings.size(); case null 0 };
      picks = switch (j.result) { case (?r) r.picks.filter(func(x : Types.AiCheckPick) : Bool = x.oaQuoteId != null).size(); case null 0 };
      stale = j.result != null and acBasisNow(j) != ?acBasisOf(j);
      createdAt = j.createdAt;
      createdByName = Access.personName(access, j.createdBy);
    };
  };

  // ── Starten ───────────────────────────────────────────────────────────
  public shared ({ caller }) func startAiCheck(i : AV.AiCheckStart) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let target = acTarget(i.target);
    let workId = acWork(p, target) ?? return #err("Geen toegang");
    let basis = switch target {
      case (#tender id) {
        let t = AiCheck.openTender(tenders, id) ?? return #err("Deze prijsvraag loopt niet (meer)");
        if (Tenders.itemsOf(tenders, t.id).size() == 0) { return #err("Deze prijsvraag heeft geen posten") };
        if (AiCheck.tenderBasis(tenders, t).endsWith(#text ":")) { return #err("Er is nog geen offerte binnen om na te kijken") };
        AiCheck.tenderBasis(tenders, t);
      };
      case (#quote id) {
        let (v, _) = AiCheck.draftVersion(quotes, id) ?? return #err("Enkel een ontwerpversie kan nagelezen worden");
        AiCheck.quoteBasis(v);
      };
      case (#other _) return #err("Geen toegang");
    };
    let via : Types.InvCheckVia = switch (i.way) {
      case (#ai) {
        if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
        #ai;
      };
      case (#bot(id)) {
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        if (not Rights.botActive(b) or not acBotOk(b, target, workId)) {
          return #err("Deze bot mag dit niet nakijken: zet " # acBotTools(target).values().join(", ") # " en deze werf op zijn fiche");
        };
        #bot(id);
      };
    };
    if (AiCheck.openOnWork(aiCheck, workId) >= Config.aiCheckMaxOpenPerWork) { return #err("Te veel open opdrachten op deze werf; sluit er eerst af") };
    if (aiCheck.jobs.size() >= Config.aiCheckMaxJobs) { return #err("Te veel opdrachten") };
    // Eén open opdracht per doel en weg tegelijk (een oude met een voorstel op een verouderde stand mag blijven staan).
    if (AiCheck.jobsOfTarget(aiCheck, workId, target).any(func(j : Types.AiCheckJob) : Bool = AiCheck.isLive(j) and j.via == via and acBasisOf(j) == basis)) {
      return #err("Dit loopt al langs deze weg (of het voorstel is er al)");
    };
    let now = Time.now();
    let id = Ids.next(ctr, "aiCheck");
    let job : Types.AiCheckJob = { id; workId; target; via; basis; createdAt = now; createdBy = p.id; var status = #open; var result = null; var decidedAt = null; var decidedBy = null; var extra = [] };
    aiCheck.jobs.add(id, job);
    AiCheck.addIndex(aiCheck, workId, id);
    Access.audit(audit, caller, ?p.id, ?workId, AiCheck.kindKey(target) # "-start", "opdracht #" # id.toText() # " via " # (switch via { case (#bot(b)) "bot #" # b.toText(); case _ "Caffeine AI" }));
    #ok(id);
  };

  // ── Lezen ─────────────────────────────────────────────────────────────
  public query ({ caller }) func listAiCheckBots(t : AV.AiCheckTargetIn) : async [AV.AiCheckBot] {
    let p = Access.requireActive(access, caller);
    let target = acTarget(t);
    let w = switch (acWork(p, target)) { case (?x) x; case null Runtime.trap("Geen toegang") };
    bots.bots.values().filter(func(b : Types.Bot) : Bool = Rights.botActive(b) and acBotOk(b, target, w)).map(func(b : Types.Bot) : AV.AiCheckBot = { id = b.id; name = b.name }).toArray();
  };

  // kind = "vergelijking" of "nalezen". Enkel kantoor met de prijzen: anderen krijgen een weigering, geen ja/nee.
  public query ({ caller }) func aiCheckAiReady(kind : Text) : async Bool {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let key = if (kind == "vergelijking") { Rights.require(ctx, p, #editTenders, null); "oa-offertes-vergelijken" } else { Rights.require(ctx, p, #editQuote, null); "offerte-review" };
    Rights.require(ctx, p, #readCosts, null);
    if (not Rights.may(ctx, p, #useAi, null)) return false;
    switch (ai.workers.get(key)) { case (?w) w.enabled; case null false };
  };

  public query ({ caller }) func listAiChecks(t : AV.AiCheckTargetIn) : async [AV.AiCheckBrief] {
    let p = Access.requireActive(access, caller);
    let target = acTarget(t);
    let w = switch (acWork(p, target)) { case (?x) x; case null Runtime.trap("Geen toegang") };
    AiCheck.jobsOfTarget(aiCheck, w, target).reverse().map<Types.AiCheckJob, AV.AiCheckBrief>(acBrief);
  };

  public shared ({ caller }) func readAiCheck(id : Nat) : async Result.Result<AV.AiCheckFull, Text> {
    let p = Access.requireActive(access, caller);
    let j = switch (acJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    AiCheck.settle(tenders, quotes, bots, j, Time.now());
    Access.audit(audit, caller, ?p.id, ?j.workId, "bekeek:" # AiCheck.kindKey(j.target) # ":" # id.toText(), AiCheck.statusKey(j.status));
    let items : [Types.TenderItem] = switch (j.target) { case (#tender tid) Tenders.itemsOf(tenders, tid); case _ [] };
    let posOf = func(itemId : Nat) : Nat {
      for ((k, x) in items.enumerate()) { if (x.id == itemId) return k + 1 };
      0;
    };
    let firm = func(qid : ?Nat) : Text {
      switch qid { case (?q) switch (tenders.oaQuotes.get(q)) { case (?x) switch (org.orgs.get(x.orgId)) { case (?o) o.name; case null "" }; case null "" }; case null "" };
    };
    let r = j.result;
    #ok({
      brief = acBrief(j);
      summary = switch r { case (?x) x.summary; case null "" };
      confidence = switch r { case (?x) x.confidence; case null 0 };
      dry = switch r { case (?x) AiCheck.extraGet(x.extra, "droog") != null; case null false };
      picks = switch r { case (?x) x.picks.map<Types.AiCheckPick, AV.AiCheckPickView>(func k = { itemId = k.itemId; pos = posOf(k.itemId); oaQuoteId = k.oaQuoteId; orgName = firm(k.oaQuoteId); reason = k.reason }); case null [] };
      findings = switch r { case (?x) x.findings.map<Types.AiCheckFinding, AV.AiCheckFindingView>(func f = { kind = f.kind; severity = f.severity; text = f.text; pos = f.ref; cents = f.cents }); case null [] };
    });
  };

  // ── Caffeine AI-weg (het dossier) ─────────────────────────────────────
  func acAiReal() : Bool { isAiLive() and settings.values.get("ai.testmodus") != ?"aan" };

  func acDossier(j : Types.AiCheckJob) : ?(Text, Nat) {
    switch (j.target) {
      case (#tender id) {
        let t = AiCheck.openTender(tenders, id) ?? return null;
        ?(AiCheck.tenderDossier(acTenderCtx(), t).stringify(), Tenders.itemsOf(tenders, t.id).size());
      };
      case (#quote id) {
        let (v, q) = AiCheck.draftVersion(quotes, id) ?? return null;
        ?(AiCheck.quoteDossier(acQuoteCtx(), q, v, null).stringify(), AiCheck.lineCount(acQuoteCtx(), v));
      };
      case (#other _) null;
    };
  };

  public shared ({ caller }) func runAiCheckAi(id : Nat) : async Result.Result<AV.AiCheckAiStep, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
    let j = switch (acJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (j.via != #ai) { return #err("Deze opdracht leest een bot") };
    if (j.status != #open) { return #err("Deze opdracht heeft al een voorstel of is afgesloten") };
    let basis0 = acBasisNow(j) ?? return #err("Niet meer open");
    let (dossierJson, n) = acDossier(j) ?? return #err(switch (j.target) { case (#tender _) "Deze prijsvraag loopt niet meer"; case _ "Deze versie is geen ontwerp meer" });
    let w = ai.workers.get(acWorker(j.target)) ?? return #err("De fiche hiervoor is nog niet ingericht (Beheer → AI-medewerkers)");
    let v = AiPrompts.version(w.key, w.instructionVersion) ?? return #err("Onbekende instructieversie");
    let userText = "Dossier van BOWACO (JSON):\n<<<DOSSIER\n" # dossierJson.replace(#text "DOSSIER>>>", "DOSSIER >>>") # "\nDOSSIER>>>";
    if (userText.size() > Config.aiMaxInputBytes) { return #err("Te groot om via Caffeine na te kijken; laat een bot het doen") };
    let live = acAiReal();
    let now0 = Time.now();
    switch (AiCheck.extraGet(j.extra, "bezig")) {
      case (?t) { switch (Int.fromText(t)) { case (?at) { if (now0 - at < 300_000_000_000) return #err("Dit wordt al nagekeken; wacht even") }; case null {} } };
      case null {};
    };
    let unmark = func() { j.extra := j.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "bezig") };
    let content : Text = if (not live) v.dryRun else {
      if (not w.enabled or w.budgetMonthCents == 0) { return #err(w.name # " staat uit (Beheer → AI-medewerkers)") };
      if (not ai.models.containsKey(w.modelAlias)) { return #err("Het model van de fiche staat niet in de catalogus") };
      if (ai.runningByPerson.containsKey(p.id)) { return #err("Je hebt al een oproep lopen; wacht even") };
      if (ai.runningByPerson.size() >= Config.aiMaxConcurrent) { return #err("Druk bezig, probeer zo meteen") };
      j.extra := AiCheck.extraSet(j.extra, "bezig", Int.toText(now0));
      let e = { settings; access; robot; ai; audit; ctr };
      let now = Time.now();
      let reserve = switch (Connector.reserve(e, w, caller, ?p.id, ?j.workId, now)) { case (#ok x) x; case (#err t) { unmark(); return #err(t) } };
      let call = Connector.newCall(e, w, #caffeine, #user(p.id), ?p.id, ?j.workId, w.modelAlias, Connector.sha(userText), userText.size(), reserve, false, now);
      call.extra := [("nakijkopdracht", j.id.toText())];
      ai.runningByPerson.add(p.id, call.id);
      let out = await* Caffeine.chat<system>(w.modelAlias, v, userText);
      if (ai.runningByPerson.get(p.id) == ?call.id) ai.runningByPerson.remove(p.id);
      unmark();
      // R33: na de await opnieuw: nog toegang met AI, doel nog open, opdracht nog open.
      let still = switch (Access.activePerson(access, caller)) { case (?q) acWork(q, j.target) == ?j.workId and Rights.may({ works; settings }, q, #useAi, null) and acTargetOpen(j.target); case null false };
      switch (Connector.finishRaw(e, call, v, out, still and j.status == #open, caller, AiCheck.kindKey(j.target), Config.aiCheckAnswerBytes)) { case (#ok t) t; case (#err m) return #err(m) };
    };
    if (j.status != #open) { return #err("De opdracht veranderde intussen") };
    let extra = [("ai", w.modelAlias), ("basis", basis0)].concat(if live [] else [("droog", "1")]);
    let parsed = switch (Json.parse(content)) {
      case (?x) switch (j.target) {
        case (#tender tid) switch (tenders.tenders.get(tid)) {
          case (?t) AiCheck.parseTender(x, Time.now(), extra, n, func(pos : Nat) : ?Nat = AiCheck.itemAt(tenders, t, pos), func(it : Nat, q : Nat) : ?Text = AiCheck.pickErr(tenders, t, it, q), false);
          case null #err("prijsvraag weg");
        };
        case _ AiCheck.parseQuote(x, Time.now(), extra, n);
      };
      case null #err("onleesbaar antwoord");
    };
    switch parsed {
      case (#ok res) {
        j.result := ?res;
        j.status := #proposed;
        Access.audit(audit, caller, ?p.id, ?j.workId, AiCheck.kindKey(j.target) # "-voorstel", "opdracht #" # j.id.toText() # " (Caffeine AI" # (if live ")" else ", testmodus)"));
        #ok({ status = "voorstel"; dry = not live });
      };
      case (#err m) {
        let tries = 1 + (switch (AiCheck.extraGet(j.extra, "pogingen")) { case (?t) switch (Nat.fromText(t)) { case (?k) k; case null 0 }; case null 0 });
        if (tries >= 3) {
          AiCheck.close(j, #failed("het antwoord was onbruikbaar: " # Text.fromIter(m.chars().take(120))), ?p.id, Time.now());
        } else {
          j.extra := AiCheck.extraSet(j.extra, "pogingen", tries.toText());
        };
        #ok({ status = "mislukt"; dry = not live });
      };
    };
  };

  // ── Afsluiten ─────────────────────────────────────────────────────────
  // Gezien: kantoor las het voorstel (en kiest zelf, of verstuurt de offerte). Annuleren: zonder gevolg. Het voorstel van de bot
  // (Voorstellen en acties) volgt: gezien = aanvaard, annuleren = geweigerd. Overnemen met één klik: applyTenderCheck (OaQuotesApi).
  public shared ({ caller }) func finishAiCheck(id : Nat, outcome : AV.AiCheckOutcome) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let j = switch (acJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    let now = Time.now();
    AiCheck.settle(tenders, quotes, bots, j, now);
    if (not AiCheck.isLive(j)) { return #err("Deze opdracht is al afgesloten") };
    switch outcome {
      case (#seen) {
        if (j.status != #proposed) { return #err("Er is nog geen voorstel") };
        AiCheck.follow(bots, j, true, ?p.id, now);
        AiCheck.close(j, #closed("gezien"), ?p.id, now);
      };
      case (#cancelled) {
        AiCheck.follow(bots, j, false, ?p.id, now);
        AiCheck.close(j, #cancelled, ?p.id, now);
      };
    };
    Access.audit(audit, caller, ?p.id, ?j.workId, AiCheck.kindKey(j.target) # "-af", "opdracht #" # j.id.toText() # " " # AiCheck.statusKey(j.status));
    #ok;
  };
};
