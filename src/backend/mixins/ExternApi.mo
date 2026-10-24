// Externe weergaven (stap 1.7, bouwplan rij 1.7 en §8.2, architectuur R6, R8, R9, R15 en rij 1.7 in §11): wat een OA
// of architect zelf ziet en doet. Mijn uren (de regels van zijn firma uit de werfverslagen) en die bevestigen of
// betwisten (R9, append-only); mijn werven met de werfleider om te bellen; en per extern lidmaatschap de rechten
// (grants) instellen door wie het team van de werf beheert (architectuur rij 1.7: instelbaar per externe).
// Geen await: elke oproep is één atomische stap.
import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  reports : Types.ReportState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Mijn uren: de aanwezigheidsregels van mijn firma (OA) op werven waar ik lid ben. Interne rollen lezen de
  // verslagen zelf; voor hen is dit leeg. Hoogstens 120 dagen, 500 regels.
  public query ({ caller }) func myHours(fromDay : Nat, toDay : Nat) : async [Views.HoursLine] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    if (toDay < fromDay or toDay - fromDay > 120) { Runtime.trap("Periode: hoogstens 120 dagen") };
    let own = switch (p.orgId) { case (?o) o; case null return [] };
    let out = List.empty<Views.HoursLine>();
    label scan for ((_, a) in reports.attendances.reverseEntries()) {
      if (a.archivedAt == null and a.orgId == ?own and a.day >= fromDay and a.day <= toDay and Rights.reportScope(ctx, p, a.workId) == #ownHours) {
        out.add(exLine(p, a));
        if (out.size() >= Config.maxListPage) { break scan };
      };
    };
    Array.sort<Views.HoursLine>(out.toArray(), func(x, y) = if (x.day == y.day) Nat.compare(x.attendanceId, y.attendanceId) else Nat.compare(y.day, x.day));
  };

  // R9: de OA bevestigt (of betwist, met een reden) een regel van zijn eigen firma, met de grant #confirmHours op die
  // werf, en enkel als het verslag afgesloten is. Append-only: een nieuwe bevestiging komt erbij, de vorige blijft.
  // Een betwisting gaat als melding naar wie het verslag begon en de werfleider(s) van de werf.
  public shared ({ caller }) func confirmHours(attendanceId : Nat, ok : Bool, remark : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let a = reports.attendances.get(attendanceId) ?? Runtime.trap("Geen toegang");
    Rights.require(ctx, p, #confirmOwnHours, ?a.workId);
    if (a.orgId == null or a.orgId != p.orgId) { Runtime.trap("Geen toegang: niet de uren van jouw firma") };
    if (a.archivedAt != null) { return #err("Deze regel bestaat niet meer (aangepast in het verslag)") };
    let r = reports.reports.get(a.reportId) ?? return #err("Onbekend verslag");
    if (Reports.isDraft(r)) { return #err("Het verslag is nog niet afgesloten: bevestigen kan daarna") };
    let why = remark.trim(#char ' ');
    if (why.size() > Config.maxNote) { return #err("Opmerking: hoogstens " # Config.maxNote.toText() # " tekens") };
    if (not ok and why.size() == 0) { return #err("Schrijf wat er niet klopt") };
    let prev = switch (reports.confirmations.get(attendanceId)) { case (?cs) cs; case null [] };
    if (prev.size() >= 10) { return #err("Te veel bevestigingen voor deze regel") };
    let orgId = switch (a.orgId) { case (?o) o; case null 0 };
    let id = Ids.next(ctr, "hoursConfirmation");
    reports.confirmations.add(attendanceId, Array.concat(prev, [{ id; attendanceId; orgId; by = p.id; at = Time.now(); ok; remark = why }]));
    let what = exWorkCode(a.workId) # " " # Plan.fmtDay(a.day) # ": " # Reports.duration(a.minutesTotal);
    Access.audit(audit, caller, ?p.id, ?a.workId, if ok "uren-bevestigd" else "uren-betwist", what);
    if (not ok) {
      let to = List.empty<Nat>();
      to.add(r.authorPersonId);
      switch (works.works.get(a.workId)) { case (?w) { switch (w.leaderPersonId) { case (?l) { if (not to.contains(Nat.equal, l)) { to.add(l) } }; case null {} } }; case null {} };
      for (who in to.values()) {
        Access.notify(audit, ctr, who, "uren-betwist", p.name # " betwist de uren van " # what # ": " # why, ?a.workId);
      };
    };
    #ok;
  };

  // Mijn werven (externen): de werven waar ik actief lid ben, met mijn rollen en rechten en de werfleider.
  public query ({ caller }) func myWorks() : async [Views.ExternalWork] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let out = List.empty<Views.ExternalWork>();
    for (w in works.works.values()) {
      if (w.archivedAt == null) {
        let ms = Rights.memberships(ctx, p, w.id).filter(func m = Rights.isExternalRole(m.role));
        if (ms.size() > 0 and Rights.seesWork(ctx, p, w.id)) {
          let leader = switch (w.leaderPersonId) { case (?l) access.persons.get(l); case null null };
          out.add({
            id = w.id;
            code = w.code;
            name = w.name;
            address = w.address;
            status = w.status;
            roles = ms.map<Types.Membership, Types.Role>(func m = m.role);
            grants = ms.flatMap<Types.Membership, Types.Grant>(func m = m.grants.values());
            leaderName = switch leader { case (?q) q.name; case null "" };
            leaderPhone = switch leader { case (?q) q.phone; case null null };
          });
        };
      };
    };
    Array.sort<Views.ExternalWork>(out.toArray(), func(a, b) = Text.compare(a.code, b.code));
  };

  // De rechten van één extern lidmaatschap (architectuur rij 1.7): enkel de grants die bij die rol passen.
  // Wie het team van de werf beheert (admin, werfleider van de werf, R15) zet ze; elke wijziging in de auditlog.
  public shared ({ caller }) func setMemberGrants(membershipId : Nat, grants : [Types.Grant]) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let m = works.memberships.get(membershipId) ?? Runtime.trap("Geen toegang");
    Rights.require({ works; settings }, p, #manageMembers, ?m.workId);
    if (m.endedAt != null) { return #err("Dit lidmaatschap is beëindigd") };
    if (not Rights.isExternalRole(m.role)) { return #err("Enkel externe rollen hebben instelbare rechten") };
    let allowed = Rights.allowedGrants(m.role);
    let clean = List.empty<Types.Grant>();
    for (g in grants.values()) {
      if (not allowed.any(func x = x == g)) { return #err("Dit recht past niet bij de rol " # Rights.roleKey(m.role)) };
      if (not clean.contains(func(a : Types.Grant, b : Types.Grant) : Bool = a == b, g)) { clean.add(g) };
    };
    let next = clean.toArray();
    let m2 : Types.Membership = { id = m.id; workId = m.workId; personId = m.personId; orgId = m.orgId; role = m.role; grants = next; grantedAt = m.grantedAt; grantedBy = m.grantedBy; var endedAt = m.endedAt; var endedBy = m.endedBy };
    works.memberships.add(m.id, m2);
    Access.audit(audit, caller, ?p.id, ?m.workId, "lid-rechten", exWorkCode(m.workId) # " #" # m.id.toText() # " " # Rights.roleKey(m.role) # ": " # exGrantsText(m.grants) # " → " # exGrantsText(next));
    #ok;
  };

  func exWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };

  func exGrantsText(gs : [Types.Grant]) : Text {
    if (gs.size() == 0) { return "geen" };
    Text.join(gs.map<Types.Grant, Text>(Rights.grantKey).values(), ", ");
  };

  func exLine(p : Types.Person, a : Types.Attendance) : Views.HoursLine {
    let w = works.works.get(a.workId);
    let final = switch (reports.reports.get(a.reportId)) { case (?r) not Reports.isDraft(r); case null false };
    let confs = switch (reports.confirmations.get(a.id)) { case (?cs) cs; case null [] };
    {
      attendanceId = a.id;
      reportId = a.reportId;
      workId = a.workId;
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      day = a.day;
      names = a.names;
      headcount = a.headcount;
      slots = a.slots;
      minutesTotal = a.minutesTotal;
      regie = a.regie;
      reportFinal = final;
      confirmations = confs.map<Types.HoursConfirmation, Views.ConfirmationView>(func c = { id = c.id; byName = Access.personName(access, c.by); at = c.at; ok = c.ok; remark = c.remark });
      canConfirm = final and Rights.may({ works; settings }, p, #confirmOwnHours, ?a.workId);
    };
  };
};
