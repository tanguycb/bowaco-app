// De vergelijking van OA-offertes op één prijsvraag (stap 2c.3, ontwerp 2c §4.3, G4): dezelfde regels als
// src/frontend/src/tender/compare.ts. De browser rekent dezelfde uitkomst na uit dezelfde invoer (de view draagt beide).
// Wijzig je een regel, verhoog dan `version` (en in compare.ts).
// Regels:
// · per post en per firma: "prijs" (eenheidsprijs × de VH van BOWACO, half weg van nul op de cent), "geen-prijs", "niet-inbegrepen",
//   "ontbreekt" (de post staat niet in de offerte) of "geen-detail" (de offerte heeft enkel hoofdstuktotalen of enkel een totaal);
// · laagste: enkel als er minstens twee vergelijkbare prijzen zijn (geen alternatief, geen andere eenheid); gelijke laagste allebei;
// · afwijkend: de eenheidsprijs t.o.v. de laatste prijs van die firma en t.o.v. de mediaan van de laatste 12 maanden (alle firma's)
//   in de bibliotheek, in basispunten (half weg van nul); afwijkend = |afwijking| > drempel;
// · totalen per firma: per hoofdstuk op de VH van BOWACO (of de opgegeven hoofdstuktotalen), eigen posten van de OA zoals hij ze
//   rekende, korting % op de som, volledig = elke post heeft een prijs (hoofdstukken: elk hoofdstuk; totaal: altijd);
// · laagste per hoofdstuk en in totaal: enkel tussen firma's die dat hoofdstuk (of alles) volledig prijsden, minstens twee;
// · keuze: per gekozen post het bedrag van die firma; een keuze op een offerte die niet meer geldt of zonder prijs = "verouderd".
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import TV "../types/tenderviews";
import QuoteCalc "QuoteCalc";

