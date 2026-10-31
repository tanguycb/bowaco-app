// De API-vormen van de afspraken met de gekozen OA (stap 2c.4, ontwerp 2c §4.4, D7). Drie soorten, elk met een eigen type zodat de
// .did-controle (tests/afspraak-2c4.mjs) mechanisch kan nakijken wat wie krijgt:
// · ZONDER bedragen: `DealStatusView` (werfleider van de werf en de lijsten: afspraak ja/nee, contractstatus, attesten),
//   `AttestStateView`, `OrgDocView` (attesten op de firmafiche), `MyContractBrief` en `MyAttestView` (de OA, enkel zijn firma).
// · MET bedragen (admin, calculator; enkel via update-calls met auditregel, R23/G3): `OaRateView`, `DealFullView`.
// · Het contract zelf (`OaContractView`): kantoor, en de OA voor zijn EIGEN contract (zijn eigen prijzen, nooit die van een ander).
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";

module {
  type Day = Types.Day;

  // ── Zonder bedragen ──────────────────────────────────────────────────────
  public type AttestStateView = { kind : Text; name : Text; required : Bool; state : Text; validUntil : ?Day };
  public type DealStatusView = {
    id : Nat;
    workId : Nat;
    orgId : Nat;
    orgName : Text;
    status : Text; // "ontwerp" · "te tekenen" · "getekend" · "beëindigd"
    contractVersion : Nat;
    contractHash : Text;
    startDay : ?Day;
    posts : Nat;
    oaQuotes : Nat;
    attests : [AttestStateView];
    rev : Nat;
  };
  public type OrgDocKindView = { key : Text; name : Text; required : Bool };
  public type OrgDocView = {
    id : Nat;
    orgId : Nat;
    kind : Text;
    kindName : Text;
    title : Text;
    validFrom : ?Day;
    validUntil : ?Day;
    status : Types.DocStatus;
    hasFile : Bool;
    deliveredByName : Text;
    checkedByName : Text;
    checkedAt : ?Int;
    note : Text;
    createdAt : Int;
  };
  public type OrgDocsView = { kinds : [OrgDocKindView]; states : [AttestStateView]; docs : [OrgDocView]; mayReview : Bool };
  public type MyContractBrief = {
    ref : Text;
    workAddress : Text;
    status : Text;
    contractVersion : Nat;
    versions : [Nat];
    signed : Bool;
  };
  public type MyAttestView = { ref : Text; kind : Text; kindName : Text; title : Text; validFrom : ?Day; validUntil : ?Day; status : Types.DocStatus; note : Text; createdAt : Int };
  public type MyAttestsView = { kinds : [OrgDocKindView]; states : [AttestStateView]; docs : [MyAttestView] };
  public type MyFileOpen = { name : Text; mime : Text; size : Nat; blob : Storage.ExternalBlob }; // zonder id
  public type RateKindView = { key : Text; name : Text; unit : Text };
  public type DealSetup = { rateKinds : [RateKindView]; sources : [(Text, Text)]; docKinds : [OrgDocKindView]; maxAdvanceBp : Nat };

  // ── Met bedragen (enkel admin en calculator, update-calls met auditregel) ─
  public type OaRateView = {
    id : Nat;
    orgId : Nat;
    kind : Text;
    kindName : Text;
    unit : Text;
    cents : Int;
    validFrom : Day;
    source : Text;
    ref : Text;
    fileId : ?Nat;
    note : Text;
    createdAt : Int;
    createdByName : Text;
    archivedAt : ?Int;
    archiveReason : Text;
  };
  public type AgreedRateView = { kind : Text; kindName : Text; unit : Text; cents : Int; validFrom : Day; fromRateId : ?Nat; note : Text };
  public type DealPriceView = { root : Nat; title : Text; unit : Text; qtyMilli : Int; cents : ?Int };
  public type ContractVersionBrief = { version : Nat; hash : Text; at : Int; byName : Text; signedAt : ?Int };
  public type DealFullView = {
    deal : DealStatusView;
    prices : [DealPriceView];
    rates : [AgreedRateView];
    firmRatesNow : [AgreedRateView]; // wat de firma vandaag vraagt (ter vergelijking; de werf houdt haar tarief, ⚖9)
    amountCents : ?Int;
    advanceBp : Nat;
    advanceCents : ?Int;
    paymentDays : Nat;
    endOfMonth : Bool;
    oaQuotes : [(Nat, Text)];
    versions : [ContractVersionBrief];
    warnings : [Text];
  };
  public type OaContractView = {
    version : Nat;
    templateVersion : Nat;
    title : Text;
    text : Text;
    fields : [(Text, Text)];
    posts : [Types.FrozenPost];
    rates : [AgreedRateView];
    totalCents : ?Int;
    advanceBp : Nat;
    advanceCents : ?Int;
    hash : Text;
    at : Int;
    signedAt : ?Int;
    provisional : Bool;
  };
  public type ContractTemplateView = { id : Nat; version : Nat; title : Text; text : Text; provisional : Bool; note : Text; createdAt : Int; createdByName : Text; archived : Bool };

  // ── Invoer ───────────────────────────────────────────────────────────────
  public type OaRateInput = { orgId : Nat; kind : Text; unit : Text; cents : Int; validFrom : Day; source : Text; ref : Text; fileId : ?Nat; note : Text };
  public type DealRateInput = { kind : Text; unit : Text; cents : Int; validFrom : Day; fromRateId : ?Nat; note : Text };
  public type DealTermsInput = { advanceBp : Nat; paymentDays : Nat; endOfMonth : Bool };
  public type OrgDocInput = { orgId : Nat; kind : Text; title : Text; fileId : ?Nat; validFrom : ?Day; validUntil : ?Day; note : Text };
  public type DealFilePurpose = { #rate : Nat; #signed : Nat; #orgDoc : Nat }; // firma · afspraak · firma
};
