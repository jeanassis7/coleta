/**
 * Rótulo humano do tipo de movimento do caixa.
 *
 * Mora AQUI, e não em `lib/admin/caixa.ts`, de propósito: aquele módulo
 * importa `getSupabaseServer` (que usa `next/headers`), e importar um VALOR
 * dele de um componente cliente puxa o módulo server-only pro bundle e
 * quebra o build. Mesma armadilha comentada no LancamentoAvulso.
 *
 * Se um tipo novo não estiver no mapa, ele aparece com a chave crua. A linha
 * NUNCA some da tela por falta de tradução — falha mostrando demais, nunca
 * escondendo dinheiro.
 */
const ROTULOS: Record<string, string> = {
  conta_paga: "Conta paga",
  adiantamento: "Adiantamento a motorista",
  recebimento: "Recebimento de comprador",
  cheque_compensado: "Cheque compensado",
  transferencia_entrada: "Transferência recebida",
  transferencia_saida: "Transferência enviada",
  entrada_avulsa: "Entrada avulsa",
  acerto_devolucao: "Devolução no acerto",
  devolucao_motorista: "Devolução de troco",
  ajuste_caixa: "Ajuste de caixa",
  compra_direta: "Compra direta",
  abastecimento: "Combustível (campo)",
  despesa: "Despesa (campo)",
};

export function rotuloTipoMovimento(tipo: string): string {
  return ROTULOS[tipo] ?? tipo;
}
