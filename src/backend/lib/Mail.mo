// Mail via de maildienst van Caffeine (stap mail-caffeine, E-11; caffeineai-email, "service"-mail). De app verstuurt de
// opdrachten uit de wachtrij van de postbode (lib/Post.mo) zelf; de gateway krijgt geen mail meer.
//
// Nooit dubbel (les MAIL2 uit SuiteAccess):
// - één verstuurronde tegelijk (`Lock`): de klok heeft een EIGEN klokjob (main.mo, eigen slot) en de knop "Nu versturen"
//   neemt hetzelfde slot; een tweede ronde stopt meteen;
// - elke opdracht heeft een idempotentiesleutel (firma + week + soort): klaarzetten kan maar één keer;
// - vóór het versturen staat de opdracht op "bij de maildienst" (een lease van de app zelf, `Config.appSender`); die
//   toestand is bewaard vóór de oproep vertrekt, dus geen andere ronde neemt ze nog;
// - het wachten op de maildienst is begrensd (`timeout`); komt er geen antwoord (of valt de app na het versturen), dan
//   wordt de opdracht "onzeker" en NOOIT vanzelf opnieuw verstuurd (de admin kijkt na);
// - enkel een weigering van de maildienst (de mail is niet weg) geeft een nieuwe poging met wachttijd (5 min … 6 u),
//   na 5 pogingen mislukt + melding aan de admins.
//
// Testmodus: alle mail gaat naar ÉÉN testadres (of droog: niets verstuurd, enkel het logboek). Op de draftcanister staat
// ze altijd aan (Config.draftBackends); elders standaard aan tot de beheerder ze uitzet.
//
// Logboek (`MailState.log`): per poging de opdracht, soort, firma, aantal adressen, uitkomst en aangerekende cycles;
// nooit een adres of de inhoud. Adressen gaan enkel naar de maildienst van Caffeine (verwerker, docs/privacy.md P19).
import Array "mo:core/Array";
import Char "mo:core/Char";
import Cycles "mo:core/Cycles";
import Error "mo:core/Error";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Prim "mo:⛔";
import EmailService "mo:caffeineai-email/emailService";
import Types "../types";
import Views "../types/views";
import Access "Access";
import Config "Config";
import Ids "Ids";
import MailText "MailText";
import Post "Post";

