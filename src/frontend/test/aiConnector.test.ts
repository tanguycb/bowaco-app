// 3.1-B2: de invoerhash van de browser = die van de gateway (gateway/src/bestanden.ts, invoerHash). Zelfde invoer als in
// gateway/test/v2.test.ts (tekst met GEHEIME_TEKST en de proef-PDF); de verwachte waarden kwamen uit de gatewayfunctie zelf.
// Draaien: cd src/frontend && npx vitest run test (buiten tsconfig "src", zodat tsc --noEmit geen vitest-types nodig heeft).
import { describe, expect, it } from "vitest";
import { GatewayFout, gatewayBase, invoerHash, sendTask } from "../src/aiConnector";

const enc = (s: string) => new TextEncoder().encode(s);
const TEKST = "Bij welke werf hoort dit? GEHEIME-INVOERTEKST-klant-Janssens";
const PDF = enc("%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF\n");

describe("invoerHash = gateway", () => {
  it("zonder bestanden = SHA-256 van de UTF-8-tekst", async () => {
    expect(await invoerHash(TEKST, [])).toBe("0cff9fc6fc1ff44d379f7d813f8ee709ea3d90b7b1b54e56b0227517f52e6596");
  });
  it("met de proef-PDF uit de gatewaytest (0x1E + bytes)", async () => {
    expect(await invoerHash(TEKST, [PDF])).toBe("f4a8a069989d21b92e809f710c982b2d6204c41e39f638af2ece0c9aa73182ee");
  });
  it("twee bestanden, in volgorde", async () => {
    expect(await invoerHash(TEKST, [PDF, PDF])).toBe("309916d408b1e4adad244089e5aae31c7ed25648e95b5683651ee81e208c9c5c");
  });
  it("niet-ASCII-tekst en binaire bytes (ook 0x00 en 0x1E in het bestand)", async () => {
    expect(await invoerHash("Één werf — €", [new Uint8Array([0, 0x1e, 0xff])])).toBe("e1826ca1ccdce637bc2ffcdc1aedd80d1bc28d5b45e6547624383fc6f6441438");
  });
  it("kleine hex, 64 tekens", async () => {
    expect(await invoerHash("", [])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sendTask", () => {
  it("multipart met ticket, invoer (met de hash) en bestanden als bytes, zonder bestandsnaam of URL", async () => {
    let seen: { url: string; fd: FormData } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, fd: init.body as FormData };
      return new Response(JSON.stringify({ callId: "7", voorstel: "101", taak: "routering", kostCent: 1, tokens: { in: 10, uit: 2 }, model: "nep/echo", terugval: false }), { status: 202 });
    }) as unknown as typeof fetch;
    const r = await sendTask("https://gw.voorbeeld.example/", "TK-abcdefgh12", { tekst: TEKST, bestanden: [PDF], instructieVersie: 1 }, fake);
    expect(r.voorstel).toBe("101");
    expect(seen!.url).toBe("https://gw.voorbeeld.example/v2/taak");
    const invoer = JSON.parse(String(seen!.fd.get("invoer")));
    expect(invoer).toEqual({ tekst: TEKST, refs: [], instructieVersie: 1, schemaVersie: 1, sha256: "f4a8a069989d21b92e809f710c982b2d6204c41e39f638af2ece0c9aa73182ee" });
    expect(seen!.fd.get("ticket")).toBe("TK-abcdefgh12");
    const b = seen!.fd.getAll("bestand");
    expect(b.length).toBe(1);
    expect(new Uint8Array(await (b[0] as Blob).arrayBuffer())).toEqual(PDF);
    expect((b[0] as File).name).toBe("bestand-1");
    expect(JSON.stringify(invoer)).not.toMatch(/https?:\/\//);
  });
  it("fout van de gateway → GatewayFout met de vaste code", async () => {
    const fake = (async () => new Response(JSON.stringify({ fout: "hash van de invoer klopt niet", code: "hash" }), { status: 400 })) as unknown as typeof fetch;
    await expect(sendTask("https://gw.voorbeeld.example", "TK-abcdefgh12", { tekst: "x", instructieVersie: 1 }, fake)).rejects.toMatchObject({ status: 400, code: "hash" });
  });
  it("adres: enkel https of de eigen machine", () => {
    expect(gatewayBase("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => gatewayBase("http://gw.voorbeeld.example")).toThrow(GatewayFout);
    expect(() => gatewayBase("https://gw.voorbeeld.example/?x=1")).toThrow(GatewayFout);
  });
});
