// Min-meerstaat (stap 2c.5, ontwerp 2c §4.5, R41; ⚖3, AC-5, AC-18, AC-19): per werf één levend overzicht van de afrekening
// (Facturatie → Min-meer), telkens gerekend uit wat de app al weet (lib/MinMeer.mo, rekenen in lib/MinMeerCalc.mo = minmeer/calc.ts),
// met versies op datum onder een controlecode, delen met de klant (akkoord of opmerking, instelbaar), en de MEERWERKOFFERTE: een
// gewone offerte (2.4) van de soort meerwerk bij de getekende offerte ("2026/412-M1"), met dezelfde controle, PDF, klantakkoord en
// Werf starten (2.7, 2.8); vanaf € 1.000 (instelbaar) telt meerwerk enkel via een aanvaarde meerwerkofferte.
// Rechten in lib/Rights.mo (minMeerScope): admin en calculator alles (bedragen enkel via update-calls met auditregel); de werfleider
// van de werf hoeveelheden en uren en voorstellen zonder prijs (minMeerQty draagt geen enkel bedragveld); de klant van de werf (en
// van zijn firma) en de architect met de grant vorderingsstaten enkel GEDEELDE versies, zonder kostprijs, marge of OA-naam.
// Hulpfuncties hier dragen de prefix "mm" (gedeeld over alle mixins). Geen await: elke oproep is één atomische stap (R33).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import MV "../types/minmeerviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Library "../lib/Library";
import MinMeer "../lib/MinMeer";
import MinMeerCalc "../lib/MinMeerCalc";
import Post "../lib/Post";
import Progress "../lib/Progress";
import QuoteCalc "../lib/QuoteCalc";
import QuoteDocs "../lib/QuoteDocs";
import QuoteForms "../lib/QuoteForms";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";

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
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen ───────────────────────────────────────────────────────
  // Lezen met de marges: kantoor (update-call, auditregel); zetten: de beheerder.
  public shared ({ caller }) func minMeerSettings() : async Result.Result<MV.MmSettingsView, Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    Access.audit(audit, caller, ?p.id, null, "bekeek:min-meer-instellingen", "");
    #ok({ quoteFromCents = MinMeer.quoteFromCents(settings); passOnBp = MinMeer.passOnBp(settings, ""); passOnByKind = Config.mmCostKinds().filterMap(func((k, _) : (Text, Text)) : ?(Text, Nat) = switch (settings.values.get("minMeer.passOnBp." # k)) { case (?_) ?(k, MinMeer.passOnBp(settings, k)); case null null }); client = MinMeer.clientMode(settings); costKinds = Config.mmCostKinds() });
  };

  public shared ({ caller }) func saveMinMeerSettings(i : MV.MmSettingsInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.quoteFromCents == 0 or i.quoteFromCents > 100_000_000) { return #err("Drempel meerwerkofferte: meer dan € 0, hoogstens € 1.000.000") };
    if (i.passOnBp > 9_000) { return #err("Marge op doorgerekende kosten: hoogstens 90 %") };
    if (i.client != "uit" and i.client != "mogelijk") { return #err("Klantakkoord: uit of mogelijk") };
    for ((k, bp) in i.passOnByKind.values()) {
      if (Config.mmCostKinds().find(func((x, _) : (Text, Text)) : Bool = x == k) == null) { return #err("Onbekende kostensoort " # k) };
      if (bp > 9_000) { return #err("Marge op doorgerekende kosten: hoogstens 90 %") };
    };
    settings.values.add("minMeer.quoteFromCents", i.quoteFromCents.toText());
    settings.values.add("minMeer.passOnBp", i.passOnBp.toText());
    for ((k, _) in Config.mmCostKinds().values()) {
      switch (i.passOnByKind.find(func((x, _) : (Text, Nat)) : Bool = x == k)) { case (?(_, bp)) settings.values.add("minMeer.passOnBp." # k, bp.toText()); case null settings.values.remove("minMeer.passOnBp." # k) };
    };
    settings.values.add("minMeer.client", i.client);
    Access.audit(audit, caller, ?p.id, null, "min-meer-instellingen", "klantakkoord " # i.client);
    #ok;
  };

  // ── De levende staat ───────────────────────────────────────────────────
  // De werfleider van de werf (en kantoor): de regels in hoeveelheden en uren, zonder één bedrag; de versies; de posten (voorstel).
  public query ({ caller }) func minMeerQty(workId : Nat) : async MV.MinMeerQtyView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readMinMeer, ?workId);
    let sc = Rights.minMeerScope(ctx, p, workId, mmClientOrg(workId));
    let b = MinMeer.build(mmCtx(), workId, mmToday());
    {
      workId;
      scope = if (sc == #full) "full" else "qty";
      rows = MinMeer.qtyRows(b, p.id);
      // Review L3: de notitie van een versie is voor de klant en kantoor; de werfleider krijgt ze niet.
      versions = MinMeer.versionsOf(minMeer, workId).map(func(v : Types.MmVersion) : MV.MmVersionBrief { let x = MinMeer.versionBrief(mmCtx(), v); if (sc == #full) x else { { x with note = "" } } });
      posts = b.posts;
      canPropose = Rights.may(ctx, p, #proposeMinMeer, ?workId);
    };
  };

  // Kantoor: alles, met bedragen, kostprijzen, marges en OA-namen (auditregel "bekeek:min-meer").
  public shared ({ caller }) func readMinMeer(workId : Nat) : async Result.Result<MV.MinMeerFullView, Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    Rights.require({ works; settings }, p, #readMinMeer, ?workId);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let c = mmCtx();
    let b = MinMeer.build(c, workId, mmToday());
    Access.audit(audit, caller, ?p.id, ?workId, "bekeek:min-meer", w.code);
    let vs = MinMeer.versionsOf(minMeer, workId);
    #ok({
      workId;
      workCode = w.code;
      calcVersion = MinMeerCalc.version;
      baseQuote = b.baseLabel;
      baseQuoteId = switch (b.base) { case (?v) ?v.quoteId; case null null };
      rows = Array.tabulate<MV.MmRowView>(b.rows.size(), func i = MinMeer.rowView(c, b.rows[i], b.outs[i]));
      discs = Array.tabulate<MV.MmDiscView>(b.discs.size(), func i = { entryId = b.discs[i].entryId; chapter = b.discs[i].chapter; description = b.discs[i].description; pctBp = b.discs[i].pctBp; amountCents = b.discs[i].amountCents; counted = b.discs[i].counted; lessCents = b.totals.discs[i].lessCents });
      invoiced = b.invoiced;
      entries = MinMeer.entriesOf(minMeer, workId).filter(func(e : Types.MmEntry) : Bool = e.archivedAt == null).map(func(e : Types.MmEntry) : MV.MmEntryView = MinMeer.entryView(c, e));
      chapters = MinMeer.chaptersOf(b.totals);
      totals = MinMeer.totalsOf(b.totals, b.revisionCents);
      regieRates = MinMeer.ratesOf(minMeer, workId);
      regieOffer = MinMeer.offerRegie(c, b.base);
      dealRates = mmDealHints(workId);
      findings = MinMeer.findings(b);
      versions = vs.map(func(v : Types.MmVersion) : MV.MmVersionBrief = MinMeer.versionBrief(c, v));
      posts = b.posts;
      quoteFromCents = MinMeer.quoteFromCents(settings);
      lastHash = if (vs.size() == 0) "" else vs[vs.size() - 1].hash;
    });
  };

  // ── Regels ─────────────────────────────────────────────────────────────
  // Kantoor maakt of wijzigt een regel (met prijs en akkoord); de werfleider van de werf stelt een regel VOOR (meer- of minwerk,
  // zonder prijs, akkoord "wacht"; kantoor prijst ze daarna). `rev` = de stand die de beller las (0 voor een nieuwe regel).
  public shared ({ caller }) func saveMinMeerEntry(workId : Nat, entryId : ?Nat, rev : Nat, i : MV.MmEntryInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #proposeMinMeer, ?workId);
    let office = Rights.may(ctx, p, #editMinMeer, null) and Rights.may(ctx, p, #readCosts, null);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    if (w.status == #cancelled) { return #err("Deze werf is geannuleerd") };
    if (not office) {
      if (entryId != null) { return #err("Een voorstel past kantoor aan") };
      if (i.price != null) { return #err("De prijs zet kantoor") };
      if (i.kind != #extra and i.kind != #less) { return #err("Stel meerwerk of minwerk voor") };
      if (i.approval != #pending) { return #err("Een voorstel wacht op kantoor") };
    };
    let old : ?Types.MmEntry = switch entryId {
      case (?id) {
        let e = minMeer.entries.get(id) ?? return #err("Onbekende regel");
        if (e.workId != workId or e.archivedAt != null) { return #err("Onbekende regel") };
        if (e.rev != rev) { return #err("Iemand anders bewaarde deze regel intussen; laad opnieuw") };
        switch (e.approval) { case (#quote _) { return #err("Deze regel hoort bij een meerwerkofferte: pas die offerte aan") }; case _ {} };
        if (e.kind != i.kind) { return #err("De soort van een regel verandert niet: maak een nieuwe regel") };
        ?e;
      };
      case null null;
    };
    switch (mmCheckEntry(workId, entryId, i, office)) { case (?e) { return #err(e) }; case null {} };
    let today = mmToday();
    // ⚖3: meerwerk vanaf de drempel vraagt een meerwerkofferte met akkoord vooraf; "niet nodig" of "mondeling" volstaat dan niet.
    switch (i.price) {
      case (?pr) {
        let unit = mmUnitOf(pr);
        if ((i.kind == #extra or i.kind == #regie or i.kind == #cost) and (i.approval == #notNeeded or (switch (i.approval) { case (#recorded _) true; case _ false }))) {
          let amt = MinMeerCalc.amount({ chapter = ""; col = #extra; qtyMilli = i.qtyMilli; unitCents = unit; pctBp = null; counted = true });
          if (Int.abs(amt) >= MinMeer.quoteFromCents(settings)) { return #err("Meerwerk vanaf " # Progress.euro(MinMeer.quoteFromCents(settings)) # " vraagt een meerwerkofferte met akkoord vooraf: zet het akkoord op 'wacht' en maak een meerwerkofferte") };
        };
      };
      case null {};
    };
    switch (i.approval) { case (#recorded r) { if (r.day > today) { return #err("De dag van het akkoord ligt in de toekomst") } }; case _ {} };
    let now = Time.now();
    let id = switch old { case (?e) e.id; case null { if (MinMeer.ids(minMeer.byWork, workId).size() >= Config.maxMmEntries) { return #err("Te veel regels op deze werf") }; Ids.next(ctr, "mmEntry") } };
    let rec : Types.MmEntry = {
      id;
      workId;
      chapter = i.chapter.trim(#char ' ');
      root = i.root;
      kind = i.kind;
      description = i.description.trim(#char ' ');
      unit = i.unit.trim(#char ' ');
      qtyMilli = i.qtyMilli;
      pctBp = i.pctBp;
      day = i.day;
      approval = i.approval;
      proposedBy = switch old { case (?e) e.proposedBy; case null { if office null else ?p.id } };
      photoFileId = i.photoFileId;
      note = i.note.trim(#char ' ');
      rev = switch old { case (?e) e.rev + 1; case null 0 };
      createdAt = switch old { case (?e) e.createdAt; case null now };
      createdBy = switch old { case (?e) e.createdBy; case null p.id };
      updatedAt = now;
      updatedBy = p.id;
      archivedAt = null;
      archivedBy = null;
      archiveReason = "";
      extra = switch old { case (?e) e.extra; case null [] };
    };
    minMeer.entries.add(id, rec);
    if (old == null) { MinMeer.addIdx(minMeer.byWork, workId, id) };
    if (office) {
      switch (i.price) {
        case (?pr) minMeer.prices.add(id, #plain({ entryId = id; unitCents = mmUnitOf(pr); costCents = pr.costCents; marginBp = pr.marginBp; orgId = pr.orgId; at = now; by = p.id }));
        case null minMeer.prices.remove(id);
      };
    };
    Access.audit(audit, caller, ?p.id, ?workId, if office "min-meer-regel" else "min-meer-voorstel", w.code # " regel #" # id.toText() # " " # MinMeer.kindKey(i.kind) # (if (old == null) " nieuw" else " gewijzigd"));
    if (not office) { mmNotifyOffice("Voorstel " # MinMeer.kindKey(i.kind) # " op " # w.code # ": " # rec.description, workId, p.id) };
    #ok(id);
  };

  // Een regel weghalen (archiveren met reden). Kantoor elke regel; de werfleider enkel zijn eigen voorstel zolang het geen prijs heeft.
  public shared ({ caller }) func archiveMinMeerEntry(entryId : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let e = switch (minMeer.entries.get(entryId)) { case (?x) x; case null { mmOffice(p); return #err("Onbekende regel") } };
    let office = Rights.may(ctx, p, #editMinMeer, null) and Rights.may(ctx, p, #readCosts, null);
    if (not office) {
      Rights.require(ctx, p, #proposeMinMeer, ?e.workId);
      if (e.proposedBy != ?p.id or minMeer.prices.get(entryId) != null) { return #err("Geen toegang: enkel uw eigen voorstel zonder prijs") };
    } else { Rights.require(ctx, p, #readMinMeer, ?e.workId) };
    if (e.archivedAt != null) { return #err("Deze regel is al weg") };
    let why = reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxText) { return #err("Geef een reden (minstens " # Config.minQuoteReason.toText() # " tekens)") };
    switch (e.approval) {
      // Review M1: weg kan zolang geen versie van de meerwerkofferte verstuurd of aanvaard is (vervangen, ingetrokken, geweigerd of
      // ontwerp: wel).
      case (#quote vid) {
        switch (quotes.versions.get(vid)) {
          case (?v) { for (x in Quotes.versionsOf(quotes, v.quoteId).values()) { if (x.status == #sent or x.status == #accepted) { return #err("De meerwerkofferte van deze regel is " # Quotes.statusText(x.status) # " (v" # x.version.toText() # "): de regel blijft") } } };
          case null {};
        };
      };
      case _ {};
    };
    minMeer.entries.add(entryId, { e with archivedAt = ?Time.now(); archivedBy = ?p.id; archiveReason = why; rev = e.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?e.workId, "min-meer-regel-weg", "regel #" # entryId.toText() # ": " # why);
    #ok;
  };

  // Een automatische regel (opmeting, regie-uren, kost) uitsluiten, naar een ander hoofdstuk zetten of (een kost) doorrekenen; met
  // reden. Alles uit (niet uitsluiten, geen hoofdstuk, niet doorrekenen) = de regel volgt weer de bron.
  public shared ({ caller }) func setMinMeerOverride(workId : Nat, i : MV.MmOverrideInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    Rights.require({ works; settings }, p, #readMinMeer, ?workId);
    let key = i.key.trim(#char ' ');
    if (not (Text.startsWith(key, #text "opmeting:") or Text.startsWith(key, #text "uren:") or Text.startsWith(key, #text "kost:"))) { return #err("Enkel een regel uit de opmeting, het werfverslag of een factuur") };
    let b = MinMeer.build(mmCtx(), workId, mmToday());
    let r = b.rows.find(func(x : MinMeer.Row) : Bool = x.key == key) ?? return #err("Onbekende regel op deze werf");
    if (not r.overridable) { return #err("Deze regel kan niet aangepast worden") };
    if (i.passOn and r.source != "kost") { return #err("Enkel een kost wordt doorgerekend") };
    let why = i.reason.trim(#char ' ');
    if (why.size() < Config.minQuoteReason or why.size() > Config.maxText) { return #err("Geef een reden (minstens " # Config.minQuoteReason.toText() # " tekens)") };
    let ch : ?Text = switch (i.chapter) { case (?t) { let x = t.trim(#char ' '); if (x.size() == 0) null else if (x.size() > Config.maxLibTitle) { return #err("Hoofdstuk te lang") } else ?x }; case null null };
    if (not i.exclude and ch == null and not i.passOn) {
      minMeer.overrides.remove(key);
    } else {
      // De versie van de bron (een kostregel: haar inhoud): verandert de bron, dan vervalt de aanpassing (review M3).
      minMeer.overrides.add(key, { key; workId; exclude = i.exclude; chapter = ch; passOn = i.passOn; reason = why; at = Time.now(); by = p.id; extra = [("versie", r.version)] });
    };
    Access.audit(audit, caller, ?p.id, ?workId, "min-meer-aanpassing", key # (if (i.exclude) " uitgesloten" else "") # (if (i.passOn) " doorgerekend" else "") # (switch ch { case (?x) " → " # x; case null "" }) # ": " # why);
    #ok;
  };

  // Het regietarief voor de klant op deze werf, met datum (de hele lijst; leeg = terug naar de offerte en de afspraken).
  public shared ({ caller }) func saveMinMeerRegieRates(workId : Nat, rates : [MV.MmRateInput]) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    Rights.require({ works; settings }, p, #readMinMeer, ?workId);
    if (rates.size() > Config.maxMmRates) { return #err("Te veel tarieven") };
    let seen = Map.empty<Nat, Bool>();
    let now = Time.now();
    let out = List.empty<Types.MmRegieRate>();
    for (r in rates.values()) {
      if (r.fromDay == 0) { return #err("Geef de dag vanaf wanneer het tarief geldt") };
      if (r.sellCents <= 0 or r.sellCents > 10_000_000) { return #err("Regietarief: meer dan € 0") };
      if (seen.containsKey(r.fromDay)) { return #err("Twee tarieven op dezelfde dag") };
      if (r.note.size() > Config.maxText) { return #err("Notitie te lang") };
      seen.add(r.fromDay, true);
      out.add({ fromDay = r.fromDay; sellCents = r.sellCents; note = r.note.trim(#char ' '); at = now; by = p.id });
    };
    minMeer.regieRates.add(workId, #plain(out.toArray().sort(func(a, b) = Nat.compare(a.fromDay, b.fromDay))));
    Access.audit(audit, caller, ?p.id, ?workId, "min-meer-regietarief", rates.size().toText() # " tarief/tarieven");
    #ok;
  };

  // ── Versies ────────────────────────────────────────────────────────────
  // De stand van nu vastleggen onder een controlecode (nummer per werf uit settings.sequences, nooit size()). `expect` = wat de
  // browser rekende: een ander saldo of "nog te factureren" = de staat veranderde intussen (niets bewaard).
  public shared ({ caller }) func makeMinMeerVersion(workId : Nat, note : Text, expect : MV.MmExpect) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    Rights.require({ works; settings }, p, #readMinMeer, ?workId);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let n = note.trim(#char ' ');
    if (n.size() > Config.maxText) { return #err("Notitie te lang") };
    let c = mmCtx();
    let b = MinMeer.build(c, workId, mmToday());
    if (b.rows.size() == 0 and b.discs.size() == 0) { return #err("Niets om vast te leggen: geen getekende offerte en geen regels") };
    if (b.totals.balanceCents != expect.balanceCents or b.totals.toInvoiceCents != expect.toInvoiceCents) { return #err("De staat veranderde intussen (saldo " # Progress.euro(b.totals.balanceCents) # "): laad opnieuw") };
    if (MinMeer.ids(minMeer.versionsByWork, workId).size() >= Config.maxMmVersions) { return #err("Te veel versies op deze werf") };
    let key = MinMeer.seqKey(workId);
    let number = (switch (settings.sequences.get(key)) { case (?x) x; case null 0 }) + 1;
    settings.sequences.add(key, number);
    let id = Ids.next(ctr, "mmVersion");
    let d = mmToday();
    let clientName = switch (w.clientOrgId) { case (?o) { switch (org.orgs.get(o)) { case (?x) x.name; case null "" } }; case null "" };
    let fr = MinMeer.freeze(b, id, number, d, { issuer = QuoteDocs.issuer(settings); clientName; workCode = w.code; workName = w.name; workAddress = w.address }, n);
    let v0 : Types.MmVersion = { id; workId; number; day = d; hash = ""; calcVersion = MinMeerCalc.version; share = null; note = n; createdAt = Time.now(); createdBy = p.id; extra = [] };
    let v = { v0 with hash = MinMeer.hash(MinMeer.canonical(v0, fr)) };
    minMeer.versions.add(id, v);
    minMeer.frozen.add(id, #plain(fr));
    MinMeer.addIdx(minMeer.versionsByWork, workId, id);
    Access.audit(audit, caller, ?p.id, ?workId, "min-meer-versie", w.code # " versie " # number.toText() # " hash " # Text.fromIter(v.hash.chars().take(12)));
    #ok(id);
  };

  public shared ({ caller }) func readMinMeerVersion(versionId : Nat) : async Result.Result<MV.MmVersionRead, Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    let v = minMeer.versions.get(versionId) ?? return #err("Onbekende versie");
    Rights.require({ works; settings }, p, #readMinMeer, ?v.workId);
    let fr = MinMeer.frozenOf(minMeer, v.id) ?? return #err("Onbekende versie");
    let prev = MinMeer.previousOf(minMeer, v);
    Access.audit(audit, caller, ?p.id, ?v.workId, "bekeek:min-meer-versie", "versie #" # v.id.toText());
    let c = mmCtx();
    #ok({
      brief = MinMeer.versionBrief(c, v);
      hash = v.hash;
      intact = MinMeer.intact(minMeer, v);
      frozen = fr;
      changes = MinMeer.changes(switch prev { case (?x) MinMeer.frozenOf(minMeer, x.id); case null null }, fr);
      prevNumber = switch prev { case (?x) ?x.number; case null null };
      answer = switch (minMeer.answers.get(v.id)) { case (?a) ?MinMeer.answerView(c, a); case null null };
    });
  };

  // Delen met de klant: de versie verschijnt in Mijn werf (en bij de architect met de grant vorderingsstaten). Een melding zonder bedrag.
  public shared ({ caller }) func shareMinMeerVersion(versionId : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    mmOffice(p);
    let v = minMeer.versions.get(versionId) ?? return #err("Onbekende versie");
    Rights.require({ works; settings }, p, #readMinMeer, ?v.workId);
    if (v.share != null) { return #err("Deze versie is al gedeeld") };
    if (not MinMeer.intact(minMeer, v)) { return #err("De inhoud wijkt af van de controlecode: niet delen") };
    minMeer.versions.add(v.id, { v with share = ?{ at = Time.now(); by = p.id } });
    let ctx = { works; settings };
    let co = mmClientOrg(v.workId);
    for (q in access.persons.values()) {
      if (q.archivedAt == null and Access.hasActiveLink(access, q.id)) {
        let sc = Rights.minMeerScope(ctx, q, v.workId, co);
        if (sc == #client or sc == #reader) { Access.notify(audit, ctr, q.id, "min-meer", "Min-meerstaat versie " # v.number.toText() # " van " # mmWorkName(v.workId) # " staat klaar", ?v.workId) };
      };
    };
    Access.audit(audit, caller, ?p.id, ?v.workId, "min-meer-gedeeld", "versie " # v.number.toText());
    #ok;
  };

  // ── De klant en de architect (gedeelde versies) ────────────────────────
  public query ({ caller }) func listMyMinMeer() : async [MV.MyMinMeerBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #clientMinMeer, null);
    let out = List.empty<MV.MyMinMeerBrief>();
    for (v in minMeer.versions.values()) {
      switch (v.share) {
        case (?s) {
          let sc = Rights.minMeerScope(ctx, p, v.workId, mmClientOrg(v.workId));
          if (sc == #client or sc == #reader) {
            let ans = minMeer.answers.get(v.id);
            out.add({ id = v.id; workId = v.workId; workName = mmWorkName(v.workId); number = v.number; day = v.day; sharedAt = s.at; answered = switch ans { case (?a) ?a.ok; case null null }; canAnswer = sc == #client and ans == null and MinMeer.clientMode(settings) != "uit" });
          };
        };
        case null {};
      };
    };
    out.toArray().sort(func(a, b) = Int.compare(b.sharedAt, a.sharedAt));
  };

  public shared ({ caller }) func readMyMinMeer(versionId : Nat) : async Result.Result<MV.MyMinMeerRead, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #clientMinMeer, null);
    let (v, fr, sc) = switch (mmMine(p, versionId)) { case (?x) x; case null return #err("Onbekende versie") };
    Access.audit(audit, caller, ?p.id, ?v.workId, "bekeek:min-meer-klant", "versie #" # v.id.toText());
    let c = mmCtx();
    let prev = mmPrevShared(v);
    let ans = minMeer.answers.get(v.id);
    let intact = MinMeer.intact(minMeer, v);
    let mode = MinMeer.clientMode(settings);
    #ok({
      id = v.id; number = v.number; day = v.day; hash = v.hash; intact;
      issuer = fr.issuer; clientName = fr.clientName; workCode = fr.workCode; workName = fr.workName; workAddress = fr.workAddress; quoteRefs = fr.quoteRefs; note = fr.note;
      lines = MinMeer.myLines(fr); chapters = fr.chapters; invoiced = fr.invoiced; totals = fr.totals;
      changes = MinMeer.changes(switch prev { case (?x) MinMeer.frozenOf(minMeer, x.id); case null null }, fr);
      answer = switch ans { case (?a) ?MinMeer.answerView(c, a); case null null };
      canAnswer = sc == #client and ans == null and intact and mode != "uit";
      clientMode = mode;
    });
  };

  // Akkoord of een opmerking op de exacte gedeelde versie (controlecode). Eén antwoord per versie; enkel de klant (niet de architect).
  public shared ({ caller }) func answerMyMinMeer(versionId : Nat, hash : Text, ok : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #ownQuotes, null);
    let (v, _, sc) = switch (mmMine(p, versionId)) { case (?x) x; case null return #err("Onbekende versie") };
    if (sc != #client) { return #err("Enkel de klant antwoordt") };
    if (MinMeer.clientMode(settings) == "uit") { return #err("Een akkoord in de app staat uit: neem contact op met BOWACO") };
    if (minMeer.answers.get(v.id) != null) { return #err("U antwoordde al op deze versie") };
    if (hash != v.hash) { return #err("U ziet niet de versie die gedeeld werd: laad opnieuw") };
    if (not MinMeer.intact(minMeer, v)) { return #err("De inhoud wijkt af van wat gedeeld werd: neem contact op met BOWACO") };
    let why = note.trim(#char ' ');
    if (why.size() > Config.maxText) { return #err("Opmerking te lang") };
    if (not ok and why.size() < Config.minQuoteReason) { return #err("Schrijf wat er niet klopt") };
    minMeer.answers.add(v.id, { versionId = v.id; hash = v.hash; ok; note = why; at = Time.now(); personId = p.id; principal = caller; extra = [] });
    Access.audit(audit, caller, ?p.id, ?v.workId, if ok "min-meer-akkoord-klant" else "min-meer-opmerking-klant", "versie " # v.number.toText() # " hash " # Text.fromIter(v.hash.chars().take(12)));
    mmNotifyOffice((if ok "Akkoord van de klant op min-meerstaat versie " else "Opmerking van de klant op min-meerstaat versie ") # v.number.toText() # " (" # mmWorkName(v.workId) # ")" # (if ok "" else ": " # why), v.workId, p.id);
    #ok;
  };

  // ── De meerwerkofferte (⚖3) ────────────────────────────────────────────
  // Een gewone offerte van de soort meerwerk bij de getekende offerte van de werf, nummer "<offerte>-M<n>" (settings.sequences
  // "meerwerk:<offerte>"), versie 1 als ontwerp met de gekozen regels (hun verkoopprijs als vaste prijs, hun kostprijs en firma).
  // Daarna de gewone weg: bewerken, controle, versturen, PDF, klantakkoord, Werf starten (enkel het verschil). De regels krijgen als
  // akkoord "meerwerkofferte"; zolang ze niet aanvaard is, telt niets ervan; aanvaard tellen haar posten als meerwerk.
  public shared ({ caller }) func makeExtraWorkQuote(workId : Nat, entryIds : [Nat], title : Text) : async Result.Result<MV.MmExtraQuoteMade, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editQuote, null);
    mmOffice(p);
    Rights.require(ctx, p, #readQuotes, ?workId);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let t = Access.cleanText(title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    if (entryIds.size() > Config.maxQuoteOps) { return #err("Te veel regels in één meerwerkofferte") };
    let c = mmCtx();
    let base = Progress.baseVersion(MinMeer.progressCtx(c), workId) ?? return #err("Geen getekende offerte op deze werf: maak een gewone offerte");
    let q0 = quotes.quotes.get(base.quoteId) ?? return #err("Onbekende offerte");
    if (Quotes.ids(quotes.byWork, w.id).size() >= Config.maxQuotesPerWork) { return #err("Te veel offertes voor deze werf") };
    let b = MinMeer.build(c, workId, mmToday());
    // De regels nakijken: alles of niets.
    type L = { e : Types.MmEntry; r : MinMeer.Row; pr : ?Types.MmEntryPrice };
    let picked = List.empty<L>();
    let seen = Map.empty<Nat, Bool>();
    for (id in entryIds.values()) {
      if (seen.containsKey(id)) { return #err("Een regel staat twee keer in de keuze") };
      seen.add(id, true);
      let e = minMeer.entries.get(id) ?? return #err("Onbekende regel #" # id.toText());
      if (e.workId != workId or e.archivedAt != null) { return #err("Onbekende regel #" # id.toText()) };
      switch (e.approval) { case (#quote _) { return #err("«" # e.description # "» zit al in een meerwerkofferte") }; case _ {} };
      if (e.kind != #extra and e.kind != #regie and e.kind != #cost and e.kind != #less) { return #err("«" # e.description # "»: enkel meerwerk, regie, kosten of minwerk") };
      if (e.pctBp != null) { return #err("«" # e.description # "»: een post die deels vervalt, hoort niet in een meerwerkofferte") };
      let r = b.rows.find(func(x : MinMeer.Row) : Bool = x.key == "regel:" # id.toText()) ?? return #err("Onbekende regel #" # id.toText());
      if (r.flags.find(func(f : Text) : Bool = f == "te-prijzen") != null) { return #err("«" # e.description # "» heeft nog geen prijs") };
      picked.add({ e; r; pr = MinMeer.priceOf(minMeer, id) });
    };
    // Het nummer: "<offerte>-M<n>", uniek.
    let sk = MinMeer.extraSeqKey(q0.id);
    var n = (switch (settings.sequences.get(sk)) { case (?x) x; case null 0 }) + 1;
    while (quotes.numbers.get(q0.number # "-M" # n.toText()) != null) { n += 1 };
    let number = q0.number # "-M" # n.toText();
    if (number.size() > Config.maxQuoteNumber) { return #err("Offertenummer te lang") };
    settings.sequences.add(sk, n);
    let now = Time.now();
    let qid = Ids.next(ctr, "quote");
    quotes.quotes.add(qid, { id = qid; workId = w.id; number; title = t; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; archivedBy = null; archiveReason = ""; extra = [] });
    quotes.numbers.add(number, qid);
    Quotes.addIndex(quotes.byWork, w.id, qid);
    let vid = Ids.next(ctr, "quoteVersion");
    quotes.versions.add(vid, { id = vid; quoteId = qid; version = 1; status = #draft; title = t; vatBp = w.vatBp; clientOrgId = w.clientOrgId; validDays = Config.quoteValidDaysDefault; intro = "Meerwerk bij offerte " # q0.number # "."; note = ""; basedOnId = null; rev = 0; calcVersion = QuoteCalc.version; sent = null; decision = null; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; extra = [] });
    quotes.versionConf.add(vid, { versionId = vid; standardMarginBp = #plain(Library.standardMargin(settings)); extra = [] });
    quoteForms.versionForms.add(vid, QuoteForms.defaultForm(quoteForms, vid));
    Quotes.addIndex(quotes.byQuote, qid, vid);
    quoteForms.info.add(qid, { quoteId = qid; kind = #extraWork; baseQuoteId = ?q0.id; insurerOrgId = null; claimRef = ""; updatedAt = now; updatedBy = p.id; extra = [("bij", q0.number)] });
    // Hoofdstukken (per hoofdstuk van de regels) en lijnen.
    let chIds = Map.empty<Text, Nat>();
    var order = 0;
    func chapterId(text : Text) : Nat {
      switch (chIds.get(text)) {
        case (?x) x;
        case null {
          let (code, ttl) = mmSplitChapter(text);
          let id = Ids.next(ctr, "quoteChapter");
          quotes.chapters.add(id, { id; versionId = vid; code; title = ttl; order = chIds.size() + 1; libChapterId = null; archivedAt = null; extra = [] });
          Quotes.addIndex(quotes.chaptersByVersion, vid, id);
          chIds.add(text, id);
          id;
        };
      };
    };
    if (picked.size() == 0) { ignore chapterId("") };
    for (x in picked.values()) {
      order += 1;
      let chId = chapterId(x.r.chapter);
      let q = if (x.e.kind == #less) -Int.abs(x.r.qtyMilli) else Int.abs(x.r.qtyMilli);
      let lid = Ids.next(ctr, "quoteLine");
      quotes.lines.add(lid, { id = lid; versionId = vid; chapterId = chId; order; kind = #item; code = ""; title = x.e.description; text = x.e.note; specRef = ""; qtyMilli = q; unit = if (x.r.unit == "") "st" else x.r.unit; form = if (x.e.kind == #regie) #regie else #fixed; libItemId = null; libItemVersion = null; copiedFrom = null; archivedAt = null; extra = [("min-meer", x.e.id.toText())] });
      quotes.prices.add(lid, { lineId = lid; versionId = vid; cost = #plain(switch (x.pr) { case (?pr) pr.costCents; case null null }); rule = #plain(?#price(x.r.unitCents)); reason = #plain("uit de min-meerstaat"); orgId = switch (x.pr) { case (?pr) pr.orgId; case null null }; source = "eigen"; libCostId = null; extra = [] });
      Quotes.addIndex(quotes.linesByVersion, vid, lid);
      minMeer.entries.add(x.e.id, { x.e with approval = #quote(vid); rev = x.e.rev + 1; updatedAt = now; updatedBy = p.id });
    };
    Access.audit(audit, caller, ?p.id, ?w.id, "meerwerkofferte-gemaakt", number # " bij " # q0.number # " (" # picked.size().toText() # " regels)");
    #ok({ quoteId = qid; versionId = vid; number });
  };

  // ── Hulp ───────────────────────────────────────────────────────────────

  // De invoer van een regel nakijken (enkel lezen); null = in orde.
  func mmCheckEntry(workId : Nat, self : ?Nat, i : MV.MmEntryInput, office : Bool) : ?Text {
    let d = i.description.trim(#char ' ');
    if (d.size() == 0 or d.size() > Config.maxLibTitle) { return ?("Omschrijving: 1 tot " # Config.maxLibTitle.toText() # " tekens") };
    if (i.unit.size() > Config.maxLibCode) { return ?"Eenheid te lang" };
    if (i.chapter.size() > Config.maxLibTitle) { return ?"Hoofdstuk te lang" };
    if (i.note.size() > Config.maxText) { return ?"Opmerking te lang" };
    if (Int.abs(i.qtyMilli) > 1_000_000_000_000) { return ?"Hoeveelheid te groot" };
    // Review H1: de soort bepaalt het teken (minwerk gaat af, meerwerk komt erbij): nooit een negatieve hoeveelheid of prijs.
    if (i.qtyMilli < 0) { return ?"Geef een positieve hoeveelheid: de soort (minwerk of meerwerk) bepaalt het teken" };
    switch (i.price) {
      case (?pr) {
        let neg = (switch (pr.unitCents) { case (?u) u < 0; case null false }) or (switch (pr.costCents) { case (?k) k < 0; case null false });
        if (neg and i.kind != #invoiced) { return ?"Geef een positieve prijs: de soort (minwerk of meerwerk) bepaalt het teken" };
      };
      case null {};
    };
    switch (i.pctBp) {
      case (?b) { if (b == 0 or b > 10_000) { return ?"Percentage: meer dan 0 en hoogstens 100 %" }; if (i.kind != #less and i.kind != #discount) { return ?"Een percentage hoort bij minwerk op een post of een korting" } };
      case null {};
    };
    switch (i.day) { case (?x) { if (x == 0 or x > mmToday() + 366) { return ?"Ongeldige dag" } }; case null {} };
    switch (i.approval) {
      case (#quote _) { return ?"Een meerwerkofferte maakt u met Meerwerkofferte maken" };
      case (#recorded r) { let h = r.how.trim(#char ' '); if (h.size() == 0 or h.size() > 60) { return ?"Akkoord: zeg hoe (mondeling, mail, WhatsApp …), hoogstens 60 tekens" } };
      case _ {};
    };
    // De post van de offerte waarop de regel slaat: een lijn van een offerte van deze werf (de lijn van de eerste versie).
    let post : ?Types.QuoteLine = switch (i.root) {
      case (?r) {
        let l = quotes.lines.get(r) ?? return ?"Onbekende post";
        let v = quotes.versions.get(l.versionId) ?? return ?"Onbekende post";
        let q = quotes.quotes.get(v.quoteId) ?? return ?"Onbekende post";
        if (q.workId != workId or l.copiedFrom != null) { return ?"Onbekende post" };
        ?l;
      };
      case null null;
    };
    switch (i.kind) {
      case (#settle) {
        let l = post ?? return ?"Kies de post (raming) die afgerekend wordt";
        if (l.form != #regie and l.form != #estimate and l.form != #budget) { return ?"Enkel een raming, budget of regiepost wordt afgerekend" };
        let dup = MinMeer.entriesOf(minMeer, workId).find(func(e : Types.MmEntry) : Bool = e.archivedAt == null and e.kind == #settle and e.root == i.root);
        if (dup != null) { return ?"Deze raming is al afgerekend" };
      };
      case (#less) {
        if (i.pctBp != null and post == null) { return ?"Een percentage hoort bij een post van de offerte" };
        // Review M6: samen vervalt een post hoogstens voor 100 %.
        switch (i.pctBp) {
          case (?b) {
            var sum : Nat = b;
            for (e in MinMeer.entriesOf(minMeer, workId).values()) {
              if (e.archivedAt == null and e.kind == #less and e.root == i.root and ?e.id != self) { switch (e.pctBp) { case (?x) sum += x; case null {} } };
            };
            if (sum > 10_000) { return ?"Samen vervalt deze post voor meer dan 100 %" };
          };
          case null {};
        };
      };
      case (#discount) { if (i.pctBp == null and i.price == null) { return ?"Korting: een percentage of een bedrag" } };
      case (#invoiced) { if (i.price == null) { return ?"Geef het gefactureerde bedrag (excl. btw)" } };
      case (#cost) { switch (i.price) { case (?pr) { if (pr.costCents == null) { return ?"Een kost heeft een kostprijs" } }; case null { if (office) { return ?"Een kost heeft een kostprijs" } } } };
      case (#extra or #regie) {};
    };
    if ((i.kind == #discount or i.kind == #invoiced or i.kind == #cost or i.kind == #settle or i.kind == #regie) and not office) { return ?"Geen toegang" };
    switch (i.price) {
      case (?pr) {
        switch (pr.unitCents) { case (?u) { if (Int.abs(u) > 10_000_000_000) { return ?"Prijs te groot" } }; case null { if (pr.costCents == null) { return ?"Geef een prijs of een kostprijs" } } };
        switch (pr.costCents) { case (?k) { if (k < 0 or k > 10_000_000_000) { return ?"Kostprijs: 0 of meer" } }; case null {} };
        switch (pr.marginBp) { case (?m) { if (m >= 9_500) { return ?"Marge: lager dan 95 %" } }; case null {} };
        switch (pr.orgId) { case (?o) { if (not org.orgs.containsKey(o)) { return ?"Onbekende firma" } }; case null {} };
      };
      case null {};
    };
    switch (i.photoFileId) {
      case (?f) { if (reports.photos.values().find(func(x : Types.Photo) : Bool = x.workId == workId and x.fileId == f and x.archivedAt == null) == null) { return ?"Kies een foto uit het werfverslag van deze werf" } };
      case null {};
    };
    null;
  };
  func mmCtx() : MinMeer.Ctx { { settings; access; org; works; dossier; plan; reports; qs = quotes; qf = quoteForms; qd = quoteDocs; starts = workStarts; ss = surveys; ps = progress; oi = oaInvoices; deals = oaDeals; pu = purchases; sales; mm = minMeer } };
  func mmToday() : Nat { Post.local(Time.now()).day };
  // Kantoor met de bedragen (R41: #editMinMeer én #readCosts).
  func mmOffice(p : Types.Person) { let ctx = { works; settings }; Rights.require(ctx, p, #editMinMeer, null); Rights.require(ctx, p, #readCosts, null) };
  func mmClientOrg(workId : Nat) : ?Nat { switch (works.works.get(workId)) { case (?w) w.clientOrgId; case null null } };
  func mmWorkName(workId : Nat) : Text { switch (works.works.get(workId)) { case (?w) w.name; case null "" } };

  func mmUnitOf(pr : MV.MmPriceInput) : Int {
    switch (pr.unitCents, pr.costCents) {
      case (?u, _) u;
      case (null, ?k) MinMeer.sellOf(k, switch (pr.marginBp) { case (?m) m; case null MinMeer.costMargin(mmCtx(), pr.orgId, "") });
      case _ 0;
    };
  };

  // "01 Afbraak" → ("01", "Afbraak"); zonder code: ("", tekst); leeg: "Meerwerk".
  func mmSplitChapter(t : Text) : (Text, Text) {
    let s = t.trim(#char ' ');
    if (s.size() == 0) { return ("", "Meerwerk") };
    let parts = s.split(#char ' ').toArray();
    if (parts.size() >= 2 and parts[0].size() <= Config.maxLibCode and parts[0].chars().any(func(ch : Char) : Bool = ch >= '0' and ch <= '9')) {
      (parts[0], Text.join(parts.sliceToArray(1, parts.size()).values(), " "));
    } else ("", s);
  };

  // Een gedeelde versie die de beller mag zien (klant van de werf en van zijn firma, of architect met de grant).
  func mmMine(p : Types.Person, versionId : Nat) : ?(Types.MmVersion, Types.MmFrozen, Rights.MinMeerScope) {
    let v = minMeer.versions.get(versionId) ?? return null;
    if (v.share == null) { return null };
    let sc = Rights.minMeerScope({ works; settings }, p, v.workId, mmClientOrg(v.workId));
    if (sc != #client and sc != #reader) { return null };
    switch (MinMeer.frozenOf(minMeer, v.id)) { case (?fr) ?(v, fr, sc); case null null };
  };

  // De vorige GEDEELDE versie (de klant ziet enkel wat gedeeld werd).
  func mmPrevShared(v : Types.MmVersion) : ?Types.MmVersion {
    var best : ?Types.MmVersion = null;
    for (x in MinMeer.versionsOf(minMeer, v.workId).values()) { if (x.number < v.number and x.share != null) { best := ?x } };
    best;
  };

  // 2c.4: het regietarief van de afspraken op deze werf (vandaag), als voorstel voor het tarief van de werf.
  func mmDealHints(workId : Nat) : [MV.MmDealRateHint] {
    let out = List.empty<MV.MmDealRateHint>();
    for (aid in MinMeer.ids(oaDeals.agreementsByWork, workId).values()) {
      switch (oaDeals.agreements.get(aid)) {
        case (?a) {
          switch (mmDealTerms(a.id)) {
            case (?t) {
              for (r in t.rates.values()) {
                if (r.kind == #regiePerson) { out.add({ orgName = switch (org.orgs.get(a.orgId)) { case (?o) o.name; case null "" }; costCents = r.cents; sellCents = QuoteForms.regieSell(r.cents); fromDay = r.validFrom }) };
              };
            };
            case null {};
          };
        };
        case null {};
      };
    };
    out.toArray();
  };
  func mmDealTerms(id : Nat) : ?Types.AgreementTerms { switch (oaDeals.terms.get(id)) { case (?c) MinMeer.plain(c); case null null } };

  // Admin en calculator krijgen een melding (niet de afzender zelf; nooit een bedrag). Wie dat is, zegt Rights.mo.
  func mmNotifyOffice(text : Text, workId : Nat, except : Nat) {
    for (q in access.persons.values()) {
      if (q.archivedAt == null and q.id != except and Access.hasActiveLink(access, q.id) and Rights.isOffice(q)) {
        Access.notify(audit, ctr, q.id, "min-meer", text, ?workId);
      };
    };
  };
};
