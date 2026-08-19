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
