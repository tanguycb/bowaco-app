// Verzonnen voorbeeldoffertes voor de PDF-tests (stap 2.7): nooit een echte prijs, klant of werf.
import { readFileSync } from "node:fs";
export const FONT_DIR = new URL("../src/frontend/public/fonts/", import.meta.url).pathname;
/** De ingebedde lettertypes, zoals de browser ze ophaalt (public/fonts). */
export function fonts() {
  const r = (n) => new Uint8Array(readFileSync(FONT_DIR + n));
  return { regular: r("archivo-400.ttf"), medium: r("archivo-600.ttf"), bold: r("archivo-700.ttf"), mono: r("ibm-plex-mono-400.ttf"), monoBold: r("ibm-plex-mono-600.ttf") };
}

const L = (chapter, kind, code, title, text, qty, unitName, form, unit, line, specRef = "") => ({ chapter, kind, code, title, text, specRef, qtyMilli: BigInt(qty), unitName, form, unitSellCents: unit === null ? null : BigInt(unit), lineSellCents: BigInt(line) });

/** Een volledige verzonnen offerte; `over` past velden aan. */
export function voorbeeld(over = {}) {
  const lines = [
    L("c1", "item", "1.01", "Proef werfinrichting", "Verzonnen: inrichting van de werf, afsluiting en nutsvoorzieningen. Een langere lastenboektekst om te zien hoe de PDF lange omschrijvingen afbreekt over meerdere regels zonder de kolommen te overlappen.", 1000, "som of geheel", "fixed", 90000, 90000),
    L("c1", "text", "", "Alle werken volgens het lastenboek (proeftekst)", "", 0, "", "fixed", null, 0),
    L("c1", "item", "1.02", "Proef vergunning inname openbaar domein", "", 1000, "post", "fixed", 25000, 25000),
    L("c2", "item", "7.01", "Proef dakgoot zink", "Verzonnen proefpost.", 12500, "lm", "vh", 5625, 70313, "OA code 6.3"),
    L("c2", "item", "7.02", "Proef chape", "", 30000, "m²", "vh", 2400, 72000),
    L("c2", "item", "7.03", "Proef minwerk: bestaande goot hergebruiken", "", -2000, "lm", "vh", 5625, -11250),
    L("c2", "item", "7.04", "Proef pro memorie", "", 0, "st", "vh", 15431, 0),
    L("c2", "option", "7.90", "Proef optie: zinken kraal", "", 12500, "lm", "fixed", 1000, 12500),
    L("c2", "option", "7.91", "Proef optie: geen bakgoot achteraan", "", -4000, "lm", "fixed", 5625, -22500),
    L("c3", "item", "9.01", "Proef opkuis en afvoer", "", 1000, "post", "regie", 4800, 4800),
  ];
  const sub = 90000n + 25000n + 70313n + 72000n - 11250n + 4800n;
  const vat = (sub * 600n + 5000n) / 10000n;
  return {
    number: "2026/234", version: 1, title: "Proef renovatie woning", intro: "Verzonnen inleiding: wij bieden u aan, voor de uitvoering van de hierna vermelde werken, de volgende prijs.",
    status: "verstuurd", frozen: true, hash: "e41f4b2e374d" + "0".repeat(52), sentDay: 20_751, validUntilDay: 20_781, validDays: 30, paymentDays: 30, vatBp: 600n,
    vatNote: "Woning ouder dan 10 jaar, in gebruik als privéwoning (proeftekst)",
    issuer: "BOWACO (proef)\nProefstraat 1, 8670 Koksijde\nBTW BE 0000.000.000",
    clientName: "Familie Proef", clientAddress: { street: "Proefstraat", number: "12", zip: "8670", city: "Koksijde", country: "BE" }, clientVat: "",
    workCode: "P-A", workName: "Proefwerf A", workAddress: { street: "Werfstraat", number: "3", zip: "8670", city: "Koksijde", country: "BE" },
    chapters: [
      { key: "c1", code: "01", title: "Werfinrichting", sellCents: 115000n },
      { key: "c2", code: "07", title: "Dakwerken", sellCents: 131063n },
      { key: "c3", code: "09", title: "Opkuis", sellCents: 4800n },
    ],
    lines, subtotalCents: sub, vatCents: vat, totalCents: sub + vat, optionsPlusCents: 12500n, optionsMinusCents: -22500n,
    terms: { version: 0, title: "Algemene voorwaarden (voorlopig)", text: "1. Toepassing\n[In te vullen door BOWACO.]\n\n2. Offerte en geldigheid\n[In te vullen door BOWACO.]\n\n3. Betaling\n[In te vullen door BOWACO.]", provisional: true },
    accepted: null,
    ...over,
  };
}
