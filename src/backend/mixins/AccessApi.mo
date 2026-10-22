// Toegang (§3.3): opstartcode, uitnodigings- en herstelcodes, bevestiging, intrekken, auditlog.
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Result "mo:core/Result";
import Time "mo:core/Time";
import Blob "mo:core/Blob";
import Types "../types";
import Access "../lib/Access";
import Codes "../lib/Codes";
import Config "../lib/Config";

mixin (st : Types.State, ctr : Types.Counters) {

  public query ({ caller }) func me() : async Types.MeView {
    let robot = Access.isRobot(caller);
    if (caller.isAnonymous()) {
      return { principal = caller; status = #anonymous; person = null; isRobot = false; blockedUntil = null };
    };
    let blocked = Access.blockedUntil(st, caller);
    switch (st.links.get(caller)) {
      case null {
        { principal = caller; status = #unlinked; person = null; isRobot = robot; blockedUntil = blocked };
      };
      case (?l) {
        {
          principal = caller;
          status = if (l.status == #active) { #active } else { #pending };
          person = st.persons.get(l.personId);
          isRobot = robot;
          blockedUntil = blocked;
        };
      };
    };
  };

  // Eerste installatie: wie de opstartcode heeft, wordt de eerste admin. Daarna is de code ongeldig.
  public shared ({ caller }) func claimBootstrap(code : Text, name : Text) : async Result.Result<Types.Person, Text> {
    Access.requireAuthenticated(caller);
    if (st.links.containsKey(caller)) { return #err("Deze login is al gekoppeld") };
    switch (Access.blockedUntil(st, caller)) {
      case (?until) { return #err("Te veel pogingen; geblokkeerd tot " # until.toText()) };
      case null {};
    };
    let body = Codes.normalize(code);
    let ok = switch (body) {
      case (?b) { Codes.hex(Codes.hash(b)) == Config.bootstrapHashHex and not ctr.bootstrapUsed };
      case null { false };
    };
    if (not ok) {
      Access.countFailure(st, caller);
      Access.audit(st, caller, null, "opstartcode-fout", "");
      return #err("Code ongeldig of al gebruikt");
    };
    let cleanName = if (name.size() == 0 or name.size() > 80) { "Beheerder" } else { name };
    ctr.nextPerson += 1;
    let person : Types.Person = {
      id = ctr.nextPerson;
      name = cleanName;
      roles = [#admin];
      createdAt = Time.now();
      createdBy = 0;
    };
    st.persons.add(person.id, person);
    let link : Types.Link = {
      personId = person.id;
      var status = #active;
      linkedAt = Time.now();
      codeHint = Codes.hint(body ?? "");
      var confirmedBy = null;
    };
    st.links.add(caller, link);
    ctr.bootstrapUsed := true;
    Access.audit(st, caller, ?person.id, "opstartcode-geclaimd", cleanName);
    #ok(person);
  };

  // Admin (alle rollen) of werfleider (enkel externen) maakt een persoon + uitnodigingscode.
  public shared ({ caller }) func invitePerson(name : Text, roles : [Types.Role], validDays : Nat) : async Result.Result<Types.NewCode, Text> {
    let inviter = Access.requireActive(st, caller);
    if (name.size() == 0 or name.size() > 80) { return #err("Naam: 1 tot 80 tekens") };
    if (roles.size() == 0) { return #err("Minstens één rol") };
    if (not Access.mayInvite(inviter, roles)) { return #err("Geen toegang voor deze rol(len)") };
    let entropy = await Random.blob();
    // Na de await opnieuw nakijken: de uitnodiger kan intussen afgezet zijn.
    let again = Access.activePerson(st, caller) ?? return #err("Geen toegang meer");
    if (not Access.mayInvite(again, roles)) { return #err("Geen toegang meer") };
    ctr.nextPerson += 1;
    let person : Types.Person = {
      id = ctr.nextPerson;
      name;
      roles;
      createdAt = Time.now();
      createdBy = again.id;
    };
    st.persons.add(person.id, person);
    let code = newCode(person.id, #invite, again.id, validDays, entropy);
    Access.audit(st, caller, ?again.id, "uitnodiging-gemaakt", person.name # " (code …" # Codes.hint(code.body) # ")");
    #ok({ inviteId = code.id; personId = person.id; code = Codes.display(code.body); expiresAt = code.expiresAt });
  };

  // Herstelcode: een extra principal voor een bestaande persoon (nieuw toestel, verloren passkey, live na draft).
  public shared ({ caller }) func createRecoveryCode(personId : Nat, validDays : Nat) : async Result.Result<Types.NewCode, Text> {
    ignore Access.requireAdmin(st, caller);
    if (st.persons.get(personId) == null) { return #err("Onbekende persoon") };
    let entropy = await Random.blob();
    let admin = Access.activePerson(st, caller) ?? return #err("Geen toegang meer");
    if (not Access.hasRole(admin, #admin)) { return #err("Geen toegang meer") };
    let code = newCode(personId, #recovery, admin.id, validDays, entropy);
    Access.audit(st, caller, ?admin.id, "herstelcode-gemaakt", Access.personName(st, personId) # " (code …" # Codes.hint(code.body) # ")");
    #ok({ inviteId = code.id; personId; code = Codes.display(code.body); expiresAt = code.expiresAt });
  };

  // De persoon voert de code in na de II-login. Geen await: alles gebeurt in één bericht.
  public shared ({ caller }) func redeemCode(code : Text) : async Result.Result<Types.MeView, Text> {
    Access.requireAuthenticated(caller);
    if (st.links.containsKey(caller)) { return #err("Deze login is al gekoppeld") };
    switch (Access.blockedUntil(st, caller)) {
      case (?until) { return #err("Te veel pogingen; geblokkeerd tot " # until.toText()) };
      case null {};
    };
    let fail = func(why : Text) : Result.Result<Types.MeView, Text> {
      Access.countFailure(st, caller);
      Access.audit(st, caller, null, "code-fout", why);
      #err("Code ongeldig, verlopen of al gebruikt");
    };
    let body = Codes.normalize(code) ?? return fail("vorm");
    let id = st.codeIndex.get(Codes.hash(body)) ?? return fail("onbekend");
    let inv = st.invites.get(id) ?? return fail("onbekend");
    if (inv.state != #open) { return fail("niet open (#" # id.toText() # ")") };
    let now = Time.now();
    if (now > inv.expiresAt) { return fail("verlopen (#" # id.toText() # ")") };
    let person = st.persons.get(inv.personId) ?? return fail("persoon weg");
    inv.state := #used({ by = caller; at = now });
    let internal = Access.anyInternal(person.roles);
    let link : Types.Link = {
      personId = person.id;
      var status = if (internal) { #pending } else { #active };
      linkedAt = now;
      codeHint = inv.hint;
      var confirmedBy = null;
    };
    st.links.add(caller, link);
    Access.audit(
      st,
      caller,
      ?person.id,
      "code-gebruikt",
      person.name # " koppelde zich met code …" # inv.hint # (if internal { " (wacht op bevestiging)" } else { "" }),
    );
    #ok({
      principal = caller;
      status = if (internal) { #pending } else { #active };
      person = ?person;
      isRobot = false;
      blockedUntil = null;
    });
  };

  public shared ({ caller }) func confirmLink(p : Principal) : async Result.Result<(), Text> {
    let admin = Access.requireAdmin(st, caller);
    let link = st.links.get(p) ?? return #err("Onbekende koppeling");
    if (link.status == #active) { return #err("Al actief") };
    link.status := #active;
    link.confirmedBy := ?admin.id;
    Access.audit(st, caller, ?admin.id, "koppeling-bevestigd", Access.personName(st, link.personId) # " " # p.toText());
    #ok;
  };

  // Afzetten werkt meteen: de volgende call van die principal wordt geweigerd.
  public shared ({ caller }) func revokeLink(p : Principal) : async Result.Result<(), Text> {
    let admin = Access.requireAdmin(st, caller);
    if (p == caller) { return #err("Je kunt jezelf niet afzetten") };
    let link = st.links.get(p) ?? return #err("Onbekende koppeling");
    st.links.remove(p);
    Access.audit(st, caller, ?admin.id, "koppeling-ingetrokken", Access.personName(st, link.personId) # " " # p.toText());
    #ok;
  };

  public shared ({ caller }) func revokeInvite(inviteId : Nat) : async Result.Result<(), Text> {
    let who = Access.requireActive(st, caller);
    let inv = st.invites.get(inviteId) ?? return #err("Onbekende code");
    if (not Access.hasRole(who, #admin) and inv.createdBy != who.id) { return #err("Geen toegang") };
    if (inv.state != #open) { return #err("Code is niet meer open") };
    inv.state := #revoked({ by = who.id; at = Time.now() });
    Access.audit(st, caller, ?who.id, "code-ingetrokken", "#" # inviteId.toText() # " …" # inv.hint);
    #ok;
  };

  // Admin ziet alles; een werfleider enkel de codes die hij zelf maakte.
  public query ({ caller }) func listInvites() : async [Types.InviteView] {
    let who = Access.requireActive(st, caller);
    let admin = Access.hasRole(who, #admin);
    st.invites.values().filter(func i = admin or i.createdBy == who.id).map(func i = Access.inviteView(st, i)).toArray();
  };

  public query ({ caller }) func listLinks() : async [Types.LinkView] {
    ignore Access.requireAdmin(st, caller);
    st.links.entries().map(func(p, l) = Access.linkView(st, p, l)).toArray();
  };

  public query ({ caller }) func listPersons() : async [Types.Person] {
    ignore Access.requireAdmin(st, caller);
    st.persons.values().toArray();
  };

  public query ({ caller }) func auditLog(last : Nat) : async [Types.AuditEntry] {
    ignore Access.requireAdmin(st, caller);
    Access.lastN(st.audit, if (last > 500) { 500 } else { last });
  };

  // Maakt de code, bewaart enkel de hash en geeft de kale code één keer terug.
  func newCode(personId : Nat, kind : Types.CodeKind, by : Nat, validDays : Nat, entropy : Blob) : {
    id : Nat;
    body : Text;
    expiresAt : Int;
  } {
    let body = Codes.fromEntropy(entropy, Codes.inviteLength);
    let days = if (validDays == 0 or validDays > 30) { Config.inviteDays } else { validDays };
    let now = Time.now();
    ctr.nextInvite += 1;
    let inv : Types.Invite = {
      id = ctr.nextInvite;
      hash = Codes.hash(body);
      personId;
      kind;
      createdBy = by;
      createdAt = now;
      expiresAt = now + days * Config.day;
      hint = Codes.hint(body);
      var state = #open;
    };
    st.invites.add(inv.id, inv);
    st.codeIndex.add(inv.hash, inv.id);
    { id = inv.id; body; expiresAt = inv.expiresAt };
  };
};
