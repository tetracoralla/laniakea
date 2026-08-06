const CACHE_PREFIX = 'laniakea-'
const CACHE_NAME = `${CACHE_PREFIX}v3`
const SCOPE_URL = new URL('./', self.location.href)
const INDEX_URL = new URL('index.html', SCOPE_URL)

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const indexResponse = await fetch(INDEX_URL)
  const indexForCache = indexResponse.clone()
  const html = await indexResponse.text()
  const assetPaths = Array.from(
    html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g),
    (match) => new URL(match[1], SCOPE_URL).href,
  )
  const staticUrls = [
    new URL('manifest.webmanifest', SCOPE_URL).href,
    new URL('icon-192.png', SCOPE_URL).href,
    new URL('icon-512.png', SCOPE_URL).href,
    new URL('icon.svg', SCOPE_URL).href,
    ...assetPaths,
  ]

  await cache.put(SCOPE_URL, indexForCache.clone())
  await cache.put(INDEX_URL, indexForCache)
  await cache.addAll([...new Set(staticUrls)])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const isDocumentNavigation =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document'
  if (isDocumentNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type !== 'opaque') {
            event.waitUntil(
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(SCOPE_URL, response.clone())),
            )
          }
          return response
        })
        .catch(() => caches.match(SCOPE_URL, { ignoreVary: true })),
    )
    return
  }

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok && response.type !== 'opaque') {
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, response.clone())),
          )
        }
        return response
      })
    }),
  )
})