module {
  public let version : Nat = 1;

  func abs(i : Int) : Int { if (i < 0) -i else i };

  public func median(xs : [Int]) : ?Int {
    if (xs.size() == 0) { return null };
    let s = xs.sort(Int.compare);
    let n = s.size();
    if (n % 2 == 1) ?s[n / 2] else ?QuoteCalc.roundDiv(s[n / 2 - 1] + s[n / 2], 2);
  };

  func devBp(u : Int, ref : Int) : ?Int { if (ref <= 0) null else ?QuoteCalc.roundDiv((u - ref) * 10_000, ref) };

  func hasChange(changed : [Text], k : Text) : Bool { changed.find(func(x : Text) : Bool = x == k) != null };

  // Lineair in posten × firma's (review L7): elke cel staat op plaats (post-index × aantal firma's + firma-index); de regels van een
  // offerte en de mediaan per post worden één keer opgezocht.
  public func compare(i : TV.CmpInput) : TV.CmpResult {
    let nI = i.items.size();
    let nQ = i.quotes.size();
    // Hoofdstukken in de volgorde van de posten.
    let chList = List.empty<Text>();
    let chSeen = Map.empty<Text, Bool>();
    for (x in i.items.values()) { if (not chSeen.containsKey(x.chapter)) { chSeen.add(x.chapter, true); chList.add(x.chapter) } };
    let chapters = chList.toArray();
    let hist = Map.empty<Nat, TV.CmpHistory>();
    for (h in i.history.values()) { hist.add(h.itemId, h) };
    let thr : Int = i.thresholdBp;
    // Per offerte de regels op post; per post de mediaan.
    let lineMaps = i.quotes.map(func(q : TV.CmpQuote) : Map.Map<Nat, Types.OaQuoteLine> {
      let m = Map.empty<Nat, Types.OaQuoteLine>();
      for (l in q.lines.values()) { switch (l.itemId) { case (?id) { if (not m.containsKey(id)) { m.add(id, l) } }; case null {} } };
      m;
    });
    let medians = i.items.map(func(x : TV.CmpItem) : ?Int = switch (hist.get(x.id)) { case (?h) median(h.recent); case null null });

    // 1. Cellen (post × firma), zonder "laagste".
    type Raw = { itemId : Nat; oaQuoteId : Nat; state : Text; unitCents : ?Int; amountCents : ?Int; alt : Bool; vhChanged : Bool; unitChanged : Bool; devLastBp : ?Int; devMedianBp : ?Int; deviates : Bool };
    let rawL = List.empty<Raw>();
    for ((xi, x) in i.items.enumerate()) {
      for ((qi, q) in i.quotes.enumerate()) {
        let empty : Raw = { itemId = x.id; oaQuoteId = q.id; state = "ontbreekt"; unitCents = null; amountCents = null; alt = false; vhChanged = false; unitChanged = false; devLastBp = null; devMedianBp = null; deviates = false };
        let cell : Raw = if (q.form != "posten") { { empty with state = "geen-detail" } } else {
          switch (lineMaps[qi].get(x.id)) {
            case null empty;
            case (?l) {
              let vh = hasChange(l.changed, "vh");
              let un = hasChange(l.changed, "eenheid");
              let alt = switch (l.included) { case (#alt _) true; case _ false };
              switch (l.included, l.unitCents) {
                case (#no, _) { { empty with state = "niet-inbegrepen"; vhChanged = vh; unitChanged = un } };
                case (_, null) { { empty with state = "geen-prijs"; alt; vhChanged = vh; unitChanged = un } };
                case (_, ?u) {
                  var dl : ?Int = null;
                  switch (hist.get(x.id)) {
                    case (?h) { switch (h.lastByOrg.find(func((o, _) : (Nat, Int)) : Bool = o == q.orgId)) { case (?(_, last)) { dl := devBp(u, last) }; case null {} } };
                    case null {};
                  };
                  let dm : ?Int = switch (medians[xi]) { case (?m) devBp(u, m); case null null };
                  let off = func(d : ?Int) : Bool = switch d { case (?v) abs(v) > thr; case null false };
                  { empty with state = "prijs"; unitCents = ?u; amountCents = ?QuoteCalc.roundDiv(u * x.qtyMilli, 1_000); alt; vhChanged = vh; unitChanged = un; devLastBp = dl; devMedianBp = dm; deviates = off(dl) or off(dm) };
                };
              };
            };
          };
        };
        rawL.add(cell);
      };
    };
    let raw = rawL.toArray();
    let at = func(xi : Nat, qi : Nat) : Raw = raw[xi * nQ + qi];
    let comparable = func(c : Raw) : Bool = c.state == "prijs" and not c.alt and not c.unitChanged;

    // 2. Laagste per post (minstens twee vergelijkbare prijzen).
    let lowestOf = Array.tabulate<?Int>(nI, func(xi : Nat) : ?Int {
      var m : Int = 0;
      var n = 0;
      for (qi in Nat.range(0, nQ)) {
        let c = at(xi, qi);
        if (comparable(c)) { switch (c.amountCents) { case (?a) { if (n == 0 or a < m) { m := a }; n += 1 }; case null {} } };
      };
      if (n >= 2) ?m else null;
    });
    let cells = Array.tabulate<TV.CmpCell>(raw.size(), func(k : Nat) : TV.CmpCell {
      let c = raw[k];
      let low = comparable(c) and (switch (lowestOf[k / (if (nQ == 0) 1 else nQ)], c.amountCents) { case (?m, ?a) a == m; case _ false });
      { itemId = c.itemId; oaQuoteId = c.oaQuoteId; state = c.state; unitCents = c.unitCents; amountCents = c.amountCents; alt = c.alt; vhChanged = c.vhChanged; unitChanged = c.unitChanged; lowest = low; devLastBp = c.devLastBp; devMedianBp = c.devMedianBp; deviates = c.deviates };
    });
    let itemIdx = Map.empty<Nat, Nat>();
    for ((xi, x) in i.items.enumerate()) { if (not itemIdx.containsKey(x.id)) { itemIdx.add(x.id, xi) } };
    let quoteIdx = Map.empty<Nat, Nat>();
    for ((qi, q) in i.quotes.enumerate()) { if (not quoteIdx.containsKey(q.id)) { quoteIdx.add(q.id, qi) } };

    // 3. Totalen per firma.
    let quotes = Array.tabulate<TV.CmpQuoteTotals>(nQ, func(qi : Nat) : TV.CmpQuoteTotals {
      let q = i.quotes[qi];
      let disc = func(g : Int) : Int = switch (q.discountBp) { case (?bp) { if (bp == 0) 0 else QuoteCalc.roundDiv(g * bp, 10_000) }; case null 0 };
      if (q.form == "posten") {
        let sums = Map.empty<Text, Int>();
        var priced = 0;
        for ((xi, x) in i.items.enumerate()) {
          switch (at(xi, qi).amountCents) { case (?a) { sums.add(x.chapter, (switch (sums.get(x.chapter)) { case (?v) v; case null 0 }) + a); priced += 1 }; case null {} };
        };
        let chs = chapters.filter(func(ch : Text) : Bool = sums.containsKey(ch)).map<Text, (Text, Int)>(func(ch : Text) : (Text, Int) = (ch, switch (sums.get(ch)) { case (?v) v; case null 0 }));
        var gross : Int = 0;
        for ((_, v) in chs.values()) { gross += v };
        var own : Int = 0;
        for (l in q.lines.values()) { if (l.itemId == null) { switch (l.amountCents) { case (?a) { own += a }; case null {} } } };
        gross += own;
        let d = disc(gross);
        { oaQuoteId = q.id; chapters = chs; ownCents = own; gross; discount = d; net = gross - d; priced; items = nI; complete = priced == nI };
      } else if (q.form == "hoofdstukken") {
        var gross : Int = 0;
        for ((_, v) in q.chapterTotals.values()) { gross += v };
        let d = disc(gross);
        let given = Map.empty<Text, Bool>();
        for ((n, _) in q.chapterTotals.values()) { given.add(n, true) };
        { oaQuoteId = q.id; chapters = q.chapterTotals; ownCents = 0; gross; discount = d; net = gross - d; priced = 0; items = nI; complete = chapters.all(func(ch : Text) : Bool = given.containsKey(ch)) };
      } else {
        { oaQuoteId = q.id; chapters = []; ownCents = 0; gross = q.netCents; discount = 0; net = q.netCents; priced = 0; items = nI; complete = true };
      };
    });

    // 4. Laagste per hoofdstuk en in totaal (enkel volledige firma's, minstens twee).
    let chapterRes = chapters.map(func(ch : Text) : TV.CmpChapter {
      let cand = List.empty<(Nat, Int)>();
      for (qi in Nat.range(0, nQ)) {
        let q = i.quotes[qi];
        let full = if (q.form == "posten") {
          var ok = true;
          for ((xi, x) in i.items.enumerate()) { if (x.chapter == ch) { let c = at(xi, qi); if (c.state != "prijs" or c.unitChanged) { ok := false } } };
          ok;
        } else if (q.form == "hoofdstukken") { q.chapterTotals.find(func((n, _) : (Text, Int)) : Bool = n == ch) != null } else false;
        if (full) {
          switch (quotes[qi].chapters.find(func((n, _) : (Text, Int)) : Bool = n == ch)) { case (?(_, v)) { cand.add((q.id, v)) }; case null {} };
        };
      };
      { chapter = ch; lowest = lowestIds(cand.toArray()) };
    });
    let totCand = quotes.filter(func(t : TV.CmpQuoteTotals) : Bool = t.complete).map<TV.CmpQuoteTotals, (Nat, Int)>(func(t : TV.CmpQuoteTotals) : (Nat, Int) = (t.oaQuoteId, t.net));

    // 5. De keuze.
    var chosen = 0;
    let stale = List.empty<Nat>();
    let sums = Map.empty<Text, Int>();
    var total : Int = 0;
    for (p in i.picks.values()) {
      let amount : ?Int = switch (itemIdx.get(p.itemId), quoteIdx.get(p.oaQuoteId)) { case (?xi, ?qi) at(xi, qi).amountCents; case _ null };
      switch amount {
        case (?a) {
          chosen += 1;
          total += a;
          let ch = switch (itemIdx.get(p.itemId)) { case (?xi) i.items[xi].chapter; case null "" };
          sums.add(ch, (switch (sums.get(ch)) { case (?s) s; case null 0 }) + a);
        };
        case null { stale.add(p.itemId) };
      };
    };
    let choiceChs = chapters.filter(func(ch : Text) : Bool = sums.containsKey(ch)).map<Text, (Text, Int)>(func(ch : Text) : (Text, Int) = (ch, switch (sums.get(ch)) { case (?s) s; case null 0 }));
    { version; cells; quotes; chapters = chapterRes; lowestTotal = lowestIds(totCand); choice = { chosen; stale = stale.toArray(); chapters = choiceChs; total } };
  };

  func lowestIds(cand : [(Nat, Int)]) : [Nat] {
    if (cand.size() < 2) { return [] };
    var m = cand[0].1;
    for ((_, v) in cand.values()) { if (v < m) { m := v } };
    cand.filter(func((_, v) : (Nat, Int)) : Bool = v == m).map(func((id, _) : (Nat, Int)) : Nat = id);
  };
};
