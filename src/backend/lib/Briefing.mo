// Maandagbriefing (stap 4.4): het overzicht dat de app zelf samenstelt uit interne gegevens, zonder AI en zonder bedragen. Geen rechten
// hier (mixins/BriefingApi.mo en lib/Bots.mo bepalen welke werven); `visible` beperkt tot de werven die de lezer mag zien.
// Onderdelen: planning van de week · vraagt aandacht (problemen, taken te laat) · voorstellen van bots · vervallend (vergunningen,
// verzekeringen, attesten en keuringen) · facturen van onderaannemers en leveranciers te beslissen · klantakkoorden die wachten.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Text "mo:core/Text";
import Types "../types";
import BV "../types/briefingviews";
import Config "Config";
import Permits "Permits";
import Plan "Plan";
import Purchase "Purchase";
import SiteAdmin "SiteAdmin";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    org : Types.OrgState;
    works : Types.WorksState;
    plan : Types.PlanState;
    reports : Types.ReportState;
    dossier : Types.DossierState;
    permits : Types.PermitState;
    siteAdmin : Types.SiteAdminState;
    quotes : Types.QuotesState;
    minMeer : Types.MinMeerState;
    oaRead : Types.OaReadState;
    aiCheck : Types.AiCheckState;
    invCheck : Types.InvCheckState;
    purchases : Types.PurchaseState;
  };

  let warnAhead : Nat = 30; // dagen vooruit voor verzekeringen, attesten en keuringen

  func code(c : Ctx, w : Nat) : Text { switch (c.works.works.get(w)) { case (?x) x.code; case null "" } };
  func orgName(c : Ctx, o : Nat) : Text { switch (c.org.orgs.get(o)) { case (?x) x.name; case null "" } };
  func ageDays(now : Int, at : Int) : Int { (now - at) / Config.day };
  func item(c : Ctx, w : ?Nat, title : Text, detail : Text, day : ?Nat, days : ?Int) : BV.BrItem {
    { workId = w; workCode = switch w { case (?x) code(c, x); case null "" }; title; detail; day; days };
  };
  // Dringendste eerst: kleinste dagen (negatief = voorbij) eerst; zonder dagen achteraan.
  func byDays(a : BV.BrItem, b : BV.BrItem) : Order.Order {
    switch (a.days, b.days) { case (?x, ?y) Int.compare(x, y); case (?_, null) #less; case (null, ?_) #greater; case _ Text.compare(a.workCode, b.workCode) };
  };
  // Hoe langer het wacht, hoe eerder: sorteert op dagen aflopend.
  func byAge(a : BV.BrItem, b : BV.BrItem) : Order.Order {
    switch (a.days, b.days) { case (?x, ?y) Int.compare(y, x); case (?_, null) #less; case (null, ?_) #greater; case _ Text.compare(a.workCode, b.workCode) };
  };
  func section(key : Text, title : Text, xs : [BV.BrItem], cmp : (BV.BrItem, BV.BrItem) -> Order.Order) : BV.BrSection {
    let sorted = xs.sort(cmp);
    { key; title; total = xs.size(); items = Array.tabulate<BV.BrItem>(Nat.min(sorted.size(), Config.brMaxItems), func i = sorted[i]) };
  };

  func planWeek(c : Ctx, visible : Nat -> Bool, monday : Nat, sunday : Nat) : BV.BrSection {
    let cals = Map.empty<Nat, Plan.Cal>();
    let perWork = Map.empty<Nat, (Nat, Nat, Text)>(); // aantal, eerste dag, titels
    var total : Nat = 0;
    for (t in c.plan.tasks.values()) {
      if (t.archivedAt == null and t.status != #done and visible(t.workId)) {
        let cal = switch (cals.get(t.workId)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, t.workId); cals.add(t.workId, x); x } };
        let end = Plan.endDay(cal, t.start, t.workdays);
        if (t.start <= sunday and end >= monday) {
          total += 1;
          let first = Nat.max(t.start, monday);
          switch (perWork.get(t.workId)) {
            case (?(n, f, s)) { perWork.add(t.workId, (n + 1, Nat.min(f, first), if (n < 3) s # ", " # t.title else s)) };
            case null { perWork.add(t.workId, (1, first, t.title)) };
          };
        };
      };
    };
    let xs = List.empty<BV.BrItem>();
    for ((w, (n, f, s)) in perWork.entries()) {
      xs.add(item(c, ?w, n.toText() # (if (n == 1) " taak" else " taken") # " deze week", s, ?f, ?((f : Int) - monday)));
    };
    let sec = section("week", "Planning van de week", xs.toArray(), byDays);
    { sec with total };
  };

  func attention(c : Ctx, visible : Nat -> Bool, today : Nat) : BV.BrSection {
    let xs = List.empty<BV.BrItem>();
    for (i in c.reports.issues.values()) {
      if (i.archivedAt == null and visible(i.workId)) {
        switch (i.status) {
          case (#open) { xs.add(item(c, ?i.workId, "Probleem: " # Text.fromIter(i.text.chars().take(80)), switch (i.delayDays) { case (?d) d.toText() # " werkdagen vertraging"; case null "" }, null, null)) };
          case _ {};
        };
      };
    };
    let cals = Map.empty<Nat, Plan.Cal>();
    for (t in c.plan.tasks.values()) {
      if (t.archivedAt == null and t.status != #done and t.percent < 100 and visible(t.workId)) {
        let cal = switch (cals.get(t.workId)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, t.workId); cals.add(t.workId, x); x } };
        let end = Plan.endDay(cal, t.start, t.workdays);
        if (end < today) { xs.add(item(c, ?t.workId, "Taak te laat: " # t.title, Nat.toText(today - end) # " dagen na het geplande einde", ?end, ?((end : Int) - today))) };
      };
    };
    section("attention", "Vraagt aandacht", xs.toArray(), byDays);
  };

  func proposals(c : Ctx, visible : Nat -> Bool, now : Int) : BV.BrSection {
    let xs = List.empty<BV.BrItem>();
    for (j in c.oaRead.jobs.values()) {
      if (j.status == #proposed and visible(j.workId)) { xs.add(item(c, ?j.workId, "Ingelezen offerte wacht op beslissing", orgName(c, j.orgId), null, ?ageDays(now, j.createdAt))) };
    };
    for (j in c.aiCheck.jobs.values()) {
      if (j.status == #proposed and visible(j.workId)) {
        let what = switch (j.target) { case (#tender _) "Vergelijking van offertes wacht op beslissing"; case (#quote _) "Nalezen van een offerte wacht op beslissing"; case (#other t) t };
        xs.add(item(c, ?j.workId, what, "", null, ?ageDays(now, j.createdAt)));
      };
    };
    for (j in c.invCheck.jobs.values()) {
      if (j.status == #proposed and visible(j.workId)) { xs.add(item(c, ?j.workId, "Factuurcontrole wacht op beslissing", orgName(c, j.orgId), null, ?ageDays(now, j.createdAt))) };
    };
    section("proposals", "Open voorstellen van bots", xs.toArray(), byAge);
  };

  func expiring(c : Ctx, visible : Nat -> Bool, docOk : Types.Document -> Bool, general : Bool, today : Nat) : BV.BrSection {
    let xs = List.empty<BV.BrItem>();
    for (x in c.permits.permits.values()) {
      if (x.archivedAt == null and x.status != #cancelled and visible(x.workId)) {
        let (from, to) = Permits.needed(c.plan, c.works, x);
        let ws = Permits.warnings(c.settings, x, from, to, today);
        if (ws.size() > 0) {
          let w = ws[0];
          let days : ?Int = switch w { case (#deadlineSoon d) ?d; case (#deadlinePassed d) ?(-d); case (#expiresSoon d) ?d; case (#expired) ?(-1); case _ null };
          xs.add(item(c, ?x.workId, "Vergunning: " # x.title, Permits.warningText(w), x.validTo, days));
        };
      };
    };
    for (i in c.siteAdmin.insurances.values()) {
      if (i.archivedAt == null) {
        let wOk = switch (i.workId) { case (?w) visible(w); case null general };
        switch (i.periodTo) {
          case (?end) {
            if (wOk and end <= today + warnAhead and (switch (i.status) { case (#notNeeded _) false; case _ true })) {
              xs.add(item(c, i.workId, "Verzekering: " # SiteAdmin.kindName(i.kind), if (end < today) "verlopen" else "loopt af", ?end, ?((end : Int) - today)));
            };
          };
          case null {};
        };
        // Aangifte nog te doen en de uiterste dag nadert of is voorbij.
        switch (i.status, i.declareBy) {
          case (#toDeclare, ?d) {
            if (wOk and d <= today + 14) { xs.add(item(c, i.workId, "Verzekering aangeven: " # SiteAdmin.kindName(i.kind), "uiterste aangifte", ?d, ?((d : Int) - today))) };
          };
          case _ {};
        };
      };
    };
    for (d in c.dossier.documents.values()) {
      if (d.archivedAt == null and d.status != #notApplicable and visible(d.workId) and docOk(d)) {
        switch (d.validUntil) {
          case (?end) { if (end <= today + warnAhead) { xs.add(item(c, ?d.workId, "Document: " # d.title, if (end < today) "verlopen" else "loopt af", ?end, ?((end : Int) - today))) } };
          case null {};
        };
      };
    };
    section("expiring", "Vervallende attesten, vergunningen en verzekeringen", xs.toArray(), byDays);
  };

  func invoices(c : Ctx, visible : Nat -> Bool, now : Int) : BV.BrSection {
    let xs = List.empty<BV.BrItem>();
    for (p in c.purchases.purchases.values()) {
      if ((p.status == #registered or p.status == #checking) and p.creditOf == null) {
        let works = List.empty<Nat>();
        switch (Purchase.amountsOf(c.purchases, p.id)) {
          case (?a) { for (w in Purchase.worksOf(a).values()) { if (visible(w)) { works.add(w) } } };
          case null {};
        };
        if (works.size() > 0) {
          let codes = works.toArray().map(func(w : Nat) : Text = code(c, w));
          let first : ?Nat = ?works.at(0);
          xs.add(item(c, first, "Factuur " # p.number # " te beslissen", orgName(c, p.orgId) # " · " # Text.join(codes.values(), ", "), p.dueDay, ?ageDays(now, p.createdAt)));
        };
      };
    };
    section("invoices", "Facturen van onderaannemers en leveranciers te beslissen", xs.toArray(), byAge);
  };

  func clients(c : Ctx, visible : Nat -> Bool, now : Int) : BV.BrSection {
    let xs = List.empty<BV.BrItem>();
    for (v in c.quotes.versions.values()) {
      if (v.status == #sent) {
        switch (c.quotes.quotes.get(v.quoteId), v.sent) {
          case (?q, ?s) { if (q.archivedAt == null and visible(q.workId)) { xs.add(item(c, ?q.workId, "Offerte " # q.number # " wacht op akkoord van de klant", "", null, ?ageDays(now, s.at))) } };
          case _ {};
        };
      };
    };
    for (v in c.minMeer.versions.values()) {
      switch (v.share) {
        case (?s) { if (visible(v.workId) and not c.minMeer.answers.containsKey(v.id)) { xs.add(item(c, ?v.workId, "Min-meerstaat " # v.number.toText() # " wacht op antwoord van de klant", "", null, ?ageDays(now, s.at))) } };
        case null {};
      };
    };
    section("clients", "Openstaande klantakkoorden", xs.toArray(), byAge);
  };

  // `visible`: de werven die de lezer mag zien (admin: alle niet-gearchiveerde, niet-geannuleerde werven); `docOk`: de documenten die hij
  // mag kennen (een bot: enkel niet-vertrouwelijke soorten op zijn fiche); `general`: ook verzekeringen zonder werf (enkel de beheerder).
  public func build(c : Ctx, visible : Nat -> Bool, docOk : Types.Document -> Bool, general : Bool, now : Int) : BV.BriefingView {
    let today = Int.abs(now / Config.day);
    let monday : Nat = today - Plan.weekday(today);
    let sunday = monday + 6;
    {
      day = today;
      monday;
      sunday;
      sections = [planWeek(c, visible, monday, sunday), attention(c, visible, today), proposals(c, visible, now), expiring(c, visible, docOk, general, today), invoices(c, visible, now), clients(c, visible, now)];
    };
  };
};
