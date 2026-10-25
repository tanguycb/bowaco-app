// Offerte-editor (stap 2.4, bouwplan §9 rij 2.4 en §8.5, architectuur §2.9; VOORLOPIG tot 0.3): offertes per werf met
// versies, hoofdstukken en lijnen (post, tekstregel, optie), de vermoedelijke hoeveelheid, de contractvorm per lijn, de
// eenheid, en apart (VERTROUWELIJK) de aankoopprijs per OA, de verkoopregel (standaardmarge van de versie, eigen marge of
// vaste prijs) en de reden. Het btw-tarief en de klant komen van de werf.
// Rekenen: de browser rekent (src/frontend/src/quote/calc.ts) en stuurt bij elke bewaring zijn totalen mee; de backend
// rekent opnieuw met dezelfde regels (lib/QuoteCalc.mo) en bewaart NIETS als iets verschilt. Een totaal wordt nooit
// getypt of bewaard: het volgt uit de invoer. Een verzonden of aanvaarde versie is onwijzigbaar (hash van de inhoud,
// vaste rekenversie); wie verder werkt, krijgt een nieuwe versie.
// Rechten (Rights.mo): lezen #readQuotes (interne rollen van de werf; architect met de grant #readSellPrices), de prijs
// per lijn #readSellPrices (R21), aankoopprijzen en marges #readCosts (R20), bewerken #editQuote, versturen en de
// beslissing #sendQuote (R22). Bedragen enkel via update-calls met een auditregel (R23); de werfleider ziet hoeveelheden
// en hoofdstuktotalen, nooit een prijs per lijn, een aankoopprijs of een marge. OA, klant (2.7), VC en robot: nooit.
import Array "mo:core/Array";
import Int "mo:core/Int";
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
import QuoteCalc "../lib/QuoteCalc";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Lezen zonder bedragen (query) ──────────────────────────────────────
  // De offertes van één werf, of (zonder werf) van alle werven die de beller ziet; nieuwste eerst.
  public query ({ caller }) func listQuotes(workId : ?Nat, includeArchived : Bool) : async [Views.QuoteSummary] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let qids : [Nat] = switch workId {
      case (?w) { Rights.require(ctx, p, #readQuotes, ?w); Quotes.ids(quotes.byWork, w) };
      case null {
        Rights.require(ctx, p, #quotesOverview, null);
        quotes.quotes.values().filter(func q = Rights.may(ctx, p, #readQuotes, ?q.workId)).map(func q = q.id).toArray();
      };
    };
    let qs = qids.filterMap(func(id : Nat) : ?Types.Quote = quotes.quotes.get(id)).filter(func q = includeArchived or q.archivedAt == null).sort(func(a, b) = Int.compare(b.updatedAt, a.updatedAt));
    let n = Nat.min(qs.size(), Config.maxQuoteRead);
    Array.tabulate<Views.QuoteSummary>(n, func i = Quotes.summary(qtCtx(), qs[i]));
  };

  // ── Lezen MET bedragen (update-call + auditregel) ──────────────────────
  // Wat de beller ziet, beslist zijn recht: #full (admin, calculator: ook aankoopprijzen en marges), #sell (architect met
  // de grant: verkoopprijzen per lijn), #totals (werfleider: hoeveelheden en hoofdstuktotalen, geen prijs per lijn).
  public shared ({ caller }) func readQuoteVersion(versionId : Nat) : async Result.Result<Views.QuoteRead, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    // Wie geen offertes mag zien, hoort ook niet of een versie bestaat.
    let (v, q) = switch (qtFind(versionId)) { case (?x) x; case null { Rights.require(ctx, p, #quotesOverview, null); return #err("Onbekende versie") } };
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    let scope : Views.QuoteScope = if (Rights.may(ctx, p, #readCosts, null) and Rights.may(ctx, p, #readSellPrices, ?q.workId)) #full else if (Rights.may(ctx, p, #readSellPrices, ?q.workId)) #sell else #totals;
    let c = qtCompute(v);
    let full = scope == #full;
    Access.audit(audit, caller, ?p.id, ?q.workId, if full "bekeek:offerteprijzen" else "bekeek:offerte", "offerte #" # q.id.toText() # " v" # v.version.toText());
    #ok({
      scope;
      quote = Quotes.summary(qtCtx(), q);
      version = { Quotes.versionView(qtCtx(), v) with intact = qtIntact(q, v, c) };
      chapters = c.chapters.map(Quotes.chapterView);
      lines = c.lines.map(func l = Quotes.lineView(settings, l));
      totals = Quotes.totalsView(c.totals, v.vatBp, v.calcVersion);
      sell = if (scope == #totals) [] else Quotes.sellLines(c);
      costs = if full Quotes.costLines(org, c) else [];
      margins = if full ?Quotes.marginTotals(c.totals, c.std, Quotes.noReason(c)) else null;
    });
  };

  // ── Maken ──────────────────────────────────────────────────────────────
  // Een nieuwe offerte voor een werf met versie 1 (ontwerp): btw-tarief en klant van de werf, de standaardmarge van de
  // bibliotheek. Nummer leeg = het volgende van dit jaar ("2026/232"); anders het gegeven nummer (uniek).
  public shared ({ caller }) func createQuote(i : Views.QuoteNew) : async Result.Result<Views.QuoteCreated, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    let w = works.works.get(i.workId) ?? return #err("Onbekende werf");
    if (not Rights.may(ctx, p, #readQuotes, ?w.id)) { return #err("Geen toegang tot deze werf") };
    let title = Access.cleanText(i.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    if (Quotes.ids(quotes.byWork, w.id).size() >= Config.maxQuotesPerWork) { return #err("Te veel offertes voor deze werf") };
    let wanted = i.number.trim(#char ' ');
    if (wanted.size() > Config.maxQuoteNumber) { return #err("Nummer: hoogstens " # Config.maxQuoteNumber.toText() # " tekens") };
    let (number, seqUsed) = if (wanted == "") { let (t, n) = qtNextNumber(); (t, ?n) } else (wanted, null);
    if (quotes.numbers.get(number) != null) { return #err("Offertenummer " # number # " bestaat al") };
    switch seqUsed { case (?n) settings.sequences.add(qtSeqKey(), n); case null {} };
    let now = Time.now();
    let qid = Ids.next(ctr, "quote");
    quotes.quotes.add(qid, { id = qid; workId = w.id; number; title; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; archivedBy = null; archiveReason = ""; extra = [] });
    quotes.numbers.add(number, qid);
    Quotes.addIndex(quotes.byWork, w.id, qid);
    let vid = Ids.next(ctr, "quoteVersion");
    quotes.versions.add(vid, { id = vid; quoteId = qid; version = 1; status = #draft; title; vatBp = w.vatBp; clientOrgId = w.clientOrgId; validDays = Config.quoteValidDaysDefault; intro = ""; note = ""; basedOnId = null; rev = 0; calcVersion = QuoteCalc.version; sent = null; decision = null; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra = [] });
    quotes.versionConf.add(vid, { versionId = vid; standardMarginBp = #plain(Library.standardMargin(settings)); extra = [] });
    Quotes.addIndex(quotes.byQuote, qid, vid);
    Access.audit(audit, caller, ?p.id, ?w.id, "offerte-gemaakt", number);
    #ok({ quoteId = qid; versionId = vid; number });
  };

  // Het laatste volgnummer van een jaar (om verder te nummeren na de offertes van vóór de app). Enkel admin (R17).
  public shared ({ caller }) func setQuoteSequence(year : Nat, last : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (year < 2000 or year > 2100 or last > 99_999) { return #err("Jaar 2000–2100, nummer tot 99.999") };
    settings.sequences.add("offerte:" # year.toText(), last);
    Access.audit(audit, caller, ?p.id, null, "offertenummer-gezet", year.toText() # "/" # last.toText());
    #ok;
  };

  // Het laatste uitgegeven volgnummer van een jaar (voor het veld in Instellingen). Enkel admin.
  public query ({ caller }) func quoteSequence(year : Nat) : async Nat {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    switch (settings.sequences.get("offerte:" # year.toText())) { case (?n) n; case null 0 };
  };

  // Een nieuwe versie (ontwerp) als kopie van een bestaande (standaard de nieuwste). Er is hoogstens één ontwerp per offerte.
  public shared ({ caller }) func newQuoteVersion(quoteId : Nat, fromVersionId : ?Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    let q = quotes.quotes.get(quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    let vs = Quotes.versionsOf(quotes, quoteId);
    switch (vs.find(func v = v.status == #draft)) { case (?d) { return #err("Er is al een ontwerp (v" # d.version.toText() # "): werk daarin verder") }; case null {} };
    if (vs.size() >= Config.maxQuoteVersions) { return #err("Te veel versies") };
    let from = switch fromVersionId {
      case (?f) { switch (quotes.versions.get(f)) { case (?v) { if (v.quoteId != quoteId) { return #err("Die versie hoort bij een andere offerte") }; v }; case null return #err("Onbekende versie") } };
      case null { if (vs.size() == 0) { return #err("Geen versie om te kopiëren") }; vs[0] };
    };
    let now = Time.now();
    let vid = Ids.next(ctr, "quoteVersion");
    let nr = vs[0].version + 1;
    quotes.versions.add(vid, { from with id = vid; version = nr; status = #draft; basedOnId = ?from.id; rev = 0; calcVersion = QuoteCalc.version; sent = null; decision = null; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id });
    quotes.versionConf.add(vid, { versionId = vid; standardMarginBp = #plain(Quotes.standardMargin(quotes, from.id, Library.standardMargin(settings))); extra = [] });
    Quotes.addIndex(quotes.byQuote, quoteId, vid);
    let chMap = Map.empty<Nat, Nat>();
    let chapters = Quotes.chaptersOf(quotes, from.id);
    var chIds : [Nat] = [];
    for (c in chapters.values()) {
      let id = Ids.next(ctr, "quoteChapter");
      quotes.chapters.add(id, { c with id; versionId = vid });
      chMap.add(c.id, id);
      chIds := chIds.concat([id]);
    };
    quotes.chaptersByVersion.add(vid, chIds);
    var lnIds : [Nat] = [];
    for (l in Quotes.linesOf(quotes, from.id, chapters).values()) {
      let id = Ids.next(ctr, "quoteLine");
      let ch = chMap.get(l.chapterId) ?? Runtime.trap("hoofdstuk ontbreekt bij het kopiëren");
      quotes.lines.add(id, { l with id; versionId = vid; chapterId = ch; copiedFrom = ?l.id });
      switch (quotes.prices.get(l.id)) { case (?pr) quotes.prices.add(id, { pr with lineId = id; versionId = vid }); case null {} };
      lnIds := lnIds.concat([id]);
    };
    quotes.linesByVersion.add(vid, lnIds);
    quotes.quotes.add(quoteId, { q with updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, "offerte-nieuwe-versie", q.number # " v" # nr.toText() # " uit v" # from.version.toText());
    #ok(vid);
  };

  // ── Bewaren (enkel een ontwerp) ────────────────────────────────────────
  // Kop, hoofdstukken en lijnen die veranderden, met de totalen die de browser uitrekende. Alles of niets: eerst alles
  // nakijken en uitrekenen op een kopie, pas dan schrijven. Geen stil overschrijven: `rev` = de stand die de beller las.
  public shared ({ caller }) func saveQuoteDraft(versionId : Nat, rev : Nat, header : ?Views.QuoteHeaderInput, chapterOps : [Views.QuoteChapterOp], lineOps : [Views.QuoteLineOp], expect : Views.QuoteExpect) : async Result.Result<Views.QuoteSaveResult, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    Rights.require(ctx, p, #readCosts, null);
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (v.status != #draft) { return #err("Versie " # v.version.toText() # " is " # Quotes.statusText(v.status) # " en kan niet meer veranderen: maak een nieuwe versie") };
    if (rev != v.rev) { return #err("Iemand anders bewaarde deze versie intussen (stand " # v.rev.toText() # "); laad opnieuw") };
    if (chapterOps.size() + lineOps.size() > Config.maxQuoteOps) { return #err("Te veel wijzigingen in één keer (hoogstens " # Config.maxQuoteOps.toText() # ")") };

    // 1. Kop
    var nv = v;
    var std = Quotes.standardMargin(quotes, v.id, Library.standardMargin(settings));
    switch header {
      case (?h) {
        let title = Access.cleanText(h.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
        if (h.vatBp != 600 and h.vatBp != 2100) { return #err("Btw-tarief: 6 of 21 %") };
        switch (h.clientOrgId) {
          case (?o) { let x = org.orgs.get(o) ?? return #err("Onbekende klant"); if (x.kind != #client) { return #err("Kies een klant (organisatie van de soort klant)") } };
          case null {};
        };
        if (h.validDays == 0 or h.validDays > Config.maxQuoteValidDays) { return #err("Geldigheid: 1 tot " # Config.maxQuoteValidDays.toText() # " dagen") };
        if (h.intro.size() > Config.maxQuoteText or h.note.size() > Config.maxQuoteText) { return #err("Inleiding of notitie te lang") };
        if (h.standardMarginBp > Config.maxLibMarginBp) { return #err("Standaardmarge: 0 tot 90 %") };
        nv := { nv with title; vatBp = h.vatBp; clientOrgId = h.clientOrgId; validDays = h.validDays; intro = h.intro; note = h.note };
        std := h.standardMarginBp;
      };
      case null {};
    };

    // 2. Werkkopie van wat er nu is (enkel actieve hoofdstukken en lijnen)
    type WCh = { id : ?Nat; code : Text; title : Text; order : Nat; libChapterId : ?Nat; active : Bool; touched : Bool; seq : Nat };
    type WLn = { id : ?Nat; chapter : Text; order : Nat; kind : Types.QuoteLineKind; code : Text; title : Text; text : Text; specRef : Text; qtyMilli : Int; unit : Text; form : Types.ContractForm; libItemId : ?Nat; libItemVersion : ?Nat; copiedFrom : ?Nat; price : Quotes.Price; active : Bool; touched : Bool };
    let chs = Map.empty<Text, WCh>();
    let lns = Map.empty<Text, WLn>();
    var seq = 0;
    for (c in Quotes.chaptersOf(quotes, v.id).values()) {
      chs.add("i" # c.id.toText(), { id = ?c.id; code = c.code; title = c.title; order = c.order; libChapterId = c.libChapterId; active = true; touched = false; seq });
      seq += 1;
    };
    for (l in Quotes.ids(quotes.linesByVersion, v.id).values()) {
      switch (quotes.lines.get(l)) {
        case (?x) {
          if (x.archivedAt == null) {
            lns.add("i" # x.id.toText(), { id = ?x.id; chapter = "i" # x.chapterId.toText(); order = x.order; kind = x.kind; code = x.code; title = x.title; text = x.text; specRef = x.specRef; qtyMilli = x.qtyMilli; unit = x.unit; form = x.form; libItemId = x.libItemId; libItemVersion = x.libItemVersion; copiedFrom = x.copiedFrom; price = Quotes.priceOf(quotes, x.id); active = true; touched = false });
          };
        };
        case null {};
      };
    };
    let units = Library.units(settings, true);

    // 3. Hoofdstukken
    for (op in chapterOps.values()) {
      let key = switch (op.id) {
        case (?id) { let k = "i" # id.toText(); if (chs.get(k) == null) { return #err("Onbekend hoofdstuk #" # id.toText() # " in deze versie") }; k };
        case null {
          if (op.ref.size() == 0 or op.ref.size() > 40) { return #err("Nieuw hoofdstuk zonder sleutel") };
          let k = "r" # op.ref;
          if (chs.get(k) != null) { return #err("Dubbele sleutel " # op.ref) };
          k;
        };
      };
      if (op.remove) {
        if (op.id == null) { return #err("Een nieuw hoofdstuk kan niet weg") };
        switch (chs.get(key)) { case (?c) chs.add(key, { c with active = false; touched = true }); case null {} };
      } else {
        let title = Access.cleanText(op.title, Config.maxLibTitle) ?? return #err("Hoofdstuk: titel 1 tot " # Config.maxLibTitle.toText() # " tekens");
        let code = op.code.trim(#char ' ');
        if (code.size() > Config.maxLibCode) { return #err("Hoofdstuk: code te lang") };
        if (op.order > 1_000_000_000) { return #err("Volgorde te groot") };
        switch (op.libChapterId) { case (?lc) { if (library.chapters.get(lc) == null) { return #err("Onbekend hoofdstuk in de bibliotheek") } }; case null {} };
        let s = switch (chs.get(key)) { case (?c) c.seq; case null { seq += 1; seq } };
        chs.add(key, { id = op.id; code; title; order = op.order; libChapterId = op.libChapterId; active = true; touched = true; seq = s });
      };
    };

    // 4. Lijnen
    for (op in lineOps.values()) {
      let key = switch (op.id) {
        case (?id) { let k = "i" # id.toText(); if (lns.get(k) == null) { return #err("Onbekende lijn #" # id.toText() # " in deze versie") }; k };
        case null {
          if (op.ref.size() == 0 or op.ref.size() > 40) { return #err("Nieuwe lijn zonder sleutel") };
          let k = "r" # op.ref;
          if (lns.get(k) != null) { return #err("Dubbele sleutel " # op.ref) };
          k;
        };
      };
      if (op.remove) {
        if (op.id == null) { return #err("Een nieuwe lijn kan niet weg") };
        switch (lns.get(key)) { case (?l) lns.add(key, { l with active = false; touched = true }); case null {} };
      } else {
        let chKey = switch (op.chapter) { case (#id c) "i" # c.toText(); case (#ref r) "r" # r };
        let what = if (op.title != "") op.title else if (op.code != "") op.code else "nieuwe lijn";
        if (op.title.size() > Config.maxLibTitle or op.code.size() > Config.maxLibCode or op.text.size() > Config.maxQuoteText or op.specRef.size() > Config.maxName) { return #err("«" # what # "»: titel, code, tekst of verwijzing te lang") };
        if (op.kind != #text and op.title.trim(#char ' ') == "" and op.text.trim(#char ' ') == "") { return #err("Een post of optie heeft een titel of tekst nodig") };
        if (Int.abs(op.qtyMilli) > Int.abs(Config.maxQuoteQtyMilli)) { return #err("«" # what # "»: hoeveelheid te groot") };
        if (op.order > 1_000_000_000) { return #err("Volgorde te groot") };
        if (op.kind == #text) {
          if (op.price.costCents != null or op.price.rule != null) { return #err("Een tekstregel heeft geen prijs") };
          if (op.unit != "" and units.find(func u = u.key == op.unit) == null) { return #err("Onbekende eenheid: " # op.unit) };
        } else {
          if (units.find(func u = u.key == op.unit) == null) { return #err("«" # what # "»: kies een eenheid") };
        };
        switch (op.price.costCents) { case (?c) { if (c < 0 or c > Config.maxAmountCents) { return #err("«" # what # "»: aankoopprijs tussen € 0 en € 1 miljard per eenheid") } }; case null {} };
        switch (op.price.rule) { case (?r) { switch (Library.ruleError(r)) { case (?e) return #err("«" # what # "»: " # e); case null {} } }; case null {} };
        if (op.price.reason.size() > Config.maxText) { return #err("«" # what # "»: reden te lang") };
        if (not Quotes.sourceOk(op.price.source)) { return #err("Onbekende herkomst: " # op.price.source) };
        switch (op.price.orgId) {
          case (?o) {
            let x = org.orgs.get(o) ?? return #err("Onbekende firma");
            if (x.kind != #subcontractor and x.kind != #supplier) { return #err("«" # what # "»: kies een onderaannemer of leverancier") };
          };
          case null {};
        };
        switch (op.price.libCostId) { case (?lc) { if (library.costs.get(lc) == null) { return #err("Onbekende prijs uit de bibliotheek") } }; case null {} };
        switch (op.libItemId) { case (?li) { if (library.items.get(li) == null) { return #err("Onbekende post uit de bibliotheek") } }; case null {} };
        let copied = switch (lns.get(key)) { case (?l) l.copiedFrom; case null null };
        // Terug naar de standaardmarge = geen reden meer (zoals in de bibliotheek).
        let reason = if (op.price.rule == null) "" else op.price.reason.trim(#char ' ');
        lns.add(key, { id = op.id; chapter = chKey; order = op.order; kind = op.kind; code = op.code.trim(#char ' '); title = op.title.trim(#char ' '); text = op.text; specRef = op.specRef.trim(#char ' '); qtyMilli = op.qtyMilli; unit = op.unit; form = op.form; libItemId = op.libItemId; libItemVersion = op.libItemVersion; copiedFrom = copied; price = { cost = op.price.costCents; rule = op.price.rule; reason; orgId = op.price.orgId; source = op.price.source; libCostId = op.price.libCostId }; active = true; touched = true });
      };
    };

    // 5. Samenhang en grenzen
    let activeChs = chs.entries().filter(func((_, c) : (Text, WCh)) : Bool = c.active).toArray().sort(
      func(a, b) = switch (Nat.compare(a.1.order, b.1.order)) { case (#equal) Nat.compare(a.1.seq, b.1.seq); case o o }
    );
    if (activeChs.size() > Config.maxQuoteChapters) { return #err("Te veel hoofdstukken (hoogstens " # Config.maxQuoteChapters.toText() # ")") };
    let chPos = Map.empty<Text, Nat>();
    for ((i, (k, _)) in activeChs.enumerate()) { chPos.add(k, i) };
    let activeLns = lns.entries().filter(func((_, l) : (Text, WLn)) : Bool = l.active).toArray();
    if (activeLns.size() > Config.maxQuoteLines) { return #err("Te veel lijnen (hoogstens " # Config.maxQuoteLines.toText() # ")") };
    var textTotal = 0;
    for ((_, l) in activeLns.values()) {
      if (chPos.get(l.chapter) == null) { return #err("«" # (if (l.title != "") l.title else l.code) # "» staat in een hoofdstuk dat er niet (meer) is") };
      textTotal += l.title.size() + l.text.size() + l.specRef.size() + l.code.size();
    };
    if (textTotal > Config.maxQuoteTextTotal) { return #err("Alle tekst samen is te lang voor één versie (hoogstens " # Config.maxQuoteTextTotal.toText() # " tekens): kort de lastenboekteksten in of verdeel de offerte") };

    // 6. Rekenen (zelfde regels als de browser) en vergelijken: bij één verschil wordt niets bewaard.
    let calcLines = activeLns.map(func((_, l) : (Text, WLn)) : QuoteCalc.Line = { chapter = qtPos(chPos.get(l.chapter)); kind = l.kind; qtyMilli = l.qtyMilli; cost = l.price.cost; rule = l.price.rule });
    let t = QuoteCalc.totals(Array.tabulate<Nat>(activeChs.size(), func i = i), calcLines, nv.vatBp, std);
    for (cl in calcLines.values()) {
      if (Int.abs(QuoteCalc.line(cl, std).lineSell) > Int.abs(Config.maxAmountCents)) { return #err("Een lijn komt boven € 1 miljard: tikfout?") };
    };
    if (Int.abs(t.subtotal) > Int.abs(Config.maxAmountCents) or Int.abs(t.optionsPlus) > Int.abs(Config.maxAmountCents) or Int.abs(t.optionsMinus) > Int.abs(Config.maxAmountCents)) { return #err("Het totaal komt boven € 1 miljard: tikfout?") };
    var diff : [Text] = [];
    let cmp = func(name : Text, browser : Int, backend : Int) { if (browser != backend) { diff := diff.concat([name # " " # Int.toText(browser) # " ≠ " # Int.toText(backend)]) } };
    cmp("subtotaal", expect.subtotalCents, t.subtotal);
    cmp("btw", expect.vatCents, t.vat);
    cmp("totaal", expect.totalCents, t.total);
    cmp("opties meer", expect.optionsPlusCents, t.optionsPlus);
    cmp("opties min", expect.optionsMinusCents, t.optionsMinus);
    cmp("aankoop", expect.costCents, t.cost);
    cmp("marge", expect.marginCents, t.margin);
    if (expect.chapters.size() != activeChs.size()) { diff := diff.concat(["hoofdstukken " # expect.chapters.size().toText() # " ≠ " # activeChs.size().toText()]) };
    for (e in expect.chapters.values()) {
      let k = switch (e.chapter) { case (#id c) "i" # c.toText(); case (#ref r) "r" # r };
      switch (chPos.get(k)) {
        case (?i) cmp("hoofdstuk " # activeChs[i].1.code # " " # activeChs[i].1.title, e.sellCents, t.chapters[i].sell);
        case null { diff := diff.concat(["onbekend hoofdstuk " # k]) };
      };
    };
    if (diff.size() > 0) {
      return #err("De totalen van de browser en van de server verschillen; er is niets bewaard (" # diff.values().join("; ") # "). Laad de offerte opnieuw.");
    };

    // 7. Schrijven
    let now = Time.now();
    var refs : [(Text, Nat)] = [];
    let chIds = Map.empty<Text, Nat>();
    for ((k, c) in chs.entries()) {
      switch (c.id) { case (?id) chIds.add(k, id); case null {} };
    };
    for ((k, c) in chs.entries()) {
      if (c.touched) {
        switch (c.id) {
          case (?id) {
            switch (quotes.chapters.get(id)) {
              case (?old) quotes.chapters.add(id, { old with code = c.code; title = c.title; order = c.order; libChapterId = c.libChapterId; archivedAt = if (c.active) null else ?now });
              case null {};
            };
          };
          case null {
            let id = Ids.next(ctr, "quoteChapter");
            quotes.chapters.add(id, { id; versionId = v.id; code = c.code; title = c.title; order = c.order; libChapterId = c.libChapterId; archivedAt = null; extra = [] });
            Quotes.addIndex(quotes.chaptersByVersion, v.id, id);
            chIds.add(k, id);
            refs := refs.concat([(Text.fromIter(k.chars().drop(1)), id)]);
          };
        };
      };
    };
    var nNew = 0;
    var nChanged = 0;
    var nRemoved = 0;
    for ((k, l) in lns.entries()) {
      if (l.touched) {
        let chId = switch (chIds.get(l.chapter)) { case (?x) x; case null 0 };
        let price : Types.QuoteLinePrice = { lineId = 0; versionId = v.id; cost = #plain(l.price.cost); rule = #plain(l.price.rule); reason = #plain(l.price.reason); orgId = l.price.orgId; source = l.price.source; libCostId = l.price.libCostId; extra = [] };
        switch (l.id) {
          case (?id) {
            switch (quotes.lines.get(id)) {
              case (?old) {
                if (l.active) {
                  quotes.lines.add(id, { old with chapterId = chId; order = l.order; kind = l.kind; code = l.code; title = l.title; text = l.text; specRef = l.specRef; qtyMilli = l.qtyMilli; unit = l.unit; form = l.form; libItemId = l.libItemId; libItemVersion = l.libItemVersion });
                  quotes.prices.add(id, { price with lineId = id; extra = switch (quotes.prices.get(id)) { case (?x) x.extra; case null [] } });
                  nChanged += 1;
                } else {
                  quotes.lines.add(id, { old with archivedAt = ?now });
                  nRemoved += 1;
                };
              };
              case null {};
            };
          };
          case null {
            let id = Ids.next(ctr, "quoteLine");
            quotes.lines.add(id, { id; versionId = v.id; chapterId = chId; order = l.order; kind = l.kind; code = l.code; title = l.title; text = l.text; specRef = l.specRef; qtyMilli = l.qtyMilli; unit = l.unit; form = l.form; libItemId = l.libItemId; libItemVersion = l.libItemVersion; copiedFrom = null; archivedAt = null; extra = [] });
            quotes.prices.add(id, { price with lineId = id });
            Quotes.addIndex(quotes.linesByVersion, v.id, id);
            refs := refs.concat([(Text.fromIter(k.chars().drop(1)), id)]);
            nNew += 1;
          };
        };
      };
    };
    let saved = { nv with rev = v.rev + 1; updatedAt = now; updatedBy = p.id };
    quotes.versions.add(v.id, saved);
    switch header { case (?_) quotes.versionConf.add(v.id, { versionId = v.id; standardMarginBp = #plain(std); extra = switch (quotes.versionConf.get(v.id)) { case (?x) x.extra; case null [] } }); case null {} };
    quotes.quotes.add(q.id, { q with title = saved.title; updatedAt = now; updatedBy = p.id });
    // Enkel aantallen, nooit een bedrag, marge of OA.
    Access.audit(audit, caller, ?p.id, ?q.workId, "offerte-bewaard", q.number # " v" # v.version.toText() # ": " # nNew.toText() # " nieuw, " # nChanged.toText() # " gewijzigd, " # nRemoved.toText() # " weg");
    let c = qtCompute(saved);
    #ok({ rev = saved.rev; refs; totals = Quotes.totalsView(c.totals, saved.vatBp, saved.calcVersion); margins = Quotes.marginTotals(c.totals, c.std, Quotes.noReason(c)) });
  };

  // ── Versturen en beslissen ─────────────────────────────────────────────
  // Versturen = de versie vastleggen zoals de klant ze krijgt (hash van de inhoud, totalen); daarna onwijzigbaar. Een
  // eerder verzonden versie van dezelfde offerte wordt "vervangen". Enkel met een volledig totaal (elke post een prijs);
  // de controleregels vóór verzending komen in 2.6. Het eigenlijke versturen (PDF, akkoord van de klant) is 2.7.
  public shared ({ caller }) func sendQuoteVersion(versionId : Nat, rev : Nat, expectTotalCents : Int) : async Result.Result<Text, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #sendQuote, null);
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (v.status != #draft) { return #err("Versie " # v.version.toText() # " is al " # Quotes.statusText(v.status)) };
    if (rev != v.rev) { return #err("Iemand anders bewaarde deze versie intussen; laad opnieuw") };
    if (v.calcVersion != QuoteCalc.version) { return #err("Deze versie rekent met oude regels: maak een nieuwe versie") };
    let c = qtCompute(v);
    if (c.lines.filter(func l = l.kind == #item).size() == 0) { return #err("Er staat nog geen enkele post in deze versie") };
    if (c.totals.noPrice > 0) { return #err(c.totals.noPrice.toText() # " lijn(en) zonder prijs: het totaal is onvolledig") };
    if (expectTotalCents != c.totals.total) { return #err("Het totaal is intussen veranderd; laad opnieuw") };
    let now = Time.now();
    let h = Quotes.hash(Quotes.canonical(q, v, c));
    for (o in Quotes.versionsOf(quotes, q.id).values()) {
      if (o.id != v.id and o.status == #sent) { quotes.versions.add(o.id, { o with status = #superseded; updatedAt = now; updatedBy = p.id }) };
    };
    let t = c.totals;
    quotes.versions.add(v.id, { v with status = #sent; rev = v.rev + 1; sent = ?{ at = now; by = p.id; hash = h; subtotalCents = t.subtotal; vatCents = t.vat; totalCents = t.total; optionsPlusCents = t.optionsPlus; optionsMinusCents = t.optionsMinus }; updatedAt = now; updatedBy = p.id });
    quotes.quotes.add(q.id, { q with updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, "offerte-verstuurd", q.number # " v" # v.version.toText() # " hash " # Text.fromIter(h.chars().take(12)));
    #ok(h);
  };

  // De klant aanvaardt of weigert een verzonden versie (vastgelegd door kantoor; het digitale akkoord is 2.7).
  public shared ({ caller }) func decideQuoteVersion(versionId : Nat, accepted : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #sendQuote, null);
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (v.status != #sent) { return #err("Enkel een verzonden versie kan aanvaard of geweigerd worden") };
    if (note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    quotes.versions.add(v.id, { v with status = if accepted #accepted else #rejected; decision = ?{ at = now; by = p.id; note = note.trim(#char ' ') }; updatedAt = now; updatedBy = p.id });
    quotes.quotes.add(q.id, { q with updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, if accepted "offerte-aanvaard" else "offerte-geweigerd", q.number # " v" # v.version.toText());
    #ok;
  };

  // Archiveren (met reden) of terugzetten; nooit wissen.
  public shared ({ caller }) func setQuoteArchived(quoteId : Nat, archived : Bool, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    let q = quotes.quotes.get(quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if ((q.archivedAt != null) == archived) { return #ok };
    if (reason.size() > Config.maxText) { return #err("Reden te lang") };
    if (archived and reason.trim(#char ' ') == "") { return #err("Geef een reden (bv. klant haakte af, dubbel)") };
    let now = Time.now();
    quotes.quotes.add(quoteId, { q with archivedAt = if archived ?now else null; archivedBy = if archived ?p.id else null; archiveReason = if archived reason.trim(#char ' ') else ""; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, if archived "offerte-gearchiveerd" else "offerte-teruggezet", q.number);
    #ok;
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func qtFind(versionId : Nat) : ?(Types.QuoteVersion, Types.Quote) {
    switch (quotes.versions.get(versionId)) {
      case (?v) { switch (quotes.quotes.get(v.quoteId)) { case (?q) ?(v, q); case null null } };
      case null null;
    };
  };

  func qtCtx() : Quotes.Ctx { { settings; access; org; works; qs = quotes } };

  func qtCompute(v : Types.QuoteVersion) : Quotes.Computed {
    if (v.calcVersion != QuoteCalc.version) { Runtime.trap("Onbekende rekenversie " # v.calcVersion.toText()) };
    Quotes.compute(quotes, v, Library.standardMargin(settings));
  };

  // Een verzonden versie: geeft de inhoud nog dezelfde hash? (Een ontwerp is altijd "intact".)
  func qtIntact(q : Types.Quote, v : Types.QuoteVersion, c : Quotes.Computed) : Bool {
    switch (v.sent) { case (?s) Quotes.hash(Quotes.canonical(q, v, c)) == s.hash; case null true };
  };

  func qtToday() : Nat { let t = Time.now(); if (t <= 0) 0 else Int.abs(t) / Int.abs(Config.day) };
  func qtSeqKey() : Text { "offerte:" # Quotes.yearOf(qtToday()).toText() };
  // Het volgende vrije nummer van dit jaar (een met de hand gegeven nummer kan het volgende al bezetten).
  func qtNextNumber() : (Text, Nat) {
    var n = (switch (settings.sequences.get(qtSeqKey())) { case (?x) x; case null 0 }) + 1;
    let year = Quotes.yearOf(qtToday());
    while (quotes.numbers.get(Quotes.formatNumber(year, n)) != null) { n += 1 };
    (Quotes.formatNumber(year, n), n);
  };
  func qtPos(x : ?Nat) : Nat { switch x { case (?n) n; case null Runtime.trap("hoofdstuk ontbreekt") } };
};
