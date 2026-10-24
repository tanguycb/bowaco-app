// Een mail uit de app (MailOut) → HTML + platte tekst. Alle tekst komt uit de app en wordt ontsnapt (geen HTML van
// buitenaf); een link enkel als https. Stijl: zakelijk, wit/zwart met één kobalt accent (design system v2), geen
// externe beelden of lettertypes (privacy, spamfilters).
import type { MailOut } from "./ic.ts";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function safeLink(m: MailOut): string | null {
  const l = m.link[0];
  return l && /^https:\/\/[^\s"'<>]+$/.test(l) ? l : null;
}

export function renderText(m: MailOut): string {
  const out: string[] = [m.heading, "", m.intro, ""];
  for (const s of m.sections) {
    out.push(s.title);
    if (s.subtitle) out.push(s.subtitle);
    for (const l of s.lines) out.push(`  - ${l}`);
    out.push("");
  }
  out.push(m.outro);
  const link = safeLink(m);
  if (link) out.push("", `Open de app: ${link}`);
  out.push("", "--", "BOWACO werven · deze mail werd automatisch verstuurd door de app. Je logt in met je eigen Internet Identity; deze mail bevat nooit een inlogcode.");
  return out.join("\n");
}

export function renderHtml(m: MailOut): string {
  const link = safeLink(m);
  const sections = m.sections
    .map(
      (s) => `
      <tr><td style="padding:16px 0 4px;border-top:1px solid #e3e5e8">
        <div style="font-weight:700;font-size:15px;color:#111">${esc(s.title)}</div>
        ${s.subtitle ? `<div style="font-size:13px;color:#555;margin-top:2px">${esc(s.subtitle)}</div>` : ""}
        <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#111;line-height:1.5">${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      </td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;background:#f2f3f5;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(m.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:24px">
    <tr><td style="font-weight:800;letter-spacing:.04em;color:#1e1f41;font-size:16px">BOWACO <span style="font-weight:400;color:#777;font-family:Menlo,Consolas,monospace;font-size:12px">werven</span></td></tr>
    <tr><td style="padding-top:16px;font-size:20px;font-weight:700;color:#111">${esc(m.heading)}</td></tr>
    <tr><td style="padding:8px 0 8px;font-size:14px;color:#111;line-height:1.5">${esc(m.intro)}</td></tr>
    ${sections}
    <tr><td style="padding-top:16px;border-top:1px solid #e3e5e8;font-size:14px;color:#111;line-height:1.5">${esc(m.outro)}</td></tr>
    ${link ? `<tr><td style="padding-top:16px"><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open de app</a></td></tr>` : ""}
    <tr><td style="padding-top:24px;font-size:12px;color:#777;line-height:1.4">Deze mail werd automatisch verstuurd door de BOWACO-app. Je logt in met je eigen Internet Identity; deze mail bevat nooit een inlogcode.</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
