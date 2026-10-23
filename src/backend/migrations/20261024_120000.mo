// Stap 1.6 (mobiel werfverslag): dagverslagen, hun blokken en de index van offline-opdrachten als NIEUW
// stabiel veld `reports` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];

  type ReportStatus = {
    #draft;
    #final : { at : Int; by : PersonId };
    #corrected : { byReportId : Nat; at : Int };
  };

  type DayReport = {
    id : Nat;
    workId : WorkId;
    day : Day;
    authorPersonId : PersonId;
    clientKey : Text;
    status : ReportStatus;
    corrects : ?Nat;
    summary : Text;
    weather : Text;
    createdAt : Int;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type TimeSlot = { fromMin : Nat; toMin : Nat };

  type Attendance = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    day : Day;
    orgId : ?OrgId;
    personId : ?PersonId;
    names : Text;
    headcount : Nat;
    slots : [TimeSlot];
    minutesTotal : Nat;
    regie : Bool;
    taskId : ?Nat;
    note : Text;
    blockKey : Text;
    replacedBy : ?Nat;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    extra : Extra;
  };

  type HoursConfirmation = { id : Nat; attendanceId : Nat; orgId : OrgId; by : PersonId; at : Int; ok : Bool; remark : Text };

  type WorkDone = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    taskId : ?Nat;
    text : Text;
    percent : ?Nat;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type MaterialKind = { #receipt; #fromWarehouse; #smallMaterial; #equipment; #wasteToWarehouse; #returned; #delivered };

  type MaterialNote = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    kind : MaterialKind;
    text : Text;
    quantity : Text;
    supplier : Text;
    fileId : ?Nat;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type Photo = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    fileId : Nat;
    thumbFileId : ?Nat;
    taskId : ?Nat;
    caption : Text;
    takenAt : ?Int;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type IssueKind = { #problem; #delay; #extraWorkProposal; #safety; #other };
  type IssueStatus = { #open; #handled : { by : PersonId; at : Int; note : Text } };

  type Issue = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    kind : IssueKind;
    text : Text;
    taskIds : [Nat];
    delayDays : ?Nat;
    status : IssueStatus;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type Trip = {
    id : Nat;
    reportId : Nat;
    workId : WorkId;
    day : Day;
    vehicleId : ?Nat;
    plate : Text;
    driverOutPersonId : ?PersonId;
    driverBackPersonId : ?PersonId;
    driverOutText : Text;
    driverBackText : Text;
    note : Text;
    blockKey : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type ReportChange = { id : Nat; reportId : Nat; at : Int; by : PersonId; field : Text; from : Text; to : Text };

  type ReportBlocks = {
    attendances : [Nat];
    workDone : [Nat];
    materials : [Nat];
    photos : [Nat];
    issues : [Nat];
    trips : [Nat];
  };

  type OpRecord = { opId : Text; seq : Nat; at : Int; by : PersonId; kind : Text; reportId : Nat; entityId : ?Nat; note : Text };

  type ReportState = {
    reports : Map.Map<Nat, DayReport>;
    keys : Map.Map<Text, Nat>;
    dayIndex : Map.Map<Text, [Nat]>;
    blocks : Map.Map<Nat, ReportBlocks>;
    changes : Map.Map<Nat, ReportChange>;
    attendances : Map.Map<Nat, Attendance>;
    confirmations : Map.Map<Nat, [HoursConfirmation]>;
    workDone : Map.Map<Nat, WorkDone>;
    materials : Map.Map<Nat, MaterialNote>;
    photos : Map.Map<Nat, Photo>;
    issues : Map.Map<Nat, Issue>;
    trips : Map.Map<Nat, Trip>;
    fileOwners : Map.Map<Nat, Nat>;
    ops : Map.Map<Text, OpRecord>;
    opOrder : Map.Map<Nat, Text>;
  };

  type OldActor = {};
  type NewActor = { reports : ReportState };

  public func migration(_ : OldActor) : NewActor {
    {
      reports = {
        reports = Map.empty();
        keys = Map.empty();
        dayIndex = Map.empty();
        blocks = Map.empty();
        changes = Map.empty();
        attendances = Map.empty();
        confirmations = Map.empty();
        workDone = Map.empty();
        materials = Map.empty();
        photos = Map.empty();
        issues = Map.empty();
        trips = Map.empty();
        fileOwners = Map.empty();
        ops = Map.empty();
        opOrder = Map.empty();
      };
    };
  };
};
