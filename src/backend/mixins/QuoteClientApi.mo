// De offerte voor de klant (stap 2.7, bouwplan §9 rij 2.7 ⚖; VOORLOPIG: vragen voor Alexis en de jurist): de klant (rol
// klant, lid van de werf, Internet Identity) ziet de VERZONNEN versies van de offertes van zijn eigen werf met enkel de
// verkoopprijzen, en klikt "Akkoord" (of weigert) op de exacte verzonden versie. Een akkoord geldt alleen voor die versie:
// de klant stuurt de hash mee die hij zag, de server vergelijkt ze met de vastgelegde hash én rekent de hash opnieuw uit.
// Wat de klant zelf ziet, komt uit een update-call met een auditregel (bekeek:offerte-klant), zoals elke lezing met
// bedragen (R23). Een versie die niet (meer) verstuurd is, een offerte van een andere werf, een gearchiveerde offerte: allemaal
// hetzelfde antwoord "Onbekende offerte" (geen id-orakel). Nooit een aankoopprijs, marge, interne notitie of reden.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import DocViews "../types/docviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Library "../lib/Library";
import FormViews "../types/formviews";
import QuoteDocs "../lib/QuoteDocs";
import QuoteForms "../lib/QuoteForms";
import Quotes "../lib/Quotes";
import QuoteCalc "../lib/QuoteCalc";
import Rights "../lib/Rights";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  quoteForms : Types.QuoteFormState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // De offertes van mijn werven die al verstuurd zijn (één regel per verzonden versie), zonder bedragen.
  public query ({ caller }) func listMyQuotes() : async [DocViews.MyQuoteBrief] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownQuotes, null);
    let today = qcToday();
    var out : [DocViews.MyQuoteBrief] = [];
    for (q in quotes.quotes.values()) {
      if (q.archivedAt == null and Rights.may(ctx, p, #clientQuote, ?q.workId)) {
        let vs = Quotes.versionsOf(quotes, q.id);
        let wname = switch (works.works.get(q.workId)) { case (?w) w.name; case null "" };
        for (v in vs.values()) {
          // 2.12 (M2): enkel de versies die aan zijn eigen klantorganisatie gericht zijn (zoals qcOwn).
          let mine = switch (v.clientOrgId) { case (?o) p.orgId == ?o; case null true };
          switch (if mine qcInfo(v) else null) {
            case (?info) { out := out.concat([QuoteDocs.myBrief(q, v, info, wname, qcNewer(vs, v), today)]) };
            case null {};
          };
        };
      };
    };
    out.sort(func(a, b) = switch (Int.compare(b.sentAt, a.sentAt)) { case (#equal) Nat.compare(b.version, a.version); case o o });
  };

  // Eén verzonden versie, zoals de klant ze ziet. Update-call met een auditregel.
  public shared ({ caller }) func readMyQuote(versionId : Nat) : async Result.Result<DocViews.MyQuoteRead, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownQuotes, null);
    let (v, q, info) = switch (qcOwn(p, versionId)) { case (?x) x; case null return #err("Onbekende offerte") };
    let c = Quotes.compute(quotes, quoteForms, v, Library.standardMargin(settings));
    let vs = Quotes.versionsOf(quotes, q.id);
    Access.audit(audit, caller, ?p.id, ?q.workId, "bekeek:offerte-klant", "offerte #" # q.id.toText() # " v" # v.version.toText());
    let r = QuoteDocs.clientRead({ settings; access; org; works; qs = quotes }, q, v, c, info, quoteDocs.acceptances.get(v.id), qcIntact(q, v, c, info), qcToday(), qcNewer(vs, v));
    if (v.calcVersion < 2) { return #ok(r) };
    // 2c.1: nooit een post met hoeveelheid 0 die de versie verbergt; subgroepen, tekstblokken, korting en regietekst.
    let vf = QuoteForms.versionForm(quoteForms, v.id);
    let hidden = Map.empty<Nat, Bool>();
    for (l in c.lines.values()) { if (not QuoteForms.shown(vf, quoteForms.lineForms.get(l.id), l)) { hidden.add(l.id, true) } };
    #ok({ r with lines = r.lines.filter(func(l : DocViews.MyQuoteLine) : Bool = not hidden.containsKey(l.id)); form = ?qcForm(q, v, c, vf, hidden) });
  };

  // Akkoord: enkel op de exacte verzonden versie (hash), enkel zolang ze geldig en niet vervangen is. Daarna ligt ze vast.
  public shared ({ caller }) func acceptMyQuote(versionId : Nat, hash : Text) : async Result.Result<DocViews.MyQuoteAnswered, Text> {
    qcAnswer(caller, versionId, hash, true, "");
  };

  // Weigeren (met een notitie voor BOWACO), onder dezelfde voorwaarden.
  public shared ({ caller }) func declineMyQuote(versionId : Nat, hash : Text, note : Text) : async Result.Result<DocViews.MyQuoteAnswered, Text> {
    qcAnswer(caller, versionId, hash, false, note);
  };

  // ── Hulp ───────────────────────────────────────────────────────────────
  func qcForm(q : Types.Quote, v : Types.QuoteVersion, c : Quotes.Computed, vf : Types.QuoteVersionForm, hidden : Map.Map<Nat, Bool>) : FormViews.MyQuoteForm {
    let (kind, insurer, claim) = Quotes.sentKind(quoteForms, q, v);
    let terms = QuoteForms.termsOf(quoteForms, v.id);
    var ls : [(Nat, Nat)] = [];
    for (l in c.lines.values()) {
      if (not hidden.containsKey(l.id)) {
        switch (quoteForms.lineForms.get(l.id)) { case (?lf) { switch (lf.subgroupId) { case (?s) ls := ls.concat([(l.id, s)]); case null {} } }; case null {} };
      };
    };
    {
      kind;
      insurerName = Quotes.orgName(org, insurer);
      claimRef = claim;
      blocks = QuoteForms.blocksOf(quoteForms, v).map(QuoteForms.blockView);
      subgroups = QuoteForms.subgroupsOf(quoteForms, v.id).map(QuoteForms.subgroupView);
      lineSubgroups = ls;
      grossCents = c.totals.gross;
      discountCents = c.totals.discount;
      discountText = switch terms { case (?t) t.discountText; case null "" };
      regieSellCents = if (vf.regieText) (switch terms { case (?t) { switch (t.regie) { case (?g) ?g.sellCents; case null null } }; case null null }) else null;
    };
  };

  func qcToday() : Nat { let t = Time.now(); if (t <= 0) 0 else Int.abs(t) / Int.abs(Config.day) };

  // Een versie die de klant mag zien: verzonden (of later beslist), met vastgelegde info, van een eigen werf.
  func qcVisible(v : Types.QuoteVersion) : Bool {
    v.sent != null and (v.status == #sent or v.status == #accepted or v.status == #rejected or v.status == #superseded);
  };

  func qcInfo(v : Types.QuoteVersion) : ?Types.QuoteSendInfo {
    if (qcVisible(v)) quoteDocs.sendInfo.get(v.id) else null;
  };

  func qcNewer(vs : [Types.QuoteVersion], v : Types.QuoteVersion) : Bool {
    vs.any(func o = o.version > v.version and o.sent != null and (o.status == #sent or o.status == #accepted or o.status == #rejected));
  };

  func qcOwn(p : Types.Person, versionId : Nat) : ?(Types.QuoteVersion, Types.Quote, Types.QuoteSendInfo) {
    let ctx = { works; settings };
    let v = switch (quotes.versions.get(versionId)) { case (?x) x; case null return null };
    let q = switch (quotes.quotes.get(v.quoteId)) { case (?x) x; case null return null };
    if (q.archivedAt != null or not Rights.may(ctx, p, #clientQuote, ?q.workId)) { return null };
    // 2.12 (M2): de versie is aan een klantorganisatie gericht; een klant van een ANDERE organisatie op dezelfde werf leest en
    // aanvaardt ze niet (zelfde antwoord als onbekend: geen id-orakel).
    switch (v.clientOrgId) { case (?o) { if (p.orgId != ?o) { return null } }; case null {} };
    switch (qcInfo(v)) { case (?i) ?(v, q, i); case null null };
  };

  // Klopt de inhoud nog met de hash van het versturen? (Dezelfde berekening als bij het versturen.)
  func qcIntact(q : Types.Quote, v : Types.QuoteVersion, c : Quotes.Computed, info : Types.QuoteSendInfo) : Bool {
    switch (v.sent) { case (?s) Quotes.hash(Quotes.canonical(quoteForms, q, v, c, ?info)) == s.hash; case null false };
  };

  func qcAnswer(caller : Principal, versionId : Nat, hash : Text, accepted : Bool, note : Text) : Result.Result<DocViews.MyQuoteAnswered, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #ownQuotes, null);
    let (v, q, info) = switch (qcOwn(p, versionId)) { case (?x) x; case null return #err("Onbekende offerte") };
    let vs = Quotes.versionsOf(quotes, q.id);
    let sent = switch (v.sent) { case (?s) s; case null return #err("Onbekende offerte") };
    if (v.status == #accepted) { return #err("Deze offerte is al aanvaard") };
    if (v.status == #rejected) { return #err("Deze offerte is al geweigerd") };
    if (v.status != #sent or qcNewer(vs, v)) { return #err("Deze versie is vervangen door een nieuwere: open de nieuwe offerte") };
    if (qcToday() > info.validUntil) { return #err("De geldigheid van deze offerte is verlopen: vraag BOWACO om een nieuwe versie") };
    if (hash != sent.hash) { return #err("U ziet niet de versie die verstuurd werd: laad de offerte opnieuw") };
    let c = Quotes.compute(quotes, quoteForms, v, Library.standardMargin(settings));
    if (not qcIntact(q, v, c, info)) { return #err("De inhoud van deze offerte wijkt af van wat verstuurd werd: neem contact op met BOWACO") };
    let why = note.trim(#char ' ');
    if (why.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    if accepted {
      quoteDocs.acceptances.add(v.id, { versionId = v.id; hash = sent.hash; digital = ?{ at = now; personId = p.id; principal = caller }; signed = null; extra = [] });
      quotes.versions.add(v.id, { v with status = #accepted; decision = ?{ at = now; by = p.id; note = "Digitaal akkoord van de klant" }; rev = v.rev + 1; updatedAt = now; updatedBy = p.id });
    } else {
      quotes.versions.add(v.id, { v with status = #rejected; decision = ?{ at = now; by = p.id; note = if (why == "") "Geweigerd door de klant" else why }; rev = v.rev + 1; updatedAt = now; updatedBy = p.id });
    };
    quotes.quotes.add(q.id, { q with updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, if accepted "offerte-akkoord-klant" else "offerte-geweigerd-klant", q.number # " v" # v.version.toText() # " hash " # Text.fromIter(sent.hash.chars().take(12)));
    Access.notifyAdmins(access, audit, ctr, "offerte", (if accepted "Akkoord van de klant" else "Offerte geweigerd door de klant") # ": " # q.number # " v" # v.version.toText() # " (" # info.workName # ")");
    // 2.8: de werfleider krijgt het voorstel "Werf starten" (de beheerders kregen net het akkoord).
    if accepted { WorkStart.notifyAccepted(access, works, audit, ctr, q, v, null, false) };
    #ok({ status = if accepted #accepted else #rejected; at = now; hash = sent.hash });
  };
};
