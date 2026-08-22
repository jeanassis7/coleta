import { getSupabaseServer } from "@/lib/supabase/server";
import { selectTudo } from "@/lib/supabase/select-tudo";
import { buscarMotoristasComSaldo } from "@/lib/admin/queries";

/**
 * Caixa: contas financeiras, saldos e transferências.
 *
 * O princípio: dinheiro não aparece nem some. Toda saída sai de uma conta e
 * toda entrada entra em uma. Sem isso o DRE mostra número sem lastro.
 */

export interface ContaFinanceira {
  id: string;
  nome: string;
  tipo: "especie" | "banco";
  banco: string | null;
  agencia: string | null;
  numero: string | null;
  saldo_inicial: number;
  saldo_inicial_em: string;
  ativa: boolean;
  ordem: number;
  observacao: string | null;
  criado_em: string;
}

export interface SaldoConta {
  conta_id: string;
  nome: string;
  tipo: "especie" | "banco";
  saldo_inicial: number;
  entradas: number;
  saidas: number;
  saldo: number;
}

export interface Transferencia {
  id: string;
  conta_origem_id: string;
  conta_destino_id: string;
  valor: number;
  data: string;
  descricao: string | null;
  criado_em: string;
}

export async function buscarContasFinanceiras(
  opts: { incluirInativas?: boolean } = {}
): Promise<ContaFinanceira[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("contas_financeiras")
    .select("*")
    .order("ordem")
    .order("nome");
  if (!opts.incluirInativas) q = q.eq("ativa", true);
  const { data, error } = await q;
  if (error) throw error;
  return ((data as ContaFinanceira[]) || []).map((c) => ({
    ...c,
    saldo_inicial: Number(c.saldo_inicial),
  }));
}

/**
 * Saldo de todas as contas — UMA ida ao banco (a conta inteira roda dentro do
 * Postgres, mesma escolha da `saldos_motoristas()` pelo mesmo motivo).
 */
export async function buscarSaldoContas(): Promise<SaldoConta[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("saldo_contas");
  if (error) throw error;
  return ((data as SaldoConta[]) || []).map((s) => ({
    ...s,
    saldo_inicial: Number(s.saldo_inicial),
    entradas: Number(s.entradas),
    saidas: Number(s.saidas),
    saldo: Number(s.saldo),
  }));
}

export async function buscarTransferencias(
  limite = 100
): Promise<(Transferencia & { origem_nome: string; destino_nome: string })[]> {
  const supabase = await getSupabaseServer();
  const [{ data, error }, contas] = await Promise.all([
    supabase
      .from("transferencias")
      .select("*")
      .order("data", { ascending: false })
      .order("criado_em", { ascending: false })
      .limit(limite),
    buscarContasFinanceiras({ incluirInativas: true }),
  ]);
  if (error) throw error;
  const nome = new Map(contas.map((c) => [c.id, c.nome]));
  return ((data as Transferencia[]) || []).map((t) => ({
    ...t,
    valor: Number(t.valor),
    origem_nome: nome.get(t.conta_origem_id) ?? "—",
    destino_nome: nome.get(t.conta_destino_id) ?? "—",
  }));
}

export interface MovimentoAvulso {
  id: string;
  origem: "entrada" | "ajuste";
  /** tipo da entrada (aporte, emprestimo…) ou "ajuste". */
  tipo: string;
  /** Ajuste pode ser negativo (falta na gaveta). */
  valor: number;
  data: string;
  descricao: string;
  conta_nome: string;
}

/**
 * Entradas avulsas + ajustes de caixa (0047), juntos e por data — é a
 * lista "o que mexeu no caixa sem ser operação" da tela de Caixa.
 */
