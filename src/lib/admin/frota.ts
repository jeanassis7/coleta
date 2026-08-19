import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Consultas de frota: manutenção, documentos e o resumo da ficha do caminhão.
 *
 * Módulo separado do `queries.ts` de propósito — aquele arquivo já passa de
 * 1.500 linhas e este assunto não se cruza com dashboard, coleta nem saldo.
 */

export interface Manutencao {
  id: string;
  caminhao_id: string;
  data: string;
  km: number | null;
  tipo: string;
  descricao: string;
  valor: number;
  fornecedor: string | null;
  proxima_km: number | null;
  foto_path: string | null;
  observacao: string | null;
  criado_em: string;
}

export interface Documento {
  id: string;
  caminhao_id: string | null;
  motorista_id: string | null;
  tipo: string;
  descricao: string | null;
  vencimento: string;
  valor: number | null;
  arquivo_path: string | null;
  alerta_dias: number;
  observacao: string | null;
  criado_em: string;
}

/**
 * Km mais alto conhecido de cada caminhão.
 *
 * Não existe campo "km atual" em `caminhoes` — o número vive espalhado em
 * `cargas.km_final` e `abastecimentos.km`. O abastecimento costuma ser mais
 * recente que o fim da carga, então os dois entram e vence o maior.
 *
 * UMA ida ao banco pra todos os caminhões, não uma por caminhão: o N+1 já
 * deixou este painel em 4s uma vez (foi o que gerou a `saldos_motoristas()`).
 */
export async function kmAtualPorCaminhao(): Promise<Map<string, number>> {
  const supabase = await getSupabaseServer();
  const [{ data: cargas }, { data: abast }] = await Promise.all([
    supabase
      .from("cargas")
      .select("caminhao_id, km_final")
      .not("km_final", "is", null),
    supabase
      .from("abastecimentos")
      .select("caminhao_id, km")
      .not("km", "is", null),
  ]);

  const mapa = new Map<string, number>();
  const considerar = (id: string | null, km: number | null) => {
    if (!id || km == null) return;
    if ((mapa.get(id) ?? 0) < km) mapa.set(id, km);
  };
  for (const c of (cargas as { caminhao_id: string; km_final: number }[]) ?? []) {
    considerar(c.caminhao_id, c.km_final);
  }
  for (const a of (abast as { caminhao_id: string | null; km: number }[]) ?? []) {
    considerar(a.caminhao_id, a.km);
  }
  return mapa;
}

/** Manutenções, mais recente primeiro. */
export async function buscarManutencoes(
  opts: { caminhao_id?: string } = {}
): Promise<Manutencao[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("manutencoes")
    .select("*")
    .order("data", { ascending: false })
    .order("criado_em", { ascending: false });
  if (opts.caminhao_id) q = q.eq("caminhao_id", opts.caminhao_id);
  const { data, error } = await q;
  if (error) throw error;
  return ((data as Manutencao[]) || []).map((m) => ({
    ...m,
    valor: Number(m.valor),
  }));
}

/**
 * Documentos. Ordem por vencimento CRESCENTE de propósito: o que vence
 * primeiro fica no topo, que é o que a pessoa precisa ver.
 */
export async function buscarDocumentos(
  opts: { caminhao_id?: string; motorista_id?: string } = {}
): Promise<Documento[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("documentos")
    .select("*")
    .order("vencimento", { ascending: true });
  if (opts.caminhao_id) q = q.eq("caminhao_id", opts.caminhao_id);
  if (opts.motorista_id) q = q.eq("motorista_id", opts.motorista_id);
  const { data, error } = await q;
  if (error) throw error;
  return ((data as Documento[]) || []).map((d) => ({
    ...d,
    valor: d.valor == null ? null : Number(d.valor),
  }));
}

/**
 * Troca de óleo que já venceu por km, por caminhão.
 *
 * Só interessa a MAIOR `proxima_km` de cada caminhão: se houve três trocas,
 * a que vale é a última. Devolve o alvo e quanto o caminhão já passou dele.
 */
export async function trocasDeOleoVencidas(): Promise<
  { caminhao_id: string; proxima_km: number; km_atual: number; passou: number }[]
