// Stap 2c.8 (Werfadministratie en oplevering, ontwerp 2c §4.8 en §9 migratie 7): verzekeringen per werf (intern) met werfwaarde en
// premie apart (VERTROUWELIJK), werfvergaderingen, opleveringen en technische fiches. Alles komt als NIEUW stabiel veld `siteAdmin`
// (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {} (actiepunten en restpunten zijn gewone taken). Zelfstandig (M4): de
// types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan
// (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };

  // ── Werfadministratie en oplevering (stap 2c.8, ontwerp 2c §4.8, migratie 7) ──
  // Nieuw domein `siteAdmin`: verzekeringen per werf (intern) met werfwaarde en premie apart (VERTROUWELIJK), werfvergaderingen,
  // opleveringen en de bibliotheek van technische fiches. Actiepunten en restpunten zijn gewone taken van de planning
  // (Task.templateKey = ?"actiepunt" / ?"restpunt"): daar verandert niets aan. Types liggen vast zodra dit op een blijvende canister staat.
  type InsuranceKind = { #rc10Sub; #ba10; #abr; #other : Text };
  type InsuranceStatus = { #toDeclare; #declared : Day; #insured; #notNeeded : Text };
  // klasse: intern. Een verzekering van een werf (workId = null: de jaarpolis, in Beheer). Aangifte uiterlijk 15 dagen na de start.
  type Insurance = {
    id : Nat;
    workId : ?WorkId;
    kind : InsuranceKind;
    insurerOrgId : ?OrgId; // firma van soort "andere" met vakgebied verzekeraar (⚖10)
    brokerOrgId : ?OrgId; // idem makelaar
    policyRef : Text;
    periodFrom : ?Day;
    periodTo : ?Day;
    declareBy : ?Day; // laatst berekende uiterste aangifte (start + 15); wordt bij elke ronde en opslag herrekend zolang niet aangegeven
    status : InsuranceStatus;
    documentIds : [Nat]; // documenten van 1.1 (vragenlijst, polis, bemiddelingsfiche, vervaldagbericht, attest)
    attestDocId : ?Nat; // het attest voor de klant (een van de documenten)
    attestSharedAt : ?Int; // kantoor deelde het attest met de klant (Mijn werf)
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  // klasse: vertrouwelijk. Werfwaarde en premie. rateMilli = ‰ in duizendsten (3,04 ‰ = 3040).
  type InsuranceConf = { insuranceId : Nat; workValueCents : ?Int; rateMilli : ?Nat; minPremiumCents : ?Int; premiumNetCents : ?Int; taxesCents : ?Int; paid : Bool; extra : Extra };
  // klasse: intern. Een werfvergadering; de actiepunten zijn taken (taskIds).
  type SiteMeeting = {
    id : Nat;
    workId : WorkId;
    number : Nat; // per werf, uit settings.sequences
    day : Day;
    attendees : [Text]; // namen en firma's
    fileId : ?Nat; // het verslag van de architect
    taskIds : [Nat];
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  type HandoverKind = { #provisional; #final };
  type HandoverStatus = { #planned; #done; #withRemarks };
  // klasse: intern. Een oplevering; de restpunten zijn taken per OA (taskIds). Afgerond = het opleveringsdocument (PDF) ligt vast onder een controlecode.
  type Handover = {
    id : Nat;
    workId : WorkId;
    kind : HandoverKind;
    day : ?Day;
    status : HandoverStatus;
    attendees : [Text];
    pvFileId : ?Nat; // het PV van de architect
    taskIds : [Nat]; // restpunten
    signedFileId : ?Nat; // het getekende document
    docFileId : ?Nat; // het opleveringsdocument (PDF) voor de klant, vast bij afronden
    controlCode : ?Text; // sha-256 (hex) van dat document
    finishedAt : ?Int;
    sharedAt : ?Int; // kantoor deelde het document met de klant
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };
  // klasse: intern. Een technische fiche (bibliotheek in Beheer, per werf aan te vinken voor het PID).
  type TechSheet = { id : Nat; materialKey : Text; title : Text; fileId : Nat; supplierOrgId : ?OrgId; createdAt : Int; createdBy : PersonId; archivedAt : ?Int; extra : Extra };
  type SiteAdminState = {
    insurances : Map.Map<Nat, Insurance>;
    insuranceConf : Map.Map<Nat, Confidential<InsuranceConf>>; // vertrouwelijk; sleutel = verzekering
    meetings : Map.Map<Nat, SiteMeeting>;
    handovers : Map.Map<Nat, Handover>;
    techSheets : Map.Map<Nat, TechSheet>;
    workSheets : Map.Map<Nat, [Nat]>; // werf → fiches voor het PID
    notices : Map.Map<Text, Int>; // verstuurde meldingen (één keer per ding): sleutel → tijdstip
  };

  type OldActor = {};
  type NewActor = { siteAdmin : SiteAdminState };

  public func migration(_ : OldActor) : NewActor {
    {
      siteAdmin = {
        insurances = Map.empty();
        insuranceConf = Map.empty();
        meetings = Map.empty();
        handovers = Map.empty();
        techSheets = Map.empty();
        workSheets = Map.empty();
        notices = Map.empty();
      };
    };
  };
};
