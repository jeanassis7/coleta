/**
 * Tipos de documento e de manutenção — listas fixas, decisão do Evaner.
 *
 * Ficam na APLICAÇÃO e não no banco de propósito: acrescentar um tipo vira um
 * deploy em vez de uma migration. E ficam fixas em vez de texto livre porque
 * texto livre garante que um dia apareçam "CIPP", "cipp" e "C.I.P.P." como
 * três coisas diferentes no painel.
 *
 * "outro" existe pra ninguém ficar travado num sábado esperando deploy. Ele
 * não agrupa nem gera estatística — e não precisa.
 */

export interface TipoDoc {
  valor: string;
  label: string;
}

export const TIPOS_DOC_CAMINHAO: TipoDoc[] = [
  { valor: "ipva", label: "IPVA" },
  { valor: "licenciamento", label: "Licenciamento" },
  { valor: "seguro", label: "Seguro" },
  { valor: "civ", label: "CIV" },
  { valor: "cipp", label: "CIPP" },
  { valor: "cronotacografo", label: "Cronotacógrafo" },
  { valor: "antt", label: "ANTT/RNTRC" },
  { valor: "outro", label: "Outro (descreva)" },
];

export const TIPOS_DOC_MOTORISTA: TipoDoc[] = [
  { valor: "cnh", label: "CNH" },
  { valor: "toxicologico", label: "Exame toxicológico" },
  { valor: "mopp", label: "MOPP" },
  { valor: "curso", label: "Curso / reciclagem" },
  { valor: "outro", label: "Outro (descreva)" },
];

export const TIPOS_MANUTENCAO: TipoDoc[] = [
  { valor: "troca_oleo", label: "Troca de óleo" },
  { valor: "pneu", label: "Pneu" },
  { valor: "revisao", label: "Revisão" },
  { valor: "corretiva", label: "Corretiva" },
  { valor: "outro", label: "Outro" },
];

/** Nome pra mostrar. Quando o tipo é "outro", quem manda é a descrição. */
export function labelDocumento(
  tipo: string,
  descricao?: string | null
): string {
  if (tipo === "outro") return descricao?.trim() || "Outro";
  const achado =
    TIPOS_DOC_CAMINHAO.find((t) => t.valor === tipo) ??
    TIPOS_DOC_MOTORISTA.find((t) => t.valor === tipo);
  return achado?.label ?? tipo;
}

export function labelManutencao(tipo: string): string {
  return TIPOS_MANUTENCAO.find((t) => t.valor === tipo)?.label ?? tipo;
}

/**
 * Situação de um documento pela data de vencimento.
 *
 * `alerta_dias` é por documento (default 30): IPVA você quer saber com um mês,
 * exame toxicológico talvez com três. Quem cadastra decide.
 */
export type SituacaoDoc = "vencido" | "vencendo" | "ok";

export function situacaoDocumento(
  vencimento: string,
  alertaDias: number,
  hoje = new Date()
): { situacao: SituacaoDoc; dias: number } {
  // Comparação por DIA, não por instante: documento que vence hoje não está
  // vencido às 14h. Ambos os lados viram meia-noite UTC.
  const venc = new Date(`${vencimento.slice(0, 10)}T00:00:00Z`);
  const base = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate())
  );
  const dias = Math.round((venc.getTime() - base.getTime()) / 86_400_000);
  if (dias < 0) return { situacao: "vencido", dias };
  if (dias <= alertaDias) return { situacao: "vencendo", dias };
  return { situacao: "ok", dias };
}
