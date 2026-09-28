var CACHE_NAME = 'bgp-v25';
var SHARE_CACHE = 'bgp-share-target';
var PRECACHE_URLS = [
  '/',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-180.png',
  '/apple-touch-icon-152.png',
  '/apple-touch-icon-120.png',
  '/favicon.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) { return cache.addAll(PRECACHE_URLS); })
  );
  // Deliberately NOT calling skipWaiting() here. A fresh build installs but
  // stays in the "waiting" state until the user accepts the update in-app
  // (which posts 'skipWaiting' below). This stops mid-task reloads.
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME && k !== SHARE_CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    });
  }
  if (event.data === 'get-share-target') {
    caches.open(SHARE_CACHE).then(function(cache) {
      return cache.match('share-payload');
    }).then(function(response) {
      if (response) {
        return response.json().then(function(payload) {
          event.source.postMessage({ type: 'share-target', ...payload });
          return caches.open(SHARE_CACHE).then(function(cache) {
            return cache.delete('share-payload');
          });
        });
      }
    });
  }
});

self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'BGP Dashboard', body: event.data.text() || 'New notification' };
  }
  var title = data.title || 'BGP Dashboard';
  var options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'bgp-notification',
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      var focused = clients.find(function(c) { return c.focused; });
      if (focused && data.url) {
        try {
          var focusedUrl = new URL(focused.url);
          var targetUrl = new URL(data.url, self.location.origin);
          if (focusedUrl.pathname === targetUrl.pathname && focusedUrl.search === targetUrl.search) {
            return;
          }
        } catch(e) {}
      }
      return self.registration.showNotification(title, options);
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  var target = new URL(url, self.location.origin).href;
  // Wake the app first, then move it to the page. A message posted to an
  // app still asleep in the background was lost on iPhone, so the tap just
  // opened wherever the app was (Woody, 2026-09-28).
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      var client = null;
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf(self.location.origin) === 0) { client = clients[i]; break; }
      }
      if (!client) return self.clients.openWindow(target);
      return client.focus().then(function(focused) {
        var c = focused || client;
        if (c.url === target) return;
        if ('navigate' in c) {
          return c.navigate(target).catch(function() { c.postMessage({ type: 'navigate', url: url }); });
        }
        c.postMessage({ type: 'navigate', url: url });
      }).catch(function() { return self.clients.openWindow(target); });
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(Response.redirect('/upload?share=pending', 303));
    event.waitUntil(
      event.request.formData().then(function(formData) {
        var files = formData.getAll('files');
        var title = formData.get('title') || '';
        var text = formData.get('text') || '';
        var shareUrl = formData.get('url') || '';

        var filePromises = files.map(function(file) {
          return file.arrayBuffer().then(function(buffer) {
            return {
              name: file.name,
              type: file.type,
              size: file.size,
              data: Array.from(new Uint8Array(buffer))
            };
          });
        });

        return Promise.all(filePromises).then(function(fileData) {
          var payload = { files: fileData, title: title, text: text, url: shareUrl };
          return caches.open(SHARE_CACHE).then(function(cache) {
            return cache.put('share-payload', new Response(JSON.stringify(payload), {
              headers: { 'Content-Type': 'application/json' }
            }));
          }).then(function() {
            return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          }).then(function(clients) {
            if (clients.length > 0) {
              var focused = clients.find(function(c) { return c.focused; }) || clients[0];
              focused.postMessage({ type: 'share-target', ...payload });
              return caches.open(SHARE_CACHE).then(function(cache) {
                return cache.delete('share-payload');
              });
            }
          });
        });
      })
    );
    return;
  }

  if (event.request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Never intercept Office Add-in traffic — task panes need fresh bundles
  // every time and can't rely on cached responses.
  if (url.pathname.startsWith('/addin/')) {
    return;
  }

  // Hashed build assets are immutable — serve from cache FIRST so app opens
  // don't re-download the bundle over mobile data every time (the old
  // network-first strategy was a big chunk of "app is consistently slow",
  // 2026-08-30). A new build has new hashes, so stale-cache risk is nil.
  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  if (url.pathname === '/' || (!url.pathname.includes('.'))) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          }
          return response;
        })
        .catch(function() { return caches.match('/'); })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (response.ok && url.origin === self.location.origin) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      })
      .catch(function() { return caches.match(event.request).then(function(cached) { return cached || caches.match('/'); }); })
  );
});
