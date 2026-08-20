import { getSupabaseServer } from "@/lib/supabase/server";
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
  const saldos = await buscarMotoristasComSaldo();
  return saldos
    .filter((m) => Number(m.saldo_atual) !== 0)
    .map((m) => ({
      motorista_id: m.id,
      nome: m.nome,
      saldo: Number(m.saldo_atual),
    }));
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
