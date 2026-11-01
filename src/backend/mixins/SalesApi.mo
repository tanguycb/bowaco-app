// Verkoopfacturen (stap 2c.6, ontwerp 2c §4.6 en §7, R42–R43; ⚖1, ⚖6, ⚖7; AC-4, AC-6, AC-20, AC-21, AC-22, AC-27): per werf het
// facturatieschema (schijven in % op de aanneemsom, per hoofdstuk), facturen uit een schijf, een vorderingsstaat, een min-meerversie of
// vrij, creditnota's in een eigen reeks, betalingen, herinneringen, de kwartaallijst voor de boekhouder en de gegevens voor de UBL.
// Nummering zonder gaten (§7.1): een ontwerp heeft geen nummer; het nummer komt bij UITREIKEN uit settings.sequences
// ("factuur:F:<jaar>", "factuur:CN:<jaar>"), in ÉÉN update-call zonder await (atomair op de canister), met de controle van §7.2 vooraf
// (een geweigerd uitreiken verbruikt geen nummer), chronologisch per reeks, nooit een nummer dat al bestaat (sales.numbers).
// Een uitgereikte factuur verandert nooit (controlecode); verbeteren = een creditnota. Mail enkel via de postbode (testmodus).
// Rechten in lib/Rights.mo (salesScope): admin en calculator alles (bedragen enkel via update-calls met auditregel); de werfleider van
// de werf enkel het feit "voorschot betaald"; de klant van de werf en van zijn firma enkel zijn UITGEREIKTE facturen.
// Hulpfuncties hier dragen de prefix "sl" (gedeeld over alle mixins).
import Array "mo:core/Array";
import Char "mo:core/Char";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Runtime "mo:core/Runtime";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import SV "../types/salesviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import MinMeer "../lib/MinMeer";
import Post "../lib/Post";
import Progress "../lib/Progress";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import Sales "../lib/Sales";
import SalesCalc "../lib/SalesCalc";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  quoteForms : Types.QuoteFormState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  progress : Types.ProgressState,
  oaInvoices : Types.OaInvoiceState,
  oaDeals : Types.OaDealState,
  purchases : Types.PurchaseState,
  minMeer : Types.MinMeerState,
  sales : Types.SalesState,
  post : Types.PostState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen (Beheer → Opmeting & facturatie → Facturen; R43) ───────
  public query ({ caller }) func salesSettings() : async SV.SalesSettingsView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editSales, null);
    let today = slToday();
    let y = Quotes.yearOf(today);
    let counter = func(series : Text, year : Nat) : SV.SalesCounterView {
      let last = Sales.lastSeq(settings, series, year);
      { series; year; last; set = settings.sequences.containsKey(Sales.seqKey(series, year)); locked = Sales.seriesUsed(sales, series, year); next = last + 1 };
    };
    {
      issuer = Sales.issuer(settings);
      issuerName = Sales.raw(settings, "sales.issuer.name");
      paymentDays = Sales.paymentDays(settings);
      vat6Text = Sales.vat6Text(settings);
      reverseText = Sales.reverseText(settings);
      paymentText = Sales.paymentText(settings);
      footerText = Sales.footerText(settings);
      reminderText = Sales.reminderText(settings);
      reminderDays = Sales.reminderDays(settings);
      issuerOnly = Sales.issuerOnly(settings);
      firstSeqF = Sales.firstSeq(settings, "F");
      firstSeqCN = Sales.firstSeq(settings, "CN");
      planBp = Sales.planDefault(settings);
      peppolScheme = Sales.peppolScheme(settings);
      // Vorig jaar enkel als de app er nummers uitreikte (de laatste nummers van vorig jaar voor de boekhouder); dit en volgend jaar altijd.
      counters = (if (y > 0 and Sales.seriesUsed(sales, "F", y - 1)) [counter("F", y - 1)] else []).concat(if (y > 0 and Sales.seriesUsed(sales, "CN", y - 1)) [counter("CN", y - 1)] else []).concat([counter("F", y), counter("CN", y), counter("F", y + 1), counter("CN", y + 1)]);
      today;
    };
  };

  public shared ({ caller }) func saveSalesSettings(i : SV.SalesSettingsInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.paymentDays == 0 or i.paymentDays > 365) { return #err("Betaaltermijn: 1 tot 365 dagen") };
    if (i.reminderDays > 365) { return #err("Herinnering: hoogstens 365 dagen na de vervaldag") };
    if (i.firstSeqF == 0 or i.firstSeqF > 99_999 or i.firstSeqCN == 0 or i.firstSeqCN > 99_999) { return #err("Startnummer: 1 tot 99.999") };
    var sum = 0;
    for (x in i.planBp.values()) { sum += x };
    if (i.planBp.size() != 3 or sum != 10_000) { return #err("Standaardschema: drie schijven, samen 100 %") };
    for (t in [i.vat6Text, i.reverseText, i.paymentText, i.footerText, i.reminderText].values()) { if (t.size() > 3_000) { return #err("Een vermelding is hoogstens 3.000 tekens") } };
    let iss = i.issuer;
    let fields : [(Text, Text)] = [("name", iss.name), ("legalForm", iss.legalForm), ("street", iss.address.street), ("number", iss.address.number), ("zip", iss.address.zip), ("city", iss.address.city), ("country", iss.address.country), ("vat", iss.vat), ("kbo", iss.kbo), ("rpr", iss.rpr), ("email", iss.email), ("phone", iss.phone), ("website", iss.website), ("iban", iss.iban), ("bic", iss.bic)];
    for ((k, v) in fields.values()) { if (v.size() > 200) { return #err("Gegevens van BOWACO: hoogstens 200 tekens per veld") } };
    if (iss.iban.trim(#char ' ').size() > 0 and not slIbanOk(iss.iban)) { return #err("Rekeningnummer: geen geldig IBAN (controlegetal)") };
    for ((k, v) in fields.values()) { settings.values.add("sales.issuer." # k, v.trim(#char ' ')) };
    settings.values.add("sales.paymentDays", i.paymentDays.toText());
    settings.values.add("sales.text.vat6", i.vat6Text);
    settings.values.add("sales.text.reverse", i.reverseText);
    settings.values.add("sales.text.payment", i.paymentText);
    settings.values.add("sales.text.footer", i.footerText);
    settings.values.add("sales.text.reminder", i.reminderText);
    settings.values.add("sales.reminderDays", i.reminderDays.toText());
    settings.values.add("sales.issuerOnly", if (i.issuerOnly) "ja" else "nee");
    settings.values.add("sales.firstSeq.F", i.firstSeqF.toText());
    settings.values.add("sales.firstSeq.CN", i.firstSeqCN.toText());
    settings.values.add("sales.plan", Text.join(i.planBp.map(func(x : Nat) : Text = x.toText()).values(), "/"));
    settings.values.add("sales.peppolScheme", i.peppolScheme.trim(#char ' '));
    Access.audit(audit, caller, ?p.id, null, "factuur-instellingen", "betaaltermijn " # i.paymentDays.toText() # " d, enkel beheerder " # (if (i.issuerOnly) "ja" else "nee"));
    #ok;
  };

  // §7.1.4 (AC-20): de beheerder zet het LAATST gebruikte nummer van een reeks (het laatste Excelnummer), enkel zolang de app in die
  // reeks en dat jaar nog geen nummer uitreikte; daarna ligt de teller vast (ook niet hoger).
  public shared ({ caller }) func setSalesCounter(series : Text, year : Nat, last : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (series != "F" and series != "CN") { return #err("Reeks: F of CN") };
    let y = Quotes.yearOf(slToday());
    if (year != y and year != y + 1) { return #err("Enkel dit jaar of volgend jaar") };
    if (last > 99_998) { return #err("Laatste nummer: hoogstens 99.998") };
    if (Sales.seriesUsed(sales, series, year)) { return #err("De app reikte in " # year.toText() # " al een nummer van deze reeks uit: de teller ligt vast") };
    settings.sequences.add(Sales.seqKey(series, year), last);
    Access.audit(audit, caller, ?p.id, null, "factuur-teller", series # " " # year.toText() # ": laatste nummer " # last.toText());
    #ok;
  };

  // ── Het facturatieschema per werf ──────────────────────────────────────
  // Kantoor: de schijven met hun bedragen per hoofdstuk (auditregel "bekeek:facturatieschema").
  public shared ({ caller }) func readSalesPlan(workId : Nat) : async Result.Result<SV.SalesPlanView, Text> {
    let p = Access.requireActive(access, caller);
    slOffice(p, workId);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let b = Sales.base(slCtx(), workId) ?? return #err("Nog geen getekende offerte op deze werf");
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:facturatieschema", w.code);
    #ok(slPlanView(workId, b, Sales.planOf(slCtx(), workId)));
  };

  // Bewaren: per hoofdstuk samen 100 %; een schijf met een factuur (ontwerp of uitgereikt) blijft zoals ze is.
  public shared ({ caller }) func saveSalesPlan(workId : Nat, version : Nat, steps : [SV.BillingStepInput]) : async Result.Result<SV.SalesPlanView, Text> {
    let p = Access.requireActive(access, caller);
    slOffice(p, workId);
    let b = Sales.base(slCtx(), workId) ?? return #err("Nog geen getekende offerte op deze werf");
    let old = Sales.planOf(slCtx(), workId);
    if (version != old.version) { return #err("Iemand anders bewaarde het schema intussen; laad opnieuw") };
    let ns : [Types.BillingStep] = steps.map(func(s : SV.BillingStepInput) : Types.BillingStep = { key = s.key.trim(#char ' '); title = s.title.trim(#char ' '); pctBp = s.pctBp; when = s.when; chapterPct = s.chapterPct.filter(func(x : Types.BillingChapterPct) : Bool = b.chapters.any(func(ch : Text) : Bool = ch == x.chapter)); quoteIds = [] });
    switch (Sales.planError(ns, b.chapters)) { case (?e) return #err(e); case null {} };
    for (st in old.steps.values()) {
      if (slStepStatus(workId, st.key).0 != "open") {
        switch (ns.find(func(x : Types.BillingStep) : Bool = x.key == st.key)) {
          case (?x) { if (b.chapters.any(func(ch : Text) : Bool = Sales.pctFor(x, ch) != Sales.pctFor(st, ch)) or x.when != st.when) { return #err("Schijf " # st.title # " heeft al een factuur: % en moment blijven") } };
          case null { return #err("Schijf " # st.title # " heeft al een factuur en blijft in het schema") };
        };
      };
    };
    let np : Types.BillingPlan = { workId; steps = ns; version = old.version + 1; updatedAt = Time.now(); updatedBy = p.id; extra = [] };
    sales.plans.add(workId, np);
    Access.audit(audit, caller, ?p.id, ?workId, "facturatieschema", Text.join(ns.map(func(s : Types.BillingStep) : Text = s.title # " " # Sales.pctText(s.pctBp)).values(), " · "));
    #ok(slPlanView(workId, b, np));
  };

  // ── Facturen per werf (zonder bedragen) ────────────────────────────────
  public query ({ caller }) func listSales(workId : Nat) : async [SV.SalesBrief] {
    let p = Access.requireActive(access, caller);
    slOffice(p, workId);
    let today = slToday();
    Sales.invoicesOf(sales, workId).filter(func(i : Types.SalesInvoice) : Bool = not Sales.isCancelled(i)).map(func(i : Types.SalesInvoice) : SV.SalesBrief = Sales.brief(slCtx(), i, today));
  };

  // De werfleider (en kantoor): enkel het feit "voorschot betaald" (R42, R27), GEEN bedrag.
  public query ({ caller }) func salesFacts(workId : Nat) : async SV.SalesFactView {
    let p = Access.requireActive(access, caller);
    let sc = Rights.salesScope({ works; settings }, p, workId, slClientOrg(workId));
    if (sc != #full and sc != #fact) { Runtime.trap("Geen toegang") };
    let pl = Sales.planOf(slCtx(), workId);
    let adv = pl.steps.find(func(s : Types.BillingStep) : Bool = s.when == #beforeStart);
    switch adv {
      case null { { workId; advance = "geen"; advanceDay = null } };
      case (?s) {
        let inv = Sales.invoicesOf(sales, workId).find(func(i : Types.SalesInvoice) : Bool = i.planStepKey == ?s.key and Sales.isIssued(i) and not Sales.fullyCredited(sales, i));
        switch inv {
          case null { { workId; advance = "niet-gefactureerd"; advanceDay = null } };
          case (?i) { { workId; advance = Sales.payKey(Sales.payOf(sales, i)); advanceDay = i.dueDay } };
        };
      };
    };
  };

  // ── Een ontwerp maken (geen nummer) ─────────────────────────────────────
  // Uit een schijf van het schema (de slotschijf ook uit een min-meerversie), uit een vorderingsstaat "klaar voor factuur", uit een
  // min-meerversie, vrij, of een creditnota bij een uitgereikte factuur (volledig: alle regels; deels: regels in te vullen).
  public shared ({ caller }) func newSalesInvoice(workId : Nat, src : SV.SalesSource) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    slOffice(p, workId);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let c = slCtx();
    var kind : Types.SalesKind = #free;
    var stepKey : ?Text = null;
    var lines : [Types.SalesLine] = [];
    var title = "Factuur";
    var serviceDay : ?Nat = null;
    var serviceTo : ?Nat = null;
    var vat : Types.SalesVat = #rate(w.vatBp);
    var series = "F";
    var clientOrgId = w.clientOrgId;
    switch src {
      case (#step s) {
        let b = Sales.base(c, workId) ?? return #err("Nog geen getekende offerte op deze werf");
        let pl = Sales.planOf(c, workId);
        var idx = 0;
        var found : ?Types.BillingStep = null;
        for ((i, st) in pl.steps.enumerate()) { if (st.key == s.key) { idx := i; found := ?st } };
        let st = found ?? return #err("Onbekende schijf");
        if (slStepStatus(workId, st.key).0 != "open") { return #err("Voor schijf " # st.title # " bestaat al een factuur (ontwerp of uitgereikt)") };
        stepKey := ?st.key;
        vat := #rate(b.vatBp);
        switch (s.minMeerVersionId) {
          case (?vid) {
            if (st.when != #final) { return #err("Enkel de slotschijf komt uit een min-meerversie") };
            let (v, fr) = switch (slMmVersion(workId, vid)) { case (#ok x) x; case (#err e) return #err(e) };
            kind := #minMeer(vid);
            lines := Sales.minMeerLines(v, fr, b.vatBp);
            title := st.title # " (min-meerstaat versie " # v.number.toText() # ")";
          };
          case null {
            kind := Sales.stepKind(st, idx);
            lines := Sales.stepLines(b, pl, st.key, b.vatBp) ?? [];
            title := st.title # " " # Sales.pctText(st.pctBp);
          };
        };
      };
      case (#progress sid) {
        let st = progress.statements.get(sid) ?? return #err("Onbekende vorderingsstaat");
        if (st.workId != workId) { return #err("Die vorderingsstaat hoort niet bij deze werf") };
        if (st.status != #sent or st.kind != #statement or st.creditedBy != null) { return #err("Enkel een verzonden vorderingsstaat (geen creditnota, niet gecrediteerd)") };
        switch (st.billing) { case (#ready _) {}; case (#open) return #err("Zet de vorderingsstaat eerst op 'klaar voor factuur'"); case (#invoiced _) return #err("Deze vorderingsstaat werd al gefactureerd") };
        if (Sales.invoicesOf(sales, workId).any(func(i : Types.SalesInvoice) : Bool = i.kind == #progress(sid) and not Sales.isCancelled(i) and not Sales.fullyCredited(sales, i))) { return #err("Voor deze vorderingsstaat bestaat al een factuur") };
        let fr = Progress.frozenOf(progress, sid) ?? return #err("De vorderingsstaat heeft geen vastgelegde inhoud");
        kind := #progress(sid);
        vat := #rate(fr.totals.vatBp);
        lines := Sales.progressLines(st, fr, fr.totals.vatBp);
        title := "Vorderingsstaat " # st.code;
        serviceDay := ?st.periodFrom;
        serviceTo := ?st.periodTo;
      };
      case (#minMeer vid) {
        let (v, fr) = switch (slMmVersion(workId, vid)) { case (#ok x) x; case (#err e) return #err(e) };
        let pl = Sales.planOf(c, workId);
        switch (pl.steps.find(func(s : Types.BillingStep) : Bool = s.when == #final)) {
          case (?s) { if (slStepStatus(workId, s.key).0 != "open") { return #err("Voor de slotschijf bestaat al een factuur") }; stepKey := ?s.key };
          case null {};
        };
        kind := #minMeer(vid);
        vat := #rate(fr.totals.vatBp);
        lines := Sales.minMeerLines(v, fr, fr.totals.vatBp);
        title := "Slotfactuur (min-meerstaat versie " # v.number.toText() # ")";
      };
      case (#free) {};
      case (#credit cr) {
        let o = sales.invoices.get(cr.invoiceId) ?? return #err("Onbekende factuur");
        if (o.workId != workId or not Sales.isIssued(o) or Sales.creditOfId(o) != null) { return #err("Enkel een uitgereikte factuur van deze werf wordt gecrediteerd") };
        if (Sales.fullyCredited(sales, o)) { return #err("Deze factuur is al volledig gecrediteerd") };
        let of = Sales.frozenOf(sales, o.id) ?? return #err("De factuur heeft geen vastgelegde inhoud");
        if (cr.full and Sales.money(sales, o).creditedCents != 0) { return #err("Er is al een creditnota: crediteer de rest met een gedeeltelijke creditnota") };
        kind := #credit(o.id);
        series := "CN";
        vat := o.vat;
        clientOrgId := o.clientOrgId;
        serviceDay := o.serviceDay;
        serviceTo := o.serviceTo;
        lines := if (cr.full) Sales.negate(of.lines) else [];
        title := "Creditnota bij factuur " # o.number;
      };
    };
    let id = Ids.next(ctr, "sales");
    let now = Time.now();
    sales.invoices.add(id, { id; workId; kind; series; year = 0; seq = 0; number = ""; status = #draft; pay = #open; issueDay = null; serviceDay; serviceTo; dueDay = null; paymentDays = if (series == "CN") 0 else Sales.paymentDays(settings); clientOrgId; vat; planStepKey = stepKey; peppol = #notNeeded; sent = null; title; hash = ""; calcVersion = SalesCalc.version; rev = 0; note = ""; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; issuedAt = null; issuedBy = null; extra = [] });
    sales.drafts.add(id, #plain(Sales.applyVat(lines, vat)));
    Sales.addIdx(sales.byWork, workId, id);
    Access.audit(audit, caller, ?p.id, ?workId, "factuur-ontwerp", Sales.kindKey(kind) # " #" # id.toText() # " " # w.code);
    #ok(id);
  };

  // Een ontwerp bewaren: kop (titel, notitie voor de klant, datum van de dienst, betaaltermijn, btw) en, bij een vrije factuur of een
  // creditnota, de regels. De browser rekent mee (sales/calc.ts) en geeft het totaal dat hij vond; anders: weigeren.
  public shared ({ caller }) func saveSalesDraft(id : Nat, rev : Nat, i : SV.SalesDraftInput) : async Result.Result<SV.SalesDraftSaved, Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    if (not Sales.isDraft(inv)) { return #err("Enkel een ontwerp is te bewerken; een uitgereikte factuur verbeter je met een creditnota") };
    if (rev != inv.rev) { return #err("Iemand anders bewaarde dit ontwerp intussen; laad opnieuw") };
    let title = i.title.trim(#char ' ');
    if (title.size() == 0 or title.size() > 120) { return #err("Titel: 1 tot 120 tekens") };
    if (i.note.size() > 1_000) { return #err("Notitie: hoogstens 1.000 tekens") };
    let credit = Sales.creditOfId(inv) != null;
    if (not credit and (i.paymentDays == 0 or i.paymentDays > 365)) { return #err("Betaaltermijn: 1 tot 365 dagen") };
    switch (i.serviceDay, i.serviceTo) { case (?a, ?b) { if (b < a) { return #err("De periode van de dienst eindigt vóór ze begint") } }; case (null, ?_) { return #err("Geef eerst de begindag van de dienst") }; case _ {} };
    switch (i.vat) { case (#rate r) { if (r != 600 and r != 2100) { return #err("Btw: 6 % of 21 %, of verlegd") } }; case _ {} };
    if (credit and i.vat != inv.vat) { return #err("Een creditnota volgt de btw van de factuur") };
    let editable = inv.kind == #free or credit;
    let lines : [Types.SalesLine] = switch (i.lines) {
      case null Sales.draftLines(sales, id);
      case (?ls) {
        if (not editable) { return #err("De regels van deze factuur volgen uit haar bron (schijf, vorderingsstaat of min-meerstaat)") };
        if (ls.size() > 200) { return #err("Hoogstens 200 regels") };
        let out = List.empty<Types.SalesLine>();
        for (l in ls.values()) {
          let d = l.description.trim(#char ' ');
          if (d.size() == 0 or d.size() > 300) { return #err("Omschrijving van een regel: 1 tot 300 tekens") };
          if (l.group.size() > 120 or l.unit.size() > 12 or l.ref.size() > 80) { return #err("Hoofdstuk, eenheid of verwijzing te lang") };
          if (l.kind == #deduct) { return #err("Een aftrekregel komt enkel uit de min-meerstaat") };
          if (l.qtyMilli == 0) { return #err("Hoeveelheid van een regel: niet 0") };
          if (Int.abs(l.qtyMilli) > 1_000_000_000 or Int.abs(l.unitCents) > 10_000_000_000) { return #err("Hoeveelheid of prijs te groot") };
          if (i.vat == #mixed and l.vatBp != 600 and l.vatBp != 2100) { return #err("Btw per regel: 6 % of 21 %") };
          let a = SalesCalc.lineAmount(l.qtyMilli, l.unitCents);
          if (credit and a >= 0) { return #err("Een regel van een creditnota is negatief (wat je terugneemt)") };
          out.add({ kind = l.kind; group = l.group.trim(#char ' '); description = d; ref = l.ref; qtyMilli = l.qtyMilli; unit = l.unit.trim(#char ' '); unitCents = l.unitCents; amountCents = a; vatBp = l.vatBp; baseCents = null; pctBp = null });
        };
        out.toArray();
      };
    };
    let applied = Sales.applyVat(lines, i.vat);
    let t = Sales.totalsOf(applied, i.vat);
    if (t.totalCents != i.expectTotalCents) { return #err("Het totaal is intussen veranderd (server " # Sales.euro(t.totalCents) # "); laad opnieuw") };
    let now = Time.now();
    sales.drafts.add(id, #plain(applied));
    sales.invoices.add(id, { inv with title; note = i.note; serviceDay = i.serviceDay; serviceTo = i.serviceTo; paymentDays = if credit 0 else i.paymentDays; vat = i.vat; rev = inv.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-ontwerp-bewaard", "#" # id.toText());
    #ok({ rev = inv.rev + 1; totals = { netCents = t.netCents; vatCents = t.vatCents; totalCents = t.totalCents; vatLines = t.vatLines } });
  };

  // Een ontwerp wegdoen (geen nummer verbruikt, geen gat; ⚖: een uitgereikte factuur nooit).
  public shared ({ caller }) func cancelSalesDraft(id : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    if (not Sales.isDraft(inv)) { return #err("Enkel een ontwerp kan weg; een uitgereikte factuur verbeter je met een creditnota") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    let now = Time.now();
    sales.invoices.add(id, { inv with status = #draftCancelled(why); rev = inv.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-ontwerp-weg", "#" # id.toText() # ": " # why);
    #ok;
  };

  // Kantoor: alles van één factuur, met de controle (ontwerp) of de vastgelegde inhoud (uitgereikt). Auditregel "bekeek:factuur".
  public shared ({ caller }) func readSalesInvoice(id : Nat) : async Result.Result<SV.SalesFullView, Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    Access.audit(audit, caller, ?p.id, ?inv.workId, "bekeek:factuur", if (inv.number == "") "#" # id.toText() else inv.number);
    #ok(slFull(inv));
  };

  // ── Uitreiken (§7.1): controle, dan nummer + vastleggen in ÉÉN stap (geen await) ──
  // Een geweigerd uitreiken (controle, totaal, rechten) schrijft niets: de teller blijft staan, er ontstaat geen gat.
  public shared ({ caller }) func issueSalesInvoice(id : Nat, rev : Nat, expectTotalCents : Int) : async Result.Result<Text, Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    if (not Rights.may({ works; settings }, p, #issueSales, null)) { return #err("Geen toegang: enkel de beheerder reikt facturen uit (Beheer → Opmeting & facturatie → Facturen)") };
    if (not Sales.isDraft(inv)) { return #err("Deze factuur is al uitgereikt of weggedaan") };
    if (rev != inv.rev) { return #err("Iemand anders bewaarde dit ontwerp intussen; laad opnieuw") };
    if (inv.calcVersion != SalesCalc.version) { return #err("Dit ontwerp rekent met oude regels: maak een nieuw ontwerp") };
    let c = slCtx();
    let today = slToday();
    let year = Quotes.yearOf(today);
    let lines = Sales.draftLines(sales, id);
    let pre = Sales.freeze(c, inv, lines, "ONTWERP", 0, today);
    let bl = Sales.blocks(slFindings(inv, pre, today));
    if (bl.size() > 0) { return #err("Niet uitgereikt: " # Sales.describe(bl)) };
    if (pre.totalCents != expectTotalCents) { return #err("Het totaal is intussen veranderd; laad opnieuw") };
    let seq = Sales.lastSeq(settings, inv.series, year) + 1;
    if (seq > 99_999) { return #err("De reeks " # inv.series # " " # year.toText() # " is vol") };
    let number = SalesCalc.number(inv.series, year, seq);
    if (sales.numbers.containsKey(Sales.numberKey(inv.series, number))) { return #err("Nummer " # number # " bestaat al: de teller loopt achter. Meld het aan de beheerder") };
    // Vanaf hier geen weigering meer: alles in deze ene oproep.
    let credit = Sales.creditOfId(inv);
    let now = Time.now();
    let base : Types.SalesInvoice = { inv with year; seq; number; issueDay = ?today; dueDay = ?(if (credit != null) today else today + inv.paymentDays) };
    let fr = Sales.freeze(c, base, lines, number, seq, today);
    let h = Sales.hash(Sales.canonical(base, fr));
    settings.sequences.add(Sales.seqKey(inv.series, year), seq);
    sales.frozen.add(id, #plain(fr));
    sales.invoices.add(id, { base with status = #issued; pay = if (credit != null) #paid else #open; hash = h; issuedAt = ?now; issuedBy = ?p.id; rev = inv.rev + 1; updatedAt = now; updatedBy = p.id });
    sales.numbers.add(Sales.numberKey(inv.series, number), id);
    sales.lastDay.add(Sales.seriesYear(inv.series, year), today);
    sales.drafts.remove(id);
    switch (inv.kind) {
      case (#progress sid) { switch (progress.statements.get(sid)) { case (?st) progress.statements.add(sid, { st with billing = #invoiced({ at = now; by = ?p.id; ref = number }); updatedAt = now; updatedBy = p.id }); case null {} } };
      case _ {};
    };
    switch credit {
      case (?o) {
        switch (sales.invoices.get(o)) {
          case (?x) {
            sales.invoices.add(o, { x with pay = Sales.payOf(sales, x); updatedAt = now; updatedBy = p.id });
            // Volledig gecrediteerd: de vorderingsstaat kan opnieuw gefactureerd worden.
            switch (x.kind) {
              case (#progress sid) { if (Sales.fullyCredited(sales, x)) { switch (progress.statements.get(sid)) { case (?st) progress.statements.add(sid, { st with billing = #ready({ at = now; by = p.id }); updatedAt = now; updatedBy = p.id }); case null {} } } };
              case _ {};
            };
          };
          case null {};
        };
      };
      case null {};
    };
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-uitgereikt", number # " hash " # Text.fromIter(h.chars().take(12)));
    slNotifyClient(inv.workId, (if (credit != null) "Creditnota " else "Factuur ") # number # " staat klaar in de app (Mijn werf → Facturatie)");
    #ok(number);
  };

  // ── Na het uitreiken ────────────────────────────────────────────────────
  public shared ({ caller }) func markSalesSent(id : Nat, how : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    if (not Sales.isIssued(inv)) { return #err("Enkel een uitgereikte factuur wordt verstuurd") };
    let h = how.trim(#char ' ');
    if (h.size() == 0 or h.size() > 80) { return #err("Hoe verstuurd: 1 tot 80 tekens (bv. mail, post, Peppol)") };
    sales.invoices.add(id, { inv with sent = ?{ at = Time.now(); by = p.id; how = h }; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-verstuurd", inv.number # " (" # h # ")");
    #ok;
  };

  // Een betaling (ook deels). Nooit meer dan wat openstaat; een betaling ongedaan maken = archiveren met reden.
  public shared ({ caller }) func addSalesPayment(id : Nat, day : Nat, cents : Int, how : Text, note : Text) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    slOffice(p, inv.workId);
    if (not Sales.isIssued(inv) or Sales.creditOfId(inv) != null) { return #err("Enkel een uitgereikte factuur krijgt een betaling") };
    if (cents <= 0) { return #err("Bedrag: meer dan € 0") };
    if (day > slToday()) { return #err("De dag van de betaling ligt in de toekomst") };
    if (how.size() > 80 or note.size() > 300) { return #err("Hoe of notitie te lang") };
    let m = Sales.money(sales, inv);
    if (cents > m.openCents) { return #err("Meer dan wat openstaat (" # Sales.euro(m.openCents) # ")") };
    let pid = Ids.next(ctr, "salesPayment");
    sales.payments.add(pid, #plain({ id = pid; invoiceId = id; day; cents; how = how.trim(#char ' '); note = note.trim(#char ' '); at = Time.now(); by = p.id; archivedAt = null; archivedBy = null; archiveReason = "" }));
    Sales.addIdx(sales.paymentsByInvoice, id, pid);
    sales.invoices.add(id, { inv with pay = Sales.payOf(sales, inv); updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-betaling", inv.number # " betaling #" # pid.toText());
    #ok(pid);
  };

  public shared ({ caller }) func archiveSalesPayment(paymentId : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    slOfficeAny(p);
    let pay = switch (sales.payments.get(paymentId)) { case (?c) (Sales.plain(c) ?? return #err("Onbekende betaling")); case null return #err("Onbekende betaling") };
    let inv = sales.invoices.get(pay.invoiceId) ?? return #err("Onbekende betaling");
    slOffice(p, inv.workId);
    if (pay.archivedAt != null) { return #err("Deze betaling is al ongedaan gemaakt") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxQuoteReason) { return #err("Geef een reden (5 tot 300 tekens)") };
    sales.payments.add(paymentId, #plain({ pay with archivedAt = ?Time.now(); archivedBy = ?p.id; archiveReason = why }));
    sales.invoices.add(inv.id, { inv with pay = Sales.payOf(sales, inv); updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuur-betaling-weg", inv.number # " betaling #" # paymentId.toText() # ": " # why);
    #ok;
  };

  // ── Werklijst Facturatie → Facturen: te factureren, open facturen, ontwerpen (kantoor) ──
  public shared ({ caller }) func salesWorklist() : async Result.Result<SV.SalesWorklistView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editSales, null);
    Rights.require(ctx, p, #readCosts, null);
    let c = slCtx();
    let today = slToday();
    let due = List.empty<SV.SalesDueRow>();
    let open = List.empty<SV.SalesOpenRow>();
    let drafts = List.empty<SV.SalesBrief>();
    for (w in works.works.values()) {
      if (w.archivedAt == null and w.status != #cancelled) {
        switch (Sales.base(c, w.id)) {
          case (?b) {
            let pl = Sales.planOf(c, w.id);
            let am = Sales.stepAmounts(b, pl);
            for ((i, st) in pl.steps.enumerate()) {
              let (status, _) = slStepStatus(w.id, st.key);
              if (status != "uitgereikt") {
                let d = slDueDay(w, st);
                var sum : Int = 0;
                for (x in am[i].values()) { sum += x };
                let draft = Sales.invoicesOf(sales, w.id).find(func(x : Types.SalesInvoice) : Bool = x.planStepKey == ?st.key and Sales.isDraft(x));
                due.add({ workId = w.id; workCode = w.code; workName = w.name; stepKey = st.key; title = st.title; pctBp = st.pctBp; when = st.when; dueDay = d; now = (switch d { case (?x) x <= today + 7; case null st.when == #beforeStart }); stepCents = sum; draftId = switch draft { case (?x) ?x.id; case null null } });
              };
            };
          };
          case null {};
        };
        for (inv in Sales.invoicesOf(sales, w.id).values()) {
          if (Sales.isDraft(inv)) { drafts.add(Sales.brief(c, inv, today)) } else if (Sales.isIssued(inv) and Sales.creditOfId(inv) == null and Sales.payOf(sales, inv) != #paid) {
            let m = Sales.money(sales, inv);
            let late = switch (inv.dueDay) { case (?d) { if (d < today) today - d : Nat else 0 }; case null 0 };
            open.add({ brief = Sales.brief(c, inv, today); workName = w.name; clientName = Sales.buyerOf(c, inv.clientOrgId).name; totalCents = m.totalCents; openCents = m.openCents; daysLate = late });
          };
        };
      };
    };
    Access.audit(audit, caller, ?p.id, null, "bekeek:te-factureren", "");
    #ok({ today; due = due.toArray(); open = open.toArray(); drafts = drafts.toArray() });
  };

  // ── De klant: Mijn werf → Facturatie (enkel UITGEREIKTE facturen van zijn werf en zijn firma) ──
  public shared ({ caller }) func listMySales() : async Result.Result<SV.MySalesView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownSales, null);
    let c = slCtx();
    let today = slToday();
    let rows = List.empty<SV.MySalesRow>();
    let sched = List.empty<SV.MyScheduleRow>();
    for (w in works.works.values()) {
      if (Rights.salesScope(ctx, p, w.id, w.clientOrgId) == #client) {
        for (inv in Sales.invoicesOf(sales, w.id).values()) {
          if (Sales.isIssued(inv) and inv.clientOrgId == p.orgId) {
            switch (Sales.frozenOf(sales, inv.id)) {
              case (?f) {
                let m = Sales.money(sales, inv);
                rows.add({ id = inv.id; workId = w.id; workName = w.name; number = inv.number; kindTitle = f.kindText; issueDay = f.issueDay; dueDay = f.dueDay; totalCents = f.totalCents; openCents = if (Sales.creditOfId(inv) != null) 0 else m.openCents; pay = Sales.payKey(Sales.payOf(sales, inv)); overdue = Sales.overdue(sales, inv, today); creditOf = switch (f.creditOf) { case (?x) x; case null "" } });
              };
              case null {};
            };
          };
        };
        if (Sales.base(c, w.id) != null) {
          for (st in Sales.planOf(c, w.id).steps.values()) {
            let (status, numbers) = slStepStatus(w.id, st.key);
            sched.add({ workId = w.id; workName = w.name; title = st.title; pctBp = st.pctBp; when = st.when; status = if (status == "ontwerp") "open" else status; numbers = if (status == "uitgereikt") numbers else [] });
          };
        };
      };
    };
    Access.audit(audit, caller, ?p.id, null, "bekeek:mijn-facturen", "");
    #ok({ invoices = rows.toArray(); schedule = sched.toArray() });
  };

  public shared ({ caller }) func readMySalesInvoice(id : Nat) : async Result.Result<SV.MySalesDoc, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownSales, null);
    // Onbekend of niet van hem: hetzelfde antwoord (geen orakel).
    let inv = sales.invoices.get(id) ?? return #err("Onbekende factuur");
    if (not Sales.isIssued(inv) or inv.clientOrgId != p.orgId or Rights.salesScope({ works; settings }, p, inv.workId, slClientOrg(inv.workId)) != #client) { return #err("Onbekende factuur") };
    let f = Sales.frozenOf(sales, id) ?? return #err("Onbekende factuur");
    Access.audit(audit, caller, ?p.id, ?inv.workId, "bekeek:mijn-factuur", inv.number);
    let m = Sales.money(sales, inv);
    #ok({ doc = f; hash = inv.hash; pay = Sales.payKey(Sales.payOf(sales, inv)); openCents = if (Sales.creditOfId(inv) != null) 0 else m.openCents });
  };

  // ── Hulp (prefix sl) ───────────────────────────────────────────────────
  func slMmCtx() : MinMeer.Ctx { { settings; access; org; works; dossier; plan; reports; qs = quotes; qf = quoteForms; qd = quoteDocs; starts = workStarts; ss = surveys; ps = progress; oi = oaInvoices; deals = oaDeals; pu = purchases; sales; mm = minMeer } };
  func slCtx() : Sales.Ctx { { settings; org; works; pc = MinMeer.progressCtx(slMmCtx()); mm = minMeer; sales } };
  func slToday() : Nat { Post.local(Time.now()).day };
  func slClientOrg(workId : Nat) : ?Nat { switch (works.works.get(workId)) { case (?w) w.clientOrgId; case null null } };
  // Kantoor met de bedragen (R42: #editSales én #readCosts), nog zonder werf (vóór het opzoeken van een id).
  func slOfficeAny(p : Types.Person) {
    let ctx = { works; settings };
    Rights.require(ctx, p, #editSales, null);
    Rights.require(ctx, p, #readCosts, null);
  };
  // Kantoor met de bedragen (R42: #editSales én #readCosts) op een werf die het ziet.
  func slOffice(p : Types.Person, workId : Nat) {
    let ctx = { works; settings };
    Rights.require(ctx, p, #editSales, null);
    Rights.require(ctx, p, #readCosts, null);
    Rights.require(ctx, p, #readSales, ?workId);
  };

  // De stand van een schijf: "uitgereikt" (een uitgereikte factuur die niet volledig gecrediteerd is), "ontwerp", anders "open".
  func slStepStatus(workId : Nat, key : Text) : (Text, [Text]) {
    let invs = Sales.invoicesOf(sales, workId).filter(func(i : Types.SalesInvoice) : Bool = i.planStepKey == ?key and Sales.creditOfId(i) == null and not Sales.isCancelled(i));
    let live = invs.filter(func(i : Types.SalesInvoice) : Bool = Sales.isIssued(i) and not Sales.fullyCredited(sales, i));
    if (live.size() > 0) { return ("uitgereikt", live.map(func(i : Types.SalesInvoice) : Text = i.number)) };
    if (invs.any(Sales.isDraft)) { return ("ontwerp", []) };
    ("open", []);
  };

  func slDueDay(w : Types.Work, st : Types.BillingStep) : ?Nat {
    switch (st.when) { case (#beforeStart) w.plannedStart; case (#onDay d) ?d; case _ null };
  };

  func slMmVersion(workId : Nat, vid : Nat) : Result.Result<(Types.MmVersion, Types.MmFrozen), Text> {
    let v = minMeer.versions.get(vid) ?? return #err("Onbekende min-meerversie");
    if (v.workId != workId) { return #err("Die min-meerversie hoort niet bij deze werf") };
    let fr = MinMeer.frozenOf(minMeer, vid) ?? return #err("De min-meerversie heeft geen vastgelegde inhoud");
    if (not MinMeer.intact(minMeer, v)) { return #err("De controlecode van de min-meerversie klopt niet") };
    #ok((v, fr));
  };

  func slInvoicedNow(workId : Nat) : Int {
    var s : Int = 0;
    for (x in MinMeer.invoicedOf(slMmCtx(), workId).values()) { s += x.cents };
    s;
  };

  // De controle van lib/Sales.mo, plus wat de min-meerstaat vraagt: de slotfactuur volgt een versie die nog klopt met wat intussen
  // gefactureerd werd (anders zou ze dubbel aanrekenen).
  func slFindings(inv : Types.SalesInvoice, pre : Types.SalesFrozen, today : Nat) : [Sales.Finding] {
    let fs = Sales.findings(slCtx(), inv, pre, today);
    switch (inv.kind) {
      case (#minMeer vid) {
        switch (slMmVersion(inv.workId, vid)) {
          case (#ok((_, fr))) { if (fr.totals.invoicedCents != slInvoicedNow(inv.workId)) { return fs.concat([{ key = "min-meer-verouderd"; text = "Sinds deze min-meerversie werd er gefactureerd: maak eerst een nieuwe versie van de min-meerstaat"; block = true }]) } };
          case (#err e) { return fs.concat([{ key = "min-meer"; text = e; block = true }]) };
        };
      };
      case _ {};
    };
    fs;
  };

  func slFull(inv : Types.SalesInvoice) : SV.SalesFullView {
    let c = slCtx();
    let today = slToday();
    let lines = Sales.linesOf(sales, inv);
    let doc = switch (Sales.frozenOf(sales, inv.id)) { case (?f) f; case null Sales.freeze(c, inv, lines, "ONTWERP", 0, today) };
    let t = Sales.totalsOf(doc.lines, inv.vat);
    let m = Sales.money(sales, inv);
    {
      brief = Sales.brief(c, inv, today);
      vat = inv.vat;
      serviceDay = inv.serviceDay;
      serviceTo = inv.serviceTo;
      paymentDays = inv.paymentDays;
      note = inv.note;
      lines = doc.lines;
      totals = { netCents = t.netCents; vatCents = t.vatCents; totalCents = t.totalCents; vatLines = t.vatLines };
      doc;
      hash = inv.hash;
      intact = Sales.intact(sales, inv);
      findings = if (Sales.isDraft(inv)) slFindings(inv, doc, today) else [];
      payments = Sales.paymentsOf(sales, inv.id).map(func(x : Types.SalesPayment) : SV.SalesPaymentView = { id = x.id; day = x.day; cents = x.cents; how = x.how; note = x.note; at = x.at; byName = Access.personName(access, x.by); archived = x.archivedAt != null; archiveReason = x.archiveReason });
      paidCents = m.paidCents;
      creditedCents = m.creditedCents;
      openCents = if (Sales.isIssued(inv) and Sales.creditOfId(inv) == null) m.openCents else 0;
      reminders = sales.reminders.values().filter(func(r : Types.SalesReminder) : Bool = r.invoiceId == inv.id).toArray();
      calcVersion = SalesCalc.version;
      today;
    };
  };

  func slPlanView(workId : Nat, b : Sales.Base, pl : Types.BillingPlan) : SV.SalesPlanView {
    let am = Sales.stepAmounts(b, pl);
    let w = works.works.get(workId);
    let cur = slInvoicedNow(workId);
    {
      workId;
      version = pl.version;
      stored = sales.plans.containsKey(workId);
      calcVersion = SalesCalc.version;
      baseQuote = b.qlabel;
      vatBp = b.vatBp;
      grossCents = b.gross;
      discountCents = b.discount;
      contractCents = b.subtotal;
      chapters = Array.tabulate<SV.SalesChapterNet>(b.chapters.size(), func i = { chapter = b.chapters[i]; sellCents = b.sells[i]; netCents = b.nets[i] });
      steps = Array.tabulate<SV.SalesStepView>(pl.steps.size(), func i {
        let st = pl.steps[i];
        var sum : Int = 0;
        for (x in am[i].values()) { sum += x };
        let (status, numbers) = slStepStatus(workId, st.key);
        { key = st.key; title = st.title; pctBp = st.pctBp; when = st.when; chapterPct = st.chapterPct; amounts = am[i]; stepCents = sum; status; numbers; dueDay = switch w { case (?x) slDueDay(x, st); case null null } };
      });
      minMeer = MinMeer.versionsOf(minMeer, workId).filterMap(func(v : Types.MmVersion) : ?SV.SalesMmVersionBrief = switch (MinMeer.frozenOf(minMeer, v.id)) { case (?fr) ?{ id = v.id; number = v.number; day = v.day; toInvoiceCents = fr.totals.toInvoiceCents; current = fr.totals.invoicedCents == cur }; case null null });
      progress = Progress.statementsOf(progress, workId).filterMap(func(st : Types.ProgressStatement) : ?SV.SalesProgressBrief = if (st.status != #sent or st.kind != #statement) null else switch (Progress.frozenOf(progress, st.id)) { case (?fr) ?{ id = st.id; code = st.code; billing = Progress.billingKey(st.billing); periodCents = fr.totals.periodCents; subtotalCents = fr.totals.subtotalCents }; case null null });
      plannedStart = switch w { case (?x) x.plannedStart; case null null };
    };
  };

  func slNotifyClient(workId : Nat, text : Text) {
    let ctx = { works; settings };
    for (q in access.persons.values()) {
      if (q.archivedAt == null and Access.hasActiveLink(access, q.id) and Rights.salesScope(ctx, q, workId, slClientOrg(workId)) == #client) {
        Access.notify(audit, ctr, q.id, "factuur", text, ?workId);
      };
    };
  };

  // IBAN: landcode, controlegetal mod 97 = 1 (ISO 13616).
  func slIbanOk(t : Text) : Bool {
    let s = Text.fromIter(t.chars().filter(func(ch : Char) : Bool = ch != ' '));
    if (s.size() < 15 or s.size() > 34) { return false };
    let cs = s.chars().toArray();
    let moved = Array.tabulate<Char>(cs.size(), func i = cs[(i + 4) % cs.size()]);
    var rest = 0;
    for (ch in moved.values()) {
      let n = Char.toNat32(ch);
      if (ch >= '0' and ch <= '9') { rest := (rest * 10 + Nat32.toNat(n - 48)) % 97 } else if (ch >= 'A' and ch <= 'Z') { rest := (rest * 100 + Nat32.toNat(n - 55)) % 97 } else if (ch >= 'a' and ch <= 'z') { rest := (rest * 100 + Nat32.toNat(n - 87)) % 97 } else { return false };
    };
    rest == 1;
  };
};
