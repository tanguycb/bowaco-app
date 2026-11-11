// OA-offerte inlezen (stap 3.8, bouwplan §6 "Twee wegen voor AI", "Bots via MCP", "Autonomie per taak"). Enkel kantoor met het volle
// zicht op de werf én de bedragen (#editTenders + #readCosts, tenderScope #full; zoals registerOaQuote, R36 en R38):
// - startOaRead: een inleesopdracht voor een bot (PDF of foto; de bot leest via MCP: inleesopdrachten, inleesbestand,
//   voorstel_oa_offerte) of voor Caffeine AI (de tekst van de offerte; Caffeine leest geen PDF of foto);
// - runOaReadAi: de Caffeine-weg, één oproep per opdracht (AI-logboek zonder inhoud, budget per maand, testmodus = droog voorbeeld);
// - readOaRead: het voorstel met de bedragen (update-call met auditregel "bekeek:oa-inlezen:<id>", zonder bedrag);
// - finishOaRead: na het registreren in het formulier (geregistreerd), afwijzen of annuleren. De inhoud gaat dan weg.
// Het voorstel wijzigt zelf nooit iets: kantoor neemt het over in het formulier en registreert met registerOaQuote. Enkel een bot
// op Zelf doen (na een geslaagde proefronde) laat de app de offerte meteen registreren (lib/Bots.mo).
// Private hulpfuncties dragen het voorvoegsel `or` (ze delen één blok met alle andere mixins).
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Int "mo:core/Int";
import Map "mo:core/Map";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Json "mo:jayson/Json";
import Types "../types";
import OV "../types/oareadviews";
import TV "../types/tenderviews";
import Access "../lib/Access";
import AiPrompts "../lib/AiPrompts";
import Config "../lib/Config";
import Ids "../lib/Ids";
import OaQuotes "../lib/OaQuotes";
import Post "../lib/Post";
import OaRead "../lib/OaRead";
import Rights "../lib/Rights";
import Tenders "../lib/Tenders";
import Caffeine "../lib/ai/Caffeine";
import Connector "../lib/ai/Connector";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  oa : Types.OaState,
  works : Types.WorksState,
  files : Types.FileState,
  quotes : Types.QuotesState,
  tenders : Types.TenderState,
  robot : Types.RobotState,
  ai : Types.AiState,
  bots : Types.BotState,
  oaRead : Types.OaReadState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  isAiLive : () -> Bool,
  syncTasks : () -> (), // 4b.5: het model van taak en voorstel gelijkzetten na een wijziging (lib/Tasks.mo)
) {

  func orOffice(p : Types.Person, workId : Nat) : Bool {
    let ctx = { works; settings };
    Rights.may(ctx, p, #editTenders, null) and Rights.may(ctx, p, #readCosts, null) and Rights.tenderScope(ctx, p, workId) == #full;
  };
  func orRequire(p : Types.Person) {
    let ctx = { works; settings };
    Rights.require(ctx, p, #editTenders, null);
    Rights.require(ctx, p, #readCosts, null);
  };
  // Een onbekend nummer zegt "Onbekende opdracht" (pas na orRequire: enkel kantoor); een opdracht van een werf die deze persoon niet
  // volledig ziet: "Geen toegang".
  func orJob(p : Types.Person, id : Nat) : { #ok : Types.OaReadJob; #err : Text } {
    let j = oaRead.jobs.get(id) ?? return #err("Onbekende opdracht");
    if (orOffice(p, j.workId)) #ok(j) else #err("Geen toegang");
  };
  func orOrgName(id : Nat) : Text { switch (org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };

  func orBrief(j : Types.OaReadJob) : OV.OaReadBrief {
    let (way, botId, botName) = switch (j.via) {
      case (#bot(b)) ("bot", ?b, switch (bots.bots.get(b)) { case (?x) x.name; case null "bot #" # b.toText() });
      case (#ai) ("caffeine", null, "Caffeine");
      case (#other(t)) (t, null, "");
    };
    {
      id = j.id;
      workId = j.workId;
      orgId = j.orgId;
      orgName = orOrgName(j.orgId);
      tenderId = j.tenderId;
      tenderCode = switch (j.tenderId) { case (?t) switch (tenders.tenders.get(t)) { case (?x) x.code; case null "" }; case null "" };
      inviteId = j.inviteId;
      name = j.name;
      mime = j.mime;
      size = j.size;
      way;
      botId;
      botName;
      status = OaRead.statusKey(j.status);
      reason = switch (j.status) { case (#rejected r) r; case (#failed r) r; case _ OaRead.extraGet(j.extra, "zelfMislukt") ?? "" };
      oaQuoteId = switch (j.status) { case (#applied q) ?q; case _ null };
      fileId = j.fileId;
      auto = OaRead.extraGet(j.extra, "zelf") == ?"1";
      createdAt = j.createdAt;
      createdByName = Access.personName(access, j.createdBy);
      hasProposal = j.proposal != null;
    };
  };

  // ── Starten ───────────────────────────────────────────────────────────
  public shared ({ caller }) func startOaRead(i : OV.OaReadStart) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    if (not orOffice(p, i.workId)) { return #err("Geen toegang") };
    var tenderId : ?Nat = null;
    switch (i.inviteId) {
      case (?iid) {
        let inv = tenders.invites.get(iid) ?? return #err("Geen toegang");
        let t = tenders.tenders.get(inv.tenderId) ?? return #err("Geen toegang");
        if (t.workId != i.workId or inv.orgId != i.orgId) { return #err("Werf of firma klopt niet met de uitnodiging") };
        if (t.status != #open) { return #err("De prijsvraag is " # Tenders.statusText(t.status) # ": inlezen kan enkel zolang ze loopt") };
        tenderId := ?t.id;
      };
      case null {
        switch (org.orgs.get(i.orgId)) {
          case (?o) { if (o.archivedAt != null or (o.kind != #subcontractor and o.kind != #supplier)) { return #err("Kies een onderaannemer of leverancier") } };
          case null { return #err("Onbekende firma") };
        };
      };
    };
    let name = Access.cleanText(OaRead.txt(i.name, 200), 200) ?? return #err("Bestandsnaam: 1 tot 200 tekens");
    if (i.content.size() == 0) { return #err("Het bestand of de tekst is leeg") };
    let via : Types.OaReadVia = switch (i.way) {
      case (#ai) {
        if (i.mime != "text/plain") { return #err("Caffeine AI leest enkel tekst: plak de tekst van de offerte") };
        if (i.blob != null) { return #err("Tekst gaat niet in de opslag") };
        let t = i.content.decodeUtf8() ?? return #err("De tekst is geen geldige UTF-8");
        if (t.size() > Config.oaReadMaxText) { return #err("Hoogstens " # Config.oaReadMaxText.toText() # " tekens tekst") };
        if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
        #ai;
      };
      case (#bot(id)) {
        if (not OaRead.fileMimeOk(i.mime)) { return #err("Enkel een PDF of een foto (JPEG, PNG, WebP)") };
        if (i.content.size() > Config.oaReadMaxBytes) { return #err("Te groot om in te lezen (hoogstens 1,35 MB): vul de offerte met de hand in") };
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        let ctx = { works; settings };
        if (not Rights.mayBot(ctx, b, "inleesbestand", ?i.workId) or not Rights.mayBot(ctx, b, "voorstel_oa_offerte", ?i.workId)) {
          return #err("Deze bot mag deze offerte niet inlezen: zet inleesopdrachten, inleesbestand, voorstel_oa_offerte en deze werf op zijn fiche");
        };
        #bot(id);
      };
    };
    if (OaRead.openOnWork(oaRead, i.workId) >= Config.oaReadMaxOpenPerWork) { return #err("Te veel open inleesopdrachten op deze werf; sluit er eerst af") };
    if (oaRead.jobs.size() >= Config.oaReadMaxJobs) { return #err("Te veel inleesopdrachten") };
    if (OaRead.liveBytes(oaRead) + i.content.size() > Config.oaReadMaxLiveBytes) { return #err("Te veel open inleesopdrachten in de app; sluit er eerst af") };
    let now = Time.now();
    // Het bestand ook in de opslag (vertrouwelijk aan de werf), zodat het straks aan de geregistreerde offerte hangt.
    let fileId : ?Nat = switch (i.blob) {
      case (?bl) {
        if (bl.size() == 0 or bl.size() > 200) { return #err("Het bestand klopt niet") };
        if (files.files.values().filter(func(x : Types.FileRef) : Bool = x.personId == p.id).size() >= Config.maxFilesPerPerson) { return #err("De opslagruimte is vol. Neem contact op met de beheerder") };
        let fid = Ids.next(ctr, "file");
        let fr : Types.FileRef = { id = fid; name; mime = i.mime; size = i.content.size(); blob = bl; workId = ?i.workId; confidential = true; personId = p.id; at = now; var archivedAt = null };
        files.files.add(fid, fr);
        ?fid;
      };
      case null null;
    };
    let id = Ids.next(ctr, "oaRead");
    let job : Types.OaReadJob = { id; workId = i.workId; orgId = i.orgId; tenderId; inviteId = i.inviteId; fileId; name; mime = i.mime; size = i.content.size(); via; createdAt = now; createdBy = p.id; var status = #open; var proposal = null; var decidedAt = null; var decidedBy = null; var extra = [] };
    oaRead.jobs.add(id, job);
    OaRead.addIndex(oaRead, i.workId, id);
    oaRead.content.add(id, i.content);
    syncTasks();
    Access.audit(audit, caller, ?p.id, ?i.workId, "oa-inlezen-start", "opdracht #" # id.toText() # " " # orOrgName(i.orgId) # " via " # (switch via { case (#bot(b)) "bot #" # b.toText(); case _ "Caffeine AI" }));
    #ok(id);
  };

  // ── Lezen ─────────────────────────────────────────────────────────────
  // De bots die op deze werf een offerte mogen inlezen (naam en id; geen fiche). Voor kantoor dat een opdracht geeft.
  public query ({ caller }) func listOaReadBots(workId : Nat) : async [OV.OaReadBot] {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    if (not orOffice(p, workId)) { Runtime.trap("Geen toegang") };
    let ctx = { works; settings };
    bots.bots.values().filter(func(b : Types.Bot) : Bool = Rights.mayBot(ctx, b, "inleesbestand", ?workId) and Rights.mayBot(ctx, b, "voorstel_oa_offerte", ?workId)).map(func(b : Types.Bot) : OV.OaReadBot = { id = b.id; name = b.name }).toArray();
  };

  // Caffeine AI voor deze taak: ingericht en aan? (Enkel ja/nee, geen budget of model.)
  public query ({ caller }) func oaReadAiReady() : async Bool {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    if (not Rights.may({ works; settings }, p, #useAi, null)) return false;
    switch (ai.workers.get("oa-offerte-inlezen")) { case (?w) w.enabled; case null false };
  };

  public query ({ caller }) func listOaReads(workId : Nat) : async [OV.OaReadBrief] {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    if (not orOffice(p, workId)) { Runtime.trap("Geen toegang") };
    OaRead.jobsOf(oaRead, workId).reverse().map<Types.OaReadJob, OV.OaReadBrief>(orBrief);
  };

  public shared ({ caller }) func readOaRead(id : Nat) : async Result.Result<OV.OaReadFull, Text> {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    let j = switch (orJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    Access.audit(audit, caller, ?p.id, ?j.workId, "bekeek:oa-inlezen:" # id.toText(), orOrgName(j.orgId) # " · " # OaRead.statusKey(j.status));
    #ok({ brief = orBrief(j); proposal = j.proposal });
  };

  // ── Caffeine AI-weg (de tekst) ────────────────────────────────────────
  func orAiReal() : Bool { isAiLive() and settings.values.get("ai.testmodus") == ?"uit" };

  func orContext(j : Types.OaReadJob) : Text {
    var t = "Firma: " # orOrgName(j.orgId) # "\n";
    switch (j.tenderId) {
      case (?tid) {
        t #= "Posten van de prijsvraag (postId · hoofdstuk · omschrijving · eenheid · hoeveelheid):\n";
        for (x in Tenders.itemsOf(tenders, tid).values()) {
          t #= x.id.toText() # " · " # x.chapter # " · " # (if (x.code != "") x.code # " " else "") # x.title # " · " # x.unit # " · " # Int.toText(x.qtyMilli / 1000) # "\n";
        };
      };
      case null { t #= "Losse offerte (geen prijsvraag): enkel eigen regels, postId altijd null.\n" };
    };
    // 3.12 (review L): ook de firmanaam en de titels van de posten kunnen geen blok openen of sluiten.
    AiPrompts.fence(t);
  };

  public shared ({ caller }) func runOaReadAi(id : Nat) : async Result.Result<OV.OaReadAiStep, Text> {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
    let j = switch (orJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (j.via != #ai) { return #err("Deze opdracht leest een bot") };
    if (j.status != #open) { return #err("Deze opdracht heeft al een voorstel of is afgesloten") };
    let text = switch (oaRead.content.get(j.id)) { case (?b) b.decodeUtf8() ?? ""; case null "" };
    if (text == "") { return #err("Geen tekst") };
    let w = ai.workers.get("oa-offerte-inlezen") ?? return #err("De AI-medewerker voor OA-offertes is nog niet ingericht (Beheer → AI-medewerkers)");
    let v = AiPrompts.version(w.key, w.instructionVersion) ?? return #err("Onbekende instructieversie");
    // Review 3.8 L4: de tekst van de OA kan het afgebakende blok niet sluiten.
    let userText = AiPrompts.proofUser(orContext(j), text);
    if (userText.size() > Config.aiMaxInputBytes) { return #err("Te groot om via Caffeine te lezen; laat een bot het doen") };
    let live = orAiReal();
    // Eén oproep tegelijk per opdracht (het merk vervalt na 5 min).
    let now0 = Time.now();
    switch (OaRead.extraGet(j.extra, "bezig")) {
      case (?t) { switch (Int.fromText(t)) { case (?at) { if (now0 - at < 300_000_000_000) return #err("Deze opdracht wordt al ingelezen; wacht even") }; case null {} } };
      case null {};
    };
    // Review 4b.5 L1: het model volgt het merk "bezig" meteen (ook als de oproep daarna mislukt).
    let unmark = func() { j.extra := j.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "bezig"); syncTasks() };
    let content : Text = if (not live) v.dryRun else {
      if (not w.enabled or w.budgetMonthCents == 0) { return #err(w.name # " staat uit (Beheer → AI-medewerkers)") };
      if (not ai.models.containsKey(w.modelAlias)) { return #err("Het model van de fiche staat niet in de catalogus") };
      if (ai.runningByPerson.containsKey(p.id)) { return #err("Je hebt al een oproep lopen; wacht even") };
      if (ai.runningByPerson.size() >= Config.aiMaxConcurrent) { return #err("Druk bezig, probeer zo meteen") };
      j.extra := OaRead.extraSet(j.extra, "bezig", Int.toText(now0));
      syncTasks();
      let e = { settings; access; robot; ai; audit; ctr };
      let now = Time.now();
      let reserve = switch (Connector.reserve(e, w, caller, ?p.id, ?j.workId, now)) { case (#ok x) x; case (#err t) { unmark(); return #err(t) } };
      let call = Connector.newCall(e, w, #caffeine, #user(p.id), ?p.id, ?j.workId, w.modelAlias, Connector.sha(userText), userText.size(), reserve, false, now);
      call.extra := [("inleesopdracht", j.id.toText())];
      ai.runningByPerson.add(p.id, call.id);
      let out = await* Caffeine.chat<system>(w.modelAlias, v, userText);
      if (ai.runningByPerson.get(p.id) == ?call.id) ai.runningByPerson.remove(p.id);
      unmark();
      // R33: na de await opnieuw: nog kantoor op die werf met AI, opdracht nog open.
      let still = switch (Access.activePerson(access, caller)) { case (?q) orOffice(q, j.workId) and Rights.may({ works; settings }, q, #useAi, null); case null false };
      switch (Connector.finishRaw(e, call, v, out, still and j.status == #open, caller, "inlezen", Config.oaReadAnswerBytes)) { case (#ok t) t; case (#err m) return #err(m) };
    };
    if (j.status != #open) { return #err("De opdracht veranderde intussen") };
    let parsed = switch (Json.parse(content)) { case (?x) OaRead.parse(x, OaRead.itemsOf(tenders, j), Time.now(), [("ai", w.modelAlias)].concat(if live [] else [("droog", "1")])); case null #err("onleesbaar antwoord") };
    switch parsed {
      case (#ok prop) {
        j.proposal := ?prop;
        j.status := #proposed;
        syncTasks();
        Access.audit(audit, caller, ?p.id, ?j.workId, "oa-inlezen-voorstel", "opdracht #" # j.id.toText() # " (Caffeine AI" # (if live ")" else ", testmodus)"));
        #ok({ status = "voorstel"; dry = not live });
      };
      case (#err m) {
        OaRead.close(oaRead, j, #failed("het antwoord was onbruikbaar: " # Text.fromIter(m.chars().take(120))), ?p.id, Time.now());
        syncTasks();
        #ok({ status = "mislukt"; dry = not live });
      };
    };
  };

  // ── Overnemen = registreren (één update-call, review 3.8 M1/M3) ───────
  // Het formulier (HandSheet met het voorstel) stuurt de offerte zoals kantoor ze nakeek. In één keer: dezelfde controles als
  // registerOaQuote (OaQuotes.prepare), registreren met het bestand van de opdracht en het merk "inlezen" (nooit in een testset),
  // de opdracht sluiten en het voorstel van de bot volgen. Werf, firma en uitnodiging moeten die van de opdracht zijn.
  public shared ({ caller }) func applyOaRead(id : Nat, i : TV.OaQuoteInput, expectNetCents : Int) : async Result.Result<TV.OaQuoteSaved, Text> {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    let j = switch (orJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (j.status != #proposed or j.proposal == null) { return #err("Deze opdracht heeft geen voorstel (meer)") };
    if (i.workId != j.workId or i.orgId != j.orgId or i.inviteId != j.inviteId) { return #err("Werf, firma of prijsvraag klopt niet met de opdracht") };
    if (i.source != #hand) { return #err("Een ingelezen offerte registreer je met de hand") };
    if (i.file != null and j.fileId != null) { return #err("Het bestand van de opdracht hangt al aan de offerte") };
    let tctx : Tenders.Ctx = { settings; access; org; oa; works; quotes; files };
    let pr = switch (OaQuotes.prepare(settings, org, tenders, tctx, func(w : Nat) : Bool = orOffice(p, w), i, Post.local(Time.now()).day)) { case (#ok x) x; case (#err e) return #err(e) };
    if (pr.net != expectNetCents) { return #err("Het totaal klopt niet met wat de server rekent: laad opnieuw (niets bewaard)") };
    let now = Time.now();
    let fileId : ?Nat = switch (i.file, j.fileId) {
      case (_, ?f) ?f;
      case (?f, null) {
        if (f.mime != "application/pdf") { return #err("Enkel een PDF") };
        if (f.size == 0 or f.size > Config.maxFileBytes or f.blob.size() > 200) { return #err("Het bestand klopt niet") };
        let fid = Ids.next(ctr, "file");
        let fr : Types.FileRef = { id = fid; name = Access.cleanText(f.name, 200) ?? "offerte"; mime = f.mime; size = f.size; blob = f.blob; workId = ?i.workId; confidential = true; personId = p.id; at = now; var archivedAt = null };
        files.files.add(fid, fr);
        ?fid;
      };
      case (null, null) null;
    };
    let via = switch (j.via) { case (#bot(b)) "bot:" # b.toText(); case _ "ai" };
    let (qid, version) = OaQuotes.store(tenders, ctr, i, pr, fileId, p.id, now, [("inlezen", j.id.toText()), ("inlezenVia", via)]);
    // 4b.6 aanpassen vóór aanvaarden: welke punten van het voorstel kantoor anders registreerde (enkel de sleutels, geen bedragen).
    switch (j.proposal) {
      case (?prop) {
        // Review 4b.6 L2: regels = aantal, omschrijving, hoeveelheid of eenheidsprijs anders; het totaal enkel als kantoor een totaal
        // of hoofdstuktotalen registreerde die afwijken (bij posten volgt het totaal de regels: dan geldt "regels").
        let sameLines = switch (i.prices) {
          case (#lines ls) ls.size() == prop.lines.size() and Array.tabulate<Bool>(ls.size(), func(k) = ls[k].description == prop.lines[k].description and ls[k].qtyMilli == prop.lines[k].qtyMilli and ls[k].unitCents == prop.lines[k].unitCents).all(func(x : Bool) : Bool = x);
          case _ prop.lines.size() == 0;
        };
        let totalDiff = switch (i.prices) { case (#lines _) not sameLines; case _ prop.totalCents != ?pr.net };
        let changed = [
          (if (not sameLines) "regels" else ""),
          (if (prop.quoteDay != ?i.quoteDay) "datum" else ""),
          (if (prop.reverse != ?i.reverse) "btw-verlegd" else ""),
          (if (totalDiff) "totaal" else ""),
        ].filter(func(k : Text) : Bool = k != "");
        if (changed.size() > 0) j.extra := OaRead.extraSet(j.extra, "aangepast", Text.join(changed.values(), ","));
      };
      case null {};
    };
    OaRead.close(oaRead, j, #applied(qid), ?p.id, now);
    orFollow(j, #accepted, p.id, now);
    syncTasks();
    Access.audit(audit, caller, ?p.id, ?j.workId, "oa-offerte-geregistreerd", (switch (pr.tender) { case (?t) t.code # ": "; case null "los: " }) # orOrgName(i.orgId) # " versie " # version.toText() # " (ingelezen, opdracht #" # j.id.toText() # ", " # pr.form # ", " # pr.lines.size().toText() # " regels)");
    #ok({ oaQuoteId = qid; version; netCents = pr.net });
  };

  // Het voorstel van de bot (Voorstellen en acties) volgt de beslissing.
  func orFollow(j : Types.OaReadJob, st : Types.BotActionState, by : Nat, now : Int) {
    switch (OaRead.extraGet(j.extra, "actie")) {
      case (?t) switch (Nat.fromText(t)) {
        case (?aid) switch (bots.actions.get(aid)) {
          case (?a) { if (a.state == #proposed) { a.state := st; a.decidedBy := ?by; a.decidedAt := ?now } };
          case null {};
        };
        case null {};
      };
      case null {};
    };
  };

  // ── Afsluiten ─────────────────────────────────────────────────────────
  // #applied: kantoor registreerde de offerte (registerOaQuote) uit het voorstel. De server kijkt na dat het dezelfde werf, firma en
  // uitnodiging is, dat ze na de opdracht geregistreerd werd door kantoor, en nog niet aan een andere opdracht hangt. Het merk
  // "inlezen" op de offerte houdt ze uit de testsets van de proefbank (wat een bot of de AI voorstelde, is geen waarheid).
  public shared ({ caller }) func finishOaRead(id : Nat, outcome : OV.OaReadOutcome) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    orRequire(p);
    let j = switch (orJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (not OaRead.isLive(j)) { return #err("Deze opdracht is al afgesloten") };
    let now = Time.now();
    let actionState : Types.BotActionState = switch outcome {
      // Review 3.8 M1/M3: overnemen gebeurt enkel in één update-call met het registreren (applyOaRead).
      case (#applied _) { return #err("Neem het voorstel over in het formulier (Registreren)") };
      case (#rejected r) {
        let why = Access.cleanText(r, Config.maxQuoteReason) ?? return #err("Geef een korte reden (1 tot " # Config.maxQuoteReason.toText() # " tekens)");
        OaRead.close(oaRead, j, #rejected(why), ?p.id, now);
        #rejected;
      };
      case (#cancelled) { OaRead.close(oaRead, j, #cancelled, ?p.id, now); #rejected };
    };
    orFollow(j, actionState, p.id, now);
    syncTasks();
    Access.audit(audit, caller, ?p.id, ?j.workId, "oa-inlezen-af", "opdracht #" # j.id.toText() # " " # OaRead.statusKey(j.status));
    #ok;
  };
};
