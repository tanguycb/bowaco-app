// Codes (opstart, uitnodiging, herstel, ticket): maken uit raw_rand, normaliseren en hashen.
// Alfabet = Crockford base32 (geen I, L, O, U): 5 bit per teken, goed leesbaar en dicteerbaar.
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat8 "mo:core/Nat8";
import Text "mo:core/Text";
import Sha256 "mo:sha2/Sha256";

module {
  let alphabet : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z'];
  let hexDigits : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

  // Uitnodigings- en herstelcodes: 12 tekens = 60 bit. Opstartcode: 16 tekens = 80 bit.
  public let inviteLength : Nat = 12;

  // `entropy` komt van raw_rand (32 bytes). 256 is deelbaar door 32, dus geen vertekening.
  public func fromEntropy(entropy : Blob, length : Nat) : Text {
    let bytes = entropy.toArray();
    if (bytes.size() < length) { return "" };
    Text.fromIter(Array.tabulate<Char>(length, func i = alphabet[(bytes[i] % 32).toNat()]).values());
  };

  // "BOW-7K3P-9QZT-4MXA" ← "7K3P9QZT4MXA"
  public func display(body : Text) : Text {
    var out = "BOW";
    var i = 0;
    for (c in body.chars()) {
      if (i % 4 == 0) { out #= "-" };
      out #= Char.toText(c);
      i += 1;
    };
    out;
  };

  public func hint(body : Text) : Text {
    let cs = Text.toArray(body);
    if (cs.size() < 2) { return body };
    Text.fromIter([cs[cs.size() - 2], cs[cs.size() - 1]].values());
  };

  // Maakt van wat een mens intikt de kale code: hoofdletters, zonder streepjes of spaties,
  // zonder voorvoegsel BOW, O→0 en I/L→1. Ongeldige tekens → null.
  public func normalize(raw : Text) : ?Text {
    let up = Text.toUpper(raw);
    var compact = "";
    for (c in up.chars()) {
      if (c != '-' and c != ' ' and c != '\t' and c != '\n') { compact #= Char.toText(c) };
    };
    let n = compact.size();
    let body = if (n == 3 + 12 or n == 3 + 16) {
      compact.stripStart(#text "BOW") ?? compact;
    } else { compact };
    var out = "";
    for (c0 in body.chars()) {
      let c = if (c0 == 'O') { '0' } else if (c0 == 'I' or c0 == 'L') { '1' } else { c0 };
      if (alphabet.find(func a = a == c) == null) { return null };
      out #= Char.toText(c);
    };
    if (out.size() != 12 and out.size() != 16) { return null };
    ?out;
  };

  // Hash met domeinscheiding: een gelekte hash past nooit op een ander soort sleutel.
  public func hash(body : Text) : Blob {
    Sha256.fromBlob(#sha256, ("bowaco-code-v1|" # body).encodeUtf8());
  };

  public func ticketHash(ticket : Text) : Blob {
    Sha256.fromBlob(#sha256, ("bowaco-ticket-v1|" # ticket).encodeUtf8());
  };

  public func hex(b : Blob) : Text {
    var out = "";
    for (byte in b.toArray().values()) {
      let n = byte.toNat();
      out #= Char.toText(hexDigits[n / 16]) # Char.toText(hexDigits[n % 16]);
    };
    out;
  };

  public func ticketText(entropy : Blob) : Text {
    let bytes = entropy.toArray();
    let take = if (bytes.size() < 16) { bytes.size() } else { 16 };
    "TK-" # hex(Array.tabulate<Nat8>(take, func i = bytes[i]).toBlob());
  };

  public func hexPrefix(b : Blob, bytes : Nat) : Text {
    let all = b.toArray();
    let n = if (all.size() < bytes) { all.size() } else { bytes };
    hex(all.sliceToArray(0, n).toBlob());
  };
};
