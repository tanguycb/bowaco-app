// De stand van de werf (stap 2b.3, bouwplan rij 2b.3 en BOWACO_prototype_2b.md vraag 14): per werf de momenten die de
// stappenbalk nodig heeft (offerte verstuurd, akkoord, werf gestart, eerste verslag, eindopmeting, slotstaat) en een paar
// vlaggen voor de kaart "Volgende stap". Niets bewaard en geen nieuw veld: alles volgt uit wat er al is. De FASE zelf
// rekent de browser (app/fase.ts), zodat de regels (VOORLOPIG tot Alexis antwoordt) op één plaats aan te passen zijn.
// Rechten: dezelfde werven als listWorks (#readWork, R3). Enkel momenten, tellingen en vlaggen: geen bedrag, geen naam,
// geen inhoud van een offerte of staat. Kantoor (interne rollen) krijgt alles; de klant van de werf de momenten die hij
// toch ziet (offerte, akkoord, start, verslag, opmeting, staten) maar niets intern (ontwerp, open opmeting, aantal taken);
// een architect, OA of VC krijgt een lege stand (zijn rechten op offertes en staten gaan niet verder, review 2b.3).
// Begrensd (T17): één doorloop per Map, dan per werf enkel opzoekingen.
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  plan : Types.PlanState,
  reports : Types.ReportState,
  quotes : Types.QuotesState,
  workStarts : Types.WorkStartState,
  surveys : Types.SurveyState,
  progress : Types.ProgressState,
) {

  public query ({ caller }) func listWorkStages() : async [Views.WorkStageView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let seen = works.works.values().filter(func w = Rights.may(ctx, p, #readWork, ?w.id)).map(func w = w.id).toArray();
    if (seen.size() == 0) { return [] };
    // Eén doorloop over de taken, de verslagen en de werfstarts (geen index per werf).
    let tasks = Map.empty<Nat, Nat>();
    for (t in plan.tasks.values()) {
      if (t.archivedAt == null) { tasks.add(t.workId, (switch (tasks.get(t.workId)) { case (?n) n; case null 0 }) + 1) };
    };
    let firstReport = Map.empty<Nat, Int>();
    for (r in reports.reports.values()) {
      switch (firstReport.get(r.workId)) {
        case (?at) { if (r.createdAt < at) { firstReport.add(r.workId, r.createdAt) } };
        case null { firstReport.add(r.workId, r.createdAt) };
      };
    };
    let started = Map.empty<Nat, Int>();
    let hasStart = Map.empty<Nat, Bool>(); // versie → er is een werfstart of een afgewezen voorstel
    let startedFrom = Map.empty<Nat, [Nat]>(); // werf → versies van een offerte van een ANDERE werf die haar startten (#newWork)
    let mark = func(w : Nat, at : Int) {
      switch (started.get(w)) { case (?x) { if (at < x) { started.add(w, at) } }; case null { started.add(w, at) } };
    };
    for (s in workStarts.starts.values()) {
      hasStart.add(s.versionId, true);
      if (s.status == #started) {
        mark(s.workId, s.at);
        // Een offerte die als NIEUWE werf gestart werd: ook de werf van de offerte is gestart, en de nieuwe werf kreeg haar
        // offerte en akkoord van die versie (anders bleef de bronwerf eeuwig op Akkoord, review 2b.3).
        if (s.workId != s.sourceWorkId) {
          mark(s.sourceWorkId, s.at);
          startedFrom.add(s.workId, (switch (startedFrom.get(s.workId)) { case (?x) x; case null [] }).concat([s.versionId]));
        };
      };
    };
    let internal = Rights.internal(p);
    seen.map<Nat, Views.WorkStageView>(func id {
      let st = stageOf(id, tasks, firstReport, started, hasStart, startedFrom);
      if (internal) { st } else if (Rights.may(ctx, p, #clientQuote, ?id)) {
        { st with tasks = 0; surveyOpen = false; progressDraft = false; startPending = false }
      } else {
        { workId = id; quoteSentAt = null; quoteWaiting = false; acceptedAt = null; startedAt = null; startPending = false; tasks = 0; firstReportAt = null; surveyOpen = false; measuredAt = null; progressSent = 0; progressDraft = false; invoicedAt = null };
      };
    });
  };

  func stageOf(id : Nat, tasks : Map.Map<Nat, Nat>, firstReport : Map.Map<Nat, Int>, started : Map.Map<Nat, Int>, hasStart : Map.Map<Nat, Bool>, startedFrom : Map.Map<Nat, [Nat]>) : Views.WorkStageView {
    // Offertes van de werf (niet gearchiveerd): eerste verzending, wachtend antwoord, eerste akkoord, aanvaard zonder start.
    var quoteSentAt : ?Int = null;
    var quoteWaiting = false;
    var acceptedAt : ?Int = null;
    var startPending = false;
    for (qid in (switch (quotes.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (quotes.quotes.get(qid)) {
        case (?q) {
          if (q.archivedAt == null) {
            for (vid in (switch (quotes.byQuote.get(qid)) { case (?x) x; case null [] }).values()) {
              switch (quotes.versions.get(vid)) {
                case (?v) {
                  switch (v.sent) { case (?s) { quoteSentAt := earliest(quoteSentAt, s.at) }; case null {} };
                  if (v.status == #sent) { quoteWaiting := true };
                  if (v.status == #accepted) {
                    acceptedAt := earliest(acceptedAt, switch (v.decision) { case (?d) d.at; case null v.updatedAt });
                    if (hasStart.get(v.id) == null) { startPending := true };
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
    // Gestart vanuit de offerte van een andere werf: die versie telt als verstuurd en aanvaard voor deze werf.
    for (vid in (switch (startedFrom.get(id)) { case (?x) x; case null [] }).values()) {
      switch (quotes.versions.get(vid)) {
        case (?v) {
          switch (v.sent) { case (?s) { quoteSentAt := earliest(quoteSentAt, s.at) }; case null {} };
          acceptedAt := earliest(acceptedAt, switch (v.decision) { case (?d) d.at; case null v.updatedAt });
        };
        case null {};
      };
    };
    // Opmetingen: een open ronde, en de eindopmeting = een afgesloten ronde waarin elke post volledig opgemeten is.
    var surveyOpen = false;
    var measuredAt : ?Int = null;
    for (sid in (switch (surveys.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (surveys.surveys.get(sid)) {
        case (?s) {
          switch (s.status) {
            case (#open) { surveyOpen := true };
            case (#closed(c)) {
              let snap = switch (surveys.snapshots.get(sid)) { case (?x) x; case null [] };
              if (snap.size() > 0 and snap.all(func(x : Types.SurveyPostSnap) : Bool = x.complete)) { measuredAt := earliest(measuredAt, c.at) };
            };
          };
        };
        case null {};
      };
    };
    // Vorderingsstaten: verzonden (geen creditnota), een ontwerp, en de slotstaat = eerste staat verzonden ná de eindopmeting.
    var progressSent = 0;
    var progressDraft = false;
    var invoicedAt : ?Int = null;
    for (pid in (switch (progress.byWork.get(id)) { case (?x) x; case null [] }).values()) {
      switch (progress.statements.get(pid)) {
        case (?s) {
          if (s.status == #draft) { progressDraft := true };
          if (s.status == #sent and s.kind == #statement and s.creditedBy == null) {
            progressSent += 1;
            switch (s.sentAt, measuredAt) {
              case (?at, ?m) { if (at >= m) { invoicedAt := earliest(invoicedAt, at) } };
              case _ {};
            };
          };
        };
        case null {};
      };
    };
    {
      workId = id;
      quoteSentAt;
      quoteWaiting;
      acceptedAt;
      startedAt = started.get(id);
      startPending;
      tasks = switch (tasks.get(id)) { case (?n) n; case null 0 };
      firstReportAt = firstReport.get(id);
      surveyOpen;
      measuredAt;
      progressSent;
      progressDraft;
      invoicedAt;
    };
  };

  func earliest(cur : ?Int, at : Int) : ?Int {
    switch cur { case (?c) { if (c <= at) cur else ?at }; case null ?at };
  };
};
