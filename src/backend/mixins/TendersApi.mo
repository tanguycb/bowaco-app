// Prijsvraag naar onderaannemers (stap 2c.2, ontwerp 2c §4.2; AC-9…AC-11, ⚖2, ⚖4 beslist 29-10): kantoor (beheerder, calculator)
// kopieert posten uit een offerteversie naar een prijsvraag, kiest één of meer firma's, een deadline, een herinnering en de bijlagen;
// per firma PDF en Excel (in de browser) en desgewenst een toegangscode voor de app; "Markeer als verstuurd" zolang de mail in
// testmodus staat (G7). De werfleider van de werf ziet welke firma's, de status en de deadline (R35, nooit een bedrag). Een OA ziet
// in "Mijn prijsvragen" enkel de uitnodigingen aan zijn eigen firma (R37) en wordt GEEN lid van de werf; hij bewaart een ontwerp
// (enkel zijn firma leest het, R38), dient in tot de deadline (opnieuw = een nieuwe versie), laadt zijn eigen PDF op (vertrouwelijk
// aan de werf, R39) of zegt "geen interesse". Bedragen enkel via update-calls met een auditregel (R23); de auditregel draagt nooit
// een bedrag. Herinnering en "geen antwoord": lib/Tenders.tick vanuit Post.tick.
// Private hulpfuncties dragen het voorvoegsel `tn` (ze delen één blok met alle andere mixins).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";
import Views "../types/views";
import TV "../types/tenderviews";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Plan "../lib/Plan";
import Post "../lib/Post";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import TenderCalc "../lib/TenderCalc";
import Tenders "../lib/Tenders";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  oa : Types.OaState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  quoteForms : Types.QuoteFormState,
  tenders : Types.TenderState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func tnCtx() : Tenders.Ctx { { settings; access; org; oa; works; quotes; files } };
  func tnToday() : Types.Day { Post.local(Time.now()).day };
  func tnNewest(a : Types.Tender, b : Types.Tender) : Order.Order { Nat.compare(b.id, a.id) };

  // Een uitnodiging die de beller (een OA) mag lezen; anders null. Onbekend en niet van jou geven hetzelfde antwoord (geen id-orakel).
  func tnOwn(p : Types.Person, inviteId : Nat) : ?(Types.Tender, Types.TenderInvite) {
    let i = tenders.invites.get(inviteId) ?? return null;
    let t = tenders.tenders.get(i.tenderId) ?? return null;
    if (Rights.inviteScope({ works; settings }, p, t, i, Time.now()) != #own) { return null };
    ?(t, i);
  };

  // Kantoor met het volle zicht op de werf van de prijsvraag.
  func tnOffice(p : Types.Person, tenderId : Nat) : ?Types.Tender {
    let t = tenders.tenders.get(tenderId) ?? return null;
    if (not Rights.may({ works; settings }, p, #editTenders, null) or Rights.tenderScope({ works; settings }, p, t.workId) != #full) { return null };
    ?t;
  };

  func tnFirmOk(orgId : Nat) : ?Text {
    switch (org.orgs.get(orgId)) {
      case (?o) { if (o.archivedAt != null) ?("Firma " # o.name # " is gearchiveerd") else if (o.kind != #subcontractor and o.kind != #supplier) ?("Kies een onderaannemer of leverancier (" # o.name # " is dat niet)") else null };
      case null ?"Onbekende firma";
    };
  };

  func tnNewInvite(t : Types.Tender, f : TV.TenderFirmInput, by : Nat, entropy : Blob) : Types.TenderInvite {
    let id = Ids.next(ctr, "tenderInvite");
    let key = Tenders.sheetKey(tenders, entropy, id);
    // Zonder gekozen contact: de persoon van de firma die al toegang heeft, anders de eerste (later te wijzigen).
    let contact = switch (f.contactPersonId) {
      case (?x) ?x;
      case null {
        let cs = Tenders.contactsOf(tnCtx(), f.orgId);
        switch (cs.find(func(c : TV.TenderPersonRef) : Bool = c.linked)) { case (?c) ?c.id; case null { if (cs.size() > 0) ?cs[0].id else null } };
      };
    };
    let i : Types.TenderInvite = { id; tenderId = t.id; orgId = f.orgId; contactPersonId = contact; status = #ready; outcome = #open; askedDay = null; remindedDay = null; ownDeadline = null; answeredAt = null; declineReason = ""; channels = []; accessCodeId = null; sheetKey = key; createdAt = Time.now(); createdBy = by; extra = [] };
    tenders.invites.add(id, i);
    Tenders.addIndex(tenders.invitesByTender, t.id, id);
    Tenders.addIndex(tenders.invitesByOrg, f.orgId, id);
    if (key != "") { tenders.sheetKeys.add(key, id) };
    i;
  };

  func tnNotifyOffice(t : Types.Tender, kind : Text, text : Text) {
    let maker = switch (access.persons.get(t.createdBy)) { case (?p) { if (p.archivedAt == null and Rights.isOffice(p)) ?p.id else null }; case null null };
    switch maker { case (?id) Access.notify(audit, ctr, id, kind, text, ?t.workId); case null Access.notifyAdmins(access, audit, ctr, kind, text) };
  };

  // ── Kantoor en werfleider: lijsten zonder bedragen ─────────────────────
  // Per werf (R35: admin, calculator, de werfleider van de werf) of over alle werven (werklijst Offertes → Prijsvragen: wat de beller
  // per werf mag zien). Nieuwste eerst.
  public query ({ caller }) func listTenders(workId : ?Nat) : async [TV.TenderStatusView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let c = tnCtx();
    switch workId {
      case (?w) {
        Rights.require(ctx, p, #readTenders, ?w);
        Tenders.tendersOfWork(tenders, w).sort(tnNewest).map(func(t : Types.Tender) : TV.TenderStatusView = Tenders.statusView(c, tenders, t));
      };
      case null {
        Rights.require(ctx, p, #quotesOverview, null);
        let all = tenders.tenders.values().filter(func(t : Types.Tender) : Bool = Rights.tenderScope(ctx, p, t.workId) != #none).toArray().sort(tnNewest);
        Access.page(all, 0, Config.maxTenderList).map(func(t : Types.Tender) : TV.TenderStatusView = Tenders.statusView(c, tenders, t));
      };
    };
  };

  // De prijsvraag zelf (kantoor): posten, firma's, bijlagen, notitie en de sleutel van de Excel per firma. Zonder bedragen.
  public query ({ caller }) func readTender(tenderId : Nat) : async Result.Result<TV.TenderView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editTenders, null);
    let t = tnOffice(p, tenderId) ?? return #err("Geen toegang");
    #ok(Tenders.fullView(tnCtx(), tenders, t));
  };

  // Een voorstel van firma's voor de gekozen posten: het vakgebied van de posten, de standaard-OA in de bibliotheek, eerdere
  // offertes op dezelfde posten; met de standaarddeadline (10 werkdagen, kalender van de werf) en de herinnering.
  public query ({ caller }) func tenderSuggestions(versionId : Nat, lineIds : [Nat]) : async Result.Result<{ firms : [TV.TenderSuggestion]; deadlineDay : Types.Day; remindDays : Nat }, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editTenders, null);
    if (lineIds.size() > Config.maxTenderItems) { return #err("Te veel posten") };
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende versie");
    if (Rights.tenderScope(ctx, p, q.workId) != #full) { return #err("Geen toegang") };
    let trades = Map.empty<Text, Bool>();
    let stdOrgs = Map.empty<Nat, Bool>();
    let libItems = Map.empty<Nat, Bool>();
    for (lid in lineIds.values()) {
      switch (quotes.lines.get(lid)) {
        case (?l) {
          if (l.versionId == versionId) {
            switch (l.libItemId) {
              case (?it) {
                libItems.add(it, true);
                switch (library.items.get(it)) {
                  case (?x) {
                    switch (x.trade) { case (?tr) trades.add(tr, true); case null {} };
                    switch (x.orgId) { case (?o) stdOrgs.add(o, true); case null {} };
                  };
                  case null {};
                };
              };
              case null {};
            };
          };
        };
        case null {};
      };
    };
    let c = tnCtx();
    var out : [TV.TenderSuggestion] = [];
    for (o in org.orgs.values()) {
      if (o.archivedAt == null and (o.kind == #subcontractor or o.kind == #supplier)) {
        var reasons : [Text] = [];
        if (o.trades.any(func(tr : Text) : Bool = trades.containsKey(tr))) { reasons := reasons.concat(["vakgebied"]) };
        if (stdOrgs.containsKey(o.id)) { reasons := reasons.concat(["standaard-OA"]) };
        let invs = Tenders.ids(tenders.invitesByOrg, o.id).filterMap(func(id : Nat) : ?Types.TenderInvite = tenders.invites.get(id));
        let earlier = invs.any(func(i : Types.TenderInvite) : Bool = Tenders.itemsOf(tenders, i.tenderId).any(func(x : Types.TenderItem) : Bool = switch (quotes.lines.get(x.lineId)) { case (?l) { switch (l.libItemId) { case (?it) libItems.containsKey(it); case null false } }; case null false }));
        if (earlier) { reasons := reasons.concat(["eerdere offerte"]) };
        if (reasons.size() > 0) {
          let qs = tenders.oaQuotes.values().filter(func(x : Types.OaQuote) : Bool = x.orgId == o.id).toArray();
          var last : ?Types.Day = null;
          for (x in qs.values()) { switch last { case (?d) { if (x.quoteDay > d) { last := ?x.quoteDay } }; case null { last := ?x.quoteDay } } };
          out := out.concat([{ orgId = o.id; orgName = o.name; kind = o.kind; trades = o.trades; reasons; quotes = qs.size(); chosen = invs.filter(func(i : Types.TenderInvite) : Bool = i.outcome == #chosen).size(); lastQuoteDay = last; contacts = Tenders.contactsOf(c, o.id) }]);
        };
      };
    };
    let sorted = out.sort(func(a : TV.TenderSuggestion, b : TV.TenderSuggestion) : Order.Order {
      switch (Nat.compare(b.reasons.size(), a.reasons.size())) { case (#equal) { switch (Nat.compare(b.chosen, a.chosen)) { case (#equal) Text.compare(a.orgName, b.orgName); case x x } }; case x x };
    });
    let cal = Plan.calFor(plan, works, q.workId);
    #ok({ firms = sorted; deadlineDay = Plan.addWorkdays(cal, tnToday(), Dossier.setting(settings, "tender.deadlineDays", Config.tenderDeadlineDays)); remindDays = Dossier.setting(settings, "tender.remindDays", Config.tenderRemindDays) });
  };

  // ── Kantoor: maken en klaarzetten (R36) ────────────────────────────────
  // Klaarzetten = de posten worden gekopieerd (de offerte kan nog veranderen, de prijsvraag niet) en de inhoud krijgt een
  // controlecode (G5). Elke firma krijgt een uitnodiging (status klaar) met een eigen sleutel voor de Excel.
  public shared ({ caller }) func createTender(i : TV.TenderInput) : async Result.Result<Nat, Text> {
    let p0 = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p0, #editTenders, null);
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken; alles hieronder in één bericht.
    let p = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #editTenders, null)) { return #err("Geen toegang meer") };
    let v = quotes.versions.get(i.versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende versie");
    if (Rights.tenderScope(ctx, p, q.workId) != #full) { return #err("Geen toegang") };
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (v.status == #withdrawn or v.status == #rejected or v.status == #superseded) { return #err("Versie " # v.version.toText() # " is " # Quotes.statusText(v.status) # ": kies de lopende versie") };
    let title = Access.cleanText(i.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    if (i.noteForOa.size() > Config.maxTenderNote) { return #err("Bericht te lang") };
    if (i.internalNote.size() > Config.maxNote) { return #err("Notitie te lang") };
    let today = tnToday();
    if (i.deadlineDay <= today or i.deadlineDay > today + 365) { return #err("Deadline: na vandaag en binnen een jaar") };
    if (i.remindDays > Config.maxTenderRemindDays) { return #err("Herinnering: 0 tot " # Config.maxTenderRemindDays.toText() # " werkdagen vooraf") };
    if (i.lineIds.size() == 0) { return #err("Kies minstens één post") };
    if (i.lineIds.size() > Config.maxTenderItems) { return #err("Hoogstens " # Config.maxTenderItems.toText() # " posten per prijsvraag") };
    if (i.firms.size() == 0) { return #err("Kies minstens één firma") };
    if (i.firms.size() > Config.maxTenderFirms) { return #err("Hoogstens " # Config.maxTenderFirms.toText() # " firma's per prijsvraag") };
    if (i.fileIds.size() > Config.maxTenderFiles) { return #err("Hoogstens " # Config.maxTenderFiles.toText() # " bijlagen") };
    if (Tenders.tendersOfWork(tenders, q.workId).filter(func(t : Types.Tender) : Bool = t.quoteId == q.id).size() >= Config.maxTendersPerQuote) { return #err("Te veel prijsvragen voor deze offerte") };
    // Bijlagen: enkel bestanden van deze werf, niet vertrouwelijk, niet gearchiveerd (R39).
    for (fid in i.fileIds.values()) {
      let f = files.files.get(fid) ?? return #err("Onbekend bestand");
      if (f.workId != ?q.workId or f.confidential or f.archivedAt != null) { return #err("Bijlage " # f.name # ": enkel een niet-vertrouwelijk bestand van deze werf") };
    };
    let seenOrg = Map.empty<Nat, Bool>();
    for (f in i.firms.values()) {
      switch (tnFirmOk(f.orgId)) { case (?e) return #err(e); case null {} };
      if (seenOrg.containsKey(f.orgId)) { return #err("Een firma staat twee keer in de lijst") };
      seenOrg.add(f.orgId, true);
      switch (f.contactPersonId) { case (?pid) { if (not Tenders.validContact(tnCtx(), f.orgId, pid)) { return #err("De contactpersoon hoort niet bij die firma (of heeft geen rol onderaannemer)") } }; case null {} };
    };
    // De posten in de volgorde van de offerte: per hoofdstuk eerst zonder subgroep, dan per subgroep.
    let chapters = Quotes.chaptersOf(quotes, v.id);
    let lines = Quotes.linesOf(quotes, v.id, chapters);
    let want = Map.empty<Nat, Bool>();
    for (lid in i.lineIds.values()) {
      if (want.containsKey(lid)) { return #err("Een post staat twee keer in de lijst") };
      want.add(lid, true);
      switch (lines.find(func(l : Types.QuoteLine) : Bool = l.id == lid)) {
        case (?l) { if (l.kind == #text) { return #err("Een tekstregel kan niet in een prijsvraag") } };
        case null return #err("Deze post hoort niet bij versie " # v.version.toText());
      };
    };
    let sgs = Map.empty<Nat, Types.QuoteSubgroup>();
    for (s in tnSubgroups(v.id).values()) { sgs.add(s.id, s) };
    let chPos = Map.empty<Nat, (Nat, Text)>();
    for ((k, ch) in chapters.enumerate()) { chPos.add(ch.id, (k, (ch.code # " " # ch.title).trim(#char ' '))) };
    type Pick = { line : Types.QuoteLine; chapter : Text; sub : Text; key : (Nat, Nat, Nat, Nat) };
    var picks : [Pick] = [];
    for ((k, l) in lines.enumerate()) {
      if (want.containsKey(l.id)) {
        let (cp, ct) = switch (chPos.get(l.chapterId)) { case (?x) x; case null (1_000_000, "") };
        let sg = switch (quoteForms.lineForms.get(l.id)) { case (?lf) { switch (lf.subgroupId) { case (?s) sgs.get(s); case null null } }; case null null };
        let (so, st) = switch sg { case (?s) (s.order + 1, s.title); case null (0, "") };
        picks := picks.concat([{ line = l; chapter = ct; sub = st; key = (cp, so, (switch sg { case (?s) s.id; case null 0 }), k) }]);
      };
    };
    let sorted = picks.sort(func(a : Pick, b : Pick) : Order.Order {
      let (a1, a2, a3, a4) = a.key;
      let (b1, b2, b3, b4) = b.key;
      switch (Nat.compare(a1, b1)) { case (#equal) { switch (Nat.compare(a2, b2)) { case (#equal) { switch (Nat.compare(a3, b3)) { case (#equal) Nat.compare(a4, b4); case x x } }; case x x } }; case x x };
    });
    // Nummer per offerte (G10: uit settings.sequences, nooit size()).
    let seqKey = "prijsvraag:" # q.id.toText();
    let n = (switch (settings.sequences.get(seqKey)) { case (?x) x; case null 0 }) + 1;
    settings.sequences.add(seqKey, n);
    let id = Ids.next(ctr, "tender");
    let now = Time.now();
    var items : [Types.TenderItem] = [];
    for ((k, x) in sorted.enumerate()) {
      let iid = Ids.next(ctr, "tenderItem");
      let l = x.line;
      let it : Types.TenderItem = { id = iid; tenderId = id; root = WorkStart.root(quotes, l.id); lineId = l.id; chapter = x.chapter; subgroup = x.sub; code = l.code; title = l.title; text = l.text; unit = l.unit; qtyMilli = l.qtyMilli; form = l.form; order = (k + 1) * 10; key = "PV" # id.toText() # "." # iid.toText() };
      items := items.concat([it]);
    };
    let base : Types.Tender = { id; workId = q.workId; quoteId = q.id; versionId = v.id; number = n; code = "PV " # q.number # "-" # n.toText(); title; noteForOa = i.noteForOa.trim(#char ' '); internalNote = i.internalNote.trim(#char ' '); deadlineDay = i.deadlineDay; remindDays = i.remindDays; status = #open; fileIds = i.fileIds; addressMode = i.addressMode; sentHash = ""; rev = 0; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra = [] };
    let addr = switch (works.works.get(q.workId)) { case (?w) Tenders.myAddress(w.address, i.addressMode); case null { { street = ""; number = ""; zip = ""; city = "" } } };
    let t = { base with sentHash = Tenders.hash(Tenders.canonical(base, items, addr)) };
    tenders.tenders.add(id, t);
    Tenders.addIndex(tenders.byWork, q.workId, id);
    for (it in items.values()) { tenders.items.add(it.id, it); Tenders.addIndex(tenders.itemsByTender, id, it.id) };
    for (f in i.firms.values()) { ignore tnNewInvite(t, f, p.id, entropy) };
    Access.audit(audit, caller, ?p.id, ?q.workId, "prijsvraag-gemaakt", t.code # " · " # title # ": " # items.size().toText() # " posten, " # i.firms.size().toText() # " firma's");
    #ok(id);
  };

  func tnSubgroups(versionId : Nat) : [Types.QuoteSubgroup] {
    let xs = switch (quoteForms.subgroupsByVersion.get(versionId)) { case (?x) x; case null [] };
    xs.filterMap(func(id : Nat) : ?Types.QuoteSubgroup = quoteForms.subgroups.get(id)).filter(func(s : Types.QuoteSubgroup) : Bool = s.archivedAt == null);
  };

  // Nog een firma vragen terwijl de prijsvraag loopt (de inhoud en dus de controlecode blijven dezelfde).
  public shared ({ caller }) func addTenderFirm(tenderId : Nat, f : TV.TenderFirmInput) : async Result.Result<Nat, Text> {
    let p0 = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p0, #editTenders, null);
    let entropy = await Random.blob();
    let p = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    let t = tnOffice(p, tenderId) ?? return #err("Geen toegang");
    if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
    switch (tnFirmOk(f.orgId)) { case (?e) return #err(e); case null {} };
    if (Tenders.invitesOf(tenders, t.id).any(func(x : Types.TenderInvite) : Bool = x.orgId == f.orgId)) { return #err("Deze firma is al gevraagd") };
    if (Tenders.invitesOf(tenders, t.id).size() >= Config.maxTenderFirms) { return #err("Hoogstens " # Config.maxTenderFirms.toText() # " firma's per prijsvraag") };
    switch (f.contactPersonId) { case (?pid) { if (not Tenders.validContact(tnCtx(), f.orgId, pid)) { return #err("De contactpersoon hoort niet bij die firma (of heeft geen rol onderaannemer)") } }; case null {} };
    let i = tnNewInvite(t, f, p.id, entropy);
    Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-firma-erbij", t.code # ": " # Tenders.orgName(tnCtx(), f.orgId));
    #ok(i.id);
  };

  // Verlengen, annuleren, afsluiten (met de gekozen firma's; de keuze per post volgt in 2c.3) of de interne notitie.
  public shared ({ caller }) func updateTender(tenderId : Nat, rev : Nat, op : TV.TenderOp) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editTenders, null);
    let t = tnOffice(p, tenderId) ?? return #err("Geen toegang");
    if (rev != t.rev) { return #err("Iemand anders wijzigde deze prijsvraag intussen; laad opnieuw") };
    let now = Time.now();
    let today = tnToday();
    let next = { t with rev = t.rev + 1; updatedAt = now; updatedBy = p.id };
    switch op {
      case (#extend day) {
        if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
        if (day < today or day > today + 365) { return #err("Deadline: vandaag of later, binnen een jaar") };
        tenders.tenders.add(t.id, { next with deadlineDay = day });
        // Wie "geen antwoord" had, mag weer antwoorden als de nieuwe deadline nog komt.
        for (i in Tenders.invitesOf(tenders, t.id).values()) {
          if (i.status == #noAnswer and Tenders.deadlineOf({ t with deadlineDay = day }, i) >= today) {
            tenders.invites.add(i.id, { i with status = if (i.remindedDay != null) #reminded else #asked });
          };
        };
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-verlengd", t.code # ": " # Plan.fmtDay(t.deadlineDay) # " → " # Plan.fmtDay(day));
      };
      case (#cancel reason) {
        if (t.status != #open and t.status != #draft) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
        let r = reason.trim(#char ' ');
        if (r.size() < 3 or r.size() > Config.maxWorkStartReason) { return #err("Geef een reden (3 tot " # Config.maxWorkStartReason.toText() # " tekens)") };
        tenders.tenders.add(t.id, { next with status = #cancelled({ at = now; by = p.id; reason = r }) });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-geannuleerd", t.code # ": " # r);
      };
      case (#close chosen) {
        if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
        let invs = Tenders.invitesOf(tenders, t.id);
        for (c in chosen.values()) { if (invs.find(func(i : Types.TenderInvite) : Bool = i.id == c) == null) { return #err("Deze firma is niet gevraagd in deze prijsvraag") } };
        for (i in invs.values()) {
          let pick = chosen.find(func(c : Nat) : Bool = c == i.id) != null;
          tenders.invites.add(i.id, { i with outcome = if pick #chosen else #thanked({ at = now; notified = false }) });
        };
        tenders.tenders.add(t.id, { next with status = #closed({ at = now; by = p.id }) });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-afgesloten", t.code # ": " # chosen.size().toText() # " gekozen, " # (invs.size() - chosen.size()).toText() # " bedankt");
      };
      case (#internalNote x) {
        if (x.size() > Config.maxNote) { return #err("Notitie te lang") };
        tenders.tenders.add(t.id, { next with internalNote = x.trim(#char ' ') });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-notitie", t.code);
      };
    };
    #ok;
  };

  // Per firma: markeer als verstuurd (zolang de mail in testmodus staat), een eigen deadline, "geen interesse" of de contactpersoon.
  public shared ({ caller }) func updateTenderInvite(inviteId : Nat, op : TV.TenderInviteOp) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editTenders, null);
    let i = tenders.invites.get(inviteId) ?? return #err("Geen toegang");
    let t = tnOffice(p, i.tenderId) ?? return #err("Geen toegang");
    if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
    let today = tnToday();
    let firm = Tenders.orgName(tnCtx(), i.orgId);
    switch op {
      case (#markSent chs) {
        if (chs.size() == 0 or chs.size() > 4 or not chs.all(Tenders.channelOk)) { return #err("Kies hoe je het verstuurde: pdf, excel, app of mail") };
        var all = i.channels;
        for (c in chs.values()) { if (all.find(func(x : Text) : Bool = x == c) == null) { all := all.concat([c]) } };
        let first = i.status == #ready;
        tenders.invites.add(i.id, { i with channels = all; status = if first #asked else i.status; askedDay = if first ?today else i.askedDay });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-verstuurd", t.code # ": " # firm # " (" # Text.join(chs.values(), ", ") # ")");
      };
      case (#extend d) {
        switch d { case (?x) { if (x < today or x > today + 365) { return #err("Deadline: vandaag of later, binnen een jaar") } }; case null {} };
        let ni = { i with ownDeadline = d };
        let back = i.status == #noAnswer and Tenders.deadlineOf(t, ni) >= today;
        tenders.invites.add(i.id, { ni with status = if back { if (i.remindedDay != null) #reminded else #asked } else i.status });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-eigen-deadline", t.code # ": " # firm # " → " # (switch d { case (?x) Plan.fmtDay(x); case null "die van de prijsvraag" }));
      };
      case (#declined reason) {
        if (i.status == #received) { return #err("Deze firma diende al een offerte in") };
        if (reason.size() > Config.maxNote) { return #err("Reden te lang") };
        tenders.invites.add(i.id, { i with status = #declined; declineReason = reason.trim(#char ' '); answeredAt = ?Time.now() });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-geen-interesse", t.code # ": " # firm # " (door kantoor)");
      };
      case (#contact pid) {
        switch pid { case (?x) { if (not Tenders.validContact(tnCtx(), i.orgId, x)) { return #err("De contactpersoon hoort niet bij die firma (of heeft geen rol onderaannemer)") } }; case null {} };
        tenders.invites.add(i.id, { i with contactPersonId = pid });
        Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-contact", t.code # ": " # firm);
      };
    };
    #ok;
  };

  // Toegang in de app (⚖2): een toegangscode voor de contactpersoon, rol onderaannemer, ZONDER werf (hij wordt geen lid). Heeft hij al
  // een login, dan is er geen code nodig: de prijsvraag staat meteen in Mijn prijsvragen zodra ze verstuurd is. Een vorige, nog open
  // code van deze uitnodiging wordt ingetrokken (enkel de hash bestaat; een code toon je één keer).
  public shared ({ caller }) func tenderAccess(inviteId : Nat, validDays : Nat) : async Result.Result<TV.TenderAccessResult, Text> {
    let p0 = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p0, #editTenders, null);
    let entropy = await Random.blob();
    let p = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    let i = tenders.invites.get(inviteId) ?? return #err("Geen toegang");
    let t = tnOffice(p, i.tenderId) ?? return #err("Geen toegang");
    if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status)) };
    let pid = i.contactPersonId ?? return #err("Kies eerst de contactpersoon van de firma");
    let who = access.persons.get(pid) ?? return #err("Onbekende persoon");
    if (not Tenders.validContact(tnCtx(), i.orgId, pid) or not who.roles.all(Rights.isExternalRole)) { return #err("De contactpersoon hoort niet bij die firma (of heeft geen rol onderaannemer)") };
    let addApp = func(ch : [Text]) : [Text] = if (ch.find(func(x : Text) : Bool = x == "app") == null) ch.concat(["app"]) else ch;
    if (Access.hasActiveLink(access, pid)) {
      tenders.invites.add(i.id, { i with channels = addApp(i.channels) });
      Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-toegang", t.code # ": " # who.name # " heeft al toegang");
      return #ok({ code = null; expiresAt = null; alreadyLinked = true; personName = who.name });
    };
    switch (i.accessCodeId) {
      case (?old) { switch (access.invites.get(old)) { case (?inv) { if (inv.state == #open) { inv.state := #revoked({ by = p.id; at = Time.now() }) } }; case null {} } };
      case null {};
    };
    let code = Access.newCode(access, settings, ctr, pid, #invite, p.id, validDays, "prijsvraag " # t.code, [], entropy);
    tenders.invites.add(i.id, { i with accessCodeId = ?code.id; channels = addApp(i.channels) });
    Access.audit(audit, caller, ?p.id, null, "uitnodiging-gemaakt", who.name # " [onderaannemer] (prijsvraag " # t.code # ", zonder werf, code …" # Codes.hint(code.body) # ")");
    if (not Rights.isAdmin(p)) { Access.notifyAdmins(access, audit, ctr, "uitnodiging", p.name # " gaf " # who.name # " (" # Tenders.orgName(tnCtx(), i.orgId) # ") toegang voor prijsvraag " # t.code # " (zonder werf)") };
    #ok({ code = ?Codes.display(code.body); expiresAt = ?code.expiresAt; alreadyLinked = false; personName = who.name });
  };

  // R38: een OA-offerte met haar bedragen (kantoor), update-call met auditregel "bekeek:oa-offerte:<id>".
  public shared ({ caller }) func readOaQuote(oaQuoteId : Nat) : async Result.Result<TV.OaQuoteFull, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editTenders, null);
    Rights.require(ctx, p, #readCosts, null);
    let q = tenders.oaQuotes.get(oaQuoteId) ?? return #err("Geen toegang");
    if (Rights.tenderScope(ctx, p, q.workId) != #full) { return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, ?q.workId, "bekeek:oa-offerte:" # q.id.toText(), Tenders.orgName(tnCtx(), q.orgId) # " v" # q.version.toText());
    #ok(Tenders.fullQuote(tnCtx(), tenders, q));
  };

  // ── De OA: Mijn prijsvragen (R37) ──────────────────────────────────────
  public query ({ caller }) func listMyTenders() : async [TV.MyTenderBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownTenders, null);
    let o = p.orgId ?? return [];
    let now = Time.now();
    let today = tnToday();
    let c = tnCtx();
    var out : [TV.MyTenderBrief] = [];
    for (id in Tenders.ids(tenders.invitesByOrg, o).values()) {
      switch (tenders.invites.get(id)) {
        case (?i) {
          switch (tenders.tenders.get(i.tenderId)) {
            case (?t) { if (Rights.inviteScope(ctx, p, t, i, now) == #own) { out := out.concat([Tenders.myBrief(c, tenders, t, i, Rights.mayAnswerInvite(ctx, p, t, i, now, today))]) } };
            case null {};
          };
        };
        case null {};
      };
    };
    out.sort(func(a : TV.MyTenderBrief, b : TV.MyTenderBrief) : Order.Order = Nat.compare(b.inviteId, a.inviteId));
  };

  public query ({ caller }) func readMyTender(inviteId : Nat) : async Result.Result<TV.MyTenderView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownTenders, null);
    let (t, i) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    #ok(Tenders.myView(tnCtx(), tenders, t, i, Rights.mayAnswerInvite({ works; settings }, p, t, i, Time.now(), tnToday())));
  };

  // Zijn eigen ontwerp en zijn eigen ingediende versies met zijn prijzen (update-call met auditregel, R38: kantoor leest het ontwerp nooit).
  public shared ({ caller }) func readMyTenderAnswer(inviteId : Nat) : async Result.Result<TV.MyTenderAnswer, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownTenders, null);
    let (t, i) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    Access.audit(audit, caller, ?p.id, null, "bekeek:prijsvraag-eigen-antwoord", t.code);
    let c = tnCtx();
    #ok({
      draft = switch (Tenders.draftOf(tenders, i.id)) { case (?d) ?Tenders.draftView(c, tenders, d); case null null };
      versions = Tenders.oaQuotesOfInvite(tenders, i, t.workId).map(func(q : Types.OaQuote) : TV.OaQuoteFull = Tenders.fullQuote(c, tenders, q));
      calcVersion = TenderCalc.version;
    });
  };

  // Bewaren (ontwerp, enkel zijn firma) of indienen (kantoor ziet het; tot de deadline opnieuw = een nieuwe versie). Bij indienen
  // rekent de server na: een ander totaal dan wat de browser toonde = niets bewaard (G4).
  public shared ({ caller }) func saveMyTender(inviteId : Nat, d : TV.OaDraftInput, submit : Bool, expectNetCents : Int) : async Result.Result<TV.MyTenderSaved, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownTenders, null);
    let (t, i) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    let today = tnToday();
    if (not Rights.mayAnswerInvite(ctx, p, t, i, Time.now(), today)) { return #err("De deadline is voorbij of de prijsvraag is afgesloten: enkel lezen") };
    if (d.number.size() > 40) { return #err("Offertenummer: hoogstens 40 tekens") };
    if (d.remark.size() > Config.maxNote) { return #err("Opmerking te lang") };
    switch (d.discountBp) { case (?bp) { if (bp > 5_000) { return #err("Korting: 0 tot 50 %") } }; case null {} };
    switch (d.quoteDay) { case (?x) { if (x + 400 < today or x > today + 30) { return #err("Datum van uw offerte buiten bereik") } }; case null {} };
    switch (d.validUntil) { case (?x) { if (x > today + 730) { return #err("Geldig tot: hoogstens twee jaar") } }; case null {} };
    let nItems = Tenders.ids(tenders.itemsByTender, t.id).size();
    if (d.lines.size() > nItems + Config.maxTenderOwnLines) { return #err("Te veel regels") };
    let lines = switch (Tenders.answerLines(tenders, t.id, d.lines, Config.maxTenderOwnLines, Config.maxLibText, Config.maxAmountCents, Config.maxQuoteQtyMilli)) { case (#ok x) x; case (#err e) return #err(e) };
    let tot = TenderCalc.totals(lines, d.discountBp, Tenders.chapterFn(tenders));
    let now = Time.now();
    let prevFile = switch (Tenders.draftOf(tenders, i.id)) { case (?x) x.fileId; case null null };
    if (not submit) {
      tenders.drafts.add(i.id, #plain({ inviteId = i.id; number = d.number.trim(#char ' '); quoteDay = d.quoteDay; validUntil = d.validUntil; discountBp = d.discountBp; reverse = d.reverse; lines; fileId = prevFile; remark = d.remark.trim(#char ' '); updatedAt = now; updatedBy = p.id; extra = [] }));
      Access.audit(audit, caller, ?p.id, null, "prijsvraag-ontwerp-bewaard", t.code # " (" # lines.size().toText() # " regels)");
      return #ok({ netCents = tot.net; oaQuoteId = null; version = null });
    };
    if (tot.net != expectNetCents) { return #err("Het totaal klopt niet met wat de server rekent: laad opnieuw (niets ingediend)") };
    if (lines.size() == 0) { return #err("Vul minstens één post in") };
    let prev = Tenders.oaQuotesOfInvite(tenders, i, t.workId);
    let version = prev.size() + 1;
    let id = Ids.next(ctr, "oaQuote");
    let q : Types.OaQuote = { id; workId = t.workId; orgId = i.orgId; tenderId = ?t.id; inviteId = ?i.id; number = d.number.trim(#char ' '); quoteDay = switch (d.quoteDay) { case (?x) x; case null today }; validUntil = d.validUntil; fileId = prevFile; source = #app; version; supersedes = if (prev.size() == 0) null else ?prev[prev.size() - 1].id; status = #received; vatRegime = if (d.reverse) #reverse else #normal(2_100); note = ""; createdAt = now; createdBy = p.id; extra = [] };
    tenders.oaQuotes.add(id, q);
    Tenders.addIndex(tenders.oaQuotesByWork, t.workId, id);
    tenders.amounts.add(id, #plain({ oaQuoteId = id; netCents = tot.net; discountBp = d.discountBp; lines; chapterTotals = tot.chapters; remark = d.remark.trim(#char ' '); extra = [("rekenversie", TenderCalc.version.toText())] }));
    tenders.drafts.remove(i.id);
    tenders.invites.add(i.id, { i with status = #received; answeredAt = ?now });
    let firm = Tenders.orgName(tnCtx(), i.orgId);
    Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-ingediend", t.code # ": " # firm # " versie " # version.toText() # " (" # lines.size().toText() # " regels)");
    tnNotifyOffice(t, "prijsvraag-ingediend", firm # " diende een offerte in op " # t.code # " · " # t.title # (if (version > 1) " (versie " # version.toText() # ")" else ""));
    #ok({ netCents = tot.net; oaQuoteId = ?id; version = ?version });
  };

  // "Geen interesse" van de OA zelf (zolang hij nog niets indiende).
  public shared ({ caller }) func declineMyTender(inviteId : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownTenders, null);
    let (t, i) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    if (not Rights.mayAnswerInvite(ctx, p, t, i, Time.now(), tnToday())) { return #err("De deadline is voorbij of de prijsvraag is afgesloten: enkel lezen") };
    if (i.status == #received) { return #err("U diende al een offerte in") };
    if (reason.size() > Config.maxNote) { return #err("Reden te lang") };
    tenders.invites.add(i.id, { i with status = #declined; declineReason = reason.trim(#char ' '); answeredAt = ?Time.now() });
    let firm = Tenders.orgName(tnCtx(), i.orgId);
    Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-geen-interesse", t.code # ": " # firm);
    tnNotifyOffice(t, "prijsvraag-geen-interesse", firm # " heeft geen interesse in " # t.code # " · " # t.title);
    #ok;
  };

  // R39: een bijlage van de prijsvraag lezen (nooit een vertrouwelijk bestand, nooit een bestand dat er niet aan hangt).
  public shared ({ caller }) func readTenderFile(inviteId : Nat, fileId : Nat) : async Result.Result<Views.FileView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownTenders, null);
    let (t, _) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    if (t.fileIds.find(func(x : Nat) : Bool = x == fileId) == null) { return #err("Geen toegang") };
    let f = files.files.get(fileId) ?? return #err("Geen toegang");
    if (f.confidential or f.archivedAt != null) { return #err("Geen toegang") };
    Access.audit(audit, caller, ?p.id, null, "bekeek:prijsvraag-bijlage", t.code # " #" # fileId.toText());
    #ok(Dossier.fileView(f));
  };

  // R39: zijn eigen offerte als PDF opladen (vertrouwelijk aan de werf; hij ziet daarna naam en grootte, nooit de opslag-URL).
  public shared ({ caller }) func addMyTenderFile(inviteId : Nat, name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownTenders, null);
    let (t, i) = tnOwn(p, inviteId) ?? return #err("Geen toegang");
    if (not Rights.mayAnswerInvite(ctx, p, t, i, Time.now(), tnToday())) { return #err("De deadline is voorbij of de prijsvraag is afgesloten: enkel lezen") };
    let n = Access.cleanText(name, 200) ?? return #err("Bestandsnaam: 1 tot 200 tekens");
    if (mime != "application/pdf") { return #err("Enkel een PDF") };
    if (size == 0 or size > Config.maxFileBytes) { return #err("Bestand te groot") };
    if (blob.size() > 200) { return #err("Het bestand klopt niet") };
    if (files.files.values().filter(func(f : Types.FileRef) : Bool = f.personId == p.id).size() >= Config.maxFilesPerPerson) { return #err("De opslagruimte is vol. Neem contact op met BOWACO") };
    let now = Time.now();
    let fid = Ids.next(ctr, "file");
    let fr : Types.FileRef = { id = fid; name = n; mime; size; blob; workId = ?t.workId; confidential = true; personId = p.id; at = now; var archivedAt = null };
    files.files.add(fid, fr);
    let old = Tenders.draftOf(tenders, i.id);
    // Het vorige bestand van het ontwerp (nog niet ingediend) gaat weg; een ingediende versie houdt het hare.
    switch old {
      case (?d) {
        switch (d.fileId) {
          case (?prev) {
            let used = Tenders.oaQuotesOfInvite(tenders, i, t.workId).any(func(q : Types.OaQuote) : Bool = q.fileId == ?prev);
            if (not used) { switch (files.files.get(prev)) { case (?f) { f.archivedAt := ?now }; case null {} } };
          };
          case null {};
        };
      };
      case null {};
    };
    let d : Types.OaQuoteDraft = switch old {
      case (?x) { { x with fileId = ?fid; updatedAt = now; updatedBy = p.id } };
      case null { { inviteId = i.id; number = ""; quoteDay = null; validUntil = null; discountBp = null; reverse = true; lines = []; fileId = ?fid; remark = ""; updatedAt = now; updatedBy = p.id; extra = [] } };
    };
    tenders.drafts.add(i.id, #plain(d));
    Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-bestand-opgeladen", t.code # ": " # n # " (" # size.toText() # " B, vertrouwelijk)");
    #ok(fid);
  };
};
