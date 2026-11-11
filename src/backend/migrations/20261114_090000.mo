// Stap 4b.5 (één model voor taak en voorstel, bouwplan §9 fase 4b): de taken van de assistenten en hun voorstellen. Alles als NIEUW
// stabiel veld `tasks` (deelvorm, M4): niets bestaands wordt verbreed of gelezen, OldActor = {}. De taken van vóór 4b.5 komen er
// NIET via deze migratie in, maar via Tasks.sync bij de installatie en elke upgrade (main.mo): de velden oaRead, aiCheck, invCheck
// en bots blijven ongewijzigd staan (ze zijn het dossier van elke taak). De types staan hier letterlijk. NOOIT meer wijzigen zodra
// deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type TaskWho = { #person : PersonId; #bot : Nat; #app : Text; #clock; #other : Text };
  type TaskSrc = { #oaRead : Nat; #aiCheck : Nat; #invCheck : Nat; #botAction : Nat; #other : Text };
  type TaskRef = { #file : Nat; #doc : Nat; #tender : Nat; #quote : Nat; #oaQuote : Nat; #oaInvoice : Nat; #org : Nat; #none; #other : Text };
  type TaskState = { #waiting; #busy; #ready; #done; #failed : Text; #cancelled; #other : Text };
  type ProposalState = { #open; #accepted; #adjusted; #rejected; #auto; #undone; #expired; #withdrawn; #other : Text };
  type TaskUndo = { #none; #possible : Text; #done : Int; #other : Text };
  type TaskPoint = { key : Text; now : Text; after : Text; source : TaskRef; secret : Bool; extra : Extra };
  type TaskEvent = { at : Int; who : TaskWho; what : Text; extra : Extra };
  type TaskProposal = {
    id : Nat;
    taskId : Nat;
    by : TaskWho;
    at : Int;
    auto : Bool;
    var confidence : ?Nat;
    var points : [TaskPoint];
    var actionId : ?Nat;
    var state : ProposalState;
    var decidedBy : ?TaskWho;
    var decidedAt : ?Int;
    var undo : TaskUndo;
    var extra : Extra;
  };
  type AssistTask = {
    id : Nat;
    key : Text;
    kind : Text;
    src : TaskSrc;
    workId : ?WorkId;
    subject : TaskRef;
    givenBy : TaskWho;
    doer : TaskWho;
    createdAt : Int;
    var state : TaskState;
    var updatedAt : Int;
    var proposalId : ?Nat;
    var events : [TaskEvent];
    var extra : Extra;
  };
  type TaskStore = {
    tasks : Map.Map<Nat, AssistTask>;
    byKey : Map.Map<Text, Nat>;
    byWork : Map.Map<Nat, [Nat]>;
    proposals : Map.Map<Nat, TaskProposal>;
    var next : Nat;
    extra : Map.Map<Text, Text>;
  };

  public func migration(_ : {}) : { tasks : TaskStore } {
    {
      tasks = {
        tasks = Map.empty<Nat, AssistTask>();
        byKey = Map.empty<Text, Nat>();
        byWork = Map.empty<Nat, [Nat]>();
        proposals = Map.empty<Nat, TaskProposal>();
        var next = 0;
        extra = Map.empty<Text, Text>();
      };
    };
  };
};
