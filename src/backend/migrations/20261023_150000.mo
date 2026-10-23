// Stap 1.1 (klanten en werven): het werfdossier als NIEUW stabiel veld `dossier` (architectuur §2.4,
// §2.7; deelvorm, M4). Alle andere velden blijven ongemoeid: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Extra = [(Text, Text)];
  type Day = Nat;

  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type Contact = { name : Text; phone : ?Text; email : ?Text; address : ?Address };

  type PriceRevision = { #none; #formula : Text };
  type GuaranteeKind = { #none; #retention; #bankGuarantee };
  type InvoicingRhythm = { #monthly; #perPhase; #perProgress; #other : Text };

  type ContractParams = {
    estimatedAmountCents : ?Int;
    priceRevision : PriceRevision;
    guarantee : GuaranteeKind;
    guaranteeBp : Nat;
    paymentTermDays : Nat;
    invoicingRhythm : InvoicingRhythm;
    signedQuoteVersionId : ?Nat;
    note : Text;
  };

  type WorkConfidential = {
    workId : WorkId;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>;
    notes : Confidential<Text>;
    version : Nat;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type WorkConfidentialVersion = {
    id : Nat;
    workId : WorkId;
    version : Nat;
    contract : Confidential<ContractParams>;
    clientContact : Confidential<Contact>;
    notes : Confidential<Text>;
    at : Int;
    by : PersonId;
  };

  type WorkInfo = {
    workId : WorkId;
    analyticCode : ?Text;
    vatNote : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type DocStatus = { #missing; #requested; #received; #approved; #expired; #notApplicable };

  type Document = {
    id : Nat;
    workId : WorkId;
    kind : Text;
    title : Text;
    fileIds : [Nat];
    status : DocStatus;
    dueDay : ?Day;
    validUntil : ?Day;
    note : Text;
    ownerOrgId : ?OrgId;
    confidential : Bool;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type DossierState = {
    info : Map.Map<WorkId, WorkInfo>;
    confidential : Map.Map<WorkId, WorkConfidential>;
    confidentialHistory : Map.Map<Nat, WorkConfidentialVersion>;
    documents : Map.Map<Nat, Document>;
  };

  type OldActor = {};
  type NewActor = { dossier : DossierState };

  public func migration(_ : OldActor) : NewActor {
    {
      dossier = {
        info = Map.empty();
        confidential = Map.empty();
        confidentialHistory = Map.empty();
        documents = Map.empty();
      };
    };
  };
};
