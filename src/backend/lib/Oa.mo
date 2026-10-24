// Onderaannemers-database (stap 1.2): vakgebieden, zoeken, views en de import. Geen rechten hier: wie wat
// mag, beslist lib/Rights.mo; dit bestand rekent alleen.
//
// De import (R32) is idempotent en in twee stappen: een proefronde (dryRun) die niets bewaart en
// een echte ronde. Een rij wordt herkend aan het KBO-nummer of aan een naam of alias die al bij
// een firma hoort (hoofdletters, accenten en leestekens tellen niet mee). Wat al bestond wordt
// nooit overschreven: er komen alleen aliassen, vakgebieden, contactgegevens en personen bij. Twee keer
// dezelfde rij draaien geeft dus de tweede keer "ongewijzigd".
import Array "mo:core/Array";
import Char "mo:core/Char";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Ids "Ids";

module {
  // ── Tekst vergelijken ───────────────────────────────────────────────────
  // Kleine letters, accenten weg, enkel a-z en 0-9: "G&B Saegerman-De Smet" = "gbsaegermandesmet".
  public func fold(t : Text) : Text {
    var out = "";
    for (c in Text.toLower(t).chars()) {
      let m : Text = switch c {
        case 'é' "e"; case 'è' "e"; case 'ê' "e"; case 'ë' "e";
        case 'á' "a"; case 'à' "a"; case 'â' "a"; case 'ä' "a";
        case 'ï' "i"; case 'î' "i"; case 'í' "i";
        case 'ö' "o"; case 'ô' "o"; case 'ó' "o";
        case 'ü' "u"; case 'û' "u"; case 'ù' "u"; case 'ú' "u";
        case 'ç' "c"; case 'ñ' "n";
        case _ "";
      };
      if (m != "") { out #= m } else if ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9')) { out #= Char.toText(c) };
    };
    out;
  };

  public func cleanAlias(a : Text) : ?Text { Access.cleanText(Text.toUpper(a), Config.maxShort) };

  public func normKbo(k : ?Text) : { #ok : ?Text; #err : Text } {
    switch k {
      case null #ok(null);
      case (?x) {
        let digits = Text.fromIter(x.chars().filter(func c = c >= '0' and c <= '9'));
        if (digits.size() == 0) #ok(null) else if (digits.size() == 10) #ok(?digits) else if (digits.size() == 9) #ok(?("0" # digits)) else #err("KBO-nummer: 10 cijfers");
      };
    };
  };

  public func normEmail(e : ?Text) : { #ok : ?Text; #err : Text } {
    switch (Access.optText(e, Config.maxEmail)) {
      case null #ok(null);
      case (?x) {
        let l = Text.toLower(x);
        let parts = l.split(#char '@').toArray();
        // 1b.5 (L3): geen witruimte, stuurtekens of tekens die in een mailkop een structuur hebben (<>()[],;:"\): zo'n
        // adres komt nooit bij de maildienst terecht (geen tweede ontvanger of kopregel via een adresveld).
        let odd = l.chars().any(func c = Char.toNat32(c) < 33 or Char.toNat32(c) == 127 or c == '<' or c == '>' or c == '(' or c == ')' or c == '[' or c == ']' or c == ',' or c == ';' or c == ':' or c == '\"' or c == '\\');
        if (parts.size() != 2 or parts[0].size() == 0 or not parts[1].contains(#char '.') or odd) { #err("E-mailadres klopt niet: " # x) } else { #ok(?l) };
      };
    };
  };

  // ── Vakgebieden (D9: data, niet code) ───────────────────────────────────
  func isTradeKey(k : Text) : Bool { k.startsWith(#text "trade:") };

  public func tradeFromLookup(l : Types.Lookup) : Views.TradeView {
    { key = l.key; name = l.tag; order = l.order; archived = l.archivedAt != null };
  };

  public func lookupFromTrade(t : Views.TradeView, archivedAt : ?Int) : Types.Lookup {
    { list = "trade"; key = t.key; tag = t.name; order = t.order; var archivedAt = archivedAt; extra = [] };
  };

  public func defaultTradeList() : [Views.TradeView] {
    var i = 0;
    Config.defaultTrades().map(
      func((key, name) : (Text, Text)) : Views.TradeView {
        i += 1;
        { key; name; order = i * 10; archived = false };
      }
    );
  };

  public func trades(s : Types.SettingsState, withArchived : Bool) : [Views.TradeView] {
    let own = s.lookups.entries().filter(func((k, _) : (Text, Types.Lookup)) : Bool = isTradeKey(k)).map(func((_, l) : (Text, Types.Lookup)) : Views.TradeView = tradeFromLookup(l)).toArray();
    let all = if (own.size() == 0) defaultTradeList() else own;
    all.filter(func t = withArchived or not t.archived).sort(func(a, b) = Nat.compare(a.order, b.order));
  };

  public func materializeTrades(s : Types.SettingsState) {
    if (s.lookups.keys().any(isTradeKey)) { return };
    for (t in defaultTradeList().values()) { s.lookups.add("trade:" # t.key, lookupFromTrade(t, null)) };
  };

  // Alleen actieve vakgebieden mogen aan een firma gehangen worden; een gearchiveerd vakgebied dat er al aan hangt blijft staan.
  public func tradeError(s : Types.SettingsState, wanted : [Text], already : [Text]) : ?Text {
    if (wanted.size() > Config.maxTradesPerOrg) { return ?"Te veel vakgebieden" };
    let active = trades(s, false);
    for (t in wanted.values()) {
      if (active.find(func a = a.key == t) == null and already.find(func a = a == t) == null) { return ?("Onbekend vakgebied: " # t) };
    };
    null;
  };

  // ── Views ───────────────────────────────────────────────────────────────
  public func orgView(o : Types.Org) : Views.OrgView {
    {
      id = o.id;
      kind = o.kind;
      name = o.name;
      kbo = o.kbo;
      vat = o.vat;
      aliases = o.aliases;
      trades = o.trades;
      address = o.address;
      notes = o.notes;
      createdAt = o.createdAt;
      createdBy = o.createdBy;
      archivedAt = o.archivedAt;
    };
  };

  public func contactView(c : Types.OrgContact) : Views.OrgContactView {
    { phone = c.phone; email = c.email; website = c.website; contactNote = c.contactNote; updatedAt = c.updatedAt };
  };

  public func personView(access : Types.AccessState, oa : Types.OaState, p : Types.Person) : Views.OaPersonView {
    let c = oa.personContacts.get(p.id);
    {
      id = p.id;
      orgId = switch (p.orgId) { case (?o) o; case null 0 };
      name = p.name;
      shortCode = p.shortCode;
      phone = p.phone;
      email = switch c { case (?x) x.email; case null null };
      jobTitle = switch c { case (?x) x.jobTitle; case null "" };
      note = switch c { case (?x) x.note; case null "" };
      hasLogin = Access.hasActiveLink(access, p.id) or access.links.values().any(func l = l.personId == p.id and l.status == #pending);
      archivedAt = p.archivedAt;
    };
  };

  // Tot de database horen alle externe firma's behalve klanten (die zijn vertrouwelijk) en BOWACO zelf.
  public func inDirectory(k : Types.OrgKind) : Bool {
    switch k { case (#client) false; case (#bowaco) false; case _ true };
  };

  public func oaView(access : Types.AccessState, oa : Types.OaState, o : Types.Org) : Views.OaView {
    {
      org = orgView(o);
      contact = switch (oa.orgContacts.get(o.id)) { case (?c) ?contactView(c); case null null };
      persons = access.persons.values().filter(func p = p.orgId == ?o.id).map(func p = personView(access, oa, p)).toArray();
    };
  };

  // Zoeken: naam, alias, KBO, btw, contactpersonen (naam, code) en vakgebiedsnaam; accenten en leestekens tellen niet mee.
  public func matches(access : Types.AccessState, oa : Types.OaState, settings : Types.SettingsState, o : Types.Org, f : Views.OaFilter) : Bool {
    if (not inDirectory(o.kind)) { return false };
    if (o.archivedAt != null and not f.includeArchived) { return false };
    switch (f.kind) { case (?k) { if (o.kind != k) { return false } }; case null {} };
    switch (f.trade) { case (?t) { if (o.trades.find(func x = x == t) == null) { return false } }; case null {} };
    let q = switch (f.text) { case (?t) fold(t); case null "" };
    if (q == "") { return true };
    let has = func(t : Text) : Bool = fold(t).contains(#text q);
    if (has(o.name) or o.aliases.any(has)) { return true };
    switch (o.kbo) { case (?k) { if (k.contains(#text q)) { return true } }; case null {} };
    switch (o.vat) { case (?v) { if (has(v)) { return true } }; case null {} };
    switch (oa.orgContacts.get(o.id)) {
      case (?c) {
        switch (c.email) { case (?e) { if (has(e)) { return true } }; case null {} };
        switch (c.phone) { case (?e) { if (has(e)) { return true } }; case null {} };
      };
      case null {};
    };
    let tradeNames = trades(settings, true);
    if (o.trades.any(func k = switch (tradeNames.find(func t = t.key == k)) { case (?t) has(t.name); case null false })) { return true };
    access.persons.values().any(
      func p = p.orgId == ?o.id and (has(p.name) or (switch (p.shortCode) { case (?s) has(s); case null false }) or (switch (oa.personContacts.get(p.id)) { case (?c) (switch (c.email) { case (?e) has(e); case null false }); case null false }))
    );
  };

  // ── Uniekheid ───────────────────────────────────────────────────────────
  // Een planningcode hoort bij één firma, een KBO-nummer ook (anders is de koppeling in 1.5 dubbelzinnig).
  public func clash(org : Types.OrgState, selfId : Nat, kbo : ?Text, aliases : [Text]) : ?Text {
    for (o in org.orgs.values()) {
      if (o.id != selfId and o.archivedAt == null) {
        switch (kbo, o.kbo) { case (?a, ?b) { if (a == b) { return ?("KBO-nummer " # a # " hoort al bij " # o.name) } }; case _ {} };
        for (a in aliases.values()) {
          let fa = fold(a);
          if (fa != "" and o.aliases.any(func x = fold(x) == fa)) { return ?("Code " # a # " hoort al bij " # o.name) };
        };
      };
    };
    null;
  };

  // ── Import ──────────────────────────────────────────────────────────────
  public type ImportCtx = {
    org : Types.OrgState;
    access : Types.AccessState;
    oa : Types.OaState;
    settings : Types.SettingsState;
    ctr : Types.Counters;
  };

  // Werkkopie van een firma tijdens één oproep: in de proefronde de enige plaats waar wijzigingen komen.
  type W = {
    ref : Nat; // plaats in de werklijst
    var id : Nat; // 0 = nieuw, nog niet bewaard
    kind : Types.OrgKind;
    var name : Text;
    var kbo : ?Text;
    var vat : ?Text;
    var aliases : [Text];
    var trades : [Text];
    var notes : Text;
    archived : Bool;
    var phone : ?Text;
    var email : ?Text;
    var website : ?Text;
    var persons : [(Text, Text)]; // (naam gevouwen, code gevouwen)
    var personsLoaded : Bool;
    var pending : [Views.ImportPerson]; // nog aan te maken
  };

  func keysOf(name : Text, aliases : [Text]) : [Text] {
    [fold(name)].concat(aliases.map(fold)).filter(func x = x != "");
  };

  func overlap(a : [Text], b : [Text]) : Bool { a.any(func x = b.any(func y = x == y)) };

  func workOf(ref : Nat, oa : Types.OaState, o : Types.Org) : W {
    let c = oa.orgContacts.get(o.id);
    {
      ref;
      var id = o.id;
      kind = o.kind;
      var name = o.name;
      var kbo = o.kbo;
      var vat = o.vat;
      var aliases = o.aliases;
      var trades = o.trades;
      var notes = o.notes;
      archived = o.archivedAt != null;
      var phone = switch c { case (?x) x.phone; case null null };
      var email = switch c { case (?x) x.email; case null null };
      var website = switch c { case (?x) x.website; case null null };
      var persons = [];
      var personsLoaded = false;
      var pending = [];
    };
  };

  func loadPersons(access : Types.AccessState, w : W) {
    if (w.personsLoaded) { return };
    w.personsLoaded := true;
    w.persons := access.persons.values().filter(func p = p.orgId == ?w.id).map(func p = (fold(p.name), switch (p.shortCode) { case (?s) fold(s); case null "" })).toArray();
  };

  func invalid(key : Text, why : Text) : Views.ImportResult { { key; outcome = #invalid(why); orgId = null; changes = [] } };

  public func runImport(c : ImportCtx, by : Types.Person, dryRun : Bool, rows : [Views.ImportRow]) : Views.ImportReport {
    let work = List.empty<W>();
    for (o in c.org.orgs.values()) { work.add(workOf(work.size(), c.oa, o)) };
    let out = List.empty<Views.ImportResult>();
    let now = Time.now();
    var created = 0;
    var updated = 0;
    var unchanged = 0;
    var conflicts = 0;
    var bad = 0;
    for (row in rows.values()) {
      let r = importRow(c, by, dryRun, work, row, now);
      switch (r.outcome) {
        case (#created) created += 1;
        case (#updated) updated += 1;
        case (#unchanged) unchanged += 1;
        case (#conflict _) conflicts += 1;
        case (#invalid _) bad += 1;
      };
      out.add(r);
    };
    { dryRun; results = out.toArray(); created; updated; unchanged; conflicts; invalid = bad };
  };

  func importRow(c : ImportCtx, by : Types.Person, dryRun : Bool, work : List.List<W>, row : Views.ImportRow, now : Int) : Views.ImportResult {
    let key = row.key;
    // 1. Invoer nakijken (D10)
    let name = switch (Access.cleanText(row.name, Config.maxName)) { case (?n) n; case null return invalid(key, "Naam: 1 tot " # Config.maxName.toText() # " tekens") };
    if (not inDirectory(row.kind)) { return invalid(key, "Soort hoort niet in de database (klant of BOWACO)") };
    let kbo = switch (normKbo(row.kbo)) { case (#ok k) k; case (#err e) return invalid(key, e) };
    let aliases = row.aliases.filterMap(cleanAlias);
    if (aliases.size() > Config.maxAliases) { return invalid(key, "Te veel codes") };
    switch (tradeError(c.settings, row.trades, [])) { case (?e) return invalid(key, e); case null {} };
    let email = switch (normEmail(row.email)) { case (#ok e) e; case (#err e) return invalid(key, e) };
    let phone = Access.optText(row.phone, 30);
    let website = Access.optText(row.website, Config.maxWebsite);
    let vat = Access.optText(row.vat, 20);
    if (row.notes.size() > Config.maxText) { return invalid(key, "Notities te lang") };
    if (row.persons.size() > Config.maxPersonsPerOrg) { return invalid(key, "Te veel personen") };
    let persons = List.empty<Views.ImportPerson>();
    for (p in row.persons.values()) {
      let pn = switch (Access.cleanText(p.name, Config.maxName)) { case (?n) n; case null return invalid(key, "Persoon: naam 1 tot " # Config.maxName.toText() # " tekens") };
      let pe = switch (normEmail(p.email)) { case (#ok e) e; case (#err e) return invalid(key, e) };
      persons.add({ name = pn; shortCode = switch (Access.optText(p.shortCode, Config.maxShort)) { case (?s) ?Text.toUpper(s); case null null }; phone = Access.optText(p.phone, 30); email = pe; jobTitle = switch (Access.cleanText(p.jobTitle, Config.maxJobTitle)) { case (?j) j; case null "" } });
    };

    // 2. Welke bestaande firma's raakt deze rij?
    let rowKeys = keysOf(name, aliases);
    let cands = List.empty<W>();
    for (w in work.values()) {
      let kboSame = switch (kbo, w.kbo) { case (?a, ?b) a == b; case _ false };
      if (kboSame or overlap(rowKeys, keysOf(w.name, w.aliases))) { cands.add(w) };
    };
    if (cands.size() > 1) {
      return { key; outcome = #conflict("Raakt meerdere firma's: " # Text.join(cands.values().map(func w = w.name), ", ")); orgId = null; changes = [] };
    };

    let isNew = cands.size() == 0;
    let w : W = if (isNew) {
      {
        ref = work.size();
        var id = 0;
        kind = row.kind;
        var name;
        var kbo = null;
        var vat = null;
        var aliases = [];
        var trades = [];
        var notes = "";
        archived = false;
        var phone = null;
        var email = null;
        var website = null;
        var persons = [];
        var personsLoaded = true;
        var pending = [];
      };
    } else { cands.at(0) };
    if (not isNew) {
      if (w.archived) { return { key; outcome = #conflict("Firma " # w.name # " is gearchiveerd; zet ze eerst terug"); orgId = ?w.id; changes = [] } };
      if (w.kind != row.kind) { return { key; outcome = #conflict("Soort verschilt van de bestaande firma " # w.name); orgId = ?w.id; changes = [] } };
      switch (kbo, w.kbo) { case (?a, ?b) { if (a != b) { return { key; outcome = #conflict("KBO-nummer verschilt van dat van " # w.name); orgId = ?w.id; changes = [] } } }; case _ {} };
      loadPersons(c.access, w);
    };

    // 3. Samenvoegen: alleen aanvullen, nooit overschrijven. Eerst alles uitrekenen, dan pas toekennen:
    // een afgekeurde rij mag de werkkopie niet half wijzigen.
    let changes = List.empty<Text>();
    if (isNew) { changes.add("nieuw") };
    var kbo2 = w.kbo;
    switch (kbo, w.kbo) { case (?k, null) { kbo2 := ?k; changes.add("KBO " # k) }; case _ {} };
    var vat2 = w.vat;
    switch (vat, w.vat) { case (?v, null) { vat2 := ?v; changes.add("btw " # v) }; case _ {} };
    var aliases2 = w.aliases;
    for (a in aliases.values()) {
      // De naam zelf is al de firmanaam; een alias die enkel de naam herhaalt voegt niets toe.
      if (fold(a) != fold(w.name) and not aliases2.any(func x = fold(x) == fold(a))) { aliases2 := aliases2.concat([a]); changes.add("code " # a) };
    };
    var trades2 = w.trades;
    for (t in row.trades.values()) {
      if (trades2.find(func x = x == t) == null) { trades2 := trades2.concat([t]); changes.add("vakgebied " # t) };
    };
    if (trades2.size() > Config.maxTradesPerOrg) { return invalid(key, "Te veel vakgebieden") };
    if (aliases2.size() > Config.maxAliases) { return invalid(key, "Te veel codes") };
    var phone2 = w.phone;
    switch (phone, w.phone) { case (?x, null) { phone2 := ?x; changes.add("telefoon") }; case _ {} };
    var email2 = w.email;
    switch (email, w.email) { case (?x, null) { email2 := ?x; changes.add("e-mail") }; case _ {} };
    var website2 = w.website;
    switch (website, w.website) { case (?x, null) { website2 := ?x; changes.add("website") }; case _ {} };
    var notes2 = w.notes;
    if (w.notes == "" and row.notes != "") { notes2 := row.notes; changes.add("notitie") };
    var persons2 = w.persons;
    var pending2 = w.pending;
    for (p in persons.values()) {
      let fn = fold(p.name);
      let fs = switch (p.shortCode) { case (?s) fold(s); case null "" };
      let known = persons2.any(func((n, s) : (Text, Text)) : Bool = n == fn or (fs != "" and s == fs));
      if (not known) {
        if (persons2.size() >= Config.maxPersonsPerOrg) { return invalid(key, "Te veel personen bij " # w.name) };
        persons2 := persons2.concat([(fn, fs)]);
        pending2 := pending2.concat([p]);
        changes.add("persoon " # p.name);
      };
    };

    // Een code of KBO die bij een andere firma hoort, mag niet (uniekheid, ook binnen deze oproep).
    for (o in work.values()) {
      if (o.ref != w.ref and not o.archived) {
        switch (kbo2, o.kbo) { case (?a, ?b) { if (a == b) { return { key; outcome = #conflict("KBO-nummer " # a # " hoort al bij " # o.name); orgId = null; changes = [] } } }; case _ {} };
        for (a in aliases2.values()) {
          if (o.aliases.any(func x = fold(x) == fold(a))) { return { key; outcome = #conflict("Code " # a # " hoort al bij " # o.name); orgId = null; changes = [] } };
        };
      };
    };

    if (changes.size() == 0) { return { key; outcome = #unchanged; orgId = ?w.id; changes = [] } };

    w.kbo := kbo2;
    w.vat := vat2;
    w.aliases := aliases2;
    w.trades := trades2;
    w.phone := phone2;
    w.email := email2;
    w.website := website2;
    w.notes := notes2;
    w.persons := persons2;
    w.pending := pending2;
    if (isNew) { work.add(w) };

    // 4. Bewaren (niet in de proefronde)
    if (not dryRun) { apply(c, by, w, isNew, now) };
    { key; outcome = if isNew #created else #updated; orgId = if (w.id == 0) null else ?w.id; changes = changes.toArray() };
  };

  func apply(c : ImportCtx, by : Types.Person, w : W, isNew : Bool, now : Int) {
    if (isNew) {
      w.id := Ids.next(c.ctr, "org");
      let rec : Types.Org = { id = w.id; kind = w.kind; name = w.name; kbo = w.kbo; vat = w.vat; aliases = w.aliases; trades = w.trades; address = null; notes = w.notes; createdAt = now; createdBy = by.id; var archivedAt = null; extra = [] };
      c.org.orgs.add(w.id, rec);
    } else {
      switch (c.org.orgs.get(w.id)) {
        case (?o) { c.org.orgs.add(w.id, { id = o.id; kind = o.kind; name = o.name; kbo = w.kbo; vat = w.vat; aliases = w.aliases; trades = w.trades; address = o.address; notes = w.notes; createdAt = o.createdAt; createdBy = o.createdBy; var archivedAt = o.archivedAt; extra = o.extra }) };
        case null {};
      };
    };
    if (w.phone != null or w.email != null or w.website != null) {
      let old = c.oa.orgContacts.get(w.id);
      let note = switch old { case (?x) x.contactNote; case null "" };
      let extra = switch old { case (?x) x.extra; case null [] };
      c.oa.orgContacts.add(w.id, { orgId = w.id; phone = w.phone; email = w.email; website = w.website; contactNote = note; updatedAt = now; updatedBy = by.id; extra });
    };
    for (p in w.pending.values()) {
      let id = Ids.next(c.ctr, "person");
      let person : Types.Person = { id; name = p.name; roles = [#onderaannemer]; orgId = ?w.id; shortCode = p.shortCode; lang = null; phone = p.phone; createdAt = now; createdBy = by.id; var archivedAt = null; extra = [] };
      c.access.persons.add(id, person);
      if (p.email != null or p.jobTitle != "") {
        c.oa.personContacts.add(id, { personId = id; email = p.email; jobTitle = p.jobTitle; note = ""; updatedAt = now; updatedBy = by.id; extra = [] });
      };
    };
    w.pending := [];
  };

  // Is deze organisatie een bestaande OA-firma die de naam al draagt? (voor createOrg: dubbele namen)
  public func nameTaken(org : Types.OrgState, selfId : Nat, name : Text) : ?Text {
    let f = fold(name);
    for (o in org.orgs.values()) {
      if (o.id != selfId and o.archivedAt == null and fold(o.name) == f) { return ?o.name };
    };
    null;
  };
};
