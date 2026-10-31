// Prijsvragen naar onderaannemers (stap 2c.2, ontwerp 2c §4.2): het domein `tenders` lezen, de views opbouwen, de controlecode
// van de inhoud en de klokjob van de herinneringen. Geen rechten hier (lib/Rights.mo beslist: tenderScope, inviteScope), geen
// bedragen in een view van dit bestand behalve `answerLines` (enkel voor update-calls met een auditregel, R38).
// Geen import van lib/Post.mo (die roept `tick` hieronder aan).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Types "../types";
import TV "../types/tenderviews";
import Access "Access";
import Codes "Codes";
import Plan "Plan";
import Quotes "Quotes";
import Rights "Rights";
import TenderCalc "TenderCalc";
import Sha256 "mo:sha2/Sha256";

module {
  type TS = Types.TenderState;
  type Day = Types.Day;

  public type Ctx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    org : Types.OrgState;
    oa : Types.OaState;
    works : Types.WorksState;
    quotes : Types.QuotesState;
    files : Types.FileState;
  };

  func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  // ── Kleine hulp ──────────────────────────────────────────────────────────
  public func ids(m : Map.Map<Nat, [Nat]>, key : Nat) : [Nat] { Quotes.ids(m, key) };
  public func addIndex(m : Map.Map<Nat, [Nat]>, key : Nat, id : Nat) { Quotes.addIndex(m, key, id) };

  public func deadlineOf(t : Types.Tender, i : Types.TenderInvite) : Day {
    switch (i.ownDeadline) { case (?d) { if (d > t.deadlineDay) d else t.deadlineDay }; case null t.deadlineDay };
  };

  public func itemsOf(ts : TS, tenderId : Nat) : [Types.TenderItem] {
    ids(ts.itemsByTender, tenderId).filterMap(func(id : Nat) : ?Types.TenderItem = ts.items.get(id)).sort(func(a : Types.TenderItem, b : Types.TenderItem) : Order.Order = Nat.compare(a.order, b.order));
  };

  public func invitesOf(ts : TS, tenderId : Nat) : [Types.TenderInvite] {
    ids(ts.invitesByTender, tenderId).filterMap(func(id : Nat) : ?Types.TenderInvite = ts.invites.get(id));
  };

  public func tendersOfWork(ts : TS, workId : Nat) : [Types.Tender] {
    ids(ts.byWork, workId).filterMap(func(id : Nat) : ?Types.Tender = ts.tenders.get(id));
  };

  // De OA-offertes op één uitnodiging, oudste eerst.
  public func oaQuotesOfInvite(ts : TS, i : Types.TenderInvite, workId : Nat) : [Types.OaQuote] {
    ids(ts.oaQuotesByWork, workId).filterMap(func(id : Nat) : ?Types.OaQuote = switch (ts.oaQuotes.get(id)) { case (?q) { if (q.inviteId == ?i.id) ?q else null }; case null null }).sort(func(a : Types.OaQuote, b : Types.OaQuote) : Order.Order = Nat.compare(a.version, b.version));
  };

  public func draftOf(ts : TS, inviteId : Nat) : ?Types.OaQuoteDraft {
    switch (ts.drafts.get(inviteId)) { case (?c) plain(c); case null null };
  };

  public func amountsOf(ts : TS, oaQuoteId : Nat) : ?Types.OaQuoteAmounts {
    switch (ts.amounts.get(oaQuoteId)) { case (?c) plain(c); case null null };
  };

  public func orgName(c : Ctx, id : Nat) : Text { switch (c.org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };

  public func statusText(s : Types.TenderStatus) : Text {
    switch s { case (#draft) "ontwerp"; case (#open) "open"; case (#closed _) "afgesloten"; case (#cancelled _) "geannuleerd" };
  };
  public func inviteStatusText(s : Types.TenderInviteStatus) : Text {
    switch s { case (#ready) "klaar"; case (#asked) "gevraagd"; case (#reminded) "herinnerd"; case (#received) "ontvangen"; case (#declined) "geen interesse"; case (#noAnswer) "geen antwoord" };
  };

  // Een kanaal dat de app kent.
  public func channelOk(k : Text) : Bool { k == "pdf" or k == "excel" or k == "app" or k == "mail" };

  // De personen van een firma die de rol onderaannemer mogen dragen (contactpersoon van een uitnodiging).
  public func contactsOf(c : Ctx, orgId : Nat) : [TV.TenderPersonRef] {
    c.access.persons.values().filter(func(p : Types.Person) : Bool = p.archivedAt == null and p.orgId == ?orgId and Rights.hasRole(p, #onderaannemer)).map(
      func(p : Types.Person) : TV.TenderPersonRef = {
        id = p.id;
        name = p.name;
        linked = Access.hasActiveLink(c.access, p.id);
        hasEmail = switch (c.oa.personContacts.get(p.id)) { case (?x) x.email != null; case null false };
      }
    ).toArray();
  };

  public func validContact(c : Ctx, orgId : Nat, personId : Nat) : Bool {
    switch (c.access.persons.get(personId)) { case (?p) p.archivedAt == null and p.orgId == ?orgId and Rights.hasRole(p, #onderaannemer); case null false };
  };

  // De contactpersoon van BOWACO voor de firma's: wie de prijsvraag maakte (naam, gsm) en zijn e-mail of het adres van kantoor.
  public func contactOf(c : Ctx, t : Types.Tender) : TV.TenderContactView {
    let p = c.access.persons.get(t.createdBy);
    let email = switch (c.oa.personContacts.get(t.createdBy)) { case (?x) { switch (x.email) { case (?e) e; case null "" } }; case null "" };
    {
      name = switch p { case (?x) x.name; case null "BOWACO" };
      phone = switch p { case (?x) { switch (x.phone) { case (?ph) ph; case null "" } }; case null "" };
      email = if (email != "") email else switch (c.settings.values.get("post.contact")) { case (?e) e; case null "" };
    };
  };

  func workOf(c : Ctx, workId : Nat) : ?Types.Work { c.works.works.get(workId) };

  public func myAddress(a : Types.Address, mode : Types.TenderAddressMode) : TV.MyTenderAddress {
    switch mode { case (#full) { { street = a.street; number = a.number; zip = a.zip; city = a.city } }; case (#city) { { street = ""; number = ""; zip = a.zip; city = a.city } } };
  };
  public func placeText(a : TV.MyTenderAddress) : Text {
    let l1 = (a.street # " " # a.number).trim(#char ' ');
    let l2 = (a.zip # " " # a.city).trim(#char ' ');
    if (l1 == "") l2 else if (l2 == "") l1 else l1 # ", " # l2;
  };

  // ── De controlecode van de inhoud (G5) ───────────────────────────────────
  func f(t : Text) : Text { t.size().toText() # ":" # t # ";" };
  func fi(i : Int) : Text { f(Int.toText(i)) };

  public func formKey(x : Types.ContractForm) : Text {
    switch x { case (#fixed) "fixed"; case (#regie) "regie"; case (#vh) "vh"; case (#estimate) "estimate"; case (#budget) "budget"; case (#perAttachment) "perAttachment" };
  };

  public func canonical(t : Types.Tender, items : [Types.TenderItem], address : TV.MyTenderAddress) : Text {
    var out = "bowaco-prijsvraag-v1;" # f(t.code) # f(t.title) # f(t.noteForOa) # fi(t.workId) # fi(t.versionId) # f(address.street) # f(address.number) # f(address.zip) # f(address.city);
    for (id in t.fileIds.values()) { out #= "B;" # fi(id) };
    for (x in items.values()) {
      out #= "P;" # f(x.key) # f(x.chapter) # f(x.subgroup) # f(x.code) # f(x.title) # f(x.text) # f(x.unit) # fi(x.qtyMilli) # f(formKey(x.form)) # fi(x.order);
    };
    out;
  };

  public func hash(text : Text) : Text { Quotes.hash(text) };

  // ── Views zonder bedragen ────────────────────────────────────────────────
  func personName(c : Ctx, id : ?Nat) : Text { switch id { case (?x) Access.personName(c.access, x); case null "" } };

  public func inviteStatusView(c : Ctx, t : Types.Tender, i : Types.TenderInvite) : TV.TenderInviteStatusView {
    {
      id = i.id;
      orgId = i.orgId;
      orgName = orgName(c, i.orgId);
      contactName = personName(c, i.contactPersonId);
      status = i.status;
      outcome = i.outcome;
      askedDay = i.askedDay;
      remindedDay = i.remindedDay;
      deadlineDay = deadlineOf(t, i);
      answeredAt = i.answeredAt;
      channels = i.channels;
    };
  };

  func quoteNumber(c : Ctx, quoteId : Nat) : Text { switch (c.quotes.quotes.get(quoteId)) { case (?q) q.number; case null "" } };

  public func statusView(c : Ctx, ts : TS, t : Types.Tender) : TV.TenderStatusView {
    let w = workOf(c, t.workId);
    {
      id = t.id;
      workId = t.workId;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      quoteId = t.quoteId;
      quoteNumber = quoteNumber(c, t.quoteId);
      code = t.code;
      title = t.title;
      status = t.status;
      deadlineDay = t.deadlineDay;
      items = ids(ts.itemsByTender, t.id).size();
      invites = invitesOf(ts, t.id).map(func(i : Types.TenderInvite) : TV.TenderInviteStatusView = inviteStatusView(c, t, i));
      createdAt = t.createdAt;
    };
  };

  public func itemView(x : Types.TenderItem) : TV.TenderItemView {
    { id = x.id; root = x.root; lineId = x.lineId; chapter = x.chapter; subgroup = x.subgroup; code = x.code; title = x.title; text = x.text; unit = x.unit; qtyMilli = x.qtyMilli; form = x.form; order = x.order; key = x.key };
  };

  public func fileView(c : Ctx, id : Nat) : ?TV.TenderFileView {
    switch (c.files.files.get(id)) { case (?f) { if (f.archivedAt == null and not f.confidential) ?{ id = f.id; name = f.name; mime = f.mime; size = f.size } else null }; case null null };
  };

  public func oaQuoteBrief(c : Ctx, ts : TS, q : Types.OaQuote) : TV.OaQuoteBrief {
    let current = switch (q.inviteId) {
      case (?iid) { switch (ts.invites.get(iid)) { case (?i) { let all = oaQuotesOfInvite(ts, i, q.workId); all.size() > 0 and all[all.size() - 1].id == q.id }; case null true } };
      case null true;
    };
    {
      id = q.id;
      orgId = q.orgId;
      orgName = orgName(c, q.orgId);
      tenderId = q.tenderId;
      inviteId = q.inviteId;
      number = q.number;
      quoteDay = q.quoteDay;
      validUntil = q.validUntil;
      fileId = q.fileId;
      source = q.source;
      version = q.version;
      supersedes = q.supersedes;
      current;
      status = q.status;
      vatRegime = q.vatRegime;
      createdAt = q.createdAt;
    };
  };

  func accessState(c : Ctx, id : ?Nat) : Text {
    switch id {
      case (?x) {
        switch (c.access.invites.get(x)) {
          case (?inv) { switch (inv.state) { case (#open) "open"; case (#used _) "gebruikt"; case (#revoked _) "ingetrokken"; case (#expired _) "verlopen" } };
          case null "";
        };
      };
      case null "";
    };
  };

  public func inviteView(c : Ctx, ts : TS, t : Types.Tender, i : Types.TenderInvite) : TV.TenderInviteView {
    {
      id = i.id;
      orgId = i.orgId;
      orgName = orgName(c, i.orgId);
      contactPersonId = i.contactPersonId;
      contactName = personName(c, i.contactPersonId);
      contacts = contactsOf(c, i.orgId);
      status = i.status;
      outcome = i.outcome;
      askedDay = i.askedDay;
      remindedDay = i.remindedDay;
      ownDeadline = i.ownDeadline;
      deadlineDay = deadlineOf(t, i);
      answeredAt = i.answeredAt;
      declineReason = i.declineReason;
      channels = i.channels;
      accessCodeId = i.accessCodeId;
      accessState = accessState(c, i.accessCodeId);
      linked = switch (i.contactPersonId) { case (?p) Access.hasActiveLink(c.access, p); case null false };
      sheetKey = i.sheetKey;
      oaQuotes = oaQuotesOfInvite(ts, i, t.workId).map(func(q : Types.OaQuote) : TV.OaQuoteBrief = oaQuoteBrief(c, ts, q));
      createdAt = i.createdAt;
    };
  };

  public func fullView(c : Ctx, ts : TS, t : Types.Tender) : TV.TenderView {
    let w = workOf(c, t.workId);
    let noAddr : Types.Address = { street = ""; number = ""; zip = ""; city = ""; country = "" };
    {
      id = t.id;
      workId = t.workId;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      workAddress = switch w { case (?x) x.address; case null noAddr };
      quoteId = t.quoteId;
      quoteNumber = quoteNumber(c, t.quoteId);
      versionId = t.versionId;
      versionNo = switch (c.quotes.versions.get(t.versionId)) { case (?v) v.version; case null 0 };
      number = t.number;
      code = t.code;
      title = t.title;
      noteForOa = t.noteForOa;
      internalNote = t.internalNote;
      deadlineDay = t.deadlineDay;
      remindDays = t.remindDays;
      status = t.status;
      files = t.fileIds.filterMap(func(id : Nat) : ?TV.TenderFileView = fileView(c, id));
      addressMode = t.addressMode;
      sentHash = t.sentHash;
      rev = t.rev;
      contact = contactOf(c, t);
      items = itemsOf(ts, t.id).map(itemView);
      invites = invitesOf(ts, t.id).map(func(i : Types.TenderInvite) : TV.TenderInviteView = inviteView(c, ts, t, i));
      createdAt = t.createdAt;
      createdByName = Access.personName(c.access, t.createdBy);
      updatedAt = t.updatedAt;
    };
  };

  // ── De OA: enkel zijn eigen uitnodiging ──────────────────────────────────
  public func myItem(x : Types.TenderItem) : TV.MyTenderItem {
    { id = x.id; chapter = x.chapter; subgroup = x.subgroup; code = x.code; title = x.title; text = x.text; unit = x.unit; qtyMilli = x.qtyMilli; form = x.form; order = x.order };
  };

  func addressFor(c : Ctx, t : Types.Tender) : TV.MyTenderAddress {
    switch (workOf(c, t.workId)) { case (?w) myAddress(w.address, t.addressMode); case null { { street = ""; number = ""; zip = ""; city = "" } } };
  };

  public func myBrief(c : Ctx, ts : TS, t : Types.Tender, i : Types.TenderInvite, canAnswer : Bool) : TV.MyTenderBrief {
    {
      inviteId = i.id;
      code = t.code;
      title = t.title;
      place = placeText(addressFor(c, t));
      deadlineDay = deadlineOf(t, i);
      items = ids(ts.itemsByTender, t.id).size();
      status = i.status;
      outcome = i.outcome;
      open = t.status == #open;
      canAnswer;
      versions = oaQuotesOfInvite(ts, i, t.workId).filter(func(q : Types.OaQuote) : Bool = q.source == #app).size();
    };
  };

  public func myView(c : Ctx, ts : TS, t : Types.Tender, i : Types.TenderInvite, canAnswer : Bool) : TV.MyTenderView {
    {
      inviteId = i.id;
      code = t.code;
      title = t.title;
      orgName = orgName(c, i.orgId);
      address = addressFor(c, t);
      contact = contactOf(c, t);
      noteForOa = t.noteForOa;
      deadlineDay = deadlineOf(t, i);
      status = i.status;
      outcome = i.outcome;
      open = t.status == #open;
      canAnswer;
      files = t.fileIds.filterMap(func(id : Nat) : ?TV.TenderFileView = fileView(c, id));
      items = itemsOf(ts, t.id).map(myItem);
      versions = oaQuotesOfInvite(ts, i, t.workId).filter(func(q : Types.OaQuote) : Bool = q.source == #app).size();
      hasDraft = ts.drafts.containsKey(i.id);
      sentHash = t.sentHash;
    };
  };

  public func myFile(c : Ctx, id : ?Nat) : ?TV.MyTenderFile {
    switch id { case (?x) { switch (c.files.files.get(x)) { case (?f) { if (f.archivedAt == null) ?{ id = f.id; name = f.name; size = f.size } else null }; case null null } }; case null null };
  };

  // ── Met bedragen (enkel voor update-calls met een auditregel) ────────────
  public func chapterFn(ts : TS) : Nat -> Text {
    func(id : Nat) : Text = switch (ts.items.get(id)) { case (?x) x.chapter; case null TenderCalc.ownChapter };
  };

  public func fullQuote(c : Ctx, ts : TS, q : Types.OaQuote) : TV.OaQuoteFull {
    let a = amountsOf(ts, q.id);
    {
      quote = oaQuoteBrief(c, ts, q);
      netCents = switch a { case (?x) x.netCents; case null 0 };
      discountBp = switch a { case (?x) x.discountBp; case null null };
      lines = switch a { case (?x) x.lines; case null [] };
      chapterTotals = switch a { case (?x) x.chapterTotals; case null [] };
      remark = switch a { case (?x) x.remark; case null "" };
      file = myFile(c, q.fileId);
    };
  };

  public func draftView(c : Ctx, ts : TS, d : Types.OaQuoteDraft) : TV.OaDraftView {
    {
      number = d.number;
      quoteDay = d.quoteDay;
      validUntil = d.validUntil;
      discountBp = d.discountBp;
      reverse = d.reverse;
      lines = d.lines;
      fileId = d.fileId;
      file = myFile(c, d.fileId);
      remark = d.remark;
      updatedAt = d.updatedAt;
      netCents = TenderCalc.totals(d.lines, d.discountBp, chapterFn(ts)).net;
    };
  };

  // De bestanden van OA-offertes en ontwerpen (eigen PDF van de OA, ingelezen Excel): ze tonen enkel bij de OA-offerte, niet in de
  // losse bestanden van de werf (een ontwerp leest enkel de firma zelf, R38).
  public func ownedFiles(ts : TS) : Map.Map<Nat, Bool> {
    let m = Map.empty<Nat, Bool>();
    for (q in ts.oaQuotes.values()) { switch (q.fileId) { case (?f) m.add(f, true); case null {} } };
    for (c in ts.drafts.values()) { switch (plain(c)) { case (?d) { switch (d.fileId) { case (?f) m.add(f, true); case null {} } }; case null {} } };
    m;
  };

  // R39 (opslagpoort): heeft deze OA een uitnodiging waarop hij nu mag antwoorden?
  public func hasOpenInvite(ctx : Rights.Ctx, ts : TS, p : Types.Person, now : Int, today : Day) : Bool {
    let o = switch (p.orgId) { case (?x) x; case null return false };
    ids(ts.invitesByOrg, o).any(func(id : Nat) : Bool = switch (ts.invites.get(id)) {
      case (?i) { switch (ts.tenders.get(i.tenderId)) { case (?t) Rights.mayAnswerInvite(ctx, p, t, i, now, today); case null false } };
      case null false;
    });
  };

  // ── Herstel: de indexen uit de records zelf ──────────────────────────────
  public func rebuildIndex(ts : TS) {
    ts.byWork.clear();
    ts.itemsByTender.clear();
    ts.invitesByTender.clear();
    ts.invitesByOrg.clear();
    ts.oaQuotesByWork.clear();
    ts.sheetKeys.clear();
    for (t in ts.tenders.values()) { addIndex(ts.byWork, t.workId, t.id) };
    for (x in ts.items.values()) { addIndex(ts.itemsByTender, x.tenderId, x.id) };
    for (i in ts.invites.values()) {
      addIndex(ts.invitesByTender, i.tenderId, i.id);
      addIndex(ts.invitesByOrg, i.orgId, i.id);
      if (i.sheetKey != "") { ts.sheetKeys.add(i.sheetKey, i.id) };
    };
    for (q in ts.oaQuotes.values()) { addIndex(ts.oaQuotesByWork, q.workId, q.id) };
  };

  // Een sleutel van 12 tekens voor de Excel van één firma (Crockford base32 uit raw_rand), uniek over alle uitnodigingen.
  public func sheetKey(ts : TS, entropy : Blob, salt : Nat) : Text {
    var n = salt;
    var tries = 0;
    while (tries < 20) {
      let k = Codes.fromEntropy(Sha256.fromBlob(#sha256, ("bowaco-sheet-v1|" # n.toText() # "|" # Codes.hex(entropy)).encodeUtf8()), 12);
      if (k != "" and not ts.sheetKeys.containsKey(k)) { return k };
      n += 1_000;
      tries += 1;
    };
    "";
  };

  // ── Klokjob (Post.tick, elke 10 min): herinnering en "geen antwoord", één keer per uitnodiging ──
  // De herinnering valt `remindDays` werkdagen vóór de deadline van de firma (kalender van de werf: weekends, bouwverlof). Op die dag
  // krijgt de maker van de prijsvraag een melding ("Herinner …"); mail naar de firma pas als de mail live staat (G7). Na de deadline
  // zonder antwoord: status "geen antwoord" en een melding. Begrensd: enkel open prijsvragen.
  public type TickCtx = { access : Types.AccessState; org : Types.OrgState; works : Types.WorksState; plan : Types.PlanState };

  func notifyOffice(c : TickCtx, audit : Types.AuditState, ctr : Types.Counters, t : Types.Tender, kind : Text, text : Text) {
    let maker = switch (c.access.persons.get(t.createdBy)) { case (?p) { if (p.archivedAt == null and Rights.isOffice(p)) ?p.id else null }; case null null };
    switch maker {
      case (?id) Access.notify(audit, ctr, id, kind, text, ?t.workId);
      case null Access.notifyAdmins(c.access, audit, ctr, kind, text);
    };
  };

  public func tick(c : TickCtx, ts : TS, audit : Types.AuditState, ctr : Types.Counters, today : Day) : Nat {
    var n = 0;
    for (t in ts.tenders.values()) {
      if (t.status == #open) {
        let cal = Plan.calFor(c.plan, c.works, t.workId);
        for (i in invitesOf(ts, t.id).values()) {
          let dl = deadlineOf(t, i);
          let firm = switch (c.org.orgs.get(i.orgId)) { case (?o) o.name; case null "#" # i.orgId.toText() };
          if ((i.status == #asked or i.status == #reminded) and today > dl) {
            ts.invites.add(i.id, { i with status = #noAnswer });
            notifyOffice(c, audit, ctr, t, "prijsvraag-geen-antwoord", t.code # " · " # t.title # ": " # firm # " antwoordde niet vóór " # Plan.fmtDay(dl));
            Access.audit(audit, Principal.anonymous(), null, ?t.workId, "prijsvraag-geen-antwoord", t.code # " " # firm);
            n += 1;
          } else if (i.status == #asked and i.remindedDay == null and t.remindDays > 0) {
            let rd = Plan.addWorkdays(cal, dl, -t.remindDays);
            if (today >= rd and today <= dl) {
              ts.invites.add(i.id, { i with status = #reminded; remindedDay = ?today });
              notifyOffice(c, audit, ctr, t, "prijsvraag-herinner", "Herinner " # firm # ": " # t.code # " · " # t.title # ", deadline " # Plan.fmtDay(dl));
              Access.audit(audit, Principal.anonymous(), null, ?t.workId, "prijsvraag-herinnering", t.code # " " # firm);
              n += 1;
            };
          };
        };
      };
    };
    n;
  };

  // De lijnen van een ontwerp of indiening van de OA nakijken en vullen (bedrag uit de regel, post van BOWACO = haar VH en eenheid).
  public func answerLines(ts : TS, tenderId : Nat, input : [TV.OaLineInput], maxOwn : Nat, maxText : Nat, maxCents : Int, maxQty : Int) : { #ok : [Types.OaQuoteLine]; #err : Text } {
    let seen = Map.empty<Nat, Bool>();
    var own = 0;
    var out : [Types.OaQuoteLine] = [];
    for (l in input.values()) {
      if (l.description.size() > maxText or l.remark.size() > maxText or l.unit.size() > 40) { return #err("Tekst te lang") };
      switch (l.included) { case (#alt a) { if (a.size() > maxText) { return #err("Tekst te lang") } }; case _ {} };
      switch (l.unitCents) { case (?u) { if (u < 0 or u > maxCents) { return #err("Eenheidsprijs: 0 tot € 1 miljard") } }; case null {} };
      switch (l.itemId) {
        case (?id) {
          let x = ts.items.get(id) ?? return #err("Deze post hoort niet bij de prijsvraag");
          if (x.tenderId != tenderId) { return #err("Deze post hoort niet bij de prijsvraag") };
          if (seen.containsKey(id)) { return #err("Een post staat twee keer in het antwoord") };
          seen.add(id, true);
          out := out.concat([{ itemId = ?id; description = x.title; unit = x.unit; qtyMilli = x.qtyMilli; unitCents = l.unitCents; amountCents = TenderCalc.lineAmount(l.unitCents, x.qtyMilli, l.included); included = l.included; remark = l.remark.trim(#char ' '); changed = [] }]);
        };
        case null {
          own += 1;
          if (own > maxOwn) { return #err("Hoogstens " # maxOwn.toText() # " eigen posten") };
          let d = l.description.trim(#char ' ');
          if (d.size() == 0) { return #err("Een eigen post heeft een omschrijving") };
          if (l.qtyMilli < 0 or l.qtyMilli > maxQty) { return #err("Hoeveelheid: 0 tot 1 miljard") };
          out := out.concat([{ itemId = null; description = d; unit = l.unit.trim(#char ' '); qtyMilli = l.qtyMilli; unitCents = l.unitCents; amountCents = TenderCalc.lineAmount(l.unitCents, l.qtyMilli, l.included); included = l.included; remark = l.remark.trim(#char ' '); changed = [] }]);
        };
      };
    };
    #ok(out);
  };
};
