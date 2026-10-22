import { defineConfig } from 'vite';

function offlineAssetsPlugin() {
  return {
    name: 'offline-assets',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => file !== 'service-worker.js' && !file.endsWith('.map'))
        .map((file) => `./${file}`);
      const source = `
const CACHE_NAME = 'pdf-signature-tool-v1';
const PRECACHE_URLS = ${JSON.stringify(files)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS.map((path) => new URL(path, self.registration.scope).href))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pdf-signature-tool-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const scope = new URL(self.registration.scope);
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).catch(() => request.mode === 'navigate' ? caches.match(new URL('./index.html', scope).href) : Promise.reject(new Error('Offline asset unavailable')))));
});
`;
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineAssetsPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});