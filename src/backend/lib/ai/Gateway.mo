// De ticket-kant van de gateway-weg (stap 3.1, ontwerp 3.1 §2.2.2). Geen outcall: de app maakt een ticket (zelfde vorm als
// TicketsApi.createTicket: 128 bit toeval, enkel de hash bewaard, 10 min geldig) met de fiche als taak, de reservering als
// budget en de oproep als payloadRef ("ai:<id>"). De browser stuurt ticket + invoer + bestanden naar de gateway; die controleert
// het ticket (checkTicket, robot "ai"), schrijft het voorstel (submitProposal) en meldt de kost (reportAiUsage) of de fout
// (failAiTicket).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Blob "mo:core/Blob";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Types "../../types";
import Codes "../Codes";
import Config "../Config";
import Ids "../Ids";

module {
  public func ticket(robot : Types.RobotState, ctr : Types.Counters, personId : Nat, task : Text, workId : ?Nat, callId : Nat, budgetCents : Nat, entropy : Blob, now : Int) : { ticketId : Nat; ticket : Text; expiresAt : Int } {
    let ticket = Codes.ticketText(entropy);
    let id = Ids.next(ctr, "ticket");
    let t : Types.Ticket = {
      id;
      hash = Codes.ticketHash(ticket);
      personId;
      task;
      workId;
      payloadRef = ?("ai:" # callId.toText());
      budgetCents;
      createdAt = now;
      expiresAt = now + Config.ticketTtl;
      var state = #open;
    };
    robot.tickets.add(id, t);
    robot.ticketIndex.add(t.hash, id);
    { ticketId = id; ticket; expiresAt = t.expiresAt };
  };

  // "<leverancier>/<model>" met een gekende leverancier (de gateway kent de toegelaten modellen zelf).
  public func validModel(m : Text) : Bool {
    let parts = m.split(#char '/').toArray();
    parts.size() == 2 and parts[1].size() > 0 and parts[1].size() <= 60 and Config.aiGatewayProviders().any(func p = p == parts[0]);
  };
};
