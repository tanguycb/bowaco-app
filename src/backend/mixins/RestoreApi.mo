// Herstel uit een export (stap 1.9; architectuur M9 en T16): een LEGE canister + de opstartcode + de drie exportbestanden
// (intern, vertrouwelijk, auditlog) → dezelfde gegevens terug, met dezelfde ids. Drie stappen, gedreven door
// tests/herstel.mjs (het draaiboek staat in docs/herstel.md):
//   1. restoreBegin(code)        controleert dat de canister leeg is en de opstartcode klopt;
//   2. restoreChunk(code, deel)  per collectie, in stukken (idempotent: hetzelfde stuk nog eens = dezelfde ids);
//   3. restoreFinish(code)       herrekent de indexen (dag, blokken, bestanden, volgorde) en de tellers, en sluit af.
// Veiligheid: anoniem en robots geweigerd; op een canister die niet leeg is, antwoordt elke stap "Geen toegang" zonder
// naar de code te kijken (geen orakel voor de opstartcode op een levende app); een foute code telt mee in de
// pogingenlimiet en de globale remming. Na restoreFinish is herstel definitief dicht.
// Wat niet terugkomt: de hash van open codes (die komen als vervallen terug: nieuwe codes maken), tickets (10 min),
// pogingentellers. De opstartcode blijft claimbaar, zodat de eigenaar op een ander adres (andere principals) opnieuw
// beheerder kan worden en herstelcodes kan maken.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";
import Reports "../lib/Reports";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  oa : Types.OaState,
  plan : Types.PlanState,
  board : Types.BoardState,
  imp : Types.ImportState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  robot : Types.RobotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  public shared ({ caller }) func restoreBegin(code : Text) : async Result.Result<(), Text> {
    switch (rsGate(caller, code, false)) { case (?e) return #err(e); case null {} };
    settings.values.add("herstel", "bezig");
    settings.values.add("herstel.door", caller.toText());
    settings.values.add("herstel.begin", Int.toText(Time.now()));
    Access.audit(audit, caller, null, null, "herstel-begonnen", "");
    #ok;
  };

  public shared ({ caller }) func restoreChunk(code : Text, part : Views.RestorePart) : async Result.Result<Nat, Text> {
    switch (rsGate(caller, code, true)) { case (?e) return #err(e); case null {} };
    #ok(rsApply(part));
  };

  public shared ({ caller }) func restoreFinish(code : Text) : async Result.Result<Views.RestoreSummary, Text> {
    switch (rsGate(caller, code, true)) { case (?e) return #err(e); case null {} };
    rsRebuild();
    settings.values.add("herstel", "klaar");
    settings.values.add("herstel.einde", Int.toText(Time.now()));
    let s = rsSummary();
    Access.audit(audit, caller, null, null, "herstel-klaar", s.persons.toText() # " personen, " # s.works.toText() # " werven, " # s.tasks.toText() # " taken, " # s.reports.toText() # " verslagen, " # s.files.toText() # " bestanden, " # s.audit.toText() # " auditregels");
    #ok(s);
  };

  // ── Poort ───────────────────────────────────────────────────────────────
  // null = ok. Eerst de toestand (leeg, of herstel bezig door deze login), dan pas de code: een volle canister geeft
  // altijd dezelfde weigering en verraadt niets over de code.
  func rsGate(caller : Principal, code : Text, running : Bool) : ?Text {
    Access.requireAuthenticated(caller);
    if (Access.isRobot(robot, caller)) { return ?"Geen toegang" };
    let state = settings.values.get("herstel");
    if (running) {
      if (state != ?"bezig" or settings.values.get("herstel.door") != ?caller.toText()) { return ?"Geen toegang: er loopt geen herstel voor deze login" };
    } else {
      // Een afgebroken herstel (netwerk, script) mag dezelfde login hervatten: begin is dan herhaalbaar.
      let resume = state == ?"bezig" and settings.values.get("herstel.door") == ?caller.toText();
      if (not resume and (state != null or not rsEmpty())) { return ?"Geen toegang: herstel kan enkel op een lege canister" };
    };
    switch (Access.blockedUntil(access, caller)) { case (?_) return ?"Geen toegang: te veel pogingen"; case null {} };
    let ok = switch (Codes.normalize(code)) {
      case (?b) b.size() == Codes.bootstrapLength and Codes.hex(Codes.hash(b)) == Config.bootstrapHashHex;
      case null false;
    };
    if (not ok) {
      ignore Access.countFailure(access, caller);
      Access.audit(audit, caller, null, null, "herstel-code-fout", "");
      return ?"Geen toegang: code ongeldig";
    };
    null;
  };

  // Leeg = nog nooit geclaimd en geen gegevens (de auditlog telt niet mee: een foute poging staat er ook in).
  func rsEmpty() : Bool {
    not access.bootstrapUsed and access.persons.size() == 0 and access.links.size() == 0 and org.orgs.size() == 0 and works.works.size() == 0 and files.files.size() == 0 and plan.tasks.size() == 0 and reports.reports.size() == 0 and robot.robots.size() == 0 and permits.permits.size() == 0 and permits.municipalities.size() == 0;
  };

  func rsNoContact() : Types.Contact { { name = ""; phone = null; email = null; address = null } };

  // ── Eén stuk toepassen (add = overschrijven op id, dus herhaalbaar) ──────
  func rsApply(part : Views.RestorePart) : Nat {
    switch part {
      case (#persons xs) {
        for (p in xs.values()) { access.persons.add(p.id, { id = p.id; name = p.name; roles = p.roles; orgId = p.orgId; shortCode = p.shortCode; lang = p.lang; phone = p.phone; createdAt = p.createdAt; createdBy = p.createdBy; var archivedAt = p.archivedAt; extra = [] }) };
        xs.size();
      };
      case (#links xs) {
        for (l in xs.values()) { access.links.add(l.principal, { personId = l.personId; var status = l.status; linkedAt = l.linkedAt; codeHint = l.codeHint; inviteId = 0; var tag = l.tag; var confirmedBy = l.confirmedBy; var confirmedAt = l.confirmedAt; var revokedBy = l.revokedBy; var revokedAt = l.revokedAt }) };
        xs.size();
      };
      case (#linkHistory xs) { for (h in xs.values()) { access.linkHistory.add(h.id, h) }; xs.size() };
      case (#invites xs) {
        // De hash staat niet in de export: een open code is na een herstel onbruikbaar en komt als vervallen terug.
        for (i in xs.values()) {
          let state : Types.CodeState = switch (i.state) { case (#open) #expired({ at = Time.now() }); case s s };
          access.invites.add(i.id, { id = i.id; hash = Text.encodeUtf8(""); personId = i.personId; kind = i.kind; createdBy = i.createdBy; createdAt = i.createdAt; expiresAt = i.expiresAt; hint = i.hint; tag = i.tag; workIds = i.workIds; var state = state });
        };
        xs.size();
      };
      case (#orgs xs) {
        for (o in xs.values()) { org.orgs.add(o.id, { id = o.id; kind = o.kind; name = o.name; kbo = o.kbo; vat = o.vat; aliases = o.aliases; trades = o.trades; address = o.address; notes = o.notes; createdAt = o.createdAt; createdBy = o.createdBy; var archivedAt = o.archivedAt; extra = [] }) };
        xs.size();
      };
      case (#orgConfidential xs) {
        for ((id, c) in xs.values()) { org.orgConfidential.add(id, { orgId = id; var contact = (#plain(c.contact ?? rsNoContact()) : Types.Confidential<Types.Contact>); var notes = (#plain(c.notes ?? "") : Types.Confidential<Text>); var version = c.version }) };
        xs.size();
      };
      case (#personConfidential xs) {
        for ((id, c) in xs.values()) { access.personConfidential.add(id, { personId = id; var contact = (#plain(c.contact ?? rsNoContact()) : Types.Confidential<Types.Contact>); var version = c.version }) };
        xs.size();
      };
      case (#works xs) {
        for (w in xs.values()) { works.works.add(w.id, { id = w.id; code = w.code; name = w.name; address = w.address; parentId = w.parentId; clientOrgId = w.clientOrgId; architectOrgId = w.architectOrgId; leaderPersonId = w.leaderPersonId; var status = w.status; vatBp = w.vatBp; plannedStart = w.plannedStart; plannedEnd = w.plannedEnd; estimatedAmountCents = (null : ?Int); safetyCoordinatorOrgId = (null : ?Nat); createdAt = w.createdAt; createdBy = w.createdBy; var archivedAt = w.archivedAt; extra = w.extra }) };
        xs.size();
      };
      case (#workInfo xs) { for (i in xs.values()) { dossier.info.add(i.workId, i) }; xs.size() };
      case (#workConfidential xs) { for (c in xs.values()) { dossier.confidential.add(c.workId, c) }; xs.size() };
      case (#workConfidentialHistory xs) { for (h in xs.values()) { dossier.confidentialHistory.add(h.id, h) }; xs.size() };
      case (#memberships xs) {
        for (m in xs.values()) { works.memberships.add(m.id, { id = m.id; workId = m.workId; personId = m.personId; orgId = m.orgId; role = m.role; grants = m.grants; grantedAt = m.grantedAt; grantedBy = m.grantedBy; var endedAt = m.endedAt; var endedBy = m.endedBy }) };
        xs.size();
      };
      case (#files xs) {
        // Zonder verwijzing (vertrouwelijk in de interne export) overslaan: die komt uit de vertrouwelijke export.
        for (f in xs.values()) {
          switch (f.blob) {
            case (?b) files.files.add(f.id, { id = f.id; name = f.name; mime = f.mime; size = f.size; blob = b; workId = f.workId; confidential = f.confidential; personId = f.personId; at = f.at; var archivedAt = f.archivedAt });
            case null {};
          };
        };
        xs.size();
      };
      case (#documents xs) { for (d in xs.values()) { dossier.documents.add(d.id, d) }; xs.size() };
      case (#orgContacts xs) { for (c in xs.values()) { oa.orgContacts.add(c.orgId, c) }; xs.size() };
      case (#personContacts xs) { for (c in xs.values()) { oa.personContacts.add(c.personId, c) }; xs.size() };
      case (#lookups xs) {
        for (l in xs.values()) { settings.lookups.add(l.list # ":" # l.key, { list = l.list; key = l.key; tag = l.tag; order = l.order; var archivedAt = l.archivedAt; extra = l.extra }) };
        xs.size();
      };
      case (#values xs) { for ((k, v) in xs.values()) { if (not k.startsWith(#text "herstel")) { settings.values.add(k, v) } }; xs.size() };
      case (#sequences xs) { for ((k, v) in xs.values()) { settings.sequences.add(k, v) }; xs.size() };
      case (#settings s) {
        settings.werfleiderZietAlles := s.werfleiderZietAlles;
        settings.inviteDays := s.inviteDays;
        // De drempels enkel als vlag bewaren als ze van de standaard afwijken (zoals de bron: anders staan er na
        // een herstel twee vlaggen meer dan ervoor en is de export niet gelijk).
        if (s.threshold30bisCents != Config.threshold30bisCentsDefault) { settings.values.add("drempel30bis", s.threshold30bisCents.toText()) };
        if (s.thresholdCheckinatworkCents != Config.thresholdCheckinatworkCentsDefault) { settings.values.add("drempelCheckinatwork", s.thresholdCheckinatworkCents.toText()) };
        1;
      };
      case (#tasks xs) { for (t in xs.values()) { plan.tasks.add(t.id, t) }; xs.size() };
      case (#assignments xs) { for (a in xs.values()) { plan.assignments.add(a.id, a) }; xs.size() };
      case (#dependencies xs) { for (d in xs.values()) { plan.dependencies.add(d.id, d) }; xs.size() };
      case (#calendarBlocks xs) { for (b in xs.values()) { plan.calendarBlocks.add(b.id, b) }; xs.size() };
      case (#taskChanges xs) { for (c in xs.values()) { plan.taskChanges.add(c.id, c) }; xs.size() };
      case (#templates xs) { for (t in xs.values()) { plan.templates.add(t.key, t) }; xs.size() };
      case (#planVersions xs) { for ((w, v) in xs.values()) { plan.versions.add(w, v) }; xs.size() };
      case (#absences xs) { for (a in xs.values()) { board.absences.add(a.id, a) }; xs.size() };
      case (#absenceChanges xs) { for (c in xs.values()) { board.absenceChanges.add(c.id, c) }; xs.size() };
      case (#capacity xs) { for (r in xs.values()) { board.capacity.add(r.key, r) }; xs.size() };
      case (#importBatches xs) { for (b in xs.values()) { imp.batches.add(b.id, b) }; xs.size() };
      case (#importKeys xs) { for (k in xs.values()) { imp.keys.add(k.key, k) }; xs.size() };
      case (#appointments xs) { for (a in xs.values()) { imp.appointments.add(a.id, a) }; xs.size() };
      case (#vehicles xs) {
        let now = Time.now();
        for (v in xs.values()) { org.vehicles.add(v.id, { id = v.id; plate = v.plate; name = v.name; createdAt = now; var archivedAt = if (v.archived) ?now else null; extra = [] }) };
        xs.size();
      };
      case (#dayReports xs) { for (r in xs.values()) { reports.reports.add(r.id, r) }; xs.size() };
      case (#reportKeys xs) { for ((k, id) in xs.values()) { reports.keys.add(k, id) }; xs.size() };
      case (#reportChanges xs) { for (c in xs.values()) { reports.changes.add(c.id, c) }; xs.size() };
      case (#attendances xs) { for (a in xs.values()) { reports.attendances.add(a.id, a) }; xs.size() };
      case (#hoursConfirmations xs) {
        for (c in xs.values()) {
          let prev = switch (reports.confirmations.get(c.attendanceId)) { case (?cs) cs; case null [] };
          if (not prev.any(func x = x.id == c.id)) { reports.confirmations.add(c.attendanceId, Array.concat(prev, [c])) };
        };
        xs.size();
      };
      case (#workDone xs) { for (w in xs.values()) { reports.workDone.add(w.id, w) }; xs.size() };
      case (#materials xs) { for (m in xs.values()) { reports.materials.add(m.id, m) }; xs.size() };
      case (#photos xs) { for (p in xs.values()) { reports.photos.add(p.id, p) }; xs.size() };
      case (#issues xs) { for (i in xs.values()) { reports.issues.add(i.id, i) }; xs.size() };
      case (#trips xs) { for (t in xs.values()) { reports.trips.add(t.id, t) }; xs.size() };
      case (#ops xs) { for (o in xs.values()) { reports.ops.add(o.opId, o) }; xs.size() };
      case (#robots xs) {
        for (r in xs.values()) { robot.robots.add(r.principal, { principal = r.principal; name = r.name; kinds = r.kinds; addedAt = r.addedAt; addedBy = r.addedBy; var revokedAt = r.revokedAt; var revokedBy = (null : ?Nat) }) };
        xs.size();
      };
      case (#proposals xs) {
        for (x in xs.values()) {
          robot.proposals.add(x.id, { id = x.id; ticketId = x.ticketId; jobId = (null : ?Nat); personId = x.personId; workId = x.workId; kind = x.kind; content = x.content; by = x.by; at = x.at; var decision = x.decision });
          switch (x.ticketId) { case (?t) robot.proposalByTicket.add(t, x.id); case null {} };
        };
        xs.size();
      };
      case (#notifications xs) {
        for (n in xs.values()) { audit.notifications.add(n.id, { id = n.id; personId = n.personId; kind = n.kind; text = n.text; workId = n.workId; ref = (null : ?(Text, Nat)); createdAt = n.createdAt; var readAt = n.readAt }) };
        xs.size();
      };
      case (#audit xs) { for (e in xs.values()) { audit.log.add(e) }; xs.size() };
      case (#counters xs) { for ((k, v) in xs.values()) { ctr.add(k, v) }; xs.size() };
      case (#permits xs) { for (x in xs.values()) { permits.permits.add(x.id, x) }; xs.size() };
      case (#permitChanges xs) { for (c in xs.values()) { permits.changes.add(c.id, c) }; xs.size() };
      case (#municipalities xs) { for (m in xs.values()) { permits.municipalities.add(m.id, m) }; xs.size() };
      case (#procedures xs) { for (x in xs.values()) { permits.procedures.add(x.municipalityId.toText() # ":" # x.kind, x) }; xs.size() };
      case (#permitAlerts xs) { for ((k, v) in xs.values()) { permits.alerts.add(k, v) }; xs.size() };
    };
  };

  // ── Afsluiten: indexen en tellers herrekenen ────────────────────────────
  func rsBlock(reportId : Nat, f : Types.ReportBlocks -> Types.ReportBlocks) {
    let b = switch (reports.blocks.get(reportId)) { case (?b) b; case null Reports.emptyBlocks() };
    reports.blocks.add(reportId, f(b));
  };

  // Eerst de sleutels verzamelen, dan schrappen (nooit schrappen tijdens het doorlopen).
  func rsClearText<V>(m : Map.Map<Text, V>) {
    let keys = m.keys().toArray();
    for (k in keys.values()) { m.remove(k) };
  };

  func rsClearNat<V>(m : Map.Map<Nat, V>) {
    let keys = m.keys().toArray();
    for (k in keys.values()) { m.remove(k) };
  };

  func rsMaxKey<V>(m : Map.Map<Nat, V>) : Nat {
    switch (m.reverseEntries().next()) { case (?(k, _)) k; case null 0 };
  };

  func rsAtLeast(collection : Text, n : Nat) {
    let cur = switch (ctr.get(collection)) { case (?v) v; case null 0 };
    if (n > cur) { ctr.add(collection, n) };
  };

  func rsRebuild() {
    rsClearText(reports.dayIndex);
    rsClearNat(reports.blocks);
    rsClearNat(reports.fileOwners);
    rsClearNat(reports.opOrder);
    // De Maps lopen op id: zo komen de blokken in de volgorde waarin ze gemaakt werden.
    for (r in reports.reports.values()) {
      let key = Reports.dayKey(r.workId, r.day);
      reports.dayIndex.add(key, Reports.append(switch (reports.dayIndex.get(key)) { case (?x) x; case null [] }, r.id));
      reports.blocks.add(r.id, Reports.emptyBlocks());
      if (not reports.keys.containsKey(r.clientKey)) { reports.keys.add(r.clientKey, r.id) };
    };
    for (a in reports.attendances.values()) { rsBlock(a.reportId, func b = { b with attendances = Reports.append(b.attendances, a.id) }) };
    for (w in reports.workDone.values()) { rsBlock(w.reportId, func b = { b with workDone = Reports.append(b.workDone, w.id) }) };
    for (m in reports.materials.values()) {
      rsBlock(m.reportId, func b = { b with materials = Reports.append(b.materials, m.id) });
      switch (m.fileId) { case (?f) reports.fileOwners.add(f, m.reportId); case null {} };
    };
    for (p in reports.photos.values()) {
      rsBlock(p.reportId, func b = { b with photos = Reports.append(b.photos, p.id) });
      reports.fileOwners.add(p.fileId, p.reportId);
      switch (p.thumbFileId) { case (?f) reports.fileOwners.add(f, p.reportId); case null {} };
    };
    for (i in reports.issues.values()) { rsBlock(i.reportId, func b = { b with issues = Reports.append(b.issues, i.id) }) };
    for (t in reports.trips.values()) { rsBlock(t.reportId, func b = { b with trips = Reports.append(b.trips, t.id) }) };
    var maxSeq = 0;
    for (o in reports.ops.values()) { reports.opOrder.add(o.seq, o.opId); if (o.seq > maxSeq) { maxSeq := o.seq } };
    // Tellers nooit lager dan het hoogste herstelde id: anders botst een nieuw record met een hersteld (D3).
    rsAtLeast("person", rsMaxKey(access.persons));
    rsAtLeast("membership", rsMaxKey(works.memberships));
    rsAtLeast("invite", rsMaxKey(access.invites));
    rsAtLeast("linkHistory", rsMaxKey(access.linkHistory));
    rsAtLeast("notification", rsMaxKey(audit.notifications));
    rsAtLeast("org", rsMaxKey(org.orgs));
    rsAtLeast("work", rsMaxKey(works.works));
    rsAtLeast("workConfidentialVersion", rsMaxKey(dossier.confidentialHistory));
    rsAtLeast("document", rsMaxKey(dossier.documents));
    rsAtLeast("file", rsMaxKey(files.files));
    rsAtLeast("ticket", rsMaxKey(robot.tickets));
    rsAtLeast("proposal", rsMaxKey(robot.proposals));
    rsAtLeast("task", rsMaxKey(plan.tasks));
    rsAtLeast("dependency", rsMaxKey(plan.dependencies));
    rsAtLeast("assignment", rsMaxKey(plan.assignments));
    rsAtLeast("calendarBlock", rsMaxKey(plan.calendarBlocks));
    rsAtLeast("taskChange", rsMaxKey(plan.taskChanges));
    rsAtLeast("absence", rsMaxKey(board.absences));
    rsAtLeast("absenceChange", rsMaxKey(board.absenceChanges));
    rsAtLeast("report", rsMaxKey(reports.reports));
    rsAtLeast("reportChange", rsMaxKey(reports.changes));
    rsAtLeast("attendance", rsMaxKey(reports.attendances));
    var maxConf = 0;
    for (cs in reports.confirmations.values()) { for (c in cs.values()) { if (c.id > maxConf) { maxConf := c.id } } };
    rsAtLeast("hoursConfirmation", maxConf);
    rsAtLeast("workDone", rsMaxKey(reports.workDone));
    rsAtLeast("material", rsMaxKey(reports.materials));
    rsAtLeast("photo", rsMaxKey(reports.photos));
    rsAtLeast("issue", rsMaxKey(reports.issues));
    rsAtLeast("trip", rsMaxKey(reports.trips));
    rsAtLeast("vehicle", rsMaxKey(org.vehicles));
    rsAtLeast("appointment", rsMaxKey(imp.appointments));
    rsAtLeast("op", maxSeq);
    rsAtLeast("permit", rsMaxKey(permits.permits));
    rsAtLeast("permitChange", rsMaxKey(permits.changes));
    rsAtLeast("municipality", rsMaxKey(permits.municipalities));
  };

  func rsSummary() : Views.RestoreSummary {
    {
      persons = access.persons.size();
      works = works.works.size();
      tasks = plan.tasks.size();
      reports = reports.reports.size();
      files = files.files.size();
      audit = audit.log.size();
      counters = ctr.entries().toArray();
    };
  };
};
