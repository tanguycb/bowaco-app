// Rekenmodule van de offerte (stap 2.4/2.5, bouwplan §8.5): DEZELFDE regels als src/frontend/src/quote/calc.ts. De browser
// rekent en toont; de backend rekent bij elke bewaring opnieuw met deze module en weigert als de browser iets anders vond
// (tests/rekentest.mjs vergelijkt beide). Een totaal wordt dus nooit getypt of bewaard: het volgt altijd uit de invoer.
// Geld in eurocent (Int), hoeveelheden in duizendsten (Int, ook negatief: minwerk), marges in basispunten op de
// VERKOOPprijs (2000 = 20 %: verkoop = aankoop / 0,8, B5). Afronden: op de cent, half weg van nul (−0,5 → −1).
// Volgorde: eerst de eenheidsprijs op de cent, dan hoeveelheid × eenheidsprijs op de cent, dan de som per hoofdstuk, dan
// de btw op het subtotaal. Opties tellen NIET mee in het totaal (apart: meer- en minprijs); tekstregels hebben geen bedrag.
// Wijzig je een regel, verhoog dan `version`: een verzonden versie rekent altijd met de regels waarmee ze verstuurd werd.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Runtime "mo:core/Runtime";
import VarArray "mo:core/VarArray";

module {
  public let version : Nat = 1;

  public type Kind = { #item; #text; #option };
  public type Rule = { #margin : Nat; #price : Int };
  // rule = null: de standaardmarge van de versie
  public type Line = { chapter : Nat; kind : Kind; qtyMilli : Int; cost : ?Int; rule : ?Rule };

  public type LineOut = {
    unitSell : ?Int; // verkoopprijs per eenheid; null = geen prijs (marge zonder aankoopprijs)
    lineSell : Int; // hoeveelheid × eenheidsprijs (0 zonder prijs of voor een tekstregel)
    lineCost : ?Int; // hoeveelheid × aankoopprijs
    marginBp : ?Int; // marge op de verkoopprijs (bij een vaste prijs: wat eruit volgt, kan negatief zijn)
    noPrice : Bool;
    deviates : Bool; // andere marge dan de standaard, of een vaste prijs
    negative : Bool; // verkoop onder de aankoopprijs
  };

  public type ChapterOut = { chapter : Nat; sell : Int; cost : Int; sellWithCost : Int; noPrice : Nat };

  public type Totals = {
    chapters : [ChapterOut];
    subtotal : Int; // som van de hoofdstukken, excl. btw
    vat : Int;
    total : Int; // incl. btw
    optionsPlus : Int; // opties met een meerprijs (niet in het totaal)
    optionsMinus : Int; // opties met een minprijs (negatief; niet in het totaal)
    cost : Int; // aankoop van de posten met een aankoopprijs
    sellWithCost : Int; // verkoop van die posten
    sellWithoutCost : Int; // verkoop van de posten zonder aankoopprijs (vaste prijs, eigen prestatie)
    margin : Int; // sellWithCost − cost
    marginBp : ?Int; // margin / sellWithCost
    noPrice : Nat;
    deviating : Nat;
    negative : Nat;
  };

  // n / d afgerond op het dichtste geheel, half weg van nul (d > 0). Motoko deelt Int afkappend naar nul, zoals BigInt.
  public func roundDiv(n : Int, d : Int) : Int {
    if (d <= 0) { Runtime.trap("roundDiv: deler ≤ 0") };
    if (n >= 0) (n + d / 2) / d else -((-n + d / 2) / d);
  };

  public func unitSell(cost : ?Int, rule : ?Rule, standardBp : Nat) : ?Int {
    let r : Rule = switch rule { case (?x) x; case null #margin(standardBp) };
    switch r {
      case (#price p) ?p;
      case (#margin m) {
        switch cost {
          case (?c) { if (m >= 10_000) null else ?roundDiv(c * 10_000, 10_000 - m) };
          case null null;
        };
      };
    };
  };

  func deviates(rule : ?Rule, standardBp : Nat) : Bool {
    switch rule { case null false; case (?#margin m) m != standardBp; case (?#price _) true };
  };

  public func line(l : Line, standardBp : Nat) : LineOut {
    switch (l.kind) {
      case (#text) { return { unitSell = null; lineSell = 0; lineCost = null; marginBp = null; noPrice = false; deviates = false; negative = false } };
      case _ {};
    };
    let u = unitSell(l.cost, l.rule, standardBp);
    let lineSell = switch u { case (?x) roundDiv(l.qtyMilli * x, 1000); case null 0 };
    let lineCost = switch (l.cost) { case (?c) ?roundDiv(l.qtyMilli * c, 1000); case null null };
    let r : Rule = switch (l.rule) { case (?x) x; case null #margin(standardBp) };
    let marginBp : ?Int = switch (r, u, l.cost) {
      case (#margin m, ?_, _) ?m;
      case (#price p, _, ?c) { if (p > 0) ?roundDiv((p - c) * 10_000, p) else null };
      case _ null;
    };
    let negative = switch (u, l.cost) { case (?x, ?c) x < c; case _ false };
    { unitSell = u; lineSell; lineCost; marginBp; noPrice = u == null; deviates = deviates(l.rule, standardBp); negative };
  };

  // De hoofdstukken in de gegeven volgorde; een lijn moet bij een van die hoofdstukken horen (anders: trap, zodat een
  // lijn nooit stil buiten het totaal valt, de fout van offerte 2026/231).
  public func totals(chapters : [Nat], lines : [Line], vatBp : Nat, standardBp : Nat) : Totals {
    let n = chapters.size();
    let sell = VarArray.repeat<Int>(0, n);
    let cost = VarArray.repeat<Int>(0, n);
    let sellWithCost = VarArray.repeat<Int>(0, n);
    let noPriceCh = VarArray.repeat<Nat>(0, n);
    var optionsPlus : Int = 0;
    var optionsMinus : Int = 0;
    var noPrice = 0;
    var deviating = 0;
    var negative = 0;
    for (l in lines.values()) {
      var idx : ?Nat = null;
      var i = 0;
      while (i < n and idx == null) { if (chapters[i] == l.chapter) { idx := ?i }; i += 1 };
      let k = switch idx { case (?x) x; case null Runtime.trap("Post zonder hoofdstuk #" # Int.toText(l.chapter)) };
      switch (l.kind) {
        case (#text) {};
        case _ {
          let o = line(l, standardBp);
          if (o.noPrice) { noPrice += 1; noPriceCh[k] += 1 };
          if (o.deviates) { deviating += 1 };
          if (o.negative) { negative += 1 };
          switch (l.kind) {
            case (#item) {
              sell[k] += o.lineSell;
              switch (o.lineCost) { case (?c) { cost[k] += c; sellWithCost[k] += o.lineSell }; case null {} };
            };
            case _ { if (o.lineSell > 0) { optionsPlus += o.lineSell } else { optionsMinus += o.lineSell } };
          };
        };
      };
    };
    var subtotal : Int = 0;
    var costT : Int = 0;
    var swc : Int = 0;
    for (j in chapters.keys()) {
      subtotal += sell[j];
      costT += cost[j];
      swc += sellWithCost[j];
    };
    let outs = Array.tabulate<ChapterOut>(n, func j = { chapter = chapters[j]; sell = sell[j]; cost = cost[j]; sellWithCost = sellWithCost[j]; noPrice = noPriceCh[j] });
    let vat = roundDiv(subtotal * vatBp, 10_000);
    let margin = swc - costT;
    {
      chapters = outs;
      subtotal;
      vat;
      total = subtotal + vat;
      optionsPlus;
      optionsMinus;
      cost = costT;
      sellWithCost = swc;
      sellWithoutCost = subtotal - swc;
      margin;
      marginBp = if (swc > 0) ?roundDiv(margin * 10_000, swc) else null;
      noPrice;
      deviating;
      negative;
    };
  };

};
