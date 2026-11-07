// De caffeine-adapter (stap 3.1, ontwerp 3.1 §2.3): de inferentiedienst van Caffeine (OpenAI-vorm, /v1/chat/completions en
// /v1/models) via caffeineai-inference-client 0.4.1. Eén node (is_replicated = false): het antwoord is niet door consensus
// bevestigd, maar het wordt enkel een voorstel dat een mens nakijkt.
//
// De sleutel (CAFFEINE_INFERENCE_API_KEY) zet Caffeine zelf in de omgeving van de canister. De app BEWAART, LOGT of TOONT hem
// nooit: hij wordt per oproep gelezen (Config.fromEnv cachet bewust niet) en gaat enkel mee in de outcall. Dit bestand en
// lib/Mail.mo zijn de enige plaatsen met Prim.envVar (tests/review.mjs kijkt dat mechanisch na).
//
// Uitkomstklassen (zoals Mail.SendResult): #ok, #retry (schoon geweigerd: 502, 503), #invalid (400, 401/403, 413, onleesbaar
// antwoord), #unsure (geen antwoord: de dienst kan wél gerekend hebben; 500), #noFunds (cycles of 429 no_credits/cap_*),
// #rateLimited (429 rate_limit_exceeded), #modelUnknown (400 model_not_found), #refused (het model weigerde).
import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Char "mo:core/Char";
import Cycles "mo:core/Cycles";
import Error "mo:core/Error";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Prim "mo:⛔";
import { JSON } "mo:serde-core";
import ChatApi "mo:caffeineai-inference-client/Apis/ChatApi";
import { JSON = ChatRequest } "mo:caffeineai-inference-client/Models/ChatCompletionRequest";
import ModelsApi "mo:caffeineai-inference-client/Apis/ModelsApi";
import IConfig "mo:caffeineai-inference-client/Config";
import Config "../Config";
import AiPrompts "../AiPrompts";

