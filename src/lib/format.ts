/**
 * Formatação BR — pura, sem dependências de I/O.
 */

export function formatBRL(valor: number): string {
  // Valores inteiros (coletas, adiantamentos redondos) aparecem sem
  // centavos — "R$ 5.000". Valores com centavos (despesas, combustível)
  // aparecem com 2 casas — "R$ 680,47".
  const inteiro = Number.isInteger(valor);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(valor);
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
 * Valor INTEIRO em reais (convenção das coletas: "valor cheio sempre").
 * Aceita SÓ dígitos: "100" → 100.
 * Qualquer vírgula/ponto/letra → null (REJEITA, nunca descarta em
 * silêncio — "100,50" virando 10050 foi um bug real de campo).
 */
/**
 * Valor de coleta — inteiro, sem centavos (decisão do Evaner: coleta é sempre
 * valor cheio, 100/125/200).
 *
 * **Zero é válido.** Óleo é sempre pago, mas quando é doado lança-se com zero
 * em vez de inventar um campo ou uma regra especial (R2 do NEGOCIOv3.md). O
 * `null` aqui significa "não dá pra ler o que foi digitado", não "é zero" —
 * quem chama usa isso pra desabilitar o botão.
 */
export function parseValorInteiro(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}
