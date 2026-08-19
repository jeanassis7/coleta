/**
 * Plano de contas — as linhas do DRE e as categorias de lançamento.
 *
 * Baseado na planilha "2026 - FLUXO TOTAL EMPRESA" do Evaner (as 4 seções
 * separadas por linha em branco na aba Lançamentos).
 *
 * ---------------------------------------------------------------------------
 * O QUÊ vs QUEM
 * ---------------------------------------------------------------------------
 * A planilha misturava as duas coisas: "Pro-Labore Jean", "Lucimar — Dinheiro
 * em mãos". Isso faz a lista crescer com as PESSOAS — contratou alguém, mexe
 * na lista; saiu alguém, a categoria fica órfã no histórico pra sempre.
 *
 * Aqui a categoria é só o QUÊ. Quem é um campo separado (`pessoa_id`), que só
 * aparece nas categorias marcadas com `pedePessoa`. Assim "Salários" é uma
 * linha no DRE que abre por pessoa, e contratar não mexe em nada.
 *
 * ---------------------------------------------------------------------------
 * FONTE
 * ---------------------------------------------------------------------------
 * `lancamento` — o Jean digita (é o que aparece no dropdown da tela).
 * `automatico` — o sistema já sabe, vem de outra tabela. NÃO aparece no
 *   dropdown: lançar na mão dobraria o valor.
 */

export type GrupoDre =
  | "receita"
  | "custo_oleo"
  | "operacional"
  | "fixa"
  | "financeiro"
  | "impostos";

export interface LinhaPlano {
  chave: string;
  label: string;
  grupo: GrupoDre;
  fonte: "lancamento" | "automatico";
  /** Pede o campo "quem" no lançamento e abre por pessoa no DRE. */
  pedePessoa?: boolean;
  /** De onde o número sai, quando é automático — pra explicar na tela. */
  vemDe?: string;
}

export const PLANO_CONTAS: LinhaPlano[] = [
  // ------------------------------------------------------------- receita
  {
    chave: "venda_oleo",
    label: "Venda de óleo",
    grupo: "receita",
    fonte: "automatico",
    vemDe: "vendas lançadas",
  },

  // ---------------------------------------------------------- custo do óleo
  {
    chave: "oleo_motorista",
    label: "Óleo comprado pelos motoristas",
    grupo: "custo_oleo",
    fonte: "automatico",
    pedePessoa: true,
    vemDe: "coletas, uma a uma",
  },
  {
    chave: "oleo_sede",
    label: "Óleo pago pela sede",
    grupo: "custo_oleo",
    fonte: "automatico",
    vemDe: "compra direta e coletas pagas pela sede",
  },
  {
    chave: "comissao",
    label: "Comissão dos motoristas",
    grupo: "custo_oleo",
    fonte: "automatico",
    pedePessoa: true,
    vemDe: "litros coletados × a vigência da comissão",
  },

  // ------------------------------------------------------------ operacional
  {
    chave: "combustivel",
    label: "Combustível",
    grupo: "operacional",
    fonte: "automatico",
    vemDe: "abastecimentos",
  },
  {
    chave: "troca_oleo",
    label: "Troca de óleo",
    grupo: "operacional",
    fonte: "automatico",
    vemDe: "manutenções do tipo troca de óleo",
  },
  {
    chave: "pneus",
    label: "Pneus",
    grupo: "operacional",
    fonte: "automatico",
    vemDe: "manutenções do tipo pneu",
  },
  {
    chave: "manutencao",
    label: "Manutenção",
    grupo: "operacional",
    fonte: "automatico",
    vemDe: "manutenções (revisão, corretiva, outro)",
  },
  { chave: "lavagem", label: "Lavagem de caminhão", grupo: "operacional", fonte: "lancamento" },
  { chave: "equipamento_veiculo", label: "Equipamento veículo", grupo: "operacional", fonte: "lancamento" },
  { chave: "custos_viagem", label: "Custos de viagem", grupo: "operacional", fonte: "lancamento" },
  { chave: "benfeitorias_sede", label: "Benfeitorias sede", grupo: "operacional", fonte: "lancamento" },

  // ------------------------------------------------------------------ fixa
  {
    chave: "transferencia_socio",
    label: "Transferência a sócio",
    grupo: "fixa",
    fonte: "lancamento",
    pedePessoa: true,
  },
  {
    chave: "salario",
    label: "Salário",
    grupo: "fixa",
    fonte: "lancamento",
    pedePessoa: true,
  },
  { chave: "advogado", label: "Advogado", grupo: "fixa", fonte: "lancamento" },
  { chave: "contabilidade", label: "Contabilidade", grupo: "fixa", fonte: "lancamento" },
  { chave: "sistema", label: "Sistema", grupo: "fixa", fonte: "lancamento" },
  { chave: "luz_internet_telefone", label: "Luz, Internet e Telefone", grupo: "fixa", fonte: "lancamento" },
  { chave: "seguro_caminhao", label: "Seguro Caminhão", grupo: "fixa", fonte: "lancamento" },
  { chave: "ipva_frota", label: "IPVA da frota", grupo: "fixa", fonte: "lancamento" },
  { chave: "taxas_licencas", label: "Taxas e Licenças", grupo: "fixa", fonte: "lancamento" },
  { chave: "custos_bancarios", label: "Custos de contas bancárias", grupo: "fixa", fonte: "lancamento" },

  // ------------------------------------------------------------- financeiro
  { chave: "emprestimos", label: "Empréstimos e financiamentos", grupo: "financeiro", fonte: "lancamento" },
  { chave: "dividas_pf", label: "Dívidas PF", grupo: "financeiro", fonte: "lancamento" },

  // --------------------------------------------------------------- impostos
  { chave: "impostos", label: "Impostos", grupo: "impostos", fonte: "lancamento" },
];

