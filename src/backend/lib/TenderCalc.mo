// Het rekenen van een OA-offerte (stap 2c.2, ontwerp 2c G4): dezelfde regels als src/frontend/src/tender/calc.ts. Een bewaard
// totaal komt altijd uit de regels, nooit getypt. Wijzig je een regel, verhoog dan `version` (en in calc.ts).
// Regel: bedrag = eenheidsprijs × hoeveelheid (duizendsten), half weg van nul op de cent; een post "niet inbegrepen" telt niet;
// zonder eenheidsprijs geen bedrag. Netto = som − korting (% op de som, op de cent). Totalen per hoofdstuk vóór de korting;
// eigen posten van de OA onder "Eigen posten".
import Array "mo:core/Array";
import Int "mo:core/Int";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Types "../types";
import QuoteCalc "QuoteCalc";

module {
  public let version : Nat = 1;
  public let ownChapter : Text = "Eigen posten";

  public func lineAmount(unitCents : ?Int, qtyMilli : Int, included : Types.OaIncluded) : ?Int {
    switch unitCents {
      case null null;
      case (?u) { switch included { case (#no) null; case _ ?QuoteCalc.roundDiv(u * qtyMilli, 1_000) } };
    };
  };

  public type Totals = { gross : Int; discount : Int; net : Int; chapters : [(Text, Int)] };

  // `chapterOf` geeft het hoofdstuk van een post van de prijsvraag (null = eigen post).
  public func totals(lines : [Types.OaQuoteLine], discountBp : ?Nat, chapterOf : Nat -> Text) : Totals {
    var gross : Int = 0;
    let order = Map.empty<Text, Nat>();
    var names : [Text] = [];
    let sums = Map.empty<Text, Int>();
    for (l in lines.values()) {
      switch (l.amountCents) {
        case (?a) {
          gross += a;
          let ch = switch (l.itemId) { case (?i) chapterOf(i); case null ownChapter };
          if (not order.containsKey(ch)) { order.add(ch, names.size()); names := names.concat([ch]) };
          sums.add(ch, (switch (sums.get(ch)) { case (?s) s; case null 0 }) + a);
        };
        case null {};
      };
    };
    let discount = switch discountBp { case (?bp) { if (bp == 0) 0 else QuoteCalc.roundDiv(gross * bp, 10_000) }; case null 0 };
    { gross; discount; net = gross - discount; chapters = names.map<Text, (Text, Int)>(func(n : Text) : (Text, Int) = (n, switch (sums.get(n)) { case (?s) s; case null 0 })) };
  };
};