module {
  public type Usage = { promptTokens : Nat; completionTokens : Nat; cachedTokens : Nat };
  public type Outcome = {
    #ok : { content : Text; usage : ?Usage; model : Text; cycles : Nat };
    #retry : Text;
    #invalid : { why : Text; charged : Bool };
    #unsure : Text;
    #noFunds : Text;
    #rateLimited : Text;
    #modelUnknown : Text;
    #refused : { usage : ?Usage; cycles : Nat };
  };

  public type ModelPrice = { alias : Text; prompt : Text; completion : Text; cacheRead : Text; cacheWrite : Text };

  // Opschonen van elke tekst van de dienst vóór ze in het logboek of een melding komt: nooit een adres, sleutel of URL.
  public func scrub(t : Text) : Text {
    var out = "";
    var word = "";
    let flush = func() {
      let lower = word.toLower();
      out #= (
        if (word.contains(#char '@')) "[adres]"
        else if (lower.contains(#text "://") or lower.startsWith(#text "www.")) "[url]"
        else if (lower.startsWith(#text "sk-") or lower.startsWith(#text "xai-") or lower.startsWith(#text "bearer") or word.size() >= 32) "[sleutel]"
        else word
      );
      word := "";
    };
    for (c in t.chars()) {
      if (c == ' ' or c == '\"' or c == '\'' or c == '(' or c == ')' or c == ',' or c == '<' or c == '>' or c == '\n' or c == '`') { flush(); out #= (if (c == '\n') " " else Char.toText(c)) } else { word #= Char.toText(c) };
    };
    flush();
    Text.fromIter(out.chars().take(200));
  };

  // Is de dienst ingesteld (sleutel aanwezig)? De waarde zelf verlaat deze functie nooit.
  public func configured<system>() : Bool { Prim.envVar<system>("CAFFEINE_INFERENCE_API_KEY") != null };

  func config<system>(maxBytes : Nat64) : IConfig.Config {
    { IConfig.fromEnv<system>() with max_response_bytes = ?maxBytes; cycles = ?Config.aiCyclesMax; is_replicated = ?false; pricing_version = ?2 };
  };

  // De client geeft bij een fout "HTTP <code>: <vaste uitleg> - <antwoord van de dienst>". De vaste uitleg noemt ALLE codes van
  // die status (bv. no_credits én rate_limit_exceeded): enkel het deel na " - " zegt welke het was.
  func detail(m : Text) : Text {
    let parts = m.split(#text " - ").toArray();
    if (parts.size() < 2) "" else Text.join(parts.sliceToArray(1, parts.size()).values(), " - ");
  };

  func classify(m : Text) : Outcome {
    let msg = scrub(m);
    let d = detail(m);
    if (m.startsWith(#text "HTTP 400")) {
      if (d.contains(#text "model_not_found")) #modelUnknown(msg) else #invalid({ why = msg; charged = false });
    } else if (m.startsWith(#text "HTTP 401") or m.startsWith(#text "HTTP 403")) {
      #invalid({ why = "sleutel geweigerd door de dienst (" # Text.fromIter(m.chars().take(8)) # ")"; charged = false });
    } else if (m.startsWith(#text "HTTP 413")) {
      #invalid({ why = "invoer te groot voor de dienst"; charged = false });
    } else if (m.startsWith(#text "HTTP 429")) {
      if (d.contains(#text "rate_limit_exceeded")) #rateLimited(msg) else #noFunds("tegoed of uitgaveplafond van Caffeine bereikt: " # scrub(d));
    } else if (m.startsWith(#text "HTTP 502") or m.startsWith(#text "HTTP 503")) {
      #retry(msg);
    } else if (m.startsWith(#text "HTTP 2")) {
      // Antwoord ontvangen maar onleesbaar: de dienst heeft gerekend.
      #invalid({ why = "antwoord onleesbaar: " # msg; charged = true });
    } else {
      // 500, of geen antwoord binnen de tijd van het IC: misschien gerekend → onzeker, nooit vanzelf opnieuw.
      #unsure(msg);
    };
  };

  // Eén chat-oproep. `schema` is de JSON van het antwoordschema (strict).
  public func chat<system>(model : Text, v : AiPrompts.Version, userText : Text) : async* Outcome {
    if (Cycles.balance() < Config.aiCyclesFloor + Config.aiCyclesMax) {
      return #noFunds("de app heeft te weinig cycles voor een AI-oproep (" # (Cycles.balance() / 1_000_000_000).toText() # " miljard); laad de app op bij Caffeine");
    };
    if (not configured<system>()) return #retry("inferentiedienst niet ingesteld (geen sleutel in de omgeving)");
    let schema = switch (JSON.toCandid(v.schema)) { case (#ok c) c; case (#err _) return #invalid({ why = "schema van de taak onleesbaar"; charged = false }) };
    let req = {
      ChatRequest.init({
        model;
        messages = [
          #system_({ content = #string(v.instruction); role = #system_; name = null }),
          #user({ content = #string(userText); role = #user; name = null }),
        ];
      }) with
      max_completion_tokens = ?v.maxTokens;
      temperature = ?0.0;
      response_format = ?#json_schema({ json_schema = { name = v.schemaName; description = null; schema = ?schema; strict = ?true }; type_ = #json_schema });
    };
    let before = Cycles.balance();
    try {
      let r = await* ChatApi.createChatCompletion(config<system>(Config.aiMaxResponseBytes), req);
      let used = if (before > Cycles.balance()) Nat.sub(before, Cycles.balance()) else 0;
      let usage = switch (r.usage) {
        case (?u) ?{ promptTokens = u.prompt_tokens; completionTokens = u.completion_tokens; cachedTokens = switch (u.prompt_tokens_details) { case (?d) d.cached_tokens; case null 0 } };
        case null null;
      };
      if (r.choices.size() == 0) return #invalid({ why = "antwoord zonder keuze"; charged = true });
      let m = r.choices[0].message;
      switch (m.refusal) { case (?_) return #refused({ usage; cycles = used }); case null {} };
      switch (m.content) {
        case (?c) #ok({ content = c; usage; model = r.model; cycles = used });
        case null #invalid({ why = "antwoord zonder inhoud"; charged = true });
      };
    } catch (e) {
      classify(e.message());
    };
  };

  // De catalogus (één outcall, klein antwoord).
  public func models<system>() : async* { #ok : [ModelPrice]; #err : Text } {
    if (Cycles.balance() < Config.aiCyclesFloor + Config.aiCyclesMax) return #err("te weinig cycles");
    if (not configured<system>()) return #err("inferentiedienst niet ingesteld (geen sleutel in de omgeving)");
    try {
      let r = await* ModelsApi.listModels(config<system>(Config.aiModelsResponseBytes));
      #ok(r.data.map(func(m : { id : Text; pricing : { prompt : Text; completion : Text; input_cache_read : Text; input_cache_write : Text } }) : ModelPrice = { alias = m.id; prompt = m.pricing.prompt; completion = m.pricing.completion; cacheRead = m.pricing.input_cache_read; cacheWrite = m.pricing.input_cache_write }));
    } catch (e) {
      #err(scrub(e.message()));
    };
  };

  // "0.0000025000" (USD per token) → × 10^10 als Nat; null als het geen gewone decimale tekst is.
  public func per1e10(t : Text) : ?Nat {
    let parts = t.split(#char '.').toArray();
    if (parts.size() == 0 or parts.size() > 2) return null;
    let whole = if (parts[0] == "") 0 else (Nat.fromText(parts[0]) ?? return null);
    var frac = if (parts.size() == 2) parts[1] else "";
    if (frac.size() > 10) frac := Text.fromIter(frac.chars().take(10));
    for (c in frac.chars()) { if (c < '0' or c > '9') return null };
    while (frac.size() < 10) { frac #= "0" };
    let f = Nat.fromText(frac) ?? return null;
    ?(whole * 10_000_000_000 + f);
  };

  // Kost in eurocent (naar boven afgerond) uit de tokens en de prijs in USD × 10^10 per token; koers in milli (920 = 0,920).
  public func costCents(u : Usage, promptPer1e10 : Nat, completionPer1e10 : Nat, cacheReadPer1e10 : Nat, usdEurMilli : Nat) : Nat {
    let cached = Nat.min(u.cachedTokens, u.promptTokens);
    let usd1e10 = (Nat.sub(u.promptTokens, cached)) * promptPer1e10 + cached * cacheReadPer1e10 + u.completionTokens * completionPer1e10;
    let eur1e10 = usd1e10 * usdEurMilli;
    // 1 cent = 10^8 (USD × 10^10) en de koers is × 1000.
    let unit = 100_000_000_000;
    (eur1e10 + unit - 1) / unit;
  };
};