module {
  // ── Eén ronde tegelijk (naar lib/drainlock.mo van SuiteAccess) ────────────
  // Transient: een upgrade kan niet tussen het versturen en het antwoord vallen (een canister met een openstaande oproep
  // stopt pas als het antwoord er is), en het wachten is begrensd.
  public type Lock = { var no : Nat; var at : Int };
  public func newLock() : Lock { { var no = 0; var at = 0 } };
  // Een ronde zonder voortgang (15 min) telt als dood: dan mag een nieuwe.
  let lockIdle : Int = 900_000_000_000;

  public func take(l : Lock) : ?Nat {
    let now = Time.now();
    if (l.at != 0 and now - l.at < lockIdle) return null;
    l.no += 1;
    l.at := now;
    ?l.no;
  };
  // Na elk antwoord: is het slot nog van deze ronde? (en stempel de voortgang)
  public func still(l : Lock, me : Nat) : Bool {
    if (l.no != me) return false;
    l.at := Time.now();
    true;
  };
  public func free(l : Lock, me : Nat) { if (l.no == me) l.at := 0 };
  public func busy(l : Lock) : Bool { l.at != 0 and Time.now() - l.at < lockIdle };

  // ── Testmodus ──────────────────────────────────────────────────────────────
  public func isDraft(self : Principal) : Bool {
    let t = self.toText();
    Config.draftBackends().any(func x = x == t);
  };
  // Aan, tenzij de beheerder ze uitzette; op de draft ALTIJD aan.
  public func testMode(s : Types.SettingsState, draft : Bool) : Bool {
    draft or s.values.get("post.testmodus") != ?"uit";
  };
  public func testAddress(s : Types.SettingsState) : ?Text {
    switch (s.values.get("post.testadres")) { case (?a) { if (a.size() > 0) ?a else null }; case null null };
  };

  // ── HTML (alles ontsnapt; link enkel https zonder rare tekens; geen externe beelden of lettertypes) ──
  public func esc(t : Text) : Text {
    var out = "";
    for (c in t.chars()) {
      out #= switch c {
        case '&' "&amp;";
        case '<' "&lt;";
        case '>' "&gt;";
        case '\"' "&quot;";
        case '\'' "&#39;";
        case _ Char.toText(c);
      };
    };
    out;
  };

  public func safeLink(l : ?Text) : ?Text {
    let u = l ?? return null;
    if (not u.startsWith(#text "https://") or u.size() > Config.maxUrl) return null;
    for (c in u.chars()) { if (c == ' ' or c == '\"' or c == '\'' or c == '<' or c == '>' or c == '\\' or Char.toNat32(c) < 33) return null };
    ?u;
  };

  public func html(m : Views.MailOut, lang : Text, note : ?Text, contact : Text) : Text {
    let tx = MailText.of(lang);
    let line = "border-top:1px solid #e3e5e8";
    var secs = "";
    for (s in m.sections.values()) {
      var lis = "";
      for (l in s.lines.values()) { lis #= "<li>" # esc(l) # "</li>" };
      secs #= "<tr><td style=\"padding:16px 0 4px;" # line # "\"><div style=\"font-weight:700;font-size:15px;color:#111\">" # esc(s.title) # "</div>"
      # (if (s.subtitle.size() > 0) "<div style=\"font-size:13px;color:#555;margin-top:2px\">" # esc(s.subtitle) # "</div>" else "")
      # "<ul style=\"margin:8px 0 0;padding-left:18px;font-size:14px;color:#111;line-height:1.5\">" # lis # "</ul></td></tr>";
    };
    let banner = switch note {
      case (?n) "<tr><td style=\"padding:10px 12px;background:#fff4d6;border:1px solid #e8c56a;border-radius:6px;font-size:13px;color:#5a4300\">" # esc(n) # "</td></tr>";
      case null "";
    };
    let button = switch (safeLink(m.link)) {
      case (?l) "<tr><td style=\"padding-top:16px\"><a href=\"" # esc(l) # "\" style=\"display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px\">" # esc(tx.button) # "</a></td></tr>";
      case null "";
    };
    let stop = if (m.tag == "proef") "" else "<br>" # esc(tx.stop);
    "<!doctype html><html lang=\"" # esc(tx.lang) # "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" # esc(m.subject) # "</title></head>"
    # "<body style=\"margin:0;background:#f2f3f5;font-family:Arial,Helvetica,sans-serif\">"
    # "<span style=\"display:none;max-height:0;overflow:hidden\">" # esc(m.preheader) # "</span>"
    # "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f2f3f5;padding:24px 12px\"><tr><td align=\"center\">"
    # "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:24px\">"
    # banner
    # "<tr><td style=\"padding-top:8px;font-weight:800;letter-spacing:.04em;color:#1e1f41;font-size:16px\">BOWACO <span style=\"font-weight:400;color:#777;font-family:Menlo,Consolas,monospace;font-size:12px\">werven</span></td></tr>"
    # "<tr><td style=\"padding-top:16px;font-size:20px;font-weight:700;color:#111\">" # esc(m.heading) # "</td></tr>"
    # "<tr><td style=\"padding:8px 0;font-size:14px;color:#111;line-height:1.5\">" # esc(m.intro) # "</td></tr>"
    # secs
    # "<tr><td style=\"padding-top:16px;" # line # ";font-size:14px;color:#111;line-height:1.5\">" # esc(m.outro) # "</td></tr>"
    # button
    # "<tr><td style=\"padding-top:24px;font-size:12px;color:#777;line-height:1.4\">" # esc(tx.footer(contact)) # stop # "</td></tr>"
    # "</table></td></tr></table></body></html>";
  };

  // Wat er met een mail zou gebeuren (voorbeeld en logboek), zonder adressen.
  public type Plan = { #send : { to : [Text]; test : Bool }; #dry };
  public func deliver(s : Types.SettingsState, draft : Bool, m : Views.MailOut) : Plan {
    if (testMode(s, draft)) {
      switch (testAddress(s)) { case (?a) #send({ to = [a]; test = true }); case null #dry };
    } else {
      #send({ to = m.to.map(func(x : Views.MailTo) : Text = x.email); test = false });
    };
  };

  // Foutteksten van de maildienst kunnen een adres bevatten: dat komt nooit in de wachtrij, het logboek of een melding.
  public func scrub(t : Text) : Text {
    var out = "";
    var word = "";
    let flush = func() { out #= (if (word.contains(#char '@')) "[adres]" else word); word := "" };
    for (c in t.chars()) {
      if (c == ' ' or c == '\"' or c == '\'' or c == '(' or c == ')' or c == ',' or c == '<' or c == '>' or c == ':') { flush(); out #= Char.toText(c) } else { word #= Char.toText(c) };
    };
    flush();
    Text.fromIter(out.chars().take(200));
  };

  // ── Eén mail naar de maildienst ───────────────────────────────────────────
  public type SendResult = { #ok : Nat; #refused : Text; #unsure : Text; #noFunds };

  public func send<system>(to : [Text], subject : Text, body : Text) : async* SendResult {
    if (Cycles.balance() < Config.mailCyclesFloor + Config.mailCyclesMax) return #noFunds;
    let id = switch (Prim.envVar<system>("INTEGRATIONS_CANISTER_ID")) { case (?x) x; case null return #refused("maildienst niet ingesteld (INTEGRATIONS_CANISTER_ID)") };
    let svc = actor (id) : EmailService.EmailService;
    try {
      let r = await (with cycles = Config.mailCyclesMax; timeout = Config.mailTimeoutSeconds) svc.broadcast_email({
        sub_type = #Service;
        from_username = Config.mailFrom;
        recipients = to.map(func(e : Text) : EmailService.BroadcastEmailRecipient = { email = e; substitutions = null });
        subject;
        html_body = body;
      });
      switch (r.result) {
        case (#Ok _) #ok(r.cycles_charged);
        case (#Err(#TooFewCyclesAttached _)) #noFunds;
        case (#Err e) #refused(scrub(debug_show e));
      };
    } catch (e) {
      // Niet vertrokken (wachtrij vol, bestemming onbekend, de dienst weigerde zelf, de oproep kon niet weg): opnieuw
      // met wachttijd. Geen antwoord binnen de tijd, of de dienst viel tijdens het werk: de mail kan weg zijn → onzeker,
      // nooit vanzelf opnieuw (liever één mail die de admin nakijkt dan twee bij de OA).
      switch (Error.code(e)) {
        case (#system_transient or #destination_invalid or #canister_reject or #call_error _) #refused(scrub(e.message()));
        case _ #unsure(scrub(e.message()));
      };
    };
  };

  // ── De ronde ───────────────────────────────────────────────────────────────
  public type Env = {
    c : Post.Ctx;
    ps : Types.PostState;
    ms : Types.MailState;
    audit : Types.AuditState;
    ctr : Types.Counters;
    lock : Lock;
    draft : Bool;
  };
  public type Round = { #busy; #done : { sent : Nat; dry : Nat; skipped : Nat; failed : Nat } };

  func addLog(e : Env, j : Types.Job, attempt : Nat, recipients : Nat, test : Bool, lang : Text, outcome : Types.MailOutcome, cycles : Nat) {
    let id = Ids.next(e.ctr, "mail");
    e.ms.log.add(id, { id; jobId = j.id; key = j.key; kind = j.kind; orgId = j.orgId; attempt; at = Time.now(); recipients; test; lang; outcome; cycles; extra = [] });
  };

  func orgName(e : Env, j : Types.Job) : Text {
    switch (j.orgId) { case (?o) { switch (e.c.org.orgs.get(o)) { case (?x) x.name; case null "firma " # o.toText() } }; case null "jezelf (proefmail)" };
  };

  // Hoogstens `max` echte verstuurpogingen. `who` = de admin die op "Nu versturen" drukte (null = de klok).
  public func drain<system>(e : Env, max : Nat, who : ?Principal) : async* Round {
    let me = switch (take(e.lock)) { case (?n) n; case null return #busy };
    var sent = 0;
    var dry = 0;
    var skipped = 0;
    var failed = 0;
    let by = switch who { case (?p) p; case null Principal.anonymous() };
    try {
      let now = Time.now();
      let today = Post.local(now).day;
      let app = Principal.fromText(Config.appSender);
      // Eerst de sleutels verzamelen (nooit een Map wijzigen tijdens het doorlopen).
      let ids = e.ps.open.keys().take(Config.mailScanPerRound).toArray();
      label round for (id in ids.values()) {
        if (sent + failed >= max) break round;
        let j = switch (e.ps.jobs.get(id)) { case (?j) j; case null continue round };
        if (not Post.isMail(j.kind)) continue round;
        switch (j.state) { case (#queued) { if (j.notBefore > Time.now()) continue round }; case _ continue round };
        switch (Post.render(e.c, j, today)) {
          case (#skip why) {
            Post.setState(e.ps, j, #done({ at = Time.now(); result = "overgeslagen: " # why }), j.attempts, j.notBefore);
            Access.audit(e.audit, by, null, j.workId, "post-overgeslagen", "#" # j.id.toText() # " " # j.kind # ": " # why);
            skipped += 1;
          };
          case (#mail m) {
            let lang = Post.lang(e.c, if (j.kind == "proef") null else j.orgId);
            let n = m.to.size();
            switch (deliver(e.c.settings, e.draft, m)) {
              case (#dry) {
                Post.setState(e.ps, j, #done({ at = Time.now(); result = "droog (testmodus zonder testadres): niets verstuurd" }), j.attempts, j.notBefore);
                addLog(e, j, j.attempts, n, true, lang, #dryRun, 0);
                Access.audit(e.audit, by, null, j.workId, "post-droog", "#" # j.id.toText() # " " # j.kind # " (" # n.toText() # " adressen)");
                dry += 1;
              };
              case (#send x) {
                let note = if (x.test) ?MailText.of(lang).testNote(orgName(e, j), n) else null;
                let subject = (if (x.test) "[TEST] " else "") # m.subject;
                let body = html(m, lang, note, Post.contact(e.c.settings));
                let attempt = j.attempts + 1;
                // Bewaard vóór de oproep vertrekt: geen andere ronde neemt deze opdracht nog.
                Post.setState(e.ps, j, #leased({ by = app; until = Time.now() + Config.mailLease; attempt }), attempt, j.notBefore);
                let r = await* send<system>(x.to, subject, body);
                let j2 = e.ps.jobs.get(id) ?? j;
                // Enkel als de opdracht nog "bij de maildienst" staat met deze poging (de admin kan intussen annuleren:
                // dan blijft ze geannuleerd, maar de uitkomst komt wel in het logboek).
                let mine = switch (j2.state) { case (#leased l) l.by == app and l.attempt == attempt; case _ false };
                let at = Time.now();
                let tag = "#" # j.id.toText() # " " # j.kind # (switch (j.orgId) { case (?o) " firma " # o.toText(); case null "" }) # " (" # n.toText() # " adressen" # (if (x.test) ", testmodus" else "") # ")";
                switch r {
                  case (#ok cycles) {
                    if mine { Post.setState(e.ps, j2, #done({ at; result = "verstuurd via Caffeine" # (if (x.test) " (testmodus: enkel het testadres)" else "") }), attempt, j2.notBefore) };
                    addLog(e, j, attempt, n, x.test, lang, #sent, cycles);
                    Access.audit(e.audit, by, null, j.workId, "post-verstuurd", tag);
                    sent += 1;
                  };
                  case (#refused why) {
                    if mine {
                      if (attempt < Config.jobMaxAttempts) {
                        Post.setState(e.ps, j2, #queued, attempt, at + Post.backoff(attempt));
                        Access.audit(e.audit, by, null, j.workId, "post-opnieuw", tag # " poging " # attempt.toText() # ": " # why);
                      } else {
                        Post.setState(e.ps, j2, #failed({ at; why }), attempt, j2.notBefore);
                        Access.audit(e.audit, by, null, j.workId, "post-mislukt", tag # ": " # why);
                        Access.notifyAdmins(e.c.access, e.audit, e.ctr, "postbode", "Mail mislukt (" # j.kind # ", opdracht #" # j.id.toText() # "): " # why);
                      };
                    };
                    addLog(e, j, attempt, n, x.test, lang, #failed(why), 0);
                    failed += 1;
                  };
                  case (#unsure why) {
                    if mine { Post.setState(e.ps, j2, #failed({ at; why = "onzeker: " # why }), attempt, j2.notBefore) };
                    addLog(e, j, attempt, n, x.test, lang, #unsure(why), 0);
                    Access.audit(e.audit, by, null, j.workId, "post-onzeker", tag # ": " # why);
                    Access.notifyAdmins(e.c.access, e.audit, e.ctr, "postbode", "Mail misschien verstuurd (" # j.kind # ", opdracht #" # j.id.toText() # "): geen antwoord van de maildienst. Kijk na voor je ze opnieuw zet.");
                    failed += 1;
                  };
                  case (#noFunds) {
                    // Niets vertrokken: de opdracht terug zoals ze was (geen poging verbruikt) en de ronde stopt.
                    if mine { Post.setState(e.ps, j2, #queued, j.attempts, j.notBefore) };
                    let last = switch (e.c.settings.values.get("post.cyclesMelding")) { case (?t) (Int.fromText(t) ?? 0); case null 0 };
                    if (at - last > Config.day) {
                      e.c.settings.values.add("post.cyclesMelding", Int.toText(at));
                      Access.notifyAdmins(e.c.access, e.audit, e.ctr, "postbode", "Mails wachten: de app heeft te weinig cycles om te versturen. Laad de app op bij Caffeine.");
                    };
                    break round;
                  };
                };
                if (not still(e.lock, me)) break round;
              };
            };
          };
        };
      };
      prune(e);
    } finally {
      free(e.lock, me);
    };
    #done({ sent; dry; skipped; failed });
  };

  // Logboek begrensd: ouder dan Config.mailLogKeepDays weg, in stukken (de ids lopen op met de tijd).
  func prune(e : Env) {
    let cutoff = Time.now() - Config.mailLogKeepDays * Config.day;
    let old = List.empty<Nat>();
    label scan for ((id, l) in e.ms.log.entries()) {
      if (l.at >= cutoff or old.size() >= Config.mailLogPrunePerRound) break scan;
      old.add(id);
    };
    for (id in old.values()) { e.ms.log.remove(id) };
  };

  public func logView(org : Types.OrgState, l : Types.MailLog) : Views.MailLogView {
    {
      id = l.id;
      jobId = l.jobId;
      kind = l.kind;
      orgId = l.orgId;
      orgName = switch (l.orgId) { case (?o) { switch (org.orgs.get(o)) { case (?x) x.name; case null "" } }; case null "" };
      attempt = l.attempt;
      at = l.at;
      recipients = l.recipients;
      test = l.test;
      lang = l.lang;
      outcome = l.outcome;
      cycles = l.cycles;
    };
  };
};
