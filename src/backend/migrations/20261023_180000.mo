// Stap 1.2 (onderaannemers-database): contactgegevens van organisaties en personen als NIEUW stabiel
// veld `oa` (architectuur §2.3; deelvorm, M4). Org en Person worden niet verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze
// migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type Extra = [(Text, Text)];

  type OrgContact = {
    orgId : OrgId;
    phone : ?Text;
    email : ?Text;
    website : ?Text;
    contactNote : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type PersonContact = {
    personId : PersonId;
    email : ?Text;
    jobTitle : Text;
    note : Text;
    updatedAt : Int;
    updatedBy : PersonId;
    extra : Extra;
  };

  type OaState = {
    orgContacts : Map.Map<OrgId, OrgContact>;
    personContacts : Map.Map<PersonId, PersonContact>;
  };

  type OldActor = {};
  type NewActor = { oa : OaState };

  public func migration(_ : OldActor) : NewActor {
    { oa = { orgContacts = Map.empty(); personContacts = Map.empty() } };
  };
};
