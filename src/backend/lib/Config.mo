// Vaste waarden van de app. Hier staan alleen hashes, nooit geheimen. Robotprincipals beheert de
// admin in de app (robot.robots), niet meer hier.
module {
  public let version = "0.6-draft2";
  public let schema : Nat = 1;

  // SHA-256("bowaco-code-v1|" # code) van de opstartcode (16 tekens, 80 bit).
  // NU: de TEST-opstartcode (code alleen in ~/.bowaco, nooit in git), zodat de rollentest op de
  // draft de eerste admin kan claimen. Vóór live (0.7) komt hier de hash van de echte code, die de
  // eigenaar zelf maakt met tools/opstartcode.mjs (A16, T21). Een hash wisselen is geen migratie.
  public let bootstrapHashHex = "6216ebc1c162d43959d117ee9241bcba1ed55286a5bd37042ddc9f9aa7d55c0f";

  public let second : Int = 1_000_000_000;
  public let minute : Int = 60_000_000_000;
  public let hour : Int = 3_600_000_000_000;
  public let day : Int = 86_400_000_000_000;

  // Codes (bouwplan §3.3)
  public let inviteDaysDefault : Nat = 7;
  public let inviteDaysMax : Nat = 30;
  public let maxAttemptsPerHour : Nat = 5;
  public let blockAfterAttempts : Int = day;
  // Globale remming: melding aan de admins vanaf zoveel fouten per uur over alle principals,
  // en alle codepogingen dicht tot het einde van het uur vanaf de tweede grens.
  public let globalAlertPerHour : Nat = 100;
  public let globalLockPerHour : Nat = 1_000;

  // Grenzen (D10)
  public let maxName : Nat = 80;
  public let maxShort : Nat = 20;
  public let maxText : Nat = 1_000;
  public let maxLabel : Nat = 60;
  public let maxListPage : Nat = 500;
  public let maxRoles : Nat = 7;
  public let maxWorkIdsPerInvite : Nat = 50;
  public let maxAliases : Nat = 20;

  // Tickets (§6)
  public let ticketTtl : Int = 600_000_000_000; // 10 min
  public let proposalGrace : Int = 3_600_000_000_000; // voorstel tot 1 uur na vervallen
  public let maxProposalBytes : Nat = 10_000;
  public func ticketTasks() : [(Text, Nat)] { [("proef", 100)] }; // (taak, budget in cent)

  // Bestanden (§2.7, R11)
  public let maxFileBytes : Nat = 25_000_000;
  public let maxFilesPerPerson : Nat = 2_000;
  public func allowedMime(mime : Text) : Bool {
    mime == "image/jpeg" or mime == "image/png" or mime == "image/webp" or mime == "application/pdf";
  };

  // Timer: elke 10 min klein werk (0.2 open punt 6)
  public let timerSeconds : Nat = 600;
};
