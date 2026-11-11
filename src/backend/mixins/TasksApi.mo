// Het model van taak en voorstel lezen (stap 4b.5). Enkel de beheerder (#manageBots), zoals Beheer → Assistenten; 4b.6 en 4b.7
// openen het voor de calculator en de werfleider met de rechten van hun scherm. Een query: niets wijzigt, geen auditregel nodig
// (er staan geen bedragen en geen vrije tekst van een bot in).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";
import Types "../types";
import TK "../types/taskviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";
import Tasks "../lib/Tasks";
import Todo "../lib/Todo";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  tasks : Types.TaskStore,
  tenders : Types.TenderState,
  oaInvoices : Types.OaInvoiceState,
  quotes : Types.QuotesState,
) {

  func tkName(w : Types.TaskWho, kind : Text) : Text {
    switch w {
      case (#person id) switch (access.persons.get(id)) { case (?p) p.name; case null "" };
      case (#bot _ or #app _) Todo.assistantName(Tasks.kindWord(kind));
      case (#clock) "BOWACO";
      case (#other _) "";
    };
  };

  func tkView(t : Types.AssistTask) : TK.AssistTaskView {
    {
      id = t.id;
      key = t.key;
      kind = t.kind;
      name = Todo.assistantName(Tasks.kindWord(t.kind));
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
      case (#other _) "bot";
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
        switch (Rights.taskSight(ctx, p, tkSource(t), t.workId)) {
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
};
