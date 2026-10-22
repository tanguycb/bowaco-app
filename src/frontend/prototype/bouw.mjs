// Bouwt het prototype tot één HTML-bestand voor een claude.ai-Artifact (alles inline, lettertypes via Google Fonts).
// Gebruik: node prototype/bouw.mjs <uitvoer.html>   (vanuit src/frontend)
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("geef een uitvoerpad");
const dir = mkdtempSync(join(tmpdir(), "bowaco-proto-"));
execSync(`npx vite build --config prototype/vite.config.ts --logLevel warn`, { stdio: "inherit", env: { ...process.env, PROTO_OUT: dir } });
const js = readFileSync(join(dir, "proto.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const css = readFileSync(join(dir, "proto.css"), "utf8");
const html = `<title>BOWACO prototype 0.5</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Design system en klikbaar prototype van de BOWACO werfbeheer-app, ter goedkeuring.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
