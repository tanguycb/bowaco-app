import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./design/design.css";
import "./app/app.css";
import "./app/werf.css";
import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { applyTheme, ToastProvider, type Theme } from "./design";

declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function () {
  return this.toString();
};

try {
  applyTheme((localStorage.getItem("bw-theme") as Theme | null) ?? "system");
} catch {
  applyTheme("system");
}
document.documentElement.classList.add("bw-root");

// Service worker (architectuur §8.2): de app opent ook zonder bereik. Enkel in de gebouwde app.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Fouten niet stil opnieuw proberen: een "Geen toegang" moet meteen zichtbaar zijn (§8.1 regel 6).
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// Framebeveiliging (T18, O-08; stap 1.9). Een CSP in een meta-tag kan geen frame-ancestors zetten en de gateway van
// Caffeine stuurt geen X-Frame-Options, dus beslist de app zelf: ingesloten door een vreemde pagina (clickjacking) toont
// ze enkel een link om zichzelf bovenaan te openen. Enkel de Caffeine-editor (het voorbeeldvenster op caffeine.ai) mag
// insluiten; zonder referrer (of een andere) geldt: niet tonen.
function framedByStranger(): boolean {
  if (window.top === window.self) return false;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return !(host === "caffeine.ai" || host.endsWith(".caffeine.ai"));
  } catch {
    return true;
  }
}

const root = document.getElementById("root")!;
if (framedByStranger()) {
  const box = document.createElement("div");
  box.className = "a-gate";
  const p = document.createElement("p");
  p.textContent = "BOWACO werven opent niet binnen een andere website.";
  const a = document.createElement("a");
  a.href = window.location.href;
  a.target = "_top";
  a.rel = "noopener";
  a.textContent = "Open de app zelf";
  box.append(p, a);
  root.replaceChildren(box);
} else {
  // withAttributes={false}: geen e-mail of naam uit II opvragen (§1: login zonder e-mailadres).
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <InternetIdentityProvider withAttributes={false}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </InternetIdentityProvider>
    </QueryClientProvider>,
  );
}
