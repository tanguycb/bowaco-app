// Service worker van BOWACO (architectuur §8.2): de app-schil, de lettertypes en env.json staan in een cache, zodat
// de app ook zonder bereik opent (laatste stand, "wacht op verbinding"). Enkel eigen adres en enkel GET; oproepen
// naar het Internet Computer en de opslagdienst gaan nooit via deze cache. Gegevens zelf staan in IndexedDB.
const CACHE = "bowaco-schil-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/env.json", "/manifest.webmanifest", "/icon-192.png"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("bowaco-schil-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") c.put(key ?? req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(key ?? req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") c.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // De pagina zelf: eerst het netwerk (een nieuwe draft komt meteen door), anders de laatste versie.
  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req, "/"));
    return;
  }
  // Gebouwde bestanden hebben een hash in de naam: de cache volstaat.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.pathname === "/env.json" || url.pathname.endsWith(".png") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(networkFirst(req));
  }
});
