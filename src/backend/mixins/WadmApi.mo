// Werfadministratie (stap 1b.4, bouwplan §5.4): per werf de aangifte van werken (30bis: nodig? waarom? klaarzetten en
// bijhouden), Checkinatwork (nodig? export van de aanwezigheden uit het werfverslag), de vergunningen (1b.1) en de
// inhoudingsplicht van elke onderaannemer op de werf; over alle werven een overzicht. Indienen gebeurt altijd door een
// mens op het portaal van de sociale zekerheid (eID/itsme). De inhoudingsplicht heeft geen publieke webservice zonder
// aansluiting (en de publieke site heeft een CAPTCHA): de app geeft de link met het KBO-nummer en de mens legt het
// resultaat vast (onderzoek 1b.4). Regels VOORLOPIG tot de boekhouder bevestigt; drempels instelbaar.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Order "mo:core/Order";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Permits "../lib/Permits";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";
import Wadm "../lib/Wadm";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  wadm : Types.WadmState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func waExt() : Dossier.Ext { Wadm.ext(org, works, plan, wadm) };

  // ── Per werf ─────────────────────────────────────────────────────────────
  public query ({ caller }) func workAdmin(workId : Nat) : async Views.WorkAdminView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readWorkFacts, ?workId);
    let w = works.works.get(workId) ?? Runtime.trap("Geen toegang");
    let f = Dossier.facts(settings, works, dossier, waExt(), workId);
    let (start, end) = Wadm.period(plan, works, w);
    let today = Dossier.today();
    var total = 0;
    var granted = 0;
    var attention = 0;
    for (x in permits.permits.values()) {
      if (x.workId == workId and x.archivedAt == null and x.status != #cancelled) {
        total += 1;
        let st = Permits.effectiveStatus(x, today);
        if (st == #granted or st == #extended) { granted += 1 };
        let (from, to) = Permits.needed(plan, works, x);
        if (Permits.warnings(settings, x, from, to, today).size() > 0) { attention += 1 };
      };
    };
    {
      workId;
      art30bis = f.art30bis;
      reason = f.art30bisReason;
      oaCount = f.oaCount;
      declaration = Wadm.declarationView(access, wadm.declarations.get(workId), start);
      checkinatwork = f.checkinatwork;
      permitsTotal = total;
      permitsGranted = granted;
      permitsAttention = attention;
      oas = Wadm.oaOrgs(org, works, plan, workId).map(func o = Wadm.oaStatus(access, org, wadm, o, today));
      dbUpdated = Wadm.dbUpdated(today);
      start;
      end;
      canEdit = Rights.may(ctx, p, #editWork, ?workId);
      canCheck = Rights.may(ctx, p, #checkWithholding, null);
      canSeeAmounts = Rights.may(ctx, p, #readContract, ?workId);
    };
  };

  // Alles wat de online aangifte vraagt, klaar om over te nemen. Update-call: wie het bedrag ziet, staat in de auditlog.
  public shared ({ caller }) func declarationDraft(workId : Nat) : async Result.Result<Views.DeclarationDraft, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readWorkFacts, ?workId);
    let w = works.works.get(workId) ?? return #err("Geen toegang");
    let amounts = Rights.may(ctx, p, #readContract, ?workId);
    let f = Dossier.facts(settings, works, dossier, waExt(), workId);
    let (start, end) = Wadm.period(plan, works, w);
    let d = wadm.declarations.get(workId);
    let orgName = func(o : ?Nat) : Text { switch o { case (?x) { switch (org.orgs.get(x)) { case (?y) y.name; case null "" } }; case null "" } };
    let amount : ?Int = if amounts {
      switch (Dossier.effectiveConfidential(works, dossier, workId)) {
        case (?(c, _)) { switch (c.contract) { case (#plain k) k.estimatedAmountCents; case (#sealed _) null } };
        case null null;
      };
    } else null;
    let clientAddress : ?Types.Address = if (amounts and Rights.may(ctx, p, #readConfidentialContact, null)) {
      switch (w.clientOrgId) {
        case (?o) {
          switch (org.orgConfidential.get(o)) {
            case (?c) { switch (c.contact) { case (#plain x) x.address; case (#sealed _) null } };
            case null { switch (org.orgs.get(o)) { case (?x) x.address; case null null } };
          };
        };
        case null null;
      };
    } else null;
    let vc = works.memberships.values().filter(func m = m.workId == workId and m.endedAt == null and m.role == #veiligheidscoordinator).map(
      func(m : Types.Membership) : Text {
        switch (m.orgId, m.personId) { case (?o, _) orgName(?o); case (null, ?pid) Access.personName(access, pid); case _ "" };
      }
    ).toArray();
    let regie = reports.attendances.values().any(func a = a.workId == workId and a.archivedAt == null and a.regie);
    if amounts { Access.audit(audit, caller, ?p.id, ?workId, "bekeek:aangifte-30bis", w.code) };
    #ok({
      workCode = w.code;
      workName = w.name;
      workAddress = w.address;
      client = orgName(w.clientOrgId);
      clientAddress;
      amountCents = amount;
      nature = switch d { case (?x) x.nature; case null "eenmalig" };
      start;
      end;
      regie;
      oas = Wadm.oaOrgs(org, works, plan, workId).filterMap(func(o : Nat) : ?Views.DeclarationOa { switch (org.orgs.get(o)) { case (?x) ?{ name = x.name; kbo = x.kbo; vat = x.vat }; case null null } });
      architect = orgName(w.architectOrgId);
      safetyCoordinator = vc.values().join(", ");
      asbestos = switch d { case (?x) x.asbestos; case null false };
      deadline = switch start { case (?s) ?(if (s > 15) s - 15 else 0); case null null };
      reason = f.art30bisReason;
      portal = "https://formica.socialsecurity.be/formica/loggedHome";
    });
  };

  // Status van de aangifte bijhouden (indienen doet een mens op het portaal). Gedaan = ook het document "aangifte-30bis"
  // in het dossier op "ontvangen" (zo klopt de checklist van 1.1).
  public shared ({ caller }) func saveDeclaration(workId : Nat, x : Views.DeclarationInput) : async Result.Result<Views.DeclarationView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?workId);
    let w = works.works.get(workId) ?? return #err("Geen toegang");
    if (x.nature != "eenmalig" and x.nature != "doorlopend") { return #err("Aard: eenmalig of doorlopend") };
    if (x.note.size() > Config.maxNote) { return #err("Notitie te lang") };
    switch (x.status) {
      case (#done d) {
        if (d.number.trim(#char ' ').size() == 0 or d.number.size() > Config.maxShort * 2) { return #err("Geef het nummer van de aangifte") };
        if (not Permits.dayOk(?d.on)) { return #err("Onmogelijke datum") };
      };
      case (#notNeeded n) { if (n.reason.trim(#char ' ').size() == 0 or n.reason.size() > Config.maxNote) { return #err("Geef een reden") } };
      case (#todo) {};
    };
    let old = wadm.declarations.get(workId);
    let now = Time.now();
    let n : Types.Declaration = { workId; status = x.status; nature = x.nature; asbestos = x.asbestos; note = x.note; updatedAt = now; updatedBy = p.id; extra = switch old { case (?o) o.extra; case null [] } };
    wadm.declarations.add(workId, n);
    let word = switch (x.status) { case (#todo) "te doen"; case (#done d) "gedaan " # Plan.fmtDay(d.on) # " nr. " # d.number; case (#notNeeded _) "niet nodig" };
    Access.audit(audit, caller, ?p.id, ?workId, "aangifte-30bis", word # (if (x.asbestos) " · asbest" else "") # " · " # x.nature);
    switch (x.status) {
      case (#done d) {
        // Het document van de checklist (soort "aangifte-30bis"): het bestaande bijwerken of een nieuw maken.
        let existing = Dossier.docsOf(dossier, workId).find(func doc = doc.kind == "aangifte-30bis");
        switch existing {
          case (?doc) { dossier.documents.add(doc.id, { doc with status = #received; title = "Aangifte van werken nr. " # d.number; updatedAt = now; updatedBy = p.id }) };
          case null {
            let id = Ids.next(ctr, "document");
            dossier.documents.add(id, { id; workId; kind = "aangifte-30bis"; title = "Aangifte van werken nr. " # d.number; fileIds = []; status = #received; dueDay = null; validUntil = null; note = "ingediend op " # Plan.fmtDay(d.on); ownerOrgId = null; confidential = false; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] });
          };
        };
      };
      case _ {};
    };
    let (start, _) = Wadm.period(plan, works, w);
    #ok(Wadm.declarationView(access, ?n, start));
  };

  // ── Inhoudingsplicht ─────────────────────────────────────────────────────
  public shared ({ caller }) func recordWithholdingCheck(orgId : Nat, x : Views.WithholdingInput) : async Result.Result<Views.OaWithholding, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #checkWithholding, null);
    let o = org.orgs.get(orgId) ?? return #err("Onbekende firma");
    let kbo = o.kbo ?? return #err("Deze firma heeft geen KBO-nummer (fiche Onderaannemers)");
    let today = Dossier.today();
    if (x.consultedOn > today + 1 or x.consultedOn + 400 < today) { return #err("Datum van de raadpleging: vandaag of het voorbije jaar") };
    if (x.reference.size() > Config.maxName or x.note.size() > Config.maxNote) { return #err("Te lange tekst") };
    switch (x.workId) { case (?w) { if (not Rights.may(ctx, p, #readWork, ?w)) { return #err("Geen toegang tot die werf") } }; case null {} };
    let id = Ids.next(ctr, "withholdingCheck");
    wadm.checks.add(id, { id; orgId; kbo; result = x.result; consultedOn = x.consultedOn; reference = x.reference.trim(#char ' '); note = x.note; source = "hand"; workId = x.workId; fileId = null; at = Time.now(); by = ?p.id; extra = [] });
    Access.audit(audit, caller, ?p.id, x.workId, "inhoudingsplicht", o.name # ": " # Wadm.resultWord(x.result) # " (" # Plan.fmtDay(x.consultedOn) # ")");
    // Rood: de beheerders weten het meteen (een betaling moet dan ingehouden worden).
    if (x.result != #clear and x.result != #unknown) {
      Access.notifyAdmins(access, audit, ctr, "inhoudingsplicht", o.name # ": " # Wadm.resultWord(x.result) # " — vóór elke betaling inhouden of opnieuw nakijken");
    };
    #ok(Wadm.oaStatus(access, org, wadm, orgId, today));
  };

  public query ({ caller }) func withholdingHistory(orgId : Nat) : async [Views.WithholdingCheckView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #checkWithholding, null);
    let xs = wadm.checks.values().filter(func c = c.orgId == orgId).map(func c = Wadm.checkView(access, c)).toArray();
    xs.sort(func(a, b) = if (a.consultedOn != b.consultedOn) Nat.compare(b.consultedOn, a.consultedOn) else Nat.compare(b.id, a.id));
  };

  // ── Checkinatwork: de aanwezigheden uit de werfverslagen (bewijs; vervangt de registratie NIET) ──
  public shared ({ caller }) func checkinatworkExport(workId : Nat, from : Nat, to : Nat) : async Result.Result<Views.CiawExport, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?workId);
    let w = works.works.get(workId) ?? return #err("Geen toegang");
    if (to < from or to - from > 400) { return #err("Periode: hoogstens 400 dagen") };
    let rows = List.empty<Views.CiawRow>();
    for (a in reports.attendances.values()) {
      if (a.workId == workId and a.archivedAt == null and a.replacedBy == null and a.day >= from and a.day <= to) {
        let (name, kbo) = switch (a.orgId) {
          case (?o) { switch (org.orgs.get(o)) { case (?x) (x.name, switch (x.kbo) { case (?k) k; case null "" }); case null ("#" # o.toText(), "") } };
          case null ("BOWACO", "");
        };
        rows.add({ day = a.day; orgName = name; kbo; names = if (a.names.size() > 0) a.names else (switch (a.personId) { case (?pid) Access.personName(access, pid); case null "" }); headcount = a.headcount; slots = Wadm.slotsText(a.slots); minutes = a.minutesTotal; regie = a.regie });
      };
    };
    let number = switch (wadm.declarations.get(workId)) { case (?d) { switch (d.status) { case (#done x) x.number; case _ "" } }; case null "" };
    Access.audit(audit, caller, ?p.id, ?workId, "checkinatwork-export", Plan.fmtDay(from) # " – " # Plan.fmtDay(to) # ": " # rows.size().toText() # " regels");
    #ok({ workCode = w.code; workName = w.name; address = w.address; declarationNumber = number; from; to; required = Dossier.facts(settings, works, dossier, waExt(), workId).checkinatwork; rows = rows.toArray().sort(Wadm.compareDay) });
  };

  // ── Over alle werven ────────────────────────────────────────────────────
  // Werven (gepland of bezig) waarvoor een aangifte nodig of nog onbekend is en die nog niet gedaan is; onderaannemers
  // met werk (vandaag tot over 8 weken of de voorbije 4 weken) waarvan de inhoudingsplicht niet "ok" is.
  public query ({ caller }) func wadmOverview() : async Views.WadmOverview {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #wadmOverview, null);
    let today = Dossier.today();
    let ext = waExt();
    let decl = List.empty<Views.WadmDeclarationLine>();
    let active = Map.empty<Nat, ()>();
    for (w in works.works.values()) {
      if (w.archivedAt == null and (w.status == #planned or w.status == #running) and Rights.seesWork(ctx, p, w.id)) {
        let f = Dossier.facts(settings, works, dossier, ext, w.id);
        let st = switch (wadm.declarations.get(w.id)) { case (?d) d.status; case null #todo };
        let open = switch st { case (#todo) true; case _ false };
        if (open and f.art30bis != ?false and decl.size() < 300) {
          let (start, _) = Wadm.period(plan, works, w);
          decl.add({ workId = w.id; workCode = w.code; workName = w.name; reason = f.art30bisReason; start; deadline = switch start { case (?s) ?(if (s > 15) s - 15 else 0); case null null }; status = if (f.art30bis == null) "nog te bepalen" else "te doen" });
        };
        active.add(w.id, ());
      };
    };
    // OA's met werk rond vandaag op die werven
    let oaSet = Map.empty<Nat, ()>();
    for (a in plan.assignments.values()) {
      if (a.archivedAt == null and active.containsKey(a.workId) and oaSet.size() < 300) {
        switch (plan.tasks.get(a.taskId), org.orgs.get(a.orgId)) {
          case (?t, ?o) { if (t.archivedAt == null and o.kind == #subcontractor and t.start + 28 >= today and t.start <= today + 56) { oaSet.add(a.orgId, ()) } };
          case _ {};
        };
      };
    };
    let oas = oaSet.keys().map(func o = Wadm.oaStatus(access, org, wadm, o, today)).filter(func s = s.state != "ok").toArray();
    {
      declarations = decl.toArray().sort(func(a : Views.WadmDeclarationLine, b : Views.WadmDeclarationLine) : Order.Order {
        switch (a.deadline, b.deadline) { case (?x, ?y) Nat.compare(x, y); case (?_, null) #less; case (null, ?_) #greater; case _ Text.compare(a.workCode, b.workCode) };
      });
      oas = oas.sort(func(a : Views.OaWithholding, b : Views.OaWithholding) : Order.Order = Text.compare(a.name, b.name));
      dbUpdated = Wadm.dbUpdated(today);
    };
  };

  public query ({ caller }) func wadmRules() : async Views.WadmRules {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #wadmOverview, null);
    { threshold30bisCents = Dossier.threshold30bis(settings); threshold30bisWithOaCents = Dossier.threshold30bisWithOa(settings); oaCountAlways = Dossier.oaCountAlways30bis(settings); thresholdCheckinatworkCents = Dossier.thresholdCheckinatwork(settings) };
  };

  public shared ({ caller }) func setWadmRules(r : Views.WadmRules) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (r.threshold30bisCents == 0 or r.threshold30bisWithOaCents == 0 or r.thresholdCheckinatworkCents == 0 or r.oaCountAlways < 1 or r.oaCountAlways > 20) { return #err("Drempels > 0, aantal onderaannemers 1–20") };
    if (r.threshold30bisCents > Int.abs(Config.maxAmountCents) or r.thresholdCheckinatworkCents > Int.abs(Config.maxAmountCents)) { return #err("Drempel te hoog") };
    settings.values.add("drempel30bis", r.threshold30bisCents.toText());
    settings.values.add("drempel30bisMetOa", r.threshold30bisWithOaCents.toText());
    settings.values.add("30bis.aantalOa", r.oaCountAlways.toText());
    settings.values.add("drempelCheckinatwork", r.thresholdCheckinatworkCents.toText());
    Access.audit(audit, caller, ?p.id, null, "werfadministratie-regels", "drempels 30bis/Checkinatwork gewijzigd");
    #ok;
  };
};
