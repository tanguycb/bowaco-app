// Rekenmodule van de vorderingsstaat (stap 2.10, bouwplan §9 rij 2.10 en §5.1): DEZELFDE regels als
// src/frontend/src/progress/calc.ts. De browser rekent en toont; de backend rekent bij elke bewaring en bij het versturen opnieuw
// met deze module en weigert als de browser iets anders vond (tests/vordering-rekentest.mjs vergelijkt beide). Een totaal wordt
// dus nooit getypt: het volgt altijd uit de invoer (% uitgevoerd, hoeveelheden, regie-uren) en de prijzen van de getekende offerte.
// Geld in eurocent (Int), hoeveelheden in duizendsten (Int), percentages in basispunten (10_000 = 100 %), indexwaarden in
// duizendsten. Afronden zoals de offerte (AL21, tot Alexis anders beslist): op de cent, half weg van nul (QuoteCalc.roundDiv).
// Volgorde per post: bedrag offerte = hoeveelheid × eenheidsprijs op de cent; totaal tot nu = (vaste prijs) bedrag offerte × % op
// de cent, of (VH, regie) hoeveelheid tot nu × eenheidsprijs op de cent; deze periode = totaal tot nu − vorige staten (geen
// afronding meer). Dan per sectie en samen de som; de prijsherziening op de som van deze periode zonder regie; btw op
// (deze periode + prijsherziening); de inhouding van de waarborg op dat bedrag excl. of incl. btw; te betalen = totaal − inhouding.
// Wijzig je een regel, verhoog dan `version`: een verzonden staat ligt vast met de bedragen van toen.
import Array "mo:core/Array";
import QuoteCalc "QuoteCalc";

module {
  public let version : Nat = 1;

  public type Section = { #contract; #extra; #less; #regie };
  public type Basis = { #percent; #quantity; #hours };

  // prevCents = het totaal tot nu van deze post in de vorige (niet gecrediteerde) staat.
  public type Line = { section : Section; basis : Basis; offerQtyMilli : Int; unitPrice : Int; prevCents : Int; cumPctBp : Nat; cumQtyMilli : Int };

  public type LineOut = {
    offerCents : Int;
    cumQtyMilli : Int; // bij vaste prijs: de hoeveelheid die bij het % hoort (ter info)
    cumCents : Int;
    periodCents : Int;
    restCents : Int; // offerte − totaal tot nu
    overVhCents : Int; // het deel boven de VH (enkel hoeveelheden en uren)
  };

  // p = P × (a·s/S + b·i/I + c) met a + b + c = 10_000 bp; S, I = basisindex; s, i = de index van deze staat.
  public type Revision = { aBp : Nat; bBp : Nat; cBp : Nat; sBase : Nat; iBase : Nat; sIndex : Nat; iIndex : Nat };

  public type SectionOut = { section : Section; offerCents : Int; prevCents : Int; cumCents : Int; periodCents : Int };

  public type Totals = {
    sections : [SectionOut];
    offerCents : Int;
    prevCents : Int;
    cumCents : Int;
    periodCents : Int;
    restCents : Int;
    overVhCents : Int;
    revisionBaseCents : Int;
    revisionCents : Int;
    subtotalCents : Int;
    vatBp : Nat;
    vatCents : Int;
    totalCents : Int;
    retentionBp : Nat;
    retentionCents : Int;
    payableCents : Int;
  };

  public let sections : [Section] = [#contract, #extra, #less, #regie];

  let rd = QuoteCalc.roundDiv;

  public func line(l : Line) : LineOut {
    let offerCents = rd(l.offerQtyMilli * l.unitPrice, 1000);
    let (cumQty, cumCents) = switch (l.basis) {
      case (#percent) { let p : Int = l.cumPctBp; (rd(l.offerQtyMilli * p, 10_000), rd(offerCents * p, 10_000)) };
      case _ (l.cumQtyMilli, rd(l.cumQtyMilli * l.unitPrice, 1000));
    };
    let over = switch (l.basis) {
      case (#percent) 0;
      case _ { if (l.offerQtyMilli >= 0 and cumQty > l.offerQtyMilli) cumCents - offerCents else 0 };
    };
    { offerCents; cumQtyMilli = cumQty; cumCents; periodCents = cumCents - l.prevCents; restCents = offerCents - cumCents; overVhCents = over };
  };

  // De herziening van een bedrag: bedrag × (factor − 1), exact als breuk en dan één keer afgerond.
  public func revision(base : Int, r : Revision) : Int {
    if (r.sBase == 0 or r.iBase == 0) { return 0 };
    let sB : Int = r.sBase;
    let iB : Int = r.iBase;
    let a : Int = r.aBp;
    let b : Int = r.bBp;
    let c : Int = r.cBp;
    let sx : Int = r.sIndex;
    let ix : Int = r.iIndex;
    let num : Int = a * sx * iB + b * ix * sB + c * sB * iB - 10_000 * sB * iB;
    rd(base * num, 10_000 * sB * iB);
  };

  func idx(s : Section) : Nat {
    switch s { case (#contract) 0; case (#extra) 1; case (#less) 2; case (#regie) 3 };
  };

  public func totals(lines : [Line], vatBp : Nat, retentionBp : Nat, retentionOnIncl : Bool, rev : ?Revision) : Totals {
    let offer = [var 0 : Int, 0, 0, 0];
    let prev = [var 0 : Int, 0, 0, 0];
    let cum = [var 0 : Int, 0, 0, 0];
    let period = [var 0 : Int, 0, 0, 0];
    var rest : Int = 0;
    var over : Int = 0;
    for (l in lines.values()) {
      let o = line(l);
      let k = idx(l.section);
      offer[k] += o.offerCents;
      prev[k] += l.prevCents;
      cum[k] += o.cumCents;
      period[k] += o.periodCents;
      rest += o.restCents;
      over += o.overVhCents;
    };
    let secs = Array.tabulate<SectionOut>(4, func k = { section = sections[k]; offerCents = offer[k]; prevCents = prev[k]; cumCents = cum[k]; periodCents = period[k] });
    let sum = func(a : [var Int]) : Int { a[0] + a[1] + a[2] + a[3] };
    let periodT = sum(period);
    let base = period[0] + period[1] + period[2];
    let revC = switch rev { case (?r) revision(base, r); case null 0 };
    let subtotal = periodT + revC;
    let vat = rd(subtotal * (vatBp : Int), 10_000);
    let total = subtotal + vat;
    let retention = rd((if retentionOnIncl total else subtotal) * (retentionBp : Int), 10_000);
    {
      sections = secs;
      offerCents = sum(offer);
      prevCents = sum(prev);
      cumCents = sum(cum);
      periodCents = periodT;
      restCents = rest;
      overVhCents = over;
      revisionBaseCents = if (rev == null) 0 else base;
      revisionCents = revC;
      subtotalCents = subtotal;
      vatBp;
      vatCents = vat;
      totalCents = total;
      retentionBp;
      retentionCents = retention;
      payableCents = total - retention;
    };
  };
};
