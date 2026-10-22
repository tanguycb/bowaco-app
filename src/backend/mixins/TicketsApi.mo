// Ticketpatroon (§6): de gateway belt de app, nooit omgekeerd.
// 1. De browser vraagt een ticket (eenmalig, 10 min).  2. De gateway controleert het met checkTicket
// (alleen de robot-principal).  3. De gateway schrijft het resultaat terug als voorstel.
import Blob "mo:core/Blob";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Types "../types";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";

mixin (st : Types.State, ctr : Types.Counters) {

  public shared ({ caller }) func createTicket(task : Text, werf : Text) : async Result.Result<Types.NewTicket, Text> {
    ignore Access.requireActive(st, caller);
    if (task.size() == 0 or task.size() > 60 or werf.size() > 80) { return #err("Taak of werf ongeldig") };
    let entropy = await Random.blob();
    let p = Access.activePerson(st, caller) ?? return #err("Geen toegang meer");
    let ticket = Codes.ticketText(entropy);
    let now = Time.now();
    ctr.nextTicket += 1;
    let t : Types.Ticket = {
      id = ctr.nextTicket;
      hash = Codes.ticketHash(ticket);
      personId = p.id;
      task;
      werf;
      budgetCents = 100; // proef: € 1 per ticket
      createdAt = now;
      expiresAt = now + Config.ticketTtl;
      var used = false;
    };
    st.tickets.add(t.id, t);
    st.ticketIndex.add(t.hash, t.id);
    Access.audit(st, caller, ?p.id, "ticket-gemaakt", task # " #" # t.id.toText());
    #ok({ ticketId = t.id; ticket; expiresAt = t.expiresAt });
  };

  // Eén update-call van de gateway: geldig, niet gebruikt, niet verlopen → info + meteen verbruikt.
  public shared ({ caller }) func checkTicket(ticket : Text) : async Result.Result<Types.TicketInfo, Text> {
    if (not Access.isRobot(caller)) { Runtime.trap("Geen toegang: alleen de robot") };
    let id = st.ticketIndex.get(Codes.ticketHash(ticket)) ?? return #err("Onbekend ticket");
    let t = st.tickets.get(id) ?? return #err("Onbekend ticket");
    if (t.used) { return #err("Ticket al gebruikt") };
    if (Time.now() > t.expiresAt) { return #err("Ticket verlopen") };
    // De persoon kan intussen afgezet zijn: dan geen werk meer op zijn naam.
    let p = st.persons.get(t.personId) ?? return #err("Persoon bestaat niet meer");
    if (not st.links.values().any(func l = l.personId == p.id and l.status == #active)) {
      return #err("Persoon heeft geen actieve toegang meer");
    };
    t.used := true;
    Access.audit(st, caller, null, "ticket-gecontroleerd", "#" # id.toText() # " " # t.task);
    #ok({
      ticketId = t.id;
      personId = p.id;
      personName = p.name;
      task = t.task;
      werf = t.werf;
      budgetCents = t.budgetCents;
      expiresAt = t.expiresAt;
    });
  };

  // De robot schrijft één voorstel per gecontroleerd ticket; een mens keurt het later goed.
  public shared ({ caller }) func submitProposal(ticketId : Nat, content : Text) : async Result.Result<Nat, Text> {
    if (not Access.isRobot(caller)) { Runtime.trap("Geen toegang: alleen de robot") };
    let t = st.tickets.get(ticketId) ?? return #err("Onbekend ticket");
    if (not t.used) { return #err("Ticket eerst controleren") };
    if (Time.now() > t.expiresAt + Config.hour) { return #err("Te laat voor dit ticket") };
    if (content.size() > Config.maxProposalBytes) { return #err("Voorstel te groot") };
    if (st.proposals.values().find(func p = p.ticketId == ticketId) != null) { return #err("Er is al een voorstel") };
    ctr.nextProposal += 1;
    st.proposals.add(
      ctr.nextProposal,
      { id = ctr.nextProposal; ticketId; personId = t.personId; content; by = caller; at = Time.now() },
    );
    Access.audit(st, caller, null, "voorstel-ontvangen", "ticket #" # ticketId.toText());
    #ok(ctr.nextProposal);
  };

  public query ({ caller }) func myProposals() : async [Types.Proposal] {
    let p = Access.requireActive(st, caller);
    let admin = Access.hasRole(p, #admin);
    st.proposals.values().filter(func x = admin or x.personId == p.id).toArray();
  };
};
