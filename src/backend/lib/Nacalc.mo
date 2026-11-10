// Nacalculatie (stap 4.6): de FEITEN per werf waaruit de browser gepland en werkelijk uitrekent (frontend/src/nacalc/calc.ts). Geen
// rechten hier (mixins/NacalcApi.mo). Gepland = de getekende offerte (Progress.baseVersion): posten met verkoop en aankoopprijs, de OA of
// leverancier erbij. Werkelijk = de min-meerstaat (MinMeer.build: aanneemsom + min/meer, gefactureerd) en de kosten van de aankoopfacturen
// op die werf (goedgekeurd telt, wachtend apart; voorschotten en aftrek van voorschotten tellen niet; een creditnota negatief).
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import MV "../types/minmeerviews";
import NV "../types/nacalcviews";
import Config "Config";
import Library "Library";
import MinMeer "MinMeer";
import Progress "Progress";
import Purchase "Purchase";
import Quotes "Quotes";
import WorkStart "WorkStart";

module {
  public func natSetting(s : Types.SettingsState, key : Text, dflt : Nat, max : Nat) : Nat {
    switch (s.values.get(key)) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n <= max) n else dflt }; case null dflt } }; case null dflt };
  };
  public func settingsOf(s : Types.SettingsState) : NV.NcSettings {
    { pctBp = natSetting(s, "nacalc.pctBp", Config.ncPctBpDefault, 100_000); minCents = natSetting(s, "nacalc.minCents", Config.ncMinCentsDefault, 1_000_000_000) };
  };

  public func formKey(f : Types.ContractForm) : Text {
    switch f { case (#fixed) "vast"; case (#regie) "regie"; case (#vh) "vermoedelijk"; case (#estimate) "raming"; case (#budget) "budget"; case (#perAttachment) "bijlage" };
  };
  func statusKey(s : Types.WorkStatus) : Text {
    switch s { case (#request) "aanvraag"; case (#quoting) "offerte"; case (#planned) "gepland"; case (#running) "lopend"; case (#delivered) "opgeleverd"; case (#aftercare) "nazorg"; case (#cancelled) "geannuleerd" };
  };
  func orgName(c : MinMeer.Ctx, o : ?Nat) : Text { switch o { case (?id) { switch (c.org.orgs.get(id)) { case (?x) x.name; case null "" } }; case null "" } };
  func chapterText(ch : ?Types.QuoteChapter) : Text { switch ch { case (?x) (x.code # " " # x.title).trim(#char ' '); case null "" } };

  // De getekende offerte van een werf, doorgerekend zoals de offerte zelf (Quotes.compute): de posten en de totalen.
  type PlannedAll = { planned : [NV.NcPlanned]; discount : Int; subtotal : Int; cost : Int; unpriced : Nat };
  func plannedOf(c : MinMeer.Ctx, v : Types.QuoteVersion) : PlannedAll {
    let comp = Quotes.compute(c.qs, c.qf, v, Library.standardMargin(c.settings));
    let sell = Quotes.sellLines(comp);
    let cost = Quotes.costLines(c.org, comp);
    let out = List.empty<NV.NcPlanned>();
    var costSum : Int = 0;
    var unpriced : Nat = 0;
    for (i in comp.lines.keys()) {
      let l = comp.lines[i];
      if (l.kind == #item) {
        let ch = comp.chapters.find(func(x : Types.QuoteChapter) : Bool = x.id == l.chapterId);
        let k = cost[i];
        if (k.lineCostCents == null and sell[i].lineSellCents != 0) { unpriced += 1 };
        switch (k.lineCostCents) { case (?x) { costSum += x }; case null {} };
        out.add({
          root = WorkStart.root(c.qs, l.id);
          chapter = chapterText(ch);
          code = l.code;
          title = l.title;
          form = formKey(l.form);
          unit = l.unit;
          qtyMilli = l.qtyMilli;
          sellCents = sell[i].lineSellCents;
          costCents = k.lineCostCents;
          orgId = k.orgId;
          orgName = k.orgName;
          source = k.source;
        });
      };
    };
    { planned = out.toArray(); discount = comp.totals.discount; subtotal = comp.totals.subtotal; cost = costSum; unpriced };
  };

  func countsStatus(s : Types.PurchaseStatus) : Bool { s == #approved or s == #registered or s == #checking };

  // De kostenregels van de aankoopfacturen op één werf (alle soorten behalve voorschotten), met de post van de offerte erbij.
  public func actualOf(c : MinMeer.Ctx, workId : Nat, posts : [MV.MmPostRef]) : [NV.NcActual] {
    let d = c.pu;
    let out = List.empty<NV.NcActual>();
    for (p in Purchase.purchasesOf(d, workId).values()) {
      let day = switch (p.periodTo) { case (?t) t; case null p.invoiceDay };
      let own = Purchase.statusOnWork(c.oi, p, workId);
      let orig : ?Types.PurchaseStatus = switch (p.creditOf) {
        case (?o) { switch (d.purchases.get(o)) { case (?op) ?Purchase.statusOnWork(c.oi, op, workId); case null null } };
        case null null;
      };
      let origOk = switch (p.creditOf, orig) { case (null, _) true; case (?_, ?os) countsStatus(os); case (?_, null) false };
      let s = switch orig { case (?os) { if (own == #approved) os else own }; case null own };
      let sg = Purchase.signOf(p);
      if (origOk and countsStatus(s)) {
        switch (Purchase.amountsOf(d, p.id)) {
          case (?a) {
            for (l in a.lines.values()) {
              if (l.workId == ?workId and l.kind != #advance and l.kind != #advanceDeduct) {
                let post = switch (l.root) { case (?r) posts.find(func(x : MV.MmPostRef) : Bool = x.root == r); case null null };
                out.add({
                  purchaseId = p.id;
                  lineId = l.lineId;
                  number = p.number;
                  orgId = p.orgId;
                  orgName = orgName(c, ?p.orgId);
                  orgKind = Purchase.kindKey(p.kind);
                  day;
                  kind = Purchase.costKey(l.kind);
                  kindName = Purchase.costName(l.kind);
                  root = l.root;
                  chapter = switch post { case (?x) x.chapter; case null "" };
                  form = switch post { case (?x) formKey(x.form); case null "" };
                  description = l.description;
                  qtyMilli = sg * l.qtyMilli;
                  amountCents = sg * l.amountCents;
                  status = if (s == #approved) "goedgekeurd" else "wacht";
                  credit = Purchase.isCredit(p);
                });
              };
            };
          };
          case null {};
        };
      };
    };
    out.toArray();
  };

  func hoursOf(c : MinMeer.Ctx, workId : Nat) : [NV.NcHours] {
    let acc = List.empty<NV.NcHours>();
    for (p in Purchase.purchasesOf(c.pu, workId).values()) {
      if (p.status != #withdrawn and p.status != #disputed) {
        for (h in Purchase.claimsOf(c.pu, p.id).values()) {
          if (h.workId == workId) {
            let st = Purchase.claimState(c.settings, c.reports, h);
            let conf = if (st == "klopt" or st == "geen-vraag") h.hoursMilli else 0;
            let opn = if (st == "te-bevestigen") h.hoursMilli else 0;
            let dis = if (st == "klopt-niet") h.hoursMilli else 0;
            switch (acc.findIndex(func(x : NV.NcHours) : Bool = x.orgId == h.orgId)) {
              case (?i) { let x = acc.at(i); acc.put(i, { x with confirmedMilli = x.confirmedMilli + conf; openMilli = x.openMilli + opn; disputedMilli = x.disputedMilli + dis }) };
              case null { acc.add({ orgId = h.orgId; orgName = orgName(c, ?h.orgId); confirmedMilli = conf; openMilli = opn; disputedMilli = dis }) };
            };
          };
        };
      };
    };
    acc.toArray();
  };

  func workOf(c : MinMeer.Ctx, workId : Nat) : (Text, Text, Text, Nat) {
    switch (c.works.works.get(workId)) { case (?w) (w.code, w.name, statusKey(w.status), w.vatBp); case null ("", "", "", 2100) };
  };

  // De feiten van één werf; null = er is nog geen getekende offerte.
  public func facts(c : MinMeer.Ctx, workId : Nat, today : Nat) : ?NV.NcFacts {
    let b = MinMeer.build(c, workId, today);
    switch (b.base) {
      case null null;
      case (?v) {
        let pl = plannedOf(c, v);
        let (code, name, st, vat) = workOf(c, workId);
        ?{
          workId;
          workCode = code;
          workName = name;
          status = st;
          baseQuote = b.baseLabel;
          baseQuoteId = ?v.quoteId;
          vatBp = vat;
          planned = pl.planned;
          discountCents = pl.discount;
          mmChapters = MinMeer.chaptersOf(b.totals);
          mmTotals = MinMeer.totalsOf(b.totals, b.revisionCents);
          actual = actualOf(c, workId, b.posts);
          hours = hoursOf(c, workId);
          settings = settingsOf(c.settings);
        };
      };
    };
  };

  // Eén regel van het overzicht (enkel totalen).
  public func brief(c : MinMeer.Ctx, workId : Nat, today : Nat) : ?NV.NcBrief {
    let b = MinMeer.build(c, workId, today);
    switch (b.base) {
      case null null;
      case (?v) {
        let pl = plannedOf(c, v);
        let (code, name, st, _) = workOf(c, workId);
        var act : Int = 0;
        var pend : Int = 0;
        for (a in actualOf(c, workId, b.posts).values()) { if (a.status == "goedgekeurd") { act += a.amountCents } else { pend += a.amountCents } };
        var open : Nat = 0;
        for (h in hoursOf(c, workId).values()) { if (h.openMilli > 0 or h.disputedMilli > 0) { open += 1 } };
        let t = MinMeer.totalsOf(b.totals, b.revisionCents);
        ?{
          workId;
          workCode = code;
          workName = name;
          status = st;
          baseQuote = b.baseLabel;
          plannedSellCents = pl.subtotal;
          plannedCostCents = pl.cost;
          unpricedLines = pl.unpriced;
          contractCents = t.contractCents;
          invoicedCents = t.invoicedCents;
          actualCents = act;
          pendingCents = pend;
          hoursOpen = open;
        };
      };
    };
  };
};
