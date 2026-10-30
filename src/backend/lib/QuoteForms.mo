// De offerte zoals Alexis ze maakt (stap 2c.1, ontwerp 2c §4.1): de zijtabellen van het domein `quoteForms` lezen en
// oplossen. Geen rechten hier (lib/Rights.mo beslist, de mixins kiezen wat ze tonen) en geen import van lib/Quotes.mo
// (die gebruikt deze module om te rekenen).
// MARGE van een post zonder eigen regel (volgorde, ontwerp §4.1): klasse van de leverancier (de firma van de aankoopprijs)
// > klasse van het hoofdstuk > standaardmarge van de versie. Een eigen regel van de post (marge of vaste prijs) gaat altijd
// voor; dat beslist QuoteCalc. Wat een versie vastlegt (QuoteVersionTerms) gaat voor op een koppeling; een koppeling vult
// enkel aan in een ONTWERP (`live`). Bij het versturen legt `freeze` alles vast, zodat een latere wijziging van een klasse
// een verzonden versie nooit verandert (G4).
// REGIE: een post met contractvorm regie zonder eigen regel neemt het regietarief van de versie (uurloon van de OA, prijs
// voor de klant = uurloon / (1 − regiemarge), standaard / 0,8).
// Een versie met calcVersion 1 gebruikt niets uit deze module: ze rekent en toont zoals vroeger.
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import FormViews "../types/formviews";
import Config "Config";
import Ids "Ids";
import QuoteCalc "QuoteCalc";

