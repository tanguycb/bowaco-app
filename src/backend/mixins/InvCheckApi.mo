// OA-factuurcontrole (stap 3.10, bouwplan rij 3.10 en §6 "Twee wegen voor AI", "Bots via MCP", "Autonomie per taak"). Enkel kantoor
// met het volle zicht op de OA-facturen van die werf (Rights.oaInvoiceScope #full: beheerder en calculator, zoals readOaInvoice):
// - startInvCheck: een controleopdracht voor een bot (PDF, foto of Peppol-UBL; de bot leest via MCP: controleopdrachten,
//   controlebestand, voorstel_factuurcontrole) of voor Caffeine AI (de tekst van de factuur; Caffeine leest geen PDF of foto);
// - runInvCheckAi: de Caffeine-weg, één oproep per opdracht (AI-logboek zonder inhoud, budget per maand, testmodus = droog voorbeeld);
// - readInvCheck: het resultaat met de bevindingen (update-call met auditregel "bekeek:factuurcontrole:<id>", zonder bedrag);
// - finishInvCheck: gezien of annuleren. De inhoud gaat dan weg. Een beslissing over de factuur (goedkeuren, intrekken) sluit de
//   opdracht vanzelf (InvCheck.settle).
// Het voorstel wijzigt zelf NOOIT iets: goedkeuren of betwisten doet een mens met de gewone knoppen van de factuur (2.11). Goedkeuren
// en betalen staan op de Nooit-lijst; factuurcontrole is hoogstens Voorstel.
// Private hulpfuncties dragen het voorvoegsel `ic` (ze delen één blok met alle andere mixins).
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Json "mo:jayson/Json";
import Types "../types";
import IV "../types/invcheckviews";
import Access "../lib/Access";
import AiPrompts "../lib/AiPrompts";
import Config "../lib/Config";
import Ids "../lib/Ids";
import InvCheck "../lib/InvCheck";
import OaInvoice "../lib/OaInvoice";
import Rights "../lib/Rights";
import Caffeine "../lib/ai/Caffeine";
import Connector "../lib/ai/Connector";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  oaInvoices : Types.OaInvoiceState,
  oaDeals : Types.OaDealState,
  purchases : Types.PurchaseState,
  tenders : Types.TenderState,
  robot : Types.RobotState,
  ai : Types.AiState,
  bots : Types.BotState,
  invCheck : Types.InvCheckState,
  audit : Types.AuditState,
  ctr : Types.Counters,
  isAiLive : () -> Bool,
  syncTasks : () -> (), // 4b.5: het model van taak en voorstel gelijkzetten na een wijziging (lib/Tasks.mo)
) {

  func icOffice(p : Types.Person, workId : Nat) : Bool { Rights.oaInvoiceScope({ works; settings }, p, workId) == #full };
  func icCtx() : OaInvoice.Ctx { { settings; access; org; works; plan; reports; qs = quotes; starts = workStarts; ss = surveys; oi = oaInvoices; deals = oaDeals; pur = purchases } };
  func icOrgName(id : Nat) : Text { switch (org.orgs.get(id)) { case (?o) o.name; case null "#" # id.toText() } };
  // Een onbekende opdracht of een opdracht van een werf die deze persoon niet volledig ziet: dezelfde weigering (geen orakel).
  func icJob(p : Types.Person, id : Nat) : { #ok : Types.InvCheckJob; #err : Text } {
    let j = invCheck.jobs.get(id) ?? return #err("Geen toegang");
    if (icOffice(p, j.workId)) #ok(j) else #err("Geen toegang");
  };
  func icInvoice(p : Types.Person, id : Nat) : { #ok : Types.OaInvoice; #err : Text } {
    let i = oaInvoices.invoices.get(id) ?? return #err("Geen toegang");
    if (icOffice(p, i.workId)) #ok(i) else #err("Geen toegang");
  };

  func icBrief(j : Types.InvCheckJob) : IV.InvCheckBrief {
    let (way, botId, botName) = switch (j.via) {
      case (#bot(b)) ("bot", ?b, switch (bots.bots.get(b)) { case (?x) x.name; case null "bot #" # b.toText() });
      case (#ai) ("caffeine", null, "Caffeine");
      case (#other(t)) (t, null, "");
    };
    // Een query kan niets sluiten: een opdracht van een factuur waarover al beslist is, toont "afgesloten" (de klok sluit ze).
    let open = switch (oaInvoices.invoices.get(j.invoiceId)) { case (?i) InvCheck.invoiceOpen(i); case null false };
    let (status, reason) = if (InvCheck.isLive(j) and not open) ("afgesloten", "beslist") else (InvCheck.statusKey(j.status), switch (j.status) { case (#closed r) r; case (#failed r) r; case _ "" });
    {
      id = j.id;
      invoiceId = j.invoiceId;
      workId = j.workId;
      name = j.name;
      mime = j.mime;
      size = j.size;
      way;
      botId;
      botName;
      status;
      reason;
      verdict = switch (j.result) { case (?r) r.verdict; case null "" };
      findings = switch (j.result) { case (?r) r.findings.size(); case null 0 };
      createdAt = j.createdAt;
      createdByName = Access.personName(access, j.createdBy);
    };
  };

  func icBotOk(b : Types.Bot, workId : Nat) : Bool {
    let ctx = { works; settings };
    Rights.mayBot(ctx, b, "controleopdrachten", ?workId) and Rights.mayBot(ctx, b, "controlebestand", ?workId) and Rights.mayBot(ctx, b, "voorstel_factuurcontrole", ?workId);
  };

  // ── Starten ───────────────────────────────────────────────────────────
  public shared ({ caller }) func startInvCheck(i : IV.InvCheckStart) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let inv = switch (icInvoice(p, i.invoiceId)) { case (#ok x) x; case (#err e) return #err(e) };
    if (not InvCheck.invoiceOpen(inv)) { return #err("Over deze factuur is al beslist") };
    let name = Access.cleanText(Text.fromIter(i.name.chars().take(200)), 200) ?? return #err("Bestandsnaam: 1 tot 200 tekens");
    if (i.content.size() == 0) { return #err("Het bestand of de tekst is leeg") };
    let via : Types.InvCheckVia = switch (i.way) {
      case (#ai) {
        if (i.mime != "text/plain") { return #err("Caffeine leest enkel tekst: plak de tekst van de factuur") };
        let t = i.content.decodeUtf8() ?? return #err("De tekst is geen geldige UTF-8");
        if (t.size() > Config.invCheckMaxText) { return #err("Hoogstens " # Config.invCheckMaxText.toText() # " tekens tekst") };
        if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
        #ai;
      };
      case (#bot(id)) {
        if (not InvCheck.fileMimeOk(i.mime)) { return #err("Enkel een PDF, een foto (JPEG, PNG, WebP) of een Peppol-factuur (XML)") };
        if (i.content.size() > Config.invCheckMaxBytes) { return #err("Te groot om te laten controleren (hoogstens 1,35 MB)") };
        let b = bots.bots.get(id) ?? return #err("Onbekende bot");
        if (not Rights.botActive(b) or not icBotOk(b, inv.workId)) {
          return #err("Deze bot mag deze factuur niet controleren: zet controleopdrachten, controlebestand, voorstel_factuurcontrole en deze werf op zijn fiche");
        };
        #bot(id);
      };
    };
    if (InvCheck.openOnWork(invCheck, inv.workId) >= Config.invCheckMaxOpenPerWork) { return #err("Te veel open controleopdrachten op deze werf; sluit er eerst af") };
    if (invCheck.jobs.size() >= Config.invCheckMaxJobs) { return #err("Te veel controleopdrachten") };
    if (InvCheck.liveBytes(invCheck) + i.content.size() > Config.invCheckMaxLiveBytes) { return #err("Te veel open controleopdrachten in de app; sluit er eerst af") };
    // Eén open opdracht per factuur en weg tegelijk.
    if (InvCheck.jobsOfInvoice(invCheck, inv).any(func(j : Types.InvCheckJob) : Bool = InvCheck.isLive(j) and j.via == via)) { return #err("Voor deze factuur loopt al een controle langs deze weg") };
    let now = Time.now();
    let id = Ids.next(ctr, "invCheck");
    let job : Types.InvCheckJob = { id; workId = inv.workId; invoiceId = inv.id; orgId = inv.orgId; name; mime = i.mime; size = i.content.size(); via; createdAt = now; createdBy = p.id; var status = #open; var result = null; var decidedAt = null; var decidedBy = null; var extra = [] };
    invCheck.jobs.add(id, job);
    InvCheck.addIndex(invCheck, inv.workId, id);
    syncTasks();
    invCheck.content.add(id, i.content);
    Access.audit(audit, caller, ?p.id, ?inv.workId, "factuurcontrole-start", "opdracht #" # id.toText() # " " # icOrgName(inv.orgId) # " " # inv.number # " via " # (switch via { case (#bot(b)) "bot #" # b.toText(); case _ "Caffeine AI" }));
    #ok(id);
  };

  // ── Lezen ─────────────────────────────────────────────────────────────
  public query ({ caller }) func listInvCheckBots(workId : Nat) : async [IV.InvCheckBot] {
    let p = Access.requireActive(access, caller);
    if (not icOffice(p, workId)) { Runtime.trap("Geen toegang") };
    bots.bots.values().filter(func(b : Types.Bot) : Bool = Rights.botActive(b) and icBotOk(b, workId)).map(func(b : Types.Bot) : IV.InvCheckBot = { id = b.id; name = b.name }).toArray();
  };

  public query ({ caller }) func invCheckAiReady() : async Bool {
    let p = Access.requireActive(access, caller);
    // Enkel kantoor met de bedragen (zoals oaReadAiReady): anderen krijgen een weigering, geen ja/nee.
    Rights.require({ works; settings }, p, #oaInvoicesAny, null);
    Rights.require({ works; settings }, p, #readCosts, null);
    if (not Rights.may({ works; settings }, p, #useAi, null)) return false;
    switch (ai.workers.get("oa-factuurcontrole")) { case (?w) w.enabled; case null false };
  };

  public query ({ caller }) func listInvChecks(invoiceId : Nat) : async [IV.InvCheckBrief] {
    let p = Access.requireActive(access, caller);
    let inv = switch (icInvoice(p, invoiceId)) { case (#ok x) x; case (#err e) Runtime.trap(e) };
    InvCheck.jobsOfInvoice(invCheck, inv).reverse().map<Types.InvCheckJob, IV.InvCheckBrief>(icBrief);
  };

  public shared ({ caller }) func readInvCheck(id : Nat) : async Result.Result<IV.InvCheckFull, Text> {
    let p = Access.requireActive(access, caller);
    let j = switch (icJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    InvCheck.settle(invCheck, oaInvoices, bots, j, Time.now());
    syncTasks();
    Access.audit(audit, caller, ?p.id, ?j.workId, "bekeek:factuurcontrole:" # id.toText(), icOrgName(j.orgId) # " · " # InvCheck.statusKey(j.status));
    #ok({ brief = icBrief(j); result = j.result });
  };

  // ── Caffeine AI-weg (de tekst) ────────────────────────────────────────
  func icAiReal() : Bool { isAiLive() and settings.values.get("ai.testmodus") == ?"uit" };

  public shared ({ caller }) func runInvCheckAi(id : Nat) : async Result.Result<IV.InvCheckAiStep, Text> {
    let p = Access.requireActive(access, caller);
    if (not Rights.may({ works; settings }, p, #useAi, null)) { return #err("Geen toegang") };
    let j = switch (icJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    if (j.via != #ai) { return #err("Deze opdracht leest een bot") };
    if (j.status != #open) { return #err("Deze opdracht heeft al een voorstel of is afgesloten") };
    let inv = oaInvoices.invoices.get(j.invoiceId) ?? return #err("Geen toegang");
    if (not InvCheck.invoiceOpen(inv)) { return #err("Over deze factuur is al beslist") };
    let text = switch (invCheck.content.get(j.id)) { case (?b) b.decodeUtf8() ?? ""; case null "" };
    if (text == "") { return #err("Geen tekst") };
    let w = ai.workers.get("oa-factuurcontrole") ?? return #err("De fiche voor de factuurcontrole is nog niet ingericht (Beheer → AI-medewerkers)");
    let v = AiPrompts.version(w.key, w.instructionVersion) ?? return #err("Onbekende instructieversie");
    // De tekst van de OA kan het afgebakende blok niet sluiten; het dossier komt uit de app (vertrouwd) en staat erbuiten.
    // Review 3.10 M1: het dossier bevat tekst die van de OA kwam (nummers, omschrijvingen): ook dat in een eigen afgebakend blok.
    let dossierJson = InvCheck.dossier(icCtx(), tenders, inv, icOrgName(inv.orgId), true).stringify();
    // 3.12 (review L): AiPrompts.fence zet elke reeks <<< of >>> uit elkaar, in het dossier en (in proofUser) in de tekst van de factuur.
    let context = "Dossier van BOWACO over deze factuur (JSON):\n<<<DOSSIER\n" # AiPrompts.fence(dossierJson) # "\nDOSSIER>>>";
    let userText = AiPrompts.proofUser(context, text);
    if (userText.size() > Config.aiMaxInputBytes) { return #err("Te groot om via Caffeine te controleren; laat een bot het doen") };
    let live = icAiReal();
    let now0 = Time.now();
    switch (InvCheck.extraGet(j.extra, "bezig")) {
      case (?t) { switch (Int.fromText(t)) { case (?at) { if (now0 - at < 300_000_000_000) return #err("Deze opdracht wordt al gecontroleerd; wacht even") }; case null {} } };
      case null {};
    };
    // Review 4b.5 L1: het model volgt het merk "bezig" meteen (ook als de oproep daarna mislukt).
    let unmark = func() { j.extra := j.extra.filter(func((k, _) : (Text, Text)) : Bool = k != "bezig"); syncTasks() };
    let content : Text = if (not live) v.dryRun else {
      if (not w.enabled or w.budgetMonthCents == 0) { return #err(w.name # " staat uit (Beheer → AI-medewerkers)") };
      if (not ai.models.containsKey(w.modelAlias)) { return #err("Het model van de fiche staat niet in de catalogus") };
      if (ai.runningByPerson.containsKey(p.id)) { return #err("Je hebt al een oproep lopen; wacht even") };
      if (ai.runningByPerson.size() >= Config.aiMaxConcurrent) { return #err("Druk bezig, probeer zo meteen") };
      j.extra := InvCheck.extraSet(j.extra, "bezig", Int.toText(now0));
      syncTasks();
      let e = { settings; access; robot; ai; audit; ctr };
      let now = Time.now();
      let reserve = switch (Connector.reserve(e, w, caller, ?p.id, ?j.workId, now)) { case (#ok x) x; case (#err t) { unmark(); return #err(t) } };
      let call = Connector.newCall(e, w, #caffeine, #user(p.id), ?p.id, ?j.workId, w.modelAlias, Connector.sha(userText), userText.size(), reserve, false, now);
      call.extra := [("controleopdracht", j.id.toText())];
      ai.runningByPerson.add(p.id, call.id);
      let out = await* Caffeine.chat<system>(w.modelAlias, v, userText);
      if (ai.runningByPerson.get(p.id) == ?call.id) ai.runningByPerson.remove(p.id);
      unmark();
      // R33: na de await opnieuw: nog kantoor op die werf met AI, opdracht nog open.
      // Review 3.10 L4: ook de factuur nog open.
      let still = switch (Access.activePerson(access, caller)) { case (?q) icOffice(q, j.workId) and Rights.may({ works; settings }, q, #useAi, null) and (switch (oaInvoices.invoices.get(j.invoiceId)) { case (?i2) InvCheck.invoiceOpen(i2); case null false }); case null false };
      switch (Connector.finishRaw(e, call, v, out, still and j.status == #open, caller, "factuurcontrole", Config.invCheckAnswerBytes)) { case (#ok t) t; case (#err m) return #err(m) };
    };
    if (j.status != #open) { return #err("De opdracht veranderde intussen") };
    let parsed = switch (Json.parse(content)) { case (?x) InvCheck.parse(x, Time.now(), [("ai", w.modelAlias)].concat(if live [] else [("droog", "1")])); case null #err("onleesbaar antwoord") };
    switch parsed {
      case (#ok res) {
        j.result := ?res;
        j.status := #proposed;
        syncTasks();
        Access.audit(audit, caller, ?p.id, ?j.workId, "factuurcontrole-voorstel", "opdracht #" # j.id.toText() # " (Caffeine AI" # (if live ")" else ", testmodus)"));
        #ok({ status = "voorstel"; dry = not live });
      };
      case (#err m) {
        // Review 3.10 L1: een onbruikbaar antwoord laat de opdracht open (opnieuw proberen, hoogstens 3 keer); de tekst blijft.
        let tries = 1 + (switch (InvCheck.extraGet(j.extra, "pogingen")) { case (?t) switch (Nat.fromText(t)) { case (?n) n; case null 0 }; case null 0 });
        if (tries >= 3) {
          InvCheck.close(invCheck, j, #failed("het antwoord was onbruikbaar: " # Text.fromIter(m.chars().take(120))), ?p.id, Time.now());
        } else {
          j.extra := InvCheck.extraSet(j.extra, "pogingen", tries.toText());
        };
        syncTasks();
        #ok({ status = "mislukt"; dry = not live });
      };
    };
  };

  // ── Afsluiten ─────────────────────────────────────────────────────────
  // Gezien: kantoor las het voorstel en beslist (of besliste) over de factuur zelf. Annuleren: vóór of na het voorstel, zonder gevolg.
  // Het voorstel van de bot (Voorstellen en acties) volgt: gezien = aanvaard, annuleren = geweigerd.
  public shared ({ caller }) func finishInvCheck(id : Nat, outcome : IV.InvCheckOutcome) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let j = switch (icJob(p, id)) { case (#ok x) x; case (#err e) return #err(e) };
    let now = Time.now();
    InvCheck.settle(invCheck, oaInvoices, bots, j, now);
    syncTasks();
    if (not InvCheck.isLive(j)) { return #err("Deze opdracht is al afgesloten") };
    switch outcome {
      case (#seen) {
        if (j.status != #proposed) { return #err("Er is nog geen voorstel") };
        InvCheck.follow(bots, j, true, ?p.id, now);
        InvCheck.close(invCheck, j, #closed("gezien"), ?p.id, now);
      };
      case (#cancelled) {
        InvCheck.follow(bots, j, false, ?p.id, now);
        InvCheck.close(invCheck, j, #cancelled, ?p.id, now);
      };
    };
    syncTasks();
    Access.audit(audit, caller, ?p.id, ?j.workId, "factuurcontrole-af", "opdracht #" # j.id.toText() # " " # InvCheck.statusKey(j.status));
    #ok;
  };
};
