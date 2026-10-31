// Bestanden: de browser laadt op naar de opslagdienst (poort: StorageGate.mo); de backend bewaart
// enkel de verwijzing. Een verwijzing verlaat de backend alleen na een rechtencheck op de werf (R12).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Rights "../lib/Rights";
import Dossier "../lib/Dossier";
import Tenders "../lib/Tenders";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  files : Types.FileState,
  dossier : Types.DossierState,
  reports : Types.ReportState,
  permits : Types.PermitState,
  surveys : Types.SurveyState,
  tenders : Types.TenderState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  // Bestand bij een werf (R11), of zonder werf (alleen interne rollen). Vertrouwelijk: admin/calculator.
  public shared ({ caller }) func addFile(name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob, workId : ?Nat, confidential : Bool) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    switch workId {
      case (?w) Rights.require(ctx, p, #uploadDocs, ?w);
      case null Rights.require(ctx, p, #readTeam, null);
    };
    if (confidential) { Rights.require(ctx, p, #readCosts, null) };
    let n = Access.cleanText(name, 200) ?? return #err("Bestandsnaam: 1 tot 200 tekens");
    if (not Config.allowedMime(mime)) { return #err("Alleen JPEG, PNG, WebP of PDF") };
    if (size == 0 or size > Config.maxFileBytes) { return #err("Bestand te groot") };
    if (blob.size() > 200) { return #err("Het bestand klopt niet") };
    let mine = files.files.values().filter(func f = f.personId == p.id).size();
    if (mine >= Config.maxFilesPerPerson) { return #err("De opslagruimte is vol. Neem contact op met de beheerder") };
    let id = Ids.next(ctr, "file");
    let f : Types.FileRef = { id; name = n; mime; size; blob; workId; confidential; personId = p.id; at = Time.now(); var archivedAt = null };
    files.files.add(id, f);
    // Nooit de verwijzing (URL) in de auditlog (T9).
    Access.audit(audit, caller, ?p.id, workId, "bestand-toegevoegd", n # " (" # size.toText() # " B)" # (if confidential " vertrouwelijk" else ""));
    #ok(id);
  };

  // Bestanden die de beller mag zien; vertrouwelijke zonder verwijzing. Een bestand dat aan een
  // document hangt dat de beller niet mag zien (R10), verschijnt hier ook niet (R12).
  public query ({ caller }) func listFiles(workId : ?Nat) : async [Views.FileView] {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    let hidden = switch workId {
      case (?w) { Rights.require(ctx, p, #readDocs, ?w); Dossier.hiddenFileIds(ctx, dossier, p, w) };
      case null { Rights.require(ctx, p, #readTeam, null); [] };
    };
    // Foto's en bonnen van een werfverslag tonen enkel via het verslag (R8: lezen per rol, 1.6).
    // 1.7: een los vertrouwelijk bestand ziet een externe (architect, OA, klant, VC) zelfs niet bij naam (R12, R20).
    // 1.9: een externe ziet van de losse bestanden enkel wat hijzelf of zijn eigen firma oplaadde; wat aan een
    // document hangt dat hij mag lezen, staat in het dossier (getDossier). Zo ziet een OA nooit de bon van een andere.
    let internal = Rights.internal(p);
    let own = func(f : Types.FileRef) : Bool {
      if (f.personId == p.id) { return true };
      switch (p.orgId) {
        case (?o) { switch (access.persons.get(f.personId)) { case (?q) q.orgId == ?o; case null false } };
        case null false;
      };
    };
    // 1b.1: de vergunning zelf toont enkel bij de vergunning (wie vergunningen mag lezen, R13).
    // 2c.2: de eigen PDF van een OA (ontwerp of ingediend) toont bij de OA-offerte, niet hier.
    let tenderFiles = Tenders.ownedFiles(tenders);
    let permitFiles = switch workId { case (?w) permits.permits.values().filter(func x = x.workId == w).flatMap(func(x : Types.Permit) : Iter.Iter<Nat> = x.fileIds.values()).toArray(); case null [] };
    files.files.values().filter(func f = f.archivedAt == null and f.workId == workId and hidden.find(func x = x == f.id) == null and not reports.fileOwners.containsKey(f.id) and not surveys.fileOwners.containsKey(f.id) and permitFiles.find(func x = x == f.id) == null and not tenderFiles.containsKey(f.id) and (internal or (not f.confidential and own(f)))).map(Dossier.fileView).toArray();
  };

  public shared ({ caller }) func readConfidentialFile(id : Nat) : async Result.Result<Views.FileView, Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #readCosts, null);
    let f = files.files.get(id) ?? return #err("Onbekend bestand");
    // 2c.2 (R38): de eigen PDF in het ONTWERP van een OA leest kantoor niet, tot hij indient (zelfde antwoord als een onbekend id).
    if (Tenders.draftOnlyFiles(tenders).containsKey(id)) { return #err("Onbekend bestand") };
    Access.audit(audit, caller, ?p.id, f.workId, "bekeek:bestand-vertrouwelijk", "#" # id.toText());
    #ok({ Dossier.fileView(f) with blob = ?f.blob });
  };

  public shared ({ caller }) func archiveFile(id : Nat) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    // Onbekend of niet van jou: hetzelfde antwoord (geen id-orakel, 1.9).
    let f = files.files.get(id) ?? return #err("Geen toegang");
    let ctx = { works; settings };
    let allowed = Rights.may(ctx, p, #manageAccess, null) or (f.personId == p.id and (switch (f.workId) { case (?w) Rights.may(ctx, p, #uploadDocs, ?w); case null true }));
    if (not allowed) { return #err("Geen toegang") };
    if (f.archivedAt != null) { return #err("Al gearchiveerd") };
    if (reports.fileOwners.containsKey(id)) { return #err("Dit bestand hoort bij een werfverslag: haal het daar weg") };
    if (surveys.fileOwners.containsKey(id)) { return #err("Dit bestand hoort bij een opmeting: haal het daar weg") };
    if (Tenders.ownedFiles(tenders).containsKey(id)) { return #err("Dit bestand hoort bij een OA-offerte") };
    f.archivedAt := ?Time.now();
    Access.audit(audit, caller, ?p.id, f.workId, "bestand-gearchiveerd", f.name # " #" # id.toText());
    #ok;
  };
};
