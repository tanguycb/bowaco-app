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

  public func compare(i : TV.CmpInput) : TV.CmpResult {
    // Hoofdstukken in de volgorde van de posten.
    var chapters : [Text] = [];
    let chSeen = Map.empty<Text, Bool>();
    for (x in i.items.values()) { if (not chSeen.containsKey(x.chapter)) { chSeen.add(x.chapter, true); chapters := chapters.concat([x.chapter]) } };
    let hist = Map.empty<Nat, TV.CmpHistory>();
    for (h in i.history.values()) { hist.add(h.itemId, h) };
    let thr : Int = i.thresholdBp;

    // 1. Cellen (post × firma), zonder "laagste".
    type Raw = { itemId : Nat; oaQuoteId : Nat; state : Text; unitCents : ?Int; amountCents : ?Int; alt : Bool; vhChanged : Bool; unitChanged : Bool; devLastBp : ?Int; devMedianBp : ?Int; deviates : Bool };
    var raw : [Raw] = [];
    for (x in i.items.values()) {
      for (q in i.quotes.values()) {
        let empty : Raw = { itemId = x.id; oaQuoteId = q.id; state = "ontbreekt"; unitCents = null; amountCents = null; alt = false; vhChanged = false; unitChanged = false; devLastBp = null; devMedianBp = null; deviates = false };
        let cell : Raw = if (q.form != "posten") { { empty with state = "geen-detail" } } else {
          switch (q.lines.find(func(l : Types.OaQuoteLine) : Bool = l.itemId == ?x.id)) {
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
                  var dm : ?Int = null;
                  switch (hist.get(x.id)) {
                    case (?h) {
                      switch (h.lastByOrg.find(func((o, _) : (Nat, Int)) : Bool = o == q.orgId)) { case (?(_, last)) { dl := devBp(u, last) }; case null {} };
                      switch (median(h.recent)) { case (?m) { dm := devBp(u, m) }; case null {} };
                    };
                    case null {};
                  };
                  let off = func(d : ?Int) : Bool = switch d { case (?v) abs(v) > thr; case null false };
                  { empty with state = "prijs"; unitCents = ?u; amountCents = ?QuoteCalc.roundDiv(u * x.qtyMilli, 1_000); alt; vhChanged = vh; unitChanged = un; devLastBp = dl; devMedianBp = dm; deviates = off(dl) or off(dm) };
                };
              };
            };
          };
        };
        raw := raw.concat([cell]);
      };
    };
    let comparable = func(c : Raw) : Bool = c.state == "prijs" and not c.alt and not c.unitChanged;

    // 2. Laagste per post (minstens twee vergelijkbare prijzen).
    let lowestOf = Map.empty<Nat, Int>();
    for (x in i.items.values()) {
      let cs = raw.filter(func(c : Raw) : Bool = c.itemId == x.id and comparable(c));
      if (cs.size() >= 2) {
        var m : Int = 0;
        var first = true;
        for (c in cs.values()) { switch (c.amountCents) { case (?a) { if (first or a < m) { m := a; first := false } }; case null {} } };
        lowestOf.add(x.id, m);
      };
    };
    let cells = raw.map(func(c : Raw) : TV.CmpCell {
      let low = comparable(c) and (switch (lowestOf.get(c.itemId), c.amountCents) { case (?m, ?a) a == m; case _ false });
      { itemId = c.itemId; oaQuoteId = c.oaQuoteId; state = c.state; unitCents = c.unitCents; amountCents = c.amountCents; alt = c.alt; vhChanged = c.vhChanged; unitChanged = c.unitChanged; lowest = low; devLastBp = c.devLastBp; devMedianBp = c.devMedianBp; deviates = c.deviates };
    });
    let cellOf = func(itemId : Nat, qid : Nat) : ?TV.CmpCell = cells.find(func(c : TV.CmpCell) : Bool = c.itemId == itemId and c.oaQuoteId == qid);
    let chapterOf = Map.empty<Nat, Text>();
    for (x in i.items.values()) { chapterOf.add(x.id, x.chapter) };

    // 3. Totalen per firma.
    let nItems = i.items.size();
    let quotes = i.quotes.map(func(q : TV.CmpQuote) : TV.CmpQuoteTotals {
      let disc = func(g : Int) : Int = switch (q.discountBp) { case (?bp) { if (bp == 0) 0 else QuoteCalc.roundDiv(g * bp, 10_000) }; case null 0 };
      if (q.form == "posten") {
        var chs : [(Text, Int)] = [];
        var priced = 0;
        var gross : Int = 0;
        for (ch in chapters.values()) {
          var sum : Int = 0;
          var any = false;
          for (x in i.items.values()) {
            if (x.chapter == ch) {
              switch (cellOf(x.id, q.id)) { case (?c) { switch (c.amountCents) { case (?a) { sum += a; any := true; priced += 1 }; case null {} } }; case null {} };
            };
          };
          if (any) { chs := chs.concat([(ch, sum)]); gross += sum };
        };
        var own : Int = 0;
        for (l in q.lines.values()) { if (l.itemId == null) { switch (l.amountCents) { case (?a) { own += a }; case null {} } } };
        gross += own;
        let d = disc(gross);
        { oaQuoteId = q.id; chapters = chs; ownCents = own; gross; discount = d; net = gross - d; priced; items = nItems; complete = priced == nItems };
      } else if (q.form == "hoofdstukken") {
        var gross : Int = 0;
        for ((_, v) in q.chapterTotals.values()) { gross += v };
        let d = disc(gross);
        let complete = chapters.all(func(ch : Text) : Bool = q.chapterTotals.find(func((n, _) : (Text, Int)) : Bool = n == ch) != null);
        { oaQuoteId = q.id; chapters = q.chapterTotals; ownCents = 0; gross; discount = d; net = gross - d; priced = 0; items = nItems; complete };
      } else {
        { oaQuoteId = q.id; chapters = []; ownCents = 0; gross = q.netCents; discount = 0; net = q.netCents; priced = 0; items = nItems; complete = true };
      };
    });

    // 4. Laagste per hoofdstuk en in totaal (enkel volledige firma's, minstens twee).
    let chapterRes = chapters.map(func(ch : Text) : TV.CmpChapter {
      var cand : [(Nat, Int)] = [];
      for ((k, q) in i.quotes.enumerate()) {
        let t = quotes[k];
        let full = if (q.form == "posten") {
          i.items.filter(func(x : TV.CmpItem) : Bool = x.chapter == ch).all(func(x : TV.CmpItem) : Bool = switch (cellOf(x.id, q.id)) { case (?c) c.state == "prijs" and not c.unitChanged; case null false });
        } else if (q.form == "hoofdstukken") { q.chapterTotals.find(func((n, _) : (Text, Int)) : Bool = n == ch) != null } else false;
        if (full) {
          switch (t.chapters.find(func((n, _) : (Text, Int)) : Bool = n == ch)) { case (?(_, v)) { cand := cand.concat([(q.id, v)]) }; case null {} };
        };
      };
      { chapter = ch; lowest = lowestIds(cand) };
    });
    let totCand = quotes.filter(func(t : TV.CmpQuoteTotals) : Bool = t.complete).map<TV.CmpQuoteTotals, (Nat, Int)>(func(t : TV.CmpQuoteTotals) : (Nat, Int) = (t.oaQuoteId, t.net));

    // 5. De keuze.
    var chosen = 0;
    var stale : [Nat] = [];
    let sums = Map.empty<Text, Int>();
    var total : Int = 0;
    for (p in i.picks.values()) {
      switch (cellOf(p.itemId, p.oaQuoteId)) {
        case (?c) {
          switch (c.amountCents) {
            case (?a) {
              chosen += 1;
              total += a;
              let ch = switch (chapterOf.get(p.itemId)) { case (?x) x; case null "" };
              sums.add(ch, (switch (sums.get(ch)) { case (?s) s; case null 0 }) + a);
            };
            case null { stale := stale.concat([p.itemId]) };
          };
        };
        case null { stale := stale.concat([p.itemId]) };
      };
    };
    let choiceChs = chapters.filter(func(ch : Text) : Bool = sums.containsKey(ch)).map<Text, (Text, Int)>(func(ch : Text) : (Text, Int) = (ch, switch (sums.get(ch)) { case (?s) s; case null 0 }));
    { version; cells; quotes; chapters = chapterRes; lowestTotal = lowestIds(totCand); choice = { chosen; stale; chapters = choiceChs; total } };
  };

  func lowestIds(cand : [(Nat, Int)]) : [Nat] {
    if (cand.size() < 2) { return [] };
    var m = cand[0].1;
    for ((_, v) in cand.values()) { if (v < m) { m := v } };
    cand.filter(func((_, v) : (Nat, Int)) : Bool = v == m).map(func((id, _) : (Nat, Int)) : Nat = id);
  };
};
