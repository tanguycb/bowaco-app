// Import van de bestaande planning (stap 1.5, architectuur §1.1 en rij 1.5 van §11, B8 van §12).
// Het script tools/plan-import.mjs leest de Excel (de kolom is de weekas) en stuurt één werfblok per oproep.
// Hier gebeurt het eigenlijke werk, in één oproep per blok (alles of niets per blok):
//  - een naam wordt enkel gekoppeld via de aliassen uit de OA-database (1.2); wat niet matcht, komt in het
//    rapport en wordt NOOIT een nieuwe firma;
//  - blok → nieuwe werf, vervolg van een werf (taken erbij) of deelwerf (parentId);
//  - elke werf, taak, uitvoerder (weekreeks) en afspraak heeft een vaste importsleutel: dezelfde Excel nog
//    eens importeren maakt geen dubbels;
//  - de proefronde (dryRun) schrijft niets en geeft dezelfde tellingen;
//  - een batch kan als geheel teruggedraaid worden (archiveren, nooit wissen).
// Rechten (Rights.mo): enkel de admin (#importPlan, R32). Wat er geschreven wordt, heeft dezelfde vorm als
// wat createWork, saveTask en saveAssignment schrijven (TaskChange per taak, auditregel, planversie).
import Array "mo:core/Array";
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
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Oa "../lib/Oa";
import Plan "../lib/Plan";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  imp : Types.ImportState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Lezen (admin) ───────────────────────────────────────────────────────
  public query ({ caller }) func listImportBatches() : async [Types.ImportBatch] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #importPlan, null);
    imp.batches.values().toArray();
  };

  // De afspraken uit de planning van één werf (interne rollen die de werf zien).
  public query ({ caller }) func listAppointments(workId : Nat) : async [Types.Appointment] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readAppointments, ?workId);
    imp.appointments.values().filter(func a = a.workId == workId and a.archivedAt == null).toArray();
  };

  // ── Importeren: één blok per oproep ─────────────────────────────────────
  // knownBlocks: blokken die eerder in dezelfde proefronde aan bod kwamen (er is niets bewaard, maar een
  // vervolg of deelwerf mag ernaar verwijzen).
  public shared ({ caller }) func importPlanning(dryRun : Bool, batchId : Text, title : Text, knownBlocks : [Text], block : Views.ImportBlock) : async Result.Result<Views.PlanImportReport, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #importPlan, null);
    let bid = Access.cleanText(batchId, Config.maxLabel) ?? return #err("Batch: 1 tot " # Config.maxLabel.toText() # " tekens");
    let lbl = Access.cleanText(title, Config.maxLabel) ?? return #err("Naam van de batch: 1 tot " # Config.maxLabel.toText() # " tekens");
    switch (imp.batches.get(bid)) {
      case (?b) { if (b.rolledBackAt != null) { return #err("Deze batch is teruggedraaid: kies een nieuwe naam") } };
      case null {};
    };
    switch (inputError(block)) { case (?e) return #err(e); case null {} };

    let now = Time.now();
    let byName = orgIndex();
    let unmatched = Map.empty<Text, Nat>();
    let problems = List.empty<Text>();
    var r = {
      workCreated = 0;
      workExisting = 0;
      tasksCreated = 0;
      tasksExisting = 0;
      assignmentsCreated = 0;
      assignmentsExisting = 0;
      appointmentsCreated = 0;
      appointmentsExisting = 0;
    };
    func miss(name : Text) {
      let n = Text.toUpper(Text.trim(name, #char ' '));
      unmatched.add(n, (unmatched.get(n) ?? 0) + 1);
    };

    // 1. De werf van dit blok
    let blockKey = "w:" # block.key;
    var workId : ?Nat = null;
    var workCode = "";
    switch (imp.keys.get(blockKey)) {
      case (?k) {
        workId := ?k.entityId;
        workCode := codeOf(k.entityId);
        r := { r with workExisting = 1 };
      };
      case null {
        // Doel van een vervolg of deelwerf: een blok uit deze of een eerdere import, of een werfcode.
        let target : ?(?Nat) = switch (block.decision) {
          case (#fresh) null;
          case (#followUp t) ?(resolveTarget(t, knownBlocks) ?? return #err("Vervolg: «" # t # "» is geen werf of eerder blok"));
          case (#sub t) ?(resolveTarget(t, knownBlocks) ?? return #err("Deelwerf: «" # t # "» is geen werf of eerder blok"));
        };
        switch (block.decision, target) {
          case (#followUp _, ?(?id)) {
            // Taken komen in de bestaande werf; dit blok krijgt enkel een koppeling.
            workId := ?id;
            workCode := codeOf(id);
            r := { r with workExisting = 1 };
            if (not dryRun) { imp.keys.add(blockKey, { key = blockKey; kind = #link; entityId = id; batchId = bid }) };
          };
          case (#followUp _, ?null) {
            // Doelblok zit in dezelfde proefronde en bestaat nog niet.
            workCode := "(vervolg)";
            r := { r with workExisting = 1 };
          };
          case (_, _) {
            let parent : ?Nat = switch (block.decision, target) { case (#sub _, ?x) x; case _ null };
            switch (block.decision, target) {
              case (#sub _, ?(?pid)) {
                let pw = works.works.get(pid) ?? return #err("Onbekende hoofdwerf");
                if (pw.parentId != null) { return #err("Een deelwerf kan maar één niveau diep") };
              };
              case _ {};
            };
            let code = freeCode();
            workCode := code;
            r := { r with workCreated = 1 };
            if (not dryRun) {
              let id = Ids.next(ctr, "work");
              let w : Types.Work = {
                id;
                code;
                name = block.name;
                address = { street = block.street; number = block.number; zip = block.zip; city = block.city; country = "BE" };
                parentId = parent;
                clientOrgId = null;
                architectOrgId = null;
                leaderPersonId = null;
                var status = #planned;
                vatBp = block.vatBp;
                plannedStart = null;
                plannedEnd = null;
                estimatedAmountCents = null;
                safetyCoordinatorOrgId = null;
                createdAt = now;
                createdBy = p.id;
                var archivedAt = null;
                extra = [("import", bid)];
              };
              works.works.add(id, w);
              imp.keys.add(blockKey, { key = blockKey; kind = #work; entityId = id; batchId = bid });
              workId := ?id;
            };
          };
        };
      };
    };

    // 2. Taken, uitvoerders en afspraken
    var order = switch workId {
      case (?w) Plan.tasksOf(plan, w).foldLeft(0, func(m : Nat, t : Types.Task) : Nat = Nat.max(m, t.order));
      case null 0;
    };
    var wroteAny = false;
    for (t in block.tasks.values()) {
      let taskKey = "t:" # t.key;
      let responsibleOrg : ?Nat = switch (t.responsible) {
        case (?n) {
          switch (resolve(byName, n)) { case (#one o) ?o; case (#none) { miss(n); null }; case (#many) { problems.add("«" # n # "» hoort bij meer dan één firma: niet gekoppeld"); miss(n); null } };
        };
        case null null;
      };
      // Runs van deze taak koppelen (ook voor de proefronde, voor de telling en het rapport)
      let linked = List.empty<(Views.ImportRun, Nat)>();
      let lost = List.empty<Text>();
      for (run in t.runs.values()) {
        switch (resolve(byName, run.name)) {
          case (#one o) linked.add((run, o));
          case (#none) { miss(run.name); lost.add(Text.toUpper(Text.trim(run.name, #char ' '))) };
          case (#many) { problems.add("«" # run.name # "» hoort bij meer dan één firma: niet gekoppeld"); miss(run.name); lost.add(run.name) };
        };
      };
      var taskId : ?Nat = null;
      switch (imp.keys.get(taskKey)) {
        case (?k) { taskId := ?k.entityId; r := { r with tasksExisting = r.tasksExisting + 1 } };
        case null {
          r := { r with tasksCreated = r.tasksCreated + 1 };
          if (not dryRun) {
            switch workId {
              case (?w) {
                let id = Ids.next(ctr, "task");
                order += 1;
                var note = t.note;
                if (lost.size() > 0) {
                  let sep = if (note == "") "" else "\n";
                  note #= sep # "Planning noemt zonder firma in de database: " # Text.join(lost.values(), ", ");
                };
                if (note.size() > Config.maxNote) { note := Text.fromIter(note.chars().take(Config.maxNote)) };
                let task : Types.Task = {
                  id;
                  workId = w;
                  title = t.title;
                  note;
                  kind = #work;
                  templateKey = null;
                  trade = null;
                  responsibleOrgId = responsibleOrg;
                  status = t.status;
                  percent = t.percent;
                  start = t.start;
                  workdays = t.workdays;
                  leadDays = 0;
                  orderDay = null;
                  actualStart = null;
                  actualEnd = null;
                  order;
                  quoteLineIds = [];
                  createdAt = now;
                  createdBy = p.id;
                  updatedAt = now;
                  updatedBy = p.id;
                  archivedAt = null;
                  extra = t.extra.concat([("import", bid)]);
                };
                plan.tasks.add(id, task);
                imp.keys.add(taskKey, { key = taskKey; kind = #task; entityId = id; batchId = bid });
                let cid = Ids.next(ctr, "taskChange");
                plan.taskChanges.add(cid, { id = cid; taskId = id; workId = w; at = now; by = p.id; field = "taak"; from = ""; to = t.title; reason = "import " # bid });
                taskId := ?id;
                wroteAny := true;
              };
              case null {};
            };
          };
        };
      };
      // Uitvoerders: per firma een aaneengesloten reeks weken (de weekcel van de planning)
      var primaryDone = false;
      for ((run, o) in linked.values()) {
        let aKey = "a:" # run.key;
        switch (imp.keys.get(aKey)) {
          case (?_) { r := { r with assignmentsExisting = r.assignmentsExisting + 1 } };
          case null {
            r := { r with assignmentsCreated = r.assignmentsCreated + 1 };
            let isPrimary = responsibleOrg == ?o and not primaryDone;
            if (isPrimary) { primaryDone := true };
            if (not dryRun) {
              switch (taskId, workId) {
                case (?tid, ?w) {
                  let id = Ids.next(ctr, "assignment");
                  plan.assignments.add(id, { id; taskId = tid; workId = w; orgId = o; personId = null; fromDay = ?run.from; toDay = ?run.to; note = run.note; primary = isPrimary; confirmation = #open; createdAt = now; createdBy = p.id; updatedAt = now; archivedAt = null; extra = [("import", bid)] });
                  imp.keys.add(aKey, { key = aKey; kind = #assignment; entityId = id; batchId = bid });
                  wroteAny := true;
                };
                case _ {};
              };
            };
          };
        };
      };
      // Afspraken: de vrije tekst van een cel met een datum
      for (ap in t.appointments.values()) {
        let pKey = "p:" # ap.key;
        switch (imp.keys.get(pKey)) {
          case (?_) { r := { r with appointmentsExisting = r.appointmentsExisting + 1 } };
          case null {
            r := { r with appointmentsCreated = r.appointmentsCreated + 1 };
            let apOrg : ?Nat = switch (ap.name) {
              case (?n) { switch (resolve(byName, n)) { case (#one o) ?o; case (#none) { miss(n); null }; case (#many) { miss(n); null } } };
              case null null;
            };
            if (not dryRun) {
              switch (taskId, workId) {
                case (?tid, ?w) {
                  let id = Ids.next(ctr, "appointment");
                  imp.appointments.add(id, { id; workId = w; taskId = tid; day = ap.day; time = ap.time; text = ap.text; orgId = apOrg; weekFallback = ap.weekFallback; batchId = ?bid; createdAt = now; createdBy = p.id; archivedAt = null; extra = [] });
                  imp.keys.add(pKey, { key = pKey; kind = #appointment; entityId = id; batchId = bid });
                  wroteAny := true;
                };
                case _ {};
              };
            };
          };
        };
      };
    };

    // 3. Boekhouding: planversie, batch, auditlog (zonder namen: enkel werfcode en aantallen)
    if (not dryRun) {
      switch workId {
        case (?w) { if (wroteAny) { ignore bump(w) } };
        case null {};
      };
      let old = switch (imp.batches.get(bid)) {
        case (?b) b;
        case null { { id = bid; title = lbl; at = now; by = p.id; blocks = 0; works = 0; tasks = 0; assignments = 0; appointments = 0; rolledBackAt = null; rolledBackBy = null; extra = [] } };
      };
      imp.batches.add(bid, { old with blocks = old.blocks + 1; works = old.works + r.workCreated; tasks = old.tasks + r.tasksCreated; assignments = old.assignments + r.assignmentsCreated; appointments = old.appointments + r.appointmentsCreated });
    };
    Access.audit(
      audit,
      caller,
      ?p.id,
      workId,
      if (dryRun) "import-planning-proef" else "import-planning",
      bid # ": werf " # workCode # ", " # r.tasksCreated.toText() # " taken, " # r.assignmentsCreated.toText() # " uitvoerders, " # r.appointmentsCreated.toText() # " afspraken nieuw; " # (r.tasksExisting + r.assignmentsExisting + r.appointmentsExisting).toText() # " bestonden al",
    );
    #ok({
      dryRun;
      workId;
      workCode;
      workCreated = r.workCreated;
      workExisting = r.workExisting;
      tasksCreated = r.tasksCreated;
      tasksExisting = r.tasksExisting;
      assignmentsCreated = r.assignmentsCreated;
      assignmentsExisting = r.assignmentsExisting;
      appointmentsCreated = r.appointmentsCreated;
      appointmentsExisting = r.appointmentsExisting;
      unmatched = unmatched.entries().toArray();
      problems = problems.toArray();
    });
  };

  // ── Terugdraaien: alles van één batch archiveren ────────────────────────
  // Werven, taken, uitvoerders en afspraken worden gearchiveerd (nooit gewist) en de importsleutels worden
  // vrijgegeven, zodat dezelfde Excel later opnieuw kan. Een werf waar na de import ook andere taken bij
  // kwamen, blijft staan (enkel de taken van de batch gaan weg); ze staat in het rapport.
  public shared ({ caller }) func rollbackImport(batchId : Text, dryRun : Bool) : async Result.Result<Views.RollbackReport, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #importPlan, null);
    let b = imp.batches.get(batchId) ?? return #err("Onbekende batch");
    if (b.rolledBackAt != null) { return #err("Deze batch is al teruggedraaid") };
    let now = Time.now();
    let mine = imp.keys.values().filter(func k = k.batchId == batchId).toArray();
    let taskIds = Map.empty<Nat, ()>();
    let workIds = List.empty<Nat>();
    var nAsg = 0;
    var nAppt = 0;
    for (k in mine.values()) {
      switch (k.kind) {
        case (#task) { taskIds.add(k.entityId, ()) };
        case (#work) { workIds.add(k.entityId) };
        case _ {};
      };
    };
    // Werven met vreemde inhoud (taken buiten deze batch) blijven staan
    let kept = List.empty<Text>();
    let toArchive = List.empty<Nat>();
    for (w in workIds.values()) {
      let foreign = Plan.tasksOf(plan, w).any(func t = not taskIds.containsKey(t.id));
      if (foreign) { kept.add(codeOf(w)) } else { toArchive.add(w) };
    };
    let tasks = taskIds.keys().filter(func id = switch (plan.tasks.get(id)) { case (?t) t.archivedAt == null; case null false }).toArray();
    let asgs = plan.assignments.values().filter(func a = a.archivedAt == null and taskIds.containsKey(a.taskId)).toArray();
    let apps = imp.appointments.values().filter(func a = a.archivedAt == null and taskIds.containsKey(a.taskId)).toArray();
    nAsg := asgs.size();
    nAppt := apps.size();
    if (not dryRun) {
      let touched = Map.empty<Nat, ()>();
      for (id in tasks.values()) {
        switch (plan.tasks.get(id)) {
          case (?t) {
            plan.tasks.add(id, { t with archivedAt = ?now; updatedAt = now; updatedBy = p.id });
            touched.add(t.workId, ());
            let cid = Ids.next(ctr, "taskChange");
            plan.taskChanges.add(cid, { id = cid; taskId = id; workId = t.workId; at = now; by = p.id; field = "taak"; from = t.title; to = ""; reason = "import " # batchId # " teruggedraaid" });
          };
          case null {};
        };
      };
      for (a in asgs.values()) { plan.assignments.add(a.id, { a with archivedAt = ?now; updatedAt = now }) };
      for (a in apps.values()) { imp.appointments.add(a.id, { a with archivedAt = ?now }) };
      for (w in toArchive.values()) {
        switch (works.works.get(w)) { case (?x) { x.archivedAt := ?now }; case null {} };
      };
      for (w in touched.keys()) { ignore bump(w) };
      for (k in mine.values()) { imp.keys.remove(k.key) };
      imp.batches.add(batchId, { b with rolledBackAt = ?now; rolledBackBy = ?p.id });
    };
    Access.audit(audit, caller, ?p.id, null, if (dryRun) "import-planning-terug-proef" else "import-planning-terug", batchId # ": " # toArchive.size().toText() # " werven, " # tasks.size().toText() # " taken, " # nAsg.toText() # " uitvoerders, " # nAppt.toText() # " afspraken" # (if (kept.size() > 0) ", " # kept.size().toText() # " werven behouden" else ""));
    #ok({ dryRun; works = toArchive.size(); tasks = tasks.size(); assignments = nAsg; appointments = nAppt; keptWorks = kept.toArray() });
  };

  // ── Hulp ────────────────────────────────────────────────────────────────
  type Hit = { #one : Nat; #none; #many };

  // fold(naam of alias) → firma; een sleutel die bij twee firma's hoort, wordt #many (nooit raden).
  func orgIndex() : Map.Map<Text, ?Nat> {
    let m = Map.empty<Text, ?Nat>();
    for (o in org.orgs.values()) {
      if (o.archivedAt == null and Oa.inDirectory(o.kind)) {
        for (k in [o.name].concat(o.aliases).values()) {
          let f = Oa.fold(k);
          if (f != "") {
            switch (m.get(f)) {
              case (?(?x)) { if (x != o.id) { m.add(f, null) } };
              case (?null) {};
              case null { m.add(f, ?o.id) };
            };
          };
        };
      };
    };
    m;
  };

  func resolve(m : Map.Map<Text, ?Nat>, name : Text) : Hit {
    switch (m.get(Oa.fold(name))) {
      case (?(?x)) #one x;
      case (?null) #many;
      case null #none;
    };
  };

  func codeOf(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };

  // Eerstvolgende vrije "PL-01", "PL-02", … (de import houdt zijn eigen reeks; begrensd, T17).
  func freeCode() : Text {
    var n = 1;
    var code = "PL-01";
    while (works.works.values().any(func w = w.code == code) and n < 10_000) {
      n += 1;
      code := "PL-" # (if (n < 10) "0" else "") # n.toText();
    };
    code;
  };

  // Doel van een vervolg of deelwerf: een blok uit een import (sleutel), of een bestaande werfcode.
  // ?null = het blok zit in dezelfde proefronde (bestaat nog niet); null = onbekend.
  func resolveTarget(t : Text, known : [Text]) : ??Nat {
    switch (imp.keys.get("w:" # t)) {
      case (?k) { return ?(?k.entityId) };
      case null {};
    };
    for (w in works.works.values()) { if (w.code == t and w.archivedAt == null) { return ?(?w.id) } };
    if (known.any(func x = x == t)) { return ?null };
    null;
  };

  func bump(w : Nat) : Nat {
    let v = (plan.versions.get(w) ?? 0) + 1;
    plan.versions.add(w, v);
    v;
  };

  func inputError(b : Views.ImportBlock) : ?Text {
    if (b.key.size() == 0 or b.key.size() > Config.maxImportKey) { return ?"Sleutel van het blok: 1 tot 200 tekens" };
    if (Access.cleanText(b.name, Config.maxName) == null) { return ?"Naam van de werf: 1 tot 80 tekens" };
    if (b.street.size() > Config.maxName or b.number.size() > Config.maxShort or b.zip.size() > Config.maxShort or b.city.size() > Config.maxName) { return ?"Adres te lang" };
    if (b.vatBp != 600 and b.vatBp != 2100) { return ?"Btw-tarief: 6 of 21 %" };
    if (b.tasks.size() == 0 or b.tasks.size() > Config.maxTasksPerWork) { return ?("Per blok 1 tot " # Config.maxTasksPerWork.toText() # " taken") };
    for (t in b.tasks.values()) {
      if (t.key.size() == 0 or t.key.size() > Config.maxImportKey) { return ?"Sleutel van een taak: 1 tot 200 tekens" };
      if (t.title.size() == 0 or t.title.size() > Config.maxName) { return ?"Titel van een taak: 1 tot 80 tekens" };
      if (t.note.size() > Config.maxNote) { return ?"Notitie te lang" };
      switch (Access.extraError(t.extra)) { case (?e) return ?e; case null {} };
      if (t.percent > 100) { return ?"Voortgang: 0 tot 100 %" };
      if (t.workdays == 0 or t.workdays > Config.maxWorkdays) { return ?("Duur: 1 tot " # Config.maxWorkdays.toText() # " werkdagen") };
      if (t.start < Config.minDay or t.start > Config.maxDay or Plan.weekday(t.start) > 4) { return ?"Start: een werkdag tussen 2019 en 2079" };
      if (t.runs.size() > Config.maxAssignPerTask) { return ?"Te veel uitvoerders voor één taak" };
      if (t.appointments.size() > 50) { return ?"Te veel afspraken voor één taak" };
      for (r in t.runs.values()) {
        if (r.key.size() == 0 or r.key.size() > Config.maxImportKey or r.name.size() > Config.maxName or r.note.size() > Config.maxText) { return ?"Uitvoerder: sleutel of tekst onbruikbaar" };
        if (r.to < r.from or r.from < Config.minDay or r.to > Config.maxDay) { return ?"Uitvoerder: onmogelijke dagen" };
      };
      for (a in t.appointments.values()) {
        if (a.key.size() == 0 or a.key.size() > Config.maxImportKey or a.text.size() > Config.maxText) { return ?"Afspraak: sleutel of tekst onbruikbaar" };
        if (a.day < Config.minDay or a.day > Config.maxDay) { return ?"Afspraak: onmogelijke datum" };
      };
    };
    null;
  };
};
