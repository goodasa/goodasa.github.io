const CACHE_NAME = "chuwi-dashboard-v15";
const APP_SHELL = [
  "./",
  "./index.html",
  "./dashboard-config.js",
  "./school-parser.js",
  "./cram-parser.js",
  "./memory-parser.js",
  "./dashboard.css",
  "./dashboard.js",
  "./manifest.webmanifest",
  "./icon-dashboard.svg",
  "./school/class.md",
  "./school/cram.md",
  "./memory/english.md",
  "./memory/korean.md",
  "./memory/science.md",
  "./memory/social.md",
  "./memory/idiom.md",
  "./memory/hanmun.md"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }
  const isLocalDynamicAsset =
    url.origin === self.location.origin &&
    (
      request.destination === "style" ||
      request.destination === "script" ||
      request.destination === "manifest" ||
      url.pathname.endsWith(".md")
    );

  if (request.mode === "navigate" || isLocalDynamicAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    return caches.match(request) || caches.match("./index.html");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }

  return response;
}
