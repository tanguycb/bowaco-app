// Bestanden: de browser laadt op naar de opslagdienst van Caffeine; de backend bewaart enkel de verwijzing.
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Time "mo:core/Time";
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";
import Access "../lib/Access";
import Config "../lib/Config";

mixin (st : Types.State, ctr : Types.Counters) {

  public shared ({ caller }) func addFile(name : Text, mime : Text, size : Nat, blob : Storage.ExternalBlob) : async Result.Result<Nat, Text> {
    let p = Access.requireActive(st, caller);
    if (name.size() == 0 or name.size() > 200) { return #err("Bestandsnaam: 1 tot 200 tekens") };
    if (not Config.allowedMime(mime)) { return #err("Alleen JPEG, PNG, WebP of PDF") };
    if (size > Config.maxFileBytes) { return #err("Bestand te groot") };
    let mine = st.files.values().filter(func f = f.personId == p.id).size();
    if (mine >= Config.maxFilesPerPerson) { return #err("Quotum bereikt") };
    ctr.nextFile += 1;
    st.files.add(ctr.nextFile, { id = ctr.nextFile; name; mime; size; blob; personId = p.id; at = Time.now() });
    Access.audit(st, caller, ?p.id, "bestand-toegevoegd", name # " (" # size.toText() # " B)");
    #ok(ctr.nextFile);
  };

  public query ({ caller }) func listFiles() : async [Types.FileRec] {
    ignore Access.requireActive(st, caller);
    st.files.values().toArray();
  };
};
