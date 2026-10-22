// Wie is de beller? Elke API-functie gaat hierlangs (§4: anoniem altijd geweigerd).
import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types";
import Config "Config";

module {
  type State = Types.State;

  public func isRobot(caller : Principal) : Bool {
    Config.robots().find(func r = r == caller) != null;
  };

  public func requireAuthenticated(caller : Principal) {
    if (caller.isAnonymous()) { Runtime.trap("Niet ingelogd") };
  };

  // Actieve persoon achter deze principal, of null.
  public func activePerson(st : State, caller : Principal) : ?Types.Person {
    if (caller.isAnonymous()) { return null };
    let link = st.links.get(caller) ?? return null;
    if (link.status != #active) { return null };
    st.persons.get(link.personId);
  };

  public func requireActive(st : State, caller : Principal) : Types.Person {
    requireAuthenticated(caller);
    activePerson(st, caller) ?? Runtime.trap("Geen toegang: geen actieve koppeling");
  };

  public func hasRole(p : Types.Person, role : Types.Role) : Bool {
    p.roles.find(func r = r == role) != null;
  };

  public func requireAdmin(st : State, caller : Principal) : Types.Person {
    let p = requireActive(st, caller);
    if (not hasRole(p, #admin)) { Runtime.trap("Geen toegang: alleen admin") };
    p;
  };

  public func isInternal(role : Types.Role) : Bool {
    role == #admin or role == #werfleider or role == #calculator;
  };

  public func anyInternal(roles : [Types.Role]) : Bool {
    roles.find(isInternal) != null;
  };

  // Admin mag alle rollen uitnodigen; een werfleider enkel externen (OA, architect, klant).
  public func mayInvite(inviter : Types.Person, roles : [Types.Role]) : Bool {
    if (hasRole(inviter, #admin)) { return true };
    hasRole(inviter, #werfleider) and not anyInternal(roles);
  };

  public func audit(st : State, who : Principal, personId : ?Nat, action : Text, detail : Text) {
    st.audit.add({ at = Time.now(); who; personId; action; detail });
  };

  public func personName(st : State, id : Nat) : Text {
    switch (st.persons.get(id)) {
      case (?p) { p.name };
      case null { "#" # id.toText() };
    };
  };

  // Pogingenlimiet per principal: 5 per uur, daarna 24 uur blokkering (§3.3.3).
  // Geeft null als de beller nu mag proberen, anders het einde van de blokkering.
  public func blockedUntil(st : State, caller : Principal) : ?Int {
    let a = st.attempts.get(caller) ?? return null;
    if (a.blockedUntil > Time.now()) { ?a.blockedUntil } else { null };
  };

  public func countFailure(st : State, caller : Principal) {
    let now = Time.now();
    let a = switch (st.attempts.get(caller)) {
      case (?a) { a };
      case null {
        let fresh : Types.Attempts = { var windowStart = now; var count = 0; var blockedUntil = 0 };
        st.attempts.add(caller, fresh);
        fresh;
      };
    };
    if (now - a.windowStart > Config.hour) {
      a.windowStart := now;
      a.count := 0;
    };
    a.count += 1;
    if (a.count >= Config.maxAttemptsPerHour) {
      a.blockedUntil := now + Config.blockAfterAttempts;
      a.count := 0;
    };
  };

  public func linkView(st : State, p : Principal, l : Types.Link) : Types.LinkView {
    {
      principal = p;
      personId = l.personId;
      personName = personName(st, l.personId);
      status = l.status;
      linkedAt = l.linkedAt;
      codeHint = l.codeHint;
      confirmedBy = l.confirmedBy;
    };
  };

  public func inviteView(st : State, i : Types.Invite) : Types.InviteView {
    {
      id = i.id;
      personId = i.personId;
      personName = personName(st, i.personId);
      kind = i.kind;
      createdBy = i.createdBy;
      createdAt = i.createdAt;
      expiresAt = i.expiresAt;
      hint = i.hint;
      state = i.state;
    };
  };

  public func lastN<T>(l : List.List<T>, n : Nat) : [T] {
    let size = l.size();
    let from : Nat = if (size > n) { Nat.sub(size, n) } else { 0 };
    l.sliceToArray(from, size);
  };
};
