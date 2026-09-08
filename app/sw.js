/**
 * Offline shell.
 *
 * The app never talks to a server once it is loaded - files are read in the
 * page - so caching the shell is enough to make it work with no signal. The
 * two CDN scripts are cached on first success so a later offline launch still
 * gets the 3D view and the zip reader.
 */

const CACHE = "schem-bench-v1";

const SHELL = [
  ".",
  "index.html",
  "styles.css",
  "fonts.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/nbt.js",
  "js/blocks.js",
  "js/mcstructure.js",
  "js/viewer.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/three.min.js",
  "vendor/jszip.min.js",
  "fonts/chakra-petch-600.woff2",
  "fonts/chakra-petch-700.woff2",
  "fonts/ibm-plex-sans-400.woff2",
  "fonts/ibm-plex-sans-500.woff2",
  "fonts/ibm-plex-sans-600.woff2",
  "fonts/ibm-plex-mono-400.woff2",
  "fonts/ibm-plex-mono-500.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // One bad URL must not fail the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined))
      );
      self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // Refresh in the background so an update lands on the next launch.
        fetch(request)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          })
          .catch(() => undefined);
        return hit;
      }

      return fetch(request)
        .then((res) => {
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match("index.html"));
    })
  );
});
