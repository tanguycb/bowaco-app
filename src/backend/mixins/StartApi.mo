// Het startpunt (stap 2b.4, bouwplan rij 2b.4): "Aan de slag" (6 stappen die de beheerder als klaar markeert of die de
// app zelf afleidt) en "Zo werkt het voor jou" (één keer per persoon bevestigd). Niets in het stabiele geheugen: alles
// zit in settings.values (kleine vlaggen zonder migratie, D8), zoals de weekbordregels en de mailkeuzes:
//   start.klaar:<stap> = "ja"   een stap die de beheerder met de hand als klaar markeerde
//   start.verborgen    = "ja"   de kaart Aan de slag is verborgen
//   intro:<persoon-id> = "ja"   deze persoon heeft "Zo werkt het voor jou" begrepen
// Rechten: Rights.mo ongewijzigd. Lezen en het eigen "Begrepen" mag elke actieve persoon (enkel de eigen vlag); de kaart
// Aan de slag bewaren mag wie de instellingen mag wijzigen (#manageSettings = de beheerder). Een niet-beheerder krijgt
// geen stappen terug.
import Array "mo:core/Array";
import Map "mo:core/Map";
import Result "mo:core/Result";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  audit : Types.AuditState,
) {

  transient let startSteps : [Text] = ["bedrijf", "team", "onderaannemers", "posten", "werf", "planning"];

  func startIsAdmin(p : Types.Person) : Bool { Rights.may({ works; settings }, p, #manageSettings, null) };

  public query ({ caller }) func startState() : async Views.StartState {
    let p = Access.requireActive(access, caller);
    let admin = startIsAdmin(p);
    {
      introSeen = settings.values.get("intro:" # p.id.toText()) == ?"ja";
      hidden = admin and settings.values.get("start.verborgen") == ?"ja";
      marked = if (admin) { startSteps.filter(func k = settings.values.get("start.klaar:" # k) == ?"ja") } else { [] };
    };
  };

  public shared ({ caller }) func markIntroSeen() : async () {
    let p = Access.requireActive(access, caller);
    settings.values.add("intro:" # p.id.toText(), "ja");
  };

  public shared ({ caller }) func setStartStep(key : Text, done : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (not startSteps.any(func k = k == key)) { return #err("Onbekende stap") };
    if (done) { settings.values.add("start.klaar:" # key, "ja") } else { settings.values.remove("start.klaar:" # key) };
    Access.audit(audit, caller, ?p.id, null, "aan-de-slag", key # (if done " klaar" else " niet klaar"));
    #ok;
  };

  public shared ({ caller }) func setStartHidden(hidden : Bool) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    Rights.require({ works; settings }, p, #manageSettings, null);
    if (hidden) { settings.values.add("start.verborgen", "ja") } else { settings.values.remove("start.verborgen") };
    Access.audit(audit, caller, ?p.id, null, "aan-de-slag", if hidden "verborgen" else "weer getoond");
    #ok;
  };
};
