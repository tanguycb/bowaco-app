// UI-proef (alleen lokaal, NIET de app-build: Caffeine bouwt src/frontend met vite.config.ts in de
// map erboven). Dezelfde app (src/main.tsx), maar het loginpakket is vervangen door ii-shim.tsx:
// inloggen met een testsleutel uit ~/.bowaco tegen het EIGEN testnet (poort 8041). Zo kan Claude de
// schermen per rol in de browser nakijken zonder Internet Identity. Er komt niets hiervan in de app.
//   CID=<canister> npx vite --config proef/vite.config.ts      (vanuit src/frontend)
//   open http://localhost:5321/?als=admin   (admin, werfleider, calculator, architect, oa2, klant, vc …)
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";

const cid = process.env.CID ?? "";

export default defineConfig({
  root: resolve(__dirname, ".."),
  plugins: [
    react(),
    {
      name: "bowaco-proef",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (url.startsWith("/env.json")) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ backend_host: `http://localhost:${process.env.BOWACO_PORT ?? "8041"}`, backend_canister_id: cid, project_id: "undefined", ii_derivation_origin: "undefined", storage_gateway_url: "undefined" }));
            return;
          }
          const m = url.match(/^\/__proef\/([a-z0-9-]+)$/);
          if (m) {
            // Alleen testsleutels "proef-*" (nooit robot- of andere sleutels).
            res.setHeader("content-type", "application/json");
            res.end(readFileSync(join(homedir(), ".bowaco", `proef-${m[1]}.json`), "utf8"));
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: { "@caffeineai/core-infrastructure": resolve(__dirname, "ii-shim.tsx") },
    dedupe: ["@icp-sdk/core"],
  },
  // Het echte loginpakket leest process.env (vite-plugin-environment in de app-build).
  define: { "process.env": JSON.stringify({ CANISTER_ID_BACKEND: cid, BASE_URL: "/" }) },
  server: { port: 5321, strictPort: true, host: "127.0.0.1" },
  optimizeDeps: { esbuildOptions: { define: { global: "globalThis" } } },
});
