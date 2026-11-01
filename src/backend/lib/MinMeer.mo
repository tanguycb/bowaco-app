// Min-meerstaat (stap 2c.5, ontwerp 2c §4.5; ⚖3, AC-5, AC-18, AC-19): de regels zonder toestand-wijzigingen, zodat de API
// (mixins/MinMeerApi.mo) en de testen dezelfde regels gebruiken. Geen rechten hier (lib/Rights.mo).
// Per werf één LEVEND overzicht, telkens opnieuw gebouwd uit:
//   • de getekende offerte (Progress.baseVersion): de posten met hun bedrag (kolom offerte) en de korting op het totaal van die
//     offerte (2c.1) als regel in de kolom offerte, zodat het totaal van de kolom = de aanneemsom (QuoteSent.subtotalCents);
//   • een latere aanvaarde versie van de getekende offerte: het verschil per post (versie);
//   • de posten van een andere aanvaarde offerte (een MEERWERKOFFERTE, ⚖3) als meerwerk (minwerk bij een negatieve post), en hun korting;
//   • de opmeting (VH-posten): gemeten − VH × eenheidsprijs (de stand van de laatste afgesloten opmeting);
//   • de regie-uren van het werfverslag aan het regietarief van de werf op die dag (MmRegieRate; anders de regiepost, anders het
//     regietarief van de offerte, anders het tarief van de afspraak van die OA op die dag ÷ (1 − regiemarge), 2c.4); uren aan een
//     regiepost van de offerte tellen pas als kantoor die raming afrekent (#settle); betwiste uren tellen niet;
//   • de kosten van OA's en leveranciers die kantoor doorrekent: kostprijs / (1 − marge), standaard / 0,8 (costItems hieronder =
//     DE plaats waar 2c.7 de aankoopfacturen aansluit);
//   • de regels van kantoor en de voorstellen van de werfleider (MmEntry), met hun akkoord;
//   • reeds gefactureerd: de verzonden vorderingsstaten (2.10) en wat kantoor met de hand opgaf (invoicedOf: hier sluit 2c.6 aan).
// Rekenen: lib/MinMeerCalc.mo (= minmeer/calc.ts).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import MV "../types/minmeerviews";
import Access "Access";
import Codes "Codes";
import Config "Config";
import Library "Library";
import Measure "Measure";
import MinMeerCalc "MinMeerCalc";
import OaDeals "OaDeals";
import OaInvoice "OaInvoice";
import Plan "Plan";
import Progress "Progress";
import Purchase "Purchase";
import QuoteCalc "QuoteCalc";
import QuoteForms "QuoteForms";
import Quotes "Quotes";
import WorkStart "WorkStart";
import Sha256 "mo:sha2/Sha256";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    works : Types.WorksState;
    dossier : Types.DossierState;
    plan : Types.PlanState;
    reports : Types.ReportState;
    qs : Types.QuotesState;
    qf : Types.QuoteFormState;
    qd : Types.QuoteDocsState;
    starts : Types.WorkStartState;
    ss : Types.SurveyState;
    ps : Types.ProgressState;
    oi : Types.OaInvoiceState;
    deals : Types.OaDealState;
    pu : Types.PurchaseState; // 2c.7: de aankoopfacturen (doorrekenbare kosten per werf)
    mm : Types.MinMeerState;
  };

  public func progressCtx(c : Ctx) : Progress.Ctx {
    { settings = c.settings; access = c.access; org = c.org; works = c.works; dossier = c.dossier; plan = c.plan; reports = c.reports; qs = c.qs; qf = c.qf; starts = c.starts; ss = c.ss; ps = c.ps };
  };

  // ── Instellingen (settings.values, D8: geen migratie) ─────────────────────
  // Meerwerk vanaf dit bedrag (excl. btw) vraagt een meerwerkofferte met akkoord vooraf (⚖3, AC-18; standaard € 1.000).
  public func quoteFromCents(s : Types.SettingsState) : Nat { natSetting(s, "minMeer.quoteFromCents", Config.mmQuoteFromCentsDefault, 100_000_000) };
  // Doorrekenen van kosten: marge op de verkoopprijs (standaard 20 %: kostprijs / 0,8); per kostensoort een andere (AC-19).
  public func passOnBp(s : Types.SettingsState, kind : Text) : Nat {
    let std = natSetting(s, "minMeer.passOnBp", Config.mmPassOnBpDefault, 9_000);
    if (kind == "") std else natSetting(s, "minMeer.passOnBp." # kind, std, 9_000);
  };
  // Klantakkoord op een gedeelde versie: "uit" of "mogelijk" (standaard; AC-5: niet verplicht).
  public func clientMode(s : Types.SettingsState) : Text { if (s.values.get("minMeer.client") == ?"uit") "uit" else "mogelijk" };

  func natSetting(s : Types.SettingsState, key : Text, dflt : Nat, max : Nat) : Nat {
    switch (s.values.get(key)) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n <= max) n else dflt }; case null dflt } }; case null dflt };
  };

  // ── Hulp ─────────────────────────────────────────────────────────────────
  public func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };
  public func addIdx(m : Map.Map<Nat, [Nat]>, k : Nat, id : Nat) { Quotes.addIndex(m, k, id) };
  public func ids(m : Map.Map<Nat, [Nat]>, k : Nat) : [Nat] { switch (m.get(k)) { case (?x) x; case null [] } };
  public func hash(text : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, text.encodeUtf8())) };
  public func day(d : Nat) : Text { Plan.fmtDay(d) };
  public func euro(c : Int) : Text { Progress.euro(c) };
  public func seqKey(workId : Nat) : Text { "minmeer:" # workId.toText() };
  public func extraSeqKey(baseQuoteId : Nat) : Text { "meerwerk:" # baseQuoteId.toText() };

  public func entriesOf(mm : Types.MinMeerState, workId : Nat) : [Types.MmEntry] {
    ids(mm.byWork, workId).filterMap<Nat, Types.MmEntry>(func id = mm.entries.get(id));
  };
  public func priceOf(mm : Types.MinMeerState, entryId : Nat) : ?Types.MmEntryPrice {
    switch (mm.prices.get(entryId)) { case (?c) plain(c); case null null };
  };
  public func versionsOf(mm : Types.MinMeerState, workId : Nat) : [Types.MmVersion] {
    let vs = ids(mm.versionsByWork, workId).filterMap<Nat, Types.MmVersion>(func id = mm.versions.get(id));
    vs.sort(func(a, b) = Nat.compare(a.number, b.number));
  };
  public func frozenOf(mm : Types.MinMeerState, versionId : Nat) : ?Types.MmFrozen {
    switch (mm.frozen.get(versionId)) { case (?c) plain(c); case null null };
  };
  public func ratesOf(mm : Types.MinMeerState, workId : Nat) : [Types.MmRegieRate] {
    let xs = switch (mm.regieRates.get(workId)) { case (?c) { switch (plain(c)) { case (?x) x; case null [] } }; case null [] };
    xs.sort(func(a, b) = Nat.compare(a.fromDay, b.fromDay));
  };

  public func kindKey(k : Types.MmKind) : Text {
    switch k { case (#less) "minwerk"; case (#extra) "meerwerk"; case (#regie) "regie"; case (#cost) "kost"; case (#discount) "korting"; case (#settle) "afrekening"; case (#invoiced) "gefactureerd" };
  };

  public func approvalText(c : Ctx, a : Types.MmApproval) : Text {
    switch a {
      case (#notNeeded) "niet nodig";
      case (#pending) "wacht";
      case (#recorded r) r.how # " op " # day(r.day);
      case (#quote vid) {
        switch (c.qs.versions.get(vid)) {
          case (?v) {
            let nr = switch (c.qs.quotes.get(v.quoteId)) { case (?q) q.number; case null "?" };
            switch (acceptedVersionOf(c, vid)) {
              case (?a) "meerwerkofferte " # nr # " v" # a.version.toText() # " aanvaard op " # day(Progress.dayOf(WorkStart.acceptedAt(c.qd, a)));
              case null {
                // De nieuwste versie zegt hoe ver ze staat (een v2 in ontwerp na een verstuurde v1).
                let vs = Quotes.versionsOf(c.qs, v.quoteId);
                let last = if (vs.size() > 0) vs[0] else v;
                "meerwerkofferte " # nr # " v" # last.version.toText() # " " # Quotes.statusText(last.status);
              };
            };
          };
          case null "meerwerkofferte";
        };
      };
    };
  };

  // ── Het regietarief van de werf op een dag ───────────────────────────────
  // Volgorde: het tarief van de werf (kantoor, met datum) > de regiepost van de offerte waaraan de uren hangen > het regietarief van
  // de getekende offerte (2c.1) > het regietarief van de afspraak van die OA op die dag ÷ (1 − regiemarge) (2c.4) > geen.
  public type Rate = { sellCents : ?Int; source : Text; costCents : ?Int };

  public func werfRateAt(mm : Types.MinMeerState, workId : Nat, d : Nat) : ?Types.MmRegieRate {
    var out : ?Types.MmRegieRate = null;
    for (r in ratesOf(mm, workId).values()) { if (r.fromDay <= d) { out := ?r } };
    out;
  };

  public func offerRegie(c : Ctx, base : ?Types.QuoteVersion) : ?Int {
    switch base { case (?v) { switch (QuoteForms.termsOf(c.qf, v.id)) { case (?t) { switch (t.regie) { case (?g) ?g.sellCents; case null null } }; case null null } }; case null null };
  };

  public func rateFor(c : Ctx, workId : Nat, base : ?Types.QuoteVersion, postUnit : ?Int, orgId : ?Nat, d : Nat) : Rate {
    let cost : ?Int = switch orgId { case (?o) { switch (OaDeals.dealRegieAt(c.deals, workId, o, d)) { case (?(x, _)) ?x; case null null } }; case null null };
    switch (werfRateAt(c.mm, workId, d)) { case (?r) { return { sellCents = ?r.sellCents; source = "regietarief vanaf " # day(r.fromDay); costCents = cost } }; case null {} };
    switch postUnit { case (?u) { return { sellCents = ?u; source = "regietarief van de post"; costCents = cost } }; case null {} };
    switch (offerRegie(c, base)) { case (?s) { return { sellCents = ?s; source = "regietarief van de offerte"; costCents = cost } }; case null {} };
    switch cost { case (?x) { return { sellCents = ?QuoteForms.regieSell(x); source = "regietarief"; costCents = cost } }; case null {} };
    { sellCents = null; source = ""; costCents = null };
  };

  // ── Kosten van OA's en leveranciers (ÉÉN interface; 2c.7 sluit hier aan) ──
  // Een kost die aan de klant kan worden doorgerekend. Nu: de regels "andere" van de OA-facturen van 2.11 (geregistreerd of
  // goedgekeurd; post- en regieregels niet: die zitten al in de offerte en het werfverslag). Een regel van 2.11 heeft geen vlag
  // "doorrekenen": kantoor zet ze per regel (MmOverride.passOn). 2c.7: voeg hier de regels van `purchases` toe met hun kostensoort
  // (kindKey = de sleutel van CostKind) en PurchaseLine.passOn; de sleutel blijft "kost:<bron>:<id>:<regel>" (uniek).
  public type CostItem = {
    key : Text;
    day : Nat;
    orgId : ?Nat;
    kindKey : Text; // kostensoort (2.11: "andere"; 2c.7: "materiaal", "container", "transport" …): kiest de marge (AC-19)
    description : Text;
    qtyMilli : Int;
    unit : Text;
    unitCents : Int; // kostprijs per eenheid
    amountCents : Int;
    passOn : Bool; // de bron zegt "doorrekenen" (2c.7); 2.11: altijd false
    source : Text; // "OA-factuur 2026-17"
    version : Text; // de inhoud van de regel (hash): een aanpassing van kantoor geldt enkel voor deze versie (review M3)
    pending : Bool; // de factuur is nog niet goedgekeurd: een doorgerekende kost wacht (telt niet, review L7)
  };

  // Goedgekeurd = telt; geregistreerd = wacht; betwist en ingetrokken = nooit. 2c.7: een OA-factuur die een werfdeel van een
  // aankoopfactuur (Purchase) is, komt hier NIET via de regel "andere" van 2.11 maar via de aankoopregels (anders dubbel).
  public func costItems(c : Ctx, workId : Nat) : [CostItem] {
    let out = List.empty<CostItem>();
    for (inv in OaInvoice.invoicesOf(c.oi, workId).values()) {
      // Een werfdeel van een aankoop (2c.7) komt via de aankoopregels hieronder, niet ook nog via zijn regel "andere" (anders dubbel).
      if ((inv.status == #approved or inv.status == #registered) and not c.pu.partOf.containsKey(inv.id)) {
        switch (OaInvoice.amountsOf(c.oi, inv.id)) {
          case (?a) {
            for ((i, l) in a.lines.enumerate()) {
              if (l.kind == #other) {
                out.add({ key = "kost:oa:" # inv.id.toText() # ":" # i.toText(); day = switch (inv.periodTo) { case (?d) d; case null inv.invoiceDay }; orgId = ?inv.orgId; kindKey = "andere"; description = l.description; qtyMilli = l.qtyMilli; unit = "st"; unitCents = l.unitCents; amountCents = l.amountCents; passOn = false; source = "OA-factuur " # inv.number; version = Text.fromIter(hash("bowaco-kost-v1|" # l.description # "|" # Int.toText(l.qtyMilli) # "|" # Int.toText(l.unitCents) # "|" # Int.toText(l.amountCents)).chars().take(16)); pending = inv.status != #approved });
              };
            };
          };
          case null {};
        };
      };
    };
    // 2c.7: de doorrekenbare regels van de aankoopfacturen (PurchaseLine.passOn; geen posten, uren of voorschotten): sleutel
    // "kost:<aankoop>:<lineId>" (de lineId blijft bij een verbetering), bron "aankoop:<id>" (zonder firmanaam). De stand volgt het
    // werfdeel van die werf: goedgekeurd telt, geregistreerd of in controle wacht, betwist of ingetrokken staat er niet.
    for (k in Purchase.passOnCosts(c.pu, c.oi, workId, null, null, false).values()) {
      // Een exacte eenheidsprijs als die bestaat; anders 1 × het bedrag (de regel rekent nooit een ander bedrag dan de factuur).
      let exact = k.qtyMilli > 0 and (k.costCents * 1000) % k.qtyMilli == 0;
      let kind = if (Text.startsWith(k.kindKey, #text "andere")) "andere" else k.kindKey;
      out.add({ key = k.key; day = k.day; orgId = ?k.orgId; kindKey = kind; description = k.description; qtyMilli = if exact k.qtyMilli else 0; unit = if (k.unit == "") "st" else k.unit; unitCents = if exact (k.costCents * 1000) / k.qtyMilli else k.costCents; amountCents = k.costCents; passOn = true; source = k.source; version = Text.fromIter(hash("bowaco-kost-v1|" # k.description # "|" # Int.toText(k.qtyMilli) # "|" # k.unit # "|" # Int.toText(k.costCents)).chars().take(16)); pending = k.status != #approved });
    };
    out.toArray();
  };

  // Een aanpassing van kantoor op een automatische regel: enkel van DEZE werf en voor deze versie van de bron (extra "versie").
  public func overrideVersion(o : Types.MmOverride) : Text {
    switch (o.extra.find(func((k, _) : (Text, Text)) : Bool = k == "versie")) { case (?(_, v)) v; case null "" };
  };
  public func overrideFor(c : Ctx, workId : Nat, key : Text, version : Text) : ?Types.MmOverride {
    switch (c.mm.overrides.get(key)) { case (?o) { if (o.workId == workId and overrideVersion(o) == version) ?o else null }; case null null };
  };
  public func staleOverride(c : Ctx, workId : Nat, key : Text, version : Text) : Bool {
    switch (c.mm.overrides.get(key)) { case (?o) o.workId == workId and overrideVersion(o) != version; case null false };
  };

  // De marge van een doorgerekende kost: de klasse van de firma (2c.1, "org:<id>") > die van de kostensoort > de standaard.
  public func costMargin(c : Ctx, orgId : ?Nat, kindKey : Text) : Nat {
    switch orgId { case (?o) { switch (QuoteForms.linkPick(c.qf, QuoteForms.orgKey(o))) { case (?pk) { return pk.marginBp }; case null {} } }; case null {} };
    passOnBp(c.settings, kindKey);
  };

  public func sellOf(costCents : Int, marginBp : Nat) : Int {
    switch (QuoteCalc.unitSell(?costCents, null, marginBp)) { case (?x) x; case null costCents };
  };

  // ── Reeds gefactureerd (2c.6 sluit hier aan) ──────────────────────────────
  // Nu: elke VERZONDEN vorderingsstaat van de werf (een creditnota telt negatief), excl. btw: het bedrag van de periode (cents) en
  // apart de prijsherziening (revisionCents; review H3: de herziening hoort niet bij de aanneemsom en mag "nog te factureren" niet
  // verlagen); en de regels "reeds gefactureerd" die kantoor met de hand opgaf (facturen van vóór de app, zonder herziening).
  // 2c.6: de uitgereikte verkoopfacturen hier, met dezelfde splitsing (werk · prijsherziening).
  public func invoicedOf(c : Ctx, workId : Nat) : [Types.MmInvoiced] {
    let out = List.empty<Types.MmInvoiced>();
    for (st in Progress.statementsOf(c.ps, workId).values()) {
      if (st.status == #sent) {
        switch (Progress.frozenOf(c.ps, st.id)) {
          case (?f) out.add({ title = (if (st.kind == #credit) "creditnota " else "vorderingsstaat ") # st.code; day = f.sendDay; cents = f.totals.periodCents; revisionCents = f.totals.revisionCents });
          case null {};
        };
      };
    };
    for (e in entriesOf(c.mm, workId).values()) {
      if (e.kind == #invoiced and e.archivedAt == null) {
        switch (priceOf(c.mm, e.id)) { case (?p) out.add({ title = e.description; day = switch (e.day) { case (?d) d; case null Progress.dayOf(e.createdAt) }; cents = p.unitCents; revisionCents = 0 }); case null {} };
      };
    };
    out.toArray();
  };

  // ── De levende staat ─────────────────────────────────────────────────────
  public type Row = {
    key : Text;
    source : Text;
    sourceText : Text;
    chapter : Text;
    chapterFrom : Text;
    day : ?Nat;
    description : Text;
    descriptionClient : Text;
    unit : Text;
    qtyMilli : Int;
    unitCents : Int;
    pctBp : ?Nat;
    col : MinMeerCalc.Col;
    counted : Bool;
    approval : Text;
    note : Text;
    entryId : ?Nat;
    root : ?Nat;
    orgId : ?Nat;
    costCents : ?Int;
    marginBp : ?Nat;
    excluded : Bool;
    passOn : Bool;
    inVersion : Bool;
    overridable : Bool;
    flags : [Text];
    proposedBy : ?Nat;
    version : Text; // de versie van de bron (een kostregel: haar inhoud); een aanpassing geldt enkel voor die versie (review M3)
  };
  public type DiscRow = { entryId : Nat; chapter : Text; description : Text; pctBp : ?Nat; amountCents : Int; counted : Bool };
  public type Built = {
    base : ?Types.QuoteVersion;
    baseLabel : Text;
    rows : [Row];
    outs : [MinMeerCalc.LineOut]; // per regel (ook wat niet in een versie komt)
    discs : [DiscRow];
    invoiced : [Types.MmInvoiced];
    totals : MinMeerCalc.Totals;
    vatBp : Nat;
    openSurvey : ?Nat;
    posts : [MV.MmPostRef];
    quoteRefs : [Text];
    revisionCents : Int; // al aangerekende prijsherziening (apart, review H3)
    bigChapters : [Text]; // hoofdstukken waar meerwerk met een akkoord mondeling/mail samen ≥ de drempel is (review M4)
  };

  type PostInfo = { root : Nat; chapter : Text; title : Text; unit : Text; form : Types.ContractForm; qtyMilli : Int; unitCents : ?Int; qlbl : Text };

  func chapterText(ch : ?Types.QuoteChapter) : Text { switch ch { case (?x) (x.code # " " # x.title).trim(#char ' '); case null "" } };
  func orgName(c : Ctx, o : ?Nat) : Text { switch o { case (?id) { switch (c.org.orgs.get(id)) { case (?x) x.name; case null "" } }; case null "" } };

  // Een regel zoals de meeste: de rest van de velden op hun standaard.
  func row(key : Text, source : Text, sourceText : Text, chapter : Text, description : Text, client : Text, unit : Text, qty : Int, unitCents : Int, col : MinMeerCalc.Col) : Row {
    { key; source; sourceText; chapter; chapterFrom = ""; day = null; description; descriptionClient = client; unit; qtyMilli = qty; unitCents; pctBp = null; col; counted = true; approval = "niet nodig"; note = ""; entryId = null; root = null; orgId = null; costCents = null; marginBp = null; excluded = false; passOn = false; inVersion = true; overridable = false; flags = []; proposedBy = null; version = "" };
  };

  // Telt een regel van kantoor mee volgens haar akkoord? (een meerwerkofferte telt via haar eigen posten, zodra ze aanvaard is)
  public func approvalCounts(a : Types.MmApproval) : Bool { switch a { case (#notNeeded or #recorded _) true; case (#pending or #quote _) false } };

  // Review M1: een meerwerkofferte is aanvaard als EEN versie van die offerte aanvaard is (een v2 na een verstuurde v1 telt ook).
  public func acceptedVersionOf(c : Ctx, vid : Nat) : ?Types.QuoteVersion {
    let v = c.qs.versions.get(vid) ?? return null;
    Quotes.versionsOf(c.qs, v.quoteId).find(func(x : Types.QuoteVersion) : Bool = x.status == #accepted);
  };
  public func quoteAccepted(c : Ctx, a : Types.MmApproval) : Bool {
    switch a { case (#quote vid) acceptedVersionOf(c, vid) != null; case _ false };
  };

  public func build(c : Ctx, workId : Nat, today : Nat) : Built {
    let pc = progressCtx(c);
    let base = Progress.baseVersion(pc, workId);
    let fallback = Library.standardMargin(c.settings);
    let rows = List.empty<Row>();
    let discs = List.empty<DiscRow>();
    let refs = List.empty<Text>();
    let qlabel = func(v : Types.QuoteVersion) : Text = switch (c.qs.quotes.get(v.quoteId)) { case (?q) q.number # " v" # v.version.toText(); case null "?" };
    let discountOf = func(v : Types.QuoteVersion) : Int = Quotes.compute(c.qs, c.qf, v, fallback).totals.discount;

    // 1. De getekende offerte: de posten (kolom offerte) en haar korting op het totaal.
    let baseInfo = Map.empty<Nat, PostInfo>();
    let baseLabel = switch base { case (?v) qlabel(v); case null "" };
    switch base {
      case (?v) {
        refs.add(baseLabel);
        let chs = Quotes.chaptersOf(c.qs, v.id);
        for (l in Quotes.linesOf(c.qs, v.id, chs).values()) {
          if (l.kind == #item) {
            let r = WorkStart.root(c.qs, l.id);
            let u = Quotes.unitSellOf(c.qs, c.qf, v, l, fallback);
            let ch = chapterText(chs.find(func(x : Types.QuoteChapter) : Bool = x.id == l.chapterId));
            baseInfo.add(r, { root = r; chapter = ch; title = l.title; unit = l.unit; form = l.form; qtyMilli = l.qtyMilli; unitCents = u; qlbl = baseLabel });
            let x = row("offerte:" # r.toText(), "offerte", "offerte " # baseLabel, ch, l.title, l.title, l.unit, l.qtyMilli, (switch u { case (?y) y; case null 0 }), #offer);
            rows.add({ x with root = ?r; flags = if (u == null and l.qtyMilli != 0) ["geen-prijs"] else [] });
          };
        };
        let d = discountOf(v);
        if (d != 0) {
          let t = switch (QuoteForms.termsOf(c.qf, v.id)) { case (?x) x.discountText; case null "" };
          let txt = "Korting op de offerte" # (if (t.size() > 0) ": " # t else "");
          rows.add(row("korting:" # v.id.toText(), "offerte", "offerte " # baseLabel, "", txt, txt, "", 1000, -d, #offer));
        };
      };
      case null {};
    };

    // 2. De posten zoals ze nu aanvaard zijn (laatste aanvaarde versie van elke offerte): verschil met de getekende versie, andere
    //    offertes (meerwerkofferte) als meer- of minwerk, en hun korting.
    let posts = Measure.posts(c.qs, c.starts, workId);
    let info = Map.empty<Nat, PostInfo>();
    for ((k, x) in baseInfo.entries()) { info.add(k, x) };
    let seenVersion = Map.empty<Nat, Bool>();
    let seenRoot = Map.empty<Nat, Bool>();
    var baseQuoteLatest : ?Types.QuoteVersion = null;
    for (p in posts.values()) {
      let u = Quotes.unitSellOf(c.qs, c.qf, p.version, p.line, fallback);
      let ch = chapterText(p.chapter);
      let lbl = Measure.versionLabel(p);
      let pi : PostInfo = { root = p.root; chapter = ch; title = p.line.title; unit = p.line.unit; form = p.line.form; qtyMilli = p.line.qtyMilli; unitCents = u; qlbl = lbl };
      seenRoot.add(p.root, true);
      let isBaseQuote = switch base { case (?b) b.quoteId == p.quote.id; case null false };
      if (isBaseQuote) { baseQuoteLatest := ?p.version };
      let uu = switch u { case (?y) y; case null 0 };
      switch (baseInfo.get(p.root)) {
        case (?b0) {
          let changed = switch base { case (?b) b.id != p.version.id; case null false };
          if (changed) {
            let u0 = switch (b0.unitCents) { case (?y) y; case null 0 };
            // Altijd twee regels (de getekende hoeveelheid × prijs weg, de nieuwe erbij): zo is offerte + versie per post exact het
            // bedrag van de nieuwe versie (geen afrondingsverschil), en een afrekening van die post exact 0 (review H2).
            if (u0 != uu or p.line.qtyMilli != b0.qtyMilli) {
              rows.add({ row("versie:" # p.root.toText() # ":weg", "versie", "offerte " # lbl, ch, b0.title # " (getekende versie)", b0.title # " (getekende versie)", b0.unit, -b0.qtyMilli, u0, #auto) with root = ?p.root });
              rows.add({ row("versie:" # p.root.toText(), "versie", "offerte " # lbl, ch, p.line.title, p.line.title, p.line.unit, p.line.qtyMilli, uu, #auto) with root = ?p.root });
            };
          };
          info.add(p.root, pi);
        };
        case null {
          info.add(p.root, pi);
          let extraQuote = QuoteForms.infoOf(c.qf, p.quote.id).kind == #extraWork;
          let how = (if extraQuote "meerwerkofferte " else "offerte ") # p.quote.number # " aanvaard op " # day(Progress.dayOf(WorkStart.acceptedAt(c.qd, p.version)));
          let x = row("offerte:" # p.root.toText(), if extraQuote "meerwerkofferte" else "offerte", (if extraQuote "meerwerkofferte " else "offerte ") # lbl, ch, p.line.title, p.line.title, p.line.unit, p.line.qtyMilli, uu, #auto);
          rows.add({ x with root = ?p.root; approval = how; flags = if (u == null and p.line.qtyMilli != 0) ["geen-prijs"] else [] });
        };
      };
      if (not seenVersion.containsKey(p.version.id)) {
        seenVersion.add(p.version.id, true);
        let isBase = switch base { case (?b) b.id == p.version.id; case null false };
        if (not isBase) {
          if (not isBaseQuote) { refs.add(lbl) };
          let d1 = discountOf(p.version);
          let d0 = if isBaseQuote (switch base { case (?b) discountOf(b); case null 0 }) else 0;
          if (d1 != d0) {
            let txt = "Korting " # (if isBaseQuote "offerte " else "") # lbl;
            rows.add(row("korting:" # p.version.id.toText(), if isBaseQuote "versie" else "meerwerkofferte", "offerte " # lbl, "", txt, txt, "", 1000, -(d1 - d0), #auto));
          };
        };
      };
    };
    // Een post van de getekende versie die in de laatst aanvaarde versie niet meer staat: minwerk.
    switch (base, baseQuoteLatest) {
      case (?b, ?lv) {
        if (lv.id != b.id) {
          for ((r, b0) in baseInfo.entries()) {
            if (not seenRoot.containsKey(r)) {
              rows.add({ row("versie:" # r.toText() # ":weg", "versie", "offerte " # qlabel(lv), b0.chapter, b0.title, b0.title, b0.unit, -b0.qtyMilli, (switch (b0.unitCents) { case (?y) y; case null 0 }), #auto) with root = ?r });
            };
          };
        };
      };
      case _ {};
    };

    // 3. De opmeting (VH-posten): gemeten − VH volgens de laatste afgesloten opmeting.
    let (measured, mSurvey) = Progress.measuredUpTo(c.ss, workId, today);
    for (p in posts.values()) {
      if (p.line.form == #vh) {
        switch (measured.get(p.root)) {
          case (?m) {
            let delta = m - p.line.qtyMilli;
            if (delta != 0) {
              let u = switch (info.get(p.root)) { case (?x) { switch (x.unitCents) { case (?y) y; case null 0 } }; case null 0 };
              let src = "opmeting" # (switch mSurvey { case (?n) " " # n.toText(); case null "" });
              rows.add({ row("opmeting:" # p.root.toText(), "opmeting", src, chapterText(p.chapter), p.line.title, p.line.title, p.line.unit, delta, u, #auto) with root = ?p.root; overridable = true });
            };
          };
          case null {};
        };
      };
    };

    // 4. De regels van kantoor en de voorstellen van de werfleider.
    let threshold : Int = quoteFromCents(c.settings);
    let settled = Map.empty<Nat, Bool>();
    let entries = entriesOf(c.mm, workId).filter(func(e : Types.MmEntry) : Bool = e.archivedAt == null);
    for (e in entries.values()) { if (e.kind == #settle) { switch (e.root) { case (?r) { if (approvalCounts(e.approval)) settled.add(r, true) }; case null {} } } };
    for (e in entries.values()) {
      let pr = priceOf(c.mm, e.id);
      let post = switch (e.root) { case (?r) info.get(r); case null null };
      let ch = if (e.chapter == "") (switch post { case (?x) x.chapter; case null "" }) else e.chapter;
      let src = if (e.proposedBy != null) "voorstel" else "kantoor";
      let srcText = if (e.proposedBy != null) "voorstel werfleider" else "kantoor";
      let viaQuote = switch (e.approval) { case (#quote _) true; case _ false };
      let accepted = quoteAccepted(c, e.approval);
      let flags = List.empty<Text>();
      let base0 = { row("regel:" # e.id.toText(), src, srcText, ch, e.description, e.description, e.unit, e.qtyMilli, 0, #extra) with entryId = ?e.id; root = e.root; day = e.day; note = e.note; approval = approvalText(c, e.approval); proposedBy = e.proposedBy; counted = approvalCounts(e.approval); inVersion = not accepted };
      if (viaQuote) { flags.add(if accepted "via-meerwerkofferte" else "wacht-op-meerwerkofferte") };
      if (e.approval == #pending) { flags.add("wacht-op-akkoord") };
      switch (e.kind) {
        case (#invoiced) {};
        case (#discount) {
          let amt = switch pr { case (?p) p.unitCents; case null 0 };
          let okd = e.pctBp != null or pr != null;
          discs.add({ entryId = e.id; chapter = e.chapter; description = e.description; pctBp = e.pctBp; amountCents = amt; counted = okd and approvalCounts(e.approval) });
        };
        case (#settle) {
          switch post {
            case (?x) {
              // Review H2: de hoeveelheid en prijs van de LAATST aanvaarde versie, zodat offerte + versieregels + afrekening voor die
              // post samen precies 0 zijn. Een post die niet meer in de aanvaarde versie staat, is al weg (versieregel): 0.
              let u = switch (x.unitCents) { case (?y) y; case null 0 };
              let q = switch (e.root) { case (?r) { if (seenRoot.containsKey(r)) x.qtyMilli else 0 }; case null 0 };
              rows.add({ base0 with source = "afrekening"; sourceText = "raming afgerekend"; description = "Raming afgerekend: " # x.title; descriptionClient = "Raming afgerekend: " # x.title; unit = x.unit; qtyMilli = q; unitCents = u; col = #less; flags = flags.toArray() });
            };
            case null { rows.add({ base0 with counted = false; inVersion = false; flags = ["post-onbekend"] }) };
          };
        };
        case (#less) {
          let (q, u, pct, has) : (Int, Int, ?Nat, Bool) = switch (pr, post) {
            case (?p, _) (e.qtyMilli, p.unitCents, e.pctBp, true);
            case (null, ?x) { switch (x.unitCents) { case (?y) (if (e.pctBp != null) x.qtyMilli else e.qtyMilli, y, e.pctBp, true); case null (e.qtyMilli, 0, e.pctBp, false) } };
            case (null, null) (e.qtyMilli, 0, e.pctBp, false);
          };
          if (not has) { flags.add("te-prijzen") };
          let unit = switch post { case (?x) { if (e.unit == "") x.unit else e.unit }; case null e.unit };
          rows.add({ base0 with unit; qtyMilli = q; unitCents = u; pctBp = pct; col = #less; counted = base0.counted and has; flags = flags.toArray(); costCents = switch pr { case (?p) p.costCents; case null null }; marginBp = switch pr { case (?p) p.marginBp; case null null }; orgId = switch pr { case (?p) p.orgId; case null null } });
        };
        case (#extra or #regie or #cost) {
          let (u, has, cost) : (Int, Bool, ?Int) = switch pr {
            case (?p) (p.unitCents, true, p.costCents);
            case null {
              if (e.kind == #regie) {
                let rt = rateFor(c, workId, base, null, null, switch (e.day) { case (?d) d; case null today });
                switch (rt.sellCents) { case (?s) (s, true, null); case null (0, false, null) };
              } else (0, false, null);
            };
          };
          if (not has) { flags.add("te-prijzen") };
          let amt = MinMeerCalc.amount({ chapter = ch; col = #extra; qtyMilli = e.qtyMilli; unitCents = u; pctBp = null; counted = true });
          let big = has and Int.abs(amt) >= threshold and not viaQuote;
          if (big) { flags.add("meerwerkofferte-nodig") };
          let srcT = if (e.kind == #regie) "regie (kantoor)" else if (e.kind == #cost) "kost (kantoor)" else srcText;
          rows.add({ base0 with source = if (e.kind == #regie) "regie" else if (e.kind == #cost) "kost" else src; sourceText = srcT; unitCents = u; col = #extra; counted = base0.counted and has and not big; approval = if big ("meerwerkofferte nodig (vanaf " # euro(threshold) # ")") else base0.approval; costCents = cost; marginBp = switch pr { case (?p) p.marginBp; case null null }; orgId = switch pr { case (?p) p.orgId; case null null }; flags = flags.toArray() });
        };
      };
    };

    // 5. De regie-uren van het werfverslag, per aanwezigheidsregel (dag, firma of eigen mensen). Een taak hangt aan een raming als
    // een van haar lijnen een regie-, raming- of budgetpost is (review M2). Uren zonder post tellen enkel als de werf geen raming
    // meer open heeft (zoals 2.10: anders horen ze vermoedelijk bij die raming; "regie-zonder-post", telt niet).
    func isRaming(f : Types.ContractForm) : Bool { f == #regie or f == #estimate or f == #budget };
    let taskRoot = Map.empty<Nat, Nat>();
    for (t in c.plan.tasks.values()) {
      if (t.workId == workId and t.archivedAt == null) {
        label find for (lid in t.quoteLineIds.values()) {
          switch (c.qs.lines.get(lid)) { case (?l) { if (isRaming(l.form)) { taskRoot.add(t.id, WorkStart.root(c.qs, l.id)); break find } }; case null {} };
        };
      };
    };
    var openRaming = false;
    for ((r, x) in info.entries()) { if (isRaming(x.form) and seenRoot.containsKey(r) and not settled.containsKey(r)) { openRaming := true } };
    // Review L2: een aanpassing op een aanwezigheidsregel die later verbeterd werd (nieuwe regel), vervalt: de nieuwe regel krijgt
    // de markering "aanpassing-vervallen" (nakijken).
    let staleUren = Map.empty<Nat, Bool>();
    for (a in c.reports.attendances.values()) {
      if (a.workId == workId) { switch (a.replacedBy, c.mm.overrides.get("uren:" # a.id.toText())) { case (?b, ?o) { if (o.workId == workId) staleUren.add(b, true) }; case _ {} } };
    };
    for (a in c.reports.attendances.values()) {
      if (a.workId == workId and Progress.validAttendance(a)) {
        let st = Progress.hoursState(c.reports, a);
        let h = Progress.milliHours(a.minutesTotal);
        let r = switch (a.taskId) { case (?tid) taskRoot.get(tid); case null null };
        let post = switch r { case (?x) info.get(x); case null null };
        let inRaming = switch (r, post) { case (?x, ?_) not settled.containsKey(x); case _ false };
        let held = post == null and openRaming;
        let rt = rateFor(c, workId, base, switch post { case (?x) { if (x.form == #regie) x.unitCents else null }; case null null }, a.orgId, a.day);
        let flags = List.empty<Text>();
        if (st == #disputed) { flags.add("uren-betwist") };
        if (st == #open) { flags.add("uren-open") };
        if (inRaming) { flags.add("binnen-raming") };
        if (held) { flags.add("regie-zonder-post") };
        if (rt.sellCents == null) { flags.add("geen-regietarief") };
        if (staleUren.containsKey(a.id)) { flags.add("aanpassing-vervallen") };
        let who = switch (a.orgId) { case (?o) orgName(c, ?o); case null { if (a.names.size() > 0) a.names else "BOWACO" } };
        let pers = a.headcount.toText() # " pers.";
        let sell = switch (rt.sellCents) { case (?s) s; case null 0 };
        let x = row("uren:" # a.id.toText(), "regie", "werfverslag", switch post { case (?p) p.chapter; case null "Regie" }, "Regie " # day(a.day) # " · " # who # " · " # pers, "Regie " # day(a.day) # " · " # pers, "u", h, sell, #extra);
        let use = st != #disputed and not inRaming and not held;
        let note = if inRaming "binnen de raming van de offerte (nog niet afgerekend)" else if held "regie zonder post: een raming van de offerte is nog niet afgerekend" else rt.source;
        rows.add({ x with day = ?a.day; root = r; orgId = a.orgId; costCents = rt.costCents; marginBp = switch (rt.costCents) { case (?k) { if (sell > 0 and k <= sell) ?Int.abs(QuoteCalc.roundDiv((sell - k) * 10_000, sell)) else null }; case null null }; counted = use and rt.sellCents != null; inVersion = use; overridable = true; note; flags = flags.toArray() });
      };
    };

    // 6. Kosten van OA's en leveranciers (costItems): doorrekenen aan kostprijs / (1 − marge). Enkel een goedgekeurde factuur telt;
    // een geregistreerde (nog niet gecontroleerde) wacht (review L7). Een aanpassing van kantoor geldt enkel voor de regel zoals ze
    // was (versie = de inhoud van de regel, review M3); is de factuur verbeterd, dan vervalt ze ("aanpassing-vervallen", nakijken).
    for (k in costItems(c, workId).values()) {
      let ovPass = switch (overrideFor(c, workId, k.key, k.version)) { case (?o) o.passOn; case null false };
      let pass = k.passOn or ovPass;
      let m = costMargin(c, k.orgId, k.kindKey);
      let (q, uc) = if (k.qtyMilli == 0) (1000, k.amountCents) else (k.qtyMilli, k.unitCents);
      let x = row(k.key, "kost", k.source, "Kosten", k.kindKey # " · " # orgName(c, k.orgId) # " · " # k.description, "Kost: " # k.description, k.unit, q, sellOf(uc, m), #extra);
      let flags = List.empty<Text>();
      if (not pass) { flags.add("niet-doorgerekend") };
      if (pass and k.pending) { flags.add("factuur-niet-goedgekeurd") };
      if (staleOverride(c, workId, k.key, k.version)) { flags.add("aanpassing-vervallen") };
      rows.add({ x with day = ?k.day; orgId = k.orgId; costCents = ?uc; marginBp = ?m; passOn = pass; counted = pass and not k.pending; inVersion = pass; overridable = true; version = k.version; approval = if (pass and k.pending) "wacht (factuur nog niet goedgekeurd)" else "niet nodig"; flags = flags.toArray() });
    };

    // 7. Wat kantoor aan een automatische regel veranderde: uitsluiten, ander hoofdstuk (enkel een aanpassing van deze werf en
    // voor deze versie van de regel).
    let done = rows.toArray().map(
      func(x : Row) : Row {
        if (not x.overridable) { return x };
        switch (overrideFor(c, workId, x.key, x.version)) {
          case (?o) {
            let y = switch (o.chapter) { case (?ch) { { x with chapter = ch; chapterFrom = x.chapter } }; case null x };
            if (o.exclude) { { y with excluded = true; counted = false; inVersion = false; flags = y.flags.concat(["uitgesloten"]); note = "uitgesloten: " # o.reason } } else y;
          };
          case null x;
        };
      }
    );

    // 8. Rekenen (enkel wat in een versie komt telt in de totalen).
    let invoiced = invoicedOf(c, workId);
    var inv : Int = 0;
    var rev : Int = 0;
    for (i in invoiced.values()) { inv += i.cents; rev += i.revisionCents };
    let vatBp = switch (c.works.works.get(workId)) { case (?w) w.vatBp; case null 2100 };
    let calcLine = func(x : Row) : MinMeerCalc.Line = { chapter = x.chapter; col = x.col; qtyMilli = x.qtyMilli; unitCents = x.unitCents; pctBp = x.pctBp; counted = x.counted };
    // Review M4: een automatische regie- of kostregel boven de drempel krijgt een melding (blokkeert niet); meerwerk met een akkoord
    // "mondeling/mail" dat per hoofdstuk samen de drempel haalt, ook.
    let chSum = Map.empty<Text, Int>();
    let marked = done.map(
      func(x : Row) : Row {
        let o = MinMeerCalc.line(calcLine(x));
        // Telt mee zonder meerwerkofferte = akkoord "niet nodig" of "gegeven" (wachtend en via een meerwerkofferte telt niet).
        if (x.entryId != null and x.counted and x.col == #extra) {
          chSum.add(x.chapter, (switch (chSum.get(x.chapter)) { case (?v) v; case null 0 }) + o.extraCents);
        };
        if (x.entryId == null and (x.source == "regie" or x.source == "kost") and x.counted and Int.abs(o.amountCents) >= threshold) { { x with flags = x.flags.concat(["boven-drempel"]) } } else x;
      }
    );
    let bigChapters = chSum.entries().filter(func((_, v) : (Text, Int)) : Bool = v >= threshold).map(func((k, _) : (Text, Int)) : Text = if (k == "") "algemeen" else k).toArray();
    let inV = marked.filter(func(x : Row) : Bool = x.inVersion);
    let ds = discs.toArray();
    let totals = MinMeerCalc.totals(inV.map(calcLine), ds.map(func(d : DiscRow) : MinMeerCalc.Disc = { chapter = d.chapter; pctBp = d.pctBp; amountCents = d.amountCents; counted = d.counted }), inv, vatBp);
    let postRefs = List.empty<MV.MmPostRef>();
    for (x in info.values()) { postRefs.add({ root = x.root; chapter = x.chapter; title = x.title; unit = x.unit; form = x.form; quoteNumber = x.qlbl }) };
    {
      base;
      baseLabel;
      rows = marked;
      outs = marked.map(func(x : Row) : MinMeerCalc.LineOut = MinMeerCalc.line(calcLine(x)));
      discs = ds;
      invoiced;
      totals;
      vatBp;
      openSurvey = Progress.openSurvey(c.ss, workId);
      posts = postRefs.toArray();
      quoteRefs = refs.toArray();
      revisionCents = rev;
      bigChapters;
    };
  };

  // ── Wat aandacht vraagt (kantoor) ────────────────────────────────────────
  public func findings(b : Built) : [MV.MmFinding] {
    let out = List.empty<MV.MmFinding>();
    func count(flag : Text) : Nat { b.rows.filter(func(r : Row) : Bool = r.flags.find(func(f : Text) : Bool = f == flag) != null).size() };
    func add(key : Text, text : Text) { let n = count(key); if (n > 0) out.add({ key; text; count = n }) };
    if (b.base == null) { out.add({ key = "geen-offerte"; text = "Geen getekende offerte: enkel regels van kantoor, uren en kosten"; count = 0 }) };
    add("te-prijzen", "Regels zonder prijs (tellen nog niet mee)");
    add("meerwerkofferte-nodig", "Meerwerk vanaf het drempelbedrag zonder aanvaarde meerwerkofferte (telt niet mee)");
    add("wacht-op-akkoord", "Regels die op het akkoord van de klant wachten");
    add("wacht-op-meerwerkofferte", "Meerwerkoffertes die nog niet aanvaard zijn");
    add("uren-open", "Regie-uren van een OA die nog niet bevestigd zijn");
    add("uren-betwist", "Regie-uren betwist door de OA (tellen niet mee)");
    add("binnen-raming", "Regie-uren op een raming van de offerte: tellen pas als de raming afgerekend is");
    add("regie-zonder-post", "Regie-uren zonder post terwijl een raming van de offerte nog niet afgerekend is (tellen niet)");
    add("boven-drempel", "Automatische regie- of kostregels vanaf het drempelbedrag (enkel een melding)");
    add("aanpassing-vervallen", "Een aanpassing van kantoor vervalt: de bron (factuur of werfverslag) is verbeterd; nakijken");
    add("factuur-niet-goedgekeurd", "Doorgerekende kosten van een OA-factuur die nog niet goedgekeurd is (wachten)");
    if (b.bigChapters.size() > 0) { out.add({ key = "akkoord-som-drempel"; text = "Meerwerk zonder meerwerkofferte (akkoord mondeling, per mail of niet nodig) haalt samen de drempel in: " # Text.join(b.bigChapters.values(), ", "); count = b.bigChapters.size() }) };
    add("geen-regietarief", "Regie-uren zonder regietarief (zet het regietarief van de werf)");
    add("niet-doorgerekend", "Kosten van OA's die (nog) niet doorgerekend worden");
    add("geen-prijs", "Posten van de offerte zonder verkoopprijs");
    switch (b.openSurvey) { case (?n) out.add({ key = "open-opmeting"; text = "Opmeting " # n.toText() # " is nog open (niet in de staat)"; count = 0 }); case null {} };
    out.toArray();
  };

  // ── Een versie vastleggen ────────────────────────────────────────────────
  public func frozenLines(b : Built) : [Types.MmLineFrozen] {
    let out = List.empty<Types.MmLineFrozen>();
    for ((i, r) in b.rows.enumerate()) {
      if (r.inVersion) {
        let o = b.outs[i];
        out.add({ chapter = r.chapter; source = if (r.source == "kost") "kost" else r.sourceText; key = r.key; day = r.day; description = r.descriptionClient; unit = r.unit; qtyMilli = r.qtyMilli; unitCents = r.unitCents; offerCents = o.offerCents; lessCents = o.lessCents; extraCents = o.extraCents; counted = r.counted; approval = r.approval; note = r.note });
      };
    };
    for ((i, d) in b.discs.enumerate()) {
      let o = b.totals.discs[i];
      out.add({ chapter = d.chapter; source = "korting"; key = "regel:" # d.entryId.toText(); day = null; description = d.description; unit = ""; qtyMilli = 0; unitCents = 0; offerCents = 0; lessCents = o.lessCents; extraCents = 0; counted = d.counted; approval = "niet nodig"; note = switch (d.pctBp) { case (?p) pctText(p) # " op het meerwerk" # (if (d.chapter == "") "" else " van " # d.chapter); case null "" } });
    };
    out.toArray();
  };

  public func totalsOf(t : MinMeerCalc.Totals, revisionCents : Int) : Types.MmTotals {
    { offerCents = t.offerCents; lessCents = t.lessCents; extraCents = t.extraCents; balanceCents = t.balanceCents; contractCents = t.contractCents; invoicedCents = t.invoicedCents; toInvoiceCents = t.toInvoiceCents; pendingCents = t.pendingCents; revisionCents; vatBp = t.vatBp };
  };
  public func chaptersOf(t : MinMeerCalc.Totals) : [Types.MmChapterTotal] {
    t.chapters.map(func(x : MinMeerCalc.ChapterOut) : Types.MmChapterTotal = { chapter = x.chapter; offerCents = x.offerCents; lessCents = x.lessCents; extraCents = x.extraCents; balanceCents = x.balanceCents });
  };

  public type Header = { issuer : Text; clientName : Text; workCode : Text; workName : Text; workAddress : Types.Address };

  public func freeze(b : Built, versionId : Nat, number : Nat, d : Nat, h : Header, note : Text) : Types.MmFrozen {
    { versionId; number; day = d; issuer = h.issuer; clientName = h.clientName; workCode = h.workCode; workName = h.workName; workAddress = h.workAddress; quoteRefs = b.quoteRefs; lines = frozenLines(b); chapters = chaptersOf(b.totals); invoiced = b.invoiced; totals = totalsOf(b.totals, b.revisionCents); note; extra = [] };
  };

  // De controlecode: alles wat vastligt, elk veld met zijn lengte ervoor (zoals de offerte en de vorderingsstaat).
  func f(t : Text) : Text { t.size().toText() # ":" # t # ";" };
  func fi(i : Int) : Text { f(Int.toText(i)) };
  func fo(i : ?Nat) : Text { switch i { case (?x) fi(x); case null f("-") } };
  public func canonical(v : Types.MmVersion, fr : Types.MmFrozen) : Text {
    let a = fr.workAddress;
    var out = "bowaco-minmeer-v1;" # fi(v.workId) # fi(fr.number) # fi(fr.day) # fi(v.calcVersion) # f(fr.issuer) # f(fr.clientName) # f(fr.workCode) # f(fr.workName) # f(a.street) # f(a.number) # f(a.zip) # f(a.city) # f(a.country) # f(Text.join(fr.quoteRefs.values(), ",")) # f(fr.note);
    for (l in fr.lines.values()) {
      out #= "L;" # f(l.chapter) # f(l.source) # f(l.key) # fo(l.day) # f(l.description) # f(l.unit) # fi(l.qtyMilli) # fi(l.unitCents) # fi(l.offerCents) # fi(l.lessCents) # fi(l.extraCents) # f(if (l.counted) "telt" else "wacht") # f(l.approval) # f(l.note);
    };
    for (x in fr.chapters.values()) { out #= "H;" # f(x.chapter) # fi(x.offerCents) # fi(x.lessCents) # fi(x.extraCents) # fi(x.balanceCents) };
    for (x in fr.invoiced.values()) { out #= "F;" # f(x.title) # fi(x.day) # fi(x.cents) # fi(x.revisionCents) };
    let t = fr.totals;
    out # "T;" # fi(t.offerCents) # fi(t.lessCents) # fi(t.extraCents) # fi(t.balanceCents) # fi(t.contractCents) # fi(t.invoicedCents) # fi(t.toInvoiceCents) # fi(t.pendingCents) # fi(t.revisionCents) # fi(t.vatBp);
  };

  public func intact(mm : Types.MinMeerState, v : Types.MmVersion) : Bool {
    switch (frozenOf(mm, v.id)) { case (?fr) hash(canonical(v, fr)) == v.hash; case null false };
  };

  // Wat veranderde tegenover de vorige versie (per sleutel): nieuw, gewijzigd, weg; met het verschil in saldo.
  public func changes(prev : ?Types.MmFrozen, cur : Types.MmFrozen) : [MV.MmChange] {
    let out = List.empty<MV.MmChange>();
    let old = Map.empty<Text, Types.MmLineFrozen>();
    switch prev { case (?p) { for (l in p.lines.values()) { old.add(l.key, l) } }; case null { return [] } };
    let bal = func(l : Types.MmLineFrozen) : Int = if (l.counted) l.lessCents + l.extraCents else 0;
    let seen = Map.empty<Text, Bool>();
    for (l in cur.lines.values()) {
      seen.add(l.key, true);
      switch (old.get(l.key)) {
        case (?o) {
          if (o.qtyMilli != l.qtyMilli or o.unitCents != l.unitCents or o.offerCents != l.offerCents or o.lessCents != l.lessCents or o.extraCents != l.extraCents or o.counted != l.counted or o.approval != l.approval) {
            out.add({ kind = "gewijzigd"; chapter = l.chapter; description = l.description; balanceDeltaCents = bal(l) - bal(o) });
          };
        };
        case null { out.add({ kind = "nieuw"; chapter = l.chapter; description = l.description; balanceDeltaCents = bal(l) }) };
      };
    };
    for ((k, o) in old.entries()) { if (not seen.containsKey(k)) { out.add({ kind = "weg"; chapter = o.chapter; description = o.description; balanceDeltaCents = -bal(o) }) } };
    out.toArray();
  };

  public func pctText(bp : Nat) : Text {
    let whole = bp / 100;
    let rest = bp % 100;
    whole.toText() # (if (rest == 0) "" else "," # (if (rest % 10 == 0) (rest / 10).toText() else (if (rest < 10) "0" else "") # rest.toText())) # " %";
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public func colView(c : MinMeerCalc.Col) : MV.MmCol { switch c { case (#offer) #offer; case (#less) #less; case (#extra) #extra; case (#auto) #auto } };

  public func rowView(c : Ctx, r : Row, o : MinMeerCalc.LineOut) : MV.MmRowView {
    {
      key = r.key; source = r.source; sourceText = r.sourceText; chapter = r.chapter; chapterFrom = r.chapterFrom; day = r.day;
      description = r.description; descriptionClient = r.descriptionClient; unit = r.unit; qtyMilli = r.qtyMilli; unitCents = r.unitCents;
      pctBp = r.pctBp; col = colView(r.col); counted = r.counted; approval = r.approval; note = r.note; entryId = r.entryId; root = r.root;
      orgName = orgName(c, r.orgId); costCents = r.costCents; marginBp = r.marginBp; excluded = r.excluded; passOn = r.passOn;
      inVersion = r.inVersion; overridable = r.overridable; flags = r.flags; amountCents = o.amountCents; offerCents = o.offerCents;
      lessCents = o.lessCents; extraCents = o.extraCents;
    };
  };

  // De werfleider: hoeveelheden en uren, nooit een bedrag; geen kostenregels (hun omschrijving komt van een factuur) en geen
  // kortingsregels van een offerte (de korting ziet hij nooit, 2c.1).
  public func qtyRows(b : Built, me : Nat) : [MV.MmQtyRow] {
    b.rows.filter(func(r : Row) : Bool = r.source != "kost" and not Text.startsWith(r.key, #text "korting:")).map(
      func(r : Row) : MV.MmQtyRow {
        // Review L3: niets dat verraadt dat een regel boven een bedrag zit (drempel, meerwerkofferte nodig): neutraal "wacht op akkoord".
        let money = func(f : Text) : Bool = f == "meerwerkofferte-nodig" or f == "boven-drempel" or f == "geen-prijs";
        var fl = r.flags.filter(func(f : Text) : Bool = not money(f));
        if (r.flags.find(func(f : Text) : Bool = f == "meerwerkofferte-nodig") != null and fl.find(func(f : Text) : Bool = f == "wacht-op-akkoord") == null) { fl := fl.concat(["wacht-op-akkoord"]) };
        let appr = if (Text.startsWith(r.approval, #text "meerwerkofferte nodig")) "wacht op akkoord" else r.approval;
        { key = r.key; sourceText = r.sourceText; chapter = r.chapter; day = r.day; description = r.description; unit = r.unit; qtyMilli = r.qtyMilli; counted = r.counted; approval = appr; flags = fl; entryId = r.entryId; mine = r.proposedBy == ?me };
      }
    );
  };

  public func versionBrief(c : Ctx, v : Types.MmVersion) : MV.MmVersionBrief {
    {
      id = v.id; number = v.number; day = v.day; isShared = v.share != null; sharedAt = switch (v.share) { case (?s) ?s.at; case null null };
      answer = switch (c.mm.answers.get(v.id)) { case (?a) ?a.ok; case null null }; createdAt = v.createdAt; createdByName = Access.personName(c.access, v.createdBy); note = v.note;
    };
  };

  public func answerView(c : Ctx, a : Types.MmAnswer) : MV.MmAnswerView { { ok = a.ok; note = a.note; at = a.at; byName = Access.personName(c.access, a.personId) } };

  public func entryView(c : Ctx, e : Types.MmEntry) : MV.MmEntryView {
    {
      id = e.id; kind = e.kind; chapter = e.chapter; root = e.root; description = e.description; unit = e.unit; qtyMilli = e.qtyMilli; pctBp = e.pctBp;
      day = e.day; approval = e.approval; proposedByName = switch (e.proposedBy) { case (?p) Access.personName(c.access, p); case null "" };
      photoFileId = e.photoFileId; note = e.note; rev = e.rev; price = priceOf(c.mm, e.id);
    };
  };

  public func myLines(fr : Types.MmFrozen) : [MV.MyMmLine] {
    fr.lines.map(func(l : Types.MmLineFrozen) : MV.MyMmLine = { chapter = l.chapter; source = l.source; day = l.day; description = l.description; unit = l.unit; qtyMilli = l.qtyMilli; unitCents = l.unitCents; offerCents = l.offerCents; lessCents = l.lessCents; extraCents = l.extraCents; counted = l.counted; approval = l.approval; note = l.note });
  };

  // De vorige versie (nummer − 1 of lager) van dezelfde werf.
  public func previousOf(mm : Types.MinMeerState, v : Types.MmVersion) : ?Types.MmVersion {
    var best : ?Types.MmVersion = null;
    for (x in versionsOf(mm, v.workId).values()) { if (x.number < v.number) { best := ?x } };
    best;
  };

  // Herstel: de indexen uit de records zelf.
  public func rebuildIndex(mm : Types.MinMeerState) {
    mm.byWork.clear();
    mm.versionsByWork.clear();
    let es = mm.entries.values().toArray().sort(func(a, b) = Nat.compare(a.id, b.id));
    for (e in es.values()) { addIdx(mm.byWork, e.workId, e.id) };
    let vs = mm.versions.values().toArray().sort(func(a, b) = Nat.compare(a.id, b.id));
    for (v in vs.values()) { addIdx(mm.versionsByWork, v.workId, v.id) };
  };

  // Bestanden die bij de min-meerstaat horen (foto van een voorstel).
  public func ownedFiles(mm : Types.MinMeerState) : Map.Map<Nat, ()> {
    let m = Map.empty<Nat, ()>();
    for (e in mm.entries.values()) { switch (e.photoFileId) { case (?f) m.add(f, ()); case null {} } };
    m;
  };
};
