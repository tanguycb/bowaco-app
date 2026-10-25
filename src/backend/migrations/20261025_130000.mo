// Stap 2.6 (controleregels vóór verzending): wat de beheerder instelt (regels, standaardposten) en de doorgezette
// waarschuwingen per verzonden versie. Alles komt als NIEUW stabiel veld `quoteChecks` (deelvorm, M4). Niets bestaands
// wordt verbreed: OldActor = {}. Zelfstandig (M4): de types staan hier letterlijk, alleen mo:core. NOOIT meer wijzigen
// zodra deze migratie op een canister staat die blijft bestaan (M2); dan komt er een nieuw bestand.
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type QuoteSeverity = { #warn; #block };
  type QuoteRuleCfg = { key : Text; enabled : Bool; severity : QuoteSeverity; thresholdBp : ?Nat; updatedAt : Int; updatedBy : PersonId };
  type QuoteStdPost = { key : Text; name : Text; keywords : [Text]; enabled : Bool; severity : QuoteSeverity; order : Nat; updatedAt : Int; updatedBy : PersonId; archivedAt : ?Int };
  type QuoteCheckDone = { versionId : Nat; at : Int; by : PersonId; reason : Text; warned : [(Text, Nat)] };
  type QuoteChecksState = {
    rules : Map.Map<Text, QuoteRuleCfg>;
    stdPosts : Map.Map<Text, QuoteStdPost>;
    done : Map.Map<Nat, QuoteCheckDone>;
  };

  type OldActor = {};
  type NewActor = { quoteChecks : QuoteChecksState };

  public func migration(_ : OldActor) : NewActor {
    { quoteChecks = { rules = Map.empty(); stdPosts = Map.empty(); done = Map.empty() } };
  };
};
