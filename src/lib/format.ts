/**
 * Formatação BR — pura, sem dependências de I/O.
 */

export function formatBRL(valorInteiro: number): string {
  // valor armazenado como inteiro (R$ 100 = 100)
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valorInteiro);
}

export function formatLitros(litros: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: litros % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(litros) + "L";
}

export function formatDataHora(d: Date | string | number): string {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatHora(d: Date | string | number): string {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatData(d: Date | string | number): string {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

/**
 * Aceita "50", "50,5", "50.5" → 50, 50.5
 */
export function parseLitros(raw: string): number | null {
  const cleaned = raw.trim().replace(",", ".");
  const n = parseFloat(cleaned);
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Aceita só dígitos. Valor inteiro. "100" → 100. "1.000" → null (rejeita).
 */
export function parseValorInteiro(raw: string): number | null {
  const cleaned = raw.trim().replace(/\D/g, "");
  if (cleaned === "") return null;
  const n = parseInt(cleaned, 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
}
