// Service worker: offline fallback + web push. Code is network-first so deploys are never stale.
// Responses are cloned before being returned; cloning later fails once the page has read the body.
const VERSION = "v6";
const SHELL_CACHE = `jokominto-shell-${VERSION}`;
const MEDIA_CACHE = `jokominto-media-${VERSION}`;
const SHELL = ["/", "/index.js", "/src/styles/game.css", "/asset/icon.png", "/asset/char/idle.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, MEDIA_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isMedia = (url) => /\.(png|jpe?g|gif|webp|svg|woff2?)$/i.test(url.pathname);
// Audio streams with range requests, which the Cache API cannot store.
const isAudio = (url) => /\.(m4a|mp3|ogg)$/i.test(url.pathname);
// Third-party files the page needs to render (styles and fonts); served stale while refreshing.
const CDN_HOSTS = ["cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const cacheable = (res) => res.ok || res.type === "opaque";

function staleWhileRevalidate(event) {
  const refresh = fetch(event.request).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      caches.open(MEDIA_CACHE).then((cache) => cache.put(event.request, copy));
    }
    return res;
  });
  event.respondWith(caches.match(event.request).then((hit) => hit || refresh));
  event.waitUntil(refresh.catch(() => {}));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  if (CDN_HOSTS.includes(url.hostname)) return staleWhileRevalidate(event);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || isAudio(url)) return;

  if (isMedia(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(MEDIA_CACHE).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || (request.mode === "navigate" ? caches.match("/") : Response.error()))
      )
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "JokomintoGame", {
      body: data.body || "",
      tag: data.tag || "joko",
      renotify: true,
      icon: "/asset/pwa/icon-192.png",
      badge: "/asset/pwa/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      return open ? open.focus() : self.clients.openWindow(target);
    })
  );
});
