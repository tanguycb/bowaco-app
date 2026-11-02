// Werfadministratie en oplevering (stap 2c.8, ontwerp 2c §4.8; VOORLOPIG: AC-7, AC-25). Rekenen en zoeken zonder rechten
// (lib/Rights.mo beslist wie wat ziet):
//   - de aangifte van een verzekering uiterlijk 15 dagen na de start van de werf, met één melding 5 dagen vooraf en één op de dag;
//   - de premie = werfwaarde × ‰ (in duizendsten), met een minimum; het tarief per soort staat in settings.values (instelbaar);
//   - de werfcode P.nnn uit een teller in settings.sequences (nooit size()), enkel voor nieuwe werven;
//   - actiepunten en restpunten zijn gewone taken (templateKey "actiepunt" / "restpunt"), met de firma als uitvoerder.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Sha256 "mo:sha2/Sha256";
import Codes "Codes";
import Types "../types";
import Time "mo:core/Time";
import Access "Access";
import Config "Config";
import Ids "Ids";
import Plan "Plan";
import Rights "Rights";

module {
  type D = Types.SiteAdminState;
  type Day = Types.Day;

  public let declareDays : Nat = 15;
  public let noticeDays : Nat = 5;

  public func plain<T>(c : Types.Confidential<T>) : ?T { switch c { case (#plain x) ?x; case (#sealed _) null } };

  // ── Soorten ──────────────────────────────────────────────────────────────
  public func kindKey(k : Types.InsuranceKind) : Text {
    switch k { case (#rc10Sub) "rc10"; case (#ba10) "ba10"; case (#abr) "abr"; case (#other t) "andere:" # t };
  };
  public func kindName(k : Types.InsuranceKind) : Text {
    switch k {
      case (#rc10Sub) "Sub-polis abonnement RC10";
      case (#ba10) "BA10 per werf";
      case (#abr) "ABR (alle bouwplaatsrisico's)";
      case (#other t) t;
    };
  };
  // De sleutel van het tarief in de instellingen: de drie vaste soorten; een andere soort heeft er geen.
  public func rateSlot(k : Types.InsuranceKind) : ?Text {
    switch k { case (#rc10Sub) ?"rc10"; case (#ba10) ?"ba10"; case (#abr) ?"abr"; case (#other _) null };
  };

  // ── Instellingen (settings.values, geen migratie) ────────────────────────
  // Standaard (AC-7 / D42): RC10 3,04 ‰, ABR 2,20 ‰; BA10 nog onbekend (0 = niet ingesteld → geen premie). Minimum 0 tot Alexis het zegt.
  public func defaultRate(slot : Text) : Nat { if (slot == "rc10") 3040 else if (slot == "abr") 2200 else 0 };
  public func rateOf(s : Types.SettingsState, slot : Text) : (Nat, Int) {
    let rate = switch (s.values.get("siteadmin.rate." # slot)) { case (?t) { switch (Nat.fromText(t)) { case (?n) n; case null defaultRate(slot) } }; case null defaultRate(slot) };
    let min : Int = switch (s.values.get("siteadmin.min." # slot)) { case (?t) { switch (Int.fromText(t)) { case (?n) n; case null 0 } }; case null 0 };
    (rate, min);
  };
  public func codeP(s : Types.SettingsState) : Bool { s.values.get("siteadmin.codeP") == ?"ja" };

  // De premie (excl. taksen): werfwaarde × ‰, afgerond half omhoog, minstens het minimum. Zonder tarief (0) geen premie.
  public func premium(workValueCents : Int, rateMilli : Nat, minCents : Int) : ?Int {
    if (rateMilli == 0) { return null };
    let v = Int.max(0, workValueCents);
    let raw = (v * rateMilli + 500_000) / 1_000_000;
    ?Int.max(raw, minCents);
  };

  // ── De start en de uiterste aangifte ─────────────────────────────────────
  // De start voor de aangifte (review M6): de vroegste van de geplande start van de werf, de vroegste geplande taak en de vroegste
  // werkelijke start. Actiepunten en restpunten tellen niet mee: ze ontstaan pas tijdens of na de werken.
  public func startOf(works : Types.WorksState, plan : Types.PlanState, workId : Nat) : ?Day {
    var first : ?Day = null;
    let take = func(d : Day) { first := ?(switch first { case (?f) Nat.min(f, d); case null d }) };
    switch (works.works.get(workId)) {
      case (?w) { switch (w.plannedStart) { case (?s) take(s); case null {} } };
      case null return null;
    };
    for (t in Plan.tasksOf(plan, workId).values()) {
      if (t.archivedAt == null and t.templateKey != ?"actiepunt" and t.templateKey != ?"restpunt") {
        take(t.start);
        switch (t.actualStart) { case (?a) take(a); case null {} };
      };
    };
    first;
  };

  public func declareDay(works : Types.WorksState, plan : Types.PlanState, i : Types.Insurance) : ?Day {
    switch (i.workId) {
      case (?w) { switch (startOf(works, plan, w)) { case (?s) ?(s + declareDays); case null null } };
      case null null;
    };
  };

  // ── Zoeken ───────────────────────────────────────────────────────────────
  public func insurancesOf(d : D, workId : ?Nat) : [Types.Insurance] {
    d.insurances.values().filter(func(x : Types.Insurance) : Bool = x.workId == workId).toArray();
  };
  public func meetingsOf(d : D, workId : Nat) : [Types.SiteMeeting] { d.meetings.values().filter(func(x : Types.SiteMeeting) : Bool = x.workId == workId).toArray() };
  public func handoversOf(d : D, workId : Nat) : [Types.Handover] { d.handovers.values().filter(func(x : Types.Handover) : Bool = x.workId == workId).toArray() };

  // De bestanden van dit domein (niet los te archiveren).
  public func ownedFiles(d : D) : Map.Map<Nat, ()> {
    let m = Map.empty<Nat, ()>();
    // Review L10: de bestanden van een gearchiveerd record mogen gearchiveerd worden.
    for (x in d.meetings.values()) { if (x.archivedAt == null) { switch (x.fileId) { case (?f) m.add(f, ()); case null {} } } };
    for (x in d.handovers.values()) {
      if (x.archivedAt == null) { for (o in [x.pvFileId, x.signedFileId, x.docFileId].values()) { switch o { case (?f) m.add(f, ()); case null {} } } };
    };
    for (x in d.techSheets.values()) { if (x.archivedAt == null) { m.add(x.fileId, ()) } };
    m;
  };

  // ── Werfcode P.nnn (instelling + teller, nooit size()) ───────────────────
  public let codeSeq : Text = "werf:P";
  func padCode(n : Nat) : Text { var t = n.toText(); while (t.size() < 3) { t := "0" # t }; "P." # t };

  // Het volgende vrije nummer (zonder te verbruiken): slaat een code over die al bestaat (een hernoemde werf).
  func nextFree(s : Types.SettingsState, works : Types.WorksState) : (Nat, Text) {
    var n = (switch (s.sequences.get(codeSeq)) { case (?x) x; case null 0 }) + 1;
    var guard = 0;
    while (works.works.values().any(func w = w.code == padCode(n)) and guard < 10_000) { n += 1; guard += 1 };
    (n, padCode(n));
  };
  public func peekWorkCode(s : Types.SettingsState, works : Types.WorksState) : Text { nextFree(s, works).1 };
  public func takeWorkCode(s : Types.SettingsState, works : Types.WorksState) : Text {
    let (n, code) = nextFree(s, works);
    s.sequences.add(codeSeq, n);
    code;
  };

  // ── Actiepunten en restpunten = gewone taken van de planning ─────────────
  public type Ctx = { settings : Types.SettingsState; access : Types.AccessState; org : Types.OrgState; works : Types.WorksState; plan : Types.PlanState; audit : Types.AuditState; ctr : Types.Counters };

  // Een taak met sleutel "actiepunt" of "restpunt", 1 werkdag vanaf `day`; met een firma als uitvoerder (een open toewijzing, de OA
  // bevestigt in Mijn week) en een melding aan haar personen die op de werf werken. Dezelfde sporen als saveTask van de planning:
  // TaskChange, planversie omhoog.
  public func newTask(c : Ctx, p : Types.Person, workId : Nat, key : Text, title : Text, orgId : ?Nat, day : Day) : Nat {
    let now = Time.now();
    let cal = Plan.calFor(c.plan, c.works, workId);
    let current = Plan.tasksOf(c.plan, workId);
    let order = current.foldLeft(0, func(m : Nat, t : Types.Task) : Nat = Nat.max(m, t.order)) + 1;
    let id = Ids.next(c.ctr, "task");
    let t : Types.Task = {
      id; workId; title; note = ""; kind = #work; templateKey = ?key; trade = null; responsibleOrgId = orgId; status = #planned; percent = 0;
      start = Plan.nextWorkday(cal, day); workdays = 1; leadDays = 0; orderDay = null; actualStart = null; actualEnd = null; order; quoteLineIds = [];
      createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [];
    };
    c.plan.tasks.add(id, t);
    let cid = Ids.next(c.ctr, "taskChange");
    c.plan.taskChanges.add(cid, { id = cid; taskId = id; workId; at = now; by = p.id; field = "taak"; from = ""; to = title; reason = key });
    switch orgId {
      case (?o) {
        let aid = Ids.next(c.ctr, "assignment");
        c.plan.assignments.add(aid, { id = aid; taskId = id; workId; orgId = o; personId = null; fromDay = null; toDay = null; note = ""; primary = true; confirmation = #open; createdAt = now; createdBy = p.id; updatedAt = now; archivedAt = null; extra = [] });
        let code = switch (c.works.works.get(workId)) { case (?w) w.code; case null "" };
        Access.notifyOrgOnWork(c.access, { works = c.works; settings = c.settings }, c.audit, c.ctr, o, workId, null, p.id, "planning-nieuw", (if (key == "restpunt") "Nieuw restpunt voor jou op " else "Nieuw actiepunt voor jou op ") # code # ": «" # title # "» vanaf " # Plan.fmtDay(t.start) # ".");
      };
      case null {};
    };
    c.plan.versions.add(workId, (switch (c.plan.versions.get(workId)) { case (?v) v; case null 0 }) + 1);
    id;
  };

  // Hoeveel van deze taken zijn nog niet af (en niet gearchiveerd)?
  public func openTasks(plan : Types.PlanState, ids : [Nat]) : Nat {
    var n = 0;
    for (i in ids.values()) { switch (plan.tasks.get(i)) { case (?t) { if (t.archivedAt == null and t.status != #done) { n += 1 } }; case null {} } };
    n;
  };

  // ── Meldingen in de uurlijkse ronde: aangifte binnen 15 dagen na de start ─
  // 5 dagen vooraf en op de dag zelf, telkens één keer per ding en per uiterste dag (schuift de start, dan geldt de nieuwe dag).
  // Aan kantoor (beheerders, calculators) en de werfleider van de werf. Geeft het aantal nieuwe meldingen (per verzekering).
  public func scan(c : Ctx, d : D, today : Day) : Nat {
    var n = 0;
    var seen = 0;
    let now = Time.now();
    // Review L7: hoogstens Config.maxScanInsurances verzekeringen per tik en per werf één keer de startdag bepalen (geen volle taakscan per verzekering).
    let starts = Map.empty<Nat, ?Day>();
    let startFor = func(w : Nat) : ?Day {
      switch (starts.get(w)) { case (?v) v; case null { let v = startOf(c.works, c.plan, w); starts.add(w, v); v } };
    };
    for (x in d.insurances.values().toArray().values()) {
      if (x.archivedAt == null and x.status == #toDeclare and seen < Config.maxScanInsurances) {
        seen += 1;
        let due = switch (x.workId) { case (?w) { switch (startFor(w)) { case (?st) ?(st + declareDays); case null null } }; case null null };
        if (due != x.declareBy) { d.insurances.add(x.id, { x with declareBy = due }) };
        switch (due, x.workId) {
          case (?u, ?w) {
            let live = switch (c.works.works.get(w)) { case (?wk) wk.archivedAt == null; case null false };
            let code = switch (c.works.works.get(w)) { case (?wk) wk.code; case null "" };
            let what = kindName(x.kind) # " van " # code;
            let tell = func(key : Text, text : Text) {
              if (not d.notices.containsKey(key)) {
                d.notices.add(key, now);
                for (p in c.access.persons.values()) {
                  let leader = switch (c.works.works.get(w)) { case (?wk) wk.leaderPersonId == ?p.id; case null false };
                  if (p.archivedAt == null and (Rights.isOffice(p) or leader)) { Access.notify(c.audit, c.ctr, p.id, "verzekering", text, ?w) };
                };
                n += 1;
              };
            };
            if (live) {
              let base = "ins:" # x.id.toText() # ":" # u.toText();
              if (today >= u) { tell(base # ":dag", "Verzekering aangeven: " # what # " — de laatste dag is " # (if (today == u) "vandaag" else Plan.fmtDay(u) # " (voorbij)") # ".") }
              else if (today + noticeDays >= u) { tell(base # ":voor", "Verzekering aangeven vóór " # Plan.fmtDay(u) # ": " # what # ".") };
            };
          };
          case _ {};
        };
      };
    };
    n;
  };

  // Na een herstel: de nummerreeksen minstens zo hoog als wat bestaat (werfcode P.nnn, vergaderingen per werf), zodat een nummer nooit tweemaal uitgegeven wordt.
  public func rebuildSequences(s : Types.SettingsState, _works : Types.WorksState, d : D) {
    let atLeast = func(key : Text, n : Nat) { if (n > (switch (s.sequences.get(key)) { case (?v) v; case null 0 })) { s.sequences.add(key, n) } };
    // Review L6: de teller van de werfcode springt NIET naar de hoogste bestaande code (een met de hand getypte P.900 mag het volgende nummer niet verschuiven):
    // hij komt uit de bewaarkopie (settings.sequences) en nextFree slaat bestaande codes over.
    for (m in d.meetings.values()) { atLeast("vergadering:" # m.workId.toText(), m.number) };
  };

  // ── De controlecode van het opleveringsdocument (review L4): de backend rekent de vaste tekst en de hash zelf ──
  // Zelfde opbouw als handoverText in src/frontend/src/pdf/oplevering.ts (dagen als getal, geen firmanamen).
  public func handoverText(kind : Types.HandoverKind, workCode : Text, workName : Text, address : Text, client : Text, architect : Text, day : ?Day, attendees : [Text], points : [(Text, Text, Day, Bool)], docNote : Text) : Text {
    let lines = List.empty<Text>();
    lines.add(switch kind { case (#provisional) "Voorlopige oplevering"; case (#final) "Definitieve oplevering" });
    lines.add("werf " # workCode # " " # workName);
    lines.add(address);
    lines.add("bouwheer " # client);
    lines.add("architect " # architect);
    lines.add("datum " # (switch day { case (?d) d.toText(); case null "" }));
    lines.add("aanwezigen " # Text.join(attendees.values(), ", "));
    var i = 0;
    for ((title, who, due, done) in points.values()) {
      i += 1;
      lines.add("restpunt " # i.toText() # ": " # title # " | " # who # " | " # due.toText() # " | " # (if done "afgewerkt" else "open"));
    };
    lines.add("opmerking " # docNote);
    Text.join(lines.values(), "\n");
  };
  public func controlCode(text : Text) : Text { Codes.hex(Sha256.fromBlob(#sha256, text.encodeUtf8())) };
}
