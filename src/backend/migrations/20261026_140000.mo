// Stap 2.11 (OA-facturen registreren en controleren): de facturen van onderaannemers (zonder bedragen), hun bedragen en regels
// (vertrouwelijk), en de indexen (firma + nummer, per werf). Alles komt als NIEUW stabiel veld `oaInvoices` (deelvorm, M4).
// Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer
// wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type WithholdingResult = { #clear; #social; #fiscal; #both; #unknown };
  type OaVatRegime = { #reverse; #normal : Nat };
  type OaInvoiceStatus = { #registered; #approved; #disputed; #withdrawn };
  type OaInvoiceLineKind = { #post; #regie; #other };
  type OaWithholdingProof = { #check : { checkId : Nat; result : WithholdingResult; reference : Text; consultedOn : Day }; #exception : Text };
  type OaInvoiceDecision = { at : Int; by : PersonId; approved : Bool; reason : Text; withholding : ?OaWithholdingProof; flags : Nat };
  type OaInvoice = {
    id : Nat;
    orgId : OrgId;
    workId : WorkId;
    number : Text;
    invoiceDay : Day;
    dueDay : ?Day;
    periodFrom : ?Day;
    periodTo : ?Day;
    vatRegime : OaVatRegime;
    reverseMention : Bool;
    fileId : ?Nat;
    status : OaInvoiceStatus;
    decision : ?OaInvoiceDecision;
    note : Text;
    source : Text;
    externalRef : Text;
    rev : Nat;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };
  type OaInvoiceLine = { kind : OaInvoiceLineKind; root : ?Nat; description : Text; qtyMilli : Int; unitCents : Int; amountCents : Int };
  type OaInvoiceAmounts = { invoiceId : Nat; netCents : Int; vatCents : Int; totalCents : Int; lines : [OaInvoiceLine]; extra : Extra };
  type OaInvoiceState = {
    invoices : Map.Map<Nat, OaInvoice>;
    amounts : Map.Map<Nat, Confidential<OaInvoiceAmounts>>;
    keys : Map.Map<Text, Nat>;
    byWork : Map.Map<Nat, [Nat]>;
  };

  type OldActor = {};
  type NewActor = { oaInvoices : OaInvoiceState };

  public func migration(_ : OldActor) : NewActor {
    { oaInvoices = { invoices = Map.empty(); amounts = Map.empty(); keys = Map.empty(); byWork = Map.empty() } };
  };
};
