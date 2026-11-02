// Stap 2c.6 (verkoopfacturen, ontwerp 2c §4.6, §7 en §9 migratie 5): per werf het facturatieschema (schijven in %, per hoofdstuk), de
// facturen en creditnota's (intern, zonder bedragen), hun regels zolang ze een ontwerp zijn (VERTROUWELIJK), wat bij het uitreiken
// vastligt (de wettelijke inhoud, VERTROUWELIJK), de betalingen (VERTROUWELIJK), de herinneringen, en de indexen (nummer → factuur,
// laatste factuurdatum per reeks). De tellers zelf staan in settings.sequences ("factuur:F:<jaar>", "factuur:CN:<jaar>"): geen veld.
// Alles komt als NIEUW stabiel veld `sales` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}. Zelfstandig (M4): de types
// staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type SalesKind = { #advance; #interim; #final; #progress : Nat; #minMeer : Nat; #free; #credit : Nat };
  type SalesStatus = { #draft; #issued; #draftCancelled : Text };
  type SalesPay = { #open; #partial; #paid };
  type SalesVat = { #rate : Nat; #reverse; #mixed };
  type SalesPeppol = { #notNeeded; #ublMade : Int; #sent : { at : Int; ref : Text } };
  type SalesSent = { at : Int; by : PersonId; how : Text };
  type SalesInvoice = {
    id : Nat;
    workId : WorkId;
    kind : SalesKind;
    series : Text;
    year : Nat;
    seq : Nat;
    number : Text;
    status : SalesStatus;
    pay : SalesPay;
    issueDay : ?Day;
    serviceDay : ?Day;
    serviceTo : ?Day;
    dueDay : ?Day;
    paymentDays : Nat;
    clientOrgId : ?OrgId;
    vat : SalesVat;
    planStepKey : ?Text;
    peppol : SalesPeppol;
    sent : ?SalesSent;
    title : Text;
    hash : Text;
    calcVersion : Nat;
    rev : Nat;
    note : Text;
    createdAt : Int;
    createdBy : PersonId;
    updatedAt : Int;
    updatedBy : PersonId;
    issuedAt : ?Int;
    issuedBy : ?PersonId;
    extra : Extra;
  };
  type SalesLineKind = { #work; #revision; #deduct };
  type SalesLine = {
    kind : SalesLineKind;
    group : Text;
    description : Text;
    ref : Text;
    qtyMilli : Int;
    unit : Text;
    unitCents : Int;
    amountCents : Int;
    vatBp : Nat;
    baseCents : ?Int;
    pctBp : ?Nat;
  };
  type SalesIssuer = { name : Text; legalForm : Text; address : Address; vat : Text; kbo : Text; rpr : Text; email : Text; phone : Text; website : Text; iban : Text; bic : Text };
  type SalesBuyer = { orgId : ?OrgId; name : Text; address : ?Address; vat : ?Text; kbo : ?Text; company : Bool };
  type SalesPrevious = { invoiceId : Nat; number : Text; day : Day; cents : Int; revisionCents : Int };
  type SalesVatLine = { vatBp : Nat; reverse : Bool; baseCents : Int; vatCents : Int };
  type SalesFrozen = {
    invoiceId : Nat;
    number : Text;
    kindText : Text;
    issueDay : Day;
    serviceDay : ?Day;
    serviceTo : ?Day;
    dueDay : Day;
    paymentDays : Nat;
    issuer : SalesIssuer;
    buyer : SalesBuyer;
    workCode : Text;
    workName : Text;
    workAddress : Address;
    analyticCode : Text;
    quoteRefs : [Text];
    title : Text;
    lines : [SalesLine];
    previous : [SalesPrevious];
    vatLines : [SalesVatLine];
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    retentionCents : Int;
    mentions : [Text];
    paymentRef : Text;
    creditOf : ?Text;
    creditOfDay : ?Day;
    note : Text;
    calcVersion : Nat;
    extra : Extra;
  };
  type BillingWhen = { #beforeStart; #onDay : Day; #byHand; #final };
  type BillingChapterPct = { chapter : Text; pctBp : Nat };
  type BillingStep = { key : Text; title : Text; pctBp : Nat; when : BillingWhen; chapterPct : [BillingChapterPct]; quoteIds : [Nat] };
  type BillingPlan = { workId : WorkId; steps : [BillingStep]; version : Nat; updatedAt : Int; updatedBy : PersonId; extra : Extra };
  type SalesPayment = {
    id : Nat;
    invoiceId : Nat;
    day : Day;
    cents : Int;
    how : Text;
    note : Text;
    at : Int;
    by : PersonId;
    archivedAt : ?Int;
    archivedBy : ?PersonId;
    archiveReason : Text;
  };
  type SalesReminder = { id : Nat; invoiceId : Nat; level : Nat; day : Day; mailed : Bool; jobId : ?Nat; note : Text; at : Int; by : PersonId; extra : Extra };
  type SalesState = {
    invoices : Map.Map<Nat, SalesInvoice>;
    drafts : Map.Map<Nat, Confidential<[SalesLine]>>;
    frozen : Map.Map<Nat, Confidential<SalesFrozen>>;
    plans : Map.Map<Nat, BillingPlan>;
    payments : Map.Map<Nat, Confidential<SalesPayment>>;
    reminders : Map.Map<Nat, SalesReminder>;
    byWork : Map.Map<Nat, [Nat]>;
    paymentsByInvoice : Map.Map<Nat, [Nat]>;
    numbers : Map.Map<Text, Nat>;
    lastDay : Map.Map<Text, Day>;
  };

  type OldActor = {};
  type NewActor = { sales : SalesState };

  public func migration(_ : OldActor) : NewActor {
    {
      sales = {
        invoices = Map.empty();
        drafts = Map.empty();
        frozen = Map.empty();
        plans = Map.empty();
        payments = Map.empty();
        reminders = Map.empty();
        byWork = Map.empty();
        paymentsByInvoice = Map.empty();
        numbers = Map.empty();
        lastDay = Map.empty();
      };
    };
  };
};
