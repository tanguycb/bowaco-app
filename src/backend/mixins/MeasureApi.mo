// Opmeting ter plaatse (stap 2.9, bouwplan rij 2.9, §5.1, §8.3, architectuur §8): op de gsm per werf de posten van de getekende
// offerte opmeten: de gemeten hoeveelheid (deelopmetingen tellen op), datum en wie mat, een notitie, foto's of een schets, en
// het verschil met de VH (in hoeveelheid en in %, met een markering boven de instelbare drempel).
//   • Offline: dezelfde wachtrij als het werfverslag (1.6): kleine opdrachten met een opId en de clientKey van de opmeting;
//     dezelfde opId nog eens = hetzelfde resultaat (nooit een dubbele regel); een tweede toestel komt in DEZELFDE open opmeting.
//   • Een regel wordt nooit overschreven. Een open opmeting laat een regel weghalen (gearchiveerd, blijft bewaard); een
//     AFGESLOTEN opmeting verandert niet meer: corrigeren kan alleen met een nieuwe regel (`corrects`) in de volgende opmeting
//     met een reden. Bij het afsluiten ligt de stand per post vast: daarop rekent 2.10 (vorderingsstaten).
//   • Rechten (Rights.mo): werfleider van de werf, calculator en admin meten (#editMeasurement); een OA ziet enkel de posten van
//     zijn firma en mag (instelbaar) voorstellen ter bevestiging; architect en klant lezen enkel de afgesloten stand, als de
//     beheerder het toelaat én ze het leesrecht hebben. NOOIT een prijs: dit domein kent er geen.
// Geen await in deze mixin: elke oproep is één atomische stap (R33).
import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import MV "../types/measureviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Ids "../lib/Ids";
import Measure "../lib/Measure";
import Plan "../lib/Plan";
import Reports "../lib/Reports";
import Rights "../lib/Rights";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  plan : Types.PlanState,
  library : Types.LibraryState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen (beheerder) ────────────────────────────────────────────
  public query ({ caller }) func measureSettings() : async MV.MeasureSettingsView {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { Runtime.trap("Geen toegang") };
    { thresholdBp = Measure.thresholdBp(settings); oaPropose = Measure.oaPropose(settings); externalRead = Measure.externalRead(settings) };
  };

  public shared ({ caller }) func saveMeasureSettings(i : MV.MeasureSettingsView) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (i.thresholdBp == 0 or i.thresholdBp > Config.measureThresholdBpMax) { return #err("Drempel: 0,01 % tot " # (Config.measureThresholdBpMax / 100).toText() # " %") };
    settings.values.add("measure.thresholdBp", i.thresholdBp.toText());
    settings.values.add("measure.oaPropose", if (i.oaPropose) "ja" else "nee");
    settings.values.add("measure.externalRead", if (i.externalRead) "ja" else "nee");
    Access.audit(audit, caller, ?p.id, null, "opmeting-instellingen", "drempel " # i.thresholdBp.toText() # " bp, OA stelt voor: " # (if (i.oaPropose) "ja" else "nee") # ", externen lezen mee: " # (if (i.externalRead) "ja" else "nee"));
    #ok;
  };

  // ── Lezen ───────────────────────────────────────────────────────────────
  // De werven waar de beller kan meten of lezen, met de stand (scherm "Opmeting" op de gsm).
  public query ({ caller }) func listMeasureWorks() : async [MV.MeasureWorkBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let out = List.empty<MV.MeasureWorkBrief>();
    let thr = Measure.thresholdBp(settings);
    for (w in works.works.values()) {
      if (w.archivedAt == null and w.status != #cancelled) {
        let sc = Rights.measureScope(ctx, p, w.id);
        if (sc != #none) {
          let ps = msVisiblePosts(p, sc, w.id);
          if (ps.size() > 0) {
            let agg = Measure.aggregate(surveys, w.id, null);
            var measured = 0;
            var more = 0;
            var less = 0;
            var pending = 0;
            for (x in ps.values()) {
              let a = switch (agg.get(x.root)) { case (?a) a; case null { { measured = 0; closed = 0; count = 0; pending = 0; pendingMilli = 0; lastDay = null; complete = false; lastId = 0 } } };
              let m = if (sc == #closed) a.closed else a.measured;
              if (a.count > 0) { measured += 1 };
              pending += a.pending;
              let (_, _, f) = Measure.compare(x.line.qtyMilli, m, a.count, a.complete, thr);
              if (f == #more) { more += 1 } else if (f == #less) { less += 1 };
            };
            let sv = Measure.surveysOf(surveys, w.id);
            if (sc != #closed or sv.any(func s = not Measure.isOpen(s))) {
              out.add({
                workId = w.id;
                code = w.code;
                name = w.name;
                address = w.address;
                scope = msScopeText(sc);
                posts = ps.size();
                measuredPosts = measured;
                moreCount = more;
                lessCount = less;
                pending = if (sc == #full) pending else 0;
                openSurveyNumber = switch (sv.find(Measure.isOpen)) { case (?s) ?s.number; case null null };
                closedSurveys = sv.filter(func s = not Measure.isOpen(s)).size();
              });
            };
          };
        };
      };
    };
    Array.sort<MV.MeasureWorkBrief>(out.toArray(), func(a, b) = Text.compare(a.code, b.code));
  };

  public query ({ caller }) func measureSummary(workId : Nat) : async MV.MeasureSummaryView {
    let p = Access.requireActive(access, caller);
    let sc = Rights.measureScope({ works; settings }, p, workId);
    if (sc == #none) { Runtime.trap("Geen toegang") };
    msSummary(p, sc, workId);
  };

  public query ({ caller }) func measurePost(workId : Nat, root : Nat) : async MV.MeasurePostDetail {
    let p = Access.requireActive(access, caller);
    let sc = Rights.measureScope({ works; settings }, p, workId);
    if (sc == #none or sc == #closed) { Runtime.trap("Geen toegang") };
    let sum = msSummary(p, sc, workId);
    let post = switch (sum.posts.find(func x = x.root == root)) { case (?x) x; case null Runtime.trap("Geen toegang") };
    let ps = Measure.posts(quotes, workStarts, workId);
    let text = switch (ps.find(func x = x.root == root)) { case (?x) x.line.text; case null "" };
    let entries = List.empty<MV.MeasureEntryView>();
    for (s in Measure.surveysOf(surveys, workId).values()) {
      for (e in Measure.entriesOf(surveys, s.id).values()) {
        if (e.root == root and msMayRead(p, sc, e)) { entries.add(msEntryView(p, sc, s, e)) };
      };
    };
    { post; text; entries = entries.toArray() };
  };

  public query ({ caller }) func getMeasureSurvey(surveyId : Nat) : async MV.SurveyDetail {
    let p = Access.requireActive(access, caller);
    let s = surveys.surveys.get(surveyId) ?? Runtime.trap("Geen toegang");
    let sc = Rights.measureScope({ works; settings }, p, s.workId);
    if (sc == #none) { Runtime.trap("Geen toegang") };
    if (sc == #closed and Measure.isOpen(s)) { Runtime.trap("Geen toegang") };
    let ps = Measure.posts(quotes, workStarts, s.workId);
    let orgs = if (sc == #full) Map.empty<Nat, [Nat]>() else Measure.orgsByRoot(quotes, plan, library, s.workId, ps);
    let own = func(root : Nat) : Bool = switch sc { case (#firm o) Measure.hasOrg(orgs, root, o); case _ true };
    let entries = if (sc == #closed) [] else Measure.entriesOf(surveys, s.id).filter(func e = own(e.root) and msMayRead(p, sc, e)).map<Types.MeasureEntry, MV.MeasureEntryView>(func e = msEntryView(p, sc, s, e));
    let snap = switch (surveys.snapshots.get(s.id)) {
      case (?xs) xs.filter(func x = own(x.root)).map<Types.SurveyPostSnap, MV.SurveyPostSnapView>(func x = msSnapView(x, s));
      case null [];
    };
    { survey = msBrief(sc, s, own); snapshot = snap; entries };
  };

  // ── Schrijven: offline-opdrachten (de wachtrij van de gsm) ──────────────
  public shared ({ caller }) func measureSync(ops : [MV.MeasureOpInput]) : async [MV.MeasureOpResult] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #measureAny, null);
    if (ops.size() > Config.maxOpsPerCall) { Runtime.trap("Hoogstens " # Config.maxOpsPerCall.toText() # " opdrachten per keer") };
    ops.map<MV.MeasureOpInput, MV.MeasureOpResult>(func i = msRun(caller, p, i));
  };

  type MsOk = (Nat, ?Nat, Text); // (opmeting, regel, opmerking)

  func msRun(caller : Principal, p : Types.Person, i : MV.MeasureOpInput) : MV.MeasureOpResult {
    if (not Reports.validKey(i.opId)) { return { opId = i.opId; outcome = #err("Deze handeling is niet geldig. Laad de pagina opnieuw"); repeated = false } };
    switch (surveys.ops.get(i.opId)) {
      case (?r) {
        if (r.by != p.id) { return { opId = i.opId; outcome = #err("Geen toegang: deze handeling hoort bij iemand anders. Laad de pagina opnieuw"); repeated = false } };
        return { opId = i.opId; outcome = #done({ surveyId = r.surveyId; entityId = r.entityId; note = r.note }); repeated = true };
      };
      case null {};
    };
    if (not Reports.validKey(i.clientKey)) { return { opId = i.opId; outcome = #err("Deze opmeting klopt niet. Laad de pagina opnieuw"); repeated = false } };
    let (kind, res) : (Text, Result.Result<MsOk, Text>) = switch (i.op) {
      case (#open x) ("open", msOpen(caller, p, i.clientKey, x.workId));
      case (#entry x) ("entry", msEntry(caller, p, i.clientKey, i.opId, x));
      case (#review x) ("review", msReview(caller, p, x.entryId, x.ok, x.note));
      case (#remove x) ("remove", msRemove(caller, p, x.entryId));
      case (#close x) ("close", msClose(caller, p, i.clientKey, x.note));
    };
    switch res {
      case (#ok((surveyId, entityId, note))) {
        let seq = Ids.next(ctr, "surveyOp");
        surveys.ops.add(i.opId, { opId = i.opId; seq; at = Time.now(); by = p.id; kind; surveyId; entityId; note });
        surveys.opOrder.add(seq, i.opId);
        { opId = i.opId; outcome = #done({ surveyId; entityId; note }); repeated = false };
      };
      // Een fout wordt niet onthouden: na een correctie (rechten, invoer) mag dezelfde opId opnieuw.
      case (#err e) { { opId = i.opId; outcome = #err(e); repeated = false } };
    };
  };

  // Mag de beller op deze werf regels invoeren (#full) of voorstellen (OA)? Geeft het bereik terug.
  func msWriteScope(p : Types.Person, workId : Nat) : Result.Result<Rights.MeasureScope, Text> {
    let sc = Rights.measureScope({ works; settings }, p, workId);
    switch sc {
      case (#full) { if (Rights.may({ works; settings }, p, #editMeasurement, ?workId)) #ok(sc) else #err("Geen toegang tot deze werf") };
      case (#firm _) { if (Measure.oaPropose(settings)) #ok(sc) else #err("Een onderaannemer mag nog niet voorstellen: vraag het aan de beheerder") };
      case _ #err("Geen toegang tot deze werf");
    };
  };

  func msNewSurvey(p : Types.Person, workId : Nat, clientKey : Text) : Types.Survey {
    let id = Ids.next(ctr, "survey");
    let number = Measure.surveysOf(surveys, workId).size() + 1;
    let s : Types.Survey = { id; workId; number; clientKey; status = #open; openedBy = p.id; openedAt = Time.now(); extra = [] };
    surveys.surveys.add(id, s);
    surveys.keys.add(clientKey, id);
    surveys.byWork.add(workId, Array.concat(switch (surveys.byWork.get(workId)) { case (?x) x; case null [] }, [id]));
    surveys.bySurvey.add(id, []);
    s;
  };

  func msOpen(caller : Principal, p : Types.Person, clientKey : Text, workId : Nat) : Result.Result<MsOk, Text> {
    switch (surveys.keys.get(clientKey)) {
      case (?id) {
        let s = surveys.surveys.get(id) ?? return #err("Onbekende opmeting");
        if (s.workId != workId) { return #err("Deze opmeting hoort bij een andere werf. Laad de pagina opnieuw") };
        switch (msWriteScope(p, workId)) { case (#err e) return #err(e); case _ {} };
        return #ok((id, null, "bestaat"));
      };
      case null {};
    };
    switch (msWriteScope(p, workId)) { case (#err e) return #err(e); case _ {} };
    if (Measure.posts(quotes, workStarts, workId).size() == 0) { return #err("Deze werf heeft geen getekende offerte met posten") };
    switch (Measure.openSurvey(surveys, workId)) {
      case (?s) { surveys.keys.add(clientKey, s.id); return #ok((s.id, null, "samengevoegd")) };
      case null {};
    };
    let s = msNewSurvey(p, workId, clientKey);
    Access.audit(audit, caller, ?p.id, ?workId, "opmeting-nieuw", msWorkCode(workId) # " opmeting " # s.number.toText());
    #ok((s.id, null, "nieuw"));
  };

  // De open opmeting waarin een nieuwe regel komt: die van de sleutel, of, als die al afgesloten is, de open opmeting van de
  // werf (zo nodig nieuw). Bool = doorgestuurd naar een volgende opmeting.
  func msTarget(caller : Principal, p : Types.Person, clientKey : Text) : Result.Result<(Types.Survey, Bool), Text> {
    let id = surveys.keys.get(clientKey) ?? return #err("Onbekende opmeting: eerst openen");
    let s = surveys.surveys.get(id) ?? return #err("Onbekende opmeting");
    switch (msWriteScope(p, s.workId)) { case (#err e) return #err(e); case _ {} };
    if (Measure.isOpen(s)) { return #ok((s, false)) };
    // De sleutel van het toestel volgt de opmeting: een volgende "afsluiten" van dit toestel sluit de opmeting waarin zijn regels staan.
    switch (Measure.openSurvey(surveys, s.workId)) {
      case (?o) { surveys.keys.add(clientKey, o.id); #ok((o, true)) };
      case null {
        let n = msNewSurvey(p, s.workId, "next-" # (Ids.current(ctr, "survey") + 1).toText() # "-" # clientKey);
        surveys.keys.add(clientKey, n.id);
        Access.audit(audit, caller, ?p.id, ?s.workId, "opmeting-nieuw", msWorkCode(s.workId) # " opmeting " # n.number.toText() # " (de vorige was afgesloten)");
        #ok((n, true));
      };
    };
  };

  func msEntry(caller : Principal, p : Types.Person, clientKey : Text, opId : Text, x : { lineId : Nat; qtyMilli : Int; day : Nat; complete : Bool; note : Text; files : [MV.MeasureFileIn]; corrects : ?Nat; reason : Text }) : Result.Result<MsOk, Text> {
    let (s, moved) = switch (msTarget(caller, p, clientKey)) { case (#ok y) y; case (#err e) return #err(e) };
    let sc = switch (msWriteScope(p, s.workId)) { case (#ok y) y; case (#err e) return #err(e) };
    let workId = s.workId;
    // De post: de lijn moet bij een offerte van deze werf horen; de sleutel is de lijn van de eerste versie.
    let line = quotes.lines.get(x.lineId) ?? return #err("Onbekende post");
    let ver = quotes.versions.get(line.versionId) ?? return #err("Onbekende post");
    let qt = quotes.quotes.get(ver.quoteId) ?? return #err("Onbekende post");
    if (qt.workId != workId) { return #err("Deze post hoort niet bij deze werf") };
    let root = WorkStart.root(quotes, x.lineId);
    let ps = Measure.posts(quotes, workStarts, workId);
    let inOffer = ps.find(func y = y.root == root);
    if (inOffer == null and x.corrects == null) { return #err("Deze post staat niet (meer) in de getekende offerte") };
    var proposedOrg : ?Nat = null;
    switch sc {
      case (#firm o) {
        let orgs = Measure.orgsByRoot(quotes, plan, library, workId, ps);
        if (not Measure.hasOrg(orgs, root, o)) { return #err("Deze post hoort niet bij jouw firma") };
        proposedOrg := ?o;
      };
      case _ {};
    };
    if (Int.abs(x.qtyMilli) > Int.abs(Config.maxMeasureQtyMilli)) { return #err("Hoeveelheid te groot") };
    let today = Reports.today();
    if (x.day < Config.minDay or x.day > today + 1 or x.day + Config.reportMaxAgeDays < today) { return #err("De datum van het meten: vandaag of de voorbije " # Config.reportMaxAgeDays.toText() # " dagen") };
    let note = x.note.trim(#char ' ');
    let reason = x.reason.trim(#char ' ');
    if (note.size() > Config.maxNote or reason.size() > Config.maxNote) { return #err("Tekst: hoogstens " # Config.maxNote.toText() # " tekens") };
    // Een correctie: een nieuwe regel met een reden; het doel moet de laatste geldige regel van dezelfde post zijn.
    switch (x.corrects) {
      case (?t) {
        if (reason.size() == 0) { return #err("Een correctie vraagt een reden") };
        let te = surveys.entries.get(t) ?? return #err("Onbekende regel om te corrigeren");
        if (te.workId != workId or te.root != root) { return #err("Deze regel hoort bij een andere post") };
        if (not Measure.isValid(te)) { return #err("Enkel een geldige regel kan gecorrigeerd worden") };
        if (Measure.correctedBy(surveys, workId, t, false) != null) { return #err("Deze regel is al gecorrigeerd: corrigeer de laatste regel van de post") };
      };
      case null {};
    };
    let myFiles = x.files;
    if (myFiles.filter(func f = f.role == #photo).size() > Config.maxMeasurePhotos or myFiles.filter(func f = f.role == #sketch).size() > 1) { return #err("Hoogstens " # Config.maxMeasurePhotos.toText() # " foto's en één schets per regel") };
    for (f in myFiles.values()) {
      switch (Reports.fileError(f.file)) { case (?e) return #err(e); case null {} };
      switch (f.thumb) { case (?t) { switch (Reports.fileError(t)) { case (?e) return #err("Voorbeeldfoto: " # e); case null {} } }; case null {} };
      if (f.caption.trim(#char ' ').size() > 200) { return #err("Bijschrift: hoogstens 200 tekens") };
    };
    if (Measure.entriesOf(surveys, s.id).size() >= Config.maxMeasureEntriesPerSurvey) { return #err("Te veel regels in deze opmeting: sluit ze af") };
    if (Measure.entriesPerPost(surveys, workId, root) >= Config.maxMeasureEntriesPerPost) { return #err("Te veel regels voor deze post") };
    let id = Ids.next(ctr, "measureEntry");
    let stored = List.empty<Types.MeasureFile>();
    for (f in myFiles.values()) {
      let fid = msFile(p, workId, id, f.file);
      let tid = switch (f.thumb) { case (?t) ?msFile(p, workId, id, t); case null null };
      stored.add({ role = f.role; fileId = fid; thumbFileId = tid; caption = f.caption.trim(#char ' ') });
    };
    let e : Types.MeasureEntry = {
      id;
      surveyId = s.id;
      workId;
      lineId = x.lineId;
      versionId = line.versionId;
      root;
      qtyMilli = x.qtyMilli;
      day = x.day;
      complete = x.complete;
      note;
      files = stored.toArray();
      corrects = x.corrects;
      reason;
      proposedOrgId = proposedOrg;
      review = null;
      blockKey = opId;
      createdAt = Time.now();
      createdBy = p.id;
      archivedAt = null;
      archivedBy = null;
      extra = [];
    };
    surveys.entries.add(id, e);
    surveys.bySurvey.add(s.id, Array.concat(switch (surveys.bySurvey.get(s.id)) { case (?l) l; case null [] }, [id]));
    Access.audit(audit, caller, ?p.id, ?workId, if (x.corrects == null) "opmeting-regel" else "opmeting-correctie", msWorkCode(workId) # " opmeting " # s.number.toText() # ": regel #" # id.toText() # (switch (x.corrects) { case (?t) " corrigeert #" # t.toText(); case null "" }) # (if (proposedOrg != null) " (voorstel van een onderaannemer)" else ""));
    // Een voorstel van een OA: de werfleider en de beheerders krijgen één melding per OA en opmeting.
    switch proposedOrg {
      case (?o) {
        let others = Measure.entriesOf(surveys, s.id).filter(func y = y.id != id and y.proposedOrgId == ?o and Measure.isPending(y)).size();
        if (others == 0) { msNotifyProposal(p, workId, o) };
      };
      case null {};
    };
    #ok((s.id, ?id, if (proposedOrg != null) "voorstel" else if moved "volgende opmeting" else ""));
  };

  func msFile(p : Types.Person, workId : Nat, entryId : Nat, f : Views.FileIn) : Nat {
    let id = Ids.next(ctr, "file");
    let ref : Types.FileRef = { id; name = f.name.trim(#char ' '); mime = f.mime; size = f.size; blob = f.blob; workId = ?workId; confidential = false; personId = p.id; at = Time.now(); var archivedAt = null };
    files.files.add(id, ref);
    surveys.fileOwners.add(id, entryId);
    id;
  };

  func msNotifyProposal(p : Types.Person, workId : Nat, orgId : Nat) {
    let text = msOrgName(?orgId) # " stelde een opmeting voor op " # msWorkCode(workId) # ": bevestig of wijs af";
    var told : [Nat] = [];
    switch (works.works.get(workId)) {
      case (?w) { switch (w.leaderPersonId) { case (?l) { if (l != p.id) { Access.notify(audit, ctr, l, "opmeting-voorstel", text, ?workId); told := [l] } }; case null {} } };
      case null {};
    };
    for (a in access.persons.values()) {
      if (a.archivedAt == null and Rights.isAdmin(a) and a.id != p.id and told.find(func t = t == a.id) == null) {
        Access.notify(audit, ctr, a.id, "opmeting-voorstel", text, ?workId);
      };
    };
  };

  func msReview(caller : Principal, p : Types.Person, entryId : Nat, ok : Bool, note : Text) : Result.Result<MsOk, Text> {
    let e = surveys.entries.get(entryId) ?? return #err("Onbekende regel");
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #editMeasurement, ?e.workId)) { return #err("Geen toegang") };
    if (e.archivedAt != null) { return #err("Deze regel is weggehaald") };
    if (e.proposedOrgId == null) { return #err("Dit is geen voorstel") };
    if (e.review != null) { return #err("Over dit voorstel is al beslist") };
    let n = note.trim(#char ' ');
    if (n.size() > Config.maxNote) { return #err("Notitie te lang") };
    if (not ok and n.size() == 0) { return #err("Geef een reden voor de afwijzing") };
    if (ok) {
      switch (e.corrects) {
        case (?t) {
          let other = Measure.correctedBy(surveys, e.workId, t, false);
          if (other != null) { return #err("De regel die dit voorstel corrigeert, is intussen al gecorrigeerd: wijs af") };
          switch (surveys.entries.get(t)) { case (?te) { if (not Measure.isValid(te)) { return #err("De regel die dit voorstel corrigeert, bestaat niet meer: wijs af") } }; case null {} };
        };
        case null {};
      };
    };
    surveys.entries.add(entryId, { e with review = ?{ by = p.id; at = Time.now(); ok; note = n } });
    Access.audit(audit, caller, ?p.id, ?e.workId, if ok "opmeting-voorstel-bevestigd" else "opmeting-voorstel-afgewezen", msWorkCode(e.workId) # ": regel #" # entryId.toText());
    if (e.createdBy != p.id) {
      Access.notify(audit, ctr, e.createdBy, "opmeting-voorstel", p.name # (if ok " bevestigde" else " wees af") # " je opmeting op " # msWorkCode(e.workId) # (if (n.size() > 0) ": " # n else ""), ?e.workId);
    };
    #ok((e.surveyId, ?entryId, ""));
  };

  func msRemove(caller : Principal, p : Types.Person, entryId : Nat) : Result.Result<MsOk, Text> {
    let e = surveys.entries.get(entryId) ?? return #err("Onbekende regel");
    let s = surveys.surveys.get(e.surveyId) ?? return #err("Onbekende opmeting");
    let sc = Rights.measureScope({ works; settings }, p, e.workId);
    // 2.12 (M3): een OA haalt enkel zijn EIGEN voorstel weg zolang het wacht; een bevestigd voorstel is een geldige regel van
    // de werfleider geworden en gaat enkel nog weg via kantoor (of met een correctie en een reden).
    let allowed = switch sc {
      case (#full) Rights.may({ works; settings }, p, #editMeasurement, ?e.workId);
      case (#firm _) e.createdBy == p.id and Measure.oaPropose(settings) and (e.archivedAt != null or Measure.isPending(e));
      case _ false;
    };
    if (not allowed) { return #err("Geen toegang") };
    if (e.archivedAt != null) { return #ok((s.id, ?entryId, "al weggehaald")) };
    if (not Measure.isOpen(s)) { return #err("Deze opmeting is afgesloten: corrigeer met een nieuwe regel en een reden") };
    if (Measure.correctedBy(surveys, e.workId, entryId, true) != null) { return #err("Er is een correctie van deze regel: haal eerst die weg") };
    surveys.entries.add(entryId, { e with archivedAt = ?Time.now(); archivedBy = ?p.id });
    Access.audit(audit, caller, ?p.id, ?e.workId, "opmeting-regel-weg", msWorkCode(e.workId) # " opmeting " # s.number.toText() # ": regel #" # entryId.toText());
    #ok((s.id, ?entryId, ""));
  };

  func msClose(caller : Principal, p : Types.Person, clientKey : Text, note : Text) : Result.Result<MsOk, Text> {
    let id = surveys.keys.get(clientKey) ?? return #err("Onbekende opmeting: eerst openen");
    let s0 = surveys.surveys.get(id) ?? return #err("Onbekende opmeting");
    if (not Rights.may({ works; settings }, p, #editMeasurement, ?s0.workId)) { return #err("Geen toegang") };
    // Was de opmeting van deze sleutel al afgesloten (ander toestel), dan is er niets te doen.
    if (not Measure.isOpen(s0)) { return #ok((s0.id, null, "al afgesloten")) };
    let s = s0;
    let n = note.trim(#char ' ');
    if (n.size() > Config.maxNote) { return #err("Notitie te lang") };
    let es = Measure.entriesOf(surveys, s.id);
    if (es.any(func e = Measure.isPending(e))) { return #err("Beslis eerst over de voorstellen van de onderaannemers") };
    if (not es.any(Measure.isValid)) { return #err("Er is nog niets opgemeten") };
    // De stand per post vastleggen: VH van nu, gemeten tot en met deze opmeting, wat er in deze opmeting bijkwam.
    let ps = Measure.posts(quotes, workStarts, s.workId);
    let agg = Measure.aggregate(surveys, s.workId, ?s.number);
    let delta = Map.empty<Nat, Int>();
    for (e in es.values()) { if (Measure.isValid(e)) { delta.add(e.root, (switch (delta.get(e.root)) { case (?d) d; case null 0 }) + Measure.contribution(surveys, e)) } };
    let snap = List.empty<Types.SurveyPostSnap>();
    let seen = Map.empty<Nat, Bool>();
    for (x in ps.values()) {
      let a = switch (agg.get(x.root)) { case (?a) a; case null { { measured = 0; closed = 0; count = 0; pending = 0; pendingMilli = 0; lastDay = null; complete = false; lastId = 0 } } };
      seen.add(x.root, true);
      snap.add({ root = x.root; lineId = x.line.id; versionId = x.version.id; vhMilli = x.line.qtyMilli; unit = x.line.unit; measuredMilli = a.measured; deltaMilli = switch (delta.get(x.root)) { case (?d) d; case null 0 }; complete = a.complete });
    };
    for ((r, a) in agg.entries()) {
      if (not seen.containsKey(r)) {
        // Een post die niet meer in de getekende versie staat maar waarvoor gemeten is: met de lijn van de laatste regel.
        switch (msLastEntryOf(s.workId, r)) {
          case (?le) {
            let l = quotes.lines.get(le.lineId);
            snap.add({ root = r; lineId = le.lineId; versionId = le.versionId; vhMilli = switch l { case (?x) x.qtyMilli; case null 0 }; unit = switch l { case (?x) x.unit; case null "" }; measuredMilli = a.measured; deltaMilli = switch (delta.get(r)) { case (?d) d; case null 0 }; complete = a.complete });
          };
          case null {};
        };
      };
    };
    surveys.snapshots.add(s.id, snap.toArray());
    surveys.surveys.add(s.id, { s with status = #closed({ by = p.id; at = Time.now(); note = n; thresholdBp = Measure.thresholdBp(settings) }) });
    Access.audit(audit, caller, ?p.id, ?s.workId, "opmeting-afgesloten", msWorkCode(s.workId) # " opmeting " # s.number.toText() # " (" # es.filter(Measure.isValid).size().toText() # " regels)");
    #ok((s.id, null, ""));
  };

  func msLastEntryOf(workId : Nat, root : Nat) : ?Types.MeasureEntry {
    var last : ?Types.MeasureEntry = null;
    for (s in Measure.surveysOf(surveys, workId).values()) {
      for (e in Measure.entriesOf(surveys, s.id).values()) { if (e.root == root) { last := ?e } };
    };
    last;
  };

  // ── Views ───────────────────────────────────────────────────────────────
  func msWorkCode(w : Nat) : Text { switch (works.works.get(w)) { case (?x) x.code; case null "#" # w.toText() } };
  func msOrgName(o : ?Nat) : Text { switch o { case (?x) { switch (org.orgs.get(x)) { case (?y) y.name; case null "#" # x.toText() } }; case null "BOWACO" } };
  func msScopeText(sc : Rights.MeasureScope) : Text { switch sc { case (#full) "full"; case (#firm _) "firm"; case (#closed) "closed"; case (#none) "none" } };

  // De posten die de beller mag zien: alle (full, closed) of enkel die van zijn firma.
  func msVisiblePosts(p : Types.Person, sc : Rights.MeasureScope, workId : Nat) : [Measure.Post] {
    let ps = Measure.posts(quotes, workStarts, workId);
    switch sc {
      case (#firm o) {
        let orgs = Measure.orgsByRoot(quotes, plan, library, workId, ps);
        ps.filter(func x = Measure.hasOrg(orgs, x.root, o));
      };
      case (#none) [];
      case _ ps;
    };
  };

  // Mag de beller deze regel zien? full: alles. firm: de geldige regels en de voorstellen van zijn eigen firma.
  func msMayRead(p : Types.Person, sc : Rights.MeasureScope, e : Types.MeasureEntry) : Bool {
    switch sc {
      case (#full) true;
      case (#firm o) e.archivedAt == null and (e.proposedOrgId == null or e.proposedOrgId == ?o);
      case _ false;
    };
  };

  func msSummary(p : Types.Person, sc : Rights.MeasureScope, workId : Nat) : MV.MeasureSummaryView {
    let w = switch (works.works.get(workId)) { case (?x) x; case null Runtime.trap("Geen toegang") };
    let allPosts = Measure.posts(quotes, workStarts, workId);
    let orgs = switch sc { case (#firm _) Measure.orgsByRoot(quotes, plan, library, workId, allPosts); case _ Map.empty<Nat, [Nat]>() };
    let own = func(root : Nat) : Bool = switch sc { case (#firm o) Measure.hasOrg(orgs, root, o); case _ true };
    let ps = allPosts.filter(func x = own(x.root));
    let agg = Measure.aggregate(surveys, workId, null);
    let thr = Measure.thresholdBp(settings);
    let closedScope = (sc == #closed);
    let posts = List.empty<MV.MeasurePostView>();
    var measuredPosts = 0;
    var completePosts = 0;
    var more = 0;
    var less = 0;
    var pendingAll = 0;
    func add(root : Nat, line : Types.QuoteLine, versionId : Nat, qlabel : Text, versionNo : Nat, chapter : ?Types.QuoteChapter, option : Bool, inOffer : Bool) {
      let a = switch (agg.get(root)) { case (?a) a; case null { { measured = 0; closed = 0; count = 0; pending = 0; pendingMilli = 0; lastDay = null; complete = false; lastId = 0 } } };
      let m = if (closedScope) a.closed else a.measured;
      let (diff, bp, flag) = Measure.compare(line.qtyMilli, m, a.count, a.complete, thr);
      if (a.count > 0) { measuredPosts += 1 };
      if (a.count > 0 and a.complete) { completePosts += 1 };
      if (flag == #more) { more += 1 } else if (flag == #less) { less += 1 };
      pendingAll += a.pending;
      posts.add({
        root;
        lineId = line.id;
        versionId;
        quoteNumber = qlabel;
        versionNo;
        chapterCode = switch chapter { case (?c) c.code; case null "" };
        chapterTitle = switch chapter { case (?c) c.title; case null "" };
        code = line.code;
        title = line.title;
        unit = line.unit;
        form = line.form;
        option;
        inOffer;
        vhMilli = line.qtyMilli;
        measuredMilli = m;
        closedMilli = a.closed;
        diffMilli = diff;
        diffBp = bp;
        flag;
        complete = a.complete;
        entryCount = a.count;
        pendingCount = if (closedScope) 0 else a.pending;
        pendingMilli = if (closedScope) 0 else a.pendingMilli;
        lastDay = a.lastDay;
      });
    };
    let seen = Map.empty<Nat, Bool>();
    for (x in allPosts.values()) { seen.add(x.root, true) };
    for (x in ps.values()) { add(x.root, x.line, x.version.id, x.quote.number, x.version.version, x.chapter, x.option, true) };
    // Posten die niet meer in de getekende versie staan maar waarvoor wel gemeten is (enkel de ruimere bereiken).
    if (sc == #full or closedScope) {
      for ((r, _) in agg.entries()) {
        if (not seen.containsKey(r)) {
          switch (msLastEntryOf(workId, r)) {
            case (?le) {
              switch (quotes.lines.get(le.lineId)) {
                case (?l) {
                  let v = quotes.versions.get(l.versionId);
                  let q = switch v { case (?vv) quotes.quotes.get(vv.quoteId); case null null };
                  add(r, l, l.versionId, switch q { case (?qq) qq.number; case null "" }, switch v { case (?vv) vv.version; case null 0 }, quotes.chapters.get(l.chapterId), l.kind == #option, false);
                };
                case null {};
              };
            };
            case null {};
          };
        };
      };
    };
    let svs = Measure.surveysOf(surveys, workId);
    let briefs = svs.filter(func s = not closedScope or not Measure.isOpen(s)).map<Types.Survey, MV.SurveyBrief>(func s = msBrief(sc, s, own));
    let quoteLabels = List.empty<Text>();
    for (x in ps.values()) {
      let l = Measure.versionLabel(x);
      if (not quoteLabels.contains(Text.equal, l)) { quoteLabels.add(l) };
    };
    let canReview = sc == #full and Rights.may({ works; settings }, p, #editMeasurement, ?workId);
    {
      workId;
      workCode = w.code;
      workName = w.name;
      scope = msScopeText(sc);
      canWrite = switch sc { case (#full) canReview; case (#firm _) Measure.oaPropose(settings); case _ false };
      canPropose = switch sc { case (#firm _) Measure.oaPropose(settings); case _ false };
      canReview;
      thresholdBp = thr;
      orgName = switch sc { case (#firm o) msOrgName(?o); case _ "" };
      posts = posts.toArray();
      surveys = briefs;
      openSurveyId = if closedScope null else (switch (Measure.openSurvey(surveys, workId)) { case (?s) ?s.id; case null null });
      totals = { posts = posts.size(); measuredPosts; completePosts; moreCount = more; lessCount = less; openProposals = if (sc == #full) pendingAll else 0 };
      quotes = quoteLabels.toArray();
      note = if (allPosts.size() == 0) "geen getekende offerte" else if (ps.size() == 0) "geen posten voor jouw firma" else "";
    };
  };

  func msBrief(sc : Rights.MeasureScope, s : Types.Survey, own : Nat -> Bool) : MV.SurveyBrief {
    let es = if (sc == #closed) [] else Measure.entriesOf(surveys, s.id).filter(func e = own(e.root) and (Measure.isValid(e) or Measure.isPending(e)));
    let (open, closedAt, closedBy, closeNote, thr) = switch (s.status) {
      case (#open) (true, null, "", "", null);
      case (#closed c) (false, ?c.at, Access.personName(access, c.by), c.note, ?c.thresholdBp);
    };
    {
      id = s.id;
      number = s.number;
      open;
      openedAt = s.openedAt;
      openedByName = Access.personName(access, s.openedBy);
      closedAt;
      closedByName = closedBy;
      closeNote = if (sc == #closed) "" else closeNote;
      thresholdBp = thr;
      entryCount = es.size();
      pendingCount = if (sc == #full) es.filter(Measure.isPending).size() else 0;
    };
  };

  func msEntryView(p : Types.Person, sc : Rights.MeasureScope, s : Types.Survey, e : Types.MeasureEntry) : MV.MeasureEntryView {
    let own = e.createdBy == p.id;
    let status = if (e.proposedOrgId == null) "geldig" else switch (e.review) { case (?r) { if (r.ok) "geldig" else "afgewezen" }; case null "voorstel" };
    let superseded = Measure.isValid(e) and Measure.correctedBy(surveys, e.workId, e.id, false) != null;
    let fileView = func(id : Nat) : ?Views.FileView = switch (files.files.get(id)) { case (?f) ?Dossier.fileView(f); case null null };
    let fv = List.empty<MV.MeasureFileView>();
    for (f in e.files.values()) {
      switch (fileView(f.fileId)) {
        case (?v) { fv.add({ role = f.role; file = v; thumb = switch (f.thumbFileId) { case (?t) fileView(t); case null null }; caption = f.caption }) };
        case null {};
      };
    };
    let open = Measure.isOpen(s);
    let canEdit = (sc == #full and Rights.may({ works; settings }, p, #editMeasurement, ?e.workId)) or (switch sc { case (#firm _) Measure.oaPropose(settings); case _ false });
    {
      id = e.id;
      surveyId = s.id;
      surveyNumber = s.number;
      surveyClosed = not open;
      root = e.root;
      lineId = e.lineId;
      qtyMilli = e.qtyMilli;
      contributionMilli = Measure.contribution(surveys, e);
      day = e.day;
      complete = e.complete;
      // Notities zijn intern: een OA leest enkel zijn eigen notitie.
      note = if (sc == #full or own) e.note else "";
      files = fv.toArray();
      corrects = e.corrects;
      reason = if (sc == #full or own) e.reason else "";
      status;
      proposedByOrg = switch (e.proposedOrgId) { case (?o) msOrgName(?o); case null "" };
      reviewedByName = switch (e.review) { case (?r) Access.personName(access, r.by); case null "" };
      reviewedAt = switch (e.review) { case (?r) ?r.at; case null null };
      reviewNote = switch (e.review) { case (?r) r.note; case null "" };
      byName = Access.personName(access, e.createdBy);
      createdAt = e.createdAt;
      blockKey = e.blockKey;
      superseded;
      archived = e.archivedAt != null;
      canRemove = e.archivedAt == null and open and canEdit and (sc == #full or own) and Measure.correctedBy(surveys, e.workId, e.id, true) == null;
      canCorrect = canEdit and Measure.isValid(e) and not superseded and e.archivedAt == null;
    };
  };

  func msSnapView(x : Types.SurveyPostSnap, s : Types.Survey) : MV.SurveyPostSnapView {
    let (diff, bp, flag) = Measure.compare(x.vhMilli, x.measuredMilli, if (x.measuredMilli != 0 or x.deltaMilli != 0 or x.complete) 1 else 0, x.complete, switch (s.status) { case (#closed c) c.thresholdBp; case _ Measure.thresholdBp(settings) });
    let line = quotes.lines.get(x.lineId);
    let ver = quotes.versions.get(x.versionId);
    let qt = switch ver { case (?v) quotes.quotes.get(v.quoteId); case null null };
    {
      root = x.root;
      lineId = x.lineId;
      quoteNumber = switch qt { case (?q) q.number; case null "" };
      chapterCode = switch line { case (?l) { switch (quotes.chapters.get(l.chapterId)) { case (?c) c.code; case null "" } }; case null "" };
      code = switch line { case (?l) l.code; case null "" };
      title = switch line { case (?l) l.title; case null "" };
      unit = x.unit;
      vhMilli = x.vhMilli;
      measuredMilli = x.measuredMilli;
      deltaMilli = x.deltaMilli;
      diffMilli = diff;
      diffBp = bp;
      flag;
      complete = x.complete;
    };
  };
};