module {
  type QF = Types.QuoteFormState;
  type Pick = Types.QuoteMarginPick;

  func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  public func chapterKey(libChapterId : Nat) : Text { "ch:" # libChapterId.toText() };
  public func orgKey(orgId : Nat) : Text { "org:" # orgId.toText() };

  // ── Klassen en koppelingen ───────────────────────────────────────────────
  public func classOf(qf : QF, id : Nat) : ?Types.MarginClass {
    switch (qf.classes.get(id)) { case (?c) plain(c); case null null };
  };

  // De klasse achter een koppeling, als ze nog actief is.
  public func linkPick(qf : QF, key : Text) : ?Pick {
    let l = switch (qf.classLinks.get(key)) { case (?x) { switch (plain(x)) { case (?y) y; case null return null } }; case null return null };
    switch (classOf(qf, l.classId)) { case (?c) { if (c.archivedAt == null) ?{ classId = ?c.id; marginBp = c.marginBp } else null }; case null null };
  };

  // ── Wat een versie vastlegt ──────────────────────────────────────────────
  public func termsOf(qf : QF, versionId : Nat) : ?Types.QuoteVersionTerms {
    switch (qf.versionTerms.get(versionId)) { case (?t) plain(t); case null null };
  };

  public func emptyTerms(versionId : Nat) : Types.QuoteVersionTerms {
    { versionId; chapterMargins = []; orgMargins = []; regie = null; discount = null; discountText = ""; extra = [] };
  };

  // `live` = een ontwerp: een koppeling vult aan wat de versie (nog) niet vastlegde.
  public type Resolver = { terms : ?Types.QuoteVersionTerms; live : Bool };

  public func resolver(qf : QF, v : Types.QuoteVersion) : Resolver {
    { terms = termsOf(qf, v.id); live = v.status == #draft };
  };

  func findPick(xs : [(Nat, Pick)], id : Nat) : ?Pick {
    switch (xs.find(func((k, _) : (Nat, Pick)) : Bool = k == id)) { case (?(_, p)) ?p; case null null };
  };

  // De marge van een hoofdstuk van de versie (chapterId null = een nieuw hoofdstuk, nog zonder id).
  public func chapterPick(qf : QF, r : Resolver, chapterId : ?Nat, libChapterId : ?Nat) : ?Pick {
    switch (r.terms, chapterId) {
      case (?t, ?c) { switch (findPick(t.chapterMargins, c)) { case (?p) return ?p; case null {} } };
      case _ {};
    };
    switch (r.live, libChapterId) { case (true, ?lc) linkPick(qf, chapterKey(lc)); case _ null };
  };

  public func orgPick(qf : QF, r : Resolver, orgId : ?Nat) : ?Pick {
    let o = switch orgId { case (?x) x; case null return null };
    switch (r.terms) { case (?t) { switch (findPick(t.orgMargins, o)) { case (?p) return ?p; case null {} } }; case null {} };
    if (r.live) linkPick(qf, orgKey(o)) else null;
  };

  // De basismarge van een post zonder eigen regel en waar ze vandaan komt.
  public func lineBase(qf : QF, r : Resolver, chapterId : ?Nat, libChapterId : ?Nat, orgId : ?Nat) : (?Nat, Text) {
    switch (orgPick(qf, r, orgId)) { case (?p) return (?p.marginBp, "leverancier"); case null {} };
    switch (chapterPick(qf, r, chapterId, libChapterId)) { case (?p) (?p.marginBp, "hoofdstuk"); case null (null, "standaard") };
  };

  public func regieOf(r : Resolver) : ?QuoteCalc.Regie {
    switch (r.terms) { case (?t) { switch (t.regie) { case (?g) ?{ cost = g.costCents; sell = g.sellCents }; case null null } }; case null null };
  };

  public func discountOf(r : Resolver) : ?QuoteCalc.Discount {
    switch (r.terms) { case (?t) t.discount; case null null };
  };

  // Een regiepost: contractvorm regie (een tekstregel nooit).
  public func isRegie(kind : Types.QuoteLineKind, form : Types.ContractForm) : Bool { kind != #text and form == #regie };

  // De rekenlijn van versie 2.
  public func calcLine(qf : QF, r : Resolver, chapterPos : Nat, chapterId : ?Nat, libChapterId : ?Nat, kind : Types.QuoteLineKind, form : Types.ContractForm, qtyMilli : Int, cost : ?Int, rule : ?Types.LibSellRule, orgId : ?Nat) : QuoteCalc.Line {
    let (base, _) = lineBase(qf, r, chapterId, libChapterId, orgId);
    let regie = if (isRegie(kind, form) and rule == null) regieOf(r) else null;
    { chapter = chapterPos; kind; qtyMilli; cost; rule; baseBp = base; regie };
  };

  // Het regietarief voor de klant: uurloon / (1 − regiemarge), op de cent (€ 45 → € 56,25 bij 20 %).
  public func regieSell(costCents : Int) : Int {
    switch (QuoteCalc.unitSell(?costCents, null, Config.quoteRegieMarginBp)) { case (?x) x; case null costCents };
  };

  // Bij het versturen: elke marge die de versie gebruikt, ligt voortaan in de versie zelf vast.
  public func freeze(qf : QF, v : Types.QuoteVersion, chapters : [(Nat, ?Nat)], orgIds : [Nat]) {
    let r = { terms = termsOf(qf, v.id); live = true };
    let t = switch (r.terms) { case (?x) x; case null emptyTerms(v.id) };
    var chs : [(Nat, Pick)] = [];
    for ((c, lc) in chapters.values()) { switch (chapterPick(qf, r, ?c, lc)) { case (?p) chs := chs.concat([(c, p)]); case null {} } };
    var ors : [(Nat, Pick)] = [];
    for (o in orgIds.values()) {
      if (ors.find(func((k, _) : (Nat, Pick)) : Bool = k == o) == null) {
        switch (orgPick(qf, r, ?o)) { case (?p) ors := ors.concat([(o, p)]); case null {} };
      };
    };
    qf.versionTerms.add(v.id, #plain({ t with chapterMargins = chs; orgMargins = ors }));
  };

  // ── Wat de klant ziet ────────────────────────────────────────────────────
  public func defaultBlockKeys(qf : QF) : [Text] {
    blocksSorted(qf).filter(func b = b.defaultOn and b.archivedAt == null).map(func b = b.key);
  };

  public func blocksSorted(qf : QF) : [Types.TextBlock] {
    qf.textBlocks.values().toArray().sort(func(a, b) = switch (Nat.compare(a.order, b.order)) { case (#equal) Text.compare(a.key, b.key); case o o });
  };

  public func defaultForm(qf : QF, versionId : Nat) : Types.QuoteVersionForm {
    { versionId; hideZeroLines = true; regieText = false; textBlockKeys = defaultBlockKeys(qf); extra = [] };
  };

  public func versionForm(qf : QF, versionId : Nat) : Types.QuoteVersionForm {
    switch (qf.versionForms.get(versionId)) { case (?f) f; case null defaultForm(qf, versionId) };
  };

  // Ziet de klant deze lijn? Een tekstregel altijd; een post of optie met hoeveelheid 0 niet als de versie ze verbergt,
  // tenzij "toon toch" (of omgekeerd: een lijn kan ook met de hand verborgen worden).
  // Enkel een lijn met hoeveelheid 0 kan verborgen zijn: een lijn met een bedrag ziet de klant altijd (anders klopt het
  // hoofdstuktotaal niet met wat hij leest).
  public func shown(vf : Types.QuoteVersionForm, lf : ?Types.QuoteLineForm, l : Types.QuoteLine) : Bool {
    if (l.kind == #text or l.qtyMilli != 0) { return true };
    switch lf { case (?x) { switch (x.showToClient) { case (?b) return b; case null {} } }; case null {} };
    not vf.hideZeroLines;
  };

  public func infoOf(qf : QF, quoteId : Nat) : Types.QuoteFormInfo {
    switch (qf.info.get(quoteId)) {
      case (?i) i;
      case null { { quoteId; kind = #standard; baseQuoteId = null; insurerOrgId = null; claimRef = ""; updatedAt = 0; updatedBy = 0; extra = [] } };
    };
  };

  public func subgroupsOf(qf : QF, versionId : Nat) : [Types.QuoteSubgroup] {
    let ids = switch (qf.subgroupsByVersion.get(versionId)) { case (?xs) xs; case null [] };
    ids.filterMap(func(id : Nat) : ?Types.QuoteSubgroup = qf.subgroups.get(id)).filter(func s = s.archivedAt == null).sort(
      func(a, b) = switch (Nat.compare(a.order, b.order)) { case (#equal) Nat.compare(a.id, b.id); case o o }
    );
  };

  public func addIndex(m : Map.Map<Nat, [Nat]>, key : Nat, id : Nat) {
    let prev = switch (m.get(key)) { case (?xs) xs; case null [] };
    if (prev.find(func i = i == id) == null) { m.add(key, prev.concat([id])) };
  };

  // De tekstblokken van een versie: verzonden = zoals de klant ze kreeg; ontwerp = de huidige tekst uit de bibliotheek.
  public func blocksOf(qf : QF, v : Types.QuoteVersion) : [Types.QuoteSentBlock] {
    switch (qf.sentExtra.get(v.id)) { case (?s) return s.blocks; case null {} };
    if (v.status != #draft) { return [] };
    let keys = versionForm(qf, v.id).textBlockKeys;
    blocksSorted(qf).filter(func b = b.archivedAt == null and keys.find(func k = k == b.key) != null).map(func(b : Types.TextBlock) : Types.QuoteSentBlock = { key = b.key; title = b.title; text = b.text; place = b.place });
  };

  // ── Een nieuwe versie: alles mee (subgroepen, lijnvorm, wat de klant ziet, marges, regie, korting) ──
  public func copyVersion(qf : QF, ctr : Types.Counters, fromId : Nat, toId : Nat, chMap : Map.Map<Nat, Nat>, lineMap : Map.Map<Nat, Nat>) {
    switch (qf.versionForms.get(fromId)) { case (?f) qf.versionForms.add(toId, { f with versionId = toId }); case null qf.versionForms.add(toId, defaultForm(qf, toId)) };
    let sgMap = Map.empty<Nat, Nat>();
    for (s in subgroupsOf(qf, fromId).values()) {
      switch (chMap.get(s.chapterId)) {
        case (?ch) {
          let id = Ids.next(ctr, "quoteSubgroup");
          qf.subgroups.add(id, { s with id; versionId = toId; chapterId = ch; copiedFrom = ?s.id });
          addIndex(qf.subgroupsByVersion, toId, id);
          sgMap.add(s.id, id);
        };
        case null {};
      };
    };
    for ((old, nw) in lineMap.entries()) {
      switch (qf.lineForms.get(old)) {
        case (?lf) {
          let sg = switch (lf.subgroupId) { case (?s) sgMap.get(s); case null null };
          qf.lineForms.add(nw, { lf with lineId = nw; subgroupId = sg });
        };
        case null {};
      };
    };
    switch (termsOf(qf, fromId)) {
      case (?t) {
        let chs = t.chapterMargins.filterMap(func((c, p) : (Nat, Pick)) : ?(Nat, Pick) = switch (chMap.get(c)) { case (?n) ?(n, p); case null null });
        qf.versionTerms.add(toId, #plain({ t with versionId = toId; chapterMargins = chs }));
      };
      case null {};
    };
  };

  // ── Views ────────────────────────────────────────────────────────────────
  func orgName(org : Types.OrgState, id : ?Nat) : Text {
    switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.name; case null "#" # x.toText() } }; case null "" };
  };

  public func blockView(b : Types.QuoteSentBlock) : FormViews.QuoteBlockView { { key = b.key; title = b.title; text = b.text; place = b.place } };

  public func subgroupView(s : Types.QuoteSubgroup) : FormViews.QuoteSubgroupView { { id = s.id; chapterId = s.chapterId; title = s.title; order = s.order } };

  // Intern, zonder bedragen (elke rol die de offerte mag lezen).
  // `kind` = (soort, verzekeraar, dossiernummer) zoals de versie ze heeft (Quotes.sentKind: bij het versturen vastgelegd).
  public func formView(qf : QF, org : Types.OrgState, kind : (Types.QuoteKind, ?Nat, Text), v : Types.QuoteVersion, lines : [Types.QuoteLine]) : FormViews.QuoteFormView {
    let vf = versionForm(qf, v.id);
    {
      kind = kind.0;
      insurerOrgId = kind.1;
      insurerName = orgName(org, kind.1);
      claimRef = kind.2;
      hideZeroLines = vf.hideZeroLines;
      regieText = vf.regieText;
      textBlockKeys = vf.textBlockKeys;
      blocks = blocksOf(qf, v).map(blockView);
      subgroups = subgroupsOf(qf, v.id).map(subgroupView);
      lineForms = lines.map(
        func(l : Types.QuoteLine) : FormViews.QuoteLineFormView {
          let lf = qf.lineForms.get(l.id);
          {
            lineId = l.id;
            subgroupId = switch lf { case (?x) x.subgroupId; case null null };
            showToClient = switch lf { case (?x) x.showToClient; case null null };
            shown = shown(vf, lf, l);
          };
        }
      );
    };
  };

  public func classView(c : Types.MarginClass) : FormViews.MarginClassView {
    { id = c.id; name = c.name; marginBp = c.marginBp; note = c.note; archived = c.archivedAt != null; updatedAt = c.updatedAt };
  };

  func className(qf : QF, id : ?Nat) : Text {
    switch id { case (?x) { switch (classOf(qf, x)) { case (?c) c.name; case null "" } }; case null "" };
  };

  public func classesView(qf : QF) : FormViews.MarginClassesView {
    let classes = qf.classes.values().filterMap(func(c : Types.Confidential<Types.MarginClass>) : ?Types.MarginClass = plain(c)).toArray().sort(func(a, b) = Text.compare(a.name, b.name)).map(classView);
    let links = qf.classLinks.values().filterMap(
      func(x : Types.Confidential<Types.MarginClassLink>) : ?FormViews.MarginLinkView {
        switch (plain(x)) {
          case (?l) { switch (classOf(qf, l.classId)) { case (?c) ?{ key = l.key; classId = c.id; className = c.name; marginBp = c.marginBp }; case null null } };
          case null null;
        };
      }
    ).toArray();
    { classes; links };
  };

  // Vertrouwelijk: de marges zoals de versie ze gebruikt (vastgelegd of via een koppeling), per lijn de basis, regie, korting.
  public type TermLine = { id : Nat; chapterId : Nat; libChapterId : ?Nat; kind : Types.QuoteLineKind; form : Types.ContractForm; rule : ?Types.LibSellRule; orgId : ?Nat };

  public func termsView(qf : QF, org : Types.OrgState, v : Types.QuoteVersion, chapters : [(Nat, ?Nat)], lines : [TermLine], std : Nat) : FormViews.QuoteMarginTermsView {
    let r = resolver(qf, v);
    let fixedCh = switch (r.terms) { case (?t) t.chapterMargins; case null [] };
    let fixedOrg = switch (r.terms) { case (?t) t.orgMargins; case null [] };
    let chapterMargins = chapters.filterMap(
      func((c, lc) : (Nat, ?Nat)) : ?FormViews.QuoteMarginView {
        switch (chapterPick(qf, r, ?c, lc)) { case (?p) ?{ id = c; classId = p.classId; className = className(qf, p.classId); marginBp = p.marginBp; fixed = findPick(fixedCh, c) != null }; case null null };
      }
    );
    var orgs : [Nat] = [];
    for (l in lines.values()) { switch (l.orgId) { case (?o) { if (orgs.find(func x = x == o) == null) { orgs := orgs.concat([o]) } }; case null {} } };
    let orgMargins = orgs.filterMap(
      func(o : Nat) : ?FormViews.QuoteMarginView {
        switch (orgPick(qf, r, ?o)) { case (?p) ?{ id = o; classId = p.classId; className = className(qf, p.classId); marginBp = p.marginBp; fixed = findPick(fixedOrg, o) != null }; case null null };
      }
    );
    let regie = regieOf(r);
    let lineBases = lines.filter(func l = l.kind != #text).map(
      func(l : TermLine) : FormViews.QuoteLineBaseView {
        switch (l.rule) {
          case (?#margin m) { { lineId = l.id; marginBp = m; source = "eigen" } };
          case (?#price _) { { lineId = l.id; marginBp = 0; source = "eigen" } };
          case null {
            if (isRegie(l.kind, l.form) and regie != null) { return { lineId = l.id; marginBp = Config.quoteRegieMarginBp; source = "regie" } };
            let (b, src) = lineBase(qf, r, ?l.chapterId, l.libChapterId, l.orgId);
            { lineId = l.id; marginBp = switch b { case (?x) x; case null std }; source = src };
          };
        };
      }
    );
    let cv = classesView(qf);
    {
      chapterMargins;
      orgMargins;
      lineBases;
      regie = switch (r.terms) { case (?t) { switch (t.regie) { case (?g) ?{ orgId = g.orgId; orgName = orgName(org, g.orgId); costCents = g.costCents; sellCents = g.sellCents }; case null null } }; case null null };
      regieMarginBp = Config.quoteRegieMarginBp;
      discount = switch (r.terms) { case (?t) t.discount; case null null };
      discountText = switch (r.terms) { case (?t) t.discountText; case null "" };
      classes = cv.classes.filter(func c = not c.archived);
      links = cv.links;
    };
  };

  public func textBlockView(b : Types.TextBlock) : FormViews.TextBlockView {
    { key = b.key; title = b.title; text = b.text; defaultOn = b.defaultOn; place = b.place; order = b.order; version = b.version; archived = b.archivedAt != null; updatedAt = b.updatedAt };
  };

  public func placeText(p : Types.TextBlockPlace) : Text {
    switch p { case (#top) "boven"; case (#end) "onder"; case (#chapter c) "hoofdstuk:" # c };
  };

  public func kindText(k : Types.QuoteKind) : Text {
    switch k { case (#standard) "gewoon"; case (#damage) "schadedossier"; case (#extraWork) "meerwerk"; case (#regie) "regie" };
  };

  // Bij een herstel: de index van de subgroepen opnieuw opbouwen.
  public func rebuildIndex(qf : QF) {
    for (k in qf.subgroupsByVersion.keys().toArray().values()) { qf.subgroupsByVersion.remove(k) };
    for (s in qf.subgroups.values()) { addIndex(qf.subgroupsByVersion, s.versionId, s.id) };
  };
};
