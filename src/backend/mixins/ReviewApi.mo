// "Nog na te kijken" per werf (stap 2b.6, bouwplan rij 2b.6): de inrichting met de gegevens van BOWACO maakt werven met
// voorlopige keuzes (adres uit de mapnaam, btw 6 %, code van de index). De reden staat bij de werf tot de beheerder ze
// nakijkt en wist. Niets in het stabiele geheugen: alles zit in settings.values (kleine teksten zonder migratie, D8):
//   nakijken:werf:<werf-id> = de reden
// Rechten: Rights.mo ongewijzigd. Lezen = een interne rol die de werf mag zien (#readWork); een klant, architect, OA of VC
// krijgt niets (het is een interne notitie). Zetten en wissen = wie de instellingen beheert (#manageSettings = beheerder).
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Types "../types";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  audit : Types.AuditState,
) {

  transient let reviewPrefix = "nakijken:werf:";

  public query ({ caller }) func workReviewNotes() : async [(Nat, Text)] {
    let p = Access.requireActive(access, caller);
    if (not Rights.internal(p)) { return [] };
    let ctx = { works; settings };
    works.works.values().filterMap(
      func(w : Types.Work) : ?(Nat, Text) = if (not Rights.may(ctx, p, #readWork, ?w.id)) null else switch (settings.values.get(reviewPrefix # w.id.toText())) {
        case (?t) ?(w.id, t);
        case null null;
      }
    ).toArray();
  };

  // Lege tekst = nagekeken (de notitie verdwijnt).
  public shared ({ caller }) func setWorkReviewNote(workId : Nat, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    let w = works.works.get(workId) ?? return #err("Onbekende werf");
    let t = note.trim(#char ' ');
    if (t.size() > Config.maxText) { return #err("Tekst: hoogstens " # Config.maxText.toText() # " tekens") };
    let key = reviewPrefix # workId.toText();
    if (t == "") {
      settings.values.remove(key);
      Access.audit(audit, caller, ?p.id, ?w.id, "werf-nagekeken", w.code);
    } else {
      settings.values.add(key, t);
      Access.audit(audit, caller, ?p.id, ?w.id, "werf-na-te-kijken", w.code);
    };
    #ok;
  };
};
