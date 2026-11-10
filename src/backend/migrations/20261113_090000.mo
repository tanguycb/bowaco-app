// Stap 4b.1 (Te doen, bouwplan §9 fase 4b): per persoon wat hij uitstelde (sleutel van de regel → dag). Alles als NIEUW stabiel veld
// `todo` (deelvorm, M4): niets bestaands wordt verbreed, OldActor = {}. De types staan hier letterlijk. NOOIT meer wijzigen zodra
// deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type Day = Nat;
  type TodoState = {
    snoozes : Map.Map<PersonId, Map.Map<Text, Day>>;
    extra : Map.Map<Text, Text>;
  };

  public func migration(_ : {}) : { todo : TodoState } {
    {
      todo = {
        snoozes = Map.empty<PersonId, Map.Map<Text, Day>>();
        extra = Map.empty<Text, Text>();
      };
    };
  };
};
