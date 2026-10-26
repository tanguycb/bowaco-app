// Stap 2b.1 (begrippen en adresboek, vraag 12 van het prototype): een eigen firmasoort veiligheidscoördinator. De variant
// `OrgKind` krijgt de tag #safetyCoordinator. Omdat de firma's in een Map staan (var root/size: invariant), is een bredere
// variant daar geen subtype (M0170): het veld `org` wordt dus omgezet, firma per firma, zonder één gegeven te veranderen.
// Alle andere velden blijven ongemoeid. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer
// wijzigen zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type OrgId = Nat;
  type Extra = [(Text, Text)];
  type Sealed = { keyId : Text; iv : Blob; ct : Blob; alg : Text };
  type Confidential<T> = { #plain : T; #sealed : Sealed };
  type Address = { street : Text; number : Text; zip : Text; city : Text; country : Text };
  type Contact = { name : Text; phone : ?Text; email : ?Text; address : ?Address };

  type OldOrgKind = { #bowaco; #subcontractor; #architect; #client; #supplier; #authority; #other };
  type NewOrgKind = { #bowaco; #subcontractor; #architect; #client; #supplier; #authority; #other; #safetyCoordinator };

  type OldOrg = {
    id : OrgId;
    kind : OldOrgKind;
    name : Text;
    kbo : ?Text;
    vat : ?Text;
    aliases : [Text];
    trades : [Text];
    address : ?Address;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };
  type NewOrg = {
    id : OrgId;
    kind : NewOrgKind;
    name : Text;
    kbo : ?Text;
    vat : ?Text;
    aliases : [Text];
    trades : [Text];
    address : ?Address;
    notes : Text;
    createdAt : Int;
    createdBy : PersonId;
    var archivedAt : ?Int;
    extra : Extra;
  };
  type OrgConfidential = {
    orgId : OrgId;
    var contact : Confidential<Contact>;
    var notes : Confidential<Text>;
    var version : Nat;
  };
  type Vehicle = { id : Nat; plate : Text; name : Text; createdAt : Int; var archivedAt : ?Int; extra : Extra };

  type OldOrgState = {
    orgs : Map.Map<OrgId, OldOrg>;
    orgConfidential : Map.Map<OrgId, OrgConfidential>;
    vehicles : Map.Map<Nat, Vehicle>;
  };
  type NewOrgState = {
    orgs : Map.Map<OrgId, NewOrg>;
    orgConfidential : Map.Map<OrgId, OrgConfidential>;
    vehicles : Map.Map<Nat, Vehicle>;
  };

  type OldActor = { org : OldOrgState };
  type NewActor = { org : NewOrgState };

  func kind(k : OldOrgKind) : NewOrgKind {
    switch k {
      case (#bowaco) #bowaco;
      case (#subcontractor) #subcontractor;
      case (#architect) #architect;
      case (#client) #client;
      case (#supplier) #supplier;
      case (#authority) #authority;
      case (#other) #other;
    };
  };

  public func migration(old : OldActor) : NewActor {
    let orgs = Map.map<OrgId, OldOrg, NewOrg>(
      old.org.orgs,
      func(_, o) = {
        id = o.id;
        kind = kind(o.kind);
        name = o.name;
        kbo = o.kbo;
        vat = o.vat;
        aliases = o.aliases;
        trades = o.trades;
        address = o.address;
        notes = o.notes;
        createdAt = o.createdAt;
        createdBy = o.createdBy;
        var archivedAt = o.archivedAt;
        extra = o.extra;
      },
    );
    { org = { orgs; orgConfidential = old.org.orgConfidential; vehicles = old.org.vehicles } };
  };
};
