// API-vormen van de verkoopfacturen (stap 2c.6). Opgeslagen vorm ≠ API-vorm (D7). Views voor de werfleider (SalesFactView) dragen
// GEEN veld met bedragen (.did-controle in tests/factuur-2c6.mjs en tests/lek.mjs); SalesBrief evenmin (lijst als query).
import Types "../types";

module {
  public type SalesCounterView = { series : Text; year : Nat; last : Nat; set : Bool; locked : Bool; next : Nat };
  public type SalesSettingsView = {
    issuer : Types.SalesIssuer;
    issuerName : Text; // zoals op de factuur (leeg = de afzender van de offertes)
    paymentDays : Nat;
    vat6Text : Text;
    reverseText : Text;
    paymentText : Text;
    footerText : Text;
    reminderText : Text;
    reminderDays : Nat;
    issuerOnly : Bool;
    firstSeqF : Nat;
    firstSeqCN : Nat;
    planBp : [Nat];
    peppolScheme : Text;
    counters : [SalesCounterView];
    today : Nat;
  };
  public type SalesSettingsInput = {
    issuer : Types.SalesIssuer;
    paymentDays : Nat;
    vat6Text : Text;
    reverseText : Text;
    paymentText : Text;
    footerText : Text;
    reminderText : Text;
    reminderDays : Nat;
    issuerOnly : Bool;
    firstSeqF : Nat;
    firstSeqCN : Nat;
    planBp : [Nat];
    peppolScheme : Text;
  };

  // ── Schema ──
  public type BillingStepInput = { key : Text; title : Text; pctBp : Nat; when : Types.BillingWhen; chapterPct : [Types.BillingChapterPct] };
  public type SalesChapterNet = { chapter : Text; sellCents : Int; netCents : Int };
  public type SalesStepView = {
    key : Text;
    title : Text;
    pctBp : Nat;
    when : Types.BillingWhen;
    chapterPct : [Types.BillingChapterPct];
    amounts : [Int]; // per hoofdstuk (zelfde volgorde als chapters)
    stepCents : Int;
    status : Text; // "open" · "ontwerp" · "uitgereikt"
    numbers : [Text];
    dueDay : ?Nat;
  };
  public type SalesMmVersionBrief = { id : Nat; number : Nat; day : Nat; toInvoiceCents : Int; current : Bool };
  public type SalesProgressBrief = { id : Nat; code : Text; billing : Text; periodCents : Int; subtotalCents : Int };
  public type SalesPlanView = {
    workId : Nat;
    version : Nat;
    stored : Bool;
    calcVersion : Nat;
    baseQuote : Text;
    vatBp : Nat;
    grossCents : Int;
    discountCents : Int;
    contractCents : Int;
    chapters : [SalesChapterNet];
    steps : [SalesStepView];
    minMeer : [SalesMmVersionBrief];
    progress : [SalesProgressBrief];
    plannedStart : ?Nat;
  };

  // ── Facturen ──
  public type SalesSource = { #step : { key : Text; minMeerVersionId : ?Nat }; #progress : Nat; #minMeer : Nat; #free; #credit : { invoiceId : Nat; full : Bool } };
  // Zonder bedragen (lijst als query).
  public type SalesBrief = {
    id : Nat;
    workId : Nat;
    workCode : Text;
    kind : Text;
    kindTitle : Text;
    title : Text;
    number : Text;
    status : Text;
    pay : Text;
    issueDay : ?Nat;
    dueDay : ?Nat;
    overdue : Bool;
    sent : Bool;
    planStepKey : ?Text;
    creditOf : Text;
    credits : [Text];
    reminders : Nat;
    peppol : Text;
    company : Bool;
    rev : Nat;
  };
  public type SalesLineInput = { kind : Types.SalesLineKind; group : Text; description : Text; ref : Text; qtyMilli : Int; unit : Text; unitCents : Int; vatBp : Nat };
  public type SalesDraftInput = { title : Text; note : Text; serviceDay : ?Nat; serviceTo : ?Nat; paymentDays : Nat; vat : Types.SalesVat; lines : ?[SalesLineInput]; expectTotalCents : Int };
  public type SalesTotals = { netCents : Int; vatCents : Int; totalCents : Int; vatLines : [Types.SalesVatLine] };
  public type SalesDraftSaved = { rev : Nat; totals : SalesTotals };
  public type SalesFinding = { key : Text; text : Text; block : Bool };
  public type SalesPaymentView = { id : Nat; day : Nat; cents : Int; how : Text; note : Text; at : Int; byName : Text; archived : Bool; archiveReason : Text };
  public type SalesFullView = {
    brief : SalesBrief;
    vat : Types.SalesVat;
    serviceDay : ?Nat;
    serviceTo : ?Nat;
    paymentDays : Nat;
    note : Text;
    lines : [Types.SalesLine];
    totals : SalesTotals;
    doc : Types.SalesFrozen; // uitgereikt: wat vastligt; ontwerp: hoe het er nu zou uitzien (nummer "ONTWERP")
    hash : Text;
    intact : Bool;
    findings : [SalesFinding];
    payments : [SalesPaymentView];
    paidCents : Int;
    creditedCents : Int;
    openCents : Int;
    reminders : [Types.SalesReminder];
    calcVersion : Nat;
    today : Nat;
  };

  // ── Werklijst (Facturatie → Facturen) ──
  public type SalesDueRow = { workId : Nat; workCode : Text; workName : Text; stepKey : Text; title : Text; pctBp : Nat; when : Types.BillingWhen; dueDay : ?Nat; now : Bool; stepCents : Int; draftId : ?Nat };
  public type SalesOpenRow = { brief : SalesBrief; workName : Text; clientName : Text; totalCents : Int; openCents : Int; daysLate : Nat };
  public type SalesWorklistView = { today : Nat; due : [SalesDueRow]; open : [SalesOpenRow]; drafts : [SalesBrief] };

  // ── Kwartaallijst voor de boekhouder (2c.6b) ──
  public type SalesQuarterRow = {
    invoiceId : Nat;
    number : Text;
    series : Text;
    kind : Text;
    issueDay : Nat;
    dueDay : Nat;
    clientName : Text;
    clientVat : Text;
    workCode : Text;
    analyticCode : Text;
    vatLines : [Types.SalesVatLine];
    netCents : Int;
    vatCents : Int;
    totalCents : Int;
    paidDay : ?Nat;
    creditOf : Text;
  };

  // ── De klant (Mijn werf → Facturatie) ──
  public type MySalesRow = { id : Nat; workId : Nat; workName : Text; number : Text; kindTitle : Text; issueDay : Nat; dueDay : Nat; totalCents : Int; openCents : Int; pay : Text; overdue : Bool; creditOf : Text };
  public type MyScheduleRow = { workId : Nat; workName : Text; title : Text; pctBp : Nat; when : Types.BillingWhen; status : Text; numbers : [Text] };
  public type MySalesView = { invoices : [MySalesRow]; schedule : [MyScheduleRow] };
  public type MySalesDoc = { doc : Types.SalesFrozen; hash : Text; pay : Text; openCents : Int };

  // ── De werfleider: enkel het feit "voorschot betaald" (R42, R27), GEEN bedrag ──
  public type SalesFactView = { workId : Nat; advance : Text /* "geen" · "niet-gefactureerd" · "open" · "deels" · "betaald" */; advanceDay : ?Nat };
};
