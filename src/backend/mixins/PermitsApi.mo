// Vergunningenregister (stap 1b.1, bouwplan §5.3, architectuur §2.8, R13): vergunningen per werf met de periode en
// de uiterste aanvraagdag uit de planning, de vergunning zelf als bestand (bewijs bij controle, ook op de gsm), de
// kennisbank per gemeente (procedure, portaal of e-mail, doorlooptijd, kost, bijlagen, contact) en de soorten.
// Rechten: lezen per werf #readPermits (intern + architect, OA, VC als lid; nooit de klant), wijzigen #editPermits
// (admin, werfleider van de werf); de kennisbank is intern. Kost en notitie zien enkel interne rollen.
// Meldingen (deadline, verloopt, planning schoof) maakt de timer (Permits.scan via main.mo), één keer per ding.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
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
import Oa "../lib/Oa";
import Permits "../lib/Permits";
import Plan "../lib/Plan";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  permits : Types.PermitState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  func pmCtx() : Permits.ViewCtx { { settings; access; works; plan; files; ps = permits } };

  func pmView(p : Types.Person, x : Types.Permit) : Views.PermitView {
    let ctx = { works; settings };
    Permits.view(pmCtx(), x, Rights.internal(p), p.orgId, Rights.may(ctx, p, #editPermits, ?x.workId), Dossier.today());
  };

  // ── Soorten (D9) ─────────────────────────────────────────────────────────
  public query ({ caller }) func listPermitKinds(withArchived : Bool) : async [Views.PermitKindView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readMunicipalities, null);
    Permits.kinds(settings, withArchived);
  };

  public shared ({ caller }) func setPermitKind(k : Views.PermitKindView) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #managePermitKinds, null);
    let key = Access.cleanText(Text.toLower(k.key), Config.maxShort) ?? return #err("Sleutel: 1 tot 20 tekens");
    if (not key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) { return #err("Sleutel: enkel a-z, 0-9 en -") };
    let name = Access.cleanText(k.name, Config.maxLabel) ?? return #err("Naam ontbreekt of te lang");
    if (k.leadDays > Config.maxLeadDays) { return #err("Doorlooptijd te lang") };
    if (k.words.size() > Config.maxPermitWords) { return #err("Te veel woorden") };
    var words : [Text] = [];
    for (w in k.words.values()) {
      let x = Access.cleanText(Text.toLower(w), Config.maxLabel) ?? return #err("Een woord is leeg of te lang");
      if (x.contains(#char '|')) { return #err("Een woord mag geen | bevatten") };
      words := words.concat([x]);
    };
    Permits.materialize(settings);
    let isNew = not settings.lookups.containsKey("permitKind:" # key);
    if (isNew and Permits.kinds(settings, true).size() >= Config.maxPermitKinds) { return #err("Te veel soorten") };
    settings.lookups.add("permitKind:" # key, Permits.lookupFromKind({ k with key; name; words }, if (k.archived) ?Time.now() else null));
    Access.audit(audit, caller, ?p.id, null, "vergunningssoort", key # (if isNew " nieuw" else " gewijzigd") # (if (k.archived) " (gearchiveerd)" else ""));
    #ok;
  };

  public query ({ caller }) func permitRules() : async { warnDays : Nat; expiryDays : Nat } {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readMunicipalities, null);
    { warnDays = Permits.warnDays(settings); expiryDays = Permits.expiryDays(settings) };
  };

  public shared ({ caller }) func setPermitRules(r : { warnDays : Nat; expiryDays : Nat }) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #managePermitKinds, null);
    if (r.warnDays == 0 or r.warnDays > 60 or r.expiryDays == 0 or r.expiryDays > 60) { return #err("Kies 1 tot 60 dagen") };
    settings.values.add("vergunning.dagen", r.warnDays.toText());
    settings.values.add("vergunning.verloopDagen", r.expiryDays.toText());
    Access.audit(audit, caller, ?p.id, null, "vergunning-regels", "waarschuwen " # r.warnDays.toText() # " d, verloopt " # r.expiryDays.toText() # " d");
    #ok;
  };

  // De ronde van de timer meteen (admin; voor de proeven en na het aanvullen van de kennisbank). Idempotent: wat al
  // gemeld werd, wordt niet opnieuw gemeld. Geeft het aantal nieuwe meldingen.
  public shared ({ caller }) func scanPermits() : async Nat {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #managePermitKinds, null);
    let n = Permits.scan({ settings; access; works; plan; ps = permits; audit; ctr });
    Access.audit(audit, caller, ?p.id, null, "vergunningen-nagekeken", n.toText() # " meldingen");
    n;
  };

  // ── Per werf ─────────────────────────────────────────────────────────────
  public query ({ caller }) func workPermits(workId : Nat) : async Views.WorkPermitsView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readPermits, ?workId);
    let w = works.works.get(workId) ?? Runtime.trap("Geen toegang");
    let canEdit = Rights.may(ctx, p, #editPermits, ?workId);
    let muni = Permits.municipalityFor(permits, w.address);
    let list = permits.permits.values().filter(func x = x.workId == workId and x.archivedAt == null).map(func x = pmView(p, x)).toArray();
    {
      workId;
      permits = list;
      suggestions = if canEdit Permits.suggestions(settings, plan, works, permits, workId, switch muni { case (?m) ?m.id; case null null }, Dossier.today()) else [];
      municipality = if (Rights.may(ctx, p, #readMunicipalities, null)) { switch muni { case (?m) ?Permits.municipalityView(settings, access, permits, m); case null null } } else null;
      kinds = Permits.kinds(settings, false);
      canEdit;
    };
  };

  public shared ({ caller }) func savePermit(workId : Nat, x : Views.PermitInput) : async Result.Result<Views.PermitView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editPermits, ?workId);
    let old : ?Types.Permit = switch (x.id) {
      case (?id) {
        let o = permits.permits.get(id) ?? return #err("Geen toegang");
        // L4 (1.9): onbekend of van een andere werf = dezelfde weigering (geen id-orakel).
        if (o.workId != workId) { return #err("Geen toegang") };
        if (o.archivedAt != null) { return #err("Deze vergunning is gearchiveerd") };
        ?o;
      };
      case null null;
    };
    let k = Permits.kind(settings, x.kind) ?? return #err("Onbekende soort vergunning");
    if (k.archived and (switch old { case (?o) o.kind != x.kind; case null true })) { return #err("Deze soort is gearchiveerd") };
    let title = switch (Access.cleanText(x.title, Config.maxName)) { case (?t) t; case null { if (x.title.trim(#char ' ').size() > 0) return #err("Titel te lang") else k.name } };
    if (x.location.size() > Config.maxName * 2) { return #err("Plaats te lang") };
    if (x.reference.size() > Config.maxName) { return #err("Referentie te lang") };
    if (x.note.size() > Config.maxNote) { return #err("Notitie te lang") };
    if (x.taskIds.size() > Config.maxPermitTasks) { return #err("Te veel taken") };
    for (d in [x.neededFrom, x.neededTo, x.requestedOn, x.validFrom, x.validTo].values()) { if (not Permits.dayOk(d)) { return #err("Onmogelijke datum") } };
    switch (x.neededFrom, x.neededTo) { case (?a, ?b) { if (b < a) { return #err("De periode eindigt vóór ze begint") } }; case _ {} };
    switch (x.validFrom, x.validTo) { case (?a, ?b) { if (b < a) { return #err("Geldig tot ligt vóór geldig van") } }; case _ {} };
    switch (x.costCents) { case (?c) { if (c < 0 or c > Config.maxAmountCents) { return #err("Kost klopt niet") } }; case null {} };
    // Taken: van deze werf en niet gearchiveerd.
    let taskIds = Permits.uniq(x.taskIds);
    for (t in taskIds.values()) {
      switch (plan.tasks.get(t)) { case (?task) { if (task.workId != workId or task.archivedAt != null) { return #err("Een taak hoort niet bij deze werf") } }; case null return #err("Onbekende taak") };
    };
    switch (x.municipalityId) {
      case (?m) { switch (permits.municipalities.get(m)) { case (?mm) { if (mm.archivedAt != null and (switch old { case (?o) o.municipalityId != ?m; case null true })) { return #err("Deze gemeente is gearchiveerd") } }; case null return #err("Onbekende gemeente") } };
      case null {};
    };
    let w = works.works.get(workId) ?? return #err("Geen toegang");
    let muniId = switch (x.municipalityId) { case (?m) ?m; case null { switch (Permits.municipalityFor(permits, w.address)) { case (?m) ?m.id; case null null } } };
    let lead = switch (x.leadDays) { case (?d) { if (d > Config.maxLeadDays) return #err("Doorlooptijd te lang"); d }; case null Permits.defaultLead(settings, permits, muniId, k.key) };
    if (old == null and permits.permits.values().filter(func y = y.workId == workId and y.archivedAt == null).size() >= Config.maxPermitsPerWork) { return #err("Te veel vergunningen op deze werf") };
    // Status #expired wordt berekend, nooit bewaard: wie "verlopen" kiest, bewaart "toegekend".
    let status : Types.PermitStatus = if (x.status == #expired) #granted else x.status;
    let now = Time.now();
    let id = switch old { case (?o) o.id; case null Ids.next(ctr, "permit") };
    let n : Types.Permit = {
      id;
      workId;
      kind = k.key;
      title;
      municipalityId = muniId;
      status;
      location = x.location.trim(#char ' ');
      taskIds;
      neededFrom = x.neededFrom;
      neededTo = x.neededTo;
      leadDays = lead;
      requestedOn = switch (x.requestedOn, status) { case (null, #requested) ?Dossier.today(); case (r, _) r };
      validFrom = x.validFrom;
      validTo = x.validTo;
      reference = x.reference.trim(#char ' ');
      costCents = x.costCents;
      fileIds = switch old { case (?o) o.fileIds; case null [] };
      note = x.note;
      createdAt = switch old { case (?o) o.createdAt; case null now };
      createdBy = switch old { case (?o) o.createdBy; case null p.id };
      updatedAt = now;
      updatedBy = p.id;
      archivedAt = null;
      extra = switch old { case (?o) o.extra; case null [] };
    };
    permits.permits.add(id, n);
    switch old {
      case (?o) {
        let ch = Permits.changes(settings, o, n);
        for ((f, a, b) in ch.values()) { pmChange(n, p.id, f, a, b) };
        Access.audit(audit, caller, ?p.id, ?workId, "vergunning-gewijzigd", "#" # id.toText() # " " # ch.map(func((f, _, _) : (Text, Text, Text)) : Text = f).values().join(", "));
      };
      case null {
        pmChange(n, p.id, "nieuw", "", Permits.statusWord(status));
        Access.audit(audit, caller, ?p.id, ?workId, "vergunning-nieuw", "#" # id.toText() # " " # k.key # " " # Permits.statusWord(status));
      };
    };
    #ok(pmView(p, n));
  };

  func pmChange(x : Types.Permit, by : Nat, field : Text, from : Text, to : Text) {
    let id = Ids.next(ctr, "permitChange");
    permits.changes.add(id, { id; permitId = x.id; workId = x.workId; at = Time.now(); by; field; from; to });
  };

  // De vergunning zelf (PDF of foto) aan het record hangen: eerst opladen met addFile (zelfde werf), dan dit.
  public shared ({ caller }) func attachPermitFile(permitId : Nat, fileId : Nat) : async Result.Result<Views.PermitView, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let x = permits.permits.get(permitId) ?? return #err("Geen toegang");
    Rights.require(ctx, p, #editPermits, ?x.workId);
    if (x.archivedAt != null) { return #err("Deze vergunning is gearchiveerd") };
    let f = files.files.get(fileId) ?? return #err("Onbekend bestand");
    if (f.workId != ?x.workId or f.archivedAt != null) { return #err("Het bestand hoort niet bij deze werf") };
    if (f.confidential) { return #err("Een vergunning is geen vertrouwelijk bestand") };
    if (x.fileIds.any(func i = i == fileId)) { return #ok(pmView(p, x)) };
    if (x.fileIds.size() >= Config.maxPermitFiles) { return #err("Te veel bestanden") };
    // Een bestand hoort bij één vergunning.
    if (permits.permits.values().any(func y = y.fileIds.any(func i = i == fileId))) { return #err("Dit bestand hoort al bij een andere vergunning") };
    let n = { x with fileIds = x.fileIds.concat([fileId]); updatedAt = Time.now(); updatedBy = p.id };
    permits.permits.add(permitId, n);
    pmChange(n, p.id, "bestand", "", f.name);
    Access.audit(audit, caller, ?p.id, ?x.workId, "vergunning-bestand", "#" # permitId.toText() # " " # f.name);
    #ok(pmView(p, n));
  };

  public shared ({ caller }) func archivePermit(permitId : Nat, reason : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = permits.permits.get(permitId) ?? return #err("Geen toegang");
    Rights.require({ works; settings }, p, #editPermits, ?x.workId);
    if (x.archivedAt != null) { return #err("Al gearchiveerd") };
    if (reason.size() > Config.maxNote) { return #err("Reden te lang") };
    let n = { x with archivedAt = ?Time.now(); updatedAt = Time.now(); updatedBy = p.id };
    permits.permits.add(permitId, n);
    pmChange(n, p.id, "gearchiveerd", "", reason);
    Access.audit(audit, caller, ?p.id, ?x.workId, "vergunning-gearchiveerd", "#" # permitId.toText());
    #ok;
  };

  public query ({ caller }) func permitHistory(permitId : Nat) : async [Views.PermitChangeView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let x = permits.permits.get(permitId) ?? Runtime.trap("Geen toegang");
    Rights.require(ctx, p, #readPermits, ?x.workId);
    if (not Rights.internal(p)) { return [] };
    permits.changes.reverseEntries().filter(func((_, c) : (Nat, Types.PermitChange)) : Bool = c.permitId == permitId).take(200).map(func((_, c) : (Nat, Types.PermitChange)) : Views.PermitChangeView = { at = c.at; byName = Access.personName(access, c.by); field = c.field; from = c.from; to = c.to }).toArray();
  };

  // ── Over alle werven (kantoor, gsm) ─────────────────────────────────────
  // filter: "aandacht" = met waarschuwing · "lopend" = niet geannuleerd en nog nodig of geldig · "alles".
  public query ({ caller }) func listPermits(filter : Text, workId : ?Nat) : async [Views.PermitView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #permitsOverview, null);
    let today = Dossier.today();
    let out = permits.permits.values().filter(
      func x = x.archivedAt == null and (switch workId { case (?w) x.workId == w; case null true }) and Rights.may(ctx, p, #readPermits, ?x.workId)
    ).map(func x = pmView(p, x)).filter(
      func v = switch filter {
        case "aandacht" v.warnings.size() > 0;
        case "lopend" v.status != #cancelled and v.status != #refused and (switch (v.neededTo, v.validTo) { case (?a, _) a >= today; case (null, ?b) b >= today; case _ true });
        case _ true;
      }
    ).take(Config.maxListPage).toArray();
    // Eerst wat aandacht vraagt, dan op uiterste aanvraagdag of begin.
    out.sort(func(a, b) : Order.Order {
      let wa = a.warnings.size() > 0;
      let wb = b.warnings.size() > 0;
      if (wa != wb) { return if wa #less else #greater };
      let ka = switch (a.deadline, a.neededFrom) { case (?d, _) d; case (null, ?f) f; case _ Config.maxDay };
      let kb = switch (b.deadline, b.neededFrom) { case (?d, _) d; case (null, ?f) f; case _ Config.maxDay };
      if (ka != kb) Nat.compare(ka, kb) else Nat.compare(a.id, b.id);
    });
  };

  // De vergunning op de gsm: alles wat op deze dag geldig of nodig is, op de werven die de beller ziet.
  public query ({ caller }) func permitsOnSite(day : Nat) : async [Views.PermitView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #permitsOverview, null);
    if (day < Config.minDay or day > Config.maxDay) { return [] };
    permits.permits.values().filter(
      func x = x.archivedAt == null and x.status != #cancelled and Rights.may(ctx, p, #readPermits, ?x.workId)
    ).map(func x = pmView(p, x)).filter(
      func v {
        let valid = switch (v.validFrom, v.validTo) { case (?a, ?b) day >= a and day <= b; case (null, ?b) day <= b; case _ false };
        let need = switch (v.neededFrom, v.neededTo) { case (?a, ?b) day >= a and day <= b; case _ false };
        valid or need;
      }
    ).take(100).toArray();
  };

  // ── Kennisbank per gemeente ──────────────────────────────────────────────
  public query ({ caller }) func listMunicipalities(withArchived : Bool) : async [Views.MunicipalityView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readMunicipalities, null);
    let xs = permits.municipalities.values().filter(func m = withArchived or m.archivedAt == null).map(func m = Permits.municipalityView(settings, access, permits, m)).toArray();
    xs.sort(func(a, b) = Text.compare(Oa.fold(a.name), Oa.fold(b.name)));
  };

  public shared ({ caller }) func saveMunicipality(m : Views.MunicipalityInput) : async Result.Result<Views.MunicipalityView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageMunicipalities, null);
    let name = Access.cleanText(m.name, Config.maxName) ?? return #err("Naam ontbreekt of te lang");
    if (m.zips.size() > Config.maxZips) { return #err("Te veel postcodes") };
    var zips : [Text] = [];
    for (z in m.zips.values()) {
      let x = Access.cleanText(z, 10) ?? return #err("Postcode klopt niet");
      if (not x.chars().all(func c = c >= '0' and c <= '9')) { return #err("Postcode: enkel cijfers") };
      if (not zips.any(func y = y == x)) { zips := zips.concat([x]) };
    };
    if ((m.portal ?? "").size() > Config.maxUrl) { return #err("Adres van het portaal te lang") };
    let email = switch (Oa.normEmail(m.email)) { case (#ok e) e; case (#err e) return #err(e) };
    if ((m.phone ?? "").size() > 30 or m.contact.size() > Config.maxName * 2 or m.notes.size() > Config.maxText) { return #err("Een veld is te lang") };
    let folded = Oa.fold(name);
    let clash = permits.municipalities.values().find(func x = x.archivedAt == null and Oa.fold(x.name) == folded and ?x.id != m.id);
    if (clash != null) { return #err("Deze gemeente staat er al in") };
    let now = Time.now();
    let old : ?Types.Municipality = switch (m.id) { case (?id) { switch (permits.municipalities.get(id)) { case (?o) ?o; case null return #err("Onbekende gemeente") } }; case null null };
    if (old == null and permits.municipalities.size() >= Config.maxMunicipalities) { return #err("Te veel gemeenten") };
    let id = switch old { case (?o) o.id; case null Ids.next(ctr, "municipality") };
    let n : Types.Municipality = {
      id;
      name;
      zips;
      portal = Access.optText(m.portal, Config.maxUrl);
      email;
      phone = Access.optText(m.phone, 30);
      contact = m.contact.trim(#char ' ');
      notes = m.notes;
      createdAt = switch old { case (?o) o.createdAt; case null now };
      createdBy = switch old { case (?o) o.createdBy; case null p.id };
      updatedAt = now;
      updatedBy = p.id;
      archivedAt = if (m.archived) (switch old { case (?o) { switch (o.archivedAt) { case (?a) ?a; case null ?now } }; case null ?now }) else null;
      extra = switch old { case (?o) o.extra; case null [] };
    };
    permits.municipalities.add(id, n);
    Access.audit(audit, caller, ?p.id, null, if (old == null) "gemeente-nieuw" else "gemeente-gewijzigd", name);
    #ok(Permits.municipalityView(settings, access, permits, n));
  };

  public shared ({ caller }) func saveProcedure(x : Views.ProcedureInput) : async Result.Result<Views.MunicipalityView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageMunicipalities, null);
    let m = permits.municipalities.get(x.municipalityId) ?? return #err("Onbekende gemeente");
    if (m.archivedAt != null) { return #err("Deze gemeente is gearchiveerd") };
    let k = Permits.kind(settings, x.kind) ?? return #err("Onbekende soort vergunning");
    if (x.how != "portaal" and x.how != "e-mail" and x.how != "loket" and x.how != "andere") { return #err("Kies portaal, e-mail, loket of andere") };
    if (x.leadDays > Config.maxLeadDays) { return #err("Doorlooptijd te lang") };
    if ((x.portal ?? "").size() > Config.maxUrl) { return #err("Adres van het portaal te lang") };
    let email = switch (Oa.normEmail(x.email)) { case (#ok e) e; case (#err e) return #err(e) };
    if (x.cost.size() > Config.maxLabel * 2 or x.contact.size() > Config.maxName * 2 or x.notes.size() > Config.maxText) { return #err("Een veld is te lang") };
    if (x.attachments.size() > Config.maxAttachments) { return #err("Te veel bijlagen") };
    var att : [Text] = [];
    for (a in x.attachments.values()) { att := att.concat([Access.cleanText(a, Config.maxName) ?? return #err("Een bijlage is leeg of te lang")]) };
    let key = Permits.procKey(m.id, k.key);
    let now = Time.now();
    let existed = permits.procedures.get(key);
    permits.procedures.add(key, {
      municipalityId = m.id;
      kind = k.key;
      how = x.how;
      portal = Access.optText(x.portal, Config.maxUrl);
      email;
      leadDays = x.leadDays;
      cost = x.cost.trim(#char ' ');
      attachments = att;
      contact = x.contact.trim(#char ' ');
      notes = x.notes;
      updatedAt = now;
      updatedBy = p.id;
      archivedAt = if (x.archived) ?now else null;
      extra = switch existed { case (?o) o.extra; case null [] };
    });
    Access.audit(audit, caller, ?p.id, null, "gemeente-procedure", m.name # " · " # k.key # (if (x.archived) " (weg)" else ""));
    #ok(Permits.municipalityView(settings, access, permits, m));
  };
};
