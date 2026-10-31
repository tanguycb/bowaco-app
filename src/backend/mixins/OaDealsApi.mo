// Afspraken met de gekozen OA (stap 2c.4, ontwerp 2c §4.4, R40; VOORLOPIG: AC-15, AC-16, AC-17). Tarieven per firma met datum
// (firmafiche → Tarieven & attesten), de afspraak per werf en firma (ontstaat bij Werf starten, of met de hand), het contract uit
// het sjabloon onder een controlecode, getekend bewijs, aanhangsel = nieuwe versie, en de attesten van een firma (de OA laadt op,
// kantoor keurt). Rechten in lib/Rights.mo: #editDeals (admin, calculator: alles, bedragen enkel via update-calls met auditregel),
// #readDeals/dealScope (de werfleider van de werf: afspraak, contractstatus en attesten, nooit een bedrag), #ownDeals (de OA: zijn
// eigen contracten en attesten, met een willekeurige verwijzing in plaats van een id). Rekenen en zoeken in lib/OaDeals.mo en
// lib/OaContract.mo. Hulpfuncties hier dragen de prefix "od" (gedeeld over alle mixins).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";
import DV "../types/dealviews";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Measure "../lib/Measure";
import OaContract "../lib/OaContract";
import OaDeals "../lib/OaDeals";
import Plan "../lib/Plan";
import Post "../lib/Post";
import Progress "../lib/Progress";
import QuoteDocs "../lib/QuoteDocs";
import QuoteCalc "../lib/QuoteCalc";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  oa : Types.OaState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  tenders : Types.TenderState,
  oaDeals : Types.OaDealState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func odToday() : Types.Day { Post.local(Time.now()).day };
  func odOrgName(id : Nat) : Text { switch (org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };
  func odWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };
  // Kantoor met de bedragen (R40: #editDeals én #readCosts).
  func odOffice(p : Types.Person) { let ctx = { works; settings }; Rights.require(ctx, p, #editDeals, null); Rights.require(ctx, p, #readCosts, null) };

  func odAttestViews(orgId : Nat) : [DV.AttestStateView] {
    OaDeals.attestStates(oaDeals, settings, orgId, odToday()).map(func(a : OaDeals.AttestState) : DV.AttestStateView = { kind = a.kind; name = a.name; required = a.required; state = a.state; validUntil = a.validUntil });
  };

  func odStatusView(a : Types.Agreement) : DV.DealStatusView {
    { id = a.id; workId = a.workId; orgId = a.orgId; orgName = odOrgName(a.orgId); status = OaDeals.statusKey(a.status); contractVersion = a.contractVersion; contractHash = a.contractHash; startDay = a.startDay; posts = a.roots.size(); oaQuotes = a.oaQuoteIds.size(); attests = odAttestViews(a.orgId); rev = a.rev };
  };

  func odRateView(r : Types.OaRate) : DV.OaRateView {
    { id = r.id; orgId = r.orgId; kind = OaDeals.kindKey(r.kind); kindName = OaDeals.kindName(r.kind); unit = r.unit; cents = r.cents; validFrom = r.validFrom; source = r.source; ref = r.ref; fileId = r.fileId; note = r.note; createdAt = r.createdAt; createdByName = Access.personName(access, r.createdBy); archivedAt = r.archivedAt; archiveReason = r.archiveReason };
  };

  func odAgreedView(r : Types.AgreedRate) : DV.AgreedRateView {
    { kind = OaDeals.kindKey(r.kind); kindName = OaDeals.kindName(r.kind); unit = r.unit; cents = r.cents; validFrom = r.validFrom; fromRateId = r.fromRateId; note = r.note };
  };

  func odKinds() : [DV.OrgDocKindView] { OaDeals.docKinds(settings).map(func(k : OaDeals.Kind) : DV.OrgDocKindView = { key = k.key; name = k.name; required = k.required }) };

  // Eén tarief nakijken (soort, eenheid, bedrag, dag, herkomst).
  func odRateCheck(kind : Text, unit : Text, cents : Int, note : Text) : Result.Result<(Types.RateKind, Text, Text), Text> {
    let k = OaDeals.kindFromKey(kind) ?? return #err("Onbekende soort tarief");
    let u = switch (Access.cleanText(unit, Config.maxShort)) { case (?x) x; case null OaDeals.defaultUnit(k) };
    if (cents <= 0 or cents > Config.maxAmountCents) { return #err("Tarief: meer dan € 0 en hoogstens € 1 miljard") };
    if (note.size() > Config.maxNote) { return #err("Notitie: hoogstens " # Config.maxNote.toText() # " tekens") };
    #ok((k, u, note.trim(#char ' ')));
  };

  // ── Instellingen voor de schermen (geen bedragen) ───────────────────────
  public query ({ caller }) func dealSetup() : async DV.DealSetup {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #readOa, null) and not Rights.may(ctx, p, #ownDeals, null)) { Rights.require(ctx, p, #readOa, null) };
    let kinds = [#regiePerson, #crewHour, #transportHour, #dieselKm, #kmLevy, #containerTon, #machineDay].map(func(k : Types.RateKind) : DV.RateKindView = { key = OaDeals.kindKey(k); name = OaDeals.kindName(k); unit = OaDeals.defaultUnit(k) });
    { rateKinds = kinds; sources = Config.rateSources(); docKinds = odKinds(); maxAdvanceBp = Config.dealMaxAdvanceBp };
  };

  // ── Tarieven van een firma met datum (firmafiche → Tarieven & attesten) ──
  public shared ({ caller }) func listOaRates(orgId : Nat) : async Result.Result<[DV.OaRateView], Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    if (not org.orgs.containsKey(orgId)) { return #err("Onbekende firma") };
    Access.audit(audit, caller, ?p.id, null, "bekeek:tarieven", odOrgName(orgId));
    #ok(OaDeals.ratesOf(oaDeals, orgId, true).map(odRateView));
  };

  public shared ({ caller }) func saveOaRate(i : DV.OaRateInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let o = org.orgs.get(i.orgId) ?? return #err("Onbekende firma");
    if (o.archivedAt != null) { return #err("Deze firma is gearchiveerd") };
    if (o.kind != #subcontractor and o.kind != #supplier) { return #err("Tarieven horen bij een onderaannemer of leverancier") };
    let (k, u, note) = switch (odRateCheck(i.kind, i.unit, i.cents, i.note)) { case (#ok x) x; case (#err e) return #err(e) };
    if (i.validFrom == 0) { return #err("Kies de datum vanaf wanneer het tarief geldt") };
    if (Config.rateSources().find(func((s, _) : (Text, Text)) : Bool = s == i.source) == null) { return #err("Onbekende herkomst") };
    if (i.ref.size() > Config.maxName) { return #err("Verwijzing: hoogstens " # Config.maxName.toText() # " tekens") };
    switch (i.fileId) { case (?f) { if (not odFileOk(p, f)) { return #err("Onbekend bestand") } }; case null {} };
    if (OaDeals.ratesOf(oaDeals, i.orgId, true).size() >= Config.maxRatesPerOrg) { return #err("Te veel tarieven voor deze firma") };
    let id = Ids.next(ctr, "oaRate");
    let now = Time.now();
    oaDeals.rates.add(id, #plain({ id; orgId = i.orgId; kind = k; unit = u; cents = i.cents; validFrom = i.validFrom; source = i.source; ref = i.ref.trim(#char ' '); fileId = i.fileId; note; createdAt = now; createdBy = p.id; archivedAt = null; archiveReason = ""; extra = [] }));
    OaDeals.addIdx(oaDeals.ratesByOrg, i.orgId, id);
    // Nooit een bedrag in de auditlog.
    Access.audit(audit, caller, ?p.id, null, "tarief-nieuw", o.name # ": " # OaDeals.kindName(k) # " vanaf " # Plan.fmtDay(i.validFrom) # " (" # i.source # ")");
    #ok(id);
  };

  public shared ({ caller }) func archiveOaRate(id : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let r = OaDeals.rateOf(oaDeals, id) ?? return #err("Onbekend tarief");
    if (r.archivedAt != null) { return #err("Al gearchiveerd") };
    let why = Access.cleanText(reason, Config.maxNote) ?? return #err("Geef een reden");
    oaDeals.rates.add(id, #plain({ r with archivedAt = ?Time.now(); archiveReason = why }));
    Access.audit(audit, caller, ?p.id, null, "tarief-gearchiveerd", odOrgName(r.orgId) # ": " # OaDeals.kindName(r.kind) # " vanaf " # Plan.fmtDay(r.validFrom) # " (" # why # ")");
    #ok;
  };

  // ── Afspraken per werf ───────────────────────────────────────────────────
  // Wie werkt mee: per OA de afspraak, de contractstatus en de attesten (werfleider van de werf en kantoor; GEEN bedrag).
  public query ({ caller }) func listDeals(workId : Nat) : async [DV.DealStatusView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readDeals, ?workId);
    OaDeals.agreementsOf(oaDeals, workId).map(odStatusView);
  };

  func odPrices(a : Types.Agreement, t : ?Types.AgreementTerms) : [DV.DealPriceView] {
    let ps = Measure.posts(quotes, workStarts, a.workId);
    a.roots.filterMap(
      func(r : Nat) : ?DV.DealPriceView {
        let cents : ?Int = switch t { case (?x) { switch (x.prices.find(func((q, _) : (Nat, Int)) : Bool = q == r)) { case (?(_, c)) ?c; case null null } }; case null null };
        switch (ps.find(func(x : Measure.Post) : Bool = x.root == r)) {
          case (?x) ?{ root = r; title = (x.line.code # " " # x.line.title).trim(#char ' '); unit = x.line.unit; qtyMilli = x.line.qtyMilli; cents };
          case null ?{ root = r; title = "post #" # r.toText() # " (niet meer in de offerte)"; unit = ""; qtyMilli = 0; cents };
        };
      }
    );
  };

  func odOaQuoteName(id : Nat) : Text {
    switch (tenders.oaQuotes.get(id)) { case (?q) (if (q.number != "") q.number else "OA-offerte") # " van " # Plan.fmtDay(q.quoteDay) # " (v" # q.version.toText() # ")"; case null "#" # id.toText() };
  };

  func odFull(a : Types.Agreement) : DV.DealFullView {
    let t = OaDeals.termsOf(oaDeals, a.id);
    let versions = Array.tabulate<Nat>(a.contractVersion, func k = k + 1).filterMap(
      func(v : Nat) : ?DV.ContractVersionBrief {
        switch (OaDeals.frozenOf(oaDeals, a.id, v)) {
          case (?f) ?{ version = v; hash = f.hash; at = f.at; byName = Access.personName(access, f.by); signedAt = switch (f.signed) { case (?s) ?s.at; case null null } };
          case null null;
        };
      }
    );
    {
      deal = odStatusView(a);
      prices = odPrices(a, t);
      rates = switch t { case (?x) x.rates.map(odAgreedView); case null [] };
      firmRatesNow = OaDeals.ratesAt(oaDeals, a.orgId, odToday()).map(func(r : Types.OaRate) : DV.AgreedRateView = { kind = OaDeals.kindKey(r.kind); kindName = OaDeals.kindName(r.kind); unit = r.unit; cents = r.cents; validFrom = r.validFrom; fromRateId = ?r.id; note = r.note });
      amountCents = switch t { case (?x) x.amountCents; case null null };
      advanceBp = a.advanceBp;
      advanceCents = switch t { case (?x) x.advanceCents; case null null };
      paymentDays = a.paymentDays;
      endOfMonth = a.endOfMonth;
      oaQuotes = a.oaQuoteIds.map<Nat, (Nat, Text)>(func id = (id, odOaQuoteName(id)));
      versions;
      warnings = OaDeals.attestWarnings(oaDeals, settings, org, a.orgId, odToday());
    };
  };

  func odDeal(p : Types.Person, id : Nat) : Result.Result<Types.Agreement, Text> {
    let a = oaDeals.agreements.get(id) ?? return #err("Onbekende afspraak");
    if (not Rights.may({ works; settings }, p, #readDeals, ?a.workId)) { return #err("Onbekende afspraak") };
    #ok(a);
  };

  public shared ({ caller }) func readDeal(id : Nat) : async Result.Result<DV.DealFullView, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    Access.audit(audit, caller, ?p.id, ?a.workId, "bekeek:afspraak", odWorkCode(a.workId) # " · " # odOrgName(a.orgId));
    #ok(odFull(a));
  };

  // Een afspraak met de hand (een OA die er bij de werfstart nog niet was): posten en prijzen uit de getekende offerte(s),
  // tarieven van vandaag. Geeft de waarschuwingen over attesten terug.
  public shared ({ caller }) func createDeal(workId : Nat, orgId : Nat) : async Result.Result<{ id : Nat; warnings : [Text] }, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    Rights.require({ works; settings }, p, #readDeals, ?workId);
    let o = org.orgs.get(orgId) ?? return #err("Onbekende firma");
    if (o.kind != #subcontractor or o.archivedAt != null) { return #err("Een afspraak is met een (actieve) onderaannemer") };
    if (OaDeals.agreementOf(oaDeals, workId, orgId) != null) { return #err("Er is al een afspraak met deze firma op deze werf") };
    let fp = OaDeals.postsFor(quotes, workStarts, tenders, workId, orgId);
    let (id, _) = OaDeals.ensureForStart(oaDeals, ctr, { workId; orgId; roots = fp.roots; prices = fp.prices; amountCents = fp.amountCents; startDay = odToday(); regie = null; oaQuoteIds = fp.oaQuoteIds; by = p.id });
    let warn = OaDeals.attestWarnings(oaDeals, settings, org, orgId, odToday());
    Access.audit(audit, caller, ?p.id, ?workId, "afspraak-nieuw", odWorkCode(workId) # " · " # o.name # ": " # fp.roots.size().toText() # " posten" # (if (warn.size() > 0) " · " # warn.size().toText() # " attest(en) niet in orde" else ""));
    #ok({ id; warnings = warn });
  };

  // Voorschot (max. 20 %) en betaaltermijn. Na een getekend contract vraagt een wijziging een aanhangsel (nieuwe contractversie).
  public shared ({ caller }) func saveDealTerms(id : Nat, i : DV.DealTermsInput, rev : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (a.rev != rev) { return #err("De afspraak is intussen gewijzigd: vernieuw") };
    switch (a.status) { case (#ended _) return #err("Deze afspraak is beëindigd"); case _ {} };
    if (i.advanceBp > Config.dealMaxAdvanceBp) { return #err("Voorschot: hoogstens 20 %") };
    if (i.paymentDays == 0 or i.paymentDays > Config.maxPaymentTermDays) { return #err("Betaaltermijn: 1 tot " # Config.maxPaymentTermDays.toText() # " dagen") };
    let t = OaDeals.termsOf(oaDeals, a.id);
    let adv : ?Int = switch t { case (?x) { switch (x.amountCents) { case (?m) { if (i.advanceBp == 0) null else ?QuoteCalc.roundDiv(m * i.advanceBp, 10_000) }; case null null } }; case null null };
    switch t { case (?x) { oaDeals.terms.add(a.id, #plain({ x with advanceCents = adv })) }; case null {} };
    let now = Time.now();
    let back = if (a.status == #signed) #draft else a.status;
    oaDeals.agreements.add(a.id, { a with advanceBp = i.advanceBp; paymentDays = i.paymentDays; endOfMonth = i.endOfMonth; status = back; rev = a.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?a.workId, "afspraak-gewijzigd", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # ": voorschot en betaaltermijn" # (if (a.status == #signed) " (aanhangsel nodig)" else ""));
    #ok;
  };

  // ⚖9: een nieuw tarief op DEZE werf vanaf een datum (de firma vraagt meer, kantoor aanvaardt het hier). Wat ervoor gold, blijft.
  public shared ({ caller }) func addDealRate(id : Nat, i : DV.DealRateInput, rev : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (a.rev != rev) { return #err("De afspraak is intussen gewijzigd: vernieuw") };
    switch (a.status) { case (#ended _) return #err("Deze afspraak is beëindigd"); case _ {} };
    let (k, u, note) = switch (odRateCheck(i.kind, i.unit, i.cents, i.note)) { case (#ok x) x; case (#err e) return #err(e) };
    if (i.validFrom == 0) { return #err("Kies de datum vanaf wanneer het tarief op deze werf geldt") };
    switch (i.fromRateId) { case (?r) { switch (OaDeals.rateOf(oaDeals, r)) { case (?x) { if (x.orgId != a.orgId) { return #err("Dat tarief is van een andere firma") } }; case null return #err("Onbekend tarief") } }; case null {} };
    let t = switch (OaDeals.termsOf(oaDeals, a.id)) { case (?x) x; case null { { agreementId = a.id; prices = []; rates = []; amountCents = null; advanceCents = null; extra = [] } } };
    if (t.rates.size() >= Config.maxRatesPerDeal) { return #err("Te veel tarieven op deze afspraak") };
    if (t.rates.any(func(r : Types.AgreedRate) : Bool = r.kind == k and r.unit == u and r.validFrom == i.validFrom)) { return #err("Er is al een tarief van die soort vanaf die dag") };
    oaDeals.terms.add(a.id, #plain({ t with rates = t.rates.concat([{ kind = k; unit = u; cents = i.cents; validFrom = i.validFrom; fromRateId = i.fromRateId; note }]) }));
    let now = Time.now();
    let back = if (a.status == #signed) #draft else a.status;
    oaDeals.agreements.add(a.id, { a with status = back; rev = a.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?a.workId, "afspraak-tarief", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # ": " # OaDeals.kindName(k) # " vanaf " # Plan.fmtDay(i.validFrom) # (if (a.status == #signed) " (aanhangsel nodig)" else ""));
    #ok;
  };

  public shared ({ caller }) func endDeal(id : Nat, reason : Text, rev : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (a.rev != rev) { return #err("De afspraak is intussen gewijzigd: vernieuw") };
    switch (a.status) { case (#ended _) return #err("Al beëindigd"); case _ {} };
    let why = Access.cleanText(reason, Config.maxNote) ?? return #err("Geef een reden");
    let now = Time.now();
    oaDeals.agreements.add(a.id, { a with status = #ended({ at = now; by = p.id; reason = why }); rev = a.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?a.workId, "afspraak-beeindigd", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # ": " # why);
    #ok;
  };

  // ── Het contract (sjabloon → vastgelegd onder een controlecode → te tekenen → getekend; aanhangsel = nieuwe versie) ──
  func odRepresentative(orgId : Nat) : Text {
    let ps = access.persons.values().filter(func(x : Types.Person) : Bool = x.archivedAt == null and x.orgId == ?orgId).toArray();
    let titled = ps.find(func(x : Types.Person) : Bool = switch (oa.personContacts.get(x.id)) { case (?c) c.jobTitle != ""; case null false });
    switch titled {
      case (?x) { x.name # (switch (oa.personContacts.get(x.id)) { case (?c) ", " # c.jobTitle; case null "" }) };
      case null { if (ps.size() > 0) ps[0].name else "–" };
    };
  };

  func odFreeze(p : Types.Person, a : Types.Agreement) : Result.Result<Types.AgreementFrozen, Text> {
    let o = org.orgs.get(a.orgId) ?? return #err("Onbekende firma");
    let w = works.works.get(a.workId) ?? return #err("Onbekende werf");
    let t = OaDeals.termsOf(oaDeals, a.id);
    let tpl = OaContract.current(oaDeals);
    let posts = odPrices(a, t).map(func(x : DV.DealPriceView) : Types.FrozenPost = { root = x.root; title = x.title; unit = x.unit; qtyMilli = x.qtyMilli; unitCents = x.cents });
    let total = switch t { case (?x) x.amountCents; case null null };
    let tasks = Plan.tasksOf(plan, a.workId).filter(func(x : Types.Task) : Bool = x.responsibleOrgId == ?a.orgId or plan.assignments.values().any(func(s : Types.Assignment) : Bool = s.taskId == x.id and s.orgId == a.orgId and s.archivedAt == null));
    let contact = switch (oa.orgContacts.get(a.orgId)) { case (?c) [switch (c.phone) { case (?x) x; case null "" }, switch (c.email) { case (?x) x; case null "" }].filter(func(s : Text) : Bool = s != "").values().join(" · "); case null "" };
    let quotesText = a.oaQuoteIds.map(odOaQuoteName).values().join(", ");
    let price = (if (quotesText != "") "Volgens de offerte " # quotesText else "Volgens de eenheidsprijzen in de bijlage") # (switch total { case (?c) ", samen " # Progress.euro(c) # " excl. btw (hoeveelheden volgens de offerte, af te rekenen volgens de uitvoering)."; case null "." });
    let fields : [(Text, Text)] = [
      ("bowaco", QuoteDocs.issuer(settings)),
      ("firma", o.name),
      ("firma.adres", switch (OaContract.addressText(o.address)) { case "" "–"; case x x }),
      ("firma.kbo", switch (o.kbo) { case (?k) k; case null "–" }),
      ("firma.btw", switch (o.vat) { case (?v) v; case null "–" }),
      ("vertegenwoordiger", odRepresentative(a.orgId)),
      ("contact", if (contact == "") "–" else contact),
      ("werf", w.code),
      ("werf.adres", OaContract.addressText(?w.address)),
      ("werken", OaContract.postsText(posts)),
      ("prijs", price),
      ("voorschot", OaContract.advanceText(a, t)),
      ("betaling", OaContract.payText(a)),
      ("planning", OaContract.planText(Plan.calFor(plan, works, a.workId), tasks)),
    ];
    let f0 : Types.AgreementFrozen = {
      agreementId = a.id;
      contractVersion = a.contractVersion + 1;
      templateVersion = tpl.version;
      title = tpl.title;
      text = Text.fromIter(OaContract.fill(tpl.text, fields).chars().take(Config.maxContractText));
      fields;
      posts;
      rates = switch t { case (?x) x.rates; case null [] };
      totalCents = total;
      advanceBp = a.advanceBp;
      advanceCents = switch t { case (?x) x.advanceCents; case null null };
      hash = "";
      at = Time.now();
      by = p.id;
      signed = null;
      extra = if (tpl.provisional) [("voorlopig", "ja")] else [];
    };
    #ok({ f0 with hash = OaContract.hashOf(f0) });
  };

  func odContractView(f : Types.AgreementFrozen) : DV.OaContractView {
    { version = f.contractVersion; templateVersion = f.templateVersion; title = f.title; text = f.text; fields = f.fields; posts = f.posts; rates = f.rates.map(odAgreedView); totalCents = f.totalCents; advanceBp = f.advanceBp; advanceCents = f.advanceCents; hash = f.hash; at = f.at; signedAt = switch (f.signed) { case (?s) ?s.at; case null null }; provisional = OaDeals.extraGet(f.extra, "voorlopig") == "ja" };
  };

  // Contract maken (of een aanhangsel na het tekenen): alles ligt vast onder de controlecode; status "te tekenen".
  public shared ({ caller }) func makeOaContract(id : Nat, rev : Nat) : async Result.Result<DV.OaContractView, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (a.rev != rev) { return #err("De afspraak is intussen gewijzigd: vernieuw") };
    switch (a.status) { case (#ended _) return #err("Deze afspraak is beëindigd"); case _ {} };
    if (a.contractVersion >= Config.maxContractVersions) { return #err("Te veel contractversies") };
    let f = switch (odFreeze(p, a)) { case (#ok x) x; case (#err e) return #err(e) };
    oaDeals.frozen.add(OaDeals.frozenKey(a.id, f.contractVersion), #plain(f));
    let now = Time.now();
    oaDeals.agreements.add(a.id, { a with status = #toSign; contractVersion = f.contractVersion; contractHash = f.hash; templateVersion = ?f.templateVersion; signedFileId = null; rev = a.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?a.workId, "contract-klaar", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # ": versie " # f.contractVersion.toText() # (if (f.contractVersion > 1) " (aanhangsel)" else "") # ", controlecode " # Text.fromIter(f.hash.chars().take(12)));
    let warn = OaDeals.attestWarnings(oaDeals, settings, org, a.orgId, odToday());
    if (warn.size() > 0) { Access.notify(audit, ctr, p.id, "attest", "Contract " # odOrgName(a.orgId) # " op " # odWorkCode(a.workId) # ": " # warn.values().join("; "), ?a.workId) };
    #ok(odContractView(f));
  };

  public shared ({ caller }) func readOaContract(id : Nat, version : Nat) : async Result.Result<DV.OaContractView, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    let f = OaDeals.frozenOf(oaDeals, a.id, version) ?? return #err("Onbekende contractversie");
    Access.audit(audit, caller, ?p.id, ?a.workId, "bekeek:contract", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # " v" # version.toText());
    #ok(odContractView(f));
  };

  // Het getekende bewijs (vertrouwelijk bestand) bij de laatste versie → "getekend".
  public shared ({ caller }) func markOaContractSigned(id : Nat, version : Nat, fileId : Nat, note : Text, rev : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let a = switch (odDeal(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (a.rev != rev) { return #err("De afspraak is intussen gewijzigd: vernieuw") };
    if (version != a.contractVersion or a.status != #toSign) { return #err("Enkel de laatste versie die klaar is om te tekenen") };
    let f = OaDeals.frozenOf(oaDeals, a.id, version) ?? return #err("Onbekende contractversie");
    if (not odFileOk(p, fileId)) { return #err("Onbekend bestand") };
    if (note.size() > Config.maxNote) { return #err("Notitie te lang") };
    let now = Time.now();
    oaDeals.frozen.add(OaDeals.frozenKey(a.id, version), #plain({ f with signed = ?{ at = now; by = p.id; fileId; note = note.trim(#char ' ') } }));
    oaDeals.agreements.add(a.id, { a with status = #signed; signedFileId = ?fileId; rev = a.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?a.workId, "contract-getekend", odWorkCode(a.workId) # " · " # odOrgName(a.orgId) # " v" # version.toText());
    #ok;
  };

  // ── Het sjabloon (Beheer → Offertes & voorwaarden; versies, zoals de voorwaarden van 2.7) ──
  public query ({ caller }) func listContractTemplates() : async [DV.ContractTemplateView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editDeals, null);
    let own = oaDeals.templates.values().map(func(t : Types.OaContractTemplate) : DV.ContractTemplateView = { id = t.id; version = t.version; title = t.title; text = t.text; provisional = t.provisional; note = t.note; createdAt = t.createdAt; createdByName = Access.personName(access, t.createdBy); archived = t.archivedAt != null }).toArray();
    [{ id = 0; version = 0; title = OaContract.builtinTitle(); text = OaContract.builtinText(); provisional = true; note = "ingebouwde voorlopige tekst"; createdAt = 0; createdByName = ""; archived = false }].concat(own.sort(func(a, b) = Nat.compare(b.version, a.version)));
  };

  public shared ({ caller }) func saveContractTemplate(title : Text, text : Text, provisional : Bool, note : Text) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let ti = Access.cleanText(title, Config.maxName) ?? return #err("Titel: 1 tot " # Config.maxName.toText() # " tekens");
    let tx = text.trim(#char ' ');
    if (tx.size() < 20 or tx.size() > Config.maxContractText) { return #err("Tekst: 20 tot " # Config.maxContractText.toText() # " tekens") };
    if (note.size() > Config.maxNote) { return #err("Notitie te lang") };
    let version = OaContract.current(oaDeals).version + 1;
    let id = Ids.next(ctr, "oaContractTemplate");
    oaDeals.templates.add(id, { id; version; title = ti; text = tx; provisional; note = note.trim(#char ' '); createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    Access.audit(audit, caller, ?p.id, null, "contractsjabloon-nieuw", "versie " # version.toText() # (if provisional " (voorlopig)" else ""));
    #ok(version);
  };

  // ── Bestanden (vertrouwelijk: getekend contract, bewijs bij een tarief, attest) ──
  func odFileOk(p : Types.Person, id : Nat) : Bool {
    switch (files.files.get(id)) { case (?f) f.archivedAt == null and f.confidential and (f.personId == p.id or Rights.isOffice(p)); case null false };
  };

  func odAddFile(p : Types.Person, name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob, workId : ?Nat) : Result.Result<Nat, Text> {
    let n = Access.cleanText(name, 200) ?? return #err("Bestandsnaam: 1 tot 200 tekens");
    if (not Config.allowedMime(mime)) { return #err("Alleen JPEG, PNG, WebP of PDF") };
    if (size == 0 or size > Config.maxFileBytes) { return #err("Bestand te groot") };
    if (blob.size() > 200) { return #err("Het bestand klopt niet") };
    if (files.files.values().filter(func(f : Types.FileRef) : Bool = f.personId == p.id).size() >= Config.maxFilesPerPerson) { return #err("De opslagruimte is vol. Neem contact op met BOWACO") };
    let id = Ids.next(ctr, "file");
    let fr : Types.FileRef = { id; name = n; mime; size; blob; workId; confidential = true; personId = p.id; at = Time.now(); var archivedAt = null };
    files.files.add(id, fr);
    #ok(id);
  };

  public shared ({ caller }) func addDealFile(name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob, purpose : DV.DealFilePurpose) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    odOffice(p);
    let workId : ?Nat = switch purpose {
      case (#signed aid) { switch (odDeal(p, aid)) { case (#ok a) ?a.workId; case (#err e) return #err(e) } };
      case (#rate o or #orgDoc o) { if (not org.orgs.containsKey(o)) { return #err("Onbekende firma") }; null };
    };
    let id = switch (odAddFile(p, name, mime, size, blob, workId)) { case (#ok x) x; case (#err e) return #err(e) };
    Access.audit(audit, caller, ?p.id, workId, "bestand-toegevoegd", "afspraken: " # name # " (" # size.toText() # " B, vertrouwelijk)");
    #ok(id);
  };

  // ── Attesten van een firma (firmafiche: interne rollen lezen de stand, kantoor keurt) ──
  func odDocView(x : Types.OrgDoc) : DV.OrgDocView {
    { id = x.id; orgId = x.orgId; kind = x.kind; kindName = OaDeals.kindLabel(settings, x.kind); title = x.title; validFrom = x.validFrom; validUntil = x.validUntil; status = x.status; hasFile = x.fileId != null; deliveredByName = switch (x.deliveredBy) { case (?d) Access.personName(access, d); case null "" }; checkedByName = switch (x.checkedBy) { case (?d) Access.personName(access, d); case null "" }; checkedAt = x.checkedAt; note = x.note; createdAt = x.createdAt };
  };

  public query ({ caller }) func listOrgDocs(orgId : Nat) : async DV.OrgDocsView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOa, null);
    { kinds = odKinds(); states = odAttestViews(orgId); docs = OaDeals.docsOf(oaDeals, orgId).map(odDocView).reverse(); mayReview = Rights.may({ works; settings }, p, #editDeals, null) };
  };

  func odDocCheck(kind : Text, title : Text, validFrom : ?Types.Day, validUntil : ?Types.Day, note : Text) : Result.Result<Text, Text> {
    if (OaDeals.docKinds(settings).find(func(k : OaDeals.Kind) : Bool = k.key == kind) == null) { return #err("Onbekende soort attest") };
    if (title.size() > Config.maxName) { return #err("Titel: hoogstens " # Config.maxName.toText() # " tekens") };
    if (note.size() > Config.maxNote) { return #err("Notitie te lang") };
    switch (validFrom, validUntil) { case (?f, ?u) { if (u < f) { return #err("Geldig tot ligt vóór geldig vanaf") } }; case _ {} };
    if (validUntil == null) { return #err("Vul in tot wanneer het attest geldig is") };
    #ok(if (title.trim(#char ' ') == "") OaDeals.kindLabel(settings, kind) else title.trim(#char ' '));
  };

  func odAddDoc(p : Types.Person, orgId : Nat, kind : Text, title : Text, fileId : ?Nat, validFrom : ?Types.Day, validUntil : ?Types.Day, note : Text, approved : Bool) : Nat {
    let id = Ids.next(ctr, "orgDoc");
    let now = Time.now();
    oaDeals.orgDocs.add(id, { id; orgId; kind; title; fileId; validFrom; validUntil; status = if approved #approved else #received; deliveredBy = ?p.id; checkedBy = if approved ?p.id else null; checkedAt = if approved ?now else null; note = note.trim(#char ' '); createdAt = now; createdBy = p.id; archivedAt = null; extra = [("ref", OaDeals.newRef("attest|" # id.toText() # "|" # now.toText()))] });
    OaDeals.addIdx(oaDeals.docsByOrg, orgId, id);
    id;
  };

  // Kantoor zet een attest (meteen goedgekeurd: kantoor keurt zelf).
  public shared ({ caller }) func saveOrgDoc(i : DV.OrgDocInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editDeals, null);
    let o = org.orgs.get(i.orgId) ?? return #err("Onbekende firma");
    let title = switch (odDocCheck(i.kind, i.title, i.validFrom, i.validUntil, i.note)) { case (#ok x) x; case (#err e) return #err(e) };
    switch (i.fileId) { case (?f) { if (not odFileOk(p, f)) { return #err("Onbekend bestand") } }; case null {} };
    if (OaDeals.docsOf(oaDeals, i.orgId).size() >= Config.maxOrgDocs) { return #err("Te veel attesten voor deze firma") };
    let id = odAddDoc(p, i.orgId, i.kind, title, i.fileId, i.validFrom, i.validUntil, i.note, true);
    Access.audit(audit, caller, ?p.id, null, "attest-nieuw", o.name # ": " # title # " geldig tot " # (switch (i.validUntil) { case (?u) Plan.fmtDay(u); case null "–" }));
    #ok(id);
  };

  // Goedkeuren of afkeuren (met reden) wat een OA oplaadde (⚖11: het telt pas na de goedkeuring).
  public shared ({ caller }) func reviewOrgDoc(id : Nat, ok : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editDeals, null);
    let x = oaDeals.orgDocs.get(id) ?? return #err("Onbekend attest");
    if (x.archivedAt != null) { return #err("Gearchiveerd") };
    if (x.status != #received) { return #err("Dit attest is al gekeurd") };
    if (not ok and note.trim(#char ' ').size() < Config.minQuoteReason) { return #err("Geef een reden om af te keuren") };
    if (note.size() > Config.maxNote) { return #err("Notitie te lang") };
    oaDeals.orgDocs.add(id, { x with status = if ok #approved else #expired; checkedBy = ?p.id; checkedAt = ?Time.now(); note = if (note.trim(#char ' ') == "") x.note else note.trim(#char ' ') });
    Access.audit(audit, caller, ?p.id, null, if ok "attest-goedgekeurd" else "attest-afgekeurd", odOrgName(x.orgId) # ": " # x.title);
    // De OA die het opleverde, hoort de uitkomst.
    switch (x.deliveredBy) { case (?d) { if (d != p.id) { Access.notify(audit, ctr, d, "attest", "Attest «" # x.title # "»: " # (if ok "goedgekeurd." else "afgekeurd (" # note.trim(#char ' ') # ")."), null) } }; case null {} };
    #ok;
  };

  // ── De OA: Mijn contracten en Mijn attesten (enkel zijn eigen firma; verwijzing in plaats van een id) ──
  func odMyOrg(p : Types.Person) : Nat {
    Rights.require({ works; settings }, p, #ownDeals, null);
    switch (p.orgId) { case (?o) o; case null 0 };
  };

  // Een contract van zijn firma dat kantoor klaarzette (te tekenen of getekend); een ontwerp zonder versie ziet hij niet.
  func odMine(p : Types.Person, ref : Text) : ?Types.Agreement {
    let o = odMyOrg(p);
    if (ref.size() != 16) { return null };
    OaDeals.agreementsOfOrg(oaDeals, o).find(func(a : Types.Agreement) : Bool = OaDeals.refOf(a.extra) == ref and a.contractVersion > 0 and Rights.ownOrg(p, a.orgId));
  };

  public query ({ caller }) func listMyContracts() : async [DV.MyContractBrief] {
    let p = Access.requireActive(access, caller);
    let o = odMyOrg(p);
    OaDeals.agreementsOfOrg(oaDeals, o).filter(func(a : Types.Agreement) : Bool = a.contractVersion > 0).map(
      func(a : Types.Agreement) : DV.MyContractBrief {
        let addr = switch (works.works.get(a.workId)) { case (?w) OaContract.addressText(?w.address); case null "" };
        { ref = OaDeals.refOf(a.extra); workAddress = addr; status = OaDeals.statusKey(a.status); contractVersion = a.contractVersion; versions = Array.tabulate<Nat>(a.contractVersion, func k = k + 1); signed = a.status == #signed };
      }
    );
  };

  public shared ({ caller }) func readMyContract(ref : Text, version : Nat) : async Result.Result<DV.OaContractView, Text> {
    let p = Access.requireActive(access, caller);
    let a = odMine(p, ref) ?? return #err("Onbekend contract");
    let f = OaDeals.frozenOf(oaDeals, a.id, version) ?? return #err("Onbekend contract");
    Access.audit(audit, caller, ?p.id, ?a.workId, "bekeek:mijn-contract", odOrgName(a.orgId) # " v" # version.toText());
    #ok(odContractView(f));
  };

  public shared ({ caller }) func readMyContractFile(ref : Text, version : Nat) : async Result.Result<DV.MyFileOpen, Text> {
    let p = Access.requireActive(access, caller);
    let a = odMine(p, ref) ?? return #err("Onbekend contract");
    let f = OaDeals.frozenOf(oaDeals, a.id, version) ?? return #err("Onbekend contract");
    let s = f.signed ?? return #err("Nog niet getekend");
    let fr = files.files.get(s.fileId) ?? return #err("Onbekend contract");
    Access.audit(audit, caller, ?p.id, ?a.workId, "bekeek:mijn-contract-getekend", odOrgName(a.orgId) # " v" # version.toText());
    #ok({ name = fr.name; mime = fr.mime; size = fr.size; blob = fr.blob });
  };

  func odMyAttestView(x : Types.OrgDoc) : DV.MyAttestView {
    { ref = OaDeals.refOf(x.extra); kind = x.kind; kindName = OaDeals.kindLabel(settings, x.kind); title = x.title; validFrom = x.validFrom; validUntil = x.validUntil; status = x.status; note = x.note; createdAt = x.createdAt };
  };

  public query ({ caller }) func listMyAttests() : async DV.MyAttestsView {
    let p = Access.requireActive(access, caller);
    let o = odMyOrg(p);
    { kinds = odKinds(); states = odAttestViews(o); docs = OaDeals.docsOf(oaDeals, o).map(odMyAttestView).reverse() };
  };

  // De OA laadt een attest op (bestand en datum in één keer); het telt pas als kantoor het goedkeurt (⚖11).
  public shared ({ caller }) func addMyAttest(kind : Text, title : Text, validFrom : ?Types.Day, validUntil : ?Types.Day, name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob) : async Result.Result<DV.MyAttestView, Text> {
    let p = Access.requireActive(access, caller);
    let o = odMyOrg(p);
    let t = switch (odDocCheck(kind, title, validFrom, validUntil, "")) { case (#ok x) x; case (#err e) return #err(e) };
    if (OaDeals.docsOf(oaDeals, o).size() >= Config.maxOrgDocs) { return #err("Te veel attesten. Neem contact op met BOWACO") };
    let fid = switch (odAddFile(p, name, mime, size, blob, null)) { case (#ok x) x; case (#err e) return #err(e) };
    let id = odAddDoc(p, o, kind, t, ?fid, validFrom, validUntil, "", false);
    Access.audit(audit, caller, ?p.id, null, "attest-opgeladen", odOrgName(o) # ": " # t);
    for (q in access.persons.values()) {
      if (q.archivedAt == null and Rights.isOffice(q)) { Access.notify(audit, ctr, q.id, "attest", odOrgName(o) # " laadde het attest «" # t # "» op: na te kijken op de firmafiche.", null) };
    };
    switch (oaDeals.orgDocs.get(id)) { case (?x) #ok(odMyAttestView(x)); case null #err("Onbekend attest") };
  };

  public shared ({ caller }) func readMyAttestFile(ref : Text) : async Result.Result<DV.MyFileOpen, Text> {
    let p = Access.requireActive(access, caller);
    let o = odMyOrg(p);
    let x = OaDeals.docsOf(oaDeals, o).find(func(d : Types.OrgDoc) : Bool = ref.size() == 16 and OaDeals.refOf(d.extra) == ref) ?? return #err("Onbekend attest");
    let fid = x.fileId ?? return #err("Geen bestand");
    let fr = files.files.get(fid) ?? return #err("Geen bestand");
    Access.audit(audit, caller, ?p.id, null, "bekeek:mijn-attest", odOrgName(o) # ": " # x.title);
    #ok({ name = fr.name; mime = fr.mime; size = fr.size; blob = fr.blob });
  };

  // De ronde van de timer meteen (admin; zoals scanPermits, voor de proeven). Idempotent: één melding per attest. Geeft het aantal.
  public shared ({ caller }) func scanOrgDocs() : async Nat {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let n = OaDeals.scan(oaDeals, settings, access, org, audit, ctr, odToday());
    Access.audit(audit, caller, ?p.id, null, "attesten-nagekeken", n.toText() # " meldingen");
    n;
  };
};
