// PDF, voorwaarden en akkoord (stap 2.7, bouwplan §9 rij 2.7 ⚖; VOORLOPIG: vragen voor Alexis en de jurist): wat er bij het
// versturen van een offerte naast de inhoud vastligt (afzender, klant, werf, btw-grond, betaaltermijn, geldigheid, tekst van
// de voorwaarden), de algemene voorwaarden met versies, en de views voor kantoor en voor de klant. Geen rechten hier
// (lib/Rights.mo) en geen schrijfacties op de offerte zelf (mixins/QuotesApi.mo en QuoteClientApi.mo).
// De klant krijgt NOOIT een aankoopprijs, een marge, een interne notitie of de reden van een afwijkende marge: de views
// voor de klant (types/docviews.mo) hebben die velden niet.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import DocViews "../types/docviews";
import Access "Access";
import Config "Config";
import Library "Library";
import QuoteCalc "QuoteCalc";
import Quotes "Quotes";

module {
  // ── Instellingen (settings.values, D8: geen migratie) ─────────────────────
  public let issuerKey = "offerte.afzender";
  public let paymentKey = "offerte.betaaltermijn";

  public func issuer(s : Types.SettingsState) : Text {
    switch (s.values.get(issuerKey)) { case (?t) { if (t.trim(#char ' ').size() > 0) t else Config.defaultQuoteIssuer }; case null Config.defaultQuoteIssuer };
  };

  public func paymentDays(s : Types.SettingsState) : Nat {
    switch (s.values.get(paymentKey)) { case (?t) { switch (Nat.fromText(t)) { case (?n) { if (n >= 1 and n <= 365) n else Config.quotePaymentDaysDefault }; case null Config.quotePaymentDaysDefault } }; case null Config.quotePaymentDaysDefault };
  };

  // ── Voorwaarden ───────────────────────────────────────────────────────────
  // De ingebouwde tekst (versie 0): een geraamte om in te vullen, nooit een juridisch geldige tekst.
  public func defaultTerms() : Types.QuoteTerms {
    { id = 0; version = 0; title = Config.defaultQuoteTermsTitle; text = Config.defaultQuoteTermsText(); provisional = true; note = "ingebouwd"; createdAt = 0; createdBy = 0; archivedAt = null; extra = [] };
  };

  public func termsList(qd : Types.QuoteDocsState) : [Types.QuoteTerms] {
    qd.terms.values().filter(func t = t.archivedAt == null).toArray().sort(func(a, b) = Nat.compare(b.version, a.version));
  };

  // De geldende voorwaarden: de nieuwste versie, anders de ingebouwde tekst.
  public func currentTerms(qd : Types.QuoteDocsState) : Types.QuoteTerms {
    let l = termsList(qd);
    if (l.size() == 0) defaultTerms() else l[0];
  };

  // ── Wat bij het versturen vastligt ────────────────────────────────────────
  // `today` = de dag van verzending (Day); de geldigheid loopt tot today + validDays.
  public func buildInfo(
    settings : Types.SettingsState,
    org : Types.OrgState,
    works : Types.WorksState,
    dossier : Types.DossierState,
    qd : Types.QuoteDocsState,
    q : Types.Quote,
    v : Types.QuoteVersion,
    today : Nat,
  ) : Types.QuoteSendInfo {
    let client = switch (v.clientOrgId) { case (?o) org.orgs.get(o); case null null };
    let w = works.works.get(q.workId);
    let t = currentTerms(qd);
    {
      versionId = v.id;
      issuer = issuer(settings);
      clientName = switch client { case (?o) o.name; case null "" };
      clientAddress = switch client { case (?o) o.address; case null null };
      clientVat = switch client { case (?o) o.vat; case null null };
      workCode = switch w { case (?x) x.code; case null "" };
      workName = switch w { case (?x) x.name; case null "" };
      workAddress = switch w { case (?x) x.address; case null { { street = ""; number = ""; zip = ""; city = ""; country = "" } } };
      vatNote = switch (dossier.info.get(q.workId)) { case (?i) i.vatNote; case null "" };
      paymentDays = paymentDays(settings);
      validUntil = today + v.validDays;
      termsId = t.id;
      termsVersion = t.version;
      termsTitle = t.title;
      termsText = t.text;
      termsProvisional = t.provisional;
      extra = [];
    };
  };

  // ── Views ─────────────────────────────────────────────────────────────────
  public func termsView(t : Types.QuoteTerms, byName : Text) : DocViews.QuoteTermsView {
    { id = t.id; version = t.version; title = t.title; text = t.text; provisional = t.provisional; note = t.note; createdAt = t.createdAt; byName };
  };

  public func infoView(i : Types.QuoteSendInfo, frozen : Bool) : DocViews.QuoteDocInfo {
    {
      frozen;
      issuer = i.issuer;
      clientName = i.clientName;
      clientAddress = i.clientAddress;
      clientVat = i.clientVat;
      workCode = i.workCode;
      workName = i.workName;
      workAddress = i.workAddress;
      vatNote = i.vatNote;
      paymentDays = i.paymentDays;
      validUntil = i.validUntil;
      termsVersion = i.termsVersion;
      termsTitle = i.termsTitle;
      termsText = i.termsText;
      termsProvisional = i.termsProvisional;
    };
  };

  public func acceptanceView(access : Types.AccessState, a : Types.QuoteAcceptance) : DocViews.QuoteAcceptanceView {
    {
      hash = a.hash;
      digital = switch (a.digital) { case (?d) ?{ at = d.at; byName = Access.personName(access, d.personId) }; case null null };
      signed = switch (a.signed) { case (?s) ?{ at = s.at; byName = Access.personName(access, s.by); fileId = s.fileId; note = s.note }; case null null };
    };
  };

  public func myAcceptanceView(access : Types.AccessState, a : Types.QuoteAcceptance) : DocViews.MyAcceptanceView {
    {
      hash = a.hash;
      digital = switch (a.digital) { case (?d) ?{ at = d.at; byName = Access.personName(access, d.personId) }; case null null };
      signed = switch (a.signed) { case (?s) ?{ at = s.at; byName = Access.personName(access, s.by) }; case null null };
    };
  };

  // ── De offerte zoals de klant ze ziet: enkel verkoopprijzen ───────────────
  public func clientRead(
    x : Quotes.Ctx,
    q : Types.Quote,
    v : Types.QuoteVersion,
    c : Quotes.Computed,
    info : Types.QuoteSendInfo,
    accept : ?Types.QuoteAcceptance,
    intact : Bool,
    today : Nat,
    newerExists : Bool,
  ) : DocViews.MyQuoteRead {
    let sent = switch (v.sent) { case (?s) s; case null { { at = 0; by = 0; hash = ""; subtotalCents = 0; vatCents = 0; totalCents = 0; optionsPlusCents = 0; optionsMinusCents = 0 } } };
    let sells = Quotes.sellLines(c);
    let chapterSell = Map.empty<Nat, Int>();
    for (ch in c.totals.chapters.values()) { chapterSell.add(ch.chapter, ch.sell) };
    let expired = today > info.validUntil;
    {
      quoteId = q.id;
      versionId = v.id;
      number = q.number;
      version = v.version;
      status = v.status;
      title = v.title;
      intro = v.intro;
      vatBp = v.vatBp;
      sentAt = sent.at;
      hash = sent.hash;
      intact;
      expired;
      newerExists;
      canAnswer = v.status == #sent and intact and not expired and not newerExists;
      doc = infoView(info, true);
      chapters = c.chapters.map(func(ch : Types.QuoteChapter) : DocViews.MyQuoteChapter = { id = ch.id; code = ch.code; title = ch.title; sellCents = switch (chapterSell.get(ch.id)) { case (?s) s; case null 0 } });
      lines = Array.tabulate<DocViews.MyQuoteLine>(
        c.lines.size(),
        func i {
          let l = c.lines[i];
          {
            id = l.id;
            chapterId = l.chapterId;
            kind = l.kind;
            code = l.code;
            title = l.title;
            text = l.text;
            specRef = l.specRef;
            qtyMilli = l.qtyMilli;
            unit = l.unit;
            unitName = if (l.unit == "") "" else Library.unitName(x.settings, l.unit);
            form = l.form;
            unitSellCents = sells[i].unitSellCents;
            lineSellCents = sells[i].lineSellCents;
          };
        },
      );
      subtotalCents = sent.subtotalCents;
      vatCents = sent.vatCents;
      totalCents = sent.totalCents;
      optionsPlusCents = sent.optionsPlusCents;
      optionsMinusCents = sent.optionsMinusCents;
      acceptance = switch accept { case (?a) ?myAcceptanceView(x.access, a); case null null };
      // De notitie van de beslissing enkel als de klant ze zelf gaf (zijn reden bij het weigeren); een notitie van kantoor niet.
      decisionNote = switch (v.decision) {
        case (?d) { switch (x.access.persons.get(d.by)) { case (?p) { if (p.roles.find(func r = r == #klant) != null) d.note else "" }; case null "" } };
        case null "";
      };
    };
  };

  public func myBrief(q : Types.Quote, v : Types.QuoteVersion, info : Types.QuoteSendInfo, workName : Text, newerExists : Bool, today : Nat) : DocViews.MyQuoteBrief {
    {
      quoteId = q.id;
      versionId = v.id;
      number = q.number;
      version = v.version;
      title = v.title;
      workName;
      status = v.status;
      sentAt = switch (v.sent) { case (?s) s.at; case null 0 };
      validUntil = info.validUntil;
      expired = today > info.validUntil;
      newerExists;
      decidedAt = switch (v.decision) { case (?d) ?d.at; case null null };
    };
  };
};
