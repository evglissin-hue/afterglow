// Afterglow service worker: makes the app installable, lets it open with a weak signal, and shows
// sunset alerts sent with Web Push.

const STATIC_CACHE = "afterglow-static-v1"; // hashed build files, which never change
const PAGE_CACHE = "afterglow-pages-v1"; // the main screens and spot data, refreshed on every visit
const MAIN_SCREENS = ["/", "/map", "/about"];
const MAX_STATIC_ENTRIES = 200;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add("/"))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Weather, map tiles and the API always go to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(MAIN_SCREENS.includes(url.pathname) ? networkFirst(event) : networkOrOfflinePage(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
  } else if (/^\/(data|maplibre|icons)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(event));
  }
});

/** Fresh from the network when possible; the last good copy when offline. */
async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    // Save a copy without holding up the response, which may still be streaming.
    if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") return offlinePage();
    throw error;
  }
}

async function networkOrOfflinePage(request) {
  try {
    return await fetch(request);
  } catch {
    return offlinePage();
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(saveStatic(cache, request, response.clone()));
  return response;
}

async function saveStatic(cache, request, response) {
  await cache.put(request, response);
  // Builds leave old hashed files behind: keep the newest ones only.
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((k) => cache.delete(k)));
}

function offlinePage() {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · Afterglow</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0b14;color:#f6efe7;
font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}a{color:#f08a3c}</style>
</head><body><div><p>You're offline, and this page isn't saved on your phone yet.</p>
<p><a href="/">Back to tonight's forecast</a></p></div></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Sunset alerts. The payload is JSON: { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Afterglow", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || "afterglow",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === target.origin);
      if (open) {
        await open.focus();
        if (open.url !== target.href && "navigate" in open) await open.navigate(target.href);
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
