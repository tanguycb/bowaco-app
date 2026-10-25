// Controleregels vóór verzending (stap 2.6, bouwplan §8.5 en §9 rij 2.6; VOORLOPIG: vragen voor Alexis).
// DEZELFDE regels als src/frontend/src/quote/rules.ts: de browser toont ze live in de editor, de backend voert ze uit bij
// het versturen (sendQuoteVersion) en weigert bij een blokkering; tests/regels.mjs vergelijkt beide op willekeurige offertes.
// Elke regel is een waarschuwing of een blokkering. De beheerder zet regels aan of uit, kiest de ernst, past de drempel
// van de marge aan en beheert de standaardposten (Instellingen); de "vaste" regels (geen post, geen prijs, totaal nul) zijn
// de integriteit van de offerte en blijven altijd blokkeren. Een bevinding draagt nooit een bedrag: enkel de regel, hoeveel
// lijnen en welke (hoogstens `maxIds`).
// Een standaardpost telt als aanwezig als een POST (geen optie, geen tekstregel) een van zijn woorden draagt in de titel,
// de code of het hoofdstuk. Woorden worden vergeleken na normalisatie (kleine letters, letters en cijfers, een spatie
// tussen woorden): een woord van minder dan 4 tekens moet een heel woord zijn ("pid"), een langer woord mag het begin
// zijn ("afval" vindt "afvalcontainer").
import Array "mo:core/Array";
import Char "mo:core/Char";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Config "Config";
import QuoteCalc "QuoteCalc";

