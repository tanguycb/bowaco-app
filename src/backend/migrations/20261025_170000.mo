// Stap 2.7 (PDF, voorwaarden en digitaal akkoord): de algemene voorwaarden met versies, wat bij het versturen vastligt
// naast de inhoud van de offerte (afzender, klant, werf, btw-grond, betaaltermijn, geldigheid, tekst van de voorwaarden) en
// het akkoord van de klant of het getekende bewijs. Alles komt als NIEUW stabiel veld `quoteDocs` (deelvorm, M4). Niets
// bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer
// wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };

  type QuoteTerms = {
    id : Nat;
    version : Nat;
    title : Text;
    text : Text;
    provisional : Bool;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    archivedAt : ?Int;
    extra : Extra;
  };

  type QuoteSendInfo = {
    versionId : Nat;
    issuer : Text;
    clientName : Text;
    clientAddress : ?Address;
    clientVat : ?Text;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    vatNote : Text;
    paymentDays : Nat;
    validUntil : Day;
    termsId : Nat;
    termsVersion : Nat;
    termsTitle : Text;
    termsText : Text;
    termsProvisional : Bool;
    extra : Extra;
  };

  type QuoteDigitalAccept = { at : Int; personId : PersonId; principal : Principal };
  type QuoteSignedProof = { at : Int; by : PersonId; fileId : Nat; note : Text };
  type QuoteAcceptance = { versionId : Nat; hash : Text; digital : ?QuoteDigitalAccept; signed : ?QuoteSignedProof; extra : Extra };

  type QuoteDocsState = {
    terms : Map.Map<Nat, QuoteTerms>;
    sendInfo : Map.Map<Nat, QuoteSendInfo>;
    acceptances : Map.Map<Nat, QuoteAcceptance>;
  };

  type OldActor = {};
  type NewActor = { quoteDocs : QuoteDocsState };

  public func migration(_ : OldActor) : NewActor {
    { quoteDocs = { terms = Map.empty(); sendInfo = Map.empty(); acceptances = Map.empty() } };
  };
};
