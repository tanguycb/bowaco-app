// Offertes (stap 2.4, architectuur §2.9, bouwplan §8.5; VOORLOPIG tot 0.3): volgorde, rekenen (via QuoteCalc), views per
// rol en de hash bij het versturen. Geen rechten hier: wie wat mag, beslist lib/Rights.mo; mixins/QuotesApi.mo kiest de
// `scope`. De interne views (lijst, kop, hoofdstuk, lijn) dragen NOOIT een bedrag.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Sha256 "mo:sha2/Sha256";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Codes "Codes";
import Config "Config";
import Library "Library";
import QuoteCalc "QuoteCalc";
import QuoteForms "QuoteForms";

module {
  type QS = Types.QuotesState;

  public type Ctx = { settings : Types.SettingsState; access : Types.AccessState; org : Types.OrgState; works : Types.WorksState; qs : QS };

  // ── Indexen ──────────────────────────────────────────────────────────────
  public func addIndex(m : Map.Map<Nat, [Nat]>, key : Nat, id : Nat) {
    let prev = switch (m.get(key)) { case (?xs) xs; case null [] };
    if (prev.find(func i = i == id) == null) { m.add(key, prev.concat([id])) };
  };

  public func ids(m : Map.Map<Nat, [Nat]>, key : Nat) : [Nat] { switch (m.get(key)) { case (?xs) xs; case null [] } };

  // ── Volgorde ─────────────────────────────────────────────────────────────
  public func chaptersOf(qs : QS, versionId : Nat) : [Types.QuoteChapter] {
    ids(qs.chaptersByVersion, versionId).filterMap(func(id : Nat) : ?Types.QuoteChapter = qs.chapters.get(id)).filter(func c = c.archivedAt == null).sort(
      func(a, b) = switch (Nat.compare(a.order, b.order)) { case (#equal) Nat.compare(a.id, b.id); case o o }
    );
  };

  // Lijnen in de volgorde van het hoofdstuk, dan hun eigen volgorde.
  public func linesOf(qs : QS, versionId : Nat, chapters : [Types.QuoteChapter]) : [Types.QuoteLine] {
    let pos = Map.empty<Nat, Nat>();
    for ((i, c) in chapters.enumerate()) { pos.add(c.id, i) };
    let at = func(l : Types.QuoteLine) : Nat = switch (pos.get(l.chapterId)) { case (?i) i; case null 1_000_000 };
    ids(qs.linesByVersion, versionId).filterMap(func(id : Nat) : ?Types.QuoteLine = qs.lines.get(id)).filter(func l = l.archivedAt == null).sort(
      func(a, b) = switch (Nat.compare(at(a), at(b))) {
        case (#equal) { switch (Nat.compare(a.order, b.order)) { case (#equal) Nat.compare(a.id, b.id); case o o } };
        case o o;
      }
    );
  };

  public func versionsOf(qs : QS, quoteId : Nat) : [Types.QuoteVersion] {
    ids(qs.byQuote, quoteId).filterMap(func(id : Nat) : ?Types.QuoteVersion = qs.versions.get(id)).sort(func(a, b) = Nat.compare(b.version, a.version));
  };

  public func latest(qs : QS, quoteId : Nat) : ?Types.QuoteVersion {
    let vs = versionsOf(qs, quoteId);
    if (vs.size() == 0) null else ?vs[0];
  };

  // ── Vertrouwelijke kant ──────────────────────────────────────────────────
  public func standardMargin(qs : QS, versionId : Nat, fallback : Nat) : Nat {
    switch (qs.versionConf.get(versionId)) { case (?c) { Library.plainOf(c.standardMarginBp) ?? fallback }; case null fallback };
  };

  public type Price = { cost : ?Int; rule : ?Types.LibSellRule; reason : Text; orgId : ?Nat; source : Text; libCostId : ?Nat };

  public func priceOf(qs : QS, lineId : Nat) : Price {
    switch (qs.prices.get(lineId)) {
      case (?p) {
        {
          cost = switch (Library.plainOf(p.cost)) { case (?c) c; case null null };
          rule = switch (Library.plainOf(p.rule)) { case (?r) r; case null null };
          reason = Library.plainOf(p.reason) ?? "";
          orgId = p.orgId;
          source = p.source;
          libCostId = p.libCostId;
        };
      };
      case null { { cost = null; rule = null; reason = ""; orgId = null; source = ""; libCostId = null } };
    };
  };

  // De rekenlijn van versie 1 (geen klasse, geen regie).
  public func calcLine(l : Types.QuoteLine, p : Price) : QuoteCalc.Line {
    { chapter = l.chapterId; kind = l.kind; qtyMilli = l.qtyMilli; cost = p.cost; rule = p.rule; baseBp = null; regie = null };
  };

  // ── Rekenen ──────────────────────────────────────────────────────────────
  // `calc` = de rekenlijnen zoals deze versie ze rekent: calcVersion 1 zonder iets uit quoteForms (exact zoals vroeger),
  // calcVersion 2 met klassen, regietarief en korting (2c.1).
  public type Computed = { chapters : [Types.QuoteChapter]; lines : [Types.QuoteLine]; prices : [Price]; std : Nat; calc : [QuoteCalc.Line]; discount : ?QuoteCalc.Discount; totals : QuoteCalc.Totals };

  public func compute(qs : QS, qf : Types.QuoteFormState, v : Types.QuoteVersion, fallbackStd : Nat) : Computed {
    computeWith(qs, qf, v, fallbackStd, QuoteForms.resolver(qf, v));
  };

  // Rekenen met andere voorwaarden dan bewaard (saveQuoteForm rekent eerst na, pas dan wordt er geschreven).
  public func computeWith(qs : QS, qf : Types.QuoteFormState, v : Types.QuoteVersion, fallbackStd : Nat, r : QuoteForms.Resolver) : Computed {
    let chapters = chaptersOf(qs, v.id);
    let lines = linesOf(qs, v.id, chapters);
    let prices = lines.map(func l = priceOf(qs, l.id));
    let std = standardMargin(qs, v.id, fallbackStd);
    let v2 = v.calcVersion >= 2;
    let lib = Map.empty<Nat, Nat>();
    for (c in chapters.values()) { switch (c.libChapterId) { case (?x) lib.add(c.id, x); case null {} } };
    let calc = Array.tabulate<QuoteCalc.Line>(
      lines.size(),
      func i {
        let l = lines[i];
        let p = prices[i];
        if v2 QuoteForms.calcLine(qf, r, l.chapterId, ?l.chapterId, lib.get(l.chapterId), l.kind, l.form, l.qtyMilli, p.cost, p.rule, p.orgId) else calcLine(l, p);
      },
    );
    let discount = if v2 QuoteForms.discountOf(r) else null;
    { chapters; lines; prices; std; calc; discount; totals = QuoteCalc.totals(chapters.map(func c = c.id), calc, v.vatBp, std, discount) };
  };

  // De verkoopprijs per eenheid van één lijn zoals haar versie rekent (vorderingsstaten, 2.10).
  public func unitSellOf(qs : QS, qf : Types.QuoteFormState, v : Types.QuoteVersion, l : Types.QuoteLine, fallbackStd : Nat) : ?Int {
    let p = priceOf(qs, l.id);
    let std = standardMargin(qs, v.id, fallbackStd);
    if (v.calcVersion < 2) { return QuoteCalc.unitSell(p.cost, p.rule, std) };
    let lib = switch (qs.chapters.get(l.chapterId)) { case (?c) c.libChapterId; case null null };
    QuoteCalc.line(QuoteForms.calcLine(qf, QuoteForms.resolver(qf, v), l.chapterId, ?l.chapterId, lib, l.kind, l.form, 1000, p.cost, p.rule, p.orgId), std).unitSell;
  };

  public func totalsView(t : QuoteCalc.Totals, vatBp : Nat, calcVersion : Nat) : Views.QuoteTotalsView {
    {
      chapters = t.chapters.map(func(c : QuoteCalc.ChapterOut) : Views.QuoteChapterTotal = { chapterId = c.chapter; sellCents = c.sell; noPrice = c.noPrice });
      grossCents = t.gross;
      discountCents = t.discount;
      subtotalCents = t.subtotal;
      vatBp;
      vatCents = t.vat;
      totalCents = t.total;
      optionsPlusCents = t.optionsPlus;
      optionsMinusCents = t.optionsMinus;
      noPrice = t.noPrice;
      calcVersion;
    };
  };

  public func marginTotals(t : QuoteCalc.Totals, std : Nat, noReason : Nat) : Views.QuoteMarginTotals {
    {
      standardMarginBp = std;
      chapters = t.chapters.map(func(c : QuoteCalc.ChapterOut) : Views.QuoteChapterMargin = { chapterId = c.chapter; costCents = c.cost; sellWithCostCents = c.sellWithCost });
      costCents = t.cost;
      sellWithCostCents = t.sellWithCost;
      sellWithoutCostCents = t.sellWithoutCost;
      marginCents = t.margin;
      marginBp = t.marginBp;
      deviating = t.deviating;
      negative = t.negative;
      noReason;
    };
  };

  // Afwijkend (andere marge of vaste prijs) zonder reden: wat de controle vóór verzending (2.6) zal tegenhouden.
  public func noReason(c : Computed) : Nat {
    var n = 0;
    for ((i, l) in c.lines.enumerate()) {
      if (l.kind != #text) {
        let o = QuoteCalc.line(c.calc[i], c.std);
        if (o.deviates and c.prices[i].reason == "") { n += 1 };
      };
    };
    n;
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public func orgName(org : Types.OrgState, id : ?Nat) : Text {
    switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.name; case null "#" # x.toText() } }; case null "" };
  };

  func personName(access : Types.AccessState, id : ?Nat) : Text {
    switch id { case (?x) Access.personName(access, x); case null "" };
  };

  public func brief(qs : QS, v : Types.QuoteVersion) : Views.QuoteVersionBrief {
    {
      id = v.id;
      version = v.version;
      status = v.status;
      createdAt = v.createdAt;
      createdByName = "";
      updatedAt = v.updatedAt;
      sentAt = switch (v.sent) { case (?s) ?s.at; case null null };
      lines = ids(qs.linesByVersion, v.id).filter(func id = switch (qs.lines.get(id)) { case (?l) l.archivedAt == null; case null false }).size();
    };
  };

  public func summary(x : Ctx, q : Types.Quote) : Views.QuoteSummary {
    let vs = versionsOf(x.qs, q.id);
    let w = x.works.works.get(q.workId);
    {
      id = q.id;
      workId = q.workId;
      workCode = switch w { case (?w) w.code; case null "" };
      workName = switch w { case (?w) w.name; case null "" };
      number = q.number;
      title = q.title;
      clientName = if (vs.size() > 0) orgName(x.org, vs[0].clientOrgId) else "";
      archived = q.archivedAt != null;
      archiveReason = q.archiveReason;
      updatedAt = q.updatedAt;
      versions = vs.map(func v = { brief(x.qs, v) with createdByName = Access.personName(x.access, v.createdBy) });
    };
  };

  public func versionView(x : Ctx, v : Types.QuoteVersion) : Views.QuoteVersionView {
    let workVat = switch (x.qs.quotes.get(v.quoteId)) {
      case (?q) { switch (x.works.works.get(q.workId)) { case (?w) w.vatBp; case null v.vatBp } };
      case null v.vatBp;
    };
    {
      id = v.id;
      quoteId = v.quoteId;
      version = v.version;
      status = v.status;
      editable = v.status == #draft;
      title = v.title;
      vatBp = v.vatBp;
      workVatBp = workVat;
      clientOrgId = v.clientOrgId;
      clientName = orgName(x.org, v.clientOrgId);
      validDays = v.validDays;
      intro = v.intro;
      note = v.note;
      basedOnVersion = switch (v.basedOnId) { case (?b) { switch (x.qs.versions.get(b)) { case (?o) ?o.version; case null null } }; case null null };
      rev = v.rev;
      calcVersion = v.calcVersion;
      hash = switch (v.sent) { case (?s) s.hash; case null "" };
      sentAt = switch (v.sent) { case (?s) ?s.at; case null null };
      sentByName = switch (v.sent) { case (?s) Access.personName(x.access, s.by); case null "" };
      decidedAt = switch (v.decision) { case (?d) ?d.at; case null null };
      decidedByName = switch (v.decision) { case (?d) Access.personName(x.access, d.by); case null "" };
      decisionNote = switch (v.decision) { case (?d) d.note; case null "" };
      createdAt = v.createdAt;
      createdByName = Access.personName(x.access, v.createdBy);
      updatedAt = v.updatedAt;
      updatedByName = personName(x.access, ?v.updatedBy);
      intact = true;
    };
  };

  public func chapterView(c : Types.QuoteChapter) : Views.QuoteChapterView {
    { id = c.id; code = c.code; title = c.title; order = c.order; libChapterId = c.libChapterId };
  };

  public func lineView(s : Types.SettingsState, l : Types.QuoteLine) : Views.QuoteLineView {
    {
      id = l.id;
      chapterId = l.chapterId;
      order = l.order;
      kind = l.kind;
      code = l.code;
      title = l.title;
      text = l.text;
      specRef = l.specRef;
      qtyMilli = l.qtyMilli;
      unit = l.unit;
      unitName = if (l.unit == "") "" else Library.unitName(s, l.unit);
      form = l.form;
      libItemId = l.libItemId;
      libItemVersion = l.libItemVersion;
      copiedFrom = l.copiedFrom;
    };
  };

  public func sellLines(c : Computed) : [Views.QuoteSellLine] {
    Array.tabulate<Views.QuoteSellLine>(
      c.lines.size(),
      func i {
        let o = QuoteCalc.line(c.calc[i], c.std);
        { lineId = c.lines[i].id; unitSellCents = o.unitSell; lineSellCents = o.lineSell };
      },
    );
  };

  public func costLines(org : Types.OrgState, c : Computed) : [Views.QuoteCostLine] {
    Array.tabulate<Views.QuoteCostLine>(
      c.lines.size(),
      func i {
        let p = c.prices[i];
        let o = QuoteCalc.line(c.calc[i], c.std);
        {
          lineId = c.lines[i].id;
          costCents = p.cost;
          rule = p.rule;
          reason = p.reason;
          orgId = p.orgId;
          orgName = orgName(org, p.orgId);
          source = p.source;
          libCostId = p.libCostId;
          lineCostCents = o.lineCost;
          marginBp = o.marginBp;
          noPrice = o.noPrice;
          deviates = o.deviates;
          negative = o.negative;
        };
      },
    );
  };

  // ── Nummer ───────────────────────────────────────────────────────────────
  // Het jaar van een dagnummer (burgerlijke datum, algoritme van H. Hinnant zoals Plan.fmtDay).
  public func yearOf(d : Nat) : Nat {
    let z = d + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if (mp < 10) mp + 3 else mp - 9;
    yoe + era * 400 + (if (m <= 2) 1 else 0);
  };

  // "2026/231": het jaar en een volgnummer per jaar (settings.sequences "offerte:<jaar>"), minstens 3 cijfers (B12).
  public func formatNumber(year : Nat, n : Nat) : Text {
    var t = n.toText();
    while (t.size() < 3) { t := "0" # t };
    year.toText() # "/" # t;
  };

  // ── Hash bij het versturen (bouwplan §4: "hash van de inhoud vastgelegd") ──
  // De inhoud zoals de klant ze krijgt: nummer, versie, btw, klant, hoofdstukken, lijnen met hun verkoopprijs, totalen.
  // Elk veld met zijn lengte ervoor, zodat geen tekst een ander veld kan nabootsen. Geen aankoopprijs of marge.
  func f(t : Text) : Text { t.size().toText() # ":" # t # ";" };
  func fi(i : Int) : Text { f(Int.toText(i)) };
  func fo(i : ?Int) : Text { switch i { case (?x) fi(x); case null f("-") } };

  // Zonder `info` (versies verstuurd vóór 2.7) het oude schema "v1"; met `info` (2.7) "v2": dan dekt de hash ook de afzender, de
  // klant, de werf, de btw-grond, de betaaltermijn, de geldigheid en de tekst van de voorwaarden zoals de klant ze kreeg.
  // Een versie met calcVersion 2 (2c.1) krijgt schema "v3": daarbij ook bruto en korting, de offertesoort, wat de klant ziet
  // (subgroepen, welke lijnen, tekstblokken, regietekst) en de tekst van de korting. Een versie met calcVersion 1 houdt
  // exact haar oude tekst, dus haar hash.
  public func canonical(qf : Types.QuoteFormState, q : Types.Quote, v : Types.QuoteVersion, c : Computed, info : ?Types.QuoteSendInfo) : Text {
    let v3 = v.calcVersion >= 2;
    var out = (if v3 "bowaco-offerte-v3;" else switch info { case null "bowaco-offerte-v1;"; case (?_) "bowaco-offerte-v2;" }) # f(q.number) # fi(v.version) # fi(v.vatBp) # fo(switch (v.clientOrgId) { case (?o) ?o; case null null }) # fi(v.calcVersion) # f(v.title) # fi(v.validDays) # f(v.intro);
    for (ch in c.chapters.values()) { out #= "H;" # fi(ch.id) # f(ch.code) # f(ch.title) };
    for ((i, l) in c.lines.enumerate()) {
      let o = QuoteCalc.line(c.calc[i], c.std);
      out #= "L;" # fi(l.chapterId) # f(kindText(l.kind)) # f(l.code) # f(l.title) # f(l.text) # f(l.specRef) # fi(l.qtyMilli) # f(l.unit) # f(Library.formKey(l.form)) # fo(o.unitSell) # fi(o.lineSell);
    };
    let t = c.totals;
    if v3 { out #= "T;" # fi(t.gross) # fi(t.discount) # fi(t.subtotal) # fi(t.vat) # fi(t.total) # fi(t.optionsPlus) # fi(t.optionsMinus) # canonicalForm(qf, q, v, c) } else {
      out #= "T;" # fi(t.subtotal) # fi(t.vat) # fi(t.total) # fi(t.optionsPlus) # fi(t.optionsMinus);
    };
    switch info { case (?i) { out # canonicalInfo(i) }; case null out };
  };

  // De soort van de offerte zoals ze bij het versturen vastlag (QuoteSentExtra.extra), anders de huidige.
  public func sentKind(qf : Types.QuoteFormState, q : Types.Quote, v : Types.QuoteVersion) : (Types.QuoteKind, ?Nat, Text) {
    switch (qf.sentExtra.get(v.id)) {
      case (?s) {
        let get = func(k : Text) : Text = switch (s.extra.find(func(x : (Text, Text)) : Bool = x.0 == k)) { case (?(_, t)) t; case null "" };
        let kind : Types.QuoteKind = switch (get("soort")) { case "schadedossier" #damage; case "meerwerk" #extraWork; case "regie" #regie; case _ #standard };
        (kind, Nat.fromText(get("verzekeraar")), get("dossier"));
      };
      case null { let i = QuoteForms.infoOf(qf, q.id); (i.kind, i.insurerOrgId, i.claimRef) };
    };
  };

  func canonicalForm(qf : Types.QuoteFormState, q : Types.Quote, v : Types.QuoteVersion, c : Computed) : Text {
    let (kind, insurer, claim) = sentKind(qf, q, v);
    let vf = QuoteForms.versionForm(qf, v.id);
    let regie = switch (QuoteForms.termsOf(qf, v.id)) { case (?t) { switch (t.regie) { case (?g) ?g.sellCents; case null null } }; case null null };
    var out = "F;" # f(QuoteForms.kindText(kind)) # fo(switch insurer { case (?x) ?x; case null null }) # f(claim) # f(if (vf.hideZeroLines) "verberg-0" else "toon-0") # f(if (vf.regieText) "regietekst" else "-") # (if (vf.regieText) fo(regie) else f("-"));
    for (g in QuoteForms.subgroupsOf(qf, v.id).values()) { out #= "G;" # fi(g.id) # fi(g.chapterId) # f(g.title) # fi(g.order) };
    for (l in c.lines.values()) {
      let lf = qf.lineForms.get(l.id);
      out #= "S;" # fi(l.id) # fo(switch lf { case (?x) { switch (x.subgroupId) { case (?s) ?s; case null null } }; case null null }) # f(if (QuoteForms.shown(vf, lf, l)) "ja" else "nee");
    };
    for (b in QuoteForms.blocksOf(qf, v).values()) { out #= "B;" # f(b.key) # f(b.title) # f(b.text) # f(QuoteForms.placeText(b.place)) };
    out # "K;" # f(switch (QuoteForms.termsOf(qf, v.id)) { case (?t) t.discountText; case null "" });
  };

  func fa(a : ?Types.Address) : Text {
    switch a { case (?x) f(x.street) # f(x.number) # f(x.zip) # f(x.city) # f(x.country); case null f("-") };
  };
  func fs(t : ?Text) : Text { switch t { case (?x) f(x); case null f("-") } };

  // De vastgelegde velden van het versturen (2.7), elk met zijn lengte ervoor.
  func canonicalInfo(i : Types.QuoteSendInfo) : Text {
    "I;" # f(i.issuer) # f(i.clientName) # fa(i.clientAddress) # fs(i.clientVat) # f(i.workCode) # f(i.workName) # fa(?i.workAddress) # f(i.vatNote)
    # fi(i.paymentDays) # fi(i.validUntil) # fi(i.termsVersion) # f(i.termsTitle) # f(i.termsText) # f(if (i.termsProvisional) "voorlopig" else "vast");
  };

  public func hash(text : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, text.encodeUtf8())) };

  public func kindText(k : Types.QuoteLineKind) : Text { switch k { case (#item) "post"; case (#text) "tekst"; case (#option) "optie" } };

  public func statusText(s : Types.QuoteStatus) : Text {
    switch s { case (#draft) "ontwerp"; case (#sent) "verstuurd"; case (#accepted) "aanvaard"; case (#rejected) "geweigerd"; case (#superseded) "vervangen"; case (#withdrawn) "ingetrokken" };
  };

  public func sourceOk(s : Text) : Bool { s == "" or Config.quoteCostSources().any(func((k, _) : (Text, Text)) : Bool = k == s) };
};
