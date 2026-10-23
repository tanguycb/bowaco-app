// Ticketpatroon (§6.1): de gateway belt de app, nooit omgekeerd.
// 1. De browser vraagt een ticket (eenmalig, 10 min).  2. De gateway controleert het met checkTicket
// (alleen een robotprincipal).  3. De gateway schrijft één voorstel.  4. Een mens beslist.
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Types "../types";
import Views "../types/views";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";
import Ids "../lib/Ids";
import Rights "../lib/Rights";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  robot : Types.RobotState,
  audit : Types.AuditState,
  ctr : Types.Counters,
) {

  public shared ({ caller }) func createTicket(task : Text, workId : ?Nat) : async Result.Result<Views.NewTicket, Text> {
    let p = Access.requireActive(access, caller);
    let ctx = { works; settings };
    Rights.require(ctx, p, #useTickets, null);
    switch workId { case (?w) Rights.require(ctx, p, #readWork, ?w); case null {} };
    let budget = switch (Config.ticketTasks().find(func(t : (Text, Nat)) : Bool = t.0 == task)) {
      case (?t) t.1;
      case null return #err("Onbekende taak");
    };
    let entropy = await Random.blob();
    // R33: na de await opnieuw nakijken.
    let again = Access.activePerson(access, caller) ?? return #err("Geen toegang meer");
    if (not Rights.may(ctx, again, #useTickets, null)) { return #err("Geen toegang meer") };
    let ticket = Codes.ticketText(entropy);
    let now = Time.now();
    let id = Ids.next(ctr, "ticket");
    let t : Types.Ticket = {
      id;
      hash = Codes.ticketHash(ticket);
      personId = again.id;
      task;
      workId;
      payloadRef = null;
      budgetCents = budget;
      createdAt = now;
      expiresAt = now + Config.ticketTtl;
      var state = #open;
    };
    robot.tickets.add(id, t);
    robot.ticketIndex.add(t.hash, id);
    Access.audit(audit, caller, ?again.id, workId, "ticket-gemaakt", task # " #" # id.toText());
    #ok({ ticketId = id; ticket; expiresAt = t.expiresAt });
  };

  // Eén update-call van de gateway: geldig, open, niet verlopen → info en meteen verbruikt.
  public shared ({ caller }) func checkTicket(ticket : Text) : async Result.Result<Views.TicketInfo, Text> {
    Access.requireRobot(robot, caller);
    if (ticket.size() > 64) { return #err("Onbekend ticket") };
    let id = robot.ticketIndex.get(Codes.ticketHash(ticket)) ?? return #err("Onbekend ticket");
    let t = robot.tickets.get(id) ?? return #err("Onbekend ticket");
    if (t.state != #open) { return #err("Ticket al gebruikt of verlopen") };
    if (Time.now() > t.expiresAt) { return #err("Ticket verlopen") };
    // R28: de persoon kan intussen afgezet zijn; dan geen werk meer op zijn naam.
    let p = access.persons.get(t.personId) ?? return #err("Persoon bestaat niet meer");
    if (p.archivedAt != null or not Access.hasActiveLink(access, p.id)) {
      return #err("Persoon heeft geen actieve toegang meer");
    };
    t.state := #used(Time.now());
    Access.audit(audit, caller, null, t.workId, "ticket-gecontroleerd", "#" # id.toText() # " " # t.task);
    #ok({ ticketId = id; personId = p.id; personName = p.name; task = t.task; workId = t.workId; budgetCents = t.budgetCents; expiresAt = t.expiresAt });
  };

  // De robot schrijft één voorstel per gecontroleerd ticket; een mens beslist later.
  public shared ({ caller }) func submitProposal(ticketId : Nat, kind : Text, content : Text) : async Result.Result<Nat, Text> {
    Access.requireRobot(robot, caller);
    let t = robot.tickets.get(ticketId) ?? return #err("Onbekend ticket");
    switch (t.state) { case (#used _) {}; case _ return #err("Ticket eerst controleren") };
    if (Time.now() > t.expiresAt + Config.proposalGrace) { return #err("Te laat voor dit ticket") };
    if (content.size() > Config.maxProposalBytes or kind.size() > 40) { return #err("Voorstel te groot") };
    if (robot.proposalByTicket.containsKey(ticketId)) { return #err("Er is al een voorstel") };
    let id = Ids.next(ctr, "proposal");
    let x : Types.Proposal = { id; ticketId = ?ticketId; jobId = null; personId = ?t.personId; workId = t.workId; kind; content; by = caller; at = Time.now(); var decision = null };
    robot.proposals.add(id, x);
    robot.proposalByTicket.add(ticketId, id);
    Access.audit(audit, caller, null, t.workId, "voorstel-ontvangen", "ticket #" # ticketId.toText());
    #ok(id);
  };

  // Eigen voorstellen; de admin ziet alle. Nieuwste eerst.
  public query ({ caller }) func myProposals() : async [Views.ProposalView] {
    let p = Access.requireActive(access, caller);
    let all = Rights.may({ works; settings }, p, #readAudit, null);
    robot.proposals.reverseEntries().map(func((_, v) : (Nat, Types.Proposal)) : Types.Proposal = v).filter(func x = all or x.personId == ?p.id).take(200).map(proposalView).toArray();
  };

  // De beslisser past het voorstel zelf toe via de gewone API (§6.1); hier wordt enkel de beslissing vastgelegd.
  public shared ({ caller }) func decideProposal(id : Nat, accepted : Bool, note : Text) : async Result.Result<(), Text> {
    let p = Access.requireActive(access, caller);
    let x = robot.proposals.get(id) ?? return #err("Onbekend voorstel");
    let allowed = x.personId == ?p.id or Rights.may({ works; settings }, p, #readAudit, null);
    if (not allowed) { return #err("Geen toegang") };
    if (x.decision != null) { return #err("Al beslist") };
    if (note.size() > Config.maxText) { return #err("Notitie te lang") };
    x.decision := ?{ by = p.id; at = Time.now(); accepted; note };
    Access.audit(audit, caller, ?p.id, x.workId, if accepted "voorstel-aanvaard" else "voorstel-geweigerd", "#" # id.toText());
    #ok;
  };

  func proposalView(x : Types.Proposal) : Views.ProposalView {
    { id = x.id; ticketId = x.ticketId; personId = x.personId; workId = x.workId; kind = x.kind; content = x.content; by = x.by; at = x.at; decision = x.decision };
  };
};
