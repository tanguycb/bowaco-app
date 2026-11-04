// Eigen versie van de opslagmixin van Caffeine (caffeineai-object-storage 1.1.1, Mixin.mo), met één
// verschil: _immutableObjectStorageCreateCertificate kijkt WIE er belt (T10, 0.2 open punt 1). In de
// versie van Caffeine kan iedereen, ook anoniem, een uploadcertificaat vragen en dus op onze kosten
// opladen. Hier alleen een actieve persoon met een uploadrecht (Rights #upload).
// De rest is ongewijzigd overgenomen: kassier, gatewaylijst, levende/dode blobs en opruiming.
// Het antwoordtype { method; blob_hash } moet exact zo blijven (de gateway controleert het).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Prim "mo:prim";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Storage "mo:caffeineai-object-storage/Storage";
import Types "../types";
import Access "../lib/Access";
import Config "../lib/Config";
import Rights "../lib/Rights";
import Post "../lib/Post";
import Tenders "../lib/Tenders";

mixin (
  settings : Types.SettingsState,
  access : Types.AccessState,
  works : Types.WorksState,
  tenders : Types.TenderState,
  oaDeals : Types.OaDealState,
) {
  transient let _immutableObjectStorageState : Storage.State = Storage.new();
  transient var _gatewayRefreshedAt : Int = 0;
  // 2c.9 (review S1 punt 4): een rem op certificaten voor een OA zonder #upload, per principal per uur (venster, aantal). Transient:
  // na een upgrade begint de telling opnieuw (geen stabiel veld, geen migratie).
  transient let _oaCertWindow = Map.empty<Principal, (Int, Nat)>();

  type _ImmutableObjectStorageRefillInformation = { proposed_top_up_amount : ?Nat };
  type _ImmutableObjectStorageRefillResult = { success : ?Bool; topped_up_amount : ?Nat };
  type _ImmutableObjectStorageCreateCertificateResult = { method : Text; blob_hash : Text };

  public shared ({ caller }) func _immutableObjectStorageRefillCashier(refillInformation : ?_ImmutableObjectStorageRefillInformation) : async _ImmutableObjectStorageRefillResult {
    let cashier = await Storage.getCashierPrincipal();
    if (cashier != caller) { Runtime.trap("Geen toegang") };
    await Storage.refillCashier(_immutableObjectStorageState, cashier, refillInformation);
  };

  // Voor iedereen aanroepbaar, zoals bij Caffeine (de gateway belt ze). 1.9 (O-06): hoogstens eens per 5 minuten echt
  // naar de kassier zolang de lijst gevuld is, zodat niemand op onze kosten cycles kan laten verbranden.
  public shared func _immutableObjectStorageUpdateGatewayPrincipals() : async () {
    let now = Time.now();
    if (_immutableObjectStorageState.authorizedPrincipals.size() > 0 and now - _gatewayRefreshedAt < Config.gatewayRefreshMin) { return };
    _gatewayRefreshedAt := now;
    await Storage.updateGatewayPrincipals(_immutableObjectStorageState);
  };

  public query func _immutableObjectStorageBlobsAreLive(hashes : [Blob]) : async [Bool] {
    hashes.map(func(hash : Blob) : Bool = Prim.isStorageBlobLive(hash));
  };

  public query ({ caller }) func _immutableObjectStorageBlobsToDelete() : async [Blob] {
    if (not Storage.isAuthorized(_immutableObjectStorageState, caller)) { Runtime.trap("Geen toegang") };
    switch (Prim.getDeadBlobs()) {
      case null [];
      case (?dead) dead.sliceToArray(0, 10000);
    };
  };

  public shared ({ caller }) func _immutableObjectStorageConfirmBlobDeletion(blobs : [Blob]) : async () {
    if (not Storage.isAuthorized(_immutableObjectStorageState, caller)) { Runtime.trap("Geen toegang") };
    Prim.pruneConfirmedDeadBlobs(blobs);
    type GC = actor { __motoko_gc_trigger : () -> async () };
    let myGC = actor (debug_show (Prim.getSelfPrincipal<system>())) : GC;
    await myGC.__motoko_gc_trigger();
  };

  // DE poort: geen certificaat zonder actieve persoon met uploadrecht. Een trap geeft de browser
  // een duidelijke weigering ("backend canister rejected …") en kost ons geen opslag.
  public shared ({ caller }) func _immutableObjectStorageCreateCertificate(blobHash : Text) : async _ImmutableObjectStorageCreateCertificateResult {
    let p = Access.requireActive(access, caller);
    // 2c.2 (R39): ook een OA met een open uitnodiging (zijn eigen offerte-PDF), zonder lid te zijn van een werf.
    // 2c.9 (review S1): niet meer elke OA met een firma, enkel met een open uitnodiging, als actief OA-lid of met een lopende afspraak
    // van zijn firma (Rights.mayUploadOa gaat dat zelf na), en hoogstens Config.maxOaCertsPerHour certificaten per uur.
    let ctx = { works; settings };
    if (not Rights.may(ctx, p, #upload, null)) {
      let now = Time.now();
      if (not Rights.mayUploadOa(ctx, p, Tenders.hasOpenInvite(ctx, tenders, p, now, Post.local(now).day), oaDeals)) { Runtime.trap("Geen toegang") };
      let (start, n) = switch (_oaCertWindow.get(caller)) { case (?(s, k)) { if (now - s < 3_600_000_000_000) (s, k) else (now, 0) }; case null (now, 0) };
      if (n >= Config.maxOaCertsPerHour) { Runtime.trap("Te veel bestanden op korte tijd; probeer over een uur opnieuw") };
      // Opruimen: oude vensters weg (momentopname van de sleutels, nooit de Map wijzigen tijdens het doorlopen).
      if (_oaCertWindow.size() > 1_000) {
        for (k in _oaCertWindow.entries().filter(func((_, (s, _)) : (Principal, (Int, Nat))) : Bool = now - s >= 3_600_000_000_000).map(func((k, _) : (Principal, (Int, Nat))) : Principal = k).toArray().values()) { _oaCertWindow.remove(k) };
      };
      _oaCertWindow.add(caller, (start, n + 1));
    };
    if (blobHash.size() > 100) { Runtime.trap("Het bestand is beschadigd; probeer opnieuw") };
    { method = "upload"; blob_hash = blobHash };
  };
};
