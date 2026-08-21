const CACHE_NAME = 'dikesoft-cache-2026.08.21-report-label-gap-v3';
const ASSETS = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.json",
  "./version.json",
  "./assets/favicon-32.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-512.png",
  "./assets/icon-192.png",
  "./assets/resim.png",
  "./assets/templates/dikesoft-tanimlar-sablon.xlsx",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/icons/icon-128.png",
  "./assets/icons/icon-144.png",
  "./assets/icons/icon-152.png",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-32.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-72.png",
  "./assets/icons/icon-96.png",
  "./assets/splash/ipad-10-2-landscape.png",
  "./assets/splash/ipad-10-2.png",
  "./assets/splash/ipad-9-7-landscape.png",
  "./assets/splash/ipad-9-7.png",
  "./assets/splash/ipad-air-10-9-landscape.png",
  "./assets/splash/ipad-air-10-9.png",
  "./assets/splash/ipad-pro-12-9-landscape.png",
  "./assets/splash/ipad-pro-12-9.png",
  "./assets/splash/iphone-11-pro-max-xs-max-landscape.png",
  "./assets/splash/iphone-11-pro-max-xs-max.png",
  "./assets/splash/iphone-11-xr-landscape.png",
  "./assets/splash/iphone-11-xr.png",
  "./assets/splash/iphone-12-13-14-15-landscape.png",
  "./assets/splash/iphone-12-13-14-15.png",
  "./assets/splash/iphone-14-15-pro-landscape.png",
  "./assets/splash/iphone-14-15-pro-max-landscape.png",
  "./assets/splash/iphone-14-15-pro-max.png",
  "./assets/splash/iphone-14-15-pro.png",
  "./assets/splash/splash-landscape.png",
  "./assets/splash/splash-portrait.png",
  "./css/base.css",
  "./css/components.css",
  "./css/components.css?v=2026.08.21-report-label-gap-v3",
  "./css/components.css?v=2026.06.13-musteri-filtre-ikon-v2",
  "./css/components.css?v=2026.06.13-musteri-filtre-ikon-v2",
  "./css/desktop.css",
  "./css/iphone.css",
  "./css/android.css",
  "./css/tablet.css",
  "./css/tablet.css?v=2026.05.21.2-tablet-sendlogs",
  "./css/tablet.css?v=2026.05.21.4-tablet-login-sendlogs",
  "./css/tablet.css?v=2026.05.21.5-tablet-login-align-left",
  "./css/tablet.css?v=2026.05.21.6-tablet-sendlogs-compact",
  "./css/tablet.css?v=2026.05.21.7-tablet-final-spacing",
  "./css/tablet.css?v=2026.05.21.8-tablet-professional-controls",
  "./css/tablet.css?v=2026.05.21.9-tablet-sendlogs-date-compact",
  "./css/print-pdf.css",
  "./js/login.js",
  "./js/main.js",
  "./js/main.js?v=2026.08.21-report-multi-month-v1",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/updater.js",
  "./js/config.js",
  "./js/cloud.js",
  "./js/cloud.js?v=2026.06.10-bayi-yonetimi-ust-scroll-v1",
  "./js/data-manager.js",
  "./js/customer-analytics.js",
  "./js/customer-analytics.js?v=2026.06.13-musteri-filtre-ikon-v2",
  "./js/shared-payment-cache.js",
  "./js/auth.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/ui.js?v=2026.05.21-tablet-layout",
  "./js/security.js",
  "./js/validators.js",
  "./js/format.js",
  "./js/import-excel.js",
  "./js/definitions.js",
  "./js/definitions-view.js",
  "./js/calculator.js",
  "./js/calculator.js?v=2026.06.10-fatura-row-id-v1",
  "./js/calculator.js?v=2026.06.10-dropdown-zindex-report-v2",
  "./js/reports.js",
  "./js/reports.js?v=2026.06.10-general-report-preview-ellipsis-v1",
  "./js/reports.js?v=2026.06.10-general-report-pdf-channel-wrap-v1",
  "./js/reports-view.js",
  "./js/settings.js",
  "./js/pdf.js",
  "./js/pdf.js?v=2026.06.10-general-report-pdf-channel-wrap-v1",
  "./js/mail.js",
  "./css/components.css?v=2026.06.13-musteri-filtre-ikon-v2",
  "./js/main.js?v=2026.06.13-musteri-bayi-filtre-ikon-v2",
  "./js/bayi-management.js",
  "./js/bayi-management.js?v=2026.06.13-ortak-sql-cache-v1",
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isAppShellFile = /\.(html|css|js|json)$/.test(url.pathname) || url.pathname.endsWith("manifest.json") || url.pathname.endsWith("/");

  if (event.request.method === "GET" && isAppShellFile) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    })()
  );
});
