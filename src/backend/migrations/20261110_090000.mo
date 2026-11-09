// Stap 3.8 (OA-offerte inlezen → posten, bouwplan §6 "Twee wegen voor AI"): inleesopdrachten per werf en firma met het voorstel,
// de inhoud van het bestand of de tekst tot de opdracht afgesloten is, en de inhoud van proefgevallen. Alles als NIEUW stabiel veld
// `oaRead` (deelvorm, M4): niets bestaands wordt verbreed, OldActor = {}. De types staan hier letterlijk. NOOIT meer wijzigen
// zodra deze migratie op een canister staat die blijft bestaan (M2).
import Map "mo:core/Map";

module {
  type PersonId = Nat;
  type WorkId = Nat;
  type Day = Nat;
  type Extra = [(Text, Text)];
  type OaIncluded = { #yes; #no; #alt : Text };
  type OaReadVia = { #bot : Nat; #ai; #other : Text };
  type OaReadStatus = { #open; #proposed; #applied : Nat; #rejected : Text; #cancelled; #failed : Text; #other : Text };
  type OaReadLine = { itemId : ?Nat; description : Text; unit : Text; qtyMilli : Int; unitCents : ?Int; included : OaIncluded; remark : Text };
  type OaReadProposal = {
    number : Text;
    quoteDay : ?Day;
    validUntil : ?Day;
    discountBp : ?Nat;
    reverse : ?Bool;
    form : Text;
    lines : [OaReadLine];
    chapterTotals : [(Text, Int)];
    totalCents : ?Int;
    remarks : [Text];
    confidence : Nat;
    at : Int;
    extra : Extra;
  };
  type OaReadJob = {
    id : Nat;
    workId : WorkId;
    orgId : Nat;
    tenderId : ?Nat;
    inviteId : ?Nat;
    fileId : ?Nat;
    name : Text;
    mime : Text;
    size : Nat;
    via : OaReadVia;
    createdAt : Int;
    createdBy : PersonId;
    var status : OaReadStatus;
    var proposal : ?OaReadProposal;
    var decidedAt : ?Int;
    var decidedBy : ?PersonId;
    var extra : Extra;
  };
  type OaReadState = {
    jobs : Map.Map<Nat, OaReadJob>;
    byWork : Map.Map<Nat, [Nat]>;
    content : Map.Map<Nat, Blob>;
    proofContent : Map.Map<Text, Blob>;
  };

  public func migration(_ : {}) : { oaRead : OaReadState } {
    {
      oaRead = {
        jobs = Map.empty<Nat, OaReadJob>();
        byWork = Map.empty<Nat, [Nat]>();
        content = Map.empty<Nat, Blob>();
        proofContent = Map.empty<Text, Blob>();
      };
    };
  };
};
