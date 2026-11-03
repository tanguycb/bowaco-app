// De stand van de werf (stap 2b.3, bouwplan rij 2b.3 en BOWACO_prototype_2b.md vraag 14): per werf de momenten die de
// stappenbalk nodig heeft (offerte verstuurd, akkoord, werf gestart, eerste verslag, eindopmeting, slotstaat) en een paar
// vlaggen voor de kaart "Volgende stap". Niets bewaard en geen nieuw veld: alles volgt uit wat er al is. De FASE zelf
// rekent de browser (app/fase.ts), zodat de regels (VOORLOPIG tot Alexis antwoordt) op één plaats aan te passen zijn.
// Rechten: dezelfde werven als listWorks (#readWork, R3). Enkel momenten, tellingen en vlaggen: geen bedrag, geen naam,
// geen inhoud van een offerte of staat. Kantoor (interne rollen) krijgt alles; de klant van de werf de momenten die hij
// toch ziet (offerte, akkoord, start, verslag, opmeting, staten) maar niets intern (ontwerp, open opmeting, aantal taken);
// een architect, OA of VC krijgt een lege stand (zijn rechten op offertes en staten gaan niet verder, review 2b.3).
// Begrensd (T17): één doorloop per Map, dan per werf enkel opzoekingen.
// Deel A van de open punten (2c.2–2c.8): `next` (Views.NextFacts) = wat de kaart Volgende stap nog kent: prijsvraag, contract, attesten,
// uren, verzekering, schijf of vervallen factuur. Enkel tellingen en dagen, nooit een bedrag. Per recht gefilterd (prijsvragen en
// facturen enkel kantoor met de bedragen; de rest wie dat deel van de werf ziet); de OA en de klant krijgen niets. Bestaande indexen
// (byWork) en twee doorlopen (verzekeringen, uren), geen scan per werf.
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import OaDeals "../lib/OaDeals";
import OaQuotes "../lib/OaQuotes";
import Post "../lib/Post";
import Progress "../lib/Progress";
import Rights "../lib/Rights";
import Sales "../lib/Sales";
import Tenders "../lib/Tenders";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  quoteForms : Types.QuoteFormState,
  quoteDocs : Types.QuoteDocsState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  progress : Types.ProgressState,
  tenders : Types.TenderState,
  oaDeals : Types.OaDealState,
  oaInvoices : Types.OaInvoiceState,
  purchases : Types.PurchaseState,
  siteAdmin : Types.SiteAdminState,
  sales : Types.SalesState,
) {

  public query ({ caller }) func listWorkStages() : async [Views.WorkStageView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let seen = works.works.values().filter(func w = Rights.may(ctx, p, #readWork, ?w.id)).map(func w = w.id).toArray();
    if (seen.size() == 0) { return [] };
    // Eén doorloop over de taken, de verslagen en de werfstarts (geen index per werf).
    let tasks = Map.empty<Nat, Nat>();
    for (t in plan.tasks.values()) {
      if (t.archivedAt == null) { tasks.add(t.workId, (switch (tasks.get(t.workId)) { case (?n) n; case null 0 }) + 1) };
    };
    let firstReport = Map.empty<Nat, Int>();
    for (r in reports.reports.values()) {
      switch (firstReport.get(r.workId)) {
        case (?at) { if (r.createdAt < at) { firstReport.add(r.workId, r.createdAt) } };
        case null { firstReport.add(r.workId, r.createdAt) };
      };
    };
    let started = Map.empty<Nat, Int>();
    let hasStart = Map.empty<Nat, Bool>(); // versie → er is een werfstart of een afgewezen voorstel
    let startedFrom = Map.empty<Nat, [Nat]>(); // werf → versies van een offerte van een ANDERE werf die haar startten (#newWork)
    let mark = func(w : Nat, at : Int) {
      switch (started.get(w)) { case (?x) { if (at < x) { started.add(w, at) } }; case null { started.add(w, at) } };
    };
    for (s in workStarts.starts.values()) {
      hasStart.add(s.versionId, true);
      if (s.status == #started) {
        mark(s.workId, s.at);
        // Een offerte die als NIEUWE werf gestart werd: ook de werf van de offerte is gestart, en de nieuwe werf kreeg haar
        // offerte en akkoord van die versie (anders bleef de bronwerf eeuwig op Akkoord, review 2b.3).
        if (s.workId != s.sourceWorkId) {
          mark(s.sourceWorkId, s.at);
          startedFrom.add(s.workId, (switch (startedFrom.get(s.workId)) { case (?x) x; case null [] }).concat([s.versionId]));
        };
      };
    };
    let internal = Rights.internal(p);
    // Twee doorlopen voor de kaart Volgende stap (enkel voor interne rollen): te bevestigen uren en aan te geven verzekeringen.
    let hours = Map.empty<Nat, Nat>();
    let declare = Map.empty<Nat, Nat>();
    let today = Post.local(Time.now()).day;
    if (internal) {
      for (c in purchases.claims.values()) {
        if (c.review == null and snClaimOpen(c)) { hours.add(c.workId, (switch (hours.get(c.workId)) { case (?n) n; case null 0 }) + 1) };
      };
      for (i in siteAdmin.insurances.values()) {
        switch (i.workId, i.declareBy) {
          case (?w, ?d) {
            if (i.archivedAt == null and i.status == #toDeclare) {
              switch (declare.get(w)) { case (?x) { if (d < x) { declare.add(w, d) } }; case null { declare.add(w, d) } };
            };
          };
          case _ {};
        };
      };
    };
    let officeAmounts = Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null);
    let salesOffice = Rights.may(ctx, p, #editSales, null) and Rights.may(ctx, p, #readCosts, null);
    let orgCache = Map.empty<Nat, (Nat, Nat, ?Nat)>();
    seen.map<Nat, Views.WorkStageView>(func id {
      let st = stageOf(id, tasks, firstReport, started, hasStart, startedFrom);
      if (internal) {
        { st with next = snNext(p, id, st.acceptedAt != null, today, hours, declare, officeAmounts, salesOffice, orgCache) };
      } else if (Rights.may(ctx, p, #clientQuote, ?id)) {
        { st with tasks = 0; surveyOpen = false; progressDraft = false; startPending = false };
      } else {
        { workId = id; quoteSentAt = null; quoteWaiting = false; acceptedAt = null; startedAt = null; startPending = false; tasks = 0; firstReportAt = null; surveyOpen = false; measuredAt = null; progressSent = 0; progressDraft = false; invoicedAt = null; next = snEmpty() };
      };
    });
  };

  func snEmpty() : Views.NextFacts {
    { tender = null; contractsToSign = 0; contractFirm = ""; addendums = 0; attestsSoon = 0; attestsExpired = 0; attestDay = null; hoursOpen = 0; declareBy = null; salesDue = 0; salesDueDay = null; salesLate = 0 };
  };

  // Een dag met uren is open zolang de aankoop meetelt en het werfdeel van die werf nog niet goedgekeurd of ingetrokken is (zoals de uren-lijst).
  func snClaimOpen(c : Types.HourClaim) : Bool {
    let x = switch (purchases.purchases.get(c.purchaseId)) { case (?y) y; case null return false };
    if (x.status == #withdrawn or x.status == #approved) { return false };
    for (pid in x.parts.values()) {
      switch (oaInvoices.invoices.get(pid)) { case (?i) { if (i.workId == c.workId and (i.status == #approved or i.status == #withdrawn)) { return false } }; case null {} };
    };
    true;
  };

  // De feiten van één werf voor de kaart Volgende stap, gefilterd op wat deze rol van die werf mag zien.
  func snNext(p : Types.Person, id : Nat, accepted : Bool, today : Nat, hours : Map.Map<Nat, Nat>, declare : Map.Map<Nat, Nat>, officeAmounts : Bool, salesOffice : Bool, orgCache : Map.Map<Nat, (Nat, Nat, ?Nat)>) : Views.NextFacts {
    let ctx = { works; settings };
    var f = snEmpty();
    // Prijsvraag (2c.2, 2c.3): de eerste die aandacht vraagt; vergelijken gaat voor wachten.
    if (officeAmounts and Rights.tenderScope(ctx, p, id) == #full) {
      for (t in Tenders.tendersOfWork(tenders, id).values()) {
        if (t.status == #open) {
          let inv = Tenders.invitesOf(tenders, t.id).filter(func(i : Types.TenderInvite) : Bool = i.status != #ready);
          if (inv.size() > 0) {
            let answered = OaQuotes.current(tenders, t).size();
            let waiting = inv.filter(func(i : Types.TenderInvite) : Bool = i.status == #asked or i.status == #reminded).size();
            let compare = answered > 0 and (waiting == 0 or t.deadlineDay < today);
            let cand : Views.NextTender = { title = t.title; asked = inv.size(); answered; deadlineDay = ?t.deadlineDay; compare };
            f := { f with tender = switch (f.tender) {
              case (?cur) { if ((cand.compare and not cur.compare) or (cand.compare == cur.compare and t.deadlineDay < (switch (cur.deadlineDay) { case (?d) d; case null t.deadlineDay }))) ?cand else f.tender };
              case null ?cand;
            } };
          };
        };
      };
    };
    // Afspraken (2c.4): contract te tekenen, aanhangsel, attesten van de OA's van deze werf. Geen bedrag.
    if (Rights.may(ctx, p, #readDeals, ?id)) {
      var toSign = 0;
      var firm = "";
      var addendums = 0;
      var soon = 0;
      var expired = 0;
      var day : ?Nat = null;
      for (a in OaDeals.agreementsOf(oaDeals, id).values()) {
        switch (a.status) {
          case (#ended _) {};
          case (#toSign) { if (toSign == 0) { firm := snOrgName(a.orgId) }; toSign += 1 };
          case (#draft) { if (a.contractVersion > 0) { addendums += 1 } };
          case (#signed) {};
        };
        switch (a.status) {
          case (#ended _) {};
          case _ {
            let (s, e, d) = snAttests(a.orgId, today, orgCache);
            soon += s;
            expired += e;
            switch (d) { case (?x) { day := switch day { case (?y) ?(if (x < y) x else y); case null ?x } }; case null {} };
          };
        };
      };
      f := { f with contractsToSign = toSign; contractFirm = firm; addendums; attestsSoon = soon; attestsExpired = expired; attestDay = day };
    };
    // Uren van een OA (2c.7): enkel de werfleider van die werf en de beheerder.
    if (Rights.may(ctx, p, #confirmHourClaims, ?id)) {
      f := { f with hoursOpen = switch (hours.get(id)) { case (?n) n; case null 0 } };
    };
    // Verzekering aangeven (2c.8).
    if (Rights.may(ctx, p, #readSiteAdmin, ?id)) {
      f := { f with declareBy = declare.get(id) };
    };
    // Verkoopfacturen (2c.6): schijven die nu te factureren zijn, uitgereikte facturen die vervallen zijn. Enkel kantoor met de bedragen.
    if (salesOffice and accepted and Rights.may(ctx, p, #readSales, ?id)) {
      switch (works.works.get(id)) {
        case (?w) {
          if (w.archivedAt == null and w.status != #cancelled) {
            let invs = Sales.invoicesOf(sales, id);
            // 2c.8+ B: ook de schijven van de aanvaarde meerwerkoffertes (bij het akkoord = nu te factureren).
            var due = 0;
            var dueDay : ?Nat = null;
            for (st in Sales.allSteps(settings, sales, quotes, quoteForms, id, func(v : Types.QuoteVersion) : Nat = Progress.dayOf(WorkStart.acceptedAt(quoteDocs, v))).values()) {
              let mine = invs.filter(func(i : Types.SalesInvoice) : Bool = i.planStepKey == ?st.key and Sales.creditOfId(i) == null and not Sales.isCancelled(i));
              let live = mine.any(func(i : Types.SalesInvoice) : Bool = Sales.isIssued(i) and not Sales.fullyCredited(sales, i));
              if (not live) {
                let d : ?Nat = switch (st.when) { case (#beforeStart) w.plannedStart; case (#onDay x) ?x; case _ null };
                let now = switch d { case (?x) x <= today + 7; case null st.when == #beforeStart };
                if (now) {
                  due += 1;
                  switch d { case (?x) { dueDay := switch dueDay { case (?y) ?(if (x < y) x else y); case null ?x } }; case null {} };
                };
              };
            };
            var late = 0;
            for (i in invs.values()) {
              if (Sales.isIssued(i) and Sales.creditOfId(i) == null) {
                switch (i.dueDay) { case (?d) { if (d < today and Sales.payOf(sales, i) != #paid) { late += 1 } }; case null {} };
              };
            };
            f := { f with salesDue = due; salesDueDay = dueDay; salesLate = late };
          };
        };
        case null {};
      };
    };
    f;
  };

  func snOrgName(orgId : Nat) : Text { switch (org.orgs.get(orgId)) { case (?o) o.name; case null "#" # orgId.toText() } };

  // Per firma (één keer per aanroep): verplichte attesten die binnen 30 dagen vervallen, vervallen of ontbreken, en de vroegste vervaldag.
  func snAttests(orgId : Nat, today : Nat, cache : Map.Map<Nat, (Nat, Nat, ?Nat)>) : (Nat, Nat, ?Nat) {
    switch (cache.get(orgId)) {
      case (?x) x;
      case null {
        var soon = 0;
        var expired = 0;
        var day : ?Nat = null;
        for (a in OaDeals.attestStates(oaDeals, settings, orgId, today).values()) {
          if (a.required) {
            if (a.state == "vervalt") { soon += 1; day := switch (day, a.validUntil) { case (?y, ?x) ?(if (x < y) x else y); case (null, v) v; case (d, null) d } }
            else if (a.state == "vervallen" or a.state == "ontbreekt") { expired += 1 };
          };
        };
        let r = (soon, expired, day);
        cache.add(orgId, r);
        r;
      };
    };
  };

  func stageOf(id : Nat, tasks : Map.Map<Nat, Nat>, firstReport : Map.Map<Nat, Int>, started : Map.Map<Nat, Int>, hasStart : Map.Map<Nat, Bool>, startedFrom : Map.Map<Nat, [Nat]>) : Views.WorkStageView {
    // Offertes van de werf (niet gearchiveerd): eerste verzending, wachtend antwoord, eerste akkoord, aanvaard zonder start.
    var quoteSentAt : ?Int = null;
    var quoteWaiting = false;
    var acceptedAt : ?Int = null;
    var startPending = false;
    for (qid in (switch (quotes.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (quotes.quotes.get(qid)) {
        case (?q) {
          if (q.archivedAt == null) {
            for (vid in (switch (quotes.byQuote.get(qid)) { case (?x) x; case null [] }).values()) {
              switch (quotes.versions.get(vid)) {
                case (?v) {
                  switch (v.sent) { case (?s) { quoteSentAt := earliest(quoteSentAt, s.at) }; case null {} };
                  if (v.status == #sent) { quoteWaiting := true };
                  if (v.status == #accepted) {
                    acceptedAt := earliest(acceptedAt, switch (v.decision) { case (?d) d.at; case null v.updatedAt });
                    if (hasStart.get(v.id) == null) { startPending := true };
                  };
                };
                case null {};
              };
            };
          };
        };
        case null {};
      };
    };
    // Gestart vanuit de offerte van een andere werf: die versie telt als verstuurd en aanvaard voor deze werf.
    for (vid in (switch (startedFrom.get(id)) { case (?x) x; case null [] }).values()) {
      switch (quotes.versions.get(vid)) {
        case (?v) {
          switch (v.sent) { case (?s) { quoteSentAt := earliest(quoteSentAt, s.at) }; case null {} };
          acceptedAt := earliest(acceptedAt, switch (v.decision) { case (?d) d.at; case null v.updatedAt });
        };
        case null {};
      };
    };
    // Opmetingen: een open ronde, en de eindopmeting = een afgesloten ronde waarin elke post volledig opgemeten is.
    var surveyOpen = false;
    var measuredAt : ?Int = null;
    for (sid in (switch (surveys.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (surveys.surveys.get(sid)) {
        case (?s) {
          switch (s.status) {
            case (#open) { surveyOpen := true };
            case (#closed(c)) {
              let snap = switch (surveys.snapshots.get(sid)) { case (?x) x; case null [] };
              if (snap.size() > 0 and snap.all(func(x : Types.SurveyPostSnap) : Bool = x.complete)) { measuredAt := earliest(measuredAt, c.at) };
            };
          };
        };
        case null {};
      };
    };
    // Vorderingsstaten: verzonden (geen creditnota), een ontwerp, en de slotstaat = eerste staat verzonden ná de eindopmeting.
    var progressSent = 0;
    var progressDraft = false;
    var invoicedAt : ?Int = null;
    for (pid in (switch (progress.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (progress.statements.get(pid)) {
        case (?s) {
          if (s.status == #draft) { progressDraft := true };
          if (s.status == #sent and s.kind == #statement and s.creditedBy == null) {
            progressSent += 1;
            switch (s.sentAt, measuredAt) {
              case (?at, ?m) { if (at >= m) { invoicedAt := earliest(invoicedAt, at) } };
              case _ {};
            };
          };
        };
        case null {};
      };
    };
    {
      workId = id;
      quoteSentAt;
      quoteWaiting;
      acceptedAt;
      startedAt = started.get(id);
      startPending;
      tasks = switch (tasks.get(id)) { case (?n) n; case null 0 };
      firstReportAt = firstReport.get(id);
      surveyOpen;
      measuredAt;
      progressSent;
      progressDraft;
      invoicedAt;
      next = snEmpty();
    };
  };

  func earliest(cur : ?Int, at : Int) : ?Int {
    switch cur { case (?c) { if (c <= at) cur else ?at }; case null ?at };
  };
};
