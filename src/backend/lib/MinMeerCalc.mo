// Rekenmodule van de min-meerstaat (stap 2c.5, ontwerp 2c §4.5, G4): DEZELFDE regels als src/frontend/src/minmeer/calc.ts. De
// backend bouwt de regels (lib/MinMeer.mo) en rekent ze met deze module; de browser rekent dezelfde invoer na en meldt een verschil
// (tests/minmeer-2c5.mjs vergelijkt beide). Een totaal wordt nooit getypt of bewaard: het volgt uit de invoer.
// Geld in eurocent (Int), hoeveelheden in duizendsten (Int), percentages in basispunten. Afronden: op de cent, half weg van nul.
//   • Bedrag van een regel = hoeveelheid × eenheidsprijs (op de cent); met pctBp daarvan dat deel (op de cent): "vervalt voor 30 %".
//   • Kolom: #offer (offerte), #less (minwerk: altijd negatief), #extra (meerwerk: altijd positief), #auto (het teken beslist).
//   • Een regel die niet meetelt (wacht op akkoord, nog te prijzen) heeft een bedrag maar telt enkel in "in afwachting".
//   • Korting (#discount van kantoor): een bedrag, of een % van het meerwerk van dat hoofdstuk ("" = van al het meerwerk); minwerk.
//   • Saldo = minwerk + meerwerk; aanneemsom + saldo = offerte + saldo; nog te factureren = dat − reeds gefactureerd.
// Wijzig je een regel, verhoog dan `version`: een versie houdt de rekenversie waarmee ze gemaakt werd.
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Text "mo:core/Text";
import QuoteCalc "QuoteCalc";

module {
  public let version : Nat = 1;

  public type Col = { #offer; #less; #extra; #auto };
  public type Line = { chapter : Text; col : Col; qtyMilli : Int; unitCents : Int; pctBp : ?Nat; counted : Bool };
  public type Disc = { chapter : Text; pctBp : ?Nat; amountCents : Int; counted : Bool };
  public type LineOut = { amountCents : Int; offerCents : Int; lessCents : Int; extraCents : Int };
  public type ChapterOut = { chapter : Text; offerCents : Int; lessCents : Int; extraCents : Int; balanceCents : Int };
  public type Totals = {
    lines : [LineOut];
    discs : [LineOut];
    chapters : [ChapterOut];
    offerCents : Int;
    lessCents : Int;
    extraCents : Int;
    balanceCents : Int;
    contractCents : Int;
    invoicedCents : Int;
    toInvoiceCents : Int;
    pendingCents : Int;
    vatBp : Nat;
  };

  func abs(x : Int) : Int { if (x < 0) -x else x };

  public func amount(l : Line) : Int {
    let base = QuoteCalc.roundDiv(l.qtyMilli * l.unitCents, 1000);
    switch (l.pctBp) { case (?p) QuoteCalc.roundDiv(base * p, 10_000); case null base };
  };

  public func line(l : Line) : LineOut {
    let a = amount(l);
    switch (l.col) {
      case (#offer) { { amountCents = a; offerCents = a; lessCents = 0; extraCents = 0 } };
      case (#less) { { amountCents = a; offerCents = 0; lessCents = -abs(a); extraCents = 0 } };
      case (#extra) { { amountCents = a; offerCents = 0; lessCents = 0; extraCents = abs(a) } };
      case (#auto) { if (a >= 0) { { amountCents = a; offerCents = 0; lessCents = 0; extraCents = a } } else { { amountCents = a; offerCents = 0; lessCents = a; extraCents = 0 } } };
    };
  };

  // De korting op het meerwerk van een hoofdstuk ("" = al het meerwerk), of een vast bedrag; altijd minwerk.
  public func disc(d : Disc, extraBase : Int) : LineOut {
    let a = switch (d.pctBp) { case (?p) QuoteCalc.roundDiv(extraBase * p, 10_000); case null d.amountCents };
    { amountCents = a; offerCents = 0; lessCents = -abs(a); extraCents = 0 };
  };

  public func totals(lines : [Line], discs : [Disc], invoicedCents : Int, vatBp : Nat) : Totals {
    let order = List.empty<Text>();
    let ch = Map.empty<Text, (Int, Int, Int)>();
    func bump(c : Text, o : Int, l : Int, e : Int) {
      switch (ch.get(c)) {
        case (?(a, b, x)) ch.add(c, (a + o, b + l, x + e));
        case null { order.add(c); ch.add(c, (o, l, e)) };
      };
    };
    var offer : Int = 0;
    var less : Int = 0;
    var extra : Int = 0;
    var pending : Int = 0;
    let outs = lines.map(func(l : Line) : LineOut = line(l));
    for ((i, l) in lines.enumerate()) {
      let o = outs[i];
      if (l.counted) {
        offer += o.offerCents;
        less += o.lessCents;
        extra += o.extraCents;
        bump(l.chapter, o.offerCents, o.lessCents, o.extraCents);
      } else {
        pending += o.lessCents + o.extraCents;
        bump(l.chapter, 0, 0, 0);
      };
    };
    let allExtra = extra;
    let dOuts = discs.map(
      func(d : Disc) : LineOut {
        let base = if (d.chapter == "") allExtra else switch (ch.get(d.chapter)) { case (?(_, _, x)) x; case null 0 };
        disc(d, base);
      }
    );
    for ((i, d) in discs.enumerate()) {
      let o = dOuts[i];
      if (d.counted) { less += o.lessCents; bump(d.chapter, 0, o.lessCents, 0) } else { pending += o.lessCents; bump(d.chapter, 0, 0, 0) };
    };
    let chapters = order.toArray().map(
      func(c : Text) : ChapterOut {
        let (o, l, e) = switch (ch.get(c)) { case (?x) x; case null (0, 0, 0) };
        { chapter = c; offerCents = o; lessCents = l; extraCents = e; balanceCents = l + e };
      }
    );
    let balance = less + extra;
    let contract = offer + balance;
    {
      lines = outs;
      discs = dOuts;
      chapters;
      offerCents = offer;
      lessCents = less;
      extraCents = extra;
      balanceCents = balance;
      contractCents = contract;
      invoicedCents;
      toInvoiceCents = contract - invoicedCents;
      pendingCents = pending;
      vatBp;
    };
  };

  public func colKey(c : Col) : Text { switch c { case (#offer) "offer"; case (#less) "less"; case (#extra) "extra"; case (#auto) "auto" } };
};
