import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  // FALSE de propósito (22/08/2026): reloadOnOnline instala um
  // `window.addEventListener("online", () => location.reload())` SEM condição.
  // Na estrada o sinal pisca o dia inteiro — recarregar apagava o formulário
  // que o motorista tinha acabado de preencher (litros, peso, valor, foto já
  // comprimida, GPS já capturado), tudo em useState. O StaleWhileRevalidate
  // já traz a versão nova sem precisar disso.
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version || "0.1.0",
  },
};

export default withSerwist(nextConfig);
