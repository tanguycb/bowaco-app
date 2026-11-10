// De API-vormen van de nacalculatie (stap 4.6): per werf de feiten waaruit de BROWSER gepland en werkelijk uitrekent
// (frontend/src/nacalc/calc.ts). Alles met bedragen, kostprijzen en OA-namen: enkel admin en calculator, enkel via update-calls met een
// auditregel (R20/R21, zoals readMinMeer). Geen werfleider, OA of klant ziet er iets van; er is hier dus geen variant zonder bedragen.
import Types "../types";

module {
  // Een post van de getekende offerte (enkel gewone posten, geen opties of tekstregels), met haar verkoop en aankoop (null = geen
  // aankoopprijs: eigen prestatie of budget).
  public type NcPlanned = {
    root : Nat;
    chapter : Text; // "01 Afbraak" (zoals in de min-meerstaat)
    code : Text;
    title : Text;
    form : Text; // "vast" · "regie" · "vermoedelijk" · "raming" · "budget" · "bijlage"
    unit : Text;
    qtyMilli : Int;
    sellCents : Int; // vóór de korting op het totaal
    costCents : ?Int; // hoeveelheid × aankoopprijs
    orgId : ?Nat; // de OA of leverancier van de aankoopprijs (2c.3/3.9)
    orgName : Text;
    source : Text;
  };
  // Eén kostenregel van een goedgekeurde of nog wachtende aankoop op deze werf (OA-factuur, leveranciersfactuur; voorschotten en
  // aftrek van voorschotten tellen niet; een creditnota telt negatief).
  public type NcActual = {
    purchaseId : Nat;
    lineId : Nat;
    number : Text;
    orgId : Nat;
    orgName : Text;
    orgKind : Text; // "oa" · "leverancier" · "andere"
    day : Nat;
    kind : Text; // kostensoort: "post" · "regie" · "ploeg" · "transport" · …
    kindName : Text;
    root : ?Nat;
    chapter : Text; // via de post van de offerte; "" = niet toe te wijzen
    form : Text; // de vorm van die post ("" = geen post)
    description : Text;
    qtyMilli : Int;
    amountCents : Int; // excl. btw, met teken
    status : Text; // "goedgekeurd" (telt) · "wacht" (geregistreerd of in controle: telt nog niet)
    credit : Bool;
  };
  // De uren van de OA op deze werf volgens de facturen, in duizendsten uren: bevestigd door de werfleider (of geen verschil), nog te
  // bevestigen, of "klopt niet".
  public type NcHours = { orgId : Nat; orgName : Text; confirmedMilli : Int; openMilli : Int; disputedMilli : Int };
  public type NcSettings = { pctBp : Nat; minCents : Nat };
  public type NcFacts = {
    workId : Nat;
    workCode : Text;
    workName : Text;
    status : Text;
    baseQuote : Text; // "2026/412 v1" (de getekende offerte)
    baseQuoteId : ?Nat;
    vatBp : Nat;
    planned : [NcPlanned];
    discountCents : Int; // korting op het totaal van de getekende offerte
    mmChapters : [Types.MmChapterTotal]; // de min-meerstaat per hoofdstuk (offerte, minwerk, meerwerk)
    mmTotals : Types.MmTotals;
    actual : [NcActual];
    hours : [NcHours];
    settings : NcSettings;
  };
  // Het overzicht over alle werven met een getekende offerte (enkel totalen).
  public type NcBrief = {
    workId : Nat;
    workCode : Text;
    workName : Text;
    status : Text;
    baseQuote : Text;
    plannedSellCents : Int; // na de korting
    plannedCostCents : Int; // Σ bekende aankoopprijzen
    unpricedLines : Nat; // posten met een prijs maar zonder aankoopprijs (de marge is dan te hoog)
    contractCents : Int; // aanneemsom + min-meer (min-meerstaat)
    invoicedCents : Int;
    actualCents : Int; // goedgekeurde kosten
    pendingCents : Int; // nog wachtend
    hoursOpen : Nat; // OA's met uren die nog niet bevestigd zijn of niet kloppen
  };
  public type NcOverview = { rows : [NcBrief]; settings : NcSettings; skipped : Nat };
};
