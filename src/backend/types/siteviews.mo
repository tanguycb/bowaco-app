// De API-vormen van de werfadministratie en oplevering (stap 2c.8, ontwerp 2c §4.8, D7). Interne rollen zien de verzekering, de
// vergadering, de oplevering en de fiches ZONDER bedrag (werfwaarde en premie staan in InsuranceConfView: enkel via een update-call
// met auditregel voor admin en calculator). De klant ziet enkel wat kantoor deelde (ClientSiteView). Een OA ziet hier niets: zijn
// actie- en restpunten zijn taken in de planning (Mijn week). Geen enkel veld met Cents buiten InsuranceConfView en het tarief.
import Types "../types";
import Views "views";

module {
  public type InsuranceDocView = { docId : Nat; kind : Text; title : Text; fileId : ?Nat; fileName : Text; status : Types.DocStatus };

  public type InsuranceView = {
    id : Nat;
    workId : ?Nat;
    workCode : Text;
    kind : Types.InsuranceKind;
    kindName : Text;
    insurerOrgId : ?Nat;
    insurerName : Text;
    brokerOrgId : ?Nat;
    brokerName : Text;
    policyRef : Text;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    startDay : ?Nat; // de start van de werf (bron van de aangifte)
    declareBy : ?Nat; // uiterlijk (start + 15 dagen), nu berekend
    declareState : Text; // "" · "ruim" · "binnenkort" (binnen 5 dagen) · "vandaag" · "te-laat"
    status : Types.InsuranceStatus;
    documents : [InsuranceDocView];
    attestDocId : ?Nat;
    attestShared : Bool;
    note : Text;
    archived : Bool;
    canEdit : Bool;
    canSeeCosts : Bool;
  };

  public type InsuranceInput = {
    id : ?Nat;
    workId : ?Nat; // null = de jaarpolis (Beheer)
    kind : Types.InsuranceKind;
    insurerOrgId : ?Nat;
    brokerOrgId : ?Nat;
    policyRef : Text;
    periodFrom : ?Nat;
    periodTo : ?Nat;
    status : Types.InsuranceStatus;
    note : Text;
  };

  // vertrouwelijk (enkel uit een update-call): werfwaarde en premie
  public type InsuranceConfView = {
    insuranceId : Nat;
    workValueCents : ?Int;
    rateMilli : ?Nat;
    minPremiumCents : ?Int;
    premiumNetCents : ?Int;
    taxesCents : ?Int;
    paid : Bool;
    defaultRateMilli : Nat; // het tarief uit de instellingen voor deze soort
    defaultMinCents : Int;
  };
  public type InsuranceConfInput = { workValueCents : ?Int; rateMilli : ?Nat; minPremiumCents : ?Int; taxesCents : ?Int; paid : Bool };

  public type PointView = { taskId : Nat; title : Text; orgId : ?Nat; orgName : Text; day : Nat; done : Bool; inTeam : Bool };
  public type PointInput = { title : Text; orgId : ?Nat; day : Nat };

  public type MeetingView = {
    id : Nat;
    workId : Nat;
    number : Nat;
    day : Nat;
    attendees : [Text];
    fileId : ?Nat;
    fileName : Text;
    points : [PointView];
    note : Text;
    archived : Bool;
  };
  public type MeetingInput = { id : ?Nat; day : Nat; attendees : [Text]; fileId : ?Nat; note : Text; addPoints : [PointInput] };

  public type HandoverView = {
    id : Nat;
    workId : Nat;
    kind : Types.HandoverKind;
    day : ?Nat;
    status : Types.HandoverStatus;
    attendees : [Text];
    pvFileId : ?Nat;
    pvFileName : Text;
    signedFileId : ?Nat;
    signedFileName : Text;
    docFileId : ?Nat;
    controlCode : ?Text;
    finishedAt : ?Int;
    isShared : Bool;
    points : [PointView];
    openPoints : Nat;
    note : Text;
    archived : Bool;
  };
  public type HandoverInput = { id : ?Nat; kind : Types.HandoverKind; day : ?Nat; attendees : [Text]; pvFileId : ?Nat; signedFileId : ?Nat; note : Text; addPoints : [PointInput] };

  // De gegevens voor het opleveringsdocument (PDF in de browser): zonder aankoopprijzen of marges.
  public type HandoverDocData = {
    handoverId : Nat;
    kind : Types.HandoverKind;
    workCode : Text;
    workName : Text;
    address : Text;
    clientName : Text;
    architectName : Text;
    day : ?Nat;
    attendees : [Text];
    points : [PointView];
    note : Text;
    previousControlCode : ?Text;
  };

  public type TechSheetView = { id : Nat; materialKey : Text; title : Text; fileId : Nat; fileName : Text; supplierOrgId : ?Nat; supplierName : Text; archived : Bool };
  public type TechSheetInput = { id : ?Nat; materialKey : Text; title : Text; fileId : Nat; supplierOrgId : ?Nat };

  public type SiteAdminSettings = { codeP : Bool; rates : [(Text, Nat, Int)]; nextCode : Text };
  public type SiteAdminSettingsInput = { codeP : Bool; rates : [(Text, Nat, Int)] };

  // Wat de klant in Mijn werf ziet: het gedeelde attest en het gedeelde opleveringsdocument (met de controlecode).
  public type ClientAttest = { kindName : Text; periodFrom : ?Nat; periodTo : ?Nat; sharedAt : Int; file : Views.FileView };
  public type ClientHandover = { kind : Types.HandoverKind; day : ?Nat; status : Types.HandoverStatus; controlCode : Text; file : Views.FileView };
  public type ClientSiteView = { workId : Nat; attests : [ClientAttest]; handovers : [ClientHandover] };

  public type SaveResult = { id : Nat; warnings : [Text] };
}
