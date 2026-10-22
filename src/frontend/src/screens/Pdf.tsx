import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { useState } from "react";
import { errText, fmtBytes } from "../util";

const NAVY = rgb(0x1e / 255, 0x1f / 255, 0x41 / 255);

// (e) Een werfverslag-PDF maken en tonen, volledig in de browser (geen server, geen gateway).
async function makeReport(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Werfverslag (proef)");
  doc.setProducer("BOWACO werfbeheer 0.2");
  const page = doc.addPage([595, 842]); // A4
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: NAVY });
  page.drawText("BOWACO", { x: 40, y: 800, size: 26, font: serif, color: rgb(1, 1, 1) });
  page.drawText("Werfverslag — PROEF, geen echte gegevens", { x: 200, y: 806, size: 12, font: sans, color: rgb(1, 1, 1) });
  const today = new Date().toLocaleDateString("nl-BE");
  let y = 740;
  const line = (label: string, value: string) => {
    page.drawText(label, { x: 40, y, size: 11, font: bold, color: NAVY });
    page.drawText(value, { x: 180, y, size: 11, font: sans });
    y -= 20;
  };
  line("Werf", "Proefwerf, Voorbeeldstraat 1, 8670 Koksijde");
  line("Datum", today);
  line("Werfleider", "Testpersoon");
  y -= 10;
  page.drawText("Wie was er?", { x: 40, y, size: 13, font: bold, color: NAVY });
  y -= 22;
  const rows = [
    ["OA Proef Tegels", "2 personen", "8 u"],
    ["OA Proef Elektriciteit", "1 persoon", "4 u"],
    ["Eigen ploeg", "1 persoon", "8 u"],
  ];
  for (const [who, n, h] of rows) {
    page.drawText(who, { x: 50, y, size: 11, font: sans });
    page.drawText(n, { x: 260, y, size: 11, font: sans });
    page.drawText(h, { x: 380, y, size: 11, font: sans });
    page.drawLine({ start: { x: 40, y: y - 6 }, end: { x: 555, y: y - 6 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.85) });
    y -= 22;
  }
  y -= 10;
  page.drawText("Wat is er gedaan?", { x: 40, y, size: 13, font: bold, color: NAVY });
  y -= 22;
  for (const t of ["Vloertegels badkamer gelegd (70 %)", "Stopcontacten keuken geplaatst", "Werfzone opgeruimd"]) {
    page.drawText(`• ${t}`, { x: 50, y, size: 11, font: sans });
    y -= 18;
  }
  page.drawText(`Gemaakt in de browser op ${new Date().toLocaleString("nl-BE")}`, { x: 40, y: 40, size: 8, font: sans, color: rgb(0.4, 0.4, 0.45) });
  return doc.save();
}

export function PdfPanel() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState("");
  const [err, setErr] = useState("");
  const make = async () => {
    setErr("");
    try {
      const t0 = performance.now();
      const bytes = await makeReport();
      const ms = performance.now() - t0;
      if (url) URL.revokeObjectURL(url);
      setUrl(URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" })));
      setInfo(`${fmtBytes(bytes.length)} gemaakt in ${ms.toFixed(0)} ms`);
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <section className="card">
      <h2>PDF maken en tonen</h2>
      <p>Maakt een proef-werfverslag in de browser en toont het hieronder. Op de gsm: kijk of de PDF zichtbaar is of enkel als download opent.</p>
      <div className="stack">
        <button type="button" onClick={make}>Werfverslag-PDF maken</button>
        {url && (
          <span>
            <a href={url} target="_blank" rel="noreferrer">In nieuw tabblad openen</a>
            {" · "}
            <a href={url} download="werfverslag-proef.pdf">Downloaden</a>
          </span>
        )}
      </div>
      {info && <p>{info}</p>}
      {err && <p className="error">{err}</p>}
      {url && <iframe title="werfverslag" src={url} className="pdfview" />}
    </section>
  );
}
