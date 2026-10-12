// Service worker of the installable web app: keeps this app's own code available offline.
// It caches only same-origin app files (HTML, scripts, styles, icons, manifest) and never game
// data: the ROM is read in the page and the data package lives in IndexedDB.
const CACHE = "fftol-app-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png"];
const APP_FILE = /\.(html|js|css|svg|png|webmanifest|map)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.search) return;
  const isPage = e.request.mode === "navigate";
  if (!isPage && !APP_FILE.test(url.pathname)) return;
  if (isPage) {
    // the page first from the network (updates), the cached shell when offline
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); void caches.open(CACHE).then((k) => k.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // built assets have content hashes in their names: cache first
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((r) => {
    if (r.ok) { const c = r.clone(); void caches.open(CACHE).then((k) => k.put(e.request, c)); }
    return r;
  })));
});
