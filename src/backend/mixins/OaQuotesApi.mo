// OA-offertes ontvangen en vergelijken (stap 2c.3, ontwerp 2c §4.3; ⚖5, AC-12, AC-13 beslist 29-10). Enkel kantoor (beheerder,
// calculator: #editTenders + #readCosts, R36 en R38): een teruggestuurde Excel inlezen (de browser leest ze met tender/sheetread.ts,
// de server kijkt de verborgen sleutel na en rekent alles opnieuw), een offerte met de hand registreren naast de PDF (per post,
// enkel hoofdstuktotalen of enkel het totaal) of los zonder prijsvraag; vergelijken per prijsvraag (lib/TenderCompare.mo =
// tender/compare.ts), kiezen per hoofdstuk of per post, overnemen in een ONTWERPversie van de offerte (aankoopprijs, firma, bron
// "oa-offerte"; de marge volgt de klasse van 2c.1) en in de postenbibliotheek (prijsgeheugen, ook "niet gekozen"). Bedragen en de
// vergelijking enkel via update-calls met de auditregel "bekeek:oa-offerte:<id>"; de auditregel draagt nooit een bedrag.
// De werfleider ziet na het afsluiten per hoofdstuk de gekozen firma (listTenders, TenderStatusView.picks), nooit een prijs.
// Private hulpfuncties dragen het voorvoegsel `oq` (ze delen één blok met alle andere mixins).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import TV "../types/tenderviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import OaDeals "../lib/OaDeals";
import OaQuotes "../lib/OaQuotes";
import Post "../lib/Post";
import QuoteCalc "../lib/QuoteCalc";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import TenderCalc "../lib/TenderCalc";
import TenderCompare "../lib/TenderCompare";
import Tenders "../lib/Tenders";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  oa : Types.OaState,
  works : Types.WorksState,
  files : Types.FileState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  tenders : Types.TenderState,
  oaDeals : Types.OaDealState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func oqCtx() : Tenders.Ctx { { settings; access; org; oa; works; quotes; files } };
  func oqToday() : Types.Day { Post.local(Time.now()).day };

  // Kantoor met het volle zicht op de werf én de bedragen (R36, R38).
  func oqOffice(p : Types.Person, workId : Nat) : Bool {
    let ctx = { works; settings };
    Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null) and Rights.tenderScope(ctx, p, workId) == #full;
  };
  func oqRequire(p : Types.Person) {
    let ctx = { works; settings };
    Rights.require(ctx, p, #editTenders, null);
    Rights.require(ctx, p, #readCosts, null);
  };
  func oqTender(p : Types.Person, tenderId : Nat) : ?Types.Tender {
    let t = tenders.tenders.get(tenderId) ?? return null;
    if (not oqOffice(p, t.workId)) { return null };
    ?t;
  };

  // ── Instellingen (Beheer → Opmeting & facturatie → Prijsvragen) ─────────
  public query ({ caller }) func tenderSettings() : async TV.TenderSettings {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    {
      deadlineDays = Dossier.setting(settings, "tender.deadlineDays", Config.tenderDeadlineDays);
      remindDays = Dossier.setting(settings, "tender.remindDays", Config.tenderRemindDays);
      thanksMode = OaQuotes.thanksMode(settings);
      deviationBp = OaQuotes.deviationBp(settings);
    };
  };

  public shared ({ caller }) func saveTenderSettings(i : TV.TenderSettings) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.deadlineDays < 1 or i.deadlineDays > 60) { return #err("Antwoordtermijn: 1 tot 60 werkdagen") };
    if (i.remindDays > Config.maxTenderRemindDays or (i.remindDays > 0 and i.remindDays >= i.deadlineDays)) { return #err("Herinnering: 0 tot " # Config.maxTenderRemindDays.toText() # " werkdagen vooraf, korter dan de termijn") };
    if (i.thanksMode != "melding" and i.thanksMode != "mail" and i.thanksMode != "niets") { return #err("Bericht aan niet-gekozen firma's: melding, mail of niets") };
    if (i.deviationBp < 100 or i.deviationBp > 10_000) { return #err("Drempel voor afwijkende prijzen: 1 tot 100 %") };
    settings.values.add("tender.deadlineDays", i.deadlineDays.toText());
    settings.values.add("tender.remindDays", i.remindDays.toText());
    settings.values.add("tender.thanksMode", i.thanksMode);
    settings.values.add("tender.deviationBp", i.deviationBp.toText());
    Access.audit(audit, caller, ?p.id, null, "prijsvraag-instellingen", i.deadlineDays.toText() # " werkdagen, herinnering " # i.remindDays.toText() # ", bericht: " # i.thanksMode # ", drempel " # i.deviationBp.toText() # " bp");
    #ok;
  };

  // ── Lijst (zonder bedragen) ─────────────────────────────────────────────
  // Alle OA-offertes van een werf (op een prijsvraag en los), nieuwste eerst.
  public query ({ caller }) func listOaQuotes(workId : Nat) : async [TV.OaQuoteBrief] {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    if (not oqOffice(p, workId)) { Runtime.trap("Geen toegang") };
    let c = oqCtx();
    OaQuotes.sortBriefs(Tenders.ids(tenders.oaQuotesByWork, workId).filterMap(func(id : Nat) : ?TV.OaQuoteBrief = switch (tenders.oaQuotes.get(id)) { case (?q) ?Tenders.oaQuoteBrief(c, tenders, q); case null null }));
  };

  // ── Registreren (Excel, met de hand, los) ───────────────────────────────
  public shared ({ caller }) func registerOaQuote(i : TV.OaQuoteInput, expectNetCents : Int) : async Result.Result<TV.OaQuoteSaved, Text> {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    let today = oqToday();
    let pr = switch (OaQuotes.prepare(settings, org, tenders, oqCtx(), func(w : Nat) : Bool = oqOffice(p, w), i, today)) { case (#ok x) x; case (#err e) return #err(e) };
    let tender = pr.tender;
    let net = pr.net;
    let lines = pr.lines;
    let form = pr.form;
    if (net != expectNetCents) { return #err("Het totaal klopt niet met wat de server rekent: laad opnieuw (niets bewaard)") };
    // Het bestand (de Excel of de PDF): vertrouwelijk aan de werf.
    switch (i.file) {
      case (?f) {
        if (f.mime != "application/pdf" and f.mime != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") { return #err("Enkel een PDF of een .xlsx") };
        if (f.size == 0 or f.size > Config.maxFileBytes) { return #err("Bestand te groot") };
        if (f.blob.size() > 200) { return #err("Het bestand klopt niet") };
        if (files.files.values().filter(func(x : Types.FileRef) : Bool = x.personId == p.id).size() >= Config.maxFilesPerPerson) { return #err("De opslagruimte is vol. Neem contact op met de beheerder") };
        if (Access.cleanText(f.name, 200) == null) { return #err("Bestandsnaam: 1 tot 200 tekens") };
      };
      case null {};
    };
    let now = Time.now();
    let fileId : ?Nat = switch (i.file) {
      case (?f) {
        let fid = Ids.next(ctr, "file");
        let n = switch (Access.cleanText(f.name, 200)) { case (?x) x; case null "offerte" };
        let fr : Types.FileRef = { id = fid; name = n; mime = f.mime; size = f.size; blob = f.blob; workId = ?i.workId; confidential = true; personId = p.id; at = now; var archivedAt = null };
        files.files.add(fid, fr);
        ?fid;
      };
      case null null;
    };
    let (id, version) = OaQuotes.store(tenders, ctr, i, pr, fileId, p.id, now, []);
    let firm = Tenders.orgName(oqCtx(), i.orgId);
    let how = switch (i.source) { case (#sheet) "Excel"; case (#hand) "met de hand"; case (#app) "app" };
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-offerte-geregistreerd", (switch tender { case (?t) t.code # ": "; case null "los: " }) # firm # " versie " # version.toText() # " (" # how # ", " # form # ", " # lines.size().toText() # " regels)");
    #ok({ oaQuoteId = id; version; netCents = net });
  };

  // ── Intrekken (open punt van 2c.3; kantoor met de bedragen) ──────────────
  // Een OA-offerte intrekken met een verplichte reden. Niet meer als ze al overgenomen is in een offerte, als de prijsvraag niet
  // meer loopt of als een afspraak ernaar verwijst; enkel de geldende (laatste) indiening. Vergelijken en kiezen negeren ze
  // (OaQuotes.current). De OA ziet "ingetrokken door BOWACO"; de reden enkel als kantoor dat koos (extra "intrekZichtbaar").
  // De firma mag daarna (zolang de prijsvraag loopt en de deadline niet voorbij is) opnieuw indienen = een nieuwe versie.
  public shared ({ caller }) func withdrawOaQuote(oaQuoteId : Nat, reason : Text, showReason : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    let q = tenders.oaQuotes.get(oaQuoteId) ?? return #err("Geen toegang");
    if (not oqOffice(p, q.workId)) { return #err("Geen toegang") };
    let why = reason.trim(#char ' ');
    if (why.size() < 3) { return #err("Geef de reden van het intrekken (minstens 3 tekens)") };
    if (why.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
    switch (q.status) { case (#withdrawn _) { return #err("Deze offerte is al ingetrokken") }; case (#received) {} };
    var tender : ?Types.Tender = null;
    switch (q.tenderId) {
      case (?tid) {
        let t = tenders.tenders.get(tid) ?? return #err("Onbekende prijsvraag");
        if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status) # ": een offerte intrekken kan enkel zolang ze loopt") };
        if (not OaQuotes.isCurrent(tenders, t, q.id)) { return #err("Enkel de laatste indiening van een firma kan ingetrokken worden") };
        tender := ?t;
      };
      case null {};
    };
    // Review L9: gericht zoeken (de keuzes van die prijsvraag, de afspraken van die werf en firma).
    switch tender {
      case (?t) {
        for (x in OaQuotes.choicesOf(tenders, t).values()) {
          if (x.oaQuoteId == ?q.id and x.appliedVersionId != null) { return #err("Deze offerte is al overgenomen in een offerte van de klant: trek ze niet in") };
        };
      };
      case null {};
    };
    for (a in OaDeals.agreementsOf(oaDeals, q.workId).values()) {
      if (a.oaQuoteIds.find(func(x : Nat) : Bool = x == q.id) != null) {
        switch (a.status) { case (#ended _) {}; case _ { return #err("Een afspraak met deze firma verwijst naar de offerte: wijzig eerst de afspraak") } };
      };
    };
    let now = Time.now();
    let extra = OaDeals.extraSet(OaDeals.extraSet(OaDeals.extraSet(q.extra, "intrekZichtbaar", if showReason "ja" else "nee"), "ingetrokkenOp", now.toText()), "ingetrokkenDoor", p.id.toText());
    tenders.oaQuotes.add(q.id, { q with status = #withdrawn(why); extra });
    // De uitnodiging staat weer open: de firma kan opnieuw indienen zolang de deadline niet voorbij is.
    switch (q.inviteId) {
      case (?iid) {
        switch (tenders.invites.get(iid)) {
          case (?inv) { if (inv.status == #received) { tenders.invites.add(iid, { inv with status = #asked; answeredAt = null }) } };
          case null {};
        };
      };
      case null {};
    };
    Access.audit(audit, caller, ?p.id, ?q.workId, "oa-offerte-ingetrokken", (switch tender { case (?t) t.code # ": "; case null "los: " }) # Tenders.orgName(oqCtx(), q.orgId) # " versie " # q.version.toText() # ", reden: " # why # (if showReason " (zichtbaar voor de firma)" else " (intern)"));
    #ok;
  };

  // ── Vergelijken (R38: update-call, auditregel per offerte) ──────────────
  public shared ({ caller }) func compareTender(tenderId : Nat) : async Result.Result<TV.TenderCompareView, Text> {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    let t = oqTender(p, tenderId) ?? return #err("Geen toegang");
    let c = oqCtx();
    let cur = OaQuotes.current(tenders, t);
    for (q in cur.values()) { Access.audit(audit, caller, ?p.id, ?t.workId, "bekeek:oa-offerte:" # q.id.toText(), "vergelijking " # t.code # " · " # Tenders.orgName(c, q.orgId) # " v" # q.version.toText()) };
    let (input, calc) = OaQuotes.compare(settings, library, quotes, tenders, t, oqToday());
    let all = Tenders.invitesOf(tenders, t.id).flatMap(func(i : Types.TenderInvite) : Iter.Iter<Types.OaQuote> = Tenders.oaQuotesOfInvite(tenders, i, t.workId).values());
    let drafts = Quotes.versionsOf(quotes, t.quoteId).filter(func(v : Types.QuoteVersion) : Bool = v.status == #draft).map(func(v : Types.QuoteVersion) : TV.TenderDraftRef = { versionId = v.id; version = v.version; title = v.title });
    #ok({
      tenderId = t.id;
      workId = t.workId;
      quoteId = t.quoteId;
      quoteNumber = switch (quotes.quotes.get(t.quoteId)) { case (?q) q.number; case null "" };
      code = t.code;
      title = t.title;
      status = t.status;
      rev = t.rev;
      items = do { let xs = Tenders.itemsOf(tenders, t.id); Array.tabulate<TV.TenderItemView>(xs.size(), func(k : Nat) : TV.TenderItemView = Tenders.itemView(xs[k], k + 1)) };
      quotes = cur.map(func(q : Types.OaQuote) : TV.OaQuoteHead { let f = Tenders.fullQuote(c, tenders, q); { quote = f.quote; netCents = f.netCents; discountBp = f.discountBp; remark = f.remark; file = f.file } });
      history = all.map(func(q : Types.OaQuote) : TV.OaQuoteBrief = Tenders.oaQuoteBrief(c, tenders, q));
      invites = Tenders.invitesOf(tenders, t.id).map(func(i : Types.TenderInvite) : TV.TenderInviteStatusView = Tenders.inviteStatusView(c, t, i));
      input;
      calc;
      choices = OaQuotes.choicesOf(tenders, t).map(func(x : Types.TenderChoice) : TV.TenderChoiceView = OaQuotes.choiceView(access, org, tenders, t, x));
      drafts;
      thanksMode = OaQuotes.thanksMode(settings);
    });
  };

  // ── Kiezen (per post; per hoofdstuk = alle posten van dat hoofdstuk) ────
  public shared ({ caller }) func saveTenderChoices(tenderId : Nat, picks : [TV.TenderPickInput]) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    let t = oqTender(p, tenderId) ?? return #err("Geen toegang");
    // Review M1: kiezen en overnemen enkel zolang de prijsvraag loopt (na afsluiten of annuleren ligt de keuze vast).
    if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status) # ": de keuze ligt vast") };
    let items = Tenders.itemsOf(tenders, t.id);
    if (picks.size() == 0 or picks.size() > items.size()) { return #err("Kies 1 tot " # items.size().toText() # " posten") };
    let seen = Map.empty<Nat, Bool>();
    type W = { item : Types.TenderItem; q : ?Types.OaQuote; unit : ?Int; reason : Text };
    var work : [W] = [];
    for (k in picks.values()) {
      let x = items.find(func(y : Types.TenderItem) : Bool = y.id == k.itemId) ?? return #err("Deze post hoort niet bij de prijsvraag");
      if (seen.containsKey(x.id)) { return #err("Een post staat twee keer in de keuze") };
      seen.add(x.id, true);
      let r = k.reason.trim(#char ' ');
      if (r.size() > Config.maxQuoteReason) { return #err("Reden: hoogstens " # Config.maxQuoteReason.toText() # " tekens") };
      switch (k.oaQuoteId) {
        case (?qid) {
          let q = tenders.oaQuotes.get(qid) ?? return #err("Onbekende OA-offerte");
          if (q.tenderId != ?t.id or not OaQuotes.isCurrent(tenders, t, qid)) { return #err("Kies uit de geldende offertes van deze prijsvraag (laad opnieuw: er kwam een nieuwe versie binnen)") };
          let u = switch (OaQuotes.priceFor(tenders, q, x.id)) { case (#ok u) u; case (#err e) return #err((if (x.code != "") x.code # " " else "") # x.title # ": " # e) };
          work := work.concat([{ item = x; q = ?q; unit = ?u; reason = r }]);
        };
        case null { work := work.concat([{ item = x; q = null; unit = null; reason = "" }]) };
      };
    };
    let now = Time.now();
    var set = 0;
    var removed = 0;
    for (w in work.values()) {
      switch (w.q) {
        case (?q) {
          let prev = switch (tenders.choices.get(w.item.id)) { case (?#plain(c)) ?c; case _ null };
          let same = switch prev { case (?c) c.oaQuoteId == ?q.id and c.unitCents == w.unit; case null false };
          tenders.choices.add(w.item.id, #plain({ itemId = w.item.id; tenderId = t.id; oaQuoteId = ?q.id; unitCents = w.unit; reason = w.reason; appliedVersionId = if same (switch prev { case (?c) c.appliedVersionId; case null null }) else null; libCostId = if same (switch prev { case (?c) c.libCostId; case null null }) else null; at = now; by = p.id }));
          set += 1;
        };
        case null { if (tenders.choices.containsKey(w.item.id)) { tenders.choices.remove(w.item.id); removed += 1 } };
      };
    };
    Access.audit(audit, caller, ?p.id, ?t.workId, "prijsvraag-keuze", t.code # ": " # set.toText() # " posten gekozen, " # removed.toText() # " keuzes weg");
    #ok(set);
  };

  // ── Overnemen in de offerte (enkel een ontwerpversie) en in de bibliotheek ──
  public shared ({ caller }) func applyTenderChoices(tenderId : Nat, versionId : Nat) : async Result.Result<TV.TenderApplyResult, Text> {
    let p = Access.requireActive(access, caller);
    oqRequire(p);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    let t = oqTender(p, tenderId) ?? return #err("Geen toegang");
    Rights.require(ctx, p, #readQuotes, ?t.workId);
    // Review M1: kiezen en overnemen enkel zolang de prijsvraag loopt (na afsluiten of annuleren ligt de keuze vast).
    if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status) # ": de keuze ligt vast") };
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    if (v.quoteId != t.quoteId) { return #err("Deze versie hoort bij een andere offerte") };
    let q0 = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    if (q0.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    if (v.status != #draft) { return #err("Versie " # v.version.toText() # " is " # Quotes.statusText(v.status) # " en verandert nooit meer: maak een nieuwe versie (ontwerp) en neem daarin over") };
    let chs = OaQuotes.choicesOf(tenders, t).filter(func(c : Types.TenderChoice) : Bool = c.oaQuoteId != null);
    if (chs.size() == 0) { return #err("Kies eerst een firma per hoofdstuk of per post") };
    let c = oqCtx();
    for (ch in chs.values()) {
      switch (ch.oaQuoteId) {
        case (?qid) {
          if (not OaQuotes.isCurrent(tenders, t, qid)) {
            let firm = switch (tenders.oaQuotes.get(qid)) { case (?q) Tenders.orgName(c, q.orgId); case null "" };
            return #err("Kies opnieuw: " # firm # " diende intussen een nieuwe versie in (niets overgenomen)");
          };
        };
        case null {};
      };
    };
    // De posten van de doelversie op hun eerste lijn (dezelfde post in een latere versie, WorkStart.root).
    let byRoot = Map.empty<Nat, Types.QuoteLine>();
    for (lid in Quotes.ids(quotes.linesByVersion, v.id).values()) {
      switch (quotes.lines.get(lid)) { case (?l) { if (l.archivedAt == null and l.kind != #text) { byRoot.add(WorkStart.root(quotes, l.id), l) } }; case null {} };
    };
    let now = Time.now();
    // Eerst het prijsgeheugen (zo kent elke keuze haar prijs in de bibliotheek), dan de lijnen.
    let mem = OaQuotes.remember(org, library, quotes, tenders, ctr, t, p.id, now);
    var n = 0;
    var changed = 0;
    var skipped : [Text] = [];
    for (ch in OaQuotes.choicesOf(tenders, t).values()) {
      switch (ch.oaQuoteId, tenders.items.get(ch.itemId)) {
        case (?qid, ?x) {
          let label_ = (if (x.code != "") x.code # " " else "") # x.title;
          switch (byRoot.get(x.root), tenders.oaQuotes.get(qid)) {
            case (?l, ?q) {
              // Review M2: de post in de doelversie kan intussen een andere eenheid hebben dan in de prijsvraag.
              if (l.unit != x.unit and not OaQuotes.sameUnit(settings, x.unit, l.unit)) {
                skipped := skipped.concat([label_ # ": andere eenheid dan in de prijsvraag (" # l.unit # " i.p.v. " # x.unit # ")"]);
              } else {
                let old = quotes.prices.get(l.id);
                let pr = Quotes.priceOf(quotes, l.id);
                let lib = mem.chosen.get(x.id);
                let tag = t.id.toText();
                let had = switch old { case (?o) OaQuotes.extraOf(o.extra, "prijsvraag") == tag; case null false };
                // Review L3: dezelfde prijs opnieuw overnemen verandert niets (geen nieuwe stand, geen auditregel).
                if (not (had and pr.cost == ch.unitCents and pr.orgId == ?q.orgId and pr.source == "oa-offerte" and pr.libCostId == lib)) {
                  let extra = switch old { case (?o) o.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "prijsvraag"); case null [] };
                  quotes.prices.add(l.id, { lineId = l.id; versionId = v.id; cost = #plain(ch.unitCents); rule = #plain(pr.rule); reason = #plain(pr.reason); orgId = ?q.orgId; source = "oa-offerte"; libCostId = lib; extra = extra.concat([("prijsvraag", tag)]) });
                  changed += 1;
                };
                switch (tenders.choices.get(x.id)) { case (?#plain(cc)) { if (cc.appliedVersionId != ?v.id) { tenders.choices.add(x.id, #plain({ cc with appliedVersionId = ?v.id })) } }; case _ {} };
                n += 1;
              };
            };
            case (null, _) { skipped := skipped.concat([label_ # ": staat niet (meer) in versie " # v.version.toText()]) };
            case (_, null) { skipped := skipped.concat([label_ # ": onbekende OA-offerte"]) };
          };
        };
        case _ {};
      };
    };
    if (changed > 0) { quotes.versions.add(v.id, { v with rev = v.rev + 1; calcVersion = QuoteCalc.version; updatedAt = now; updatedBy = p.id }) };
    if (mem.skipped > 0) { skipped := skipped.concat([mem.skipped.toText() # " prijzen niet in de bibliotheek (te veel prijzen voor die post)"]) };
    // Enkel aantallen, nooit een bedrag.
    if (changed > 0 or mem.added > 0 or mem.archived > 0) {
      Access.audit(audit, caller, ?p.id, ?t.workId, "offerte-oa-overgenomen", q0.number # " v" # v.version.toText() # ": " # changed.toText() # " van " # n.toText() # " posten gewijzigd uit " # t.code # "; bibliotheek " # mem.added.toText() # " nieuw, " # mem.kept.toText() # " ongewijzigd, " # mem.archived.toText() # " vervangen");
    };
    #ok({ lines = n; changed; libCosts = mem.chosen.size(); memory = mem.added + mem.kept; skipped });
  };
};
