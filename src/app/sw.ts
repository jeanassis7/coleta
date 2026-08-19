import { defaultCache } from "@serwist/next/worker";
import {
  Serwist,
  StaleWhileRevalidate,
  CacheFirst,
  NetworkOnly,
  ExpirationPlugin,
} from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // 1. Supabase API — NUNCA cachear (auth, dados, fotos)
    {
      matcher: ({ url }) =>
        url.hostname.endsWith("supabase.co") ||
        url.hostname.endsWith("supabase.in"),
      handler: new NetworkOnly(),
    },
    // 2. PAINEL ADMIN — NUNCA cachear navegação.
    //
    //    ⚠️ BUG REAL (19/08/2026): este Service Worker existe pro app do
    //    MOTORISTA, mas o matcher pegava `request.mode === "navigate"` de
    //    todo o domínio — inclusive /admin. Resultado: depois de cada
    //    deploy o painel recebia HTML velho do cache, que apontava pros
    //    arquivos .js da build ANTERIOR. A Vercel já tinha apagado esses
    //    arquivos, então vinha 404 em cima de 404 e a tela ficava no
    //    esqueleto de carregamento por 30s+.
    //
    //    Piorava a cada deploy e nunca ia se resolver sozinho, porque o
    //    cache de script tem 60 dias de validade.
    //
    //    O painel é desktop, com internet — cache offline ali não traz
    //    benefício nenhum e só cria essa classe de problema.
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && !url.pathname.startsWith("/motorista"),
      handler: new NetworkOnly(),
    },
    // 3. Navegação do MOTORISTA — StaleWhileRevalidate
    //    Serve do cache INSTANTANEAMENTE (app abre sempre),
    //    atualiza em background pra próxima visita.
    //    Isso resolve o problema "app não abre com sinal ruim".
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && url.pathname.startsWith("/motorista"),
      handler: new StaleWhileRevalidate({
        cacheName: "pages-motorista",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 dias
          }),
        ],
      }),
    },
    // 4. JS/CSS estáticos — CacheFirst (hash no nome, cache eterno é seguro)
    {
      matcher: ({ request }) =>
        request.destination === "script" || request.destination === "style",
      handler: new CacheFirst({
        cacheName: "static-resources",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 60 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    // 5. Imagens — CacheFirst
    {
      matcher: ({ request }) => request.destination === "image",
      handler: new CacheFirst({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    // 6. Outros (fonts, etc) — defaults
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// Apaga o cache antigo de navegação, que continha páginas do /admin gravadas
// pela versão anterior deste arquivo. Sem isto, quem já tem o app instalado
// continuaria recebendo o painel velho até o cache vencer — 30 dias.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await caches.delete("pages");
      // Os scripts em cache apontam pra builds antigas e são a fonte dos
      // 404. Descartar é seguro: o que ainda for válido volta na primeira
      // visita com internet.
      await caches.delete("static-resources");
    })()
  );
});
