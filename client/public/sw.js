var CACHE_NAME = 'bgp-v20';
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
  self.skipWaiting();
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
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.includes(self.location.origin)) {
          clients[i].postMessage({ type: 'navigate', url: url });
          clients[i].focus();
          return;
        }
      }
      return self.clients.openWindow(url);
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

  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes('/assets/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
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
