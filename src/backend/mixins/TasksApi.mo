// Het model van taak en voorstel lezen (stap 4b.5). Enkel de beheerder (#manageBots), zoals Beheer → Assistenten; 4b.6 en 4b.7
// openen het voor de calculator en de werfleider met de rechten van hun scherm. Een query: niets wijzigt, geen auditregel nodig
// (er staan geen bedragen en geen vrije tekst van een bot in).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Result "mo:core/Result";
import Time "mo:core/Time";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";
import Types "../types";
import TK "../types/taskviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";
import Tasks "../lib/Tasks";
import Todo "../lib/Todo";
import Proof "../lib/Proof";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  tasks : Types.TaskStore,
  tenders : Types.TenderState,
  oaInvoices : Types.OaInvoiceState,
  quotes : Types.QuotesState,
  proof : Types.ProofState, // 4b.7: de score van de proefbank bij de naam van de assistent
  audit : Types.AuditState,
  bots : Types.BotState, // 4b.8: een vrije taak aan een assistent (naam, antwoord)
) {

  func tkName(w : Types.TaskWho, kind : Text) : Text {
    switch w {
      case (#person id) switch (access.persons.get(id)) { case (?p) p.name; case null "" };
      // 4b.8: een vrije taak aan een assistent: zijn naam (zoals de beheerder hem noemde) + "(assistent)".
      case (#bot id) if (kind == "taak") (switch (bots.bots.get(id)) { case (?b) Todo.assistantName(b.name); case null Todo.assistantName("vrije taken") }) else Todo.assistantName(Tasks.kindWord(kind));
      case (#app _) Todo.assistantName(Tasks.kindWord(kind));
      case (#clock) "BOWACO";
      case (#other _) "";
    };
  };

  func tkView(t : Types.AssistTask) : TK.AssistTaskView {
    {
      id = t.id;
      key = t.key;
      kind = t.kind;
      name = if (Tasks.isManual(t)) "Taak" else Todo.assistantName(Tasks.kindWord(t.kind));
      workId = t.workId;
      workCode = switch (t.workId) { case (?w) switch (works.works.get(w)) { case (?x) x.code; case null "" }; case null "" };
      subject = Tasks.refKey(t.subject);
      givenBy = Tasks.whoKey(t.givenBy);
      givenByName = tkName(t.givenBy, t.kind);
      doer = Tasks.whoKey(t.doer);
      doerName = tkName(t.doer, t.kind);
      createdAt = t.createdAt;
      state = Tasks.stateKey(t.state);
      updatedAt = t.updatedAt;
      proposal = switch (Tasks.proposalOf(tasks, t)) {
        case (?p) ?{
          id = p.id;
          by = Tasks.whoKey(p.by);
          byName = tkName(p.by, t.kind);
          at = p.at;
          auto = p.auto;
          confidence = p.confidence;
          points = p.points.map(func(x : Types.TaskPoint) : TK.AssistPointView = { key = x.key; now = if (x.secret) "" else x.now; after = if (x.secret) "" else x.after; source = Tasks.refKey(x.source); secret = x.secret; adjusted = Tasks.isAdjusted(x) });
          actionId = p.actionId;
          state = Tasks.proposalKey(p.state);
          decidedBy = switch (p.decidedBy) { case (?w) Tasks.whoKey(w); case null "" };
          decidedByName = switch (p.decidedBy) { case (?w) tkName(w, t.kind); case null "" };
          decidedAt = p.decidedAt;
          undo = switch (p.undo) { case (#none) ""; case (#possible h) h; case (#done _) "gedaan"; case (#other x) x };
        };
        case null null;
      };
      events = t.events.map(func(e : Types.TaskEvent) : TK.AssistEventView = { at = e.at; who = Tasks.whoKey(e.who); whoName = tkName(e.who, t.kind); what = e.what });
      title = Tasks.extraOf(t, "titel");
      dueDay = Nat.fromText(Tasks.extraOf(t, "uiterlijk"));
      // 4b.8: bij een vrije taak van een assistent: zijn antwoord (tekst van een bot: enkel getoond, nooit uitgevoerd).
      reason = if (Tasks.isBotTask(t)) botAnswer(t) else Tasks.extraOf(t, "reden");
    };
  };

  func botAnswer(t : Types.AssistTask) : Text {
    switch (Tasks.proposalOf(tasks, t)) {
      case (?p) switch (p.actionId) { case (?a) switch (bots.actions.get(a)) { case (?x) x.reason; case null "" }; case null "" };
      case null "";
    };
  };

  public query ({ caller }) func listTasks(q : TK.AssistTaskQuery) : async TK.AssistTaskPage {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBots, null);
    let pool : [Types.AssistTask] = switch (q.workId) {
      case (?w) Tasks.ofWork(tasks, w);
      case null tasks.tasks.values().toArray();
    };
    let picked = pool.filter(func(t : Types.AssistTask) : Bool = (not q.openOnly or not Tasks.isFinal(t.state)) and (q.kind == "" or t.kind == q.kind)).sort(func(a : Types.AssistTask, b : Types.AssistTask) : Order.Order = Nat.compare(b.id, a.id));
    let limit = if (q.limit == 0 or q.limit > Config.taskMaxPage) Config.taskMaxPage else q.limit;
    let from = Nat.min(q.offset, picked.size());
    let to = Nat.min(from + limit, picked.size());
    { total = picked.size(); items = picked.sliceToArray(from, to).map(tkView) };
  };

  // ── 4b.6: voorstelscherm en "wie deed wat" (calculator en werfleider met de rechten van hun scherm, vraag E-3) ──
  func tkSource(t : Types.AssistTask) : Text {
    switch (t.src) {
      case (#oaRead _) "oaread";
      case (#aiCheck _) if (t.kind == "offerte-nalezen") "nalezen" else "vergelijken";
      case (#invCheck _) "invcheck";
      case (#botAction _) "bot";
      case (#other _) if (Tasks.isManual(t)) "taak" else "bot";
    };
  };

  // Het stuk in woorden (enkel bij full): prijsvraag-code, factuurnummer, offerteversie. Een bestandsnaam nooit (vertrouwelijk).
  func tkSubject(r : Types.TaskRef) : Text {
    switch r {
      case (#tender id) switch (tenders.tenders.get(id)) { case (?x) "prijsvraag " # x.code; case null "" };
      case (#oaInvoice id) switch (oaInvoices.invoices.get(id)) { case (?x) "factuur " # x.number; case null "" };
      case (#quote id) switch (quotes.versions.get(id)) { case (?x) "offerte versie " # x.version.toText(); case null "" };
      case (#file _) "bestand";
      case _ "";
    };
  };

  // Kort: wat een interne rol zonder de bedragen van het bronscherm mag zien (geen punten, geen onderwerp, geen zekerheid).
  func tkBrief(v : TK.AssistTaskView) : TK.AssistTaskView {
    {
      v with subject = "";
      title = "";
      dueDay = null;
      reason = "";
      proposal = switch (v.proposal) {
        case (?p) ?{ p with points = []; confidence = null; actionId = null; undo = "" };
        case null null;
      };
    };
  };

  public query ({ caller }) func listTasksFor(q : TK.AssistTaskForQuery) : async TK.AssistTaskSeenPage {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    // Externen zien niets (ook geen lege lijst die iets verraadt over het bestaan van de functie): geen toegang.
    if (not Rights.internal(p) and not Rights.may(ctx, p, #manageBots, null)) { Runtime.trap("Geen toegang") };
    let pool : [Types.AssistTask] = if (q.key != "") {
      switch (Tasks.byKey(tasks, q.key)) { case (?t) [t]; case null [] };
    } else switch (q.workId) {
      case (?w) Tasks.ofWork(tasks, w);
      case null tasks.tasks.values().toArray();
    };
    let seen = List.empty<(Types.AssistTask, Bool)>();
    for (t in pool.values()) {
      if ((q.workId == null or t.workId == q.workId) and (not q.openOnly or not Tasks.isFinal(t.state)) and (q.kind == "" or t.kind == q.kind) and (q.subject == "" or Tasks.refKey(t.subject) == q.subject)) {
        // 4b.7: een gewone taak ziet wie ze gaf of kreeg volledig; anderen zoals bij de andere soorten (de beheerder volledig, de rest kort).
        // 4b.8 (review L6): een vrije taak van een assistent volledig enkel met #manageBots (het antwoord kan tonen wat de assistent leest).
        let party = Tasks.isManual(t) and (t.doer == #person(p.id) or t.givenBy == #person(p.id)) and (not Tasks.isBotTask(t) or Rights.may(ctx, p, #manageBots, null));
        let sight = if party #full else Rights.taskSight(ctx, p, tkSource(t), t.workId);
        switch sight {
          case (#full) seen.add((t, true));
          // Op een stuk zoeken kan enkel wie het stuk ziet (anders verraadt de filter het onderwerp).
          case (#brief) { if (q.subject == "") seen.add((t, false)) };
          case (#none) {};
        };
      };
    };
    let picked = seen.toArray().sort(func(a : (Types.AssistTask, Bool), b : (Types.AssistTask, Bool)) : Order.Order = Nat.compare(b.0.id, a.0.id));
    let limit = if (q.limit == 0 or q.limit > Config.taskMaxPage) Config.taskMaxPage else q.limit;
    let from = Nat.min(q.offset, picked.size());
    let to = Nat.min(from + limit, picked.size());
    {
      total = picked.size();
      items = picked.sliceToArray(from, to).map(func((t, full) : (Types.AssistTask, Bool)) : TK.AssistTaskSeen {
        let v = tkView(t);
        if full ({ task = v; full = true; subjectLabel = tkSubject(t.subject) }) else ({ task = tkBrief(v); full = false; subjectLabel = "" });
      });
    };
  };

  // ── 4b.7: een taak geven aan een collega en de stand van een taak ──
  func tkInternal(personId : Nat) : ?Types.Person {
    switch (access.persons.get(personId)) { case (?x) { if (x.archivedAt == null and Rights.internal(x)) ?x else null }; case null null };
  };

  // Collega's aan wie je een taak kan geven (intern en actief; bij een werf enkel wie de werf ziet).
  public query ({ caller }) func listColleagues(workId : ?Nat) : async [TK.Colleague] {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    let ctx = { works; settings };
    let out = List.empty<TK.Colleague>();
    for (x in access.persons.values()) {
      if (x.archivedAt == null and Rights.internal(x) and (switch workId { case (?w) Rights.seesWork(ctx, x, w); case null true })) { out.add({ id = x.id; name = x.name }) };
    };
    out.toArray().sort(func(a : TK.Colleague, b : TK.Colleague) : Order.Order = Text.compare(a.name, b.name));
  };

  public shared ({ caller }) func giveTask(i : TK.GiveTaskInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    let ctx = { works; settings };
    let title = switch (Access.cleanText(i.title, Config.taskTitleMax)) { case (?x) x; case null return #err("Schrijf kort wat er moet gebeuren") };

    let doer = switch (tkInternal(i.doerId)) { case (?x) x; case null return #err("Kies een collega") };
    switch (i.workId) {
      case (?w) {
        if (not works.works.containsKey(w)) { return #err("Onbekende werf") };
        if (not Rights.seesWork(ctx, p, w)) { Runtime.trap("Geen toegang") };
        if (not Rights.seesWork(ctx, doer, w)) { return #err("Deze collega heeft geen toegang tot die werf") };
      };
      case null {};
    };
    switch (i.dueDay) { case (?d) { if (d < Config.minDay or d > Config.maxDay) { return #err("Onmogelijke datum") } }; case null {} };
    var open = 0;
    for (t in tasks.tasks.values()) { if (Tasks.isManual(t) and t.doer == #person(doer.id) and not Tasks.isFinal(t.state)) { open += 1 } };
    if (open >= Config.taskMaxOpenPerPerson) { return #err("Deze collega heeft al te veel open taken") };
    let t = Tasks.giveManual(tasks, p.id, #person(doer.id), i.workId, title, i.dueDay, Time.now());
    Access.audit(audit, caller, ?p.id, i.workId, "taak-gegeven", "taak #" # t.id.toText() # " aan persoon #" # doer.id.toText());
    #ok(t.id);
  };

  // 4b.8: een vrije taak aan een assistent. Enkel de beheerder: het antwoord kan tonen wat de fiche van de assistent leest, en dat kan
  // meer zijn dan een andere rol mag zien.
  public shared ({ caller }) func giveBotTask(i : TK.GiveBotTaskInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #manageBots, null)) { Runtime.trap("Geen toegang") };
    let title = switch (Access.cleanText(i.title, Config.taskTitleMax)) { case (?x) x; case null return #err("Schrijf kort wat er moet gebeuren") };
    let bid = i.botId;
    let b = switch (bots.bots.get(bid)) { case (?x) x; case null return #err("Kies een assistent") };
    if (not taskBotOk(b)) { return #err("Deze assistent kan geen vrije taak krijgen: zet taken en voorstel op zijn fiche (Beheer → Assistenten)") };
    switch (i.workId) {
      case (?w) {
        if (not works.works.containsKey(w)) { return #err("Onbekende werf") };
        if (not Rights.botSeesWork(ctx, b, w)) { return #err("Deze werf staat niet op de fiche van de assistent") };
      };
      case null {};
    };
    switch (i.dueDay) { case (?d) { if (d < Config.minDay or d > Config.maxDay) { return #err("Onmogelijke datum") } }; case null {} };
    var open = 0;
    for (t in tasks.tasks.values()) { if (Tasks.isManual(t) and t.doer == #bot(bid) and not Tasks.isFinal(t.state)) { open += 1 } };
    if (open >= Config.taskMaxOpenPerPerson) { return #err("Deze assistent heeft al te veel open taken") };
    let t = Tasks.giveManual(tasks, p.id, #bot(bid), i.workId, title, i.dueDay, Time.now());
    Access.audit(audit, caller, ?p.id, i.workId, "taak-gegeven", "taak #" # t.id.toText() # " aan bot #" # bid.toText());
    #ok(t.id);
  };

  // De uitvoerder: begonnen · klaar · kan niet (met reden); de gever of de beheerder: annuleren.
  public shared ({ caller }) func stepTask(id : Nat, step : TK.TaskStep, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    let t = switch (tasks.tasks.get(id)) { case (?x) x; case null return #err("Onbekende taak") };
    if (not Tasks.isManual(t)) { return #err("Deze taak beslis je in haar eigen scherm") };
    let ctx = { works; settings };
    let isDoer = t.doer == #person(p.id);
    let isGiver = t.givenBy == #person(p.id);
    if (not isDoer and not isGiver and not Rights.may(ctx, p, #manageBots, null)) { Runtime.trap("Geen toegang") };
    if (Tasks.isFinal(t.state)) { return #err("Deze taak is al afgesloten") };
    let now = Time.now();
    switch step {
      case (#start) {
        if (not isDoer) { return #err("Enkel de uitvoerder begint aan een taak") };
        if (t.state != #waiting) { return #err("Deze taak is al bezig") };
        Tasks.setManual(t, p.id, #busy, "", now);
      };
      case (#done) {
        if (not isDoer) { return #err("Enkel de uitvoerder sluit een taak af") };
        Tasks.setManual(t, p.id, #done, "", now);
      };
      case (#cannot) {
        if (not isDoer) { return #err("Enkel de uitvoerder meldt dat het niet kan") };
        let why = switch (Access.cleanText(reason, Config.taskReasonMax)) { case (?x) x; case null return #err("Schrijf kort waarom het niet kan") };
        Tasks.setManual(t, p.id, #failed("kan niet"), why, now);
      };
      case (#cancel) {
        if (not isGiver and not Rights.may(ctx, p, #manageBots, null)) { return #err("Enkel wie de taak gaf of de beheerder annuleert") };
        if (Tasks.isBotTask(t)) {
          // 4b.8 (review M3): een open antwoord van de assistent wordt geweigerd en het voorstel ingetrokken.
          switch (Tasks.proposalOf(tasks, t)) {
            case (?pr) switch (pr.actionId) {
              case (?aid) switch (bots.actions.get(aid)) { case (?a) { if (a.state == #proposed) { a.state := #rejected; a.decidedBy := ?p.id; a.decidedAt := ?now; a.note := "Taak geannuleerd" } }; case null {} };
              case null {};
            };
            case null {};
          };
          Tasks.closeBotTask(tasks, t, #person(p.id), now);
        } else Tasks.setManual(t, p.id, #cancelled, "", now);
      };
    };
    Access.audit(audit, caller, ?p.id, t.workId, "taak-stand", "taak #" # id.toText() # " " # Tasks.stateKey(t.state));
    #ok(());
  };

  // 4b.8: een assistent kan een vrije taak krijgen als hij actief is, taken en voorstel op zijn fiche heeft en vrije taken niet op Nooit.
  func taskBotOk(b : Types.Bot) : Bool {
    Rights.botActive(b) and b.tools.any(func(x : Text) : Bool = x == "taken") and b.tools.any(func(x : Text) : Bool = x == "voorstel") and Rights.botLevel(b, "vrije-taak") != #never;
  };

  // De assistenten die een vrije taak kunnen krijgen (enkel de beheerder: Taak geven → Assistent → Vrije taak).
  public query ({ caller }) func listTaskBots() : async [TK.Colleague] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageBots, null);
    bots.bots.values().filter(taskBotOk).map(func(b : Types.Bot) : TK.Colleague = { id = b.id; name = Todo.assistantName(b.name) }).toArray();
  };

  // De assistenten in de woorden van het scherm, met de score van de proefbank bij de naam. Interne rollen; geen leverancier, model of
  // fiche (dat blijft in Beheer). De score is het beste van de laatste gesloten ronde per koppeling, het aantal gevallen erbij.
  public query ({ caller }) func listAssistants() : async [TK.AssistantCard] {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    let now = Time.now();
    // 4b.8: vrije taken hebben geen eigen kaart (ze staan bij de assistent die ze kreeg, in Taken op de werf en in Te doen).
    Config.botTasks().filter(func((k, _) : (Text, { #auto; #proposal })) : Bool = k != "vrije-taak").map<(Text, { #auto; #proposal }), TK.AssistantCard>(func((kind, _)) {
      var score : ?Nat = null;
      var cases = 0;
      var passed = false;
      for (r in proof.rounds.values()) {
        if (r.state == #closed and r.task == kind) {
          switch (Proof.latestClosed(proof, r.subject, kind)) {
            case (?l) {
              if (l.id == r.id) {
                let pc = Proof.pct(l);
                if (Proof.passed(l)) { passed := true };
                switch score { case (?s) { if (pc > s) { score := ?pc; cases := l.counted } }; case null { score := ?pc; cases := l.counted } };
              };
            };
            case null {};
          };
        };
      };
      var open = 0;
      var failed = 0;
      for (t in tasks.tasks.values()) {
        if (t.kind == kind) {
          if (not Tasks.isFinal(t.state)) { open += 1 } else if (switch (t.state) { case (#failed _) true; case _ false }) { if (now - t.updatedAt <= 30 * Config.day) { failed += 1 } };
        };
      };
      { kind; name = Todo.assistantName(Tasks.kindWord(kind)); word = Tasks.kindWord(kind); score; cases; passed; open; failed };
    });
  };
};
