// Postenbibliotheek (stap 2.2, architectuur §2.9; VOORLOPIG tot 0.3): eenheden, zoeken, volgorde, views en het rekenwerk
// van de verkoopprijs. Geen rechten hier: wie wat mag, beslist lib/Rights.mo; dit bestand rekent alleen. De interne views
// (hoofdstuk, post) dragen NOOIT een prijs; de prijsviews worden enkel gemaakt in de update-calls van LibraryApi.
import Array "mo:core/Array";
import Char "mo:core/Char";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Oa "Oa";

module {
  type LibItem = Types.LibItem;
  type LibCost = Types.LibCost;

  // ── Eenheden (D9: data, niet code; VOORLOPIG tot 0.3, B4) ────────────────
  func isUnitKey(k : Text) : Bool { k.startsWith(#text "unit:") };

  public func unitFromLookup(l : Types.Lookup) : Views.UnitView {
    { key = l.key; name = l.tag; order = l.order; archived = l.archivedAt != null };
  };

  public func lookupFromUnit(u : Views.UnitView, archivedAt : ?Int) : Types.Lookup {
    { list = "unit"; key = u.key; tag = u.name; order = u.order; var archivedAt = archivedAt; extra = [] };
  };

  public func defaultUnitList() : [Views.UnitView] {
    var i = 0;
    Config.defaultUnits().map(
      func((key, name) : (Text, Text)) : Views.UnitView {
        i += 1;
        { key; name; order = i * 10; archived = false };
      }
    );
  };

  // Zolang niemand de lijst aanpaste, geldt de standaard uit de code; daarna de bewaarde lijst.
  public func units(s : Types.SettingsState, withArchived : Bool) : [Views.UnitView] {
    let own = s.lookups.entries().filter(func((k, _) : (Text, Types.Lookup)) : Bool = isUnitKey(k)).map(func((_, l) : (Text, Types.Lookup)) : Views.UnitView = unitFromLookup(l)).toArray();
    let all = if (own.size() == 0) defaultUnitList() else own;
    all.filter(func u = withArchived or not u.archived).sort(func(a, b) = Nat.compare(a.order, b.order));
  };

  public func materializeUnits(s : Types.SettingsState) {
    if (s.lookups.keys().any(isUnitKey)) { return };
    for (u in defaultUnitList().values()) { s.lookups.add("unit:" # u.key, lookupFromUnit(u, null)) };
  };

  public func unitName(s : Types.SettingsState, key : Text) : Text {
    switch (units(s, true).find(func u = u.key == key)) { case (?u) u.name; case null key };
  };

  // Een sleutel: kleine letters, cijfers, "-", "/" en "²³" (m², d/lm); 1 tot 20 tekens.
  public func unitKeyOk(k : Text) : Bool {
    k.size() >= 1 and k.size() <= Config.maxShort and k.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-' or c == '/' or c == '²' or c == '³');
  };

  // ── Contractvorm ─────────────────────────────────────────────────────────
  public func formKey(f : Types.ContractForm) : Text {
    switch f {
      case (#fixed) "vaste prijs";
      case (#regie) "regie";
      case (#vh) "vermoedelijke hoeveelheid";
      case (#estimate) "raming";
      case (#budget) "budget";
      case (#perAttachment) "volgens bijlage";
    };
  };

  // ── Verkoopprijs ─────────────────────────────────────────────────────────
  // Marge op de VERKOOPprijs (B5): verkoop = aankoop / (1 − marge); 20 % → aankoop / 0,8 (zoals `/0.8` in 2026/231).
  // Afgerond op de cent (half naar boven). Vaste prijs: de prijs zelf, en de marge die daaruit volgt (kan negatief zijn).
  public func sellOf(cost : ?Int, rule : ?Types.LibSellRule, standardBp : Nat) : (?Int, ?Int) {
    let r : Types.LibSellRule = switch rule { case (?x) x; case null #margin(standardBp) };
    switch r {
      case (#margin m) {
        switch cost {
          case (?c) {
            let d : Int = 10_000 - m;
            if (d <= 0) { return (null, ?m) };
            (?((c * 10_000 + d / 2) / d), ?m);
          };
          case null (null, ?m);
        };
      };
      case (#price p) {
        switch cost {
          case (?c) { if (p > 0) (?p, ?(((p - c) * 10_000) / p)) else (?p, null) };
          case null (?p, null);
        };
      };
    };
  };

  public func ruleError(r : Types.LibSellRule) : ?Text {
    switch r {
      case (#margin m) { if (m > Config.maxLibMarginBp) ?"Marge: 0 tot 90 %" else null };
      case (#price p) { if (p < 0 or p > Config.maxAmountCents) ?"Verkoopprijs: tussen € 0 en € 1 miljard" else null };
    };
  };

  public func plainOf<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  public func standardMargin(s : Types.SettingsState) : Nat {
    switch (s.values.get("bib.margeBp")) {
      case (?v) { switch (Nat.fromText(v)) { case (?n) { if (n <= Config.maxLibMarginBp) n else Config.libMarginBpDefault }; case null Config.libMarginBpDefault } };
      case null Config.libMarginBpDefault;
    };
  };

  // ── Zoeken en volgorde ───────────────────────────────────────────────────
  // Titel, code en zoekwoorden zonder accenten en leestekens (Oa.fold), de lastenboektekst in kleine letters (lang: geen
  // fold per teken). Alle woorden van de zoekvraag moeten voorkomen ("tegel 60" vindt "Tegels 60x60").
  public func matches(lib : Types.LibraryState, it : LibItem, f : Views.LibFilter, words : [Text]) : Bool {
    if (it.archivedAt != null and not f.includeArchived) { return false };
    switch (f.chapterId) { case (?c) { if (it.chapterId != c) { return false } }; case null {} };
    switch (f.trade) { case (?t) { if (it.trade != ?t) { return false } }; case null {} };
    switch (f.unit) { case (?u) { if (it.unit != u) { return false } }; case null {} };
    switch (f.form) { case (?x) { if (it.form != x) { return false } }; case null {} };
    switch (f.orgId) { case (?o) { if (it.orgId != ?o) { return false } }; case null {} };
    if (words.size() == 0) { return true };
    let head = Oa.fold(it.title # " " # it.code # " " # it.keywords.values().join(" ") # " " # chapterTitle(lib, it.chapterId));
    var low : ?Text = null;
    words.all(
      func w {
        if (head.contains(#text (Oa.fold(w)))) { return true };
        let l = switch low { case (?x) x; case null { let x = Text.toLower(it.text); low := ?x; x } };
        l.contains(#text w);
      }
    );
  };

  public func queryWords(t : Text) : [Text] {
    Text.toLower(t).split(#char ' ').filter(func(w : Text) : Bool = w.size() > 0).toArray();
  };

  func chapterTitle(lib : Types.LibraryState, id : Nat) : Text {
    switch (lib.chapters.get(id)) { case (?c) c.title; case null "" };
  };

  // Natuurlijke volgorde van een code: "7.9" vóór "7.10" (cijferreeksen worden als getal vergeleken).
  public func codeKey(t : Text) : Text {
    var out = "";
    var digits = "";
    let flush = func() {
      if (digits.size() > 0) {
        var pad = digits;
        while (pad.size() < 8) { pad := "0" # pad };
        out #= pad;
        digits := "";
      };
    };
    for (c in Text.toLower(t).chars()) {
      if (c >= '0' and c <= '9') { digits #= Char.toText(c) } else { flush(); out #= Char.toText(c) };
    };
    flush();
    out;
  };

  public func compareItems(lib : Types.LibraryState) : (LibItem, LibItem) -> Order.Order {
    func(a, b) {
      let ca = lib.chapters.get(a.chapterId);
      let cb = lib.chapters.get(b.chapterId);
      let oa = switch ca { case (?c) c.order; case null 0 };
      let ob = switch cb { case (?c) c.order; case null 0 };
      let o1 = Nat.compare(oa, ob);
      if (o1 != #equal) { return o1 };
      let o2 = Nat.compare(a.chapterId, b.chapterId);
      if (o2 != #equal) { return o2 };
      let o3 = Text.compare(codeKey(a.code), codeKey(b.code));
      if (o3 != #equal) { return o3 };
      let o4 = Text.compare(Text.toLower(a.title), Text.toLower(b.title));
      if (o4 != #equal) { return o4 };
      Nat.compare(a.id, b.id);
    };
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public type Ctx = { settings : Types.SettingsState; access : Types.AccessState; org : Types.OrgState; lib : Types.LibraryState };

  func orgName(org : Types.OrgState, id : ?Nat) : Text {
    switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.name; case null "#" # x.toText() } }; case null "" };
  };

  public func chapterView(c : Types.LibChapter, items : Nat) : Views.LibChapterView {
    { id = c.id; code = c.code; title = c.title; order = c.order; note = c.note; archived = c.archivedAt != null; items };
  };

  public func itemView(x : Ctx, it : LibItem) : Views.LibItemView {
    let ch = x.lib.chapters.get(it.chapterId);
    {
      id = it.id;
      chapterId = it.chapterId;
      chapterCode = switch ch { case (?c) c.code; case null "" };
      chapterTitle = switch ch { case (?c) c.title; case null "" };
      code = it.code;
      title = it.title;
      text = it.text;
      unit = it.unit;
      unitName = unitName(x.settings, it.unit);
      form = it.form;
      trade = it.trade;
      orgId = it.orgId;
      orgName = orgName(x.org, it.orgId);
      durationDays = it.durationDays;
      perDayMilli = it.perDayMilli;
      planStepKey = it.planStepKey;
      keywords = it.keywords;
      importKey = it.importKey;
      version = it.version;
      updatedAt = it.updatedAt;
      updatedByName = Access.personName(x.access, it.updatedBy);
      archived = it.archivedAt != null;
      archiveReason = it.archiveReason;
    };
  };

  // Welke velden veranderden (namen, nooit waarden: de auditlog zegt WAT er veranderde, de versies bewaren hoe).
  public func changedFields(a : LibItem, b : LibItem) : Text {
    var out : [Text] = [];
    let add = func(n : Text, changed : Bool) { if (changed) { out := out.concat([n]) } };
    add("hoofdstuk", a.chapterId != b.chapterId);
    add("code", a.code != b.code);
    add("titel", a.title != b.title);
    add("tekst", a.text != b.text);
    add("eenheid", a.unit != b.unit);
    add("contractvorm", a.form != b.form);
    add("vakgebied", a.trade != b.trade);
    add("standaard-OA", a.orgId != b.orgId);
    add("duur", a.durationDays != b.durationDays or a.perDayMilli != b.perDayMilli);
    add("planningsstap", a.planStepKey != b.planStepKey);
    add("zoekwoorden", a.keywords != b.keywords);
    add("importsleutel", a.importKey != b.importKey);
    if (out.size() == 0) "niets gewijzigd" else out.values().join(", ");
  };

  // ── Aankoopprijzen (vertrouwelijk) ───────────────────────────────────────
  public func costView(x : Ctx, c : LibCost) : Views.LibCostView {
    {
      id = c.id;
      itemId = c.itemId;
      orgId = c.orgId;
      orgName = orgName(x.org, c.orgId);
      day = c.day;
      costCents = plainOf(c.cost);
      source = c.source;
      ref = c.ref;
      note = c.note;
      at = c.createdAt;
      byName = Access.personName(x.access, c.createdBy);
      archived = c.archivedAt != null;
      archiveReason = c.archiveReason;
    };
  };

  public func costsOf(lib : Types.LibraryState, itemId : Nat) : [LibCost] {
    let ids = switch (lib.costsByItem.get(itemId)) { case (?xs) xs; case null [] };
    ids.filterMap(func(id : Nat) : ?LibCost = lib.costs.get(id));
  };

  // Jonger = latere dag, bij dezelfde dag het hoogste id (later ingegeven).
  func newer(a : LibCost, b : LibCost) : Bool { a.day > b.day or (a.day == b.day and a.id > b.id) };

  public func latest(cs : [LibCost]) : ?LibCost {
    var best : ?LibCost = null;
    for (c in cs.values()) {
      if (c.archivedAt == null) {
        switch best { case (?b) { if (newer(c, b)) { best := ?c } }; case null { best := ?c } };
      };
    };
    best;
  };

  // De jongste prijs per OA (en één zonder OA), jongste eerst.
  public func latestPerOrg(cs : [LibCost]) : [LibCost] {
    let by = Map.empty<Nat, LibCost>(); // sleutel 0 = zonder OA (ids beginnen bij 1, D3)
    for (c in cs.values()) {
      if (c.archivedAt == null) {
        let k = switch (c.orgId) { case (?o) o; case null 0 };
        switch (by.get(k)) { case (?b) { if (newer(c, b)) { by.add(k, c) } }; case null by.add(k, c) };
      };
    };
    by.values().toArray().sort(func(a : LibCost, b : LibCost) : Order.Order = if (newer(a, b)) #less else if (newer(b, a)) #greater else #equal);
  };

  // De geldende aankoopprijs: de jongste van de standaard-OA van de post als die er is, anders de jongste van allemaal.
  public func currentCost(it : LibItem, cs : [LibCost]) : ?LibCost {
    switch (it.orgId) {
      case (?o) { switch (latest(cs.filter(func c = c.orgId == ?o))) { case (?c) return ?c; case null {} } };
      case null {};
    };
    latest(cs);
  };

  public func priceView(x : Ctx, it : LibItem, standardBp : Nat) : Views.LibPriceView {
    let cs = costsOf(x.lib, it.id);
    let cur = currentCost(it, cs);
    let sell = x.lib.sells.get(it.id);
    let rule : ?Types.LibSellRule = switch sell { case (?s) { switch (s.rule) { case (?r) plainOf(r); case null null } }; case null null };
    let costCents = switch cur { case (?c) plainOf(c.cost); case null null };
    let (sellCents, marginBp) = sellOf(costCents, rule, standardBp);
    {
      itemId = it.id;
      cost = switch cur { case (?c) ?costView(x, c); case null null };
      perOrg = latestPerOrg(cs).map(func c = costView(x, c));
      rule;
      marginBp;
      sellCents;
      reason = switch sell { case (?s) (plainOf(s.reason) ?? ""); case null "" };
      deviates = switch rule { case (?#margin m) m != standardBp; case (?#price _) true; case null false };
      sellVersion = switch sell { case (?s) s.version; case null 0 };
      costCount = cs.filter(func c = c.archivedAt == null).size();
    };
  };

  public func ruleText(r : ?Types.LibSellRule) : Text {
    switch r { case (?#margin _) "marge"; case (?#price _) "vaste prijs"; case null "standaardmarge" };
  };

  public func addCostIndex(lib : Types.LibraryState, itemId : Nat, costId : Nat) {
    let prev = switch (lib.costsByItem.get(itemId)) { case (?xs) xs; case null [] };
    if (prev.find(func i = i == costId) == null) { lib.costsByItem.add(itemId, prev.concat([costId])) };
  };

  public func sourceOk(s : Text) : Bool { Config.libCostSources().any(func((k, _) : (Text, Text)) : Bool = k == s) };

};
