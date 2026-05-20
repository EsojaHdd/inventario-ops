// InventarioOps — Service Worker
// Cache minimo: solo el shell de la app para que cargue rapido
// Las llamadas a /api siempre van a la red (nunca se cachean)

const CACHE = 'inventario-v1'
const SHELL = ['/', '/scanner', '/index.html']

// Instalar: cachear shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Fetch: API siempre a la red, resto desde cache con fallback a red
self.addEventListener('fetch', e => {
  // Nunca cachear llamadas a /api ni WebSocket
  if (e.request.url.includes('/api/') || e.request.url.includes('ws://')) {
    return
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        // Solo cachear respuestas validas
        if (!res || res.status !== 200 || res.type !== 'basic') return res
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
        return res
      })
    })
  )
})
