/* 거만어 Quiz — Service Worker
   전략:
   - 페이지(navigation) = 네트워크 우선, 실패 시(오프라인) 캐시 → 배포가 다음 새로고침에 바로 보인다
   - 정적 자산 = 캐시 우선 + 백그라운드 갱신 (index.html이 ?v= 버전 쿼리로 새 자산을 가리킴)
   - install은 HTTP 캐시를 우회(reload)해 항상 원본에서 받는다
   배포 시 CACHE_VERSION과 index.html의 자산 ?v= 를 함께 올린다. */

const CACHE_VERSION = "gv-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/app.css?v=9",
  "./js/app.js?v=9",
  "./js/vocab-data.js?v=9",
  "./js/ko-grading-data.js?v=9",
  "./js/grader.js?v=9",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => Promise.all(
        APP_SHELL.map((url) =>
          fetch(new Request(url, { cache: "reload" }))
            .then((res) => { if (res.ok) return c.put(url, res); })
            .catch(() => {}) // 일부 실패해도 설치는 진행 (첫 fetch 때 채워짐)
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("gv-") && k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // 페이지 이동은 네트워크 우선 — 항상 최신 index.html
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 정적 자산: 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok && (e.request.url.startsWith(self.location.origin) || res.type === "cors")) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
