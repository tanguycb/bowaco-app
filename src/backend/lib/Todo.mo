// Te doen (stap 4b.1, bouwplan §9 fase 4b, optiedocument richting A): één lijst per persoon met alles wat op HEM wacht. Ze bundelt
// wat vroeger verspreid stond: de bel (meldingen), Vraagt aandacht (planning, problemen, vergunningen, werfverslag, werfstart,
// koppelingen), de start van de calculator (aanvragen zonder offerte), de maandagbriefing (facturen te beslissen, klantakkoorden,
// vervallende attesten en verzekeringen) en de voorstellen van assistenten (3.4–3.11). Externen krijgen hun eigen regels (een OA:
// bevestigen en prijsvragen; een klant: offerte en min-meerstaat die op zijn akkoord wachten).
//
// Rechten: elke bron vraagt PER REGEL hetzelfde recht als het scherm of de lijst waar ze vandaan komt (Rights.may en de scopes), en
// enkel de rol die er iets mee moet doen krijgt de regel (een calculator geen late taak, een werfleider geen factuur te beslissen).
// GEEN bedragen en geen uitkomst van een voorstel (vertrouwelijk, R38/R44: enkel via de bestaande update-calls met auditregel).
// Vrije tekst van een assistent (reden) is onbetrouwbaar: enkel getoond, ingekort.
// Kost: één doorloop per Map, per bron hoogstens Config.todoMaxPerSource regels; de rechten per werf één keer per werf (cache).
// Vooruit: elke regel heeft een stabiele sleutel en `ref` (bron, nummer); 4b.5 en 4b.8 (leestool `te_doen`) bouwen daarop.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Types "../types";
import TV "../types/todoviews";
import Board "Board";
import Config "Config";
import Permits "Permits";
import Plan "Plan";
import Tasks "Tasks";
import Purchase "Purchase";
import Reports "Reports";
import MinMeer "MinMeer";
import Rights "Rights";

