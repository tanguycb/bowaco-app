// Documentenlijst en checklist per werf (stap 1.1, §2.7, A5 VOORLOPIG). Een document = een soort uit de
// keuzelijst + de bestanden (versies) + een status. Wie wat mag lezen of leveren: Rights.mayReadDoc /
// mayDeliverDoc; status, titel en termijn beheren: #editWork (admin, werfleider; R4).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Dossier "../lib/Dossier";
import Wadm "../lib/Wadm";
import Ids "../lib/Ids";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  org : Types.OrgState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  plan : Types.PlanState,
  wadm : Types.WadmState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // De werfpagina: checklist + alle documenten die de beller mag zien (R10).
  public query ({ caller }) func getDossier(workId : Nat) : async Views.DossierView {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readWork, ?workId);
    let w = works.works.get(workId) ?? Runtime.trap("Geen toegang");
    let docs = Dossier.docsOf(dossier, workId).filter(func d = Rights.mayReadDoc(ctx, p, workId, Dossier.docAccess(settings, d)));
    let views = docs.map(func d = Dossier.docView(ctx, access, files, p, d));
    let kinds = Dossier.kinds(settings, false);
    let ext = Wadm.ext(org, works, plan, wadm);
    let lines = kinds.filterMap(
      func(k : Views.DocKindView) : ?Views.ChecklistLine {
        if (not Rights.mayReadDoc(ctx, p, workId, Dossier.access(k, null))) { return null };
        let a = Dossier.applies(settings, works, dossier, ext, w, k.rule);
        // De nieuwste van die soort (hoogste id) telt voor de checklist.
        var doc : ?Views.DocumentView = null;
        for (v in views.values()) {
          if (v.kind == k.key) { switch doc { case (?d) { if (v.id > d.id) doc := ?v }; case null doc := ?v } };
        };
        if (a == #no and doc == null) { return null };
        ?{ kind = k.key; name = k.name; rule = k.rule; applies = a; deliverer = k.deliverer; doc };
      }
    );
    {
      workId;
      checklist = lines;
      documents = views;
      deliverKinds = kinds.filter(func k = Rights.mayDeliverDoc(ctx, p, workId, Dossier.access(k, null)));
      canManage = Rights.may(ctx, p, #editWork, ?workId);
    };
  };

  // Document aanmaken of de gegevens wijzigen (titel, termijn, geldigheid, wie levert). Admin, werfleider.
  public shared ({ caller }) func saveDocument(workId : Nat, i : Views.DocumentInput) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?workId);
    let k = Dossier.kind(settings, i.kind) ?? return #err("Onbekende documentsoort");
    let title = switch (Access.cleanText(i.title, Config.maxName)) { case (?t) t; case null k.name };
    if (i.title.size() > Config.maxName) { return #err("Titel: hoogstens " # Config.maxName.toText() # " tekens") };
    if (i.note.size() > Config.maxText) { return #err("Notitie te lang") };
    let now = Time.now();
    switch (i.id) {
      case null {
        if (k.archived) { return #err("Deze documentsoort is gearchiveerd") };
        if (Dossier.docsOf(dossier, workId).size() >= Config.maxDocsPerWork) { return #err("Te veel documenten voor deze werf") };
        let acc = Dossier.access(k, i.ownerOrgId);
        if (not Rights.mayReadDoc(ctx, p, workId, acc)) { return #err("Geen toegang") };
        let id = Ids.next(ctr, "document");
        dossier.documents.add(id, {
          id;
          workId;
          kind = k.key;
          title;
          fileIds = [];
          status = #missing;
          dueDay = i.dueDay;
          validUntil = i.validUntil;
          note = i.note;
          ownerOrgId = i.ownerOrgId;
          confidential = k.confidential;
          createdAt = now;
          createdBy = p.id;
          updatedAt = now;
          updatedBy = p.id;
          archivedAt = null;
          extra = [];
        });
        Access.audit(audit, caller, ?p.id, ?workId, "document-gemaakt", k.key # " #" # id.toText());
        #ok(id);
      };
      case (?id) {
        let d = dossier.documents.get(id) ?? return #err("Onbekend document");
        if (d.workId != workId or d.archivedAt != null) { return #err("Onbekend document") };
        if (not Rights.mayReadDoc(ctx, p, workId, Dossier.docAccess(settings, d))) { return #err("Geen toegang") };
        if (d.kind != k.key) { return #err("De soort van een document verandert niet; maak een nieuw document") };
        dossier.documents.add(id, { d with title; dueDay = i.dueDay; validUntil = i.validUntil; note = i.note; ownerOrgId = i.ownerOrgId; updatedAt = now; updatedBy = p.id });
        Access.audit(audit, caller, ?p.id, ?workId, "document-gewijzigd", d.kind # " #" # id.toText());
        #ok(id);
      };
    };
  };

  // Een opgeladen bestand (addFile) aan een document hangen = nieuwe versie; status wordt "ontvangen"
  // (ook na een goedkeuring: een nieuwe versie moet opnieuw nagekeken worden). Zonder docId wordt het
  // document van die soort gemaakt. Externen enkel voor de soorten die hun rol levert (Rights).
  public shared ({ caller }) func attachDocumentFile(workId : Nat, kindKey : Text, docId : ?Nat, fileId : Nat) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #readWork, ?workId);
    let f = files.files.get(fileId) ?? return #err("Onbekend bestand");
    if (f.workId != ?workId or f.archivedAt != null) { return #err("Dit bestand hoort niet bij deze werf") };
    if (f.personId != p.id and not Rights.internal(p)) { return #err("Geen toegang: enkel je eigen bestand") };
    let now = Time.now();
    let (doc, isNew) : (Types.Document, Bool) = switch docId {
      case (?id) {
        let d = dossier.documents.get(id) ?? return #err("Onbekend document");
        if (d.workId != workId or d.archivedAt != null) { return #err("Onbekend document") };
        (d, false);
      };
      case null {
        let k = Dossier.kind(settings, kindKey) ?? return #err("Onbekende documentsoort");
        if (k.archived) { return #err("Deze documentsoort is gearchiveerd") };
        if (Dossier.docsOf(dossier, workId).size() >= Config.maxDocsPerWork) { return #err("Te veel documenten voor deze werf") };
        ({ id = 0; workId; kind = k.key; title = k.name; fileIds = []; status = #missing; dueDay = null; validUntil = null; note = ""; ownerOrgId = if (Rights.internal(p)) null else p.orgId; confidential = k.confidential; createdAt = now; createdBy = p.id; updatedAt = now; updatedBy = p.id; archivedAt = null; extra = [] }, true);
      };
    };
    if (not Rights.mayDeliverDoc(ctx, p, workId, Dossier.docAccess(settings, doc))) { return #err("Geen toegang") };
    if (doc.confidential != f.confidential) {
      return #err(if (doc.confidential) "Dit document is vertrouwelijk: laad het bestand vertrouwelijk op" else "Een vertrouwelijk bestand hoort bij een vertrouwelijk document");
    };
    if (doc.fileIds.any(func x = x == fileId)) { return #err("Dit bestand hangt al aan dit document") };
    if (doc.fileIds.size() >= Config.maxFilesPerDoc) { return #err("Te veel versies") };
    let id = if isNew Ids.next(ctr, "document") else doc.id;
    dossier.documents.add(id, { doc with id; fileIds = doc.fileIds.concat([fileId]); status = #received; updatedAt = now; updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?workId, "document-bestand", doc.kind # " #" # id.toText() # " versie " # (doc.fileIds.size() + 1).toText());
    #ok(id);
  };

  // Status zetten: gevraagd, goedgekeurd, niet van toepassing, ontbreekt … (admin, werfleider).
  public shared ({ caller }) func setDocumentStatus(docId : Nat, status : Types.DocStatus, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let d = dossier.documents.get(docId) ?? return #err("Onbekend document");
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?d.workId);
    if (not Rights.mayReadDoc(ctx, p, d.workId, Dossier.docAccess(settings, d))) { return #err("Geen toegang") };
    if (d.archivedAt != null) { return #err("Document is gearchiveerd") };
    if ((status == #received or status == #approved) and d.fileIds.size() == 0) { return #err("Nog geen bestand: laad eerst een bestand op") };
    if (note.size() > Config.maxText) { return #err("Notitie te lang") };
    if (d.status == status and note == d.note) { return #ok };
    dossier.documents.add(docId, { d with status; note; updatedAt = Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?d.workId, "document-status", d.kind # " #" # docId.toText() # ": " # docStatusKey(d.status) # " → " # docStatusKey(status));
    #ok;
  };

  public shared ({ caller }) func archiveDocument(docId : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let d = dossier.documents.get(docId) ?? return #err("Onbekend document");
    let ctx = { works; settings };
    Rights.require(ctx, p, #editWork, ?d.workId);
    if (not Rights.mayReadDoc(ctx, p, d.workId, Dossier.docAccess(settings, d))) { return #err("Geen toegang") };
    if (d.archivedAt != null) { return #err("Al gearchiveerd") };
    dossier.documents.add(docId, { d with archivedAt = ?Time.now(); updatedBy = p.id });
    Access.audit(audit, caller, ?p.id, ?d.workId, "document-gearchiveerd", d.kind # " #" # docId.toText());
    #ok;
  };

  // ── Documentsoorten (A5): de admin beheert de lijst; interne rollen lezen ze ─
  public query ({ caller }) func listDocKinds(withArchived : Bool) : async [Views.DocKindView] {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readTeam, null);
    Dossier.kinds(settings, withArchived);
  };

  public shared ({ caller }) func setDocKind(k : Views.DocKindInput) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let key = Text.toLower(k.key.trim(#char ' '));
    if (key.size() == 0 or key.size() > 40 or not key.chars().all(func c = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '-')) {
      return #err("Code: 1 tot 40 tekens, enkel a-z, 0-9 en -");
    };
    let name = Access.cleanText(k.name, Config.maxName) ?? return #err("Naam: 1 tot " # Config.maxName.toText() # " tekens");
    if (Config.docRules().find(func r = r == k.rule) == null) { return #err("Onbekende regel 'verplicht'") };
    if (k.deliverer != "bowaco" and (switch (Rights.roleFromKey(k.deliverer)) { case (?r) Rights.isInternalRole(r); case null true })) {
      return #err("Wie levert: bowaco of een externe rol");
    };
    Dossier.materialize(settings);
    let mapKey = "docKind:" # key;
    let old = settings.lookups.get(mapKey);
    let isNew = switch old { case null true; case (?_) false };
    if (isNew and Dossier.kinds(settings, true).size() >= Config.maxDocKinds) { return #err("Te veel documentsoorten") };
    // Vertrouwelijk wordt een soort niet meer af: bestaande documenten blijven vertrouwelijk (Dossier.docAccess).
    let archivedAt : ?Int = if (k.archived) {
      switch old { case (?o) { switch (o.archivedAt) { case (?a) ?a; case null ?Time.now() } }; case null ?Time.now() };
    } else null;
    settings.lookups.add(mapKey, Dossier.lookupFromKind({ k with key; name }, archivedAt));
    Access.audit(audit, caller, ?p.id, null, "documentsoort", key # (if isNew " nieuw" else " gewijzigd") # ": " # k.rule # ", levert " # k.deliverer # (if (k.oaVisible) ", OA ziet" else "") # (if (k.confidential) ", vertrouwelijk" else "") # (if (k.archived) ", gearchiveerd" else ""));
    #ok;
  };

  func docStatusKey(s : Types.DocStatus) : Text {
    switch s {
      case (#missing) "ontbreekt";
      case (#requested) "gevraagd";
      case (#received) "ontvangen";
      case (#approved) "goedgekeurd";
      case (#expired) "verlopen";
      case (#notApplicable) "n.v.t.";
    };
  };
};