export async function buscarMovimentosAvulsos(
  limite = 50
): Promise<MovimentoAvulso[]> {
  const supabase = await getSupabaseServer();
  const [{ data: entradas, error: e1 }, { data: ajustes, error: e2 }, contas] =
    await Promise.all([
      supabase
        .from("entradas_avulsas")
        .select("id, tipo, valor, data, descricao, conta_id")
        .order("data", { ascending: false })
        .limit(limite),
      supabase
        .from("ajustes_caixa")
        .select("id, valor, data, motivo, conta_id")
        .order("data", { ascending: false })
        .limit(limite),
      buscarContasFinanceiras({ incluirInativas: true }),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const nome = new Map(contas.map((c) => [c.id, c.nome]));
  const lista: MovimentoAvulso[] = [
    ...((entradas ?? []) as {
      id: string; tipo: string; valor: number; data: string;
      descricao: string; conta_id: string;
    }[]).map((e) => ({
      id: e.id,
      origem: "entrada" as const,
      tipo: e.tipo,
      valor: Number(e.valor),
      data: e.data,
      descricao: e.descricao,
      conta_nome: nome.get(e.conta_id) ?? "—",
    })),
    ...((ajustes ?? []) as {
      id: string; valor: number; data: string; motivo: string; conta_id: string;
    }[]).map((a) => ({
      id: a.id,
      origem: "ajuste" as const,
      tipo: "ajuste",
      valor: Number(a.valor),
      data: a.data,
      descricao: a.motivo,
      conta_nome: nome.get(a.conta_id) ?? "—",
    })),
  ];
  return lista
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, limite);
}

export interface DinheiroNaMao {
  motorista_id: string;
  nome: string;
  saldo: number;
}

/**
 * Dinheiro da empresa na mão de cada motorista.
 *
 * Conceitualmente cada motorista é uma conta — mas isso JÁ funciona pela
 * `saldos_motoristas()` (migration 0013), que faz a conta inteira no Postgres
 * e foi o que tirou o painel de 4 segundos. Decisão do Evaner em 19/08/2026:
 * ler daquela função em vez de refatorar o motor de dinheiro que funciona.
 *
 * Aparece no painel de caixa como linha, não como conta financeira.
 */
export async function buscarDinheiroNaMao(): Promise<DinheiroNaMao[]> {
  const supabase = await getSupabaseServer();
  // ⚠️ Lê a RPC direto, e NÃO `buscarMotoristasComSaldo()` (21/08/2026):
  // aquela filtra `ativo = true`, então desativar um motorista que estava
  // com dinheiro da empresa na mão fazia o valor sumir do card e do TOTAL
  // do patrimônio — enquanto a foto semanal do caixa, que soma a mesma RPC
  // sem filtro, continuava contando. As duas telas divergiam sem
  // explicação, e o dinheiro sumia do relatório sem ter sumido do bolso.
  // Dinheiro na mão de quem saiu continua sendo dinheiro na rua.
  const [{ data: saldos, error }, { data: perfis }] = await Promise.all([
    supabase.rpc("saldos_motoristas"),
    supabase.from("profiles").select("id, nome, ativo"),
  ]);
  if (error) throw error;
  const info = new Map(
    ((perfis as { id: string; nome: string; ativo: boolean }[]) ?? []).map((p) => [
      p.id,
      p,
    ])
  );
  return ((saldos as { motorista_id: string; saldo: number }[]) ?? [])
    .filter((s) => Number(s.saldo) !== 0)
    .map((s) => {
      const p = info.get(s.motorista_id);
      return {
        motorista_id: s.motorista_id,
        nome: p?.ativo === false ? `${p.nome} (inativo)` : p?.nome ?? "—",
        saldo: Number(s.saldo),
      };
    })
    .sort((a, b) => b.saldo - a.saldo);
}

// ============================================================================
// PATRIMÔNIO (R87) — o caixa mostra o patrimônio INTEIRO, não só as contas
// ============================================================================

/**
 * Preço de referência do óleo, R$/litro — FIXO NO CÓDIGO por decisão do
 * Evaner (21/08/2026): "se eu quiser mudar eu mudo pelo código, muito melhor
 * e menos burlável". Mudar = editar AQUI e na função tirar_foto_caixa
 * (migration 0051), nos DOIS lugares. As fotos antigas guardam o preço do
 * dia delas — mudança futura não reescreve o passado.
 */
export const PRECO_REFERENCIA_LITRO = 2.8;

export interface Patrimonio {
  /** R$/litro fixo no código — um valor só pra fino e grosso. */
  precoReferenciaLitro: number;
  /** kg em estoque (fino + grosso) e o equivalente em litros. */
  estoqueKg: number;
  estoqueLitros: number;
  /** Litros declarados nas coletas de cargas ainda ABERTAS (coletado, não pesado). */
  oleoCaminhoesLitros: number;
  /** Cheques em carteira + depositados. Devolvido fica FORA (a dívida do
   *  comprador já renasceu — contar o papel seria contar duas vezes). */
  chequesAbertos: number;
  /** Adiantamentos ENVIADOS e ainda não aceitos: já saíram do caixa, ainda
   *  não estão na mão de ninguém. Sem esta linha o patrimônio subestimava
   *  exatamente esse valor enquanto o motorista não abria o app. */
  adiantamentosPendentes: number;
  /** As duas linhas de óleo valoradas pelo preço de referência. */
  valorEstoque: number;
  valorOleoCaminhoes: number;
  /** Venda entregue que ainda não virou dinheiro nem cheque (só saldo
   *  POSITIVO dos compradores — crédito de comprador não é ativo). */
  aReceberCompradores: number;
  /** Dívida certa (status a_pagar; prevista fica fora — é palpite).
   *  NÃO desconta do total: aparece como linha própria abaixo dele
   *  (decisão do Evaner, 21/08). Conta amarrada a uma dívida cadastrada
   *  fica fora daqui — senão a mesma dívida contaria duas vezes. */
  contasAPagarAbertas: number;
  /** Soma do que falta pagar das dívidas cadastradas em aberto (0053). */
  dividasCadastradas: number;
}

export async function buscarPatrimonio(): Promise<Patrimonio> {
  const supabase = await getSupabaseServer();
  const [
    { data: estoque, error: eEstoque },
    { data: coletasAbertas, error: eColetas },
    { data: cheques, error: eCheques },
    { data: adPendentes, error: eAd },
    { data: saldoCompradores, error: eComp },
    { data: contasAbertas, error: eContas },
    { data: dividas, error: eDiv },
  ] = await Promise.all([
    supabase.rpc("estoque_atual"),
    // Óleo nos caminhões: coletas de cargas AINDA ATIVAS (o join limita o
    // volume — nunca passa de umas centenas de linhas, é 1 carga por
    // motorista).
    supabase
      .from("coletas")
      .select("litros, cargas!inner(status)")
      .eq("cargas.status", "ativa"),
    // ⚠️ status é 'em_carteira' (com em_) — filtro errado nunca casa e
    // pareceria "não tem cheque nenhum".
    supabase
      .from("cheques")
      .select("valor")
      .in("status", ["em_carteira", "depositado"]),
    // Enviado e não aceito: saiu do caixa, não chegou na mão — está "no ar".
    supabase.from("adiantamentos").select("valor").eq("status", "pendente"),
    supabase.rpc("saldo_compradores"),
    // divida_id is null: parcela de dívida cadastrada já conta na linha das
    // dívidas — contar aqui também dobraria a mesma dívida.
    supabase
      .from("contas_a_pagar")
      .select("valor")
      .eq("status", "a_pagar")
      .is("divida_id", null),
    supabase.rpc("saldo_dividas"),
  ]);
  if (eEstoque) throw eEstoque;
  if (eColetas) throw eColetas;
  if (eCheques) throw eCheques;
  if (eAd) throw eAd;
  if (eComp) throw eComp;
  if (eContas) throw eContas;
  if (eDiv) throw eDiv;

  const preco = PRECO_REFERENCIA_LITRO;
  const estoqueKg = ((estoque as { saldo_kg: number }[]) ?? []).reduce(
    (s, l) => s + Number(l.saldo_kg || 0),
    0
  );
  const estoqueLitros = estoqueKg / 0.9;
  const oleoCaminhoesLitros = ((coletasAbertas as { litros: number }[]) ?? []).reduce(
    (s, c) => s + Number(c.litros || 0),
    0
  );
  const chequesAbertos = ((cheques as { valor: number }[]) ?? []).reduce(
    (s, c) => s + Number(c.valor || 0),
    0
  );
  const adiantamentosPendentes = ((adPendentes as { valor: number }[]) ?? []).reduce(
    (s, a) => s + Number(a.valor || 0),
    0
  );
  const aReceberCompradores = ((saldoCompradores as { saldo: number }[]) ?? [])
    .filter((c) => Number(c.saldo) > 0)
    .reduce((s, c) => s + Number(c.saldo), 0);
  const contasAPagarAbertas = ((contasAbertas as { valor: number }[]) ?? []).reduce(
    (s, c) => s + Number(c.valor || 0),
    0
  );
  const dividasCadastradas = ((dividas as { saldo: number; status: string }[]) ?? [])
    .filter((d) => d.status === "aberta" && Number(d.saldo) > 0)
    .reduce((s, d) => s + Number(d.saldo), 0);

  const n2 = (v: number) => Math.round(v * 100) / 100;
  return {
    precoReferenciaLitro: preco,
    estoqueKg: n2(estoqueKg),
    estoqueLitros: n2(estoqueLitros),
    oleoCaminhoesLitros: n2(oleoCaminhoesLitros),
    chequesAbertos: n2(chequesAbertos),
    adiantamentosPendentes: n2(adiantamentosPendentes),
    valorEstoque: n2(estoqueLitros * preco),
    valorOleoCaminhoes: n2(oleoCaminhoesLitros * preco),
    aReceberCompradores: n2(aReceberCompradores),
    contasAPagarAbertas: n2(contasAPagarAbertas),
    dividasCadastradas: n2(dividasCadastradas),
  };
}

export interface SaldoDivida {
  id: string;
  credor: string;
  tipo: "parcelada" | "aberta";
  valor_total: number;
  pago: number;
  saldo: number;
  parcelas_total: number | null;
  valor_parcela: number | null;
  parcelas_pagas: number | null;
  status: "aberta" | "quitada";
  quitada_em: string | null;
  primeira_em: string | null;
  observacao: string | null;
  criado_em: string;
}

/**
 * As dívidas com o saldo já calculado (0053). O saldo sai de
 * `valor_total − pagamentos pagos vinculados` — nunca de um número guardado,
 * então apagar um pagamento devolve a dívida sozinho.
 */
export async function buscarSaldoDividas(): Promise<SaldoDivida[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("saldo_dividas");
  if (error) throw error;
  return ((data as SaldoDivida[]) || []).map((d) => ({
    ...d,
    valor_total: Number(d.valor_total),
    pago: Number(d.pago),
    saldo: Number(d.saldo),
    valor_parcela: d.valor_parcela != null ? Number(d.valor_parcela) : null,
  }));
}

export interface FotoCaixaLinha {
  data: string;
  chave: string;
  label: string;
  ordem: number;
  valor: number;
}

/**
 * As fotos semanais do caixa (0051) — toda segunda o banco fotografa o giro
 * e guarda aqui. Cresce pra sempre: selectTudo, nunca truncar.
 */
export async function buscarFotosCaixa(): Promise<FotoCaixaLinha[]> {
  const supabase = await getSupabaseServer();
  const rows = await selectTudo<FotoCaixaLinha>((de, ate) =>
    supabase
      .from("fotos_caixa")
      .select("data, chave, label, ordem, valor")
      .order("data")
      .order("ordem")
      .order("chave")
      .range(de, ate)
  );
  return rows.map((f) => ({ ...f, valor: Number(f.valor) }));
}

export interface Lancamento {
  id: string;
  descricao: string;
  fornecedor: string | null;
  categoria: string;
  valor: number;
  pago_em: string;
  forma_pagamento: string | null;
  conta_id: string | null;
  pessoa_id: string | null;
  origem_tipo: string | null;
  observacao: string | null;
  criado_em: string;
}

export interface FiltrosLancamento {
  inicio?: string;
  fim?: string;
  categoria?: string;
  conta_id?: string;
  pessoa_id?: string;
}

/**
 * O que já saiu, no ritmo do extrato.
 *
 * Só `status = 'paga'` — o que ainda vai vencer vive na tela de Contas a
 * pagar, que é outra pergunta ("o que eu devo") e outra tela.
 */
export async function buscarLancamentos(
  f: FiltrosLancamento = {},
  limite = 500
): Promise<Lancamento[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("contas_a_pagar")
    .select(
      "id, descricao, fornecedor, categoria, valor, pago_em, forma_pagamento, conta_id, pessoa_id, origem_tipo, observacao, criado_em"
    )
    .eq("status", "paga")
    .order("pago_em", { ascending: false })
    .order("criado_em", { ascending: false })
    .limit(limite);

  if (f.inicio) q = q.gte("pago_em", f.inicio);
  if (f.fim) q = q.lte("pago_em", f.fim);
  if (f.categoria) q = q.eq("categoria", f.categoria);
  if (f.conta_id) q = q.eq("conta_id", f.conta_id);
  if (f.pessoa_id) q = q.eq("pessoa_id", f.pessoa_id);

  const { data, error } = await q;
  if (error) throw error;
  return ((data as Lancamento[]) || []).map((l) => ({
    ...l,
    valor: Number(l.valor),
  }));
}

export interface ValePendente {
  acerto_id: string;
  motorista_id: string;
  valor: number;
  /** Data do acerto que gerou o vale — é o que situa "de quando é". */
  corte_em: string;
  observacao: string | null;
}

/**
 * Vales de acerto que ainda não foram descontados de nenhum salário.
 *
 * No acerto o saldo se divide em devolvido / vale / saldo. O **vale** desconta
 * do salário — e antes disso ficava só registrado no acerto, dependendo de o
 * gestor lembrar na hora de pagar. Lembrar de cabeça é o que o sistema existe
 * pra evitar (R110-b do NEGOCIOv3.md).
 *
 * Valor NEGATIVO é válido e significa o contrário: a empresa deve pro
 * motorista e vai **somar** no salário dele, em vez de descontar. Vem do
 * acerto com saldo negativo (migration 0011).
 */
export async function buscarValesPendentes(
  motoristaId?: string
): Promise<ValePendente[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("acertos")
    .select("id, motorista_id, valor_vale, corte_em, observacao")
    .neq("valor_vale", 0)
    .is("vale_quitado_em", null)
    .order("corte_em", { ascending: true });
  if (motoristaId) q = q.eq("motorista_id", motoristaId);

  const { data, error } = await q;
  if (error) throw error;
  return (
    (data as {
      id: string;
      motorista_id: string;
      valor_vale: number;
      corte_em: string;
      observacao: string | null;
    }[]) || []
  ).map((a) => ({
    acerto_id: a.id,
    motorista_id: a.motorista_id,
    valor: Number(a.valor_vale),
    corte_em: a.corte_em,
    observacao: a.observacao,
  }));
}
