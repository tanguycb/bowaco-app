// Nep-maildienst voor het EIGEN lokale testnet (nooit in de app, nooit op een draft): speelt de integratiecanister van
// Caffeine na (broadcast_email / send_email van caffeineai-email). Noteert per mail de ontvangers en het onderwerp, en
// kan een mail weigeren (#Err), vallen NA het noteren (trap: de mail is "weg" maar de app krijgt geen antwoord) of traag
// antwoorden (eigen oproepen). Neemt `prijs` cycles aan en meldt die als cycles_charged (zoals de echte dienst).
// tests/lokaal.sh bouwt dit en zet INTEGRATIONS_CANISTER_ID van de backend op deze canister.
import Cycles "mo:core/Cycles";
import List "mo:core/List";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";

persistent actor {
  type Recipient = { email : Text; substitutions : ?[(Text, Text)] };
  type Sub = { #Service; #Marketing : { topic_id : Nat32 }; #Verification };
  type Err = { #UnknownError : Text; #InvalidArgs : Text; #TooFewCyclesAttached : { required : Nat; attached : Nat }; #FailedToCallService : Text; #FailedToDeserializeServiceResponse : Text };
  type Response = { cycles_charged : Nat; result : { #Ok : {}; #Err : Err } };
  type Mail = { to : Text; subject : Text; size : Nat; sub : Text; from : Text; html : Text };

  let log = List.empty<Mail>();
  var modus = ""; // "" · "weiger" · "cycles" · "val" · "onleesbaar" · "traag"
  var stappen = 0;
  var prijs = 1_000_000;
  var bezig = 0; // mails die nu "onderweg" zijn (traag)

  // zet(modus, stappen = seconden voor "traag", prijs in cycles)
  public func zet(m : Text, n : Nat, p : Nat) : async () { modus := m; stappen := n; prijs := p };
  public func stap() : async () {};

  public func broadcast_email(a : { sub_type : Sub; from_username : Text; recipients : [Recipient]; subject : Text; html_body : Text }) : async Response {
    if (modus == "weiger") return { cycles_charged = 0; result = #Err(#InvalidArgs("nep weigert voor proef@nep.invalid")) };
    // 1b.5: de dienst vraagt meer cycles per mail dan de app meegeeft (niets genoteerd, niets aanvaard).
    if (modus == "cycles") return { cycles_charged = 0; result = #Err(#TooFewCyclesAttached({ required = 60_000_000_000; attached = Cycles.available() })) };
    let c = Cycles.accept<system>(prijs);
    let sub = switch (a.sub_type) { case (#Service) "service"; case (#Marketing _) "marketing"; case (#Verification) "verification" };
    for (r in a.recipients.values()) log.add({ to = r.email; subject = a.subject; size = a.html_body.size(); sub; from = a.from_username; html = a.html_body });
    if (modus == "val") {
      // De mail is genoteerd ("verstuurd"), maar de dienst valt daarna: zonder `await` gaat ook het noteren verloren,
      // dus eerst een eigen oproep (vastlegging), dan de val.
      await stap();
      Runtime.trap("nep valt na het versturen");
    };
    // 1b.5: de mail is genoteerd (de leverancier kreeg ze), maar het antwoord van de leverancier raakt niet gelezen: de
    // app mag NIET opnieuw sturen (onzeker).
    if (modus == "onleesbaar") return { cycles_charged = c; result = #Err(#FailedToDeserializeServiceResponse("nep: antwoord onleesbaar voor proef@nep.invalid")) };
    if (modus == "traag") {
      // `stappen` = seconden (1b.5): eigen oproepen tot de kloktijd verstreken is; zo blijft een mail meetbaar lang
      // "bij de maildienst" (PocketIC doet honderden stappen per seconde).
      bezig += 1;
      let until = Time.now() + stappen * 1_000_000_000;
      while (Time.now() < until) { await stap() };
      bezig -= 1;
    };
    { cycles_charged = c; result = #Ok({}) };
  };

  public func send_email(a : { from_username : Text; to : [Text]; cc : [Text]; bcc : [Text]; subject : Text; html_body : Text }) : async Response {
    for (t in a.to.values()) log.add({ to = t; subject = a.subject; size = a.html_body.size(); sub = "raw"; from = a.from_username; html = a.html_body });
    { cycles_charged = 0; result = #Ok({}) };
  };

  public query func mails(from : Nat) : async [Mail] { log.sliceToArray(from, log.size()) };
  public query func aantal() : async Nat { log.size() };
  public query func onderweg() : async Nat { bezig };
};
