const CACHE_NAME = 'prenotazioni-v13';

// Paths relativi — funzionano sia su dominio root che su GitHub Pages subfolder
const APP_SHELL = [
    './',
    './index.html',
    './login.html',
    './prenotazioni.html',
    './admin.html',
    './super-admin.html',
    './about.html',
    './css/style.css',
    './css/admin.css',
    './css/login.css',
    './css/prenotazioni.css',
    './js/ui.js',
    './js/data.js',
    './js/calendar.js',
    './js/booking.js',
    './js/auth.js',
    './js/tenant.js',
    './js/admin.js',
    './js/admin-settings.js',
    './js/admin-calendar.js',
    './js/admin-clients.js',
    './js/admin-schedule.js',
    './js/push.js',
    './js/pwa-install.js',
    './js/sw-update.js',
    './js/supabase-client.js',
    './images/icon-192.png',
    './images/icon-512.png',
    './manifest.json',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(
                APP_SHELL.map(url =>
                    fetch(url, { cache: 'reload' })
                        .then(res => { if (res.ok) return cache.put(url, res); })
                        .catch(() => {})
                )
            )
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Prenotazioni';
    const options = {
        body: data.body || '',
        icon: '/images/icon-192.png',
        tag: data.tag || 'app-push',
        renotify: true,
        data: { url: data.url || '/prenotazioni.html' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/prenotazioni.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const appClient = clients.find(c => new URL(c.url).origin === self.location.origin);
            if (appClient) { appClient.focus(); appClient.navigate(targetUrl); return; }
            return self.clients.openWindow(targetUrl);
        })
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true }))
        );
        return;
    }

    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        event.respondWith(
            caches.match(request, { ignoreSearch: true }).then(cached => {
                const networkFetch = fetch(request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                });
                return cached || networkFetch;
            })
        );
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});
