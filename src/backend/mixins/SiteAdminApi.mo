// Werfadministratie en oplevering (stap 2c.8, ontwerp 2c §4.8, §8 R45–R46; zonder AI; VOORLOPIG: AC-7, AC-25). Per werf: de
// verzekering (soort, verzekeraar en makelaar, polis, periode, aangifte uiterlijk 15 dagen na de start met meldingen, premie uit de
// werfwaarde, attest naar de klant), de werfvergaderingen (aanwezigen, verslag, actiepunten = taken), de opleveringen (voorlopig en
// definitief, PV, restpunten = taken per OA, opleveringsdocument onder een controlecode) en de technische fiches voor het PID.
//   • Rechten (Rights.mo): interne rollen die de werf zien lezen (#readSiteAdmin); admin, calculator en de werfleider van de werf
//     bewaren (#editSiteAdmin). Werfwaarde en premie = #readCosts (admin, calculator), enkel via update-calls met auditregel. De
//     klant ziet enkel wat kantoor deelde (clientSiteAdmin). Een OA ziet alleen zijn eigen taken (planning, Mijn week).
//   • Actiepunten en restpunten zijn gewone taken (templateKey "actiepunt" / "restpunt"): niets in de planning verandert.
// Geen await in deze mixin: elke oproep is één atomische stap (R33).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import SV "../types/siteviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Oa "../lib/Oa";
import Plan "../lib/Plan";
import Post "../lib/Post";
import Rights "../lib/Rights";
import SiteAdmin "../lib/SiteAdmin";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  siteAdmin : Types.SiteAdminState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Hulpen (prefix sa) ───────────────────────────────────────────────────
  func saCtx() : SiteAdmin.Ctx { { settings; access; org; works; plan; audit; ctr } };
  func saOrgName(id : ?Nat) : Text { switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.name; case null "#" # x.toText() } }; case null "" } };
  func saWorkCode(id : ?Nat) : Text { switch id { case (?x) { switch (works.works.get(x)) { case (?w) w.code; case null "#" # x.toText() } }; case null "" } };
  func saFileName(id : ?Nat) : Text { switch id { case (?x) { switch (files.files.get(x)) { case (?f) f.name; case null "" } }; case null "" } };
  // Review L1: een bestaande keuze blijft aanvaard ook als de firma intussen gearchiveerd is (`keep`); een nieuw gekozen gearchiveerde firma niet.
  func saOrgOk(id : ?Nat, keep : ?Nat) : Bool {
    switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.archivedAt == null or id == keep; case null false } }; case null true };
  };
  func saStale<T>() : Result.Result<T, Text> { #err("Iemand anders bewaarde dit intussen: vernieuw en probeer opnieuw") };
  func saToday() : Nat { Post.local(Time.now()).day };
  func saDeny<T>() : Result.Result<T, Text> { #err("Geen toegang") };

  // Een bestand van deze werf (nog niet gearchiveerd), zoals de documenten het eisen.
  func saFileOk(id : ?Nat, workId : ?Nat) : Bool {
    switch id {
      case (?x) { switch (files.files.get(x)) { case (?f) f.archivedAt == null and f.workId == workId and not f.confidential; case null false } };
      case null true;
    };
  };
  // Bestand van de werf, met de gevraagde vertrouwelijkheid (stukken met werfwaarde of premie zijn vertrouwelijk).
  func saFileConf(id : Nat, workId : Nat, confidential : Bool) : Bool {
    switch (files.files.get(id)) { case (?f) f.archivedAt == null and f.workId == ?workId and f.confidential == confidential; case null false };
  };

  // ── Instellingen ─────────────────────────────────────────────────────────
  // De volgende werfcode (P.nnn) als de instelling aan staat: wie een werf mag maken ziet hem als voorstel; verbruikt wordt hij pas bij het maken.
  public query ({ caller }) func nextWorkCode() : async ?Text {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #createWork, null);
    if (SiteAdmin.codeP(settings)) ?SiteAdmin.peekWorkCode(settings, works) else null;
  };

  public query ({ caller }) func siteAdminSettings() : async SV.SiteAdminSettings {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readCosts, null);
    saSettings();
  };

  func saSettings() : SV.SiteAdminSettings {
    {
      codeP = SiteAdmin.codeP(settings);
      rates = ["rc10", "ba10", "abr"].map(func(s : Text) : ((Text, Nat, Int)) { let (r, m) = SiteAdmin.rateOf(settings, s); (s, r, m) });
      nextCode = SiteAdmin.peekWorkCode(settings, works);
    };
  };

  public shared ({ caller }) func saveSiteAdminSettings(i : SV.SiteAdminSettingsInput) : async Result.Result<SV.SiteAdminSettings, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    for ((slot, rate, min) in i.rates.values()) {
      if (slot != "rc10" and slot != "ba10" and slot != "abr") { return #err("Onbekende verzekeringssoort") };
      if (rate > 100_000) { return #err("Tarief: hoogstens 100 ‰") };
      if (min < 0 or min > 1_000_000_00) { return #err("Minimum: tussen € 0 en € 1.000.000") };
    };
    settings.values.add("siteadmin.codeP", if (i.codeP) "ja" else "nee");
    for ((slot, rate, min) in i.rates.values()) {
      settings.values.add("siteadmin.rate." # slot, rate.toText());
      settings.values.add("siteadmin.min." # slot, min.toText());
    };
    Access.audit(audit, caller, ?p.id, null, "werfadmin-instellingen", "werfcode P.nnn: " # (if (i.codeP) "aan" else "uit") # ", tarieven aangepast");
    #ok(saSettings());
  };

  // ── Verzekering: lezen (zonder bedragen) ─────────────────────────────────
  func saInsView(p : Types.Person, x : Types.Insurance) : SV.InsuranceView {
    let ctx = { works; settings };
    let due = SiteAdmin.declareDay(works, plan, x);
    let today = saToday();
    let state = switch (x.status, due) {
      case (#toDeclare, ?u) { if (today > u) "te-laat" else if (today == u) "vandaag" else if (today + SiteAdmin.noticeDays >= u) "binnenkort" else "ruim" };
      case _ "";
    };
    // Review M1: de documenten (vragenlijst, polis, attest …) bevatten werfwaarde of premie: enkel wie de bedragen mag zien, ziet ze in de lijst.
    let docs = if (not Rights.may(ctx, p, #readCosts, null)) [] else x.documentIds.filterMap(func(id : Nat) : ?SV.InsuranceDocView {
      switch (dossier.documents.get(id)) {
        case (?d) {
          if (d.archivedAt != null) null else {
            let last = if (d.fileIds.size() == 0) null else ?d.fileIds[d.fileIds.size() - 1];
            ?{ docId = d.id; kind = d.kind; title = d.title; fileId = last; fileName = saFileName(last); status = d.status };
          };
        };
        case null null;
      };
    });
    {
      id = x.id;
      workId = x.workId;
      workCode = saWorkCode(x.workId);
      kind = x.kind;
      kindName = SiteAdmin.kindName(x.kind);
      insurerOrgId = x.insurerOrgId;
      insurerName = saOrgName(x.insurerOrgId);
      brokerOrgId = x.brokerOrgId;
      brokerName = saOrgName(x.brokerOrgId);
      policyRef = x.policyRef;
      periodFrom = x.periodFrom;
      periodTo = x.periodTo;
      startDay = switch (x.workId) { case (?w) SiteAdmin.startOf(works, plan, w); case null null };
      declareBy = if (x.status == #toDeclare) due else x.declareBy;
      declareState = state;
      status = x.status;
      documents = docs;
      attestDocId = x.attestDocId;
      attestShared = x.attestSharedAt != null;
      note = x.note;
      archived = x.archivedAt != null;
      canEdit = Rights.may(ctx, p, #editSiteAdmin, x.workId);
      canSeeCosts = Rights.may(ctx, p, #readCosts, null);
      rev = x.rev;
    };
  };

  // De verzekeringen van één werf, of (workId = null) de jaarpolissen uit Beheer.
  public query ({ caller }) func listInsurances(workId : ?Nat, withArchived : Bool) : async [SV.InsuranceView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, workId);
    let xs = SiteAdmin.insurancesOf(siteAdmin, workId).filter(func(x : Types.Insurance) : Bool = withArchived or x.archivedAt == null);
    xs.sort(func(a, b) = Nat.compare(a.id, b.id)).map(func(x : Types.Insurance) : SV.InsuranceView = saInsView(p, x));
  };

  // ── Verzekering: bewaren ─────────────────────────────────────────────────
  func saInsErr(i : SV.InsuranceInput, old : ?Types.Insurance) : ?Text {
    let (oi, ob) = switch old { case (?o) (o.insurerOrgId, o.brokerOrgId); case null (null, null) };
    if (not saOrgOk(i.insurerOrgId, oi) or not saOrgOk(i.brokerOrgId, ob)) { return ?"Onbekende verzekeraar of makelaar" };
    if (i.policyRef.size() > Config.maxName) { return ?"Polisnummer te lang" };
    if (i.note.size() > Config.maxText) { return ?"Notitie te lang" };
    switch (i.kind) { case (#other t) { if (t.trim(#char ' ').size() == 0 or t.size() > Config.maxName) { return ?"Soort: 1 tot 80 tekens" } }; case _ {} };
    switch (i.periodFrom, i.periodTo) { case (?f, ?t) { if (t < f) { return ?"De periode eindigt vóór ze begint" } }; case _ {} };
    switch (i.status) {
      case (#notNeeded t) { if (t.trim(#char ' ').size() == 0 or t.size() > Config.maxText) { return ?"Geef een reden waarom het niet nodig is" } };
      case (#declared d) { if (d > saToday()) { return ?"Aangegeven op: de datum mag niet na vandaag liggen" } };
      case _ {};
    };
    null;
  };

  public shared ({ caller }) func saveInsurance(i : SV.InsuranceInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let oldRec : ?Types.Insurance = switch (i.id) { case (?id) siteAdmin.insurances.get(id); case null null };
    let wk = switch (i.id) {
      case (?_) { switch oldRec { case (?x) x.workId; case null return saDeny() } };
      case null i.workId;
    };
    if (not Rights.may(ctx, p, #editSiteAdmin, wk)) { return saDeny() };
    switch (saInsErr(i, oldRec)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (oldRec) {
      case null {
        if (siteAdmin.insurances.size() >= Config.maxInsurances) { return #err("Te veel verzekeringen") };
        if (SiteAdmin.insurancesOf(siteAdmin, i.workId).size() >= Config.maxInsurancesPerWork) { return #err("Te veel verzekeringen op deze werf") };
        let id = Ids.next(ctr, "insurance");
        let x : Types.Insurance = {
          id; workId = i.workId; kind = i.kind; insurerOrgId = i.insurerOrgId; brokerOrgId = i.brokerOrgId; policyRef = i.policyRef.trim(#char ' ');
          periodFrom = i.periodFrom; periodTo = i.periodTo; declareBy = null; status = i.status; documentIds = []; attestDocId = null; attestSharedAt = null; attestFileId = null;
          rev = 1; note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
        };
        siteAdmin.insurances.add(id, { x with declareBy = SiteAdmin.declareDay(works, plan, x) });
        Access.audit(audit, caller, ?p.id, i.workId, "verzekering-gemaakt", SiteAdmin.kindName(i.kind) # " #" # id.toText());
        #ok(id);
      };
      case (?old) {
        if (old.archivedAt != null) { return #err("Deze verzekering is gearchiveerd") };
        if (old.rev != i.rev) { return saStale() };
        let x : Types.Insurance = {
          old with kind = i.kind; insurerOrgId = i.insurerOrgId; brokerOrgId = i.brokerOrgId; policyRef = i.policyRef.trim(#char ' ');
          periodFrom = i.periodFrom; periodTo = i.periodTo; status = i.status; note = i.note; rev = old.rev + 1; updatedAt = now; updatedBy = p.id;
        };
        siteAdmin.insurances.add(old.id, { x with declareBy = SiteAdmin.declareDay(works, plan, x) });
        Access.audit(audit, caller, ?p.id, old.workId, "verzekering-gewijzigd", SiteAdmin.kindName(i.kind) # " #" # old.id.toText());
        #ok(old.id);
      };
    };
  };

  public shared ({ caller }) func archiveInsurance(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, x.workId)) { return saDeny() };
    if (x.archivedAt != null) { return #err("Al gearchiveerd") };
    siteAdmin.insurances.add(id, { x with archivedAt = ?Time.now(); rev = x.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, x.workId, "verzekering-gearchiveerd", "#" # id.toText());
    #ok;
  };

  // ── Verzekering: documenten en het attest voor de klant ──────────────────
  // Een opgeladen bestand (addFile, bij de werf, niet vertrouwelijk) aan de verzekering hangen als document van 1.1 (vragenlijst, polis,
  // bemiddelingsfiche, vervaldagbericht of het attest). Voor de jaarpolis (zonder werf): enkel de beheerder via het bestand zonder werf.
  public shared ({ caller }) func attachInsuranceFile(id : Nat, kindKey : Text, title : Text, fileId : Nat, asAttest : Bool) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, x.workId)) { return saDeny() };
    if (x.archivedAt != null) { return #err("Deze verzekering is gearchiveerd") };
    let w = switch (x.workId) { case (?w) w; case null return #err("Een document hoort bij een verzekering van een werf") };
    // Review M1: een vragenlijst, polis, bemiddelingsfiche of vervaldagbericht bevat werfwaarde of premie: document én bestand zijn vertrouwelijk
    // (lezen met #readCosts). Enkel het attest heeft een niet-vertrouwelijk bestand (de klant krijgt het als kantoor het deelt), maar ook zijn
    // document blijft in het dossier verborgen voor architect en OA. Review L2: enkel deze twee soorten.
    if (not asAttest and kindKey != "verzekering") { return #err("Kies de soort verzekering of verzekeringsattest") };
    if (not saFileConf(fileId, w, not asAttest)) { return #err(if asAttest "Het attest moet een niet-vertrouwelijk bestand van deze werf zijn" else "Laad het stuk vertrouwelijk op (het bevat werfwaarde of premie)") };
    if (not asAttest and not Rights.may({ works; settings }, p, #readCosts, null)) { return saDeny() };
    let kk = if (asAttest) "verzekering-attest" else "verzekering";
    let k = switch (Dossier.kind(settings, kk)) { case (?k) k; case null return #err("Onbekende documentsoort") };
    if (k.archived) { return #err("Deze documentsoort is gearchiveerd") };
    if (title.size() > Config.maxName) { return #err("Titel te lang") };
    if (x.documentIds.size() >= 20) { return #err("Te veel documenten bij deze verzekering") };
    if (Dossier.docsOf(dossier, w).size() >= Config.maxDocsPerWork) { return #err("Te veel documenten voor deze werf") };
    let now = Time.now();
    let did = Ids.next(ctr, "document");
    let name = switch (Access.cleanText(title, Config.maxName)) { case (?t) t; case null k.name };
    dossier.documents.add(did, {
      id = did; workId = w; kind = k.key; title = name; fileIds = [fileId]; status = #received; dueDay = null; validUntil = null; note = "";
      ownerOrgId = null; confidential = true; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
    });
    siteAdmin.insurances.add(id, { x with documentIds = x.documentIds.concat([did]); attestDocId = if (asAttest) ?did else x.attestDocId; attestSharedAt = if (asAttest) null else x.attestSharedAt; attestFileId = if (asAttest) null else x.attestFileId; rev = x.rev + 1; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?w, "verzekering-document", k.key # " #" # did.toText() # " bij verzekering #" # id.toText());
    #ok(did);
  };

  // Kantoor deelt het attest met de klant (Mijn werf) of trekt het terug.
  public shared ({ caller }) func shareInsuranceAttest(id : Nat, share : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, x.workId) or not Rights.isOffice(p)) { return saDeny() };
    if (x.archivedAt != null) { return #err("Deze verzekering is gearchiveerd") };
    if (share and x.attestDocId == null) { return #err("Laad eerst het attest op") };
    if (share and x.status == #toDeclare) { return #err("De verzekering is nog niet aangegeven") };
    // Review L3: bewaar het bestand dat gedeeld wordt; een latere versie van het document in het dossier blijft voor de klant verborgen.
    let fid : ?Nat = if (not share) null else switch (x.attestDocId) {
      case (?did) { switch (dossier.documents.get(did)) { case (?d) { if (d.fileIds.size() == 0) null else ?d.fileIds[d.fileIds.size() - 1] }; case null null } };
      case null null;
    };
    if (share and fid == null) { return #err("Laad eerst het attest op") };
    siteAdmin.insurances.add(id, { x with attestSharedAt = if (share) ?Time.now() else null; attestFileId = fid; rev = x.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, x.workId, if (share) "verzekering-attest-gedeeld" else "verzekering-attest-ingetrokken", "#" # id.toText());
    #ok;
  };

  // ── Werfwaarde en premie (vertrouwelijk, R45): enkel admin en calculator, enkel via update-calls met auditregel ─
  func saConfView(x : Types.Insurance, c : ?Types.InsuranceConf) : SV.InsuranceConfView {
    let (dr, dm) = switch (SiteAdmin.rateSlot(x.kind)) { case (?s) SiteAdmin.rateOf(settings, s); case null (0, 0) };
    switch c {
      case (?v) { { insuranceId = x.id; workValueCents = v.workValueCents; rateMilli = v.rateMilli; minPremiumCents = v.minPremiumCents; premiumNetCents = v.premiumNetCents; taxesCents = v.taxesCents; paid = v.paid; defaultRateMilli = dr; defaultMinCents = dm; rev = v.rev } };
      case null { { insuranceId = x.id; workValueCents = null; rateMilli = null; minPremiumCents = null; premiumNetCents = null; taxesCents = null; paid = false; defaultRateMilli = dr; defaultMinCents = dm; rev = 0 } };
    };
  };

  func saConfOf(id : Nat) : ?Types.InsuranceConf { switch (siteAdmin.insuranceConf.get(id)) { case (?c) SiteAdmin.plain(c); case null null } };

  public shared ({ caller }) func readInsuranceConf(id : Nat) : async Result.Result<SV.InsuranceConfView, Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #readCosts, null) or not Rights.may(ctx, p, #readSiteAdmin, x.workId)) { return saDeny() };
    Access.audit(audit, caller, ?p.id, x.workId, "bekeek:verzekering", "#" # id.toText());
    #ok(saConfView(x, saConfOf(id)));
  };

  // Bewaren: de premie komt uit werfwaarde × tarief (‰) met minimum; tarief en minimum leeg = die van de instellingen voor deze soort.
  public shared ({ caller }) func saveInsuranceConf(id : Nat, i : SV.InsuranceConfInput) : async Result.Result<SV.InsuranceConfView, Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #readCosts, null) or not Rights.may(ctx, p, #editSiteAdmin, x.workId)) { return saDeny() };
    if (x.archivedAt != null) { return #err("Deze verzekering is gearchiveerd") };
    let big : Int = 100_000_000_000;
    for (v in [i.workValueCents, i.minPremiumCents, i.taxesCents].values()) { switch v { case (?n) { if (n < 0 or n > big) { return #err("Bedrag: tussen € 0 en € 1.000.000.000") } }; case null {} } };
    switch (i.rateMilli) { case (?r) { if (r > 100_000) { return #err("Tarief: hoogstens 100 ‰") } }; case null {} };
    let (dr, dm) = switch (SiteAdmin.rateSlot(x.kind)) { case (?s) SiteAdmin.rateOf(settings, s); case null (0, 0) };
    let rate = switch (i.rateMilli) { case (?r) r; case null dr };
    let min = switch (i.minPremiumCents) { case (?m) m; case null dm };
    let prem = switch (i.workValueCents) { case (?v) SiteAdmin.premium(v, rate, min); case null null };
    let before = switch (saConfOf(id)) { case (?c) c.rev; case null 0 };
    if (before != i.rev) { return saStale() };
    let c : Types.InsuranceConf = { insuranceId = id; workValueCents = i.workValueCents; rateMilli = i.rateMilli; minPremiumCents = i.minPremiumCents; premiumNetCents = prem; taxesCents = i.taxesCents; paid = i.paid; rev = before + 1; extra = [] };
    siteAdmin.insuranceConf.add(id, #plain(c));
    siteAdmin.insurances.add(id, { x with rev = x.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, x.workId, "verzekering-premie", "#" # id.toText());
    #ok(saConfView(x, ?c));
  };

  // ── Actie- en restpunten (taken) ─────────────────────────────────────────
  // Werkt de firma op deze werf mee (als firma of via een persoon)? Anders ziet ze het punt niet in Mijn week.
  func saInTeam(orgId : Nat, workId : Nat) : Bool {
    works.memberships.values().any(
      func m {
        m.workId == workId and m.endedAt == null and m.role == #onderaannemer and (
          m.orgId == ?orgId or (switch (m.personId) { case (?x) { switch (access.persons.get(x)) { case (?q) q.orgId == ?orgId; case null false } }; case null false })
        );
      }
    );
  };

  func saPoints(workId : Nat, ids : [Nat]) : [SV.PointView] {
    ids.filterMap(func(id : Nat) : ?SV.PointView {
      switch (plan.tasks.get(id)) {
        case (?t) {
          if (t.archivedAt != null) null else {
            ?{ taskId = t.id; title = t.title; orgId = t.responsibleOrgId; orgName = saOrgName(t.responsibleOrgId); day = t.start; done = t.status == #done; inTeam = switch (t.responsibleOrgId) { case (?o) saInTeam(o, workId); case null true } };
          };
        };
        case null null;
      };
    });
  };

  func saPointsErr(workId : Nat, pts : [SV.PointInput]) : ?Text {
    if (pts.size() > Config.maxPointsPerCall) { return ?"Hoogstens 20 punten tegelijk" };
    if (Plan.tasksOf(plan, workId).size() + pts.size() > Config.maxTasksPerWork) { return ?"Te veel taken op deze werf" };
    for (x in pts.values()) {
      if (Access.cleanText(x.title, Config.maxName) == null) { return ?"Punt: 1 tot 80 tekens" };
      if (not saOrgOk(x.orgId, null)) { return ?"Onbekende firma" };
    };
    null;
  };

  // De taken maken; geeft de ids en de waarschuwingen (firma werkt nog niet mee).
  func saMakePoints(p : Types.Person, workId : Nat, key : Text, pts : [SV.PointInput]) : ([Nat], [Text]) {
    let ids = List.empty<Nat>();
    let warn = List.empty<Text>();
    for (x in pts.values()) {
      let title = switch (Access.cleanText(x.title, Config.maxName)) { case (?t) t; case null "" };
      ids.add(SiteAdmin.newTask(saCtx(), p, workId, key, title, x.orgId, x.day));
      switch (x.orgId) {
        case (?o) {
          let msg = saOrgName(?o) # " werkt nog niet mee op deze werf: voeg ze toe bij Wie werkt mee, anders ziet ze «" # title # "» niet in Mijn week.";
          if (not saInTeam(o, workId) and not warn.contains(Text.equal, msg)) { warn.add(msg) };
        };
        case null {};
      };
    };
    (ids.toArray(), warn.toArray());
  };

  func saAttErr(att : [Text]) : ?Text {
    if (att.size() > Config.maxAttendees) { return ?"Te veel aanwezigen" };
    for (a in att.values()) { if (a.size() > Config.maxName) { return ?"Een naam is te lang" } };
    null;
  };

  func saClean(att : [Text]) : [Text] { att.filterMap(func(a : Text) : ?Text = Access.cleanText(a, Config.maxName)) };

  // ── Werfvergadering ──────────────────────────────────────────────────────
  // Review M5: een vergadering bewaren (met actiepunten = planningstaken) vraagt #editWork: de beheerder of de werfleider van die werf, niet de calculator.
  func saMeetingView(m : Types.SiteMeeting) : SV.MeetingView {
    { id = m.id; workId = m.workId; number = m.number; day = m.day; attendees = m.attendees; fileId = m.fileId; fileName = saFileName(m.fileId); points = saPoints(m.workId, m.taskIds); note = m.note; archived = m.archivedAt != null; rev = m.rev };
  };

  public query ({ caller }) func listMeetings(workId : Nat) : async [SV.MeetingView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, ?workId);
    SiteAdmin.meetingsOf(siteAdmin, workId).filter(func(m : Types.SiteMeeting) : Bool = m.archivedAt == null).sort(func(a, b) = Nat.compare(b.number, a.number)).map(saMeetingView);
  };

  // Review L9: een opId (in extra "op") maakt het aanmaken idempotent: een tweede klik of een herhaalde oproep maakt geen tweede vergadering.
  public shared ({ caller }) func saveMeeting(workId : Nat, i : SV.MeetingInput) : async Result.Result<SV.SaveResult, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editWork, ?workId)) { return saDeny() };
    switch (saAttErr(i.attendees)) { case (?e) return #err(e); case null {} };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (i.opId.size() > 64) { return #err("opId te lang") };
    if (not saFileOk(i.fileId, ?workId)) { return #err("Dit bestand hoort niet bij deze werf of is vertrouwelijk") };
    switch (saPointsErr(workId, i.addPoints)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (i.id) {
      case null {
        let same = SiteAdmin.meetingsOf(siteAdmin, workId).find(func(m : Types.SiteMeeting) : Bool = i.opId != "" and m.extra.any(func((k, v) : (Text, Text)) : Bool = k == "op" and v == i.opId));
        switch same { case (?m) return #ok({ id = m.id; warnings = [] }); case null {} };
        if (SiteAdmin.meetingsOf(siteAdmin, workId).size() >= Config.maxMeetingsPerWork) { return #err("Te veel werfvergaderingen op deze werf") };
        let seq = "vergadering:" # workId.toText();
        let n = (switch (settings.sequences.get(seq)) { case (?x) x; case null 0 }) + 1;
        settings.sequences.add(seq, n);
        let id = Ids.next(ctr, "meeting");
        let (ids, warn) = saMakePoints(p, workId, "actiepunt", i.addPoints);
        siteAdmin.meetings.add(id, { id; workId; number = n; day = i.day; attendees = saClean(i.attendees); fileId = i.fileId; taskIds = ids; note = i.note; rev = 1; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = if (i.opId == "") [] else [("op", i.opId)] });
        Access.audit(audit, caller, ?p.id, ?workId, "werfvergadering-gemaakt", "nr. " # n.toText() # ", " # ids.size().toText() # " actiepunten");
        #ok({ id; warnings = warn });
      };
      case (?id) {
        let m = switch (siteAdmin.meetings.get(id)) { case (?x) x; case null return saDeny() };
        if (m.workId != workId or m.archivedAt != null) { return saDeny() };
        if (m.rev != i.rev) { return saStale() };
        let (ids, warn) = saMakePoints(p, workId, "actiepunt", i.addPoints);
        siteAdmin.meetings.add(id, { m with day = i.day; attendees = saClean(i.attendees); fileId = i.fileId; taskIds = m.taskIds.concat(ids); note = i.note; rev = m.rev + 1; updatedAt = now; updatedBy = p.id });
        Access.audit(audit, caller, ?p.id, ?workId, "werfvergadering-gewijzigd", "nr. " # m.number.toText() # (if (ids.size() > 0) ", " # ids.size().toText() # " actiepunten erbij" else ""));
        #ok({ id; warnings = warn });
      };
    };
  };

  public shared ({ caller }) func archiveMeeting(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let m = switch (siteAdmin.meetings.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editWork, ?m.workId)) { return saDeny() };
    if (m.archivedAt != null) { return #err("Al gearchiveerd") };
    siteAdmin.meetings.add(id, { m with archivedAt = ?Time.now(); rev = m.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?m.workId, "werfvergadering-gearchiveerd", "nr. " # m.number.toText());
    #ok;
  };

  // ── Oplevering ───────────────────────────────────────────────────────────
  // Review L5: de status volgt de open restpunten (afgerond met openstaande restpunten = met opmerkingen, anders afgerond).
  func saHandoverStatus(h : Types.Handover) : Types.HandoverStatus {
    if (h.finishedAt == null) #planned else if (SiteAdmin.openTasks(plan, h.taskIds) > 0) #withRemarks else #done;
  };

  func saHandoverView(h : Types.Handover) : SV.HandoverView {
    {
      id = h.id; workId = h.workId; kind = h.kind; day = h.day; status = saHandoverStatus(h); attendees = h.attendees;
      pvFileId = h.pvFileId; pvFileName = saFileName(h.pvFileId); signedFileId = h.signedFileId; signedFileName = saFileName(h.signedFileId);
      docFileId = h.docFileId; controlCode = h.controlCode; finishedAt = h.finishedAt; isShared = h.sharedAt != null;
      points = saPoints(h.workId, h.taskIds); openPoints = SiteAdmin.openTasks(plan, h.taskIds); note = h.note; docNote = h.docNote; archived = h.archivedAt != null; rev = h.rev;
    };
  };

  public query ({ caller }) func listHandovers(workId : Nat) : async [SV.HandoverView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, ?workId);
    SiteAdmin.handoversOf(siteAdmin, workId).filter(func(h : Types.Handover) : Bool = h.archivedAt == null).sort(func(a, b) = Nat.compare(a.id, b.id)).map(saHandoverView);
  };

  public shared ({ caller }) func saveHandover(workId : Nat, i : SV.HandoverInput) : async Result.Result<SV.SaveResult, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editWork, ?workId)) { return saDeny() };
    switch (saAttErr(i.attendees)) { case (?e) return #err(e); case null {} };
    if (i.note.size() > Config.maxText or i.docNote.size() > Config.maxText) { return #err("Notitie te lang") };
    if (i.opId.size() > 64) { return #err("opId te lang") };
    if (not saFileOk(i.pvFileId, ?workId) or not saFileOk(i.signedFileId, ?workId)) { return #err("Dit bestand hoort niet bij deze werf of is vertrouwelijk") };
    switch (saPointsErr(workId, i.addPoints)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (i.id) {
      case null {
        let same = SiteAdmin.handoversOf(siteAdmin, workId).find(func(h : Types.Handover) : Bool = i.opId != "" and h.extra.any(func((k, v) : (Text, Text)) : Bool = k == "op" and v == i.opId));
        switch same { case (?h) return #ok({ id = h.id; warnings = [] }); case null {} };
        if (SiteAdmin.handoversOf(siteAdmin, workId).any(func(h : Types.Handover) : Bool = h.archivedAt == null and h.kind == i.kind)) { return #err("Er is al een oplevering van dit soort voor deze werf") };
        let id = Ids.next(ctr, "handover");
        let (ids, warn) = saMakePoints(p, workId, "restpunt", i.addPoints);
        siteAdmin.handovers.add(id, {
          id; workId; kind = i.kind; day = i.day; status = #planned; attendees = saClean(i.attendees); pvFileId = i.pvFileId; taskIds = ids; signedFileId = i.signedFileId; docNote = i.docNote; rev = 1;
          docFileId = null; controlCode = null; finishedAt = null; sharedAt = null; note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = if (i.opId == "") [] else [("op", i.opId)];
        });
        Access.audit(audit, caller, ?p.id, ?workId, "oplevering-gemaakt", saKind(i.kind) # ", " # ids.size().toText() # " restpunten");
        #ok({ id; warnings = warn });
      };
      case (?id) {
        let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
        if (h.workId != workId or h.archivedAt != null) { return saDeny() };
        if (h.rev != i.rev) { return saStale() };
        let (ids, warn) = saMakePoints(p, workId, "restpunt", i.addPoints);
        // Afgerond: het document ligt vast (soort, datum, aanwezigen, PV en de opmerking op het document blijven); het getekende stuk, de interne notitie en nieuwe restpunten mogen nog.
        let done = h.finishedAt != null;
        siteAdmin.handovers.add(id, {
          h with day = if (done) h.day else i.day; attendees = if (done) h.attendees else saClean(i.attendees); pvFileId = if (done) h.pvFileId else i.pvFileId; docNote = if (done) h.docNote else i.docNote;
          signedFileId = i.signedFileId; taskIds = h.taskIds.concat(ids); note = i.note; rev = h.rev + 1; updatedAt = now; updatedBy = p.id;
        });
        Access.audit(audit, caller, ?p.id, ?workId, "oplevering-gewijzigd", saKind(h.kind) # (if (ids.size() > 0) ", " # ids.size().toText() # " restpunten erbij" else ""));
        #ok({ id; warnings = warn });
      };
    };
  };

  func saKind(k : Types.HandoverKind) : Text { switch k { case (#provisional) "voorlopig"; case (#final) "definitief" } };

  func saHex(t : Text) : Bool { t.size() == 64 and t.chars().all(func c = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f')) };

  // Review L12: bij een restpunt het vakgebied van de firma ("onderaannemer schrijnwerk"), nooit de firmanaam, op het document.
  func saWho(orgId : ?Nat) : Text {
    switch orgId {
      case (?o) {
        switch (org.orgs.get(o)) {
          case (?f) {
            let names = Oa.trades(settings, true);
            switch (f.trades.find(func(k : Text) : Bool = names.any(func(t) = t.key == k))) {
              case (?k) { switch (names.find(func(t) = t.key == k)) { case (?t) "onderaannemer " # Text.toLower(t.name); case null "onderaannemer" } };
              case null "onderaannemer";
            };
          };
          case null "onderaannemer";
        };
      };
      case null "BOWACO";
    };
  };

  func saDocPoints(h : Types.Handover) : [SV.DocPoint] {
    h.taskIds.filterMap(func(id : Nat) : ?SV.DocPoint {
      switch (plan.tasks.get(id)) {
        case (?t) { if (t.archivedAt != null) null else ?{ title = t.title; who = saWho(t.responsibleOrgId); day = t.start; done = t.status == #done } };
        case null null;
      };
    });
  };

  // De gegevens van het opleveringsdocument, ook de vaste tekst en (via controlCode) de hash: de backend rekent ze zelf (review L4).
  func saDocData(h : Types.Handover) : ?SV.HandoverDocData {
    let w = switch (works.works.get(h.workId)) { case (?x) x; case null return null };
    let a = w.address;
    let address = a.street # " " # a.number # ", " # a.zip # " " # a.city;
    let pts = saDocPoints(h);
    let text = SiteAdmin.handoverText(h.kind, w.code, w.name, address, saOrgName(w.clientOrgId), saOrgName(w.architectOrgId), h.day, h.attendees, pts.map(func(x : SV.DocPoint) : ((Text, Text, Nat, Bool)) = (x.title, x.who, x.day, x.done)), h.docNote);
    ?{ handoverId = h.id; kind = h.kind; workCode = w.code; workName = w.name; address; clientName = saOrgName(w.clientOrgId); architectName = saOrgName(w.architectOrgId); day = h.day; attendees = h.attendees; points = pts; docNote = h.docNote; previousControlCode = h.controlCode; controlText = text };
  };

  // Afronden: het opleveringsdocument (PDF, in de browser gemaakt en opgeladen) ligt vast onder zijn controlecode (sha-256 van de vaste tekst);
  // de backend rekent die tekst en hash zelf uit de gegevens en weigert een andere code (review L4).
  public shared ({ caller }) func finishHandover(id : Nat, docFileId : Nat, controlCode : Text) : async Result.Result<SV.HandoverView, Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editWork, ?h.workId)) { return saDeny() };
    if (h.archivedAt != null) { return saDeny() };
    if (h.finishedAt != null) { return #err("Deze oplevering is al afgerond") };
    if (h.day == null) { return #err("Geef eerst de datum van de oplevering") };
    if (not saHex(controlCode)) { return #err("De controlecode klopt niet") };
    let d = switch (saDocData(h)) { case (?x) x; case null return saDeny() };
    if (SiteAdmin.controlCode(d.controlText) != controlCode) { return #err("De controlecode klopt niet met de gegevens van de oplevering: vernieuw en maak het document opnieuw") };
    switch (files.files.get(docFileId)) {
      case (?f) { if (f.archivedAt != null or f.workId != ?h.workId or f.confidential or f.mime != "application/pdf") { return #err("Het opleveringsdocument moet een PDF van deze werf zijn") } };
      case null return #err("Onbekend bestand");
    };
    let now = Time.now();
    let n = { h with docFileId = ?docFileId; controlCode = ?controlCode; finishedAt = ?now; rev = h.rev + 1; updatedAt = now; updatedBy = p.id };
    siteAdmin.handovers.add(id, { n with status = saHandoverStatus(n) });
    Access.audit(audit, caller, ?p.id, ?h.workId, "oplevering-afgerond", saKind(h.kind) # " onder controlecode " # controlCode);
    #ok(saHandoverView(n));
  };

  // Kantoor deelt het opleveringsdocument met de klant (Mijn werf) of trekt het terug.
  public shared ({ caller }) func shareHandover(id : Nat, share : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?h.workId) or not Rights.isOffice(p)) { return saDeny() };
    if (h.archivedAt != null) { return saDeny() };
    if (share and h.finishedAt == null) { return #err("Rond de oplevering eerst af") };
    siteAdmin.handovers.add(id, { h with sharedAt = if (share) ?Time.now() else null; rev = h.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?h.workId, if (share) "oplevering-gedeeld" else "oplevering-ingetrokken", saKind(h.kind));
    #ok;
  };

  public shared ({ caller }) func archiveHandover(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editWork, ?h.workId)) { return saDeny() };
    if (h.archivedAt != null) { return #err("Al gearchiveerd") };
    if (h.finishedAt != null) { return #err("Een afgeronde oplevering blijft bewaard") };
    siteAdmin.handovers.add(id, { h with archivedAt = ?Time.now(); rev = h.rev + 1; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?h.workId, "oplevering-gearchiveerd", saKind(h.kind));
    #ok;
  };

  // De gegevens voor het opleveringsdocument (PDF in de browser): werf, bouwheer, architect, aanwezigen, restpunten met het vakgebied van de
  // firma, de opmerking op het document. Nooit de interne notitie, een firmanaam of een bedrag.
  public query ({ caller }) func handoverDoc(id : Nat) : async Result.Result<SV.HandoverDocData, Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #readSiteAdmin, ?h.workId) or h.archivedAt != null) { return saDeny() };
    switch (saDocData(h)) { case (?d) #ok(d); case null saDeny() };
  };

  // ── Technische fiches (bibliotheek in Beheer, per werf aan te vinken voor het PID) ──
  func saSheetView(x : Types.TechSheet) : SV.TechSheetView {
    { id = x.id; materialKey = x.materialKey; title = x.title; fileId = x.fileId; fileName = saFileName(?x.fileId); supplierOrgId = x.supplierOrgId; supplierName = saOrgName(x.supplierOrgId); archived = x.archivedAt != null };
  };

  public query ({ caller }) func listTechSheets(withArchived : Bool) : async [SV.TechSheetView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, null);
    let xs = siteAdmin.techSheets.values().filter(func(x : Types.TechSheet) : Bool = withArchived or x.archivedAt == null).toArray();
    xs.sort(func(a, b) = if (a.materialKey != b.materialKey) Text.compare(a.materialKey, b.materialKey) else Nat.compare(a.id, b.id)).map(saSheetView);
  };

  public shared ({ caller }) func saveTechSheet(i : SV.TechSheetInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editSiteAdmin, null);
    let mk = Access.cleanText(i.materialKey, Config.maxName) ?? return #err("Materiaalsoort: 1 tot 80 tekens");
    let title = Access.cleanText(i.title, Config.maxName) ?? return #err("Titel: 1 tot 80 tekens");
    if (not saOrgOk(i.supplierOrgId, null)) { return #err("Onbekende leverancier") };
    // De fiche is een bestand zonder werf (bibliotheek), niet vertrouwelijk, PDF of afbeelding.
    switch (files.files.get(i.fileId)) {
      case (?f) { if (f.archivedAt != null or f.confidential or f.workId != null) { return #err("Laad de fiche op zonder werf en niet vertrouwelijk") } };
      case null return #err("Onbekend bestand");
    };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (siteAdmin.techSheets.size() >= Config.maxTechSheets) { return #err("Te veel technische fiches") };
        let id = Ids.next(ctr, "techSheet");
        siteAdmin.techSheets.add(id, { id; materialKey = mk; title; fileId = i.fileId; supplierOrgId = i.supplierOrgId; createdAt = now; createdBy = p.id; archivedAt = null; extra = [] });
        Access.audit(audit, caller, ?p.id, null, "fiche-gemaakt", mk # ": " # title);
        #ok(id);
      };
      case (?id) {
        let x = switch (siteAdmin.techSheets.get(id)) { case (?y) y; case null return saDeny() };
        if (x.archivedAt != null) { return #err("Deze fiche is gearchiveerd") };
        siteAdmin.techSheets.add(id, { x with materialKey = mk; title; fileId = i.fileId; supplierOrgId = i.supplierOrgId });
        Access.audit(audit, caller, ?p.id, null, "fiche-gewijzigd", mk # ": " # title);
        #ok(id);
      };
    };
  };

  public shared ({ caller }) func archiveTechSheet(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editSiteAdmin, null);
    let x = switch (siteAdmin.techSheets.get(id)) { case (?y) y; case null return saDeny() };
    if (x.archivedAt != null) { return #err("Al gearchiveerd") };
    siteAdmin.techSheets.add(id, { x with archivedAt = ?Time.now() });
    Access.audit(audit, caller, ?p.id, null, "fiche-gearchiveerd", x.title);
    #ok;
  };

  // Welke fiches horen bij het PID van deze werf?
  public query ({ caller }) func workTechSheets(workId : Nat) : async [Nat] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, ?workId);
    switch (siteAdmin.workSheets.get(workId)) { case (?ids) ids; case null [] };
  };

  public shared ({ caller }) func setWorkTechSheets(workId : Nat, ids : [Nat]) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?workId)) { return saDeny() };
    if (ids.size() > Config.maxTechSheets) { return #err("Te veel fiches") };
    let clean = List.empty<Nat>();
    for (id in ids.values()) {
      switch (siteAdmin.techSheets.get(id)) {
        case (?x) { if (x.archivedAt != null) { return #err("Een gearchiveerde fiche kan niet gekozen worden") }; if (not clean.contains(Nat.equal, id)) { clean.add(id) } };
        case null return #err("Onbekende fiche");
      };
    };
    siteAdmin.workSheets.add(workId, clean.toArray());
    Access.audit(audit, caller, ?p.id, ?workId, "fiches-pid", clean.size().toText() # " fiches gekozen voor het PID");
    #ok;
  };

  // Het PID-document maakt de browser (voorblad + de gekozen fiches, pdf-lib). Dit zet enkel een auditregel: wie, welke werf, hoeveel
  // fiches erin zitten en hoeveel overgeslagen werden. Wie de fiches voor het PID mag kiezen (#editSiteAdmin op die werf: kantoor en de
  // werfleider van de werf) mag het document maken. Geen bedrag, geen bestand.
  public shared ({ caller }) func recordPid(workId : Nat, included : Nat, skipped : Nat, pages : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?workId)) { return saDeny() };
    if (included > Config.maxTechSheets or skipped > Config.maxTechSheets or pages > 100_000) { return #err("Ongeldige tellingen") };
    Access.audit(audit, caller, ?p.id, ?workId, "pid-gemaakt", included.toText() # " fiches in " # pages.toText() # " bladzijden" # (if (skipped > 0) ", " # skipped.toText() # " overgeslagen" else ""));
    #ok;
  };

  // ── De klant (Mijn werf): enkel wat kantoor deelde; de architect: het afgeronde opleveringsdocument ──
  // Review M2: de klant moet van de firma zijn die op de werf als klant staat (zoals QuoteClientApi). Review L12: de architect (lid van de
  // werf) opent het afgeronde opleveringsdocument, zonder bedragen; hij ziet geen attest.
  public query ({ caller }) func clientSiteAdmin(workId : Nat) : async SV.ClientSiteView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let asArchitect = Rights.may(ctx, p, #readHandoverDoc, ?workId);
    if (not asArchitect) {
      Rights.require(ctx, p, #clientQuote, ?workId);
      switch (works.works.get(workId)) {
        case (?w) { if (w.clientOrgId != null and w.clientOrgId != p.orgId) { Runtime.trap("Geen toegang") } };
        case null { Runtime.trap("Geen toegang") };
      };
    };
    let attests = List.empty<SV.ClientAttest>();
    if (not asArchitect) {
      for (x in SiteAdmin.insurancesOf(siteAdmin, ?workId).values()) {
        switch (x.attestSharedAt, x.attestFileId) {
          case (?at, ?fid) {
            if (x.archivedAt == null) {
              switch (files.files.get(fid)) {
                case (?f) { if (f.archivedAt == null and not f.confidential) { attests.add({ kindName = SiteAdmin.kindName(x.kind); periodFrom = x.periodFrom; periodTo = x.periodTo; sharedAt = at; file = Dossier.fileView(f) }) } };
                case null {};
              };
            };
          };
          case _ {};
        };
      };
    };
    let hs = List.empty<SV.ClientHandover>();
    for (h in SiteAdmin.handoversOf(siteAdmin, workId).values()) {
      switch (h.docFileId, h.controlCode) {
        case (?fid, ?code) {
          if (h.archivedAt == null and (asArchitect or h.sharedAt != null)) {
            switch (files.files.get(fid)) {
              case (?f) { if (f.archivedAt == null and not f.confidential) { hs.add({ kind = h.kind; day = h.day; status = saHandoverStatus(h); controlCode = code; file = Dossier.fileView(f) }) } };
              case null {};
            };
          };
        };
        case _ {};
      };
    };
    { workId; attests = attests.toArray(); handovers = hs.toArray() };
  };

  // ── De uurlijkse ronde, ook met de hand (tests): meldingen voor de aangifte van een verzekering ──
  public shared ({ caller }) func scanSiteAdmin() : async Nat {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    SiteAdmin.scan(saCtx(), siteAdmin, saToday());
  };

  // ── Gegevens voor de verzekering (PDF voor de makelaar, ontwerp §6): werf, adres, werfwaarde, periode, soort, polis, verzekeraar en makelaar ──
  // Enkel kantoor (#readCosts), update-call met auditregel; zonder OA-prijzen, zonder aankoopgegevens.
  public shared ({ caller }) func insuranceSheet(id : Nat) : async Result.Result<SV.InsuranceSheetData, Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #readCosts, null) or not Rights.may(ctx, p, #readSiteAdmin, x.workId)) { return saDeny() };
    let w = switch (x.workId) { case (?wid) { switch (works.works.get(wid)) { case (?y) y; case null return saDeny() } }; case null return #err("Een verzekering zonder werf heeft geen gegevens voor de makelaar") };
    let a = w.address;
    Access.audit(audit, caller, ?p.id, x.workId, "bekeek:verzekering-gegevens", "#" # id.toText());
    #ok({
      insuranceId = id; kindName = SiteAdmin.kindName(x.kind); policyRef = x.policyRef; insurerName = saOrgName(x.insurerOrgId); brokerName = saOrgName(x.brokerOrgId);
      periodFrom = x.periodFrom; periodTo = x.periodTo; workCode = w.code; workName = w.name; address = a.street # " " # a.number # ", " # a.zip # " " # a.city;
      clientName = saOrgName(w.clientOrgId); architectName = saOrgName(w.architectOrgId); startDay = SiteAdmin.startOf(works, plan, w.id); endDay = w.plannedEnd;
      workValueCents = switch (saConfOf(id)) { case (?c) c.workValueCents; case null null }; vatBp = w.vatBp;
    });
  };
}
