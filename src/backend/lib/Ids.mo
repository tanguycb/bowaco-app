// Ids uit tellers (D3): nooit map.size(), nooit hergebruik. Eerste id = 1.
import Map "mo:core/Map";
import Text "mo:core/Text";
import Types "../types";

module {
  public func next(ctr : Types.Counters, collection : Text) : Nat {
    let n = (switch (ctr.get(collection)) { case (?v) v; case null 0 }) + 1;
    ctr.add(collection, n);
    n;
  };

  public func current(ctr : Types.Counters, collection : Text) : Nat {
    switch (ctr.get(collection)) { case (?v) v; case null 0 };
  };
};