export const GRUPOS: { chave: GrupoDre; label: string }[] = [
  { chave: "receita", label: "Receita" },
  { chave: "custo_oleo", label: "Custo do óleo" },
  { chave: "operacional", label: "Custos operacionais" },
  { chave: "fixa", label: "Despesas fixas" },
  { chave: "financeiro", label: "Financeiro" },
  { chave: "impostos", label: "Impostos" },
];

/** As que aparecem no dropdown do lançamento (o Jean digita). */
export const CATEGORIAS_LANCAVEIS = PLANO_CONTAS.filter(
  (l) => l.fonte === "lancamento"
);

export function linhaPlano(chave: string): LinhaPlano | undefined {
  return PLANO_CONTAS.find((l) => l.chave === chave);
}

export function labelCategoria(chave: string): string {
  return linhaPlano(chave)?.label ?? chave;
}

export function pedePessoa(chave: string): boolean {
  return !!linhaPlano(chave)?.pedePessoa;
}

/**
 * Documento com valor gera conta prevista — esta é a categoria dela.
 * Sem isso todo documento cairia numa categoria genérica e o DRE não saberia
 * separar IPVA de seguro.
 */
export function categoriaDeDocumento(tipoDoc: string): string {
  if (tipoDoc === "ipva") return "ipva_frota";
  if (tipoDoc === "seguro") return "seguro_caminhao";
  return "taxas_licencas";
}

/**
 * A REGRA ANTI-DOBRA, num lugar só.
 *
 * Uma conta a pagar pode ser o ESPELHO de algo que já foi lançado noutra
 * tabela — abastecimento "assinei a nota", manutenção a prazo, coleta paga
 * pela sede, compra direta a prazo. Nesses casos o DRE conta pela tabela de
 * origem e ignora a conta, senão o mesmo real conta duas vezes.
 *
 * `documento` é a EXCEÇÃO e por um motivo real: o documento não lança gasto
 * nenhum — ele registra um vencimento e uma estimativa. Quem tem o gasto é a
 * conta. Se ela fosse excluída, IPVA e seguro sumiriam do DRE.
 */
const ORIGENS_ESPELHO = ["abastecimento", "manutencao", "compra_direta", "coleta"];

export function contaEntraNoDre(origemTipo: string | null): boolean {
  if (!origemTipo) return true;
  return !ORIGENS_ESPELHO.includes(origemTipo);
}
