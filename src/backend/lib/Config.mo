// Vaste waarden van de app. Hier staan alleen hashes en publieke principals, nooit geheimen.
import Principal "mo:core/Principal";

module {
  public let version = "0.2-draft3";
  public let schema : Nat = 2;

  // SHA-256("bowaco-code-v1|" # code) van de TEST-opstartcode voor de haalbaarheidsdraft.
  // De code zelf staat niet in git; de echte opstartcode maakt de eigenaar bij stap 0.6.
  public let bootstrapHashHex = "6216ebc1c162d43959d117ee9241bcba1ed55286a5bd37042ddc9f9aa7d55c0f";

  // Publieke principal van de proefrobot (Ed25519-sleutel staat bij de gateway, hier: ~/.bowaco).
  public func robots() : [Principal] {
    [Principal.fromText("vqdrx-m2dcp-h7hxk-zbxiw-bugyt-bkolx-befhd-ixzjz-cfnrm-iz2qd-6ae")];
  };

  public let second : Int = 1_000_000_000;
  public let hour : Int = 3_600_000_000_000;
  public let day : Int = 86_400_000_000_000;

  public let inviteDays : Nat = 7;
  public let maxAttemptsPerHour : Nat = 5;
  public let blockAfterAttempts : Int = day;
  public let ticketTtl : Int = 600_000_000_000; // 10 min
  public let maxProposalBytes : Nat = 10_000;
  public let maxFileBytes : Nat = 25_000_000;
  public let maxFilesPerPerson : Nat = 200;
  public let maxProbeNotes : Nat = 20;
  public let timerSeconds : Nat = 60;

  public func allowedMime(mime : Text) : Bool {
    mime == "image/jpeg" or mime == "image/png" or mime == "image/webp" or mime == "application/pdf";
  };
};
