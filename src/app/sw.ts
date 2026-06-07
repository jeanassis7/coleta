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
    // 2. Navegação HTML — StaleWhileRevalidate
    //    Serve do cache INSTANTANEAMENTE (app abre sempre),
    //    atualiza em background pra próxima visita.
    //    Isso resolve o problema "app não abre com sinal ruim".
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new StaleWhileRevalidate({
        cacheName: "pages",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 50,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 dias
          }),
        ],
      }),
    },
    // 3. JS/CSS estáticos — CacheFirst (hash no nome, cache eterno é seguro)
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
    // 4. Imagens — CacheFirst
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
    // 5. Outros (fonts, etc) — defaults
    ...defaultCache,
  ],
});

serwist.addEventListeners();
