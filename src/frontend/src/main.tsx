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

// withAttributes={false}: geen e-mail of naam uit II opvragen (§1: login zonder e-mailadres).
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <InternetIdentityProvider withAttributes={false}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </InternetIdentityProvider>
  </QueryClientProvider>,
);
