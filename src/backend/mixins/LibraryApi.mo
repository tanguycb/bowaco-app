// Postenbibliotheek (stap 2.2, bouwplan §9 rij 2.2, architectuur §2.9; VOORLOPIG tot 0.3): hoofdstukken, posten met
// tekst, eenheid, standaard contractvorm, standaard-OA of vakgebied en standaardduur, met versies en archiveren (nooit
// wissen); apart de VERTROUWELIJKE prijshistoriek (aankoopprijzen per OA met datum) en de verkoopregel (standaardmarge,
// eigen marge of vaste prijs).
// Rechten (Rights.mo): lezen van de bibliotheek = interne rollen, ZONDER prijzen (queries); bewerken = admin, calculator
// (#editLibrary); aankoopprijzen = #readCosts (R20) en de verkoopregel = #readSellPrices (R21): enkel admin en calculator,
// en enkel via update-calls met een auditregel "bekeek:…" (R23). Werfleider, OA, architect, klant, VC en robot zien
// nooit een prijs of marge (lektest, review E1–E8, draftproef posten). Beslissing eigenaar 24-10: geen versleuteling.
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Library "../lib/Library";
import Oa "../lib/Oa";
import Plan "../lib/Plan";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  library : Types.LibraryState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Lezen (intern, zonder prijzen) ─────────────────────────────────────
  public query ({ caller }) func libraryChapters(includeArchived : Bool) : async [Views.LibChapterView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readLibrary, null);
    let counts = Map.empty<Nat, Nat>();
    for (it in library.items.values()) {
      if (it.archivedAt == null) { counts.add(it.chapterId, (switch (counts.get(it.chapterId)) { case (?n) n; case null 0 }) + 1) };
    };
    library.chapters.values().filter(func c = includeArchived or c.archivedAt == null).map(func c = Library.chapterView(c, switch (counts.get(c.id)) { case (?n) n; case null 0 })).toArray().sort(
      func(a, b) = switch (Nat.compare(a.order, b.order)) { case (#equal) Nat.compare(a.id, b.id); case o o }
    );
  };

  public query ({ caller }) func libraryUnits(includeArchived : Bool) : async [Views.UnitView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readLibrary, null);
    Library.units(settings, includeArchived);
  };

  // Zoeken en filteren; één bladzijde (≤ 200) + het totaal. Gearchiveerde enkel op vraag.
  public query ({ caller }) func listLibrary(f : Views.LibFilter) : async Views.LibPage {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readLibrary, null);
    if (f.text.size() > Config.maxName) { Runtime.trap("Zoekvraag te lang") };
    let words = Library.queryWords(f.text);
    let hits = library.items.values().filter(func it = Library.matches(library, it, f, words)).toArray().sort(Library.compareItems(library));
    let limit = Nat.min(if (f.limit == 0) 50 else f.limit, Config.maxLibPage);
    { items = Access.page(hits, f.offset, limit).map(func it = Library.itemView(lctx(), it)); total = hits.size() };
  };

  public query ({ caller }) func getLibraryItem(id : Nat) : async Result.Result<Views.LibItemView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readLibrary, null);
    switch (library.items.get(id)) { case (?it) #ok(Library.itemView(lctx(), it)); case null #err("Onbekende post") };
  };

  // Alle versies van een post (nieuwste eerst): tekst, eenheid, contractvorm … zoals ze toen waren, en wie wat veranderde.
  public query ({ caller }) func libraryItemHistory(id : Nat) : async Result.Result<[Views.LibItemVersionView], Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readLibrary, null);
    if (library.items.get(id) == null) { return #err("Onbekende post") };
    #ok(
      library.itemVersions.values().filter(func v = v.itemId == id).toArray().sort(func(a, b) = Nat.compare(b.version, a.version)).map(
        func(v : Types.LibItemVersion) : Views.LibItemVersionView = { version = v.version; at = v.at; byName = Access.personName(access, v.by); fields = v.fields; item = Library.itemView(lctx(), v.item) }
      )
    );
  };

  // ── Hoofdstukken (admin, calculator) ───────────────────────────────────
  public shared ({ caller }) func saveLibraryChapter(i : Views.LibChapterInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    let title = Access.cleanText(i.title, Config.maxName) ?? return #err("Titel: 1 tot " # Config.maxName.toText() # " tekens");
    let code = i.code.trim(#char ' ');
    if (code.size() > Config.maxLibCode) { return #err("Code: hoogstens " # Config.maxLibCode.toText() # " tekens") };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (i.order > 1_000_000) { return #err("Volgorde: hoogstens 1.000.000") };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (library.chapters.size() >= Config.maxLibChapters) { return #err("Te veel hoofdstukken") };
        let id = Ids.next(ctr, "libChapter");
        library.chapters.add(id, { id; code; title; order = i.order; note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
        Access.audit(audit, caller, ?p.id, null, "hoofdstuk-gemaakt", "#" # id.toText() # " " # code);
        #ok(id);
      };
      case (?id) {
        let c = library.chapters.get(id) ?? return #err("Onbekend hoofdstuk");
        if (c.code == code and c.title == title and c.order == i.order and c.note == i.note) { return #ok(id) };
        library.chapters.add(id, { c with code; title; order = i.order; note = i.note; updatedAt = now; updatedBy = p.id });
        Access.audit(audit, caller, ?p.id, null, "hoofdstuk-gewijzigd", "#" # id.toText() # " " # code);
        #ok(id);
      };
    };
  };

  // Archiveren kan pas als er geen actieve posten meer in staan (die verdwijnen anders uit het zicht van de calculator).
  public shared ({ caller }) func setLibraryChapterArchived(id : Nat, archived : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    let c = library.chapters.get(id) ?? return #err("Onbekend hoofdstuk");
    if ((c.archivedAt != null) == archived) { return #ok };
    if (archived) {
      let n = library.items.values().filter(func it = it.chapterId == id and it.archivedAt == null).size();
      if (n > 0) { return #err("Er staan nog " # n.toText() # " actieve posten in dit hoofdstuk: archiveer of verplaats ze eerst") };
    };
    let now = Time.now();
    library.chapters.add(id, { c with archivedAt = if archived ?now else null; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, null, if archived "hoofdstuk-gearchiveerd" else "hoofdstuk-teruggezet", "#" # id.toText() # " " # c.code);
    #ok;
  };

  // De VOORLOPIGE startlijst (de 19 hoofdstukken van offerte 2026/231, zonder werfgegevens; B1). Enkel als er nog geen
  // enkel hoofdstuk is: een tweede druk verandert niets.
  public shared ({ caller }) func loadLibraryStartChapters() : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    if (library.chapters.size() > 0) { return #err("Er zijn al hoofdstukken: de startlijst laadt enkel in een lege bibliotheek") };
    let now = Time.now();
    var n = 0;
    for ((code, title) in Config.defaultLibChapters().values()) {
      n += 1;
      let id = Ids.next(ctr, "libChapter");
      library.chapters.add(id, { id; code; title; order = n * 10; note = "VOORLOPIG (startlijst uit offerte 2026/231, te bevestigen door 0.3)"; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
    };
    Access.audit(audit, caller, ?p.id, null, "hoofdstukken-startlijst", n.toText() # " hoofdstukken");
    #ok(n);
  };

  // ── Eenheden (keuzelijst, R17: admin) ──────────────────────────────────
  public shared ({ caller }) func setLibraryUnit(u : Views.UnitView) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let key = Text.toLower(u.key.trim(#char ' '));
    if (not Library.unitKeyOk(key)) { return #err("Sleutel: 1 tot 20 tekens (kleine letters, cijfers, - of /)") };
    let name = Access.cleanText(u.name, Config.maxName) ?? return #err("Naam: 1 tot 80 tekens");
    Library.materializeUnits(settings);
    let k = "unit:" # key;
    let old = settings.lookups.get(k);
    let existed = settings.lookups.containsKey(k);
    if (not settings.lookups.containsKey(k) and Library.units(settings, true).size() >= Config.maxUnits) { return #err("Te veel eenheden") };
    if (u.archived and library.items.values().any(func it = it.unit == key and it.archivedAt == null)) {
      return #err("Deze eenheid wordt nog gebruikt door actieve posten");
    };
    let archivedAt : ?Int = if (u.archived) { switch old { case (?o) (switch (o.archivedAt) { case (?a) ?a; case null ?Time.now() }); case null ?Time.now() } } else null;
    settings.lookups.add(k, Library.lookupFromUnit({ key; name; order = u.order; archived = u.archived }, archivedAt));
    Access.audit(audit, caller, ?p.id, null, if (existed) "eenheid-gewijzigd" else "eenheid-gemaakt", key);
    #ok;
  };

  // ── Posten (admin, calculator) ─────────────────────────────────────────
  // Nieuw (id = null, expectedVersion = 0) of een nieuwe versie (expectedVersion = de versie die de beller las: wie
  // intussen door iemand anders overschreven werd, krijgt een fout in plaats van stil te overschrijven). Elke versie blijft.
  public shared ({ caller }) func saveLibraryItem(i : Views.LibItemInput, expectedVersion : Nat) : async Result.Result<Views.LibItemView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    let title = Access.cleanText(i.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    let code = i.code.trim(#char ' ');
    if (code.size() > Config.maxLibCode) { return #err("Code: hoogstens " # Config.maxLibCode.toText() # " tekens") };
    if (i.text.size() > Config.maxLibText) { return #err("Lastenboektekst: hoogstens " # Config.maxLibText.toText() # " tekens") };
    switch (library.chapters.get(i.chapterId)) {
      case (?c) { if (c.archivedAt != null) { return #err("Dit hoofdstuk is gearchiveerd") } };
      case null { return #err("Kies een hoofdstuk") };
    };
    let old = switch (i.id) { case (?id) { ?(library.items.get(id) ?? return #err("Onbekende post")) }; case null null };
    let unitKnown = Library.units(settings, true).find(func u = u.key == i.unit);
    switch unitKnown {
      case (?u) { if (u.archived and (switch old { case (?o) o.unit != i.unit; case null true })) { return #err("Deze eenheid is gearchiveerd") } };
      case null { return #err("Onbekende eenheid: " # i.unit) };
    };
    switch (i.trade) {
      case (?t) { switch (Oa.tradeError(settings, [t], switch old { case (?o) (switch (o.trade) { case (?x) [x]; case null [] }); case null [] })) { case (?e) return #err(e); case null {} } };
      case null {};
    };
    switch (i.orgId) {
      case (?o) {
        let x = org.orgs.get(o) ?? return #err("Onbekende firma");
        if (x.kind != #subcontractor and x.kind != #supplier) { return #err("Standaard-OA: kies een onderaannemer of leverancier") };
        if (x.archivedAt != null and (switch old { case (?it) it.orgId != ?o; case null true })) { return #err("Deze firma is gearchiveerd") };
      };
      case null {};
    };
    switch (i.durationDays) { case (?d) { if (d > Config.maxWorkdays) { return #err("Duur: hoogstens " # Config.maxWorkdays.toText() # " werkdagen") } }; case null {} };
    switch (i.perDayMilli) { case (?q) { if (q <= 0 or q > Config.maxLibPerDayMilli) { return #err("Hoeveelheid per werkdag: groter dan 0") } }; case null {} };
    switch (i.planStepKey) {
      case (?k) {
        if (not Plan.templates(plan).any(func t = t.steps.any(func s = s.key == k))) { return #err("Onbekende planningsstap: " # k) };
      };
      case null {};
    };
    if (i.keywords.size() > Config.maxLibKeywords) { return #err("Te veel zoekwoorden") };
    let keywords = i.keywords.filterMap(func(k : Text) : ?Text = Access.cleanText(k, Config.maxLibKeyword));
    if (keywords.size() != i.keywords.size()) { return #err("Zoekwoord: 1 tot " # Config.maxLibKeyword.toText() # " tekens") };
    let importKey = switch (i.importKey) {
      case (?k) { ?(Access.cleanText(k, Config.maxImportKey) ?? return #err("Importsleutel: 1 tot " # Config.maxImportKey.toText() # " tekens")) };
      case null null;
    };
    switch importKey {
      case (?k) {
        switch (library.importKeys.get(k)) {
          case (?other) { if (?other != i.id) { return #err("Importsleutel bestaat al (post #" # other.toText() # ")") } };
          case null {};
        };
      };
      case null {};
    };
    let now = Time.now();
    switch old {
      case null {
        if (expectedVersion != 0) { return #err("Nieuwe post: versie 0 verwacht") };
        if (library.items.size() >= Config.maxLibItems) { return #err("De bibliotheek is vol (" # Config.maxLibItems.toText() # " posten)") };
        let id = Ids.next(ctr, "libItem");
        let it : Types.LibItem = {
          id;
          chapterId = i.chapterId;
          code;
          title;
          text = i.text;
          unit = i.unit;
          form = i.form;
          trade = i.trade;
          orgId = i.orgId;
          durationDays = i.durationDays;
          perDayMilli = i.perDayMilli;
          planStepKey = i.planStepKey;
          keywords;
          importKey;
          version = 1;
          createdAt = now;
          createdBy = p.id;
          updatedAt = now;
          updatedBy = p.id;
          archivedAt = null;
          archivedBy = null;
          archiveReason = "";
          extra = [];
        };
        library.items.add(id, it);
        switch importKey { case (?k) library.importKeys.add(k, id); case null {} };
        keepVersion(it, p.id, "nieuw");
        Access.audit(audit, caller, ?p.id, null, "post-gemaakt", "#" # id.toText() # (if (code == "") "" else " " # code));
        #ok(Library.itemView(lctx(), it));
      };
      case (?o) {
        if (o.archivedAt != null) { return #err("Deze post is gearchiveerd: zet ze eerst terug") };
        if (expectedVersion != o.version) { return #err("Iemand anders wijzigde deze post intussen (versie " # o.version.toText() # "); laad opnieuw") };
        let next : Types.LibItem = { o with chapterId = i.chapterId; code; title; text = i.text; unit = i.unit; form = i.form; trade = i.trade; orgId = i.orgId; durationDays = i.durationDays; perDayMilli = i.perDayMilli; planStepKey = i.planStepKey; keywords; importKey };
        let fields = Library.changedFields(o, next);
        if (fields == "niets gewijzigd") { return #ok(Library.itemView(lctx(), o)) };
        let it = { next with version = o.version + 1; updatedAt = now; updatedBy = p.id };
        library.items.add(o.id, it);
        if (o.importKey != importKey) {
          switch (o.importKey) { case (?k) library.importKeys.remove(k); case null {} };
          switch importKey { case (?k) library.importKeys.add(k, o.id); case null {} };
        };
        keepVersion(it, p.id, fields);
        Access.audit(audit, caller, ?p.id, null, "post-gewijzigd", "#" # o.id.toText() # " v" # it.version.toText() # ": " # fields);
        #ok(Library.itemView(lctx(), it));
      };
    };
  };

  // Archiveren (met reden) of terugzetten; nooit wissen. Een gearchiveerde post blijft leesbaar (historiek, oude offertes).
  public shared ({ caller }) func setLibraryItemArchived(id : Nat, archived : Bool, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    let it = library.items.get(id) ?? return #err("Onbekende post");
    if ((it.archivedAt != null) == archived) { return #ok };
    if (reason.size() > Config.maxText) { return #err("Reden te lang") };
    let now = Time.now();
    if (archived) {
      library.items.add(id, { it with archivedAt = ?now; archivedBy = ?p.id; archiveReason = reason.trim(#char ' '); updatedAt = now; updatedBy = p.id });
    } else {
      switch (library.chapters.get(it.chapterId)) { case (?c) { if (c.archivedAt != null) { return #err("Het hoofdstuk is gearchiveerd: zet het eerst terug") } }; case null {} };
      library.items.add(id, { it with archivedAt = null; archivedBy = null; archiveReason = ""; updatedAt = now; updatedBy = p.id });
    };
    Access.audit(audit, caller, ?p.id, null, if archived "post-gearchiveerd" else "post-teruggezet", "#" # id.toText());
    #ok;
  };

  // ── Prijzen (VERTROUWELIJK: admin, calculator; update-calls met auditregel) ──
  // De geldende aankoopprijs, de jongste per OA, de verkoopregel en de berekende verkoopprijs voor een lijst posten
  // (de bladzijde van de bibliotheek, later de posten van een offerte). Eén auditregel per oproep.
  public shared ({ caller }) func readLibraryPrices(ids : [Nat]) : async Result.Result<Views.LibPrices, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readCosts, null);
    Rights.require(ctx, p, #readSellPrices, null);
    if (ids.size() > Config.maxLibPriceIds) { return #err("Hoogstens " # Config.maxLibPriceIds.toText() # " posten per oproep") };
    for (id in ids.values()) { if (library.items.get(id) == null) { return #err("Onbekende post #" # id.toText()) } };
    let std = Library.standardMargin(settings);
    Access.audit(audit, caller, ?p.id, null, "bekeek:prijzen", ids.size().toText() # " posten");
    #ok({ standardMarginBp = std; prices = ids.filterMap(func(id : Nat) : ?Views.LibPriceView = switch (library.items.get(id)) { case (?it) ?Library.priceView(lctx(), it, std); case null null }) });
  };

  // De volledige prijshistoriek van één post: alle aankoopprijzen (ook gearchiveerde, met reden) en alle versies van de
  // verkoopregel.
  public shared ({ caller }) func readLibraryPriceHistory(itemId : Nat) : async Result.Result<Views.LibPriceHistory, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readCosts, null);
    Rights.require(ctx, p, #readSellPrices, null);
    if (library.items.get(itemId) == null) { return #err("Onbekende post") };
    Access.audit(audit, caller, ?p.id, null, "bekeek:prijshistoriek", "post #" # itemId.toText());
    let x = lctx();
    #ok({
      costs = Library.costsOf(library, itemId).map(func c = Library.costView(x, c)).sort(func(a, b) = switch (Nat.compare(b.day, a.day)) { case (#equal) Nat.compare(b.id, a.id); case o o });
      sells = library.sellVersions.values().filter(func v = v.itemId == itemId).toArray().sort(func(a, b) = Nat.compare(b.version, a.version)).map(
        func(v : Types.LibSellVersion) : Views.LibSellVersionView = {
          version = v.version;
          at = v.at;
          byName = Access.personName(access, v.by);
          rule = switch (v.rule) { case (?r) Library.plainOf(r); case null null };
          reason = Library.plainOf(v.reason) ?? "";
        }
      );
    });
  };

  // Een aankoopprijs erbij (append-only). De OA is een onderaannemer of leverancier; zonder OA = eigen raming.
  public shared ({ caller }) func addLibraryCost(itemId : Nat, i : Views.LibCostInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editLibrary, null);
    Rights.require(ctx, p, #readCosts, null);
    let it = library.items.get(itemId) ?? return #err("Onbekende post");
    if (it.archivedAt != null) { return #err("Deze post is gearchiveerd") };
    if (i.costCents < 0 or i.costCents > Config.maxAmountCents) { return #err("Aankoopprijs: tussen € 0 en € 1 miljard per eenheid") };
    if (i.day < Config.minDay or i.day > Config.maxDay) { return #err("Datum van de prijs klopt niet") };
    if (not Library.sourceOk(i.source)) { return #err("Onbekende herkomst: " # i.source) };
    if (i.ref.size() > Config.maxName or i.note.size() > Config.maxText) { return #err("Tekst te lang") };
    switch (i.orgId) {
      case (?o) {
        let x = org.orgs.get(o) ?? return #err("Onbekende firma");
        if (x.kind != #subcontractor and x.kind != #supplier) { return #err("Kies een onderaannemer of leverancier") };
        if (x.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
      };
      case null {};
    };
    let ids = switch (library.costsByItem.get(itemId)) { case (?xs) xs; case null [] };
    if (ids.size() >= Config.maxLibCostsPerItem) { return #err("Te veel prijzen voor deze post") };
    let id = Ids.next(ctr, "libCost");
    library.costs.add(id, { id; itemId; orgId = i.orgId; day = i.day; cost = #plain(i.costCents); source = i.source; ref = i.ref.trim(#char ' '); note = i.note; createdAt = Time.now(); createdBy = p.id; archivedAt = null; archivedBy = null; archiveReason = ""; extra = [] });
    Library.addCostIndex(library, itemId, id);
    // Nooit het bedrag of de firma in de auditlog: enkel welke post.
    Access.audit(audit, caller, ?p.id, null, "prijs-toegevoegd", "post #" # itemId.toText() # " prijs #" # id.toText());
    #ok(id);
  };

  // Een foute prijs archiveren (met reden): ze blijft in de historiek, telt niet meer mee.
  public shared ({ caller }) func archiveLibraryCost(costId : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editLibrary, null);
    Rights.require(ctx, p, #readCosts, null);
    let c = library.costs.get(costId) ?? return #err("Onbekende prijs");
    if (c.archivedAt != null) { return #err("Deze prijs is al gearchiveerd") };
    let why = Access.cleanText(reason, Config.maxText) ?? return #err("Geef een reden (bv. tikfout, verkeerde eenheid)");
    library.costs.add(costId, { c with archivedAt = ?Time.now(); archivedBy = ?p.id; archiveReason = why });
    Access.audit(audit, caller, ?p.id, null, "prijs-gearchiveerd", "post #" # c.itemId.toText() # " prijs #" # costId.toText());
    #ok;
  };

  // De verkoopregel van een post: null = standaardmarge; een andere marge of een vaste prijs vraagt een reden (2.6).
  public shared ({ caller }) func setLibrarySell(itemId : Nat, i : Views.LibSellInput, expectedVersion : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editLibrary, null);
    Rights.require(ctx, p, #readSellPrices, null);
    let it = library.items.get(itemId) ?? return #err("Onbekende post");
    if (it.archivedAt != null) { return #err("Deze post is gearchiveerd") };
    switch (i.rule) { case (?r) { switch (Library.ruleError(r)) { case (?e) return #err(e); case null {} } }; case null {} };
    if (i.reason.size() > Config.maxText) { return #err("Reden te lang") };
    let reason = i.reason.trim(#char ' ');
    let std = Library.standardMargin(settings);
    let deviates = switch (i.rule) { case (?#margin m) m != std; case (?#price _) true; case null false };
    if (deviates and reason == "") { return #err("Geef een reden voor een andere marge of een vaste prijs (bv. eigen prestatie, verzekering)") };
    let old = library.sells.get(itemId);
    let current = switch old { case (?s) s.version; case null 0 };
    if (expectedVersion != current) { return #err("Iemand anders wijzigde dit intussen (versie " # current.toText() # "); laad opnieuw") };
    let oldRule = switch old { case (?s) (switch (s.rule) { case (?r) Library.plainOf(r); case null null }); case null null };
    let oldReason = switch old { case (?s) (Library.plainOf(s.reason) ?? ""); case null "" };
    if (oldRule == i.rule and oldReason == reason) { return #ok(current) };
    let now = Time.now();
    let rule : ?Types.Confidential<Types.LibSellRule> = switch (i.rule) { case (?r) ?#plain(r); case null null };
    let version = current + 1;
    library.sells.add(itemId, { itemId; rule; reason = #plain(reason); version; updatedAt = now; updatedBy = p.id; extra = switch old { case (?s) s.extra; case null [] } });
    let vid = Ids.next(ctr, "libSellVersion");
    library.sellVersions.add(vid, { id = vid; itemId; version; rule; reason = #plain(reason); at = now; by = p.id });
    // Enkel de soort regel, nooit de marge of de prijs.
    Access.audit(audit, caller, ?p.id, null, "verkoopregel-gewijzigd", "post #" # itemId.toText() # " v" # version.toText() # ": " # Library.ruleText(i.rule));
    #ok(version);
  };

  // De standaardmarge van het bedrijf (B5: 20 %). Enkel admin; lezen via readLibraryPrices.
  public shared ({ caller }) func setLibraryMargin(bp : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #manageSettings, null);
    Rights.require(ctx, p, #readCosts, null);
    if (bp > Config.maxLibMarginBp) { return #err("Marge: 0 tot 90 %") };
    settings.values.add("bib.margeBp", bp.toText());
    Access.audit(audit, caller, ?p.id, null, "standaardmarge-gewijzigd", "");
    #ok;
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func lctx() : Library.Ctx { { settings; access; org; lib = library } };

  func keepVersion(it : Types.LibItem, by : Nat, fields : Text) {
    let vid = Ids.next(ctr, "libItemVersion");
    library.itemVersions.add(vid, { id = vid; itemId = it.id; version = it.version; item = it; at = it.updatedAt; by; fields });
  };

};
