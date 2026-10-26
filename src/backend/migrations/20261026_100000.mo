// Stap 2.10 (vorderingsstaten): de staten per werf (ontwerp → verzonden, creditnota), de invoer per post (% en hoeveelheden),
// de vertrouwelijke indexwaarden en vastgelegde bedragen bij het versturen, het rekenmodel van de prijsherziening per werf en
// het antwoord van de klant. Alles komt als NIEUW stabiel veld `progress` (deelvorm, M4). Niets bestaands wordt verbreed:
// OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op
// een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type GuaranteeKind = { #none; #retention; #bankGuarantee };
  type ProgressKind = { #statement; #credit };
  type ProgressStatus = { #draft; #sent; #cancelled };
  type ProgressBilling = { #open; #ready : { at : Int; by : PersonId }; #invoiced : { at : Int; by : ?PersonId; ref : Text } };
  type ProgressSection = { #contract; #extra; #less; #regie };
  type ProgressBasis = { #percent; #quantity; #hours };
  type ProgressInput = { root : Nat; cumPctBp : ?Nat; cumQtyMilli : ?Int; note : Text; at : Int; by : PersonId };
  type ProgressStatement = {
    id : Nat;
    workId : WorkId;
    kind : ProgressKind;
    number : Nat;
    code : Text;
    credits : ?Nat;
    creditedBy : ?Nat;
    periodFrom : Day;
    periodTo : Day;
    status : ProgressStatus;
    billing : ProgressBilling;
    prepared : ?{ by : PersonId; at : Int };
    note : Text;
    rev : Nat;
    calcVersion : Nat;
    sentAt : ?Int;
    sentBy : ?PersonId;
    hash : Text;
    cancelReason : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type ProgressConf = { statementId : Nat; sIndex : Confidential<?Nat>; iIndex : Confidential<?Nat>; reason : Confidential<Text>; extra : Extra };
  type RevisionModel = { aBp : Nat; bBp : Nat; cBp : Nat; sBase : Nat; iBase : Nat; sLabel : Text; iLabel : Text; note : Text };
  type ProgressRevision = { workId : WorkId; model : Confidential<RevisionModel>; version : Nat; at : Int; by : PersonId; extra : Extra };
  type ProgressLineFrozen = {
    root : Nat;
    lineId : Nat;
    versionId : Nat;
    quoteNumber : Text;
    section : ProgressSection;
    basis : ProgressBasis;
    chapter : Text;
    code : Text;
    title : Text;
    unit : Text;
    offerQtyMilli : Int;
    unitPriceCents : Int;
    offerCents : Int;
    prevPctBp : Nat;
    prevQtyMilli : Int;
    prevCents : Int;
    cumPctBp : Nat;
    cumQtyMilli : Int;
    cumCents : Int;
    periodCents : Int;
    note : Text;
  };
  type ProgressSectionTotals = { section : ProgressSection; offerCents : Int; prevCents : Int; cumCents : Int; periodCents : Int };
  type ProgressTotals = {
    sections : [ProgressSectionTotals];
    offerCents : Int;
    prevCents : Int;
    cumCents : Int;
    periodCents : Int;
    restCents : Int;
    overVhCents : Int;
    revisionBaseCents : Int;
    revisionCents : Int;
    subtotalCents : Int;
    vatBp : Nat;
    vatCents : Int;
    totalCents : Int;
    retentionBp : Nat;
    retentionCents : Int;
    payableCents : Int;
  };
  type ProgressRevisionFrozen = { formula : Text; aBp : Nat; bBp : Nat; cBp : Nat; sBase : Nat; iBase : Nat; sIndex : Nat; iIndex : Nat; sLabel : Text; iLabel : Text };
  type ProgressFrozen = {
    statementId : Nat;
    issuer : Text;
    clientName : Text;
    clientAddress : ?Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    analyticCode : Text;
    vatNote : Text;
    quoteRefs : [Text];
    sendDay : Day;
    dueDay : Day;
    paymentDays : Nat;
    guarantee : GuaranteeKind;
    retentionOnIncl : Bool;
    revision : ?ProgressRevisionFrozen;
    lines : [ProgressLineFrozen];
    totals : ProgressTotals;
    extra : Extra;
  };
  type ProgressAnswer = { statementId : Nat; hash : Text; ok : Bool; note : Text; at : Int; personId : PersonId; principal : Principal; extra : Extra };
  type ProgressState = {
    statements : Map.Map<Nat, ProgressStatement>;
    byWork : Map.Map<Nat, [Nat]>;
    inputs : Map.Map<Nat, [ProgressInput]>;
    conf : Map.Map<Nat, ProgressConf>;
    frozen : Map.Map<Nat, Confidential<ProgressFrozen>>;
    revisions : Map.Map<Nat, ProgressRevision>;
    answers : Map.Map<Nat, ProgressAnswer>;
  };

  type OldActor = {};
  type NewActor = { progress : ProgressState };

  public func migration(_ : OldActor) : NewActor {
    {
      progress = {
        statements = Map.empty();
        byWork = Map.empty();
        inputs = Map.empty();
        conf = Map.empty();
        frozen = Map.empty();
        revisions = Map.empty();
        answers = Map.empty();
      };
    };
  };
};
