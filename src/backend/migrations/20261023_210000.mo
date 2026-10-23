// Stap 1.3 (planning per werf): taken, toewijzingen, afhankelijkheden, kalenderblokken, wijzigingen,
// sjablonen en planversies als NIEUW stabiel veld `plan` (architectuur §2.5; deelvorm, M4).
// Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type TaskStatus = { #planned; #busy; #delayed; #done; #blocked };
  type TaskKind = { #work; #milestone; #delivery };

  type Task = {
    id : Nat;
    workId : WorkId;
    title : Text;
    note : Text;
    kind : TaskKind;
    templateKey : ?Text;
    trade : ?Text;
    responsibleOrgId : ?OrgId;
    status : TaskStatus;
    percent : Nat;
    start : Day;
    workdays : Nat;
    leadDays : Nat;
    orderDay : ?Day;
    actualStart : ?Day;
    actualEnd : ?Day;
    order : Nat;
    quoteLineIds : [Nat];
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type Confirmation = {
    #open;
    #confirmed : { by : PersonId; at : Int };
    #declined : { by : PersonId; at : Int; reason : Text };
  };

  type Assignment = {
    id : Nat;
    taskId : Nat;
    workId : WorkId;
    orgId : OrgId;
    personId : ?PersonId;
    fromDay : ?Day;
    toDay : ?Day;
    note : Text;
    primary : Bool;
    confirmation : Confirmation;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    archivedAt : ?Int;
    extra : Extra;
  };

  type DependencyKind = { #finishToStart; #startToStart };

  type Dependency = {
    id : Nat;
    workId : WorkId;
    fromTaskId : Nat;
    toTaskId : Nat;
    kind : DependencyKind;
    lagDays : Int;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
  };

  type BlockScope = { #company; #work : WorkId; #org : OrgId };
  type BlockKind = { #bouwverlof; #feestdag; #stop; #verlof; #other };

  type CalendarBlock = {
    id : Nat;
    scope : BlockScope;
    kind : BlockKind;
    from : Day;
    to : Day;
    reason : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type TaskChange = {
    id : Nat;
    taskId : Nat;
    workId : WorkId;
    at : Int;
    by : PersonId;
    field : Text;
    from : Text;
    to : Text;
    reason : Text;
  };

  type TemplateStep = {
    key : Text;
    title : Text;
    trade : ?Text;
    kind : TaskKind;
    workdays : Nat;
    leadDays : Nat;
    after : [Text];
    lagDays : Nat;
    note : Text;
  };

  type Template = {
    key : Text;
    name : Text;
    steps : [TemplateStep];
    provisional : Bool;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type PlanState = {
    tasks : Map.Map<Nat, Task>;
    assignments : Map.Map<Nat, Assignment>;
    dependencies : Map.Map<Nat, Dependency>;
    calendarBlocks : Map.Map<Nat, CalendarBlock>;
    taskChanges : Map.Map<Nat, TaskChange>;
    templates : Map.Map<Text, Template>;
    versions : Map.Map<WorkId, Nat>;
  };

  type OldActor = {};
  type NewActor = { plan : PlanState };

  public func migration(_ : OldActor) : NewActor {
    {
      plan = {
        tasks = Map.empty();
        assignments = Map.empty();
        dependencies = Map.empty();
        calendarBlocks = Map.empty();
        taskChanges = Map.empty();
        templates = Map.empty();
        versions = Map.empty();
      };
    };
  };
};
