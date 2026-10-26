// Voorwaarden, afzender, getekend bewijs en mail naar de klant (stap 2.7, bouwplan §9 rij 2.7 ⚖; VOORLOPIG: vragen voor
// Alexis en de jurist). Kantoorkant van de offerte-PDF: de algemene voorwaarden hebben versies (append-only: een fout of
// een wijziging is een nieuwe versie; wat al verstuurd is, houdt zijn eigen tekst), de afzender en de betaaltermijn zijn
// instellingen van de admin. Kantoor kan een door de klant getekende PDF als bewijs registreren (naast of in plaats van het
// digitale akkoord) en een mail met een link naar de offerte laten vertrekken (maildienst van Caffeine, testmodus op een
// draft: er gaat geen echte mail weg). Rechten: lib/Rights.mo.
import Array "mo:core/Array";
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import DocViews "../types/docviews";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Library "../lib/Library";
import Post "../lib/Post";
import QuoteDocs "../lib/QuoteDocs";
import Quotes "../lib/Quotes";
import Rights "../lib/Rights";
import WorkStart "../lib/WorkStart";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  dossier : Types.DossierState,
  files : Types.FileState,
  quotes : Types.QuotesState,
  quoteDocs : Types.QuoteDocsState,
  post : Types.PostState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // ── Instellingen en voorwaarden ─────────────────────────────────────────
  // Lezen: wie offertes bewerkt (het zijn de gegevens van de PDF). Wijzigen: enkel de admin (R17).
  public query ({ caller }) func getQuoteDocSettings() : async DocViews.QuoteDocSettings {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #editQuote, null);
    let cur = QuoteDocs.currentTerms(quoteDocs);
    {
      issuer = QuoteDocs.issuer(settings);
      paymentDays = QuoteDocs.paymentDays(settings);
      terms = QuoteDocs.termsList(quoteDocs).map(func t = QuoteDocs.termsView(t, Access.personName(access, t.createdBy)));
      current = QuoteDocs.termsView(cur, if (cur.version == 0) "" else Access.personName(access, cur.createdBy));
    };
  };

  public shared ({ caller }) func setQuoteDocSettings(i : DocViews.QuoteDocSettingsInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let issuer = i.issuer.trim(#char ' ');
    if (issuer.size() == 0 or issuer.size() > Config.maxQuoteIssuer) { return #err("Afzender: 1 tot " # Config.maxQuoteIssuer.toText() # " tekens (naam, adres, ondernemingsnummer, btw)") };
    if (i.paymentDays == 0 or i.paymentDays > 365) { return #err("Betaaltermijn: 1 tot 365 dagen") };
    settings.values.add(QuoteDocs.issuerKey, issuer);
    settings.values.add(QuoteDocs.paymentKey, i.paymentDays.toText());
    // Wat al verstuurd is, houdt zijn eigen afzender en betaaltermijn (vastgelegd bij het versturen).
    Access.audit(audit, caller, ?p.id, null, "offertedocument-ingesteld", "afzender en betaaltermijn " # i.paymentDays.toText() # " dagen");
    #ok;
  };

  // Een nieuwe versie van de algemene voorwaarden. Nooit een bestaande wijzigen: verzonden offertes houden hun tekst.
  public shared ({ caller }) func addQuoteTerms(i : DocViews.QuoteTermsInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let title = Access.cleanText(i.title, Config.maxLibTitle) ?? return #err("Titel: 1 tot " # Config.maxLibTitle.toText() # " tekens");
    let text = i.text.trim(#char ' ');
    if (text.size() < 20 or text.size() > Config.maxQuoteTermsText) { return #err("Tekst: 20 tot " # Config.maxQuoteTermsText.toText() # " tekens") };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (quoteDocs.terms.size() >= Config.maxQuoteTermsVersions) { return #err("Te veel versies van de voorwaarden") };
    let version = QuoteDocs.termsList(quoteDocs).foldLeft(0, func(m : Nat, t : Types.QuoteTerms) : Nat = Nat.max(m, t.version)) + 1;
    let id = Ids.next(ctr, "quoteTerms");
    quoteDocs.terms.add(id, { id; version; title; text; provisional = i.provisional; note = i.note.trim(#char ' '); createdAt = Time.now(); createdBy = p.id; archivedAt = null; extra = [] });
    Access.audit(audit, caller, ?p.id, null, "offertevoorwaarden-versie", "v" # version.toText() # (if (i.provisional) " (voorlopig)" else ""));
    #ok(version);
  };

  // ── Getekende offerte als bewijs ────────────────────────────────────────
  // De klant tekende een afdruk van de PDF: eerst opladen met addFile (PDF, zelfde werf), dan dit. Op een verzonden
  // versie wordt ze daarmee aanvaard; op een al digitaal aanvaarde versie komt het bewijs erbij. Een bewijs vervangen kan niet.
  public shared ({ caller }) func registerSignedQuote(versionId : Nat, fileId : Nat, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #sendQuote, null);
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    let sent = switch (v.sent) { case (?s) s; case null return #err("Deze versie is nog niet verstuurd") };
    if (quoteDocs.sendInfo.get(v.id) == null) { return #err("Deze versie is verstuurd vóór de PDF bestond: registreer de beslissing met de notitie") };
    if (v.status != #sent and v.status != #accepted) { return #err("Enkel een verzonden of aanvaarde versie kan een getekend bewijs krijgen") };
    let f = files.files.get(fileId) ?? return #err("Onbekend bestand");
    if (f.workId != ?q.workId or f.archivedAt != null) { return #err("Dit bestand hoort niet bij de werf van deze offerte") };
    if (f.mime != "application/pdf") { return #err("Het getekende bewijs is een PDF") };
    // 2.12 (M1): de getekende offerte draagt alle verkoopprijzen en de klantgegevens: enkel als VERTROUWELIJK bestand (R12, R21),
    // zodat de verwijzing (opslag-URL) nooit via listFiles of het dossier bij de werfleider of een externe komt.
    if (not f.confidential) { return #err("Het getekende bewijs moet als vertrouwelijk bestand opgeladen zijn (addFile met vertrouwelijk = ja)") };
    if (note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    let proof : Types.QuoteSignedProof = { at = now; by = p.id; fileId; note = note.trim(#char ' ') };
    switch (quoteDocs.acceptances.get(v.id)) {
      case (?a) {
        if (a.signed != null) { return #err("Er is al een getekend bewijs voor deze versie") };
        quoteDocs.acceptances.add(v.id, { a with signed = ?proof });
      };
      case null {
        quoteDocs.acceptances.add(v.id, { versionId = v.id; hash = sent.hash; digital = null; signed = ?proof; extra = [] });
        quotes.versions.add(v.id, { v with status = #accepted; decision = ?{ at = now; by = p.id; note = "Getekende offerte ontvangen" }; rev = v.rev + 1; updatedAt = now; updatedBy = p.id });
        WorkStart.notifyAccepted(access, works, audit, ctr, q, v, ?p.id, true);
      };
    };
    quotes.quotes.add(q.id, { q with updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?q.workId, "offerte-getekend-bewijs", q.number # " v" # v.version.toText() # " bestand #" # fileId.toText());
    #ok;
  };

  // ── Mail naar de klant ──────────────────────────────────────────────────
  // Een mail met een link naar de offerte (nooit een bedrag) aan het e-mailadres van de klantcontact van de werf. Via de
  // maildienst van Caffeine: op een draft in de testmodus (enkel het testadres, anders droog), nooit een echte mail.
  public shared ({ caller }) func mailQuoteToClient(versionId : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #sendQuote, null);
    Rights.require(ctx, p, #readConfidentialContact, null);
    let v = quotes.versions.get(versionId) ?? return #err("Onbekende versie");
    let q = quotes.quotes.get(v.quoteId) ?? return #err("Onbekende offerte");
    Rights.require(ctx, p, #readQuotes, ?q.workId);
    if (q.archivedAt != null) { return #err("Deze offerte is gearchiveerd") };
    let info = switch (quoteDocs.sendInfo.get(v.id)) { case (?i) i; case null return #err("Deze versie is nog niet verstuurd") };
    if (v.status != #sent) { return #err("Enkel een verzonden versie wordt gemaild (niet aanvaard, geweigerd of vervangen)") };
    let contact = switch (dossier.confidential.get(q.workId)) { case (?c) Library.plainOf(c.clientContact); case null null };
    let c = switch contact { case (?c) c; case null return #err("Geen klantcontact bij de werf: vul naam en e-mailadres in op de werffiche") };
    let email = switch (c.email) { case (?e) { if (e.trim(#char ' ').size() > 0) e.trim(#char ' ') else return #err("Geen e-mailadres bij de klantcontact van de werf") }; case null return #err("Geen e-mailadres bij de klantcontact van de werf") };
    let mails = switch (info.extra.find(func(x : (Text, Text)) : Bool = x.0 == "mails")) { case (?(_, n)) (Nat.fromText(n) ?? 0); case null 0 };
    if (mails >= Config.maxQuoteMails) { return #err("Deze offerte werd al " # mails.toText() # " keer gemaild") };
    let key = "offerte-klant:" # v.id.toText() # ":" # (mails + 1).toText();
    let (_, fresh) = Post.enqueue(post, ctr, "offerte-klant", key, v.clientOrgId, null, ?q.workId, q.number # " v" # v.version.toText(), ?p.id, [("aan", email), ("naam", c.name), ("nummer", q.number), ("versie", v.version.toText()), ("werf", info.workName)]);
    if (not fresh) { return #err("Deze mail staat al in de wachtrij") };
    quoteDocs.sendInfo.add(v.id, { info with extra = info.extra.filter(func(x : (Text, Text)) : Bool = x.0 != "mails" and x.0 != "mailed").concat([("mails", (mails + 1).toText()), ("mailed", Int.toText(Time.now()))]) });
    // Het adres staat nooit in de auditlog (T9).
    Access.audit(audit, caller, ?p.id, ?q.workId, "offerte-gemaild", q.number # " v" # v.version.toText() # " (in de wachtrij van de postbode)");
    #ok;
  };
};
