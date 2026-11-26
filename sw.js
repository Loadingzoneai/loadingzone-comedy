/* 候场喜剧网页 App 的离线支持：
 * - 网页外壳（页面、样式、脚本、图标、入场图片）始终先取最新版本，同时存一份，没网时也能打开；
 * - /api/ 接口、付款、登录永远走网络，不缓存，保证演出和会员状态是最新的；
 * - 没有网络时，至少能打开网站外壳并显示提示。 */
const VERSION = 'lz-shell-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/intro.css', '/app.js', '/site.js', '/intro.js',
  '/logo.png', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png',
  '/intro-assets/theatre-curtain.jpg', '/hero-home.jpeg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Eventbrite、Stripe 等外部请求不处理
  if (url.pathname.startsWith('/api/')) return;              // 接口永远走网络

  // 页面：先网络，失败再用缓存（保证拿到最新版本）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('/', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/').then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 样式、脚本、图片：先网络（保证网站更新后立刻生效），没网时用缓存
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req))
  );
});
