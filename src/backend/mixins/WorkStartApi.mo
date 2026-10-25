// Offerte → werf (stap 2.8, bouwplan §9 rij 2.8; VOORLOPIG tot Alexis bevestigt). Een aanvaarde offerteversie (akkoord van
// de klant, getekende offerte of registratie door kantoor, 2.7) geeft een VOORSTEL "Werf starten": de werf (die van de
// offerte, of een nieuwe), planningstaken uit de posten met de volgorde van het sjabloon, vergunningsvoorstellen met de
// uiterste aanvraagdag en de 30bis-drempel met de aangifte klaargezet. De werfleider of een admin bekijkt het (query, met een
// Gantt-voorvertoning), past het aan en bevestigt (update). Het rekenwerk staat in lib/WorkStart.mo: voorstel en bevestiging
// komen zo exact hetzelfde uit.
// Idempotent: één start per offerteversie (sleutel = versie); twee keer bevestigen geeft de eerste start terug en verandert
// niets. Een nieuwe aanvaarde versie of een meerwerkofferte op dezelfde werf voegt enkel het verschil toe, weer als voorstel.
// Rechten (Rights.mo): #startWork = admin of de werfleider van die werf (zij plannen, beheren de vergunningen en de aangifte);
// de calculator en alle externen niet. Het voorstel heeft geen enkel bedrag (de werfleider ziet het ook); de aanneemsom gaat
// van de offerte rechtstreeks naar het contract (vertrouwelijk, R27), zonder dat iemand ze hier ziet. Alles in de auditlog.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import SV "../types/startviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Permits "../lib/Permits";
import Plan "../lib/Plan";
import QuoteDocs "../lib/QuoteDocs";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  files : Types.FileState,
  plan : Types.PlanState,
  permits : Types.PermitState,
  wadm : Types.WadmState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  workStarts : Types.WorkStartState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── De voorstellen: aanvaarde versies zonder start of afwijzing ─────────
  public query ({ caller }) func pendingWorkStarts(workId : ?Nat) : async [SV.WorkStartPending] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #startWorkAny, null);
    switch workId { case (?w) Rights.require(ctx, p, #startWork, ?w); case null {} };
    let c = wsCtx();
    let out = quotes.versions.values().filter(func v = v.status == #accepted).filterMap(
      func(v : Types.QuoteVersion) : ?SV.WorkStartPending {
        let q = quotes.quotes.get(v.quoteId) ?? return null;
        if (workId != null and workId != ?q.workId) { return null };
        if (not WorkStart.isPending(c, v) or not Rights.may(ctx, p, #startWork, ?q.workId)) { return null };
        let w = works.works.get(q.workId) ?? return null;
        ?{ versionId = v.id; quoteId = q.id; quoteNumber = q.number; version = v.version; title = v.title; workId = w.id; workCode = w.code; workName = w.name; acceptedAt = WorkStart.acceptedAt(quoteDocs, v); acceptedHow = WorkStart.acceptedHow(quoteDocs, v); meerwerk = WorkStart.startsOn(workStarts, w.id).size() > 0 };
      }
    ).toArray().sort(func(a, b) = Int.compare(b.acceptedAt, a.acceptedAt));
    Array.tabulate<SV.WorkStartPending>(Nat.min(out.size(), Config.maxQuoteRead), func i = out[i]);
  };

  // ── Het voorstel (query: geen bedragen, niets bewaard) ──────────────────
  public query ({ caller }) func workStartPreview(versionId : Nat, i : SV.WorkStartInput) : async Result.Result<SV.WorkStartPreview, Text> {
    let p = Access.requireActive(access, caller);
    let (v, q) = switch (wsFind(p, versionId)) { case (#ok x) x; case (#err e) return #err(e) };
    let src = works.works.get(q.workId) ?? return #err("Onbekende werf");
    let doneRec = workStarts.starts.get(v.id);
    let t = switch (wsTarget(p, q, src, i, doneRec == null)) { case (#ok x) x; case (#err e) return #err(e) };
    let c = wsCtx();
    let tw = switch (t.workId) { case (?w) works.works.get(w); case null null };
    let info = quoteDocs.sendInfo.get(v.id);
    let leaderId : ?Nat = switch (i.leaderPersonId) { case (?l) ?l; case null { switch tw { case (?w) w.leaderPersonId; case null src.leaderPersonId } } };
    let base = {
      versionId = v.id;
      quoteId = q.id;
      quoteNumber = q.number;
      version = v.version;
      quoteTitle = v.title;
      acceptedHow = WorkStart.acceptedHow(quoteDocs, v);
      sourceWorkId = src.id;
      sourceCode = src.code;
      sourceName = src.name;
      workId = t.workId;
      workCode = switch (tw, i.target) { case (?w, _) w.code; case (null, #newWork n) n.code; case _ "" };
      workName = switch (tw, i.target) { case (?w, _) w.name; case (null, #newWork n) n.name; case _ "" };
      workStatus = switch tw { case (?w) w.status; case null #planned };
      clientName = WorkStart.orgName(org, switch tw { case (?w) (switch (w.clientOrgId) { case (?x) ?x; case null v.clientOrgId }); case null v.clientOrgId });
      address = t.address;
      vatBp = switch tw { case (?w) w.vatBp; case null v.vatBp };
      vatNote = switch (dossier.info.get(switch (t.workId) { case (?w) w; case null src.id })) { case (?x) x.vatNote; case null { switch info { case (?x) x.vatNote; case null "" } } };
      leaderPersonId = leaderId;
      leaderName = switch leaderId { case (?l) Access.personName(access, l); case null "" };
      templates = Plan.templates(plan).filter(func x = x.archivedAt == null).map(func x = (x.key, x.name));
      planVersion = switch (t.workId) { case (?w) wsPlanVersion(w); case null 0 };
      caps = { start = true; setLeader = Rights.may({ works; settings }, p, #setLeader, ?src.id); newWork = Rights.may({ works; settings }, p, #createWork, null) };
    };
    switch doneRec {
      case (?d) {
        return #ok({
          base with
          done = ?wsDoneView(d, true);
          bases = [];
          templateKey = d.templateKey;
          templateName = "";
          templateProvisional = false;
          steps = [];
          startDay = d.startDay;
          groups = [];
          existing = [];
          existingCount = 0;
          lines = [];
          skipped = [];
          changed = [];
          removed = [];
          permits = [];
          art30bis = null;
          art30bisReason = "";
          checkinatwork = null;
          oaCount = 0;
          declarationExists = wadm.declarations.containsKey(d.workId);
          end = null;
          warnings = [];
        });
      };
      case null {};
    };
    let pr = WorkStart.propose(c, q, v, t, i);
    let existingTasks : [Types.Task] = switch (t.workId) { case (?w) Plan.tasksOf(plan, w); case null [] };
    let warn = wsTargetWarnings(q, v, src, tw, leaderId).concat(pr.warnings);
    #ok({
      base with
      done = null;
      bases = pr.bases.filterMap(func(b : Types.WorkStart) : ?Text { switch (quotes.versions.get(b.versionId), quotes.quotes.get(b.quoteId)) { case (?bv, ?bq) ?(bq.number # " v" # bv.version.toText()); case _ null } });
      templateKey = pr.template.key;
      templateName = pr.template.name;
      templateProvisional = pr.template.provisional;
      steps = pr.template.steps.filter(func s = s.kind != #delivery).map(func(s : Types.TemplateStep) : ((Text, Text)) = (s.key, s.title));
      startDay = pr.startDay;
      groups = pr.groups.map(func g = wsGroupView(pr, g, t.cal));
      existing = existingTasks.filter(func x = pr.groups.any(func g = switch (g.existing) { case (?e) e.id == x.id; case null false }) or pr.deps.any(func d = d.from == #task(x.id))).map(func(x : Types.Task) : SV.WorkStartExisting = { id = x.id; title = x.title; start = x.start; end = Plan.endDay(t.cal, x.start, x.workdays); kind = x.kind });
      existingCount = existingTasks.size();
      lines = pr.lines;
      skipped = pr.skipped;
      changed = pr.changed;
      removed = pr.removed;
      permits = pr.permits.map(func(x : WorkStart.PermitProposal) : SV.WorkStartPermit = { kind = x.kind; kindName = x.kindName; groups = x.groups.map(func(k : Text) : Text = wsGroupTitle(pr, k)); reason = x.reason; from = x.from; to = x.to; leadDays = x.leadDays; deadline = Permits.deadline(x.from, x.leadDays); municipality = x.municipality; exists = x.exists; skipped = x.skipped });
      art30bis = pr.art30bis;
      art30bisReason = pr.art30bisReason;
      checkinatwork = pr.checkinatwork;
      oaCount = pr.oaCount;
      declarationExists = switch (t.workId) { case (?w) wadm.declarations.containsKey(w); case null false };
      end = pr.end;
      warnings = warn;
    });
  };

  // ── Bevestigen (update): werf, taken, afhankelijkheden, vergunningsvoorstellen, contract, aangifte ──
  public shared ({ caller }) func startWorkFromQuote(versionId : Nat, i : SV.WorkStartInput, expectedPlanVersion : Nat) : async Result.Result<SV.WorkStartDone, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let (v, q) = switch (wsFind(p, versionId)) { case (#ok x) x; case (#err e) return #err(e) };
    // Idempotent: al gestart of afgewezen = dezelfde uitkomst, niets gewijzigd.
    switch (workStarts.starts.get(v.id)) { case (?d) return #ok(wsDoneView(d, true)); case null {} };
    let c = wsCtx();
    if (not WorkStart.isPending(c, v)) { return #err("Een latere versie van deze offerte is al gestart of afgewezen") };
    let src = works.works.get(q.workId) ?? return #err("Onbekende werf");
    let t = switch (wsTarget(p, q, src, i, true)) { case (#ok x) x; case (#err e) return #err(e) };
    switch (t.workId) {
      case (?w) { if (wsPlanVersion(w) != expectedPlanVersion) { return #err("De planning van de werf is intussen gewijzigd: vernieuw het voorstel") } };
      case null {};
    };
    let tw = switch (t.workId) { case (?w) works.works.get(w); case null null };
    // De werfleider: wisselen enkel door een admin (zoals op de werffiche); hij moet de rol werfleider hebben.
    let currentLeader : ?Nat = switch tw { case (?w) w.leaderPersonId; case null src.leaderPersonId };
    let leader : ?Nat = switch (i.leaderPersonId) { case (?l) ?l; case null currentLeader };
    if (leader != currentLeader) {
      if (not Rights.may(ctx, p, #setLeader, ?src.id)) { return #err("Geen toegang: enkel een beheerder duidt de werfleider aan") };
    };
    switch leader {
      case (?l) { switch (access.persons.get(l)) { case (?x) { if (not Rights.canLead(x)) { return #err("Deze persoon kan geen werfleider zijn") } }; case null return #err("Onbekende werfleider") } };
      case null {};
    };
    let pr = WorkStart.propose(c, q, v, t, i);
    switch (pr.error) { case (?e) return #err(e); case null {} };
    let newGroups = pr.groups.filter(func g = g.existing == null);
    let existingCount = switch (t.workId) { case (?w) Plan.tasksOf(plan, w).size(); case null 0 };
    if (existingCount + newGroups.size() > Config.maxTasksPerWork) { return #err("Te veel taken op deze werf") };
    let depCount = switch (t.workId) { case (?w) Plan.depsOf(plan, w).size(); case null 0 };
    if (depCount + pr.deps.size() > Config.maxDepsPerWork) { return #err("Te veel afhankelijkheden op deze werf") };
    let newPermits = pr.permits.filter(func x = not x.exists and not x.skipped);
    let permitCount = switch (t.workId) { case (?w) permits.permits.values().filter(func y = y.workId == w and y.archivedAt == null).size(); case null 0 };
    if (permitCount + newPermits.size() > Config.maxPermitsPerWork) { return #err("Te veel vergunningen op deze werf") };
    let now = Time.now();
    let tag = q.number # " v" # v.version.toText();

    // ── De werf ──
    let workId : Nat = switch (t.workId) {
      case (?w) w;
      case null {
        let (code, name, asSub) = switch (i.target) { case (#newWork n) (n.code, n.name, n.asSub); case (#existing) ("", "", false) };
        let id = Ids.next(ctr, "work");
        let parentId : ?Nat = if asSub { switch (src.parentId) { case (?x) ?x; case null ?src.id } } else null;
        let nw : Types.Work = {
          id;
          code = Access.cleanText(code, Config.maxShort) ?? code;
          name = Access.cleanText(name, Config.maxName) ?? name;
          address = src.address;
          parentId;
          clientOrgId = switch (v.clientOrgId) { case (?x) ?x; case null src.clientOrgId };
          architectOrgId = src.architectOrgId;
          leaderPersonId = leader;
          var status = #planned;
          vatBp = v.vatBp;
          plannedStart = null;
          plannedEnd = null;
          estimatedAmountCents = null;
          safetyCoordinatorOrgId = null;
          createdAt = now;
          createdBy = p.id;
          var archivedAt = null;
          extra = [("werfstart", v.id.toText())];
        };
        works.works.add(id, nw);
        let vatNote = switch (dossier.info.get(src.id)) { case (?x) x.vatNote; case null { switch (quoteDocs.sendInfo.get(v.id)) { case (?x) x.vatNote; case null "" } } };
        if (vatNote != "") { dossier.info.add(id, { workId = id; analyticCode = null; vatNote; updatedAt = now; updatedBy = p.id; extra = [] }) };
        Access.audit(audit, caller, ?p.id, ?id, "werf-gemaakt", "werfstart uit offerte " # tag # (switch parentId { case (?x) " (deelwerf van " # wsWorkCode(x) # ")"; case null "" }));
        id;
      };
    };
    // Werfleider ook lid van de werf (zoals op de werffiche).
    switch leader {
      case (?lp) {
        if (not works.memberships.values().any(func m = m.workId == workId and m.endedAt == null and m.personId == ?lp and m.role == #werfleider)) {
          let mid = Ids.next(ctr, "membership");
          let m : Types.Membership = { id = mid; workId; personId = ?lp; orgId = null; role = #werfleider; grants = []; grantedAt = now; grantedBy = p.id; var endedAt = null; var endedBy = null };
          works.memberships.add(mid, m);
          Access.audit(audit, caller, ?p.id, ?workId, "lid-toegevoegd", "werfleider #" # mid.toText() # " (werfstart)");
        };
      };
      case null {};
    };

    // ── Taken (in de volgorde van het voorstel), afhankelijkheden ──
    let cal = Plan.calFor(plan, works, workId);
    var order = Plan.tasksOf(plan, workId).foldLeft(0, func(m : Nat, x : Types.Task) : Nat = Nat.max(m, x.order));
    let idOf = Map.empty<Text, Nat>();
    var newIds : [Nat] = [];
    var linkedIds : [Nat] = [];
    var lineIds : [Nat] = [];
    for (g in pr.groups.values()) {
      lineIds := lineIds.concat(g.lineIds);
      switch (g.existing) {
        case (?e) {
          idOf.add(g.key, e.id);
          // Bestaande taak voor die stap: de lijnen erbij (geen tweede taak); OA en vakgebied enkel als ze nog leeg zijn.
          switch (plan.tasks.get(e.id)) {
            case (?cur) {
              let ids = cur.quoteLineIds.concat(g.lineIds.filter(func l = cur.quoteLineIds.find(func x = x == l) == null));
              let n : Types.Task = { cur with quoteLineIds = ids; responsibleOrgId = switch (cur.responsibleOrgId) { case (?o) ?o; case null g.orgId }; trade = switch (cur.trade) { case (?x) ?x; case null g.trade }; updatedAt = now; updatedBy = p.id };
              plan.tasks.add(cur.id, n);
              wsChange(n, p.id, "offerteposten", cur.quoteLineIds.size().toText(), ids.size().toText(), "werfstart uit offerte " # tag);
              if (cur.responsibleOrgId == null and g.orgId != null) {
                wsChange(n, p.id, "verantwoordelijke", "", WorkStart.orgName(org, g.orgId), "werfstart uit offerte " # tag);
                wsAssign(n, g.orgId, true, p.id);
              };
              linkedIds := linkedIds.concat([cur.id]);
            };
            case null {};
          };
        };
        case null {
          let id = Ids.next(ctr, "task");
          order += 1;
          let ps = switch (pr.pos.get(g.key)) { case (?x) x; case null { { start = pr.startDay; workdays = g.workdays } } };
          let tk : Types.Task = {
            id;
            workId;
            title = g.title;
            note = WorkStart.taskNote(quotes, q, v, g.lineIds);
            kind = g.kind;
            templateKey = g.stepKey;
            trade = g.trade;
            responsibleOrgId = g.orgId;
            status = #planned;
            percent = 0;
            start = ps.start;
            workdays = ps.workdays;
            leadDays = g.leadDays;
            orderDay = null;
            actualStart = null;
            actualEnd = null;
            order;
            quoteLineIds = g.lineIds;
            createdAt = now;
            createdBy = p.id;
            updatedAt = now;
            updatedBy = p.id;
            archivedAt = null;
            extra = [("werfstart", v.id.toText())];
          };
          plan.tasks.add(id, tk);
          idOf.add(g.key, id);
          newIds := newIds.concat([id]);
          wsChange(tk, p.id, "taak", "", tk.title, "werfstart uit offerte " # tag);
          wsAssign(tk, g.orgId, true, p.id);
          for (o in g.extraOrgs.values()) { wsAssign(tk, ?o, false, p.id) };
        };
      };
    };
    var depIds : [Nat] = [];
    for (d in pr.deps.values()) {
      let from = switch (d.from) { case (#task id) ?id; case (#group k) idOf.get(k) };
      switch (from, idOf.get(d.to)) {
        case (?f, ?to) {
          let id = Ids.next(ctr, "dependency");
          plan.dependencies.add(id, { id; workId; fromTaskId = f; toTaskId = to; kind = #finishToStart; lagDays = d.lag; createdAt = now; createdBy = p.id; archivedAt = null });
          depIds := depIds.concat([id]);
        };
        case _ {};
      };
    };
    if (newIds.size() > 0 or linkedIds.size() > 0) { plan.versions.add(workId, wsPlanVersion(workId) + 1) };

    // ── De werffiche: status, geplande periode ──
    switch (works.works.get(workId)) {
      case (?w) {
        var s = w.plannedStart;
        var e = w.plannedEnd;
        for (id in newIds.values()) {
          switch (plan.tasks.get(id)) {
            case (?x) {
              let end = Plan.endDay(cal, x.start, x.workdays);
              s := ?(switch s { case (?a) Nat.min(a, x.start); case null x.start });
              e := ?(switch e { case (?b) Nat.max(b, end); case null end });
            };
            case null {};
          };
        };
        let before = w.status;
        let status : Types.WorkStatus = if (before == #request or before == #quoting) #planned else before;
        if (s != w.plannedStart or e != w.plannedEnd or leader != w.leaderPersonId) {
          let nw : Types.Work = { id = w.id; code = w.code; name = w.name; address = w.address; parentId = w.parentId; clientOrgId = w.clientOrgId; architectOrgId = w.architectOrgId; leaderPersonId = leader; var status = status; vatBp = w.vatBp; plannedStart = s; plannedEnd = e; estimatedAmountCents = w.estimatedAmountCents; safetyCoordinatorOrgId = w.safetyCoordinatorOrgId; createdAt = w.createdAt; createdBy = w.createdBy; var archivedAt = w.archivedAt; extra = w.extra };
          works.works.add(workId, nw);
        } else { w.status := status };
        if (status != before) { Access.audit(audit, caller, ?p.id, ?workId, "werf-status", w.code # ": " # wsStatusKey(before) # " → " # wsStatusKey(status) # " (werfstart)") };
        if (leader != w.leaderPersonId) { Access.audit(audit, caller, ?p.id, ?workId, "werf-gewijzigd", w.code # ": werfleider → " # (switch leader { case (?l) Access.personName(access, l); case null "–" }) # " (werfstart)") };
      };
      case null {};
    };

    // ── Vergunningsvoorstellen (status "nodig"; uiterste aanvraagdag = start − doorlooptijd) ──
    var permitIds : [Nat] = [];
    for (x in newPermits.values()) {
      let id = Ids.next(ctr, "permit");
      let taskIds = Permits.uniq(x.groups.filterMap(func(k : Text) : ?Nat = idOf.get(k)));
      let taskIds2 = Array.tabulate<Nat>(Nat.min(taskIds.size(), Config.maxPermitTasks), func j = taskIds[j]);
      let n : Types.Permit = {
        id;
        workId;
        kind = x.kind;
        title = x.kindName;
        municipalityId = x.municipalityId;
        status = #needed;
        location = "";
        taskIds = taskIds2;
        neededFrom = null;
        neededTo = null;
        leadDays = x.leadDays;
        requestedOn = null;
        validFrom = null;
        validTo = null;
        reference = "";
        costCents = null;
        fileIds = [];
        note = Text.fromIter(("Voorstel uit offerte " # tag # " (werfstart): " # x.reason).chars().take(Config.maxNote));
        createdAt = now;
        createdBy = p.id;
        updatedAt = now;
        updatedBy = p.id;
        archivedAt = null;
        extra = [("werfstart", v.id.toText())];
      };
      permits.permits.add(id, n);
      let cid = Ids.next(ctr, "permitChange");
      permits.changes.add(cid, { id = cid; permitId = id; workId; at = now; by = p.id; field = "nieuw"; from = ""; to = Permits.statusWord(#needed) # " (voorstel uit offerte " # tag # ")" });
      Access.audit(audit, caller, ?p.id, ?workId, "vergunning-nieuw", "#" # id.toText() # " " # x.kind # " voorstel uit offerte " # tag);
      permitIds := permitIds.concat([id]);
    };

    // ── Contract (vertrouwelijk): aanneemsom uit de offerte(s) voor 30bis/Checkinatwork, getekende offerteversie ──
    wsContract(p.id, caller, workId, v, pr.amount);

    // ── De checklist: "Aannemingsovereenkomst / getekende offerte" ontvangen bij een digitaal akkoord of een getekende PDF
    //    (die laatste als bestand, als ze bij deze werf hoort). Een beslissing van kantoor zonder bewijs verandert niets. ──
    switch (quoteDocs.acceptances.get(v.id)) {
      case (?acc) {
        let fileIds : [Nat] = switch (acc.signed) {
          case (?s) { switch (files.files.get(s.fileId)) { case (?f) { if (f.workId == ?workId and f.archivedAt == null) [s.fileId] else [] }; case null [] } };
          case null [];
        };
        let how = switch (acc.digital, acc.signed) { case (?d, _) "digitaal akkoord van de klant op " # Plan.fmtDay(Int.abs(d.at) / Int.abs(Config.day)); case (null, ?s) "getekende offerte geregistreerd op " # Plan.fmtDay(Int.abs(s.at) / Int.abs(Config.day)); case _ "" };
        if (how != "") {
          let existing = Dossier.docsOf(dossier, workId).find(func d = d.kind == "contract");
          let title = "Offerte " # tag # " (aanvaard)";
          let noteText = Text.fromIter((how # ", hash " # Text.fromIter(acc.hash.chars().take(12)) # " (werfstart)").chars().take(Config.maxNote));
          switch existing {
            case (?d) {
              if (d.status != #received and d.status != #approved) {
                dossier.documents.add(d.id, { d with status = #received; title; note = noteText; fileIds = d.fileIds.concat(fileIds); updatedAt = now; updatedBy = p.id });
              };
            };
            case null {
              let id = Ids.next(ctr, "document");
              dossier.documents.add(id, { id; workId; kind = "contract"; title; fileIds; status = #received; dueDay = null; validUntil = null; note = noteText; ownerOrgId = null; confidential = true; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [("werfstart", v.id.toText())] });
            };
          };
        };
      };
      case null {};
    };

    // ── 30bis: de aangifte klaarzetten als ze nodig is (indienen doet een mens op het portaal) ──
    let decl : Text = if (not i.declaration) "niet gevraagd" else switch (pr.art30bis) {
      case (?true) {
        if (wadm.declarations.containsKey(workId)) "bestond al" else {
          wadm.declarations.add(workId, { workId; status = #todo; nature = "eenmalig"; asbestos = false; note = "Klaargezet bij de werfstart uit offerte " # tag # " (" # pr.art30bisReason # ")"; updatedAt = now; updatedBy = p.id; extra = [("werfstart", v.id.toText())] });
          Access.audit(audit, caller, ?p.id, ?workId, "aangifte-30bis", "te doen · klaargezet bij de werfstart uit offerte " # tag);
          "klaargezet";
        };
      };
      case (?false) "niet nodig";
      case null "onbekend";
    };

    let rec : Types.WorkStart = {
      versionId = v.id;
      quoteId = q.id;
      sourceWorkId = src.id;
      workId;
      status = #started;
      newWork = t.workId == null;
      baseVersionIds = pr.bases.map(func(b : Types.WorkStart) : Nat = b.versionId);
      startDay = pr.startDay;
      templateKey = pr.template.key;
      lineIds;
      roots = lineIds.map(func(l : Nat) : Nat = WorkStart.root(quotes, l));
      taskIds = newIds;
      linkedTaskIds = linkedIds;
      depIds;
      permitIds;
      declaration = decl;
      note = "";
      at = now;
      by = p.id;
      extra = [];
    };
    workStarts.starts.add(v.id, rec);
    Access.audit(audit, caller, ?p.id, ?workId, "werf-gestart", "offerte " # tag # " → " # wsWorkCode(workId) # (if (rec.newWork) " (nieuwe werf)" else "") # (if (pr.bases.size() > 0) " (meerwerk: enkel het verschil)" else "") # ": " # newIds.size().toText() # " taken, " # linkedIds.size().toText() # " gekoppeld, " # depIds.size().toText() # " afhankelijkheden, " # permitIds.size().toText() # " vergunningsvoorstellen, 30bis " # decl # ", start " # Plan.fmtDay(pr.startDay));
    switch leader {
      case (?l) { if (l != p.id) { Access.notify(audit, ctr, l, "werfstart", "Werf " # wsWorkCode(workId) # " gestart uit offerte " # tag # ": " # newIds.size().toText() # " taken, " # permitIds.size().toText() # " vergunningsvoorstellen.", ?workId) } };
      case null {};
    };
    #ok(wsDoneView(rec, false));
  };

  // Het voorstel afwijzen ("geen werfstart nodig": de werf is al met de hand gepland, dubbel …). Ook vastgelegd per versie.
  public shared ({ caller }) func dismissWorkStart(versionId : Nat, reason : Text) : async Result.Result<SV.WorkStartDone, Text> {
    let p = Access.requireActive(access, caller);
    let (v, q) = switch (wsFind(p, versionId)) { case (#ok x) x; case (#err e) return #err(e) };
    switch (workStarts.starts.get(v.id)) { case (?d) return #ok(wsDoneView(d, true)); case null {} };
    if (not WorkStart.isPending(wsCtx(), v)) { return #err("Een latere versie van deze offerte is al gestart of afgewezen") };
    let why = reason.trim(#char ' ');
    if (why.size() < 5 or why.size() > Config.maxWorkStartReason) { return #err("Reden: 5 tot " # Config.maxWorkStartReason.toText() # " tekens") };
    let rec : Types.WorkStart = { versionId = v.id; quoteId = q.id; sourceWorkId = q.workId; workId = q.workId; status = #dismissed; newWork = false; baseVersionIds = []; startDay = 0; templateKey = ""; lineIds = []; roots = []; taskIds = []; linkedTaskIds = []; depIds = []; permitIds = []; declaration = ""; note = why; at = Time.now(); by = p.id; extra = [] };
    workStarts.starts.add(v.id, rec);
    Access.audit(audit, caller, ?p.id, ?q.workId, "werfstart-afgewezen", "offerte " # q.number # " v" # v.version.toText() # ": " # why);
    #ok(wsDoneView(rec, false));
  };

  // ── Hulp (namen met ws-voorvoegsel: de mixins delen één naamruimte) ──────
  func wsCtx() : WorkStart.Ctx { { settings; org; works; dossier; plan; permits; wadm; library; quotes; quoteDocs; starts = workStarts } };

  // De versie en haar offerte, met de rechten: wie geen voorstellen mag zien, hoort ook niet of een versie bestaat.
  func wsFind(p : Types.Person, versionId : Nat) : Result.Result<(Types.QuoteVersion, Types.Quote), Text> {
    let ctx = { works; settings };
    let found : ?(Types.QuoteVersion, Types.Quote) = switch (quotes.versions.get(versionId)) {
      case (?v) { switch (quotes.quotes.get(v.quoteId)) { case (?q) ?(v, q); case null null } };
      case null null;
    };
    switch found {
      case null { Rights.require(ctx, p, #startWorkAny, null); #err("Onbekende versie") };
      case (?(v, q)) {
        Rights.require(ctx, p, #startWork, ?q.workId);
        if (v.status != #accepted) { return #err("Enkel een aanvaarde versie kan een werf starten") };
        #ok((v, q));
      };
    };
  };

  // De doelwerf: die van de offerte (#existing) of een nieuwe (code, naam: nagekeken). `check` = ook de invoer nakijken.
  func wsTarget(p : Types.Person, q : Types.Quote, src : Types.Work, i : SV.WorkStartInput, check : Bool) : Result.Result<WorkStart.Target, Text> {
    let ctx = { works; settings };
    switch (i.target) {
      case (#existing) {
        if (src.archivedAt != null) { return #err("De werf van de offerte is gearchiveerd") };
        #ok({ workId = ?src.id; address = src.address; plannedStart = src.plannedStart; cal = Plan.calFor(plan, works, src.id) });
      };
      case (#newWork n) {
        if (not Rights.may(ctx, p, #createWork, null)) { return #err("Geen toegang: een nieuwe werf maken mag u niet") };
        if (check) {
          if (Access.cleanText(n.name, Config.maxName) == null) { return #err("Naam van de nieuwe werf: 1 tot " # Config.maxName.toText() # " tekens") };
          let code = Access.cleanText(n.code, Config.maxShort) ?? return #err("Code van de nieuwe werf: 1 tot " # Config.maxShort.toText() # " tekens");
          if (works.works.values().any(func w = w.code == code)) { return #err("Werfcode " # code # " bestaat al") };
        };
        ignore q;
        #ok({ workId = null; address = src.address; plannedStart = null; cal = WorkStart.companyCal(plan) });
      };
    };
  };

  func wsTargetWarnings(q : Types.Quote, v : Types.QuoteVersion, src : Types.Work, tw : ?Types.Work, leader : ?Nat) : [Text] {
    var out : [Text] = [];
    switch tw {
      case (?w) {
        if (w.clientOrgId != null and v.clientOrgId != null and w.clientOrgId != v.clientOrgId) { out := out.concat(["De klant van de offerte verschilt van die van de werf (de werf houdt haar klant)"]) };
        if (w.vatBp != v.vatBp) { out := out.concat(["Het btw-tarief van de offerte (" # (v.vatBp / 100).toText() # " %) verschilt van dat van de werf (" # (w.vatBp / 100).toText() # " %)"]) };
        if (w.status == #cancelled) { out := out.concat(["De werf staat op «geannuleerd»"]) };
        let note = switch (dossier.info.get(w.id)) { case (?x) x.vatNote; case null "" };
        if (w.vatBp == 600 and note.trim(#char ' ') == "") { out := out.concat(["Btw 6 % zonder grond bij de werf (werffiche: grond voor het btw-tarief)"]) };
      };
      case null {};
    };
    if (leader == null) { out := out.concat(["De werf heeft nog geen werfleider"]) };
    ignore q;
    ignore src;
    out;
  };

  func wsGroupTitle(pr : WorkStart.Proposal, k : Text) : Text {
    switch (pr.groups.find(func g = g.key == k)) { case (?g) g.title; case null k };
  };

  func wsGroupView(pr : WorkStart.Proposal, g : WorkStart.Group, cal : Plan.Cal) : SV.WorkStartGroup {
    let ps = switch (pr.pos.get(g.key)) { case (?x) x; case null { { start = pr.startDay; workdays = g.workdays } } };
    let after = pr.deps.filter(func d = d.to == g.key).map(
      func(d : WorkStart.Dep) : Text {
        switch (d.from) {
          case (#group k) wsGroupTitle(pr, k);
          case (#task id) { switch (plan.tasks.get(id)) { case (?x) x.title; case null "#" # id.toText() } };
        };
      }
    );
    {
      key = g.key;
      title = g.title;
      stepKey = g.stepKey;
      kind = g.kind;
      trade = g.trade;
      tradeName = WorkStart.tradeName(settings, g.trade);
      orgId = g.orgId;
      orgName = WorkStart.orgName(org, g.orgId);
      extraOrgs = g.extraOrgs.map(func(o : Nat) : Text = WorkStart.orgName(org, ?o));
      workdays = ps.workdays;
      daysFrom = g.daysFrom;
      leadDays = g.leadDays;
      start = ps.start;
      end = Plan.endDay(cal, ps.start, ps.workdays);
      after;
      lineIds = g.lineIds;
      existingTaskId = switch (g.existing) { case (?e) ?e.id; case null null };
      companion = g.companion;
    };
  };

  func wsDoneView(d : Types.WorkStart, already : Bool) : SV.WorkStartDone {
    {
      versionId = d.versionId;
      status = if (d.status == #started) "gestart" else "afgewezen";
      at = d.at;
      byName = Access.personName(access, d.by);
      workId = d.workId;
      workCode = wsWorkCode(d.workId);
      newWork = d.newWork;
      tasks = d.taskIds.size();
      linked = d.linkedTaskIds.size();
      dependencies = d.depIds.size();
      permits = d.permitIds.size();
      declaration = d.declaration;
      note = d.note;
      already;
    };
  };

  func wsPlanVersion(w : Nat) : Nat { switch (plan.versions.get(w)) { case (?v) v; case null 0 } };
  func wsWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };

  func wsStatusKey(s : Types.WorkStatus) : Text {
    switch s { case (#request) "aanvraag"; case (#quoting) "offerte"; case (#planned) "gepland"; case (#running) "in uitvoering"; case (#delivered) "opgeleverd"; case (#aftercare) "nazorg"; case (#cancelled) "geannuleerd" };
  };

  func wsChange(t : Types.Task, by : Nat, field : Text, from : Text, to : Text, reason : Text) {
    if (from == to) { return };
    let id = Ids.next(ctr, "taskChange");
    plan.taskChanges.add(id, { id; taskId = t.id; workId = t.workId; at = Time.now(); by; field; from; to; reason });
  };

  // Een uitvoerder op een nieuwe taak (de verantwoordelijke = primary, zoals in de planning); de OA krijgt een melding als
  // hij al lid is van de werf (zoals bij een nieuwe taak in de planning).
  func wsAssign(t : Types.Task, orgId : ?Nat, primary : Bool, by : Nat) {
    let o = orgId ?? return;
    if (plan.assignments.values().any(func a = a.taskId == t.id and a.orgId == o and a.archivedAt == null)) { return };
    let now = Time.now();
    let id = Ids.next(ctr, "assignment");
    plan.assignments.add(id, { id; taskId = t.id; workId = t.workId; orgId = o; personId = null; fromDay = null; toDay = null; note = ""; primary; confirmation = #open; createdAt = now; createdBy = by; updatedAt = now; archivedAt = null; extra = [] });
    Access.notifyOrgOnWork(access, { works; settings }, audit, ctr, o, t.workId, null, by, "planning-nieuw", "Nieuwe taak voor jou op " # wsWorkCode(t.workId) # ": «" # t.title # "» vanaf " # Plan.fmtDay(t.start) # ".");
  };

  // Het contract van de werf: de aanneemsom (excl. btw) uit de gestarte offerte(s) en de getekende offerteversie. Een nieuw
  // contract krijgt de betaaltermijn van de offerte. Elke versie blijft (historiek); de auditlog noemt enkel de velden.
  func wsContract(by : Nat, caller : Principal, workId : Nat, v : Types.QuoteVersion, amount : ?Int) {
    let old = dossier.confidential.get(workId);
    let base : Types.ContractParams = switch old {
      case (?c) { switch (c.contract) { case (#plain k) k; case (#sealed _) return } };
      case null {
        let days = switch (quoteDocs.sendInfo.get(v.id)) { case (?x) x.paymentDays; case null QuoteDocs.paymentDays(settings) };
        { estimatedAmountCents = null; priceRevision = #none; guarantee = #none; guaranteeBp = 0; paymentTermDays = Nat.min(days, Config.maxPaymentTermDays); invoicingRhythm = #perProgress; signedQuoteVersionId = null; note = "" };
      };
    };
    let k : Types.ContractParams = { base with estimatedAmountCents = switch amount { case (?a) ?a; case null base.estimatedAmountCents }; signedQuoteVersionId = ?v.id };
    let now = Time.now();
    let version = (switch old { case (?c) c.version; case null 0 }) + 1;
    let rec : Types.WorkConfidential = {
      workId;
      contract = #plain(k);
      clientContact = switch old { case (?c) c.clientContact; case null #plain({ name = ""; phone = null; email = null; address = null }) };
      notes = switch old { case (?c) c.notes; case null #plain("") };
      version;
      updatedAt = now;
      updatedBy = by;
      extra = switch old { case (?c) c.extra; case null [] };
    };
    let fields = Dossier.changedFields(old, rec);
    if (fields == "niets gewijzigd") { return };
    dossier.confidential.add(workId, rec);
    let hid = Ids.next(ctr, "workConfidentialVersion");
    dossier.confidentialHistory.add(hid, { id = hid; workId; version; contract = rec.contract; clientContact = rec.clientContact; notes = rec.notes; at = now; by });
    Access.audit(audit, caller, ?by, ?workId, "vertrouwelijk-gewijzigd", "contract " # wsWorkCode(workId) # " v" # version.toText() # ": " # fields # " (werfstart)");
  };
};
