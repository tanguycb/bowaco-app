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
  func saOrgOk(id : ?Nat) : Bool { switch id { case (?x) { switch (org.orgs.get(x)) { case (?o) o.archivedAt == null; case null false } }; case null true } };
  func saToday() : Nat { Post.local(Time.now()).day };
  func saDeny<T>() : Result.Result<T, Text> { #err("Geen toegang") };

  // Een bestand van deze werf (nog niet gearchiveerd), zoals de documenten het eisen.
  func saFileOk(id : ?Nat, workId : ?Nat) : Bool {
    switch id {
      case (?x) { switch (files.files.get(x)) { case (?f) f.archivedAt == null and f.workId == workId and not f.confidential; case null false } };
      case null true;
    };
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
    let docs = x.documentIds.filterMap(func(id : Nat) : ?SV.InsuranceDocView {
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
  func saInsErr(i : SV.InsuranceInput) : ?Text {
    if (not saOrgOk(i.insurerOrgId) or not saOrgOk(i.brokerOrgId)) { return ?"Onbekende verzekeraar of makelaar" };
    if (i.policyRef.size() > Config.maxName) { return ?"Polisnummer te lang" };
    if (i.note.size() > Config.maxText) { return ?"Notitie te lang" };
    switch (i.kind) { case (#other t) { if (t.trim(#char ' ').size() == 0 or t.size() > Config.maxName) { return ?"Soort: 1 tot 80 tekens" } }; case _ {} };
    switch (i.periodFrom, i.periodTo) { case (?f, ?t) { if (t < f) { return ?"De periode eindigt vóór ze begint" } }; case _ {} };
    switch (i.status) {
      case (#notNeeded t) { if (t.trim(#char ' ').size() == 0 or t.size() > Config.maxText) { return ?"Geef een reden waarom het niet nodig is" } };
      case (#declared d) { if (d > saToday() + 400) { return ?"Aangegeven op: een datum in de toekomst" } };
      case _ {};
    };
    null;
  };

  public shared ({ caller }) func saveInsurance(i : SV.InsuranceInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let wk = switch (i.id) {
      case (?id) { switch (siteAdmin.insurances.get(id)) { case (?x) x.workId; case null return saDeny() } };
      case null i.workId;
    };
    if (not Rights.may(ctx, p, #editSiteAdmin, wk)) { return saDeny() };
    switch (saInsErr(i)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (siteAdmin.insurances.size() >= Config.maxInsurances) { return #err("Te veel verzekeringen") };
        let id = Ids.next(ctr, "insurance");
        let x : Types.Insurance = {
          id; workId = i.workId; kind = i.kind; insurerOrgId = i.insurerOrgId; brokerOrgId = i.brokerOrgId; policyRef = i.policyRef.trim(#char ' ');
          periodFrom = i.periodFrom; periodTo = i.periodTo; declareBy = null; status = i.status; documentIds = []; attestDocId = null; attestSharedAt = null;
          note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
        };
        siteAdmin.insurances.add(id, { x with declareBy = SiteAdmin.declareDay(works, plan, x) });
        Access.audit(audit, caller, ?p.id, i.workId, "verzekering-gemaakt", SiteAdmin.kindName(i.kind) # " #" # id.toText());
        #ok(id);
      };
      case (?id) {
        let old = switch (siteAdmin.insurances.get(id)) { case (?x) x; case null return saDeny() };
        if (old.archivedAt != null) { return #err("Deze verzekering is gearchiveerd") };
        let x : Types.Insurance = {
          old with kind = i.kind; insurerOrgId = i.insurerOrgId; brokerOrgId = i.brokerOrgId; policyRef = i.policyRef.trim(#char ' ');
          periodFrom = i.periodFrom; periodTo = i.periodTo; status = i.status; note = i.note; updatedAt = now; updatedBy = p.id;
        };
        siteAdmin.insurances.add(id, { x with declareBy = SiteAdmin.declareDay(works, plan, x) });
        Access.audit(audit, caller, ?p.id, old.workId, "verzekering-gewijzigd", SiteAdmin.kindName(i.kind) # " #" # id.toText());
        #ok(id);
      };
    };
  };

  public shared ({ caller }) func archiveInsurance(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = switch (siteAdmin.insurances.get(id)) { case (?y) y; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, x.workId)) { return saDeny() };
    if (x.archivedAt != null) { return #err("Al gearchiveerd") };
    siteAdmin.insurances.add(id, { x with archivedAt = ?Time.now(); updatedAt = Time.now(); updatedBy = p.id });
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
    if (not saFileOk(?fileId, ?w)) { return #err("Dit bestand hoort niet bij deze werf of is vertrouwelijk") };
    let kk = if (asAttest) "verzekering-attest" else kindKey;
    let k = switch (Dossier.kind(settings, kk)) { case (?k) k; case null return #err("Onbekende documentsoort") };
    if (k.archived or k.confidential) { return #err("Deze documentsoort kan hier niet gebruikt worden") };
    if (title.size() > Config.maxName) { return #err("Titel te lang") };
    if (x.documentIds.size() >= 20) { return #err("Te veel documenten bij deze verzekering") };
    let now = Time.now();
    let did = Ids.next(ctr, "document");
    let name = switch (Access.cleanText(title, Config.maxName)) { case (?t) t; case null k.name };
    dossier.documents.add(did, {
      id = did; workId = w; kind = k.key; title = name; fileIds = [fileId]; status = #received; dueDay = null; validUntil = null; note = "";
      ownerOrgId = null; confidential = false; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
    });
    siteAdmin.insurances.add(id, { x with documentIds = x.documentIds.concat([did]); attestDocId = if (asAttest) ?did else x.attestDocId; attestSharedAt = if (asAttest) null else x.attestSharedAt; updatedAt = now; updatedBy = p.id });
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
    siteAdmin.insurances.add(id, { x with attestSharedAt = if (share) ?Time.now() else null; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, x.workId, if (share) "verzekering-attest-gedeeld" else "verzekering-attest-ingetrokken", "#" # id.toText());
    #ok;
  };

  // ── Werfwaarde en premie (vertrouwelijk, R45): enkel admin en calculator, enkel via update-calls met auditregel ─
  func saConfView(x : Types.Insurance, c : ?Types.InsuranceConf) : SV.InsuranceConfView {
    let (dr, dm) = switch (SiteAdmin.rateSlot(x.kind)) { case (?s) SiteAdmin.rateOf(settings, s); case null (0, 0) };
    switch c {
      case (?v) { { insuranceId = x.id; workValueCents = v.workValueCents; rateMilli = v.rateMilli; minPremiumCents = v.minPremiumCents; premiumNetCents = v.premiumNetCents; taxesCents = v.taxesCents; paid = v.paid; defaultRateMilli = dr; defaultMinCents = dm } };
      case null { { insuranceId = x.id; workValueCents = null; rateMilli = null; minPremiumCents = null; premiumNetCents = null; taxesCents = null; paid = false; defaultRateMilli = dr; defaultMinCents = dm } };
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
    let c : Types.InsuranceConf = { insuranceId = id; workValueCents = i.workValueCents; rateMilli = i.rateMilli; minPremiumCents = i.minPremiumCents; premiumNetCents = prem; taxesCents = i.taxesCents; paid = i.paid; extra = [] };
    siteAdmin.insuranceConf.add(id, #plain(c));
    siteAdmin.insurances.add(id, { x with updatedAt = Time.now(); updatedBy = p.id });
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
      if (not saOrgOk(x.orgId)) { return ?"Onbekende firma" };
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
  func saMeetingView(m : Types.SiteMeeting) : SV.MeetingView {
    { id = m.id; workId = m.workId; number = m.number; day = m.day; attendees = m.attendees; fileId = m.fileId; fileName = saFileName(m.fileId); points = saPoints(m.workId, m.taskIds); note = m.note; archived = m.archivedAt != null };
  };

  public query ({ caller }) func listMeetings(workId : Nat) : async [SV.MeetingView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, ?workId);
    SiteAdmin.meetingsOf(siteAdmin, workId).filter(func(m : Types.SiteMeeting) : Bool = m.archivedAt == null).sort(func(a, b) = Nat.compare(b.number, a.number)).map(saMeetingView);
  };

  public shared ({ caller }) func saveMeeting(workId : Nat, i : SV.MeetingInput) : async Result.Result<SV.SaveResult, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?workId)) { return saDeny() };
    switch (saAttErr(i.attendees)) { case (?e) return #err(e); case null {} };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (not saFileOk(i.fileId, ?workId)) { return #err("Dit bestand hoort niet bij deze werf of is vertrouwelijk") };
    switch (saPointsErr(workId, i.addPoints)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (SiteAdmin.meetingsOf(siteAdmin, workId).size() >= Config.maxMeetingsPerWork) { return #err("Te veel werfvergaderingen op deze werf") };
        let seq = "vergadering:" # workId.toText();
        let n = (switch (settings.sequences.get(seq)) { case (?x) x; case null 0 }) + 1;
        settings.sequences.add(seq, n);
        let id = Ids.next(ctr, "meeting");
        let (ids, warn) = saMakePoints(p, workId, "actiepunt", i.addPoints);
        siteAdmin.meetings.add(id, { id; workId; number = n; day = i.day; attendees = saClean(i.attendees); fileId = i.fileId; taskIds = ids; note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
        Access.audit(audit, caller, ?p.id, ?workId, "werfvergadering-gemaakt", "nr. " # n.toText() # ", " # ids.size().toText() # " actiepunten");
        #ok({ id; warnings = warn });
      };
      case (?id) {
        let m = switch (siteAdmin.meetings.get(id)) { case (?x) x; case null return saDeny() };
        if (m.workId != workId or m.archivedAt != null) { return saDeny() };
        let (ids, warn) = saMakePoints(p, workId, "actiepunt", i.addPoints);
        siteAdmin.meetings.add(id, { m with day = i.day; attendees = saClean(i.attendees); fileId = i.fileId; taskIds = m.taskIds.concat(ids); note = i.note; updatedAt = now; updatedBy = p.id });
        Access.audit(audit, caller, ?p.id, ?workId, "werfvergadering-gewijzigd", "nr. " # m.number.toText() # (if (ids.size() > 0) ", " # ids.size().toText() # " actiepunten erbij" else ""));
        #ok({ id; warnings = warn });
      };
    };
  };

  public shared ({ caller }) func archiveMeeting(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let m = switch (siteAdmin.meetings.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?m.workId)) { return saDeny() };
    if (m.archivedAt != null) { return #err("Al gearchiveerd") };
    siteAdmin.meetings.add(id, { m with archivedAt = ?Time.now(); updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?m.workId, "werfvergadering-gearchiveerd", "nr. " # m.number.toText());
    #ok;
  };

  // ── Oplevering ───────────────────────────────────────────────────────────
  func saHandoverView(h : Types.Handover) : SV.HandoverView {
    {
      id = h.id; workId = h.workId; kind = h.kind; day = h.day; status = h.status; attendees = h.attendees;
      pvFileId = h.pvFileId; pvFileName = saFileName(h.pvFileId); signedFileId = h.signedFileId; signedFileName = saFileName(h.signedFileId);
      docFileId = h.docFileId; controlCode = h.controlCode; finishedAt = h.finishedAt; isShared = h.sharedAt != null;
      points = saPoints(h.workId, h.taskIds); openPoints = SiteAdmin.openTasks(plan, h.taskIds); note = h.note; archived = h.archivedAt != null;
    };
  };

  public query ({ caller }) func listHandovers(workId : Nat) : async [SV.HandoverView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readSiteAdmin, ?workId);
    SiteAdmin.handoversOf(siteAdmin, workId).filter(func(h : Types.Handover) : Bool = h.archivedAt == null).sort(func(a, b) = Nat.compare(a.id, b.id)).map(saHandoverView);
  };

  public shared ({ caller }) func saveHandover(workId : Nat, i : SV.HandoverInput) : async Result.Result<SV.SaveResult, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?workId)) { return saDeny() };
    switch (saAttErr(i.attendees)) { case (?e) return #err(e); case null {} };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (not saFileOk(i.pvFileId, ?workId) or not saFileOk(i.signedFileId, ?workId)) { return #err("Dit bestand hoort niet bij deze werf of is vertrouwelijk") };
    switch (saPointsErr(workId, i.addPoints)) { case (?e) return #err(e); case null {} };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (SiteAdmin.handoversOf(siteAdmin, workId).any(func(h : Types.Handover) : Bool = h.archivedAt == null and h.kind == i.kind)) { return #err("Er is al een oplevering van dit soort voor deze werf") };
        let id = Ids.next(ctr, "handover");
        let (ids, warn) = saMakePoints(p, workId, "restpunt", i.addPoints);
        siteAdmin.handovers.add(id, {
          id; workId; kind = i.kind; day = i.day; status = #planned; attendees = saClean(i.attendees); pvFileId = i.pvFileId; taskIds = ids; signedFileId = i.signedFileId;
          docFileId = null; controlCode = null; finishedAt = null; sharedAt = null; note = i.note; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
        });
        Access.audit(audit, caller, ?p.id, ?workId, "oplevering-gemaakt", saKind(i.kind) # ", " # ids.size().toText() # " restpunten");
        #ok({ id; warnings = warn });
      };
      case (?id) {
        let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
        if (h.workId != workId or h.archivedAt != null) { return saDeny() };
        let (ids, warn) = saMakePoints(p, workId, "restpunt", i.addPoints);
        // Afgerond: het document ligt vast (soort, datum, aanwezigen en PV blijven); het getekende stuk, de notitie en nieuwe restpunten mogen nog.
        let done = h.finishedAt != null;
        siteAdmin.handovers.add(id, {
          h with day = if (done) h.day else i.day; attendees = if (done) h.attendees else saClean(i.attendees); pvFileId = if (done) h.pvFileId else i.pvFileId;
          signedFileId = i.signedFileId; taskIds = h.taskIds.concat(ids); note = i.note; updatedAt = now; updatedBy = p.id;
        });
        Access.audit(audit, caller, ?p.id, ?workId, "oplevering-gewijzigd", saKind(h.kind) # (if (ids.size() > 0) ", " # ids.size().toText() # " restpunten erbij" else ""));
        #ok({ id; warnings = warn });
      };
    };
  };

  func saKind(k : Types.HandoverKind) : Text { switch k { case (#provisional) "voorlopig"; case (#final) "definitief" } };

  func saHex(t : Text) : Bool { t.size() == 64 and t.chars().all(func c = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f')) };

  // Afronden: het opleveringsdocument (PDF, in de browser gemaakt en opgeladen) ligt vast onder zijn controlecode (sha-256).
  // Met openstaande restpunten wordt de status "met opmerkingen", anders "afgerond".
  public shared ({ caller }) func finishHandover(id : Nat, docFileId : Nat, controlCode : Text) : async Result.Result<SV.HandoverView, Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?h.workId)) { return saDeny() };
    if (h.archivedAt != null) { return saDeny() };
    if (h.finishedAt != null) { return #err("Deze oplevering is al afgerond") };
    if (h.day == null) { return #err("Geef eerst de datum van de oplevering") };
    if (not saHex(controlCode)) { return #err("De controlecode klopt niet") };
    switch (files.files.get(docFileId)) {
      case (?f) { if (f.archivedAt != null or f.workId != ?h.workId or f.confidential or f.mime != "application/pdf") { return #err("Het opleveringsdocument moet een PDF van deze werf zijn") } };
      case null return #err("Onbekend bestand");
    };
    let now = Time.now();
    let status : Types.HandoverStatus = if (SiteAdmin.openTasks(plan, h.taskIds) > 0) #withRemarks else #done;
    let n = { h with status; docFileId = ?docFileId; controlCode = ?controlCode; finishedAt = ?now; updatedAt = now; updatedBy = p.id };
    siteAdmin.handovers.add(id, n);
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
    siteAdmin.handovers.add(id, { h with sharedAt = if (share) ?Time.now() else null; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?h.workId, if (share) "oplevering-gedeeld" else "oplevering-ingetrokken", saKind(h.kind));
    #ok;
  };

  public shared ({ caller }) func archiveHandover(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #editSiteAdmin, ?h.workId)) { return saDeny() };
    if (h.archivedAt != null) { return #err("Al gearchiveerd") };
    if (h.finishedAt != null) { return #err("Een afgeronde oplevering blijft bewaard") };
    siteAdmin.handovers.add(id, { h with archivedAt = ?Time.now(); updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?h.workId, "oplevering-gearchiveerd", saKind(h.kind));
    #ok;
  };

  // De gegevens voor het opleveringsdocument (PDF in de browser): werf, bouwheer, architect, aanwezigen, restpunten met wie en
  // wanneer. Nooit een aankoopprijs of marge: er staat geen enkel bedrag in.
  public query ({ caller }) func handoverDoc(id : Nat) : async Result.Result<SV.HandoverDocData, Text> {
    let p = Access.requireActive(access, caller);
    let h = switch (siteAdmin.handovers.get(id)) { case (?x) x; case null return saDeny() };
    if (not Rights.may({ works; settings }, p, #readSiteAdmin, ?h.workId) or h.archivedAt != null) { return saDeny() };
    let w = switch (works.works.get(h.workId)) { case (?x) x; case null return saDeny() };
    let a = w.address;
    #ok({
      handoverId = h.id; kind = h.kind; workCode = w.code; workName = w.name;
      address = a.street # " " # a.number # ", " # a.zip # " " # a.city;
      clientName = saOrgName(w.clientOrgId); architectName = saOrgName(w.architectOrgId);
      day = h.day; attendees = h.attendees; points = saPoints(h.workId, h.taskIds); note = h.note; previousControlCode = h.controlCode;
    });
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
    if (not saOrgOk(i.supplierOrgId)) { return #err("Onbekende leverancier") };
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

  // ── De klant (Mijn werf): enkel wat kantoor deelde ───────────────────────
  public query ({ caller }) func clientSiteAdmin(workId : Nat) : async SV.ClientSiteView {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #clientQuote, ?workId);
    let attests = List.empty<SV.ClientAttest>();
    for (x in SiteAdmin.insurancesOf(siteAdmin, ?workId).values()) {
      switch (x.attestSharedAt, x.attestDocId) {
        case (?at, ?did) {
          if (x.archivedAt == null) {
            switch (dossier.documents.get(did)) {
              case (?d) {
                if (d.archivedAt == null and d.fileIds.size() > 0) {
                  switch (files.files.get(d.fileIds[d.fileIds.size() - 1])) {
                    case (?f) { if (f.archivedAt == null and not f.confidential) { attests.add({ kindName = SiteAdmin.kindName(x.kind); periodFrom = x.periodFrom; periodTo = x.periodTo; sharedAt = at; file = Dossier.fileView(f) }) } };
                    case null {};
                  };
                };
              };
              case null {};
            };
          };
        };
        case _ {};
      };
    };
    let hs = List.empty<SV.ClientHandover>();
    for (h in SiteAdmin.handoversOf(siteAdmin, workId).values()) {
      switch (h.sharedAt, h.docFileId, h.controlCode) {
        case (?_, ?fid, ?code) {
          if (h.archivedAt == null) {
            switch (files.files.get(fid)) {
              case (?f) { if (f.archivedAt == null and not f.confidential) { hs.add({ kind = h.kind; day = h.day; status = h.status; controlCode = code; file = Dossier.fileView(f) }) } };
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
}
