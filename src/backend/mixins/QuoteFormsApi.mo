// De offerte zoals Alexis ze maakt (stap 2c.1, ontwerp 2c §4.1; VOORLOPIG: AC-14, AC-27 en de lijst voor Alexis):
// margeklassen en hun koppeling aan een bibliotheekhoofdstuk of een firma (Beheer), vaste tekstblokken (Beheer), de soort
// van een offerte (schadedossier met verzekeraar en dossiernummer) en per ontwerpversie wat de klant ziet (posten met 0,
// regietekst, tekstblokken), subgroepen per hoofdstuk, het regietarief en de korting.
// Rechten (geen nieuwe actie, ontwerp §4.1): klassen en koppelingen #readCosts (R20) en beheren met #editLibrary;
// tekstblokken lezen #editQuote, beheren #editLibrary; een offerte vormen #editQuote + #readCosts (de marges, R22) op een
// werf die de beller ziet. Klassen, versievoorwaarden en bedragen enkel via update-calls met een auditregel (R23); de
// auditregel draagt nooit een marge of bedrag.
// Rekenen: saveQuoteForm rekent met de nieuwe voorwaarden na (lib/Quotes.computeWith, QuoteCalc versie 2) en bewaart
// NIETS als de browser een ander subtotaal, een andere korting of een ander totaal vond.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import FormViews "../types/formviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Library "../lib/Library";
import QuoteCalc "../lib/QuoteCalc";
import QuoteForms "../lib/QuoteForms";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  quoteForms : Types.QuoteFormState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Margeklassen (vertrouwelijk) ───────────────────────────────────────
  public shared ({ caller }) func listMarginClasses() : async Result.Result<FormViews.MarginClassesView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readCosts, null);
    Access.audit(audit, caller, ?p.id, null, "bekeek:margeklassen", "");
    #ok(QuoteForms.classesView(quoteForms));
  };

  // Een klasse maken (id null) of wijzigen; nooit wissen, wel archiveren (een gearchiveerde klasse telt in een ontwerp niet
  // meer; een verzonden versie hield haar marge al vast).
  public shared ({ caller }) func setMarginClass(i : FormViews.MarginClassInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editLibrary, null);
    Rights.require(ctx, p, #readCosts, null);
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (i.marginBp > Config.maxLibMarginBp) { return #err("Marge: 0 tot 90 %") };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    let same = func(c : Types.MarginClass) : Bool = Text.toLower(c.name) == Text.toLower(name) and c.archivedAt == null and ?c.id != i.id;
    if (quoteForms.classes.values().any(func(x : Types.Confidential<Types.MarginClass>) : Bool = switch (Library.plainOf(x)) { case (?c) same(c); case null false })) {
      return #err("Er is al een klasse " # name);
    };
    let id = switch (i.id) {
      case (?id) {
        let old = QuoteForms.classOf(quoteForms, id) ?? return #err("Onbekende klasse");
        quoteForms.classes.add(id, #plain({ old with name; marginBp = i.marginBp; note = i.note.trim(#char ' '); updatedAt = now; updatedBy = p.id; archivedAt = if (i.archived) (if (old.archivedAt != null) old.archivedAt else ?now) else null }));
        id;
      };
      case null {
        if (quoteForms.classes.size() >= Config.maxMarginClasses) { return #err("Te veel klassen (hoogstens " # Config.maxMarginClasses.toText() # ")") };
        let id = Ids.next(ctr, "marginClass");
        quoteForms.classes.add(id, #plain({ id; name; marginBp = i.marginBp; note = i.note.trim(#char ' '); createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = if (i.archived) ?now else null; extra = [] }));
        id;
      };
    };
    Access.audit(audit, caller, ?p.id, null, "margeklasse-gezet", "#" # id.toText() # (if (i.archived) " gearchiveerd" else ""));
    #ok(id);
  };

  // Een bibliotheekhoofdstuk ("ch:<id>") of een onderaannemer/leverancier ("org:<id>") krijgt een standaardklasse; null = weg.
  public shared ({ caller }) func setMarginClassLink(key : Text, classId : ?Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editLibrary, null);
    Rights.require(ctx, p, #readCosts, null);
    let ok = if (key.startsWith(#text "ch:")) {
      switch (Nat.fromText(Text.fromIter(key.chars().drop(3)))) { case (?id) library.chapters.get(id) != null; case null false };
    } else if (key.startsWith(#text "org:")) {
      switch (Nat.fromText(Text.fromIter(key.chars().drop(4)))) {
        case (?id) { switch (org.orgs.get(id)) { case (?o) o.kind == #subcontractor or o.kind == #supplier; case null false } };
        case null false;
      };
    } else false;
    if (not ok) { return #err("Kies een hoofdstuk uit de bibliotheek of een onderaannemer of leverancier") };
    switch classId {
      case (?c) {
        switch (QuoteForms.classOf(quoteForms, c)) { case (?x) { if (x.archivedAt != null) { return #err("Deze klasse is gearchiveerd") } }; case null return #err("Onbekende klasse") };
        quoteForms.classLinks.add(key, #plain({ key; classId = c; at = Time.now(); by = p.id }));
      };
      case null { quoteForms.classLinks.remove(key) };
    };
    Access.audit(audit, caller, ?p.id, null, "margeklasse-gekoppeld", key # " → " # (switch classId { case (?c) "#" # c.toText(); case null "geen" }));
    #ok;
  };

  // ── Tekstblokken (intern) ──────────────────────────────────────────────
  public query ({ caller }) func listTextBlocks(includeArchived : Bool) : async [FormViews.TextBlockView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editQuote, null);
    QuoteForms.blocksSorted(quoteForms).filter(func b = includeArchived or b.archivedAt == null).map(QuoteForms.textBlockView);
  };

  public shared ({ caller }) func setTextBlock(i : FormViews.TextBlockInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editLibrary, null);
    let key = Text.toLower(i.key.trim(#char ' '));
    if (key.size() == 0 or key.size() > 40 or not key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) {
      return #err("Code: 1 tot 40 tekens, enkel a-z, 0-9 en -");
    };
    let title = Access.cleanText(i.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    if (i.text.trim(#char ' ').size() == 0 or i.text.size() > Config.maxTextBlockText) { return #err("Tekst: 1 tot " # Config.maxTextBlockText.toText() # " tekens") };
    switch (i.place) { case (#chapter c) { if (c.trim(#char ' ').size() == 0 or c.size() > Config.maxLibCode) { return #err("Geef de code van het hoofdstuk") } }; case _ {} };
    if (i.order > 1_000) { return #err("Volgorde: 0 tot 1.000") };
    let old = quoteForms.textBlocks.get(key);
    if (old == null and quoteForms.textBlocks.size() >= Config.maxTextBlocks) { return #err("Te veel tekstblokken") };
    let now = Time.now();
    let version = switch old { case (?o) { if (o.text != i.text or o.title != title) o.version + 1 else o.version }; case null 1 };
    quoteForms.textBlocks.add(key, { key; title; text = i.text; defaultOn = i.defaultOn; place = i.place; order = i.order; version; updatedAt = now; updatedBy = p.id; archivedAt = if (i.archived) (switch old { case (?o) { if (o.archivedAt != null) o.archivedAt else ?now }; case null ?now }) else null; extra = switch old { case (?o) o.extra; case null [] } });
    Access.audit(audit, caller, ?p.id, null, "tekstblok-gezet", key # " v" # version.toText() # (if (i.archived) " gearchiveerd" else ""));
    #ok;
  };

  // ── De soort van een offerte ───────────────────────────────────────────
  // Gewoon, schadedossier (verzekeraar = firma van de soort andere of klant, dossiernummer) of enkel regie. De
  // meerwerkofferte komt met 2c.5. Een verzonden versie hield haar soort al vast (valt onder de hash).
  public shared ({ caller }) func setQuoteInfo(quoteId : Nat, i : FormViews.QuoteInfoInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    let q = quotes.quotes.get(quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (i.kind == #extraWork) { return #err("De meerwerkofferte komt in een volgende stap") };
    let damage = i.kind == #damage;
    switch (i.insurerOrgId) {
      case (?o) {
        if (not damage) { return #err("Enkel een schadedossier heeft een verzekeraar") };
        let x = org.orgs.get(o) ?? return #err("Onbekende firma");
        if (x.kind != #other and x.kind != #client) { return #err("Kies een verzekeraar (firma van de soort andere of klant)") };
      };
      case null {};
    };
    let claim = i.claimRef.trim(#char ' ');
    if (claim.size() > Config.maxClaimRef) { return #err("Dossiernummer: hoogstens " # Config.maxClaimRef.toText() # " tekens") };
    if (not damage and claim.size() > 0) { return #err("Enkel een schadedossier heeft een dossiernummer") };
    if (not damage and Quotes.versionsOf(quotes, quoteId).any(func v = v.status == #draft and v.vatBp == 0)) {
      return #err("Het ontwerp staat op 0 % btw: zet eerst het btw-tarief terug");
    };
    quoteForms.info.add(quoteId, { quoteId; kind = i.kind; baseQuoteId = null; insurerOrgId = i.insurerOrgId; claimRef = claim; updatedAt = Time.now(); updatedBy = p.id; extra = switch (quoteForms.info.get(quoteId)) { case (?x) x.extra; case null [] } });
    Access.audit(audit, caller, ?p.id, ?q.workId, "offertesoort-gezet", q.number # ": " # QuoteForms.kindText(i.kind));
    #ok;
  };

  // ── De vorm van een ontwerpversie ──────────────────────────────────────
  // Alles of niets: eerst nakijken en narekenen, dan schrijven. `rev` = de stand die de beller las (zoals saveQuoteDraft).
  public shared ({ caller }) func saveQuoteForm(versionId : Nat, rev : Nat, i : FormViews.QuoteFormInput, expect : FormViews.QuoteFormExpect) : async Result.Result<FormViews.QuoteFormSaved, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    Rights.require(ctx, p, #readCosts, null);
    let v0 = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v0.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (v0.status != #draft) { return #err("Versie " # v0.version.toText() # " is " # Quotes.statusText(v0.status) # " en kan niet meer veranderen: maak een nieuwe versie") };
    if (rev != v0.rev) { return #err("Iemand anders bewaarde deze versie intussen (stand " # v0.rev.toText() # "); laad opnieuw") };
    if (i.subgroupOps.size() + i.lineOps.size() + i.chapterMargins.size() > Config.maxQuoteOps) { return #err("Te veel wijzigingen in één keer") };
    let v = { v0 with calcVersion = QuoteCalc.version };
    let chapters = Quotes.chaptersOf(quotes, v.id);
    let lines = Quotes.linesOf(quotes, v.id, chapters);
    let chIn = func(id : Nat) : Bool = chapters.find(func(c : Types.QuoteChapter) : Bool = c.id == id) != null;

    // 1. Tekstblokken
    var keys : [Text] = [];
    for (k in i.textBlockKeys.values()) {
      switch (quoteForms.textBlocks.get(k)) {
        case (?b) { if (b.archivedAt != null) { return #err("Tekstblok " # b.title # " is gearchiveerd") } };
        case null return #err("Onbekend tekstblok " # k);
      };
      if (keys.find(func x = x == k) == null) { keys := keys.concat([k]) };
    };

    // 2. Subgroepen (werkkopie)
    type WSg = { id : ?Nat; chapterId : Nat; title : Text; order : Nat; active : Bool; touched : Bool };
    let sgs = Map.empty<Text, WSg>();
    for (s in QuoteForms.subgroupsOf(quoteForms, v.id).values()) {
      sgs.add("i" # s.id.toText(), { id = ?s.id; chapterId = s.chapterId; title = s.title; order = s.order; active = chIn(s.chapterId); touched = not chIn(s.chapterId) });
    };
    for (op in i.subgroupOps.values()) {
      let key = switch (op.id) {
        case (?id) { let k = "i" # id.toText(); if (sgs.get(k) == null) { return #err("Onbekende subgroep #" # id.toText() # " in deze versie") }; k };
        case null {
          if (op.ref.size() == 0 or op.ref.size() > 40) { return #err("Nieuwe subgroep zonder code") };
          let k = "r" # op.ref;
          if (sgs.get(k) != null) { return #err("Dubbele code " # op.ref) };
          k;
        };
      };
      if (op.remove) {
        if (op.id == null) { return #err("Een nieuwe subgroep kan niet weg") };
        switch (sgs.get(key)) { case (?s) sgs.add(key, { s with active = false; touched = true }); case null {} };
      } else {
        let title = Access.cleanText(op.title, Config.maxLibTitle) ?? return #err("Subgroep: titel 1 tot " # Config.maxLibTitle.toText() # " tekens");
        if (not chIn(op.chapterId)) { return #err("Subgroep «" # title # "»: onbekend hoofdstuk in deze versie") };
        if (op.order > 1_000_000_000) { return #err("Volgorde te groot") };
        sgs.add(key, { id = op.id; chapterId = op.chapterId; title; order = op.order; active = true; touched = true });
      };
    };
    let activeSg = sgs.entries().filter(func((_, s) : (Text, WSg)) : Bool = s.active).toArray();
    if (activeSg.size() > Config.maxQuoteSubgroups) { return #err("Te veel subgroepen") };

    // 3. Lijnvorm
    let lfs = Map.empty<Nat, (?Text, ?Bool)>(); // lijn → (sleutel van de subgroep, toon toch)
    for (l in lines.values()) {
      switch (quoteForms.lineForms.get(l.id)) {
        case (?lf) { lfs.add(l.id, (switch (lf.subgroupId) { case (?s) ?("i" # s.toText()); case null null }, lf.showToClient)) };
        case null {};
      };
    };
    for (op in i.lineOps.values()) {
      let l = switch (lines.find(func(x : Types.QuoteLine) : Bool = x.id == op.lineId)) { case (?x) x; case null return #err("Onbekende post #" # op.lineId.toText() # " in deze versie") };
      let sk : ?Text = switch (op.subgroup) {
        case (?#id s) ?("i" # s.toText());
        case (?#ref r) ?("r" # r);
        case null null;
      };
      switch sk {
        case (?k) {
          switch (sgs.get(k)) {
            case (?s) { if (not s.active) { return #err("«" # l.title # "»: die subgroep is weg") }; if (s.chapterId != l.chapterId) { return #err("«" # l.title # "»: de subgroep hoort bij een ander hoofdstuk") } };
            case null return #err("«" # l.title # "»: onbekende subgroep");
          };
        };
        case null {};
      };
      lfs.add(l.id, (sk, op.showToClient));
    };
    // Een lijn in een weggehaalde subgroep (of die naar een ander hoofdstuk verhuisde) staat weer los.
    for ((lid, (sk, show)) in lfs.entries().toArray().values()) {
      switch sk {
        case (?k) {
          let lch = switch (lines.find(func(x : Types.QuoteLine) : Bool = x.id == lid)) { case (?x) x.chapterId; case null 0 };
          switch (sgs.get(k)) { case (?s) { if (not s.active or s.chapterId != lch) { lfs.add(lid, (null, show)) } }; case null { lfs.add(lid, (null, show)) } };
        };
        case null {};
      };
    };

    // 4. Voorwaarden (vertrouwelijk)
    let old = switch (QuoteForms.termsOf(quoteForms, v.id)) { case (?t) t; case null QuoteForms.emptyTerms(v.id) };
    var chm : [(Nat, Types.QuoteMarginPick)] = [];
    for (m in i.chapterMargins.values()) {
      if (not chIn(m.id)) { return #err("Marge voor een onbekend hoofdstuk") };
      if (chm.find(func((k, _) : (Nat, Types.QuoteMarginPick)) : Bool = k == m.id) != null) { return #err("Twee marges voor hetzelfde hoofdstuk") };
      // Een marge die de versie al vastlegde (ook overgenomen uit een verzonden versie) blijft zoals ze was, ook als de klasse
      // intussen veranderde; een nieuw gekozen klasse geldt met haar marge van nu.
      let kept = old.chapterMargins.find(func((k, p) : (Nat, Types.QuoteMarginPick)) : Bool = k == m.id and p.classId == m.classId and p.marginBp == m.marginBp);
      let pick : Types.QuoteMarginPick = switch (kept, m.classId) {
        case (?(_, p), _) p;
        case (null, ?c) {
          let x = QuoteForms.classOf(quoteForms, c) ?? return #err("Onbekende klasse");
          if (x.archivedAt != null) { return #err("Klasse " # x.name # " is gearchiveerd") };
          { classId = ?c; marginBp = x.marginBp };
        };
        case (null, null) { if (m.marginBp > Config.maxLibMarginBp) { return #err("Marge: 0 tot 90 %") }; { classId = null; marginBp = m.marginBp } };
      };
      chm := chm.concat([(m.id, pick)]);
    };
    let regie : ?Types.QuoteRegie = switch (i.regie) {
      case (?g) {
        if (g.costCents < 0 or g.costCents > Config.maxAmountCents) { return #err("Uurloon: € 0 tot € 1 miljard") };
        switch (g.orgId) {
          case (?o) { let x = org.orgs.get(o) ?? return #err("Onbekende firma"); if (x.kind != #subcontractor and x.kind != #supplier and x.kind != #bowaco) { return #err("Regie: kies een onderaannemer (of BOWACO zelf)") } };
          case null {};
        };
        let sell = switch (g.sellCents) { case (?x) x; case null QuoteForms.regieSell(g.costCents) };
        if (sell < 0 or sell > Config.maxAmountCents) { return #err("Regietarief: € 0 tot € 1 miljard") };
        ?{ orgId = g.orgId; costCents = g.costCents; sellCents = sell; fromRateId = null };
      };
      case null null;
    };
    switch (i.discount) {
      case (?#amount a) { if (a < 0 or a > Config.maxAmountCents) { return #err("Korting: € 0 tot € 1 miljard") } };
      case (?#percent bp) { if (bp > 10_000) { return #err("Korting: 0 tot 100 %") } };
      case null {};
    };
    let dText = i.discountText.trim(#char ' ');
    if (dText.size() > Config.maxLibTitle) { return #err("Tekst van de korting: hoogstens " # Config.maxLibTitle.toText() # " tekens") };
    if (i.discount == null and dText.size() > 0) { return #err("Een tekst voor de korting zonder korting") };
    let terms : Types.QuoteVersionTerms = { old with chapterMargins = chm; regie; discount = i.discount; discountText = dText };

    // 5. Narekenen (zelfde regels als de browser)
    let c = Quotes.computeWith(quotes, quoteForms, v, Library.standardMargin(settings), { terms = ?terms; live = true });
    if (Int.abs(c.totals.discount) > Int.abs(Config.maxAmountCents) or Int.abs(c.totals.subtotal) > Int.abs(Config.maxAmountCents)) { return #err("Het totaal komt boven € 1 miljard: tikfout?") };
    switch (i.discount) { case (?#amount a) { if (c.totals.gross >= 0 and a > c.totals.gross) { return #err("De korting is groter dan het totaal") } }; case _ {} };
    if (expect.subtotalCents != c.totals.subtotal or expect.discountCents != c.totals.discount or expect.totalCents != c.totals.total) {
      return #err("De totalen van de browser en van de server verschillen; er is niets bewaard (subtotaal " # Int.toText(expect.subtotalCents) # " ≠ " # Int.toText(c.totals.subtotal) # "; korting " # Int.toText(expect.discountCents) # " ≠ " # Int.toText(c.totals.discount) # "; totaal " # Int.toText(expect.totalCents) # " ≠ " # Int.toText(c.totals.total) # "). Laad de offerte opnieuw.");
    };

    // 6. Schrijven
    let now = Time.now();
    quoteForms.versionForms.add(v.id, { versionId = v.id; hideZeroLines = i.hideZeroLines; regieText = i.regieText; textBlockKeys = keys; extra = switch (quoteForms.versionForms.get(v.id)) { case (?f) f.extra; case null [] } });
    var refs : [(Text, Nat)] = [];
    let sgIds = Map.empty<Text, Nat>();
    for ((k, s) in sgs.entries()) {
      switch (s.id) {
        case (?id) {
          sgIds.add(k, id);
          if (s.touched) {
            switch (quoteForms.subgroups.get(id)) { case (?o) quoteForms.subgroups.add(id, { o with chapterId = s.chapterId; title = s.title; order = s.order; archivedAt = if (s.active) null else ?now }); case null {} };
          };
        };
        case null {
          let id = Ids.next(ctr, "quoteSubgroup");
          quoteForms.subgroups.add(id, { id; versionId = v.id; chapterId = s.chapterId; title = s.title; order = s.order; copiedFrom = null; archivedAt = null });
          QuoteForms.addIndex(quoteForms.subgroupsByVersion, v.id, id);
          sgIds.add(k, id);
          refs := refs.concat([(Text.fromIter(k.chars().drop(1)), id)]);
        };
      };
    };
    for ((lid, (sk, show)) in lfs.entries()) {
      let sg = switch sk { case (?k) sgIds.get(k); case null null };
      let prev = quoteForms.lineForms.get(lid);
      if (sg == null and show == null) { quoteForms.lineForms.remove(lid) } else {
        quoteForms.lineForms.add(lid, { lineId = lid; subgroupId = sg; showToClient = show; textBlockKey = switch prev { case (?x) x.textBlockKey; case null null } });
      };
    };
    quoteForms.versionTerms.add(v.id, #plain(terms));
    quotes.versions.add(v.id, { v with rev = v.rev + 1; updatedAt = now; updatedBy = p.id });
    quotes.quotes.add(q.id, { q with updatedAt = now; updatedBy = p.id });
    // Enkel aantallen, nooit een marge, tarief of bedrag.
    Access.audit(audit, caller, ?p.id, ?q.workId, "offertevorm-bewaard", q.number # " v" # v.version.toText() # ": " # activeSg.size().toText() # " subgroepen, " # keys.size().toText() # " tekstblokken, " # chm.size().toText() # " hoofdstukmarges" # (if (regie != null) ", regietarief" else "") # (if (i.discount != null) ", korting" else ""));
    #ok({ rev = v.rev + 1; refs });
  };
};
