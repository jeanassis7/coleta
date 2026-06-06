import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontSize: {
        // Tipografia maior por padrão para o app do motorista
        base: ["20px", "28px"],
        lg: ["24px", "32px"],
        xl: ["28px", "36px"],
        "2xl": ["32px", "40px"],
        "3xl": ["40px", "48px"],
      },
      colors: {
        verde: {
          DEFAULT: "#16a34a",
          escuro: "#15803d",
          claro: "#22c55e",
        },
        cinza: {
          fundo: "#f8fafc",
          card: "#ffffff",
          borda: "#e2e8f0",
          texto: "#0f172a",
          suave: "#64748b",
        },
        alerta: "#dc2626",
        atencao: "#f59e0b",
      },
      minHeight: {
        botao: "64px",
        input: "56px",
      },
    },
  },
  plugins: [],
};

export default config;
