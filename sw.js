// SvF Future – offline cache a push notifikácie
const VERSION = 'svf-future-v16';
const SHELL = ['./', './index.html', './manifest.json', './run.css', './run.js', './run-prompts.js', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png',
  './img/hero.jpg', './img/p-psa.jpg', './img/p-ikds.jpg', './img/p-vsvh.jpg', './img/p-geo.jpg', './img/p-kraj.jpg', './img/p-mpm.jpg', './img/p-tms.jpg', './img/p-civil.jpg',
  './img/l-zs.jpg', './img/l-sport.jpg', './img/l-bratislava.jpg', './img/l-lab.jpg', './img/l-prax.jpg', './img/l-priestory.jpg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'];
const LIBS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const supaImg = url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/');
  if (!same && !LIBS.includes(url.hostname) && !supaImg) return;

  // Stránka a skripty: vždy najprv internet (nová verzia hneď), bez internetu z pamäte
  const isPage = req.mode === 'navigate' || (same && /\.(html|js|json)$|\/$/.test(url.pathname));
  if (isPage) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  // Obrázky a knižnice: z pamäte, na pozadí sa aktualizujú
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SvF Future', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: d.url || self.registration.scope }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
