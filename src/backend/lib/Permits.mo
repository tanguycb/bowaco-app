// Vergunningen (stap 1b.1, bouwplan §5.3, architectuur §2.8): soorten, kennisbank per gemeente, de periode en de
// uiterste aanvraagdag uit de planning, waarschuwingen, suggesties uit de taken en de views. Geen rechten hier: wie
// wat mag, beslist lib/Rights.mo; dit bestand rekent alleen. Alles begrensd (T17).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Dossier "Dossier";
import Oa "Oa";
import Plan "Plan";

module {
  type Day = Types.Day;

  // ── Soorten (D9: data, niet code) ────────────────────────────────────────
  func isKindKey(k : Text) : Bool { k.startsWith(#text "permitKind:") };

  public func kindFromLookup(l : Types.Lookup) : Views.PermitKindView {
    let get = func(k : Text, d : Text) : Text {
      switch (l.extra.find(func(x : (Text, Text)) : Bool = x.0 == k)) { case (?(_, v)) v; case null d };
    };
    {
      key = l.key;
      name = l.tag;
      leadDays = Nat.fromText(get("dagen", "14")) ?? 14;
      words = get("woorden", "").split(#char '|').filter(func(w : Text) : Bool = w.size() > 0).toArray();
      publicDomain = get("openbaar", "ja") == "ja";
      order = l.order;
      archived = l.archivedAt != null;
    };
  };

  public func lookupFromKind(k : Views.PermitKindView, archivedAt : ?Int) : Types.Lookup {
    {
      list = "permitKind";
      key = k.key;
      tag = k.name;
      order = k.order;
      var archivedAt = archivedAt;
      extra = [("dagen", k.leadDays.toText()), ("woorden", k.words.values().join("|")), ("openbaar", if (k.publicDomain) "ja" else "nee")];
    };
  };

  public func defaultKinds() : [Views.PermitKindView] {
    var i = 0;
    Config.defaultPermitKinds().map(
      func((key, name, lead, words, pub) : (Text, Text, Nat, [Text], Bool)) : Views.PermitKindView {
        i += 1;
        { key; name; leadDays = lead; words; publicDomain = pub; order = i * 10; archived = false };
      }
    );
  };

  // De geldende lijst: wat de admin instelde, anders de standaardlijst (VOORLOPIG). Gesorteerd.
  public func kinds(s : Types.SettingsState, withArchived : Bool) : [Views.PermitKindView] {
    let own = s.lookups.entries().filter(func((k, _) : (Text, Types.Lookup)) : Bool = isKindKey(k)).map(func((_, l) : (Text, Types.Lookup)) : Views.PermitKindView = kindFromLookup(l)).toArray();
    let all = if (own.size() == 0) defaultKinds() else own;
    all.filter(func k = withArchived or not k.archived).sort(func(a, b) = Nat.compare(a.order, b.order));
  };

  // Zet de standaardlijst in de keuzelijsten, zodat de admin ze daarna kan aanpassen.
  public func materialize(s : Types.SettingsState) {
    if (s.lookups.keys().any(isKindKey)) { return };
    for (k in defaultKinds().values()) { s.lookups.add("permitKind:" # k.key, lookupFromKind(k, null)) };
  };

  public func kind(s : Types.SettingsState, key : Text) : ?Views.PermitKindView {
    kinds(s, true).find(func k = k.key == key);
  };

  public func kindName(s : Types.SettingsState, key : Text) : Text {
    switch (kind(s, key)) { case (?k) k.name; case null key };
  };

  // ── Kennisbank ───────────────────────────────────────────────────────────
  public func procKey(muniId : Nat, kind : Text) : Text { muniId.toText() # ":" # kind };

  public func procedure(ps : Types.PermitState, muniId : ?Nat, kind : Text) : ?Types.PermitProcedure {
    let m = muniId ?? return null;
    switch (ps.procedures.get(procKey(m, kind))) { case (?p) { if (p.archivedAt == null) ?p else null }; case null null };
  };

  // De gemeente van een werfadres: eerst op postcode, anders op de naam van de gemeente.
  public func municipalityFor(ps : Types.PermitState, a : Types.Address) : ?Types.Municipality {
    let zip = a.zip.trim(#char ' ');
    let city = Oa.fold(a.city);
    var byName : ?Types.Municipality = null;
    for (m in ps.municipalities.values()) {
      if (m.archivedAt == null) {
        if (zip.size() > 0 and m.zips.any(func z = z == zip)) { return ?m };
        if (byName == null and city.size() > 0 and Oa.fold(m.name) == city) { byName := ?m };
      };
    };
    byName;
  };

  // Doorlooptijd: de procedure van de gemeente voor deze soort, anders de soort zelf.
  public func defaultLead(s : Types.SettingsState, ps : Types.PermitState, muniId : ?Nat, kindKey : Text) : Nat {
    switch (procedure(ps, muniId, kindKey)) {
      case (?p) p.leadDays;
      case null { switch (kind(s, kindKey)) { case (?k) k.leadDays; case null 14 } };
    };
  };

  // ── Periode, deadline en waarschuwingen ──────────────────────────────────
  // De periode waarin de vergunning nodig is: van de start van de eerste tot het einde van de laatste taak
  // (kalender van de werf), anders de periode die met de hand ingevuld werd.
  public func needed(plan : Types.PlanState, works : Types.WorksState, x : Types.Permit) : (?Day, ?Day) {
    var from : ?Day = null;
    var to : ?Day = null;
    var cal : ?Plan.Cal = null;
    for (id in x.taskIds.values()) {
      switch (plan.tasks.get(id)) {
        case (?t) {
          if (t.archivedAt == null and t.workId == x.workId) {
            let c = switch cal { case (?c) c; case null { let c = Plan.calFor(plan, works, x.workId); cal := ?c; c } };
            let e = Plan.endDay(c, t.start, t.workdays);
            from := ?(switch from { case (?f) Nat.min(f, t.start); case null t.start });
            to := ?(switch to { case (?v) Nat.max(v, e); case null e });
          };
        };
        case null {};
      };
    };
    if (from == null) { (x.neededFrom, switch (x.neededTo) { case (?v) ?v; case null x.neededFrom }) } else { (from, to) };
  };

  public func deadline(neededFrom : ?Day, leadDays : Nat) : ?Day {
    switch neededFrom { case (?f) ?(if (f > leadDays) f - leadDays else 0); case null null };
  };

  public func warnDays(s : Types.SettingsState) : Nat { Dossier.setting(s, "vergunning.dagen", Config.permitWarnDaysDefault) };
  public func expiryDays(s : Types.SettingsState) : Nat { Dossier.setting(s, "vergunning.verloopDagen", Config.permitExpiryDaysDefault) };

  func active(st : Types.PermitStatus) : Bool { st != #cancelled and st != #refused };
  func granted(st : Types.PermitStatus) : Bool { st == #granted or st == #extended or st == #expired };

  // Status zoals getoond: een toegekende vergunning waarvan de geldigheid voorbij is, is verlopen.
  public func effectiveStatus(x : Types.Permit, today : Day) : Types.PermitStatus {
    switch (x.status, x.validTo) {
      case (#granted or #extended, ?to) { if (to < today) #expired else x.status };
      case _ x.status;
    };
  };

  public func warnings(s : Types.SettingsState, x : Types.Permit, from : ?Day, to : ?Day, today : Day) : [Views.PermitWarning] {
    if (x.archivedAt != null or x.status == #cancelled) { return [] };
    var out : [Views.PermitWarning] = [];
    let add = func(w : Views.PermitWarning) { out := out.concat([w]) };
    // Nog nodig na vandaag? Zonder periode: ja (we weten het niet).
    let stillNeeded = switch to { case (?t) t >= today; case null true };
    switch (x.status) {
      case (#needed) {
        switch (deadline(from, x.leadDays)) {
          case (?d) {
            if (stillNeeded) {
              if (today > d) { add(#deadlinePassed(today - d)) } else if (d - today <= warnDays(s)) { add(#deadlineSoon(d - today)) };
            };
          };
          case null add(#noDates);
        };
      };
      case (#requested) { if (from == null) { add(#noDates) } };
      case (#refused) { if (stillNeeded) { add(#refused) } };
      case _ {};
    };
    if (granted(x.status)) {
      if (x.fileIds.size() == 0 and stillNeeded) { add(#noDocument) };
      switch (x.validTo) {
        case (?vt) {
          let neededAfter = switch to { case (?t) t > vt; case null true };
          if (vt < today) { if (neededAfter) { add(#expired) } } else if (vt - today <= expiryDays(s) and neededAfter) { add(#expiresSoon(vt - today)) };
        };
        case null {};
      };
    };
    // Herplanning: de taken vallen (deels) buiten de geldige periode.
    if (active(x.status) and x.status != #needed) {
      switch (from, to, x.validFrom, x.validTo) {
        case (?f, ?t, ?vf, ?vt) { if ((f < vf or t > vt) and t >= today) { add(#outsidePlan({ neededFrom = f; neededTo = t })) } };
        case _ {};
      };
    };
    out;
  };

  // ── Suggesties uit de planning ──────────────────────────────────────────
  // Een taak (niet klaar, niet voorbij) waarvan de titel of de sjabloonstap een woord van een soort bevat, en waarvoor
  // er op die werf nog geen (niet-geannuleerde) vergunning van die soort aan die taak hangt.
  public func suggestions(s : Types.SettingsState, plan : Types.PlanState, works : Types.WorksState, ps : Types.PermitState, workId : Nat, muniId : ?Nat, today : Day) : [Views.PermitSuggestion] {
    let ks = kinds(s, false).filter(func k = k.words.size() > 0);
    if (ks.size() == 0) { return [] };
    let mine = ps.permits.values().filter(func x = x.workId == workId and x.archivedAt == null and x.status != #cancelled).toArray();
    var cal : ?Plan.Cal = null;
    var out : [Views.PermitSuggestion] = [];
    for (t in Plan.tasksOf(plan, workId).values()) {
      if (t.status != #done and out.size() < 50) {
        let text = Oa.fold(t.title) # " " # Oa.fold(t.templateKey ?? "");
        for (k in ks.values()) {
          let hit = k.words.any(func w = text.contains(#text(Oa.fold(w))) and Oa.fold(w).size() > 0);
          let covered = mine.any(func x = x.kind == k.key and x.taskIds.any(func i = i == t.id));
          if (hit and not covered) {
            let c = switch cal { case (?c) c; case null { let c = Plan.calFor(plan, works, workId); cal := ?c; c } };
            let end = Plan.endDay(c, t.start, t.workdays);
            if (end >= today) {
              let lead = defaultLead(s, ps, muniId, k.key);
              out := out.concat([{ taskId = t.id; taskTitle = t.title; start = t.start; end; kind = k.key; kindName = k.name; leadDays = lead; deadline = if (t.start > lead) t.start - lead else 0 }]);
            };
          };
        };
      };
    };
    out;
  };

  // ── Views ────────────────────────────────────────────────────────────────
  public func procedureView(s : Types.SettingsState, access : Types.AccessState, p : Types.PermitProcedure) : Views.PermitProcedureView {
    { municipalityId = p.municipalityId; kind = p.kind; kindName = kindName(s, p.kind); how = p.how; portal = p.portal; email = p.email; leadDays = p.leadDays; cost = p.cost; attachments = p.attachments; contact = p.contact; notes = p.notes; updatedAt = p.updatedAt; updatedByName = Access.personName(access, p.updatedBy) };
  };

  public func municipalityView(s : Types.SettingsState, access : Types.AccessState, ps : Types.PermitState, m : Types.Municipality) : Views.MunicipalityView {
    let prefix = m.id.toText() # ":";
    {
      id = m.id;
      name = m.name;
      zips = m.zips;
      portal = m.portal;
      email = m.email;
      phone = m.phone;
      contact = m.contact;
      notes = m.notes;
      procedures = ps.procedures.entries().filter(func((k, p) : (Text, Types.PermitProcedure)) : Bool = k.startsWith(#text prefix) and p.archivedAt == null).map(func((_, p) : (Text, Types.PermitProcedure)) : Views.PermitProcedureView = procedureView(s, access, p)).toArray();
      permitCount = ps.permits.values().filter(func x = x.municipalityId == ?m.id and x.archivedAt == null).size();
      updatedAt = m.updatedAt;
      updatedByName = Access.personName(access, m.updatedBy);
      archived = m.archivedAt != null;
    };
  };

  public type ViewCtx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    works : Types.WorksState;
    plan : Types.PlanState;
    files : Types.FileState;
    ps : Types.PermitState;
  };

  // internal = kost en notitie zichtbaar; canEdit = knoppen (de backend controleert opnieuw).
  // 1b.5 (L1): een externe (OA, architect, VC) ziet op een vergunning enkel de titels van de taken van zijn eigen firma;
  // de rest van de planning van de werf is intern (R5, zoals getPlan).
  func ownTask(c : ViewCtx, t : Types.Task, org : ?Types.OrgId) : Bool {
    let o = org ?? return false;
    t.responsibleOrgId == ?o or c.plan.assignments.values().any(func a = a.taskId == t.id and a.archivedAt == null and a.orgId == o);
  };

  // `viewerOrg`: de firma van een externe beller (null = kantoor of een externe zonder firma).
  public func view(c : ViewCtx, x : Types.Permit, internal : Bool, viewerOrg : ?Types.OrgId, canEdit : Bool, today : Day) : Views.PermitView {
    let (from, to) = needed(c.plan, c.works, x);
    let w = c.works.works.get(x.workId);
    {
      id = x.id;
      workId = x.workId;
      workCode = switch w { case (?w) w.code; case null "" };
      workName = switch w { case (?w) w.name; case null "" };
      kind = x.kind;
      kindName = kindName(c.settings, x.kind);
      title = x.title;
      municipalityId = x.municipalityId;
      municipalityName = switch (x.municipalityId) { case (?m) { switch (c.ps.municipalities.get(m)) { case (?mm) mm.name; case null "" } }; case null "" };
      status = effectiveStatus(x, today);
      location = x.location;
      taskIds = x.taskIds;
      taskTitles = x.taskIds.filterMap(func(id : Nat) : ?Text { switch (c.plan.tasks.get(id)) { case (?t) { if (t.archivedAt == null and (internal or ownTask(c, t, viewerOrg))) ?t.title else null }; case null null } });
      neededFrom = from;
      neededTo = to;
      manualFrom = x.neededFrom;
      manualTo = x.neededTo;
      leadDays = x.leadDays;
      deadline = deadline(from, x.leadDays);
      requestedOn = x.requestedOn;
      validFrom = x.validFrom;
      validTo = x.validTo;
      reference = x.reference;
      costCents = if internal x.costCents else null;
      note = if internal x.note else "";
      files = x.fileIds.filterMap(func(id : Nat) : ?Views.FileView { switch (c.files.files.get(id)) { case (?f) { if (f.archivedAt == null) ?Dossier.fileView(f) else null }; case null null } });
      warnings = warnings(c.settings, x, from, to, today);
      updatedAt = x.updatedAt;
      updatedByName = Access.personName(c.access, x.updatedBy);
      canEdit;
    };
  };

  public func statusWord(st : Types.PermitStatus) : Text {
    switch st {
      case (#needed) "nodig";
      case (#requested) "aangevraagd";
      case (#granted) "toegekend";
      case (#refused) "geweigerd";
      case (#expired) "verlopen";
      case (#extended) "verlengd";
      case (#cancelled) "geannuleerd";
    };
  };

  public func optDay(d : ?Day) : Text { switch d { case (?x) Plan.fmtDay(x); case null "–" } };

  // Wat er veranderde, per veld (oud → nieuw); bedragen en notities enkel als naam (intern, maar niet in de log).
  public func changes(s : Types.SettingsState, old : Types.Permit, n : Types.Permit) : [(Text, Text, Text)] {
    var out : [(Text, Text, Text)] = [];
    let add = func(f : Text, a : Text, b : Text) { if (a != b) { out := out.concat([(f, a, b)]) } };
    add("soort", kindName(s, old.kind), kindName(s, n.kind));
    add("titel", old.title, n.title);
    add("status", statusWord(old.status), statusWord(n.status));
    add("plaats", old.location, n.location);
    add("taken", debug_show old.taskIds, debug_show n.taskIds);
    add("nodig van", optDay(old.neededFrom), optDay(n.neededFrom));
    add("nodig tot", optDay(old.neededTo), optDay(n.neededTo));
    add("doorlooptijd", old.leadDays.toText(), n.leadDays.toText());
    add("aangevraagd op", optDay(old.requestedOn), optDay(n.requestedOn));
    add("geldig van", optDay(old.validFrom), optDay(n.validFrom));
    add("geldig tot", optDay(old.validTo), optDay(n.validTo));
    add("referentie", old.reference, n.reference);
    add("gemeente", debug_show old.municipalityId, debug_show n.municipalityId);
    if (old.costCents != n.costCents) { out := out.concat([("kost", "", "gewijzigd")]) };
    if (old.note != n.note) { out := out.concat([("notitie", "", "gewijzigd")]) };
    add("bestanden", old.fileIds.size().toText(), n.fileIds.size().toText());
    out;
  };

  public func warningText(w : Views.PermitWarning) : Text {
    switch w {
      case (#deadlineSoon d) { if (d == 0) "vandaag aanvragen" else "aanvragen binnen " # Int.abs(d).toText() # " dagen" };
      case (#deadlinePassed d) "aanvraag " # Int.abs(d).toText() # " dagen te laat";
      case (#noDates) "geen periode: koppel een taak of vul de periode in";
      case (#refused) "geweigerd, nog nodig";
      case (#noDocument) "de vergunning zelf ontbreekt (bewijs bij controle)";
      case (#expiresSoon d) "verloopt binnen " # Int.abs(d).toText() # " dagen, nog nodig daarna";
      case (#expired) "verlopen, nog nodig";
      case (#outsidePlan p) "planning schoof: nodig " # Plan.fmtDay(p.neededFrom) # " – " # Plan.fmtDay(p.neededTo);
    };
  };

  // Sleutel voor "één keer melden": soort van waarschuwing + de dag waarop ze slaat. Wordt de deadline of de periode
  // verlegd, dan is het een nieuwe melding.
  public func alertKey(x : Types.Permit, w : Views.PermitWarning, from : ?Day, _to : ?Day) : ?Text {
    let base = "p" # x.id.toText() # ":";
    switch w {
      case (#deadlineSoon _) ?(base # "binnenkort:" # debug_show (deadline(from, x.leadDays)));
      case (#deadlinePassed _) ?(base # "te-laat:" # debug_show (deadline(from, x.leadDays)));
      case (#refused) ?(base # "geweigerd");
      case (#expiresSoon _) ?(base # "verloopt:" # debug_show (x.validTo));
      case (#expired) ?(base # "verlopen:" # debug_show (x.validTo));
      case (#outsidePlan p) ?(base # "planning:" # p.neededFrom.toText() # "-" # p.neededTo.toText() # ":" # debug_show (x.validFrom, x.validTo));
      case (#noDates or #noDocument) null; // enkel op het scherm, geen melding
    };
  };

  // Dagen in een redelijk bereik (zoals de planning): niets vóór 2019 of na 2079.
  public func dayOk(d : ?Day) : Bool {
    switch d { case (?x) x >= Config.minDay and x <= Config.maxDay; case null true };
  };

  public func uniq(xs : [Nat]) : [Nat] {
    var out : [Nat] = [];
    for (x in xs.values()) { if (not out.any(func y = y == x)) { out := out.concat([x]) } };
    out;
  };

  // ── Meldingen (timer, main.mo: hoogstens eens per uur) ─────────────────
  // Elke waarschuwing van een vergunning en elke suggestie uit de planning waarvan de uiterste aanvraagdag nadert,
  // wordt één keer gemeld (hoogstens Config.permitAlertsPerScan per ronde; de rest volgt de volgende ronde) (sleutel in ps.alerts) aan de werfleider van de werf, of aan de admins als er geen is.
  // Enkel werven die gepland of bezig zijn. Begrensd: Config.permitScanMax vergunningen per ronde.
  public type ScanCtx = {
    settings : Types.SettingsState;
    access : Types.AccessState;
    works : Types.WorksState;
    plan : Types.PlanState;
    ps : Types.PermitState;
    audit : Types.AuditState;
    ctr : Types.Counters;
  };

  func tell(c : ScanCtx, w : Types.Work, text : Text) {
    let leader = switch (w.leaderPersonId) {
      case (?id) { switch (c.access.persons.get(id)) { case (?q) { if (q.archivedAt == null and Access.hasActiveLink(c.access, q.id)) ?q.id else null }; case null null } };
      case null null;
    };
    switch leader {
      case (?id) Access.notify(c.audit, c.ctr, id, "vergunning", text, ?w.id);
      case null { for (id in Access.activeAdminIds(c.access).values()) { Access.notify(c.audit, c.ctr, id, "vergunning", text, ?w.id) } };
    };
  };

  func liveWork(w : Types.Work) : Bool { w.archivedAt == null and (w.status == #planned or w.status == #running) };

  // Geeft het aantal nieuwe meldingen terug (voor de tests).
  public func scan(c : ScanCtx) : Nat {
    let now = Time.now();
    let today = Dossier.today();
    var sent = 0;
    var n = 0;
    label permitsLoop for (x in c.ps.permits.values()) {
      if (n >= Config.permitScanMax) { break permitsLoop };
      if (x.archivedAt == null and x.status != #cancelled) {
        n += 1;
        switch (c.works.works.get(x.workId)) {
          case (?w) {
            if (liveWork(w)) {
              let (from, to) = needed(c.plan, c.works, x);
              for (wa in warnings(c.settings, x, from, to, today).values()) {
                switch (alertKey(x, wa, from, to)) {
                  case (?k) {
                    if (not c.ps.alerts.containsKey(k) and sent < Config.permitAlertsPerScan) {
                      c.ps.alerts.add(k, now);
                      tell(c, w, w.code # " · " # kindName(c.settings, x.kind) # ": " # warningText(wa));
                      sent += 1;
                    };
                  };
                  case null {};
                };
              };
            };
          };
          case null {};
        };
      };
    };
    // Uit de planning: een taak die een vergunning vraagt en waarvan de uiterste aanvraagdag nadert of voorbij is.
    let soon = today + warnDays(c.settings);
    for (w in c.works.works.values()) {
      if (liveWork(w)) {
        let muni = switch (municipalityFor(c.ps, w.address)) { case (?m) ?m.id; case null null };
        for (sg in suggestions(c.settings, c.plan, c.works, c.ps, w.id, muni, today).values()) {
          // Enkel taken die nog niet begonnen zijn: een lopende taak heeft haar vergunning (of niet) al buiten de app.
          if (sg.deadline <= soon and sg.start > today) {
            let k = "s" # sg.taskId.toText() # ":" # sg.kind # ":" # sg.deadline.toText();
            if (not c.ps.alerts.containsKey(k) and sent < Config.permitAlertsPerScan) {
              c.ps.alerts.add(k, now);
              tell(c, w, w.code # " · " # sg.taskTitle # ": vergunning nodig (" # sg.kindName # "), aanvragen " # (if (sg.deadline < today) "was uiterlijk " else "uiterlijk ") # Plan.fmtDay(sg.deadline));
              sent += 1;
            };
          };
        };
      };
    };
    sent;
  };
};