> {
  const supabase = await getSupabaseServer();
  const [{ data }, kmAtual] = await Promise.all([
    supabase
      .from("manutencoes")
      .select("caminhao_id, proxima_km")
      .eq("tipo", "troca_oleo")
      .not("proxima_km", "is", null),
    kmAtualPorCaminhao(),
  ]);

  const alvo = new Map<string, number>();
  for (const m of (data as { caminhao_id: string; proxima_km: number }[]) ?? []) {
    if ((alvo.get(m.caminhao_id) ?? 0) < m.proxima_km) {
      alvo.set(m.caminhao_id, m.proxima_km);
    }
  }

  const fora: {
    caminhao_id: string;
    proxima_km: number;
    km_atual: number;
    passou: number;
  }[] = [];
  for (const [caminhao_id, proxima_km] of alvo) {
    const km = kmAtual.get(caminhao_id);
    if (km != null && km > proxima_km) {
      fora.push({ caminhao_id, proxima_km, km_atual: km, passou: km - proxima_km });
    }
  }
  return fora;
}

export interface ResumoCaminhao {
  km_rodado: number;
  litros_combustivel: number;
  /** null quando não dá pra calcular (sem km rodado ou sem litros) */
  km_por_litro: number | null;
  gasto_combustivel: number;
  gasto_manutencao: number;
  gasto_despesas: number;
  gasto_total: number;
}

/**
 * Números da ficha do caminhão num intervalo.
 *
 * km rodado sai das CARGAS encerradas (km_final − km_inicial) e não da
 * diferença entre abastecimentos: carga é o ciclo fechado, com os dois
 * números conferidos por antiburro na hora do lançamento.
 */
export async function resumoCaminhao(
  caminhaoId: string,
  inicio: Date,
  fim: Date
): Promise<ResumoCaminhao> {
  const supabase = await getSupabaseServer();
  const de = inicio.toISOString();
  const ate = fim.toISOString();
  const deData = de.slice(0, 10);
  const ateData = ate.slice(0, 10);

  const [{ data: cargas }, { data: abast }, { data: manut }, { data: desp }] =
    await Promise.all([
      supabase
        .from("cargas")
        .select("km_inicial, km_final")
        .eq("caminhao_id", caminhaoId)
        .not("km_final", "is", null)
        .gte("iniciada_em", de)
        .lte("iniciada_em", ate),
      supabase
        .from("abastecimentos")
        .select("litros, valor")
        .eq("caminhao_id", caminhaoId)
        .gte("criado_em", de)
        .lte("criado_em", ate),
      supabase
        .from("manutencoes")
        .select("valor")
        .eq("caminhao_id", caminhaoId)
        .gte("data", deData)
        .lte("data", ateData),
      supabase
        .from("despesas")
        .select("valor")
        .eq("caminhao_id", caminhaoId)
        .gte("criado_em", de)
        .lte("criado_em", ate),
    ]);

  const km_rodado = ((cargas as { km_inicial: number; km_final: number }[]) ?? [])
    .reduce((s, c) => s + Math.max(0, c.km_final - c.km_inicial), 0);

  const litros_combustivel = ((abast as { litros: number }[]) ?? []).reduce(
    (s, a) => s + Number(a.litros || 0),
    0
  );
  const gasto_combustivel = ((abast as { valor: number }[]) ?? []).reduce(
    (s, a) => s + Number(a.valor || 0),
    0
  );
  const gasto_manutencao = ((manut as { valor: number }[]) ?? []).reduce(
    (s, m) => s + Number(m.valor || 0),
    0
  );
  const gasto_despesas = ((desp as { valor: number }[]) ?? []).reduce(
    (s, d) => s + Number(d.valor || 0),
    0
  );

  return {
    km_rodado,
    litros_combustivel,
    km_por_litro:
      km_rodado > 0 && litros_combustivel > 0
        ? km_rodado / litros_combustivel
        : null,
    gasto_combustivel,
    gasto_manutencao,
    gasto_despesas,
    gasto_total: gasto_combustivel + gasto_manutencao + gasto_despesas,
  };
}
