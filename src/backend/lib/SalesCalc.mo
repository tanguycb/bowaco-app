// Rekenmodule van de verkoopfacturen (stap 2c.6, ontwerp 2c §4.6): DEZELFDE regels als src/frontend/src/sales/calc.ts (rekentest
// browser = server in tests/factuur-2c6.mjs). Geld in eurocent (Int), hoeveelheden in duizendsten, percentages in basispunten.
// Afronden op de cent, half weg van nul (QuoteCalc.roundDiv).
//   • Korting op het totaal van de offerte (2c.1) zit IN de schijven: ze wordt over de hoofdstukken verdeeld naar verhouding van hun
//     bedrag (op de cent); het laatste hoofdstuk met een bedrag neemt de rest, zodat Σ netto = de aanneemsom (subtotaal van de offerte).
//   • Schijven per hoofdstuk: bedrag = netto van het hoofdstuk × % (op de cent); de LAATSTE schijf neemt de rest, zodat de som van alle
//     schijven per hoofdstuk exact het netto van dat hoofdstuk is (en dus samen exact de aanneemsom).
//   • Regel = hoeveelheid × eenheidsprijs (op de cent). Btw per tarief op het TOTAAL per tarief (niet per regel); bij btw verlegd één
//     blok aan 0 %. Een creditnota heeft negatieve regels.
//   • Gestructureerde mededeling (+++123/4567/89012+++): 10 cijfers uit reeks, jaar en volgnummer, controlegetal = rest mod 97 (0 → 97).
// Wijzig je een regel, verhoog dan `version`: een uitgereikte factuur houdt de versie waarmee ze gerekend werd.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import VarArray "mo:core/VarArray";
import QuoteCalc "QuoteCalc";

module {
  public let version : Nat = 1;

  public func roundDiv(n : Int, d : Int) : Int { QuoteCalc.roundDiv(n, d) };

  public func lineAmount(qtyMilli : Int, unitCents : Int) : Int { roundDiv(qtyMilli * unitCents, 1000) };

  public func pctOf(cents : Int, bp : Nat) : Int { roundDiv(cents * bp, 10_000) };

  // Netto per hoofdstuk na de korting op het totaal (positief = er gaat iets af).
  public func netChapters(sells : [Int], discount : Int) : [Int] {
    let n = sells.size();
    var gross : Int = 0;
    var last : ?Nat = null;
    for (i in sells.keys()) { gross += sells[i]; if (sells[i] != 0) { last := ?i } };
    if (discount == 0 or n == 0) { return sells };
    let lastIdx = switch last { case (?i) i; case null n - 1 };
    let out = VarArray.repeat<Int>(0, n);
    var given : Int = 0;
    for (i in sells.keys()) {
      if (i != lastIdx) {
        let share = if (gross == 0) 0 else roundDiv(discount * sells[i], gross);
        out[i] := sells[i] - share;
        given += share;
      };
    };
    out[lastIdx] := sells[lastIdx] - (discount - given);
    Array.tabulate<Int>(n, func i = out[i]);
  };

  // pct[s][c] = het percentage van schijf s voor hoofdstuk c. De laatste schijf neemt per hoofdstuk de rest.
  public func stepAmounts(nets : [Int], pct : [[Nat]]) : [[Int]] {
    let steps = pct.size();
    if (steps == 0) { return [] };
    let out = Array.tabulate<[var Int]>(steps, func _ = VarArray.repeat<Int>(0, nets.size()));
    for (c in nets.keys()) {
      var given : Int = 0;
      for (s in pct.keys()) {
        if (s + 1 < steps) {
          let bp = if (c < pct[s].size()) pct[s][c] else 0;
          let a = pctOf(nets[c], bp);
          out[s][c] := a;
          given += a;
        } else { out[s][c] := nets[c] - given };
      };
    };
    out.map<[var Int], [Int]>(func r = Array.tabulate<Int>(r.size(), func i = r[i]));
  };

  public type VatIn = { amountCents : Int; vatBp : Nat };
  public type VatLine = { vatBp : Nat; reverse : Bool; baseCents : Int; vatCents : Int };
  public type Totals = { netCents : Int; vatCents : Int; totalCents : Int; vatLines : [VatLine] };

  // Btw per tarief op het totaal per tarief (oplopend tarief); verlegd = één blok aan 0 %, geen btw.
  public func totals(lines : [VatIn], reverse : Bool) : Totals {
    var net : Int = 0;
    for (l in lines.values()) { net += l.amountCents };
    if (reverse) { return { netCents = net; vatCents = 0; totalCents = net; vatLines = [{ vatBp = 0; reverse = true; baseCents = net; vatCents = 0 }] } };
    var rates : [Nat] = [];
    for (l in lines.values()) { if (not rates.any(func(r : Nat) : Bool = r == l.vatBp)) { rates := rates.concat([l.vatBp]) } };
    rates := rates.sort(Nat.compare);
    var vat : Int = 0;
    let vls = rates.map(
      func(r : Nat) : VatLine {
        var base : Int = 0;
        for (l in lines.values()) { if (l.vatBp == r) { base += l.amountCents } };
        let v = pctOf(base, r);
        vat += v;
        { vatBp = r; reverse = false; baseCents = base; vatCents = v };
      }
    );
    { netCents = net; vatCents = vat; totalCents = net + vat; vatLines = vls };
  };

  func pad(n : Nat, w : Nat) : Text {
    var t = n.toText();
    while (t.size() < w) { t := "0" # t };
    t;
  };

  // Gestructureerde mededeling: reeks (1 = factuur, 2 = creditnota), jaar (4 cijfers) en volgnummer (5 cijfers, modulo 100.000).
  public func paymentRef(seriesDigit : Nat, year : Nat, seq : Nat) : Text {
    let base = seriesDigit % 10 * 1_000_000_000 + year % 10_000 * 100_000 + seq % 100_000;
    let m = base % 97;
    let check = if (m == 0) 97 else m;
    let s = pad(base, 10) # pad(check, 2);
    let c = s.chars().toArray();
    let part = func(a : Nat, b : Nat) : Text = Text.fromIter(Array.tabulate<Char>(b - a, func i = c[a + i]).values());
    "+++" # part(0, 3) # "/" # part(3, 7) # "/" # part(7, 12) # "+++";
  };

  // Een factuurnummer: "2026-153" (factuur) of "CN 2026-001" (creditnota), minstens 3 cijfers.
  public func number(series : Text, year : Nat, seq : Nat) : Text {
    (if (series == "CN") "CN " else "") # year.toText() # "-" # pad(seq, 3);
  };

  public func abs(i : Int) : Nat { Int.abs(i) };
};