module {
  public let maxIds : Nat = 20;

  public type Severity = Types.QuoteSeverity;

  // De werkelijke instelling van één regel (standaard of door de beheerder gezet).
  public type RuleSet = { key : Text; name : Text; fixed : Bool; enabled : Bool; severity : Severity; thresholdBp : ?Nat };

  public type Chapter = { id : Nat; code : Text; title : Text };
  public type Line = { id : Nat; chapter : Nat; kind : QuoteCalc.Kind; code : Text; title : Text; qtyMilli : Int; cost : ?Int; rule : ?QuoteCalc.Rule; reason : Text };

  public type Input = {
    chapters : [Chapter];
    lines : [Line];
    standardBp : Nat;
    vatBp : Nat;
    workVatBp : Nat;
    vatNote : Text; // de grond voor het btw-tarief op de werffiche
    clientSet : Bool;
    clientAddressOk : Bool;
  };

  public type Finding = { rule : Text; name : Text; severity : Severity; count : Nat; lineIds : [Nat]; chapterIds : [Nat] };

  // ── Instellingen ────────────────────────────────────────────────────────
  func sev(block : Bool) : Severity { if block #block else #warn };

  // De regels zoals ze nu gelden: de standaard, overschreven door wat de beheerder zette.
  public func ruleSets(cs : Types.QuoteChecksState) : [RuleSet] {
    Config.quoteRuleDefaults().map(
      func((key, name, fixed, block, thr) : (Text, Text, Bool, Bool, ?Nat)) : RuleSet {
        if fixed { return { key; name; fixed; enabled = true; severity = #block; thresholdBp = null } };
        switch (cs.rules.get(key)) {
          case (?c) { { key; name; fixed; enabled = c.enabled; severity = c.severity; thresholdBp = switch (thr) { case null null; case (?_) c.thresholdBp } } };
          case null { { key; name; fixed; enabled = true; severity = sev(block); thresholdBp = thr } };
        };
      }
    );
  };

  // De standaardposten: staat er niets in de Map, dan gelden de standaarden; anders enkel wat daar staat.
  public func stdPosts(cs : Types.QuoteChecksState, withArchived : Bool) : [Types.QuoteStdPost] {
    if (cs.stdPosts.size() == 0) {
      let now : Int = 0;
      return Config.quoteStdPostDefaults().enumerate().map(
        func((i, (key, name, kw)) : (Nat, (Text, Text, [Text]))) : Types.QuoteStdPost = { key; name; keywords = kw; enabled = true; severity = #warn; order = i; updatedAt = now; updatedBy = 0; archivedAt = null }
      ).toArray();
    };
    cs.stdPosts.values().filter(func s = withArchived or s.archivedAt == null).toArray().sort(
      func(a, b) = switch (Nat.compare(a.order, b.order)) { case (#equal) Text.compare(a.key, b.key); case o o }
    );
  };

  // ── Tekst normaliseren (identiek aan rules.ts) ──────────────────────────
  public func norm(t : Text) : Text {
    var out = "";
    var pending = false;
    var any = false;
    for (c in Text.toLower(t).chars()) {
      let word = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c > '\u{7f}';
      if word {
        if (pending and any) { out #= " " };
        out #= Char.toText(c);
        any := true;
        pending := false;
      } else { pending := true };
    };
    out;
  };

  func hasKeyword(haystack : Text, kw : Text) : Bool {
    let k = norm(kw);
    if (k.size() == 0) { return false };
    let h = " " # haystack # " ";
    if (k.size() >= 4) Text.contains(h, #text(" " # k)) else Text.contains(h, #text(" " # k # " "));
  };

  // ── Uitvoeren ───────────────────────────────────────────────────────────
  public func evaluate(i : Input, rules : [RuleSet], std : [Types.QuoteStdPost]) : [Finding] {
    var found : [Finding] = [];
    let std0 = i.standardBp;
    let calcLines = i.lines.map(func(l : Line) : QuoteCalc.Line = { chapter = l.chapter; kind = l.kind; qtyMilli = l.qtyMilli; cost = l.cost; rule = l.rule });
    let t = QuoteCalc.totals(i.chapters.map(func c = c.id), calcLines, i.vatBp, std0);
    let outs = i.lines.map(func(l : Line) : QuoteCalc.LineOut = QuoteCalc.line({ chapter = l.chapter; kind = l.kind; qtyMilli = l.qtyMilli; cost = l.cost; rule = l.rule }, std0));
    let items = i.lines.filter(func l = l.kind == #item);

    func add(r : RuleSet, name : Text, ls : [Line], chs : [Chapter]) {
      let ids = Array.tabulate<Nat>(Nat.min(ls.size(), maxIds), func k = ls[k].id);
      let cids = Array.tabulate<Nat>(Nat.min(chs.size(), maxIds), func k = chs[k].id);
      found := found.concat([{ rule = r.key; name; severity = r.severity; count = ls.size() + chs.size(); lineIds = ids; chapterIds = cids }]);
    };
    // De lijnen waarvoor `f(index, lijn, uitkomst)` klopt, in de volgorde van de offerte.
    func pick(f : (Line, QuoteCalc.LineOut) -> Bool) : [Line] {
      var r : [Line] = [];
      for ((k, l) in i.lines.enumerate()) { if (f(l, outs[k])) { r := r.concat([l]) } };
      r;
    };
    func flag(r : RuleSet) { found := found.concat([{ rule = r.key; name = r.name; severity = r.severity; count = 1; lineIds = []; chapterIds = [] }]) };

    for (r in rules.values()) {
      if (r.enabled) {
        switch (r.key) {
          case "no-posts" { if (items.size() == 0) { flag(r) } };
          case "no-price" { if (t.noPrice > 0) add(r, r.name, pick(func(_, o) = o.noPrice), []) };
          case "total-zero" { if (items.size() > 0 and t.total <= 0) { flag(r) } };
          case "client-missing" { if (not i.clientSet) { flag(r) } };
          case "client-address" { if (i.clientSet and not i.clientAddressOk) { flag(r) } };
          case "vat-ground" { if (i.vatBp == 600 and i.vatNote.trim(#char ' ').size() == 0) { flag(r) } };
          case "vat-differs" { if (i.vatBp != i.workVatBp) { flag(r) } };
          case "qty-zero" { let ls = pick(func(l, _) = (l.kind == #item or l.kind == #option) and l.qtyMilli == 0); if (ls.size() > 0) add(r, r.name, ls, []) };
          case "qty-negative" { let ls = pick(func(l, _) = l.kind == #item and l.qtyMilli < 0); if (ls.size() > 0) add(r, r.name, ls, []) };
          case "margin-unknown" {
            let ls = pick(func(l, _) = l.kind != #text and l.cost == null and (switch (l.rule) { case (?#price _) true; case _ false }));
            if (ls.size() > 0) add(r, r.name, ls, []);
          };
          case "margin-low" {
            let thr : Int = switch (r.thresholdBp) { case (?x) x; case null 0 };
            let ls = pick(func(l, o) = l.kind != #text and not o.negative and (switch (o.marginBp) { case (?m) m < thr; case null false }));
            if (ls.size() > 0) add(r, r.name, ls, []);
          };
          case "below-cost" { let ls = pick(func(l, o) = l.kind != #text and o.negative); if (ls.size() > 0) add(r, r.name, ls, []) };
          case "no-reason" { let ls = pick(func(l, o) = l.kind != #text and o.deviates and l.reason == ""); if (ls.size() > 0) add(r, r.name, ls, []) };
          case "chapter-empty" {
            let empty = i.chapters.filter(func c = items.find(func l = l.chapter == c.id) == null);
            if (empty.size() > 0) add(r, r.name, [], empty);
          };
          case _ {};
        };
      };
    };
    // Standaardposten: één bevinding per ontbrekende post.
    let hay = Map.empty<Nat, Text>(); // hoofdstuk → genormaliseerde titel
    for (c in i.chapters.values()) { hay.add(c.id, norm(c.title)) };
    let texts = items.map(func l = norm((switch (hay.get(l.chapter)) { case (?h) h; case null "" }) # " " # l.code # " " # l.title));
    for (s in std.values()) {
      if (s.enabled and s.archivedAt == null) {
        let present = texts.any(func h = s.keywords.any(func kw = hasKeyword(h, kw)));
        if (not present) {
          found := found.concat([{ rule = "std:" # s.key; name = s.name; severity = s.severity; count = 1; lineIds = []; chapterIds = [] }]);
        };
      };
    };
    found;
  };

  public func blocks(fs : [Finding]) : [Finding] { fs.filter(func f = f.severity == #block) };
  public func warnings(fs : [Finding]) : [Finding] { fs.filter(func f = f.severity == #warn) };

  // Eén zin per bevinding voor een foutmelding: "Posten zonder prijs (3)".
  public func describe(fs : [Finding]) : Text {
    var out = "";
    for (f in fs.values()) {
      if (out.size() > 0) { out #= "; " };
      out #= f.name # (if (f.count > 1) " (" # f.count.toText() # ")" else "");
    };
    out;
  };

  public func counts(fs : [Finding]) : [(Text, Nat)] { fs.map(func f = (f.rule, f.count)) };

  // Alles of niets bij het bewaren van de instellingen.
  public func validThreshold(bp : Nat) : Bool { bp <= 9_000 };
  public func intText(i : Int) : Text { Int.toText(i) };
};
