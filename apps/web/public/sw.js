/* Offline shell: lets a refresh while offline open the app (which then shows
   its own "offline" messages) instead of the browser's error page. API calls
   are never cached. */
const CACHE = "fintranzact-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Page loads: the network first, the saved shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put("/", response.clone()));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  // Built files have hashed names, so a saved copy never goes stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
            return response;
          }),
      ),
    );
  }
});
