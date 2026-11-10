// Te doen (stap 4b.1, bouwplan §9 fase 4b): één query voor de lijst van de beller (lib/Todo.mo) en één update om een regel uit te
// stellen tot een dag. Iedereen met een actieve login heeft een lijst; WAT erin staat beslist lib/Todo.mo per regel met de rechten van
// het scherm waar ze vandaan komt. Geen bedragen, geen uitkomst van een voorstel. Uitstel is van die persoon alleen (stabiel veld todo).
import Int "mo:core/Int";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types";
import TV "../types/todoviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Todo "../lib/Todo";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  board : Types.BoardState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  workStarts : Types.WorkStartState,
  minMeer : Types.MinMeerState,
  oaInvoices : Types.OaInvoiceState,
  purchases : Types.PurchaseState,
  oaDeals : Types.OaDealState,
  siteAdmin : Types.SiteAdminState,
  tenders : Types.TenderState,
  oaRead : Types.OaReadState,
  aiCheck : Types.AiCheckState,
  invCheck : Types.InvCheckState,
  bots : Types.BotState,
  audit : Types.AuditState,
  todo : Types.TodoState,
) {
  func tdCtx() : Todo.Ctx {
    { settings; access; org; works; plan; board; reports; permits; quotes; quoteDocs; workStarts; minMeer; oaInvoices; purchases; oaDeals; siteAdmin; tenders; oaRead; aiCheck; invCheck; bots; audit; todo };
  };
  func tdServerDay() : Nat { Int.abs(Time.now() / Config.day) };

  // De lijst van de beller. q.day = vandaag in de browser (zoals het Dashboard; een andere dag toont enkel de eigen regels anders).
  public query ({ caller }) func myTodo(q : TV.TodoQuery) : async TV.TodoPage {
    let p = Access.requireActive(access, caller);
    if (q.day < Config.minDay or q.day > Config.maxDay) { Runtime.trap("Onmogelijke datum") };
    let (items, capped) = Todo.build(tdCtx(), p, q.day, Time.now());
    Todo.page(items, capped, Todo.snoozesOf(todo, p.id), q);
  };

  // Een regel uitstellen tot `until` (morgen tot hoogstens Config.todoSnoozeMaxDays dagen), of het uitstel weghalen (null).
  public shared ({ caller }) func snoozeTodo(key : Text, until : ?Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Todo.validKey(key)) { return #err("Onbekende regel") };
    let today = tdServerDay();
    switch until {
      case (?d) { if (d <= today or d > today + Config.todoSnoozeMaxDays) { return #err("Kies een dag vanaf morgen, hoogstens een jaar vooruit") } };
      case null {};
    };
    switch (Todo.snooze(todo, p.id, key, until, today)) { case (#ok) #ok(()); case (#err e) #err(e) };
  };
};
