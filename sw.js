// 앱 파일만 캐시 (네트워크 우선, 실패 시 캐시). 다른 사이트(의사 사진 등)는 캐시하지 않는다.
const CACHE = 'doctor-profile-v13';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'doctors_index.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // 브라우저 캐시(GitHub Pages 는 10분)를 건너뛰고 서버에 바뀌었는지 확인 — 그대로면 304 로 가볍다
    fetch(e.request, { cache: 'no-cache' })
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
