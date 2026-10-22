// Proefmetingen van stap 0.2: timerstatus, vetKeys-publieke sleutel (h), migratienotities (f).
// probeStatus is een update-call: alleen die mag de omgevingsvariabelen lezen.
// Verdwijnt in stap 0.6; niets hiervan hoort in de echte app.
import Int "mo:core/Int";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Error "mo:core/Error";
import Mgmt "mo:ic-vetkeys/ManagementCanister";
import Types "../types";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";

mixin (st : Types.State, ctr : Types.Counters, tmr : Types.TimerState, vk : Types.VetkdState) {

  public shared ({ caller }) func probeStatus() : async Types.ProbeStatus {
    Access.requireAuthenticated(caller);
    {
      version = Config.version;
      canisterTime = Time.now();
      timerTicks = tmr.ticks;
      timerLastTick = tmr.lastTick;
      timerRecent = tmr.recent;
      expiredTickets = tmr.expiredTickets;
      envNames = Runtime.envVarNames<system>();
      vetkdLastAt = vk.lastAt;
      vetkdLastReport = vk.lastReport;
      probeNotes = st.probe.size();
      persons = st.persons.size();
      files = st.files.size();
    };
  };

  // (h) Werkt vetkd_public_key in een Caffeine-draft? Enkel de publieke sleutel: geen afleiding,
  // geen data. Hoogstens één keer per minuut (elke ingelogde principal mag het proberen).
  public shared ({ caller }) func probeVetkd() : async Text {
    Access.requireAuthenticated(caller);
    let now = Time.now();
    if (now - vk.lastAt < 60 * Config.second) { return "Even wachten. Vorige meting: " # vk.lastReport };
    vk.lastAt := now; // vóór de await, zodat parallelle calls niet allemaal doorgaan
    let envName = Runtime.envVar<system>("VETKD_KEY_NAME");
    let names = switch (envName) {
      case (?n) { [n, "key_1", "test_key_1"] };
      case null { ["key_1", "test_key_1"] };
    };
    var report = "VETKD_KEY_NAME=" # (envName ?? "(niet gezet)");
    for (name in names.values()) {
      let t0 = Time.now();
      try {
        let pk = await Mgmt.vetKdPublicKey(null, "bowaco-proef".encodeUtf8(), { curve = #bls12_381_g2; name });
        let ms = (Time.now() - t0) / 1_000_000;
        report #= " | " # name # ": OK " # pk.size().toText() # " B, " # ms.toText() # " ms, " # Codes.hexPrefix(pk, 8) # "…";
      } catch (e) {
        report #= " | " # name # ": FOUT " # Error.message(e);
      };
    };
    vk.lastReport := report;
    report;
  };

  // (f) Proefnotities: een kleine verzameling om te zien of data een upgrade overleeft.
  public shared ({ caller }) func addProbeNote(text : Text) : async Result.Result<Nat, Text> {
    Access.requireAuthenticated(caller);
    if (text.size() == 0 or text.size() > 200) { return #err("1 tot 200 tekens") };
    if (st.probe.size() >= Config.maxProbeNotes) { return #err("Maximum bereikt") };
    ctr.nextProbe += 1;
    st.probe.add(ctr.nextProbe, { id = ctr.nextProbe; text; by = caller; at = Time.now(); version = Config.schema });
    #ok(ctr.nextProbe);
  };

  public query ({ caller }) func probeNotes() : async [Types.ProbeNote] {
    Access.requireAuthenticated(caller);
    st.probe.values().toArray();
  };
};