module {
  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    works : Types.WorksState;
    plan : Types.PlanState;
    board : Types.BoardState;
    reports : Types.ReportState;
    permits : Types.PermitState;
    quotes : Types.QuotesState;
    quoteDocs : Types.QuoteDocsState;
    workStarts : Types.WorkStartState;
    minMeer : Types.MinMeerState;
    oaInvoices : Types.OaInvoiceState;
    purchases : Types.PurchaseState;
    oaDeals : Types.OaDealState;
    siteAdmin : Types.SiteAdminState;
    tenders : Types.TenderState;
    oaRead : Types.OaReadState;
    aiCheck : Types.AiCheckState;
    invCheck : Types.InvCheckState;
    bots : Types.BotState;
    audit : Types.AuditState;
    todo : Types.TodoState;
    tasks : Types.TaskStore; // 4b.5: de voorstellen van assistenten komen uit het model van taak en voorstel
  };

  // De rechten van de lezer op één werf, één keer berekend (Rights.may doorloopt de lidmaatschappen).
  type Perm = {
    see : Bool;
    editPlanning : Bool;
    handleIssues : Bool;
    writeReport : Bool;
    editPermits : Bool;
    startWork : Bool;
    office : Bool; // offertes maken en de offertes van de werf zien (admin, calculator)
    tenderFull : Bool; // prijsvragen en OA-offertes volledig (kantoor): inlezen, vergelijken
    oaInvFull : Bool; // OA-facturen volledig (kantoor)
    hourClaims : Bool;
    confirmOwn : Bool; // een OA bevestigt zijn eigen toewijzingen
    clientQuote : Bool;
    editSiteAdmin : Bool;
    editMinMeer : Bool;
  };

  func rctx(c : Ctx) : Rights.Ctx { { works = c.works; settings = c.settings } };

  func code(c : Ctx, w : Nat) : Text { switch (c.works.works.get(w)) { case (?x) x.code; case null "" } };
  func orgName(c : Ctx, o : Nat) : Text { switch (c.org.orgs.get(o)) { case (?x) x.name; case null "" } };
  func liveWork(c : Ctx, w : Nat) : Bool {
    switch (c.works.works.get(w)) { case (?x) x.archivedAt == null and x.status != #cancelled; case null false };
  };
  func ageOf(now : Int, at : Int) : Nat { if (now <= at) 0 else Int.abs((now - at) / Config.day) };
  func short(t : Text, n : Nat) : Text {
    if (t.size() <= n) t else Text.fromIter(t.chars().take(n)) # "…";
  };
  // Een stuk tekst als deel van een sleutel: enkel letters, cijfers en '-' (een soort van melding kan een spatie dragen; review M5).
  func slug(t : Text) : Text {
    var out = "";
    for (ch in t.chars()) { out := out # (if ((ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z') or (ch >= '0' and ch <= '9') or ch == '-') Text.fromChar(ch) else "_") };
    if (out.size() <= 40) out else Text.fromIter(out.chars().take(40));
  };

  // dd/mm voor in een detailregel.
  func dm(d : Nat) : Text { Plan.fmtDay(d) };

  // Dringendheid volgens een dag: voorbij = 0, vandaag of morgen = 1, binnen 7 dagen = 2, later = 3.
  func dueUrg(day : Nat, today : Nat) : Nat {
    if (day < today) 0 else if (day <= today + 1) 1 else if (day <= today + 7) 2 else 3;
  };

  func act(kind : Text, name : Text, to : Text, refs : [Nat]) : TV.TodoAct { { kind; text = name; to; refs; refText = "" } };
  func open(name : Text, to : Text) : TV.TodoAct { act("open", name, to, []) };

  // Een regel; `workId` vult de werfcode zelf in.
  func row(c : Ctx, key : Text, kind : Text, sub : Text, urgency : Nat, day : ?Nat, age : Nat, workId : ?Nat, title : Text, detail : Text, to : Text, acts : [TV.TodoAct], ref : (Text, Nat), by : Text) : TV.TodoItem {
    {
      key;
      kind;
      sub;
      urgency;
      day;
      age;
      workId;
      workCode = switch workId { case (?w) code(c, w); case null "" };
      title;
      detail;
      to;
      acts;
      ref;
      by;
      snoozedUntil = null;
    };
  };

  // De naam van een assistent op het scherm: de taak + "assistent" (eigenaar 10-11; nooit de leverancier of het model).
  public func assistantName(task : Text) : Text {
    let t = switch task {
      case "inlezen" "Offerte inlezen";
      case "vergelijken" "Offertes vergelijken";
      case "nalezen" "Offerte nalezen";
      case "factuurcontrole" "Factuurcontrole";
      case "documenten" "Documenten koppelen";
      case "vrije taken" "Vrije taken";
      case _ task;
    };
    t # " (assistent)";
  };
  func botTaskName(task : Text) : Text {
    // De taken van Config.botTasks (3.4) naar de woorden van het scherm.
    if (task == "vrije-taak") "vrije taken" else if (Text.contains(task, #text "document")) "documenten" else if (Text.contains(task, #text "factuur")) "factuurcontrole" else if (Text.contains(task, #text "inlees") or Text.contains(task, #text "inlezen")) "inlezen" else task;
  };

  // Een begrensde verzameling per bron: telt wat erboven valt (capped).
  type Sink = { out : List.List<TV.TodoItem>; var n : Nat; var capped : Bool };
  func push(s : Sink, x : TV.TodoItem) {
    if (s.n >= Config.todoMaxPerSource) { s.capped := true; return };
    s.n += 1;
    s.out.add(x);
  };

  // ── De lijst ────────────────────────────────────────────────────────────
  // Alle regels voor persoon p op dag `today` (nog niet gefilterd op uitstel). Volgorde: dringendheid, dag, ouderdom, sleutel.
  public func build(c : Ctx, p : Types.Person, today : Nat, now : Int) : ([TV.TodoItem], Bool) {
    let ctx = rctx(c);
    let may = func(a : Rights.Action) : Bool { Rights.may(ctx, p, a, null) };
    let perms = Map.empty<Nat, Perm>();
    let cand = Rights.candidateWorks(ctx, p); // voorfilter: een werf zonder lidmaatschap kost geen doorloop van alle lidmaatschappen
    let perm = func(w : Nat) : Perm {
      switch (perms.get(w)) {
        case (?x) x;
        case null {
          let maybe = switch cand { case (?m) m.containsKey(w); case null true };
          let see = maybe and liveWork(c, w) and Rights.seesWork(ctx, p, w);
          let m = func(a : Rights.Action) : Bool { see and Rights.may(ctx, p, a, ?w) };
          let x : Perm = {
            see;
            editPlanning = m(#editPlanning);
            handleIssues = m(#handleIssues);
            writeReport = m(#writeReport);
            editPermits = m(#editPermits);
            startWork = m(#startWork);
            office = see and Rights.may(ctx, p, #editQuote, null) and Rights.may(ctx, p, #readQuotes, ?w);
            tenderFull = see and Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null) and Rights.tenderScope(ctx, p, w) == #full;
            oaInvFull = see and Rights.oaInvoiceScope(ctx, p, w) == #full;
            hourClaims = m(#confirmHourClaims);
            confirmOwn = m(#confirmOwnAssignment);
            clientQuote = m(#clientQuote);
            editSiteAdmin = m(#editSiteAdmin);
            editMinMeer = see and Rights.may(ctx, p, #editMinMeer, null) and Rights.may(ctx, p, #readMinMeer, ?w);
          };
          perms.add(w, x);
          x;
        };
      };
    };
    let s : Sink = { out = List.empty<TV.TodoItem>(); var n = 0; var capped = false };
    // De grens geldt per bron: na elke bron de teller terug op 0 (capped blijft staan).
    let flush = func() { s.n := 0 };

    notes(c, p, now, perm, s);
    flush();
    if (may(#confirmLinks)) { links(c, p, now, s); flush() };
    if (Rights.internal(p)) {
      myTasks(c, p, today, now, s);
      flush();
      planning(c, today, perm, s);
      flush();
      if (may(#manageAbsences)) { boardConflicts(c, p, today, s); flush() };
      issues(c, now, perm, s);
      flush();
      if (may(#permitsOverview)) { permitWarnings(c, today, perm, s); flush() };
      if (may(#reportWriter)) { missingReports(c, today, perm, s); flush() };
      if (may(#startWorkAny)) { workStarts(c, now, perm, s); flush() };
      if (may(#editQuote)) { requests(c, now, perm, s); flush(); clientWaits(c, now, perm, s); flush() };
      invoices(c, today, now, perm, may(#editPurchases), s);
      flush();
      if (may(#confirmHourClaims)) { hourClaims(c, now, perm, s); flush() };
      if (may(#editDeals)) { orgDocs(c, today, now, s); flush() };
      insurances(c, today, perm, may(#editSiteAdmin), s);
      flush();
      proposals(c, now, perm, may(#manageBots), s);
      flush();
    };
    if (may(#ownTenders) or Rights.hasRole(p, #onderaannemer)) { oaOwn(c, p, today, now, perm, s); flush() };
    if (may(#ownQuotes)) { clientOwn(c, p, now, perm, s); flush() };
    if (may(#clientMinMeer)) { clientMinMeer(c, p, now, s); flush() };

    let sorted = s.out.toArray().sort(compare);
    (sorted, s.capped);
  };

  public func compare(a : TV.TodoItem, b : TV.TodoItem) : Order.Order {
    if (a.urgency != b.urgency) return Nat.compare(a.urgency, b.urgency);
    switch (a.day, b.day) {
      case (?x, ?y) { if (x != y) return Nat.compare(x, y) };
      case (?_, null) return #less;
      case (null, ?_) return #greater;
      case _ {};
    };
    if (a.age != b.age) return Nat.compare(b.age, a.age);
    Text.compare(a.key, b.key);
  };

  // ── Meldingen (de bel; R18: enkel de eigen) ─────────────────────────────
  // Ongelezen meldingen gebundeld per soort en werf: één regel met het aantal en de knop Gelezen (alle meldingen van die bundel).
  func notes(c : Ctx, p : Types.Person, now : Int, perm : Nat -> Perm, s : Sink) {
    let groups = Map.empty<Text, (Types.Notification, Nat, List.List<Nat>)>(); // sleutel → (nieuwste, aantal, ids)
    var seen = 0;
    label scan for ((_, n) in c.audit.notifications.reverseEntries()) {
      if (n.personId == p.id and n.readAt == null) {
        seen += 1;
        if (seen > Config.todoMaxPerSource) { s.capped := true; break scan };
        let k = slug(n.kind) # ":" # (switch (n.workId) { case (?w) w.toText(); case null "0" });
        switch (groups.get(k)) {
          case (?(first, cnt, ids)) { if (ids.size() < Config.maxNotificationIds) { ids.add(n.id) }; groups.add(k, (first, cnt + 1, ids)) };
          case null { let ids = List.empty<Nat>(); ids.add(n.id); groups.add(k, (n, 1, ids)) };
        };
      };
    };
    for ((k, (n, cnt, ids)) in groups.entries()) {
      let detail = if (cnt > 1) "en " # (cnt - 1 : Nat).toText() # (if (cnt == 2) " andere melding" else " andere meldingen") else "";
      // De sleutel draagt de nieuwste melding: een nieuwe melding van dezelfde soort doorbreekt een uitstel (review L6).
      // De werf enkel als de lezer ze nog ziet (review L7: een beëindigd lidmaatschap toont geen werfcode meer).
      let w : ?Nat = switch (n.workId) { case (?x) { if (perm(x).see) ?x else null }; case null null };
      push(s, row(c, "note:" # k # ":" # n.id.toText(), "melding", n.kind, 3, null, ageOf(now, n.createdAt), w, n.text, detail, "", [act("gelezen", "Gelezen", "", ids.toArray())], ("melding", n.id), ""));
    };
  };

  // ── Koppelingen die wachten op bevestiging (enkel de beheerder; niet de eigen: die kan hij niet bevestigen) ──
  func links(c : Ctx, p : Types.Person, now : Int, s : Sink) {
    for ((pr, l) in c.access.links.entries()) {
      if (l.status == #pending and l.personId != p.id) {
        let name = switch (c.access.persons.get(l.personId)) { case (?x) x.name; case null "" };
        let a : TV.TodoAct = { kind = "koppeling-bevestigen"; text = "Bevestigen"; to = ""; refs = []; refText = Principal.toText(pr) };
        push(s, row(c, "link:" # Principal.toText(pr), "koppeling", "", 1, null, ageOf(now, l.linkedAt), null, name, "Nieuwe login · code …" # l.codeHint, "team", [a], ("persoon", l.personId), ""));
      };
    };
  };

  // ── Planning: taken te laat (per werf) en een OA die niet kan ──────────
  // Enkel wie de planning van die werf beheert (admin, werfleider).
  func planning(c : Ctx, today : Nat, perm : Nat -> Perm, s : Sink) {
    let cals = Map.empty<Nat, Plan.Cal>();
    let calOf = func(w : Nat) : Plan.Cal {
      switch (cals.get(w)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, w); cals.add(w, x); x } };
    };
    let late = Map.empty<Nat, (Nat, Nat, Text, Nat, Nat)>(); // werf → (aantal, ergste werkdagen, titel, taak, einde)
    let ends = Map.empty<Nat, Nat>();
    for (t in c.plan.tasks.values()) {
      if (t.archivedAt == null and perm(t.workId).editPlanning) {
        let cal = calOf(t.workId);
        let end = Plan.endDay(cal, t.start, t.workdays);
        ends.add(t.id, end);
        if (t.status != #done and end < today and t.kind != #milestone) {
          let gap = Plan.workdayDiff(cal, end, today);
          let d : Nat = if (gap > 1) Int.abs(gap) - 1 else 0;
          switch (late.get(t.workId)) {
            case (?(n, worst, title, id, e)) { if (d > worst) { late.add(t.workId, (n + 1, d, t.title, t.id, end)) } else { late.add(t.workId, (n + 1, worst, title, id, e)) } };
            case null { late.add(t.workId, (1, d, t.title, t.id, end)) };
          };
        };
      };
    };
    for ((w, (n, worst, title, id, e)) in late.entries()) {
      let what = if (n == 1) title else n.toText() # " taken te laat";
      let detail = (if (n == 1) "" else "ergste: " # title # " · ") # worst.toText() # (if (worst == 1) " werkdag" else " werkdagen") # " na het geplande einde";
      push(s, row(c, "late:" # w.toText() # ":" # id.toText(), "vertraagd", "", 0, ?e, 0, ?w, what, detail, "werven/" # w.toText() # "/planning?taak=" # id.toText(), [open("Verschuiven", "werven/" # w.toText() # "/planning?taak=" # id.toText())], ("werf", w), ""));
    };
    for (a in c.plan.assignments.values()) {
      if (a.archivedAt == null and perm(a.workId).editPlanning) {
        switch (a.confirmation, c.plan.tasks.get(a.taskId), ends.get(a.taskId)) {
          case (#declined d, ?t, ?end) {
            if (t.archivedAt == null and t.status != #done and end >= today) {
              let (st, _) = Plan.assignmentDays(a, t.start, end);
              let to = "werven/" # a.workId.toText() # "/planning?taak=" # t.id.toText();
              push(s, row(c, "decl:" # a.id.toText(), "oa", "kan-niet", 0, ?st, 0, ?a.workId, orgName(c, a.orgId) # " kan niet", t.title # " · " # dm(st) # (if (d.reason != "") " · " # short(d.reason, 80) else ""), to, [open("Verschuiven", to)], ("toewijzing", a.id), ""));
            };
          };
          case _ {};
        };
      };
    };
  };

  // ── Weekbord: dubbel geboekt, afwezig, geblokkeerd (6 weken, zoals Vraagt aandacht) ──
  func boardConflicts(c : Ctx, p : Types.Person, today : Nat, s : Sink) {
    let ctx = rctx(c);
    let from = Board.monday(today);
    let weeks = Config.todoBoardWeeks;
    let to = from + 7 * weeks - 1;
    let see = func(w : Types.Work) : ?Bool { ?(Rights.planScope(ctx, p, w.id) == #full) };
    let keep = func(_ : Nat) : Bool { true };
    let src = { plan = c.plan; works = c.works; board = c.board; settings = c.settings };
    let occByOrg = Board.collect(src, from, to, keep, see);
    let absByOrg = Board.absencesIn(c.board, from, to, keep);
    let unit = Board.unit(c.settings);
    let ids = Map.empty<Nat, ()>();
    for (k in occByOrg.keys()) { ids.add(k, ()) };
    for (k in absByOrg.keys()) { ids.add(k, ()) };
    for (id in ids.keys()) {
      switch (c.org.orgs.get(id)) {
        case (?o) {
          let occs = switch (occByOrg.get(id)) { case (?l) l.toArray(); case null [] };
          let abs = switch (absByOrg.get(id)) { case (?l) l.toArray(); case null [] };
          let (m, srcText) = Board.capacityOf(c.board, c.settings, o);
          let facts : Board.OrgFacts = { org = o; code = Board.orgCode(o); maxWorks = m; maxFrom = srcText };
          let (cs, _) = Board.conflicts(facts, occs, abs, unit, from, weeks);
          for (cf in Board.sortConflicts(cs).values()) {
            let firstDay = if (cf.days.size() > 0) cf.days[0] else cf.week;
            let workId : ?Nat = switch (cf.works.find(func((w, _) : (?Nat, Text)) : Bool = w != null)) { case (?(w, _)) w; case null null };
            let urg = if (cf.week <= from) 1 else if (cf.week <= from + 7) 2 else 3;
            let title = switch (cf.orgCode) { case (?x) x; case null cf.orgName };
            let pre = if (cf.kind == "blokkering") "Geblokkeerd: " else "";
            let to = "weekbord?w=" # cf.week.toText() # "&org=" # cf.orgId.toText();
            push(s, row(c, "board:" # cf.kind # ":" # cf.orgId.toText() # ":" # firstDay.toText() # ":" # cf.days.size().toText(), if (cf.kind == "afwezig") "oa" else "dubbel", cf.kind, urg, ?cf.week, 0, workId, title, pre # cf.text # " · week van " # dm(cf.week), to, [open("Weekbord", to)], ("firma", cf.orgId), ""));
          };
        };
        case null {};
      };
    };
  };

  // ── Open problemen (werfverslag): wie ze afhandelt (admin, werfleider van de werf) ──
  func issues(c : Ctx, now : Int, perm : Nat -> Perm, s : Sink) {
    for (i in c.reports.issues.values()) {
      if (i.archivedAt == null and i.status == #open and perm(i.workId).handleIssues) {
        let kind = switch (i.kind) { case (#problem) "Probleem"; case (#delay) "Vertraging"; case (#extraWorkProposal) "Voorstel meerwerk"; case (#safety) "Veiligheid"; case (#other) "Melding" };
        let urg = switch (i.kind) { case (#delay or #safety) 0; case _ 1 };
        let extra = switch (i.delayDays) { case (?d) " +" # d.toText() # " wd"; case null "" };
        let to = "werven/" # i.workId.toText() # "/verslagen";
        push(s, row(c, "issue:" # i.id.toText(), "probleem", "", urg, null, ageOf(now, i.createdAt), ?i.workId, kind # extra, short(i.text, 120), to, [open("Afhandelen", to)], ("probleem", i.id), ""));
      };
    };
  };

  // ── Vergunningen die aandacht vragen (admin, werfleider van de werf) ────
  func permitWarnings(c : Ctx, today : Nat, perm : Nat -> Perm, s : Sink) {
    for (x in c.permits.permits.values()) {
      if (x.archivedAt == null and x.status != #cancelled and perm(x.workId).editPermits) {
        let (from, to) = Permits.needed(c.plan, c.works, x);
        // De ergste waarschuwing die echt om een handeling vraagt (zonder datums of zonder document: in Vergunningen).
        var best : ?(Nat, Text, ?Nat) = null;
        for (w in Permits.warnings(c.settings, x, from, to, today).values()) {
          let u : ?(Nat, ?Nat) = switch w {
            case (#deadlinePassed _) ?(0, null);
            case (#expired) ?(0, x.validTo);
            case (#refused) ?(0, null);
            case (#deadlineSoon d) { let dd : Nat = if (d < 0) 0 else Int.abs(d); ?(if (dd <= 1) 1 else if (dd <= 7) 2 else 3, ?(today + dd)) };
            case (#expiresSoon d) { let dd : Nat = if (d < 0) 0 else Int.abs(d); ?(if (dd <= 1) 1 else if (dd <= 7) 2 else 3, ?(today + dd)) };
            case (#outsidePlan _) ?(1, null);
            case _ null;
          };
          switch (u, best) {
            case (?(n, d), null) { best := ?(n, Permits.warningText(w), d) };
            case (?(n, d), ?(b, _, _)) { if (n < b) { best := ?(n, Permits.warningText(w), d) } };
            case _ {};
          };
        };
        switch best {
          case (?(u, text, d)) {
            let to = "werven/" # x.workId.toText() # "/vergunningen";
            push(s, row(c, "permit:" # x.id.toText(), "vergunning", "", u, d, 0, ?x.workId, if (x.title != "") x.title else "Vergunning", text, to, [open("Bekijken", to)], ("vergunning", x.id), ""));
          };
          case null {};
        };
      };
    };
  };

  // ── Werfverslag van de vorige werkdag ontbreekt (wie verslagen schrijft) ──
  func missingReports(c : Ctx, today : Nat, perm : Nat -> Perm, s : Sink) {
    let prev : Nat = switch (Plan.weekday(today)) { case 0 today - 3; case 6 today - 2; case _ today - 1 };
    let worked = Map.empty<Nat, ()>();
    let cals = Map.empty<Nat, Plan.Cal>();
    for (t in c.plan.tasks.values()) {
      if (t.archivedAt == null and t.kind == #work and t.start <= prev and not worked.containsKey(t.workId)) {
        switch (c.works.works.get(t.workId)) {
          case (?w) {
            if (w.status == #running and w.archivedAt == null) {
              let cal = switch (cals.get(t.workId)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, t.workId); cals.add(t.workId, x); x } };
              if (Plan.endDay(cal, t.start, t.workdays) >= prev) { worked.add(t.workId, ()) };
            };
          };
          case null {};
        };
      };
    };
    for (w in worked.keys()) {
      if (perm(w).writeReport and not c.reports.dayIndex.containsKey(Reports.dayKey(w, prev))) {
        let to = "verslag/" # w.toText() # "/" # prev.toText();
        push(s, row(c, "report:" # w.toText() # ":" # prev.toText(), "verslag", "", 0, ?prev, 0, ?w, "Geen werfverslag", "voor " # dm(prev), to, [open("Werfverslag", to)], ("werf", w), ""));
      };
    };
  };

  // ── Aanvaarde offerte → werf starten (admin, werfleider van de werf) ────
  // Zelfde regel als WorkStart.isPending: aanvaard, nog niet gestart, geen latere versie gestart.
  func workStarts(c : Ctx, now : Int, perm : Nat -> Perm, s : Sink) {
    // Eén doorloop: per offerte de hoogste versie die al gestart is (review M3).
    let started = Map.empty<Nat, Nat>();
    for (x in c.quotes.versions.values()) {
      if (c.workStarts.starts.containsKey(x.id)) {
        switch (started.get(x.quoteId)) { case (?n) { if (x.version > n) { started.add(x.quoteId, x.version) } }; case null { started.add(x.quoteId, x.version) } };
      };
    };
    for (v in c.quotes.versions.values()) {
      if (v.status == #accepted and not c.workStarts.starts.containsKey(v.id)) {
        switch (c.quotes.quotes.get(v.quoteId)) {
          case (?q) {
            if (q.archivedAt == null and perm(q.workId).startWork) {
              let later = switch (started.get(v.quoteId)) { case (?n) n > v.version; case null false };
              if (not later) {
                let to = "werfstart/" # v.id.toText();
                push(s, row(c, "start:" # v.id.toText(), "werfstart", "", 1, null, ageOf(now, v.updatedAt), ?q.workId, "Offerte " # q.number # " aanvaard", "werf starten: taken, vergunningen en aangifte", to, [open("Werf starten", to)], ("offerteversie", v.id), ""));
              };
            };
          };
          case null {};
        };
      };
    };
  };

  // ── Aanvragen zonder offerte (kantoor: admin, calculator) ──────────────
  func requests(c : Ctx, now : Int, perm : Nat -> Perm, s : Sink) {
    let withQuote = Map.empty<Nat, ()>();
    for (q in c.quotes.quotes.values()) { if (q.archivedAt == null) { withQuote.add(q.workId, ()) } };
    for (w in c.works.works.values()) {
      if (w.archivedAt == null and w.status == #request and not withQuote.containsKey(w.id) and perm(w.id).office) {
        let to = "werven/" # w.id.toText() # "/offerte";
        push(s, row(c, "req:" # w.id.toText(), "aanvraag", "", if (ageOf(now, w.createdAt) > 7) 1 else 2, null, ageOf(now, w.createdAt), ?w.id, w.name, "Aanvraag zonder offerte", to, [open("Offerte maken", to)], ("werf", w.id), ""));
      };
    };
  };

  // Per werf de nieuwste gedeelde versie van de min-meerstaat (een oudere gedeelde versie is voorbijgestreefd; review L8).
  func newestShared(c : Ctx) : Map.Map<Nat, Types.MmVersion> {
    let m = Map.empty<Nat, Types.MmVersion>();
    for (v in c.minMeer.versions.values()) {
      if (v.share != null) {
        switch (m.get(v.workId)) { case (?x) { if (v.number > x.number) { m.add(v.workId, v) } }; case null { m.add(v.workId, v) } };
      };
    };
    m;
  };

  // ── Wacht op de klant: verzonden offertes en gedeelde min-meerstaten (kantoor volgt op) ──
  func clientWaits(c : Ctx, now : Int, perm : Nat -> Perm, s : Sink) {
    for (v in c.quotes.versions.values()) {
      if (v.status == #sent) {
        switch (c.quotes.quotes.get(v.quoteId), v.sent) {
          case (?q, ?sent) {
            if (q.archivedAt == null and perm(q.workId).office) {
              let age = ageOf(now, sent.at);
              let to = "werven/" # q.workId.toText() # "/offerte";
              push(s, row(c, "qsent:" # v.id.toText(), "klant", "offerte", if (age > 14) 2 else 3, null, age, ?q.workId, "Offerte " # q.number # " wacht op akkoord", "verzonden " # age.toText() # (if (age == 1) " dag" else " dagen") # " geleden", to, [open("Bekijken", to)], ("offerteversie", v.id), ""));
            };
          };
          case _ {};
        };
      };
    };
    for (v in newestShared(c).values()) {
      switch (v.share) {
        case (?sh) {
          if (not c.minMeer.answers.containsKey(v.id) and perm(v.workId).editMinMeer) {
            let age = ageOf(now, sh.at);
            let to = "werven/" # v.workId.toText() # "/facturatie/min-meer";
            push(s, row(c, "mmshare:" # v.id.toText(), "klant", "min-meer", if (age > 14) 2 else 3, null, age, ?v.workId, "Min-meerstaat " # v.number.toText() # " wacht op antwoord", "gedeeld " # age.toText() # (if (age == 1) " dag" else " dagen") # " geleden", to, [open("Bekijken", to)], ("min-meer", v.id), ""));
          };
        };
        case null {};
      };
    };
  };

  // ── Facturen te beslissen: OA-facturen per werf (2.11, ook de werfdelen van 2c.7) en leveranciers (2c.7, kantoor) ──
  func invoices(c : Ctx, today : Nat, now : Int, perm : Nat -> Perm, purchasesOk : Bool, s : Sink) {
    for (i in c.oaInvoices.invoices.values()) {
      if (i.status == #registered and perm(i.workId).oaInvFull) {
        let urg = switch (i.dueDay) { case (?d) { if (d < today) 0 else 1 }; case null 1 };
        let to = "oa-facturen/" # i.id.toText();
        push(s, row(c, "oainv:" # i.id.toText(), "factuur", "oa", urg, i.dueDay, ageOf(now, i.createdAt), ?i.workId, "Factuur " # i.number # " te beslissen", orgName(c, i.orgId), to, [open("Beslissen", to)], ("oa-factuur", i.id), ""));
      };
    };
    if (purchasesOk) {
      for (p in c.purchases.purchases.values()) {
        if ((p.status == #registered or p.status == #checking) and p.parts.size() == 0 and p.creditOf == null) {
          let urg = switch (p.dueDay) { case (?d) { if (d < today) 0 else 1 }; case null 1 };
          let to = "oa-facturen/aankoop/" # p.id.toText();
          push(s, row(c, "pur:" # p.id.toText(), "factuur", "aankoop", urg, p.dueDay, ageOf(now, p.createdAt), null, "Factuur " # p.number # " te beslissen", orgName(c, p.orgId), to, [open("Beslissen", to)], ("aankoop", p.id), ""));
        };
      };
    };
  };

  // ── Uren van een OA bevestigen (werfleider van de werf, beheerder): één regel per werf ──
  func hourClaims(c : Ctx, now : Int, perm : Nat -> Perm, s : Sink) {
    let per = Map.empty<Nat, (Nat, Nat, Int)>(); // werf → (dagen, eerste dag, oudste aankoop)
    for (h in c.purchases.claims.values()) {
      // Zoals het scherm Aankoop: de dag is nog open en wordt echt gevraagd ("te bevestigen"; review M1).
      if (h.review == null and perm(h.workId).hourClaims and Purchase.claimOpen(c.purchases, c.oaInvoices, h) and Purchase.claimState(c.settings, c.reports, h) == "te-bevestigen") {
        let at = switch (c.purchases.purchases.get(h.purchaseId)) { case (?x) x.createdAt; case null -1 };
        if (at >= 0) {
          switch (per.get(h.workId)) {
            case (?(n, f, a)) { per.add(h.workId, (n + 1, Nat.min(f, h.day), Int.min(a, at))) };
            case null { per.add(h.workId, (1, h.day, at)) };
          };
        };
      };
    };
    for ((w, (n, f, at)) in per.entries()) {
      let to = "werven/" # w.toText() # "/facturatie/aankoop";
      push(s, row(c, "hours:" # w.toText() # ":" # n.toText(), "uren", "", 1, ?f, ageOf(now, at), ?w, "Uren van onderaannemers nakijken", n.toText() # (if (n == 1) " dag" else " dagen") # " · vanaf " # dm(f), to, [open("Nakijken", to)], ("werf", w), ""));
    };
  };

  // ── Attesten van firma's: te keuren en vervallend (kantoor: #editDeals) ──
  func orgDocs(c : Ctx, today : Nat, now : Int, s : Sink) {
    for (d in c.oaDeals.orgDocs.values()) {
      if (d.archivedAt == null) {
        let to = "adresboek/" # d.orgId.toText();
        let name = if (d.title != "") d.title else d.kind;
        if (d.status == #received) {
          push(s, row(c, "orgdoc:" # d.id.toText(), "attest", "keuren", 1, null, ageOf(now, d.createdAt), null, "Attest te keuren: " # name, orgName(c, d.orgId), to, [open("Keuren", to)], ("attest", d.id), ""));
        } else if (d.status == #approved) {
          switch (d.validUntil) {
            case (?end) {
              if (end <= today + Config.todoWarnAhead) {
                push(s, row(c, "orgdocexp:" # d.id.toText() # ":" # end.toText(), "attest", "vervalt", dueUrg(end, today), ?end, 0, null, "Attest " # (if (end < today) "vervallen: " else "vervalt: ") # name, orgName(c, d.orgId) # " · " # dm(end), to, [open("Bekijken", to)], ("attest", d.id), ""));
              };
            };
            case null {};
          };
        };
      };
    };
  };

  // ── Verzekeringen: aangifte te doen en lopen af (wie de werfadministratie bijhoudt) ──
  func insurances(c : Ctx, today : Nat, perm : Nat -> Perm, general : Bool, s : Sink) {
    for (i in c.siteAdmin.insurances.values()) {
      if (i.archivedAt == null) {
        let ok = switch (i.workId) { case (?w) perm(w).editSiteAdmin; case null general };
        if (ok) {
          let to = switch (i.workId) { case (?w) "werven/" # w.toText() # "/vergunningen"; case null "werfadministratie" };
          switch (i.status, i.declareBy) {
            case (#toDeclare, ?d) {
              if (d <= today + 14) { push(s, row(c, "insdecl:" # i.id.toText(), "vervalt", "verzekering-aangifte", dueUrg(d, today), ?d, 0, i.workId, "Verzekering aangeven", "uiterlijk " # dm(d), to, [open("Bekijken", to)], ("verzekering", i.id), "")) };
            };
            case _ {};
          };
          let active = switch (i.status) { case (#notNeeded _) false; case _ true };
          switch (i.periodTo) {
            case (?end) {
              if (active and end <= today + Config.todoWarnAhead) {
                push(s, row(c, "insexp:" # i.id.toText() # ":" # end.toText(), "vervalt", "verzekering", dueUrg(end, today), ?end, 0, i.workId, if (end < today) "Verzekering verlopen" else "Verzekering loopt af", dm(end), to, [open("Bekijken", to)], ("verzekering", i.id), ""));
              };
            };
            case null {};
          };
        };
      };
    };
  };

  // ── 4b.7: taken van collega's (gewone taken, lib/Tasks.mo giveManual): enkel de uitvoerder; geen bedragen ──
  func myTasks(c : Ctx, p : Types.Person, today : Nat, now : Int, s : Sink) {
    for (t in c.tasks.tasks.values()) {
      if (Tasks.isManual(t) and t.doer == #person(p.id) and (t.state == #waiting or t.state == #busy)) {
        let due = Nat.fromText(Tasks.extraOf(t, "uiterlijk"));
        let by = switch (t.givenBy) { case (#person(g)) (switch (c.access.persons.get(g)) { case (?x) x.name; case null "" }); case _ "" };
        let busy = t.state == #busy;
        let acts = if busy [act("taak-klaar", "Klaar", "", [t.id]), act("taak-kan-niet", "Kan niet", "", [t.id])] else [act("taak-start", "Begin eraan", "", [t.id]), act("taak-klaar", "Klaar", "", [t.id]), act("taak-kan-niet", "Kan niet", "", [t.id])];
        push(s, row(c, t.key, "taak", if busy "bezig" else "wacht", switch due { case (?d) dueUrg(d, today); case null 2 }, due, ageOf(now, t.createdAt), t.workId, Tasks.extraOf(t, "titel"), (if (by != "") "van " # by else "") # (switch due { case (?d) " · uiterlijk " # dm(d); case null "" }), "", acts, ("taak", t.id), ""));
      };
    };
  };

  // ── Voorstellen van assistenten (3.4–3.11): enkel wie ze mag beslissen; geen uitkomst, geen bedrag ──
  // 4b.5: de lijst komt uit het model van taak en voorstel (lib/Tasks.mo): elke taak met haar dossier. De voorwaarde per regel blijft
  // die van het dossier zelf (de opdracht wacht op een beslissing; het voorstel van de bot is onbeslist), zodat Te doen dezelfde
  // regels toont als vóór 4b.5. Volgorde zoals toen: inlezen, nakijken, factuurcontrole, dan de voorstellen van bots (op nummer).
  func proposals(c : Ctx, now : Int, perm : Nat -> Perm, botsOk : Bool, s : Sink) {
    let botOpen = List.empty<(Nat, Types.BotAction)>();
    let botOf = func(t : Types.AssistTask) {
      if (not botsOk) return;
      let aid = switch (Tasks.proposalOf(c.tasks, t)) { case (?p) p.actionId; case null null };
      switch (aid) {
        case (?id) switch (c.bots.actions.get(id)) { case (?a) { if (a.state == #proposed) botOpen.add((id, a)) }; case null {} };
        case null {};
      };
    };
    for (t in Tasks.ofSource(c.tasks, "oaread").values()) {
      switch (t.src) {
        case (#oaRead id) switch (c.oaRead.jobs.get(id)) {
          case (?j) {
            if (j.status == #proposed and perm(j.workId).tenderFull) {
              let to = "werven/" # j.workId.toText() # "/offerte/oa-offertes";
              push(s, row(c, t.key, "voorstel", "inlezen", 1, null, ageOf(now, j.createdAt), ?j.workId, "Ingelezen offerte nakijken", orgName(c, j.orgId), to, [open("Nakijken", to)], ("inleesopdracht", j.id), assistantName("inlezen")));
            };
          };
          case null {};
        };
        case _ {};
      };
      botOf(t);
    };
    for (t in Tasks.ofSource(c.tasks, "check").values()) {
      switch (t.src) {
        case (#aiCheck id) switch (c.aiCheck.jobs.get(id)) {
          case (?j) {
            if (j.status == #proposed) {
              let (ok, task, title, to) = switch (j.target) {
                case (#tender _) (perm(j.workId).tenderFull, "vergelijken", "Vergelijking van offertes nakijken", "werven/" # j.workId.toText() # "/offerte/prijsvragen");
                case (#quote _) (perm(j.workId).office, "nalezen", "Opmerkingen bij de offerte nakijken", "werven/" # j.workId.toText() # "/offerte");
                case (#other _) (false, "", "", "");
              };
              if (ok) { push(s, row(c, t.key, "voorstel", task, 1, null, ageOf(now, j.createdAt), ?j.workId, title, "", to, [open("Nakijken", to)], ("nakijkopdracht", j.id), assistantName(task))) };
            };
          };
          case null {};
        };
        case _ {};
      };
      botOf(t);
    };
    for (t in Tasks.ofSource(c.tasks, "invcheck").values()) {
      switch (t.src) {
        case (#invCheck id) switch (c.invCheck.jobs.get(id)) {
          case (?j) {
            if (j.status == #proposed and perm(j.workId).oaInvFull) {
              let number = switch (c.oaInvoices.invoices.get(j.invoiceId)) { case (?i) i.number; case null "" };
              let to = "oa-facturen/" # j.invoiceId.toText();
              push(s, row(c, t.key, "voorstel", "factuurcontrole", 1, null, ageOf(now, j.createdAt), ?j.workId, "Controle van factuur " # number # " nakijken", orgName(c, j.orgId), to, [open("Nakijken", to)], ("controleopdracht", j.id), assistantName("factuurcontrole")));
            };
          };
          case null {};
        };
        case _ {};
      };
      botOf(t);
    };
    for (t in Tasks.ofSource(c.tasks, "bot").values()) botOf(t);
    // 4b.8: het antwoord van een assistent op een vrije taak (enkel de beheerder gaf die; aanvaarden of weigeren hier).
    for (t in c.tasks.tasks.values()) { if (Tasks.isBotTask(t) and not Tasks.isFinal(t.state)) botOf(t) };
    // Acties van een bot die op de beheerder wachten (3.4: document koppelen, factuurcontrole; ook het voorstel van een bot op een
    // opdracht): aanvaarden of weigeren hier.
    for ((_, a) in botOpen.toArray().sort(func(x : (Nat, Types.BotAction), y : (Nat, Types.BotAction)) : Order.Order = Nat.compare(x.0, y.0)).values()) {
      if (switch (a.workId) { case (?w) liveWork(c, w); case null true }) {
        let task = botTaskName(a.task);
        let title = switch (a.action) {
          case (#docLink d) "Bestand koppelen: " # short(d.title, 60);
          case (#invoiceCheck i) { switch (c.oaInvoices.invoices.get(i.invoiceId)) { case (?x) "Controle van factuur " # x.number; case null "Factuurcontrole" } };
          case (#other o) {
            // 4b.8: een vrije taak: haar omschrijving (door BOWACO geschreven) en de uitkomst; het antwoord staat in het detail.
            let key = switch (o.data.find(func((k, _) : (Text, Text)) : Bool = k == "taak")) { case (?(_, v)) v; case null "" };
            switch (if (o.tool == "voorstel" and key != "") Tasks.byKey(c.tasks, key) else null) {
              case (?t) (if (o.data.any(func((k, v) : (Text, Text)) : Bool = k == "uitkomst" and v == "kan niet")) "Kan niet: " else "Klaar: ") # short(Tasks.extraOf(t, "titel"), 60);
              case null "Voorstel: " # short(o.tool, 40);
            };
          };
        };
        let acts = [act("bot-aanvaarden", "Aanvaarden", "", [a.id]), act("bot-weigeren", "Weigeren", "", [a.id])];
        push(s, row(c, "bot:" # a.id.toText(), "voorstel", task, 1, null, ageOf(now, a.at), a.workId, title, short(a.reason, 120), "beheer/ai", acts, ("botactie", a.id), assistantName(task)));
      };
    };
  };

  // ── Een onderaannemer: dagen bevestigen en prijsvragen beantwoorden ─────
  func oaOwn(c : Ctx, p : Types.Person, today : Nat, now : Int, perm : Nat -> Perm, s : Sink) {
    let own = switch (p.orgId) { case (?o) o; case null return };
    let ctx = rctx(c);
    if (Rights.hasRole(p, #onderaannemer)) {
      let cals = Map.empty<Nat, Plan.Cal>();
      for (a in c.plan.assignments.values()) {
        if (a.archivedAt == null and a.orgId == own and a.confirmation == #open and perm(a.workId).confirmOwn) {
          switch (c.plan.tasks.get(a.taskId)) {
            case (?t) {
              if (t.archivedAt == null and t.status != #done and t.kind == #work) {
                let cal = switch (cals.get(t.workId)) { case (?x) x; case null { let x = Plan.calFor(c.plan, c.works, t.workId); cals.add(t.workId, x); x } };
                let end = Plan.endDay(cal, t.start, t.workdays);
                let (st, en) = Plan.assignmentDays(a, t.start, end);
                if (en >= today and st <= today + Config.todoAhead) {
                  let acts = [act("taak-bevestigen", "Bevestigen", "", [a.id]), open("Naar mijn week", "week")];
                  push(s, row(c, "myconf:" # a.id.toText(), "bevestigen", "", if (st <= today + 2) 1 else 2, ?st, 0, ?a.workId, t.title, dm(st) # (if (en != st) " – " # dm(en) else ""), "week", acts, ("toewijzing", a.id), ""));
                };
              };
            };
            case null {};
          };
        };
      };
    };
    if (Rights.may(ctx, p, #ownTenders, null)) {
      let invites : [Nat] = switch (c.tenders.invitesByOrg.get(own)) { case (?xs) xs; case null [] };
      for (id in invites.values()) {
        switch (c.tenders.invites.get(id)) {
          case (?i) {
            switch (c.tenders.tenders.get(i.tenderId)) {
              case (?t) {
                if ((i.status == #asked or i.status == #reminded) and Rights.mayAnswerInvite(ctx, p, t, i, now, today)) {
                  let deadline = switch (i.ownDeadline) { case (?d) { if (d > t.deadlineDay) d else t.deadlineDay }; case null t.deadlineDay };
                  let to = "prijsvragen/" # i.ref;
                  push(s, row(c, "tender:" # i.id.toText(), "prijsvraag", "", dueUrg(deadline, today), ?deadline, 0, null, "Prijsvraag " # t.code, "antwoord vóór " # dm(deadline), to, [open("Openen", to)], ("uitnodiging", i.id), ""));
                };
              };
              case null {};
            };
          };
          case null {};
        };
      };
    };
  };

  // ── Een klant: een offerte die op zijn akkoord wacht ────────────────────
  func clientOwn(c : Ctx, p : Types.Person, now : Int, perm : Nat -> Perm, s : Sink) {
    for (v in c.quotes.versions.values()) {
      if (v.status == #sent and v.sent != null and c.quoteDocs.sendInfo.containsKey(v.id)) {
        switch (c.quotes.quotes.get(v.quoteId)) {
          case (?q) {
            let mine = switch (v.clientOrgId) { case (?o) p.orgId == ?o; case null true };
            if (q.archivedAt == null and mine and perm(q.workId).clientQuote) {
              let at = switch (v.sent) { case (?x) x.at; case null now };
              let to = "mijn-offerte/" # v.id.toText();
              push(s, row(c, "cq:" # v.id.toText(), "akkoord", "offerte", 1, null, ageOf(now, at), ?q.workId, "Offerte " # q.number # " wacht op je akkoord", "", to, [open("Openen", to)], ("offerteversie", v.id), ""));
            };
          };
          case null {};
        };
      };
    };
  };

  // ── Klant: een gedeelde min-meerstaat die op zijn antwoord wacht (enkel minMeerScope #client; een architect leest mee maar
  // antwoordt niet, dus geen regel). Per werf enkel de nieuwste gedeelde versie zonder antwoord (review L8). ──
  func clientMinMeer(c : Ctx, p : Types.Person, now : Int, s : Sink) {
    let ctx = rctx(c);
    let clientOrg = func(w : Nat) : ?Types.OrgId { switch (c.works.works.get(w)) { case (?x) x.clientOrgId; case null null } };
    let mode = MinMeer.clientMode(c.settings);
    for (v in newestShared(c).values()) {
      switch (v.share) {
        case (?sh) {
          if (not c.minMeer.answers.containsKey(v.id) and mode != "uit" and Rights.minMeerScope(ctx, p, v.workId, clientOrg(v.workId)) == #client) {
            let to = "werven/" # v.workId.toText() # "/facturatie";
            push(s, row(c, "cmm:" # v.id.toText(), "akkoord", "min-meer", 1, null, ageOf(now, sh.at), ?v.workId, "Min-meerstaat " # v.number.toText() # " wacht op je antwoord", "", to, [open("Openen", to)], ("min-meer", v.id), ""));
          };
        };
        case null {};
      };
    };
  };

  // ── Uitstellen ──────────────────────────────────────────────────────────
  // Een sleutel: hoogstens Config.todoMaxKey tekens, enkel letters, cijfers en ':' '-' '_' '.' (de principal van een koppeling, de soort
  // van een melding).
  public func validKey(k : Text) : Bool {
    if (k.size() == 0 or k.size() > Config.todoMaxKey) return false;
    for (ch in k.chars()) {
      if (not ((ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z') or (ch >= '0' and ch <= '9') or ch == ':' or ch == '-' or ch == '_' or ch == '.')) return false;
    };
    true;
  };

  public func snoozesOf(t : Types.TodoState, personId : Nat) : Map.Map<Text, Nat> {
    switch (t.snoozes.get(personId)) { case (?m) m; case null Map.empty<Text, Nat>() };
  };

  // Zet (until = ?dag) of wis (null) het uitstel; ruimt verlopen uitstel van die persoon op. #err bij een te volle lijst.
  public func snooze(t : Types.TodoState, personId : Nat, key : Text, until : ?Nat, today : Nat) : { #ok; #err : Text } {
    let m = switch (t.snoozes.get(personId)) { case (?m) m; case null { let m = Map.empty<Text, Nat>(); t.snoozes.add(personId, m); m } };
    let old = List.empty<Text>();
    for ((k, d) in m.entries()) { if (d <= today) { old.add(k) } };
    for (k in old.values()) { m.remove(k) };
    switch until {
      case null { m.remove(key) };
      case (?d) {
        if (not m.containsKey(key) and m.size() >= Config.todoMaxSnoozes) { return #err("Hoogstens " # Config.todoMaxSnoozes.toText() # " regels uitgesteld") };
        m.add(key, d);
      };
    };
    if (m.isEmpty()) { t.snoozes.remove(personId) };
    #ok;
  };

  // De pagina: filter op uitstel en soort, tellers over de hele lijst.
  public func page(items : [TV.TodoItem], capped : Bool, snoozes : Map.Map<Text, Nat>, q : TV.TodoQuery) : TV.TodoPage {
    let main = List.empty<TV.TodoItem>();
    let later = List.empty<TV.TodoItem>();
    for (x in items.values()) {
      switch (snoozes.get(x.key)) {
        case (?d) { if (d > q.day) { later.add({ x with snoozedUntil = ?d }) } else { main.add(x) } };
        case null { main.add(x) };
      };
    };
    let base = if (q.snoozed) later.toArray() else main.toArray();
    let kinds = Map.empty<Text, Nat>();
    var urgent = 0;
    for (x in base.values()) {
      kinds.add(x.kind, switch (kinds.get(x.kind)) { case (?n) n + 1; case null 1 });
      if (x.urgency <= 1) { urgent += 1 };
    };
    let list = if (q.kind == "") base else base.filter(func(x : TV.TodoItem) : Bool = x.kind == q.kind);
    let lim = if (q.limit == 0 or q.limit > Config.todoMaxPage) Config.todoMaxPage else q.limit;
    let from = Nat.min(q.offset, list.size());
    let to = Nat.min(from + lim, list.size());
    {
      day = q.day;
      total = list.size();
      urgent;
      snoozed = later.size();
      kinds = kinds.entries().toArray();
      items = list.sliceToArray(from, to);
      capped;
    };
  };
};
