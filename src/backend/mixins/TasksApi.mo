// Het model van taak en voorstel lezen (stap 4b.5). Enkel de beheerder (#manageBots), zoals Beheer → Assistenten; 4b.6 en 4b.7
// openen het voor de calculator en de werfleider met de rechten van hun scherm. Een query: niets wijzigt, geen auditregel nodig
// (er staan geen bedragen en geen vrije tekst van een bot in).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
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
          points = p.points.map(func(x : Types.TaskPoint) : TK.AssistPointView = { key = x.key; now = if (x.secret) "" else x.now; after = if (x.secret) "" else x.after; source = Tasks.refKey(x.source); secret = x.secret });
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
};
