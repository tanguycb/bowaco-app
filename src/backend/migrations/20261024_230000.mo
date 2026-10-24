// Stap mail-caffeine (E-11): de mail gaat rechtstreeks uit de app via de maildienst van Caffeine. Het logboek van de
// verstuurpogingen komt als NIEUW stabiel veld `mail` (deelvorm, M4). Niets bestaands wordt verbreed: OldActor = {}.
// Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen zodra deze migratie op een
// canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type OrgId = Nat;
  type Extra = [(Text, Text)];

  type MailOutcome = {
    #sent;
    #dryRun;
    #failed : Text;
    #unsure : Text;
  };

  type MailLog = {
    id : Nat;
    jobId : Nat;
    key : Text;
    kind : Text;
    orgId : ?OrgId;
    attempt : Nat;
    at : Int;
    recipients : Nat;
    test : Bool;
    lang : Text;
    outcome : MailOutcome;
    cycles : Nat;
    extra : Extra;
  };

  type MailState = {
    log : Map.Map<Nat, MailLog>;
  };

  type OldActor = {};
  type NewActor = { mail : MailState };

  public func migration(_ : OldActor) : NewActor {
    { mail = { log = Map.empty() } };
  };
};
