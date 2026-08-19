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
//
// ⚠️ NÃO acrescentar `caches.delete("static-resources")` aqui, por mais
// tentador que pareça na hora de caçar 404. Já esteve nesta linha e foi
// removido de propósito:
//
//   `activate` dispara a CADA DEPLOY — o manifest de precache muda em toda
//   build, o que gera um SW novo. Apagar os scripts a cada deploy significa
//   que o motorista que abre o app logo depois de um deploy e entra numa
//   área sem sinal fica com HTML em cache apontando pra scripts que não
//   existem mais localmente. App quebrado no meio do Paraná, sem ninguém
//   pra ligar — e offline-first é o motivo deste app existir.
//
//   Não há 404 a evitar: os scripts têm hash no nome, então HTML novo pede
//   arquivo novo e o cache velho nunca é servido por engano.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Só o cache de navegação legado, que guardava páginas do /admin.
      // A navegação do motorista vive em "pages-motorista".
      await caches.delete("pages");
    })()
  );
});
