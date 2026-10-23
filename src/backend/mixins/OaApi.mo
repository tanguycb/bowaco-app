// Onderaannemers-database (stap 1.2): firma's, contactgegevens, contactpersonen, vakgebieden en de import.
// Contactgegevens van OA's, leveranciers, nutsbedrijven en architecten zijn intern (architectuur §3);
// klantcontact blijft vertrouwelijk in OrgConfidential. Externen zien deze database nooit (R3, R19).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Oa "../lib/Oa";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  oa : Types.OaState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Zoeken en filteren (naam, alias, KBO, contactpersoon, vakgebied); een query: alles intern (R19).
  public query ({ caller }) func listOas(f : Views.OaFilter) : async [Views.OaView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOa, null);
    org.orgs.values().filter(func o = Oa.matches(access, oa, settings, o, f)).map(func o = Oa.oaView(access, oa, o)).toArray();
  };

  public query ({ caller }) func getOa(id : Nat) : async Result.Result<Views.OaView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOa, null);
    switch (org.orgs.get(id)) {
      case (?o) { if (Oa.inDirectory(o.kind)) #ok(Oa.oaView(access, oa, o)) else #err("Onbekende firma") };
      case null #err("Onbekende firma");
    };
  };

  public shared ({ caller }) func saveOrgContact(orgId : Nat, i : Views.OrgContactInput) : async Result.Result<Views.OrgContactView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageOa, null);
    let o = org.orgs.get(orgId) ?? return #err("Onbekende firma");
    if (not Oa.inDirectory(o.kind)) { return #err("Klantcontact is vertrouwelijk: gebruik de klantfiche") };
    if (o.archivedAt != null) { return #err("Firma is gearchiveerd") };
    let email = switch (Oa.normEmail(i.email)) { case (#ok e) e; case (#err e) return #err(e) };
    if (i.contactNote.size() > Config.maxText) { return #err("Notitie te lang") };
    let old = oa.orgContacts.get(orgId);
    let rec : Types.OrgContact = {
      orgId;
      phone = Access.optText(i.phone, 30);
      email;
      website = Access.optText(i.website, Config.maxWebsite);
      contactNote = i.contactNote;
      updatedAt = Time.now();
      updatedBy = p.id;
      extra = switch old { case (?x) x.extra; case null [] };
    };
    oa.orgContacts.add(orgId, rec);
    // Alleen de veldnamen in de auditlog, nooit de gegevens zelf.
    var fields = "";
    let add = func(changed : Bool, n : Text) { if (changed) { fields #= (if (fields == "") "" else ", ") # n } };
    add(switch old { case (?x) x.phone != rec.phone; case null rec.phone != null }, "telefoon");
    add(switch old { case (?x) x.email != rec.email; case null rec.email != null }, "e-mail");
    add(switch old { case (?x) x.website != rec.website; case null rec.website != null }, "website");
    add(switch old { case (?x) x.contactNote != rec.contactNote; case null rec.contactNote != "" }, "notitie");
    if (fields != "") { Access.audit(audit, caller, ?p.id, null, "oa-contact-gewijzigd", o.name # " #" # orgId.toText() # ": " # fields) };
    #ok(Oa.contactView(rec));
  };

  // Contactpersoon van een firma: aanmaken of wijzigen. Een contactpersoon heeft geen login nodig;
  // wie er later een wil, krijgt een herstelcode via Team. De rol is onderaannemer (er bestaat geen aparte
  // rol voor leveranciers); zonder werflidmaatschap geeft die rol geen enkel recht (R2).
  public shared ({ caller }) func saveOaPerson(orgId : Nat, i : Views.OaPersonInput) : async Result.Result<Views.OaPersonView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageOa, null);
    let o = org.orgs.get(orgId) ?? return #err("Onbekende firma");
    if (not Oa.inDirectory(o.kind)) { return #err("Klantcontact is vertrouwelijk: gebruik de klantfiche") };
    if (o.archivedAt != null) { return #err("Firma is gearchiveerd") };
    let name = Access.cleanText(i.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    let email = switch (Oa.normEmail(i.email)) { case (#ok e) e; case (#err e) return #err(e) };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    let jobTitle = switch (Access.cleanText(i.jobTitle, Config.maxJobTitle)) { case (?j) j; case null "" };
    let shortCode : ?Text = switch (Access.optText(i.shortCode, Config.maxShort)) { case (?s) ?Text.toUpper(s); case null null };
    let selfId = switch (i.id) { case (?x) x; case null 0 };
    switch shortCode {
      case (?s) {
        let f = Oa.fold(s);
        for (q in access.persons.values()) {
          if (q.id != selfId and q.archivedAt == null) {
            switch (q.shortCode) { case (?c) { if (Oa.fold(c) == f) { return #err("Code " # s # " hoort al bij " # q.name) } }; case null {} };
          };
        };
      };
      case null {};
    };
    let now = Time.now();
    let id : Nat = switch (i.id) {
      case (?x) {
        let old = access.persons.get(x) ?? return #err("Onbekende persoon");
        if (old.orgId != ?orgId) { return #err("Deze persoon hoort niet bij deze firma") };
        if (old.archivedAt != null) { return #err("Persoon is afgezet") };
        let rec : Types.Person = { id = x; name; roles = old.roles; orgId = old.orgId; shortCode; lang = old.lang; phone = Access.optText(i.phone, 30); createdAt = old.createdAt; createdBy = old.createdBy; var archivedAt = null; extra = old.extra };
        access.persons.add(x, rec);
        Access.audit(audit, caller, ?p.id, null, "oa-persoon-gewijzigd", name # " #" # x.toText() # " bij " # o.name);
        x;
      };
      case null {
        if (access.persons.values().filter(func q = q.orgId == ?orgId and q.archivedAt == null).size() >= Config.maxPersonsPerOrg) { return #err("Te veel personen bij deze firma") };
        let x = Ids.next(ctr, "person");
        let rec : Types.Person = { id = x; name; roles = [#onderaannemer]; orgId = ?orgId; shortCode; lang = null; phone = Access.optText(i.phone, 30); createdAt = now; createdBy = p.id; var archivedAt = null; extra = [] };
        access.persons.add(x, rec);
        Access.audit(audit, caller, ?p.id, null, "oa-persoon-gemaakt", name # " #" # x.toText() # " bij " # o.name);
        x;
      };
    };
    let old = oa.personContacts.get(id);
    oa.personContacts.add(id, { personId = id; email; jobTitle; note = i.note; updatedAt = now; updatedBy = p.id; extra = switch old { case (?x) x.extra; case null [] } });
    let person = access.persons.get(id) ?? return #err("Onbekende persoon");
    #ok(Oa.personView(access, oa, person));
  };

  // ── Vakgebieden (D9): interne rollen lezen, de admin beheert ─────────────
  public query ({ caller }) func listTrades(withArchived : Bool) : async [Views.TradeView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readOa, null);
    Oa.trades(settings, withArchived);
  };

  public shared ({ caller }) func setTrade(t : Views.TradeInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let key = Text.toLower(t.key.trim(#char ' '));
    if (key.size() == 0 or key.size() > 40 or not key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) {
      return #err("Sleutel: 1 tot 40 tekens, enkel a-z, 0-9 en -");
    };
    let name = Access.cleanText(t.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    Oa.materializeTrades(settings);
    let mapKey = "trade:" # key;
    let old = settings.lookups.get(mapKey);
    let isNew = switch old { case null true; case (?_) false };
    if (isNew and Oa.trades(settings, true).size() >= Config.maxTrades) { return #err("Te veel vakgebieden") };
    let archivedAt : ?Int = if (t.archived) {
      switch old { case (?o) { switch (o.archivedAt) { case (?a) ?a; case null ?Time.now() } }; case null ?Time.now() };
    } else null;
    settings.lookups.add(mapKey, Oa.lookupFromTrade({ t with key; name }, archivedAt));
    Access.audit(audit, caller, ?p.id, null, "vakgebied", key # (if isNew " nieuw" else " gewijzigd") # (if (t.archived) ", gearchiveerd" else ""));
    #ok;
  };

  // ── Import (R32): alleen admin, altijd eerst een proefronde ───────────────
  public shared ({ caller }) func importOrgs(dryRun : Bool, rows : [Views.ImportRow]) : async Result.Result<Views.ImportReport, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #importOa, null);
    if (rows.size() == 0 or rows.size() > Config.maxImportRows) { return #err("Per oproep 1 tot " # Config.maxImportRows.toText() # " rijen") };
    let report = Oa.runImport({ org; access; oa; settings; ctr }, p, dryRun, rows);
    Access.audit(
      audit,
      caller,
      ?p.id,
      null,
      if (dryRun) "import-organisaties-proef" else "import-organisaties",
      report.created.toText() # " nieuw, " # report.updated.toText() # " aangevuld, " # report.unchanged.toText() # " ongewijzigd, " # report.conflicts.toText() # " conflicten, " # report.invalid.toText() # " ongeldig",
    );
    #ok(report);
  };
};
