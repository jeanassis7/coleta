import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface FiltrosDashboard {
  periodo: "hoje" | "semana" | "mes" | "customizado";
  inicio?: string; // ISO
  fim?: string;
  motorista?: string; // uuid ou 'todos'
}

// Brasil é UTC-3 fixo (sem horário de verão desde 2019)
const BR_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Componentes da data/hora atual em Brasília. */
function nowBrParts(): { year: number; month: number; date: number; day: number } {
  const nowUtc = new Date();
  const brAsUtc = new Date(nowUtc.getTime() + BR_OFFSET_MS);
  return {
    year: brAsUtc.getUTCFullYear(),
    month: brAsUtc.getUTCMonth(),
    date: brAsUtc.getUTCDate(),
    day: brAsUtc.getUTCDay(),
  };
}

/** Constrói uma Date que representa um wall-clock BR no UTC equivalente. */
function fromBrParts(y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m, d, h, mi, s, ms) - BR_OFFSET_MS);
}

/**
 * Períodos alinhados ao calendário brasileiro:
 *  - hoje: 00:00 a 23:59 do dia atual em Brasília
 *  - semana: domingo 00:00 a sábado 23:59 da semana atual em Brasília
 *  - mês: dia 1 00:00 a último dia 23:59 do mês atual em Brasília
 *  - customizado: o que o usuário escolheu
 */
export function resolvePeriodo(filtros: FiltrosDashboard): { inicio: Date; fim: Date } {
  if (filtros.periodo === "customizado" && filtros.inicio && filtros.fim) {
    return { inicio: new Date(filtros.inicio), fim: new Date(filtros.fim) };
  }

  const { year, month, date, day } = nowBrParts();

  if (filtros.periodo === "hoje") {
    return {
      inicio: fromBrParts(year, month, date, 0, 0, 0, 0),
      fim: fromBrParts(year, month, date, 23, 59, 59, 999),
    };
  }

  if (filtros.periodo === "semana") {
    const diaDomingo = date - day;
    return {
      inicio: fromBrParts(year, month, diaDomingo, 0, 0, 0, 0),
      fim: fromBrParts(year, month, diaDomingo + 6, 23, 59, 59, 999),
    };
  }

  // mês
  return {
    inicio: fromBrParts(year, month, 1, 0, 0, 0, 0),
    fim: fromBrParts(year, month + 1, 0, 23, 59, 59, 999),
  };
}

/**
 * Período anterior PARA COMPARAÇÃO JUSTA (mesmo intervalo até "agora"):
 *  - hoje → ontem (dia inteiro)
 *  - semana → semana anterior até MESMO dia da semana (Dom-Qua se hoje é Qua)
 *  - mês → mês anterior do dia 1 até MESMA data (May 1-6 se hoje é Jun 6)
 *  - customizado → mesma duração imediatamente antes
 *
 * Edge case mês: se hoje é dia 31 e mês anterior só tem 28-30 dias, clampa.
 */
export function resolvePeriodoAnterior(filtros: FiltrosDashboard): { inicio: Date; fim: Date } {
  if (filtros.periodo === "customizado") {
    const { inicio, fim } = resolvePeriodo(filtros);
    const duracao = fim.getTime() - inicio.getTime();
    const previo_fim = new Date(inicio.getTime() - 1);
    const previo_inicio = new Date(previo_fim.getTime() - duracao);
    return { inicio: previo_inicio, fim: previo_fim };
  }

  const { year, month, date, day } = nowBrParts();

  if (filtros.periodo === "hoje") {
    return {
      inicio: fromBrParts(year, month, date - 1, 0, 0, 0, 0),
      fim: fromBrParts(year, month, date - 1, 23, 59, 59, 999),
    };
  }

  if (filtros.periodo === "semana") {
    const diaDomingo = date - day;
    return {
      inicio: fromBrParts(year, month, diaDomingo - 7, 0, 0, 0, 0),
      fim: fromBrParts(year, month, date - 7, 23, 59, 59, 999),
    };
  }

  // mês anterior do dia 1 até mesma data (com clamp pra meses curtos)
  const ultimoDiaMesAnterior = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const diaParaUsar = Math.min(date, ultimoDiaMesAnterior);
  return {
    inicio: fromBrParts(year, month - 1, 1, 0, 0, 0, 0),
    fim: fromBrParts(year, month - 1, diaParaUsar, 23, 59, 59, 999),
  };
}

type ColetaCompleta = {
  id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  local_id: string | null;
  valor_pago: number;
  certificado_tipo: string;
  litros_certificado: number | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  foto_path: string | null;
  observacao: string | null;
  criado_em: string;
  sincronizado_em: string | null;
  profiles: { nome: string } | null;
};

async function buscarColetasDoIntervalo(
  inicio: Date,
  fim: Date,
  motoristaId?: string
): Promise<ColetaCompleta[]> {
  const supabase = await getSupabaseServer();
  // !inner + filtro em profiles.is_teste EXCLUI coletas de motoristas de teste
  // do dashboard/KPI. Ver /admin/eventos/motoristas pra visualização com testes.
  let q = supabase
    .from("coletas")
    .select("*, profiles!coletas_motorista_id_fkey!inner(nome, is_teste)")
    .eq("profiles.is_teste", false)
    .gte("criado_em", inicio.toISOString())
    .lte("criado_em", fim.toISOString())
    .order("criado_em", { ascending: false });

  if (motoristaId && motoristaId !== "todos") {
    q = q.eq("motorista_id", motoristaId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data as ColetaCompleta[]) || [];
}

export async function buscarColetas(filtros: FiltrosDashboard) {
  const { inicio, fim } = resolvePeriodo(filtros);
  return buscarColetasDoIntervalo(inicio, fim, filtros.motorista);
}

export async function buscarColetasAnterior(filtros: FiltrosDashboard) {
  const { inicio, fim } = resolvePeriodoAnterior(filtros);
  return buscarColetasDoIntervalo(inicio, fim, filtros.motorista);
}

/**
 * Lista motoristas cadastrados. Por padrão EXCLUI motoristas de teste
 * (is_teste=true) pra não contaminar dashboards/dropdowns. Passar
 * { incluirTeste: true } quando a tela precisa mostrar todos
 * (ex: /admin/motoristas, /admin/dev/features).
 */
export async function buscarMotoristas(
  opts: { incluirTeste?: boolean } = {}
) {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("profiles")
    .select(
      "id, nome, role, ativo, exige_foto, senha_visivel, is_teste, features, mostra_saldo_app, criado_em"
    )
    .order("nome");
  if (!opts.incluirTeste) {
    q = q.eq("is_teste", false);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Só motoristas de teste (is_teste=true, role=motorista).
 * Usado no painel dev /admin/dev/features.
 */
export async function buscarMotoristasTeste() {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, features, mostra_saldo_app, criado_em")
    .eq("role", "motorista")
    .eq("is_teste", true)
    .order("nome");
  if (error) throw error;
  return data || [];
}

export interface Caminhao {
  id: string;
  placa: string;
  marca: string;
  modelo: string | null;
  cor: string;
  capacidade_l: number;
  tara_kg: number;
  ativo: boolean;
  motivo_inativo: string | null;
  criado_em: string;
}

export async function buscarCaminhoes(): Promise<Caminhao[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("caminhoes")
    .select("*")
    .order("ativo", { ascending: false })
    .order("placa");
  if (error) throw error;
  return (data as Caminhao[]) || [];
}

export interface CargaDetalhada {
  id: string;
  motorista_id: string;
  motorista_nome: string;
  motorista_is_teste: boolean;
  caminhao_id: string;
  caminhao_placa: string;
  caminhao_marca: string;
  caminhao_cor: string;
  capacidade_l: number;
  km_inicial: number;
  km_final: number | null;
  status: "ativa" | "encerrada" | "cancelada";
  iniciada_em: string;
  encerrada_em: string | null;
  total_coletas: number;
  total_litros_coletas: number;
  total_valor_coletas: number;
  total_despesas: number;
  total_valor_despesas: number;
  total_abastecimentos: number;
  total_valor_abastecimentos: number;
  descarga: {
    peso_bruto_kg: number;
    peso_tara_kg: number;
    peso_liquido_kg: number;
    litros_estimados: number | null;
    umidade_pct: number | null;
    criado_em: string;
  } | null;
}

/**
 * Todas as cargas (com dados agregados de coletas/despesas/abast/descarga).
 * Filtra motoristas de teste por padrão.
 */
export async function buscarCargas(
  opts: { incluirTeste?: boolean; status?: "ativa" | "encerrada" | "cancelada"; motorista_id?: string } = {}
): Promise<CargaDetalhada[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("cargas")
    .select(
      `id, motorista_id, caminhao_id, km_inicial, km_final, status,
       iniciada_em, encerrada_em,
       profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
       caminhoes(placa, marca, cor, capacidade_l),
       coletas(id, litros, valor_pago),
       despesas(id, valor),
       abastecimentos(id, valor),
       descargas(peso_bruto_kg, peso_tara_kg, peso_liquido_kg, litros_estimados, umidade_pct, criado_em)`
    )
    .order("iniciada_em", { ascending: false });

  if (!opts.incluirTeste) q = q.eq("profiles.is_teste", false);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.motorista_id) q = q.eq("motorista_id", opts.motorista_id);

  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    motorista_id: string;
    caminhao_id: string;
    km_inicial: number;
    km_final: number | null;
    status: "ativa" | "encerrada" | "cancelada";
    iniciada_em: string;
    encerrada_em: string | null;
    profiles: { nome: string; is_teste: boolean } | null;
    caminhoes: { placa: string; marca: string; cor: string; capacidade_l: number } | null;
    coletas: { id: string; litros: number; valor_pago: number }[] | null;
    despesas: { id: string; valor: number }[] | null;
    abastecimentos: { id: string; valor: number }[] | null;
    descargas:
      | {
          peso_bruto_kg: number;
          peso_tara_kg: number;
          peso_liquido_kg: number;
          litros_estimados: number | null;
          umidade_pct: number | null;
          criado_em: string;
        }[]
      | null;
  };

  const rows = (data as unknown as Row[]) || [];
  return rows.map((r): CargaDetalhada => {
    const coletas = r.coletas || [];
    const despesas = r.despesas || [];
    const abast = r.abastecimentos || [];
    const desc = (r.descargas || []).sort((a, b) =>
      (a.criado_em || "").localeCompare(b.criado_em || "")
    );
    return {
      id: r.id,
      motorista_id: r.motorista_id,
      motorista_nome: r.profiles?.nome || "—",
      motorista_is_teste: !!r.profiles?.is_teste,
      caminhao_id: r.caminhao_id,
      caminhao_placa: r.caminhoes?.placa || "—",
      caminhao_marca: r.caminhoes?.marca || "",
      caminhao_cor: r.caminhoes?.cor || "",
      capacidade_l: r.caminhoes?.capacidade_l || 0,
      km_inicial: r.km_inicial,
      km_final: r.km_final,
      status: r.status,
      iniciada_em: r.iniciada_em,
      encerrada_em: r.encerrada_em,
      total_coletas: coletas.length,
      total_litros_coletas: coletas.reduce((s, c) => s + Number(c.litros), 0),
      total_valor_coletas: coletas.reduce((s, c) => s + Number(c.valor_pago), 0),
      total_despesas: despesas.length,
      total_valor_despesas: despesas.reduce((s, d) => s + Number(d.valor), 0),
      total_abastecimentos: abast.length,
      total_valor_abastecimentos: abast.reduce((s, a) => s + Number(a.valor), 0),
      descarga: desc[0] || null,
    };
  });
}

export interface DescargaDetalhada {
  id: string;
  carga_id: string;
  motorista_nome: string;
  motorista_is_teste: boolean;
  caminhao_placa: string;
  peso_bruto_kg: number;
  peso_tara_kg: number;
  peso_liquido_kg: number;
  litros_estimados: number | null;
  umidade_pct: number | null;
  foto_papel_path: string | null;
  criado_em: string;
}

export async function buscarDescargas(
  opts: { incluirTeste?: boolean; pendenteUmidade?: boolean } = {}
): Promise<DescargaDetalhada[]> {
  const supabase = await getSupabaseServer();
  let q = supabase
    .from("descargas")
    .select(
      `id, carga_id, peso_bruto_kg, peso_tara_kg, peso_liquido_kg,
       litros_estimados, umidade_pct, foto_papel_path, criado_em,
       cargas!inner(
         motorista_id,
         profiles!cargas_motorista_id_fkey!inner(nome, is_teste),
         caminhoes(placa)
       )`
    )
    .order("criado_em", { ascending: false });

  if (!opts.incluirTeste) q = q.eq("cargas.profiles.is_teste", false);
  if (opts.pendenteUmidade) q = q.is("umidade_pct", null);

  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    carga_id: string;
    peso_bruto_kg: number;
    peso_tara_kg: number;
    peso_liquido_kg: number;
    litros_estimados: number | null;
    umidade_pct: number | null;
    foto_papel_path: string | null;
    criado_em: string;
    cargas: {
      motorista_id: string;
      profiles: { nome: string; is_teste: boolean } | null;
      caminhoes: { placa: string } | null;
    } | null;
  };
  const rows = (data as unknown as Row[]) || [];
  return rows.map((r) => ({
    id: r.id,
    carga_id: r.carga_id,
    motorista_nome: r.cargas?.profiles?.nome || "—",
    motorista_is_teste: !!r.cargas?.profiles?.is_teste,
    caminhao_placa: r.cargas?.caminhoes?.placa || "—",
    peso_bruto_kg: r.peso_bruto_kg,
    peso_tara_kg: r.peso_tara_kg,
    peso_liquido_kg: r.peso_liquido_kg,
    litros_estimados: r.litros_estimados,
    umidade_pct: r.umidade_pct,
    foto_papel_path: r.foto_papel_path,
    criado_em: r.criado_em,
  }));
}

// ============================================================================
// ADIANTAMENTOS
// ============================================================================

export interface Adiantamento {
  id: string;
  motorista_id: string;
  valor: number;
  data_envio: string;
  forma_pagamento: "dinheiro" | "pix";
  observacao: string | null;
  status: "pendente" | "aceito" | "cancelado";
  aceito_em: string | null;
  pular_contador: number;
  criado_em: string;
}

export interface Acerto {
  id: string;
  motorista_id: string;
  corte_em: string;
  valor_devolvido: number;
  valor_vale: number;
  valor_saldo: number;
  observacao: string | null;
  criado_em: string;
}

export interface MotoristaComSaldo {
  id: string;
  nome: string;
  is_teste: boolean;
  saldo_atual: number;
  ultimo_adiantamento: Adiantamento | null;
  pular_contador_atual: number;
}

/**
 * Retorna cada motorista com saldo atual calculado.
 * saldo = adiantamentos aceitos desde último acerto
 *       − coletas.valor_pago (desde corte)
 *       − despesas.valor (desde corte)
 *       − abastecimentos.valor (desde corte)
 *       + valor_saldo do último acerto (carry-over)
 *
 * incluirTeste: dev vê motoristas de teste (com badge na UI) pra poder
 * testar adiantamentos; admin nunca vê.
 */
export async function buscarMotoristasComSaldo(
  opts: { incluirTeste?: boolean } = {}
): Promise<MotoristaComSaldo[]> {
  const supabase = await getSupabaseServer();

  let qM = supabase
    .from("profiles")
    .select("id, nome, is_teste")
    .eq("role", "motorista")
    .eq("ativo", true)
    .order("nome");
  if (!opts.incluirTeste) qM = qM.eq("is_teste", false);
  const { data: motoristas, error: errM } = await qM;
  if (errM) throw errM;

  const result: MotoristaComSaldo[] = [];
  for (const m of motoristas || []) {
    // Último acerto (pra descobrir corte_em)
    const { data: acerto } = await supabase
      .from("acertos")
      .select("corte_em, valor_saldo")
      .eq("motorista_id", m.id)
      .order("corte_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    const corte = acerto?.corte_em || "1970-01-01T00:00:00Z";
    const carryOver = acerto?.valor_saldo || 0;

    // Soma adiantamentos aceitos após corte
    const { data: adiantamentos } = await supabase
      .from("adiantamentos")
      .select("valor, aceito_em")
      .eq("motorista_id", m.id)
      .eq("status", "aceito")
      .gt("aceito_em", corte);
    const somaAd = (adiantamentos || []).reduce(
      (s, a) => s + Number(a.valor),
      0
    );

    // Soma gastos após corte
    const [{ data: coletas }, { data: despesas }, { data: abast }] = await Promise.all([
      supabase
        .from("coletas")
        .select("valor_pago")
        .eq("motorista_id", m.id)
        .gt("criado_em", corte),
      supabase
        .from("despesas")
        .select("valor")
        .eq("motorista_id", m.id)
        .gt("criado_em", corte),
      supabase
        .from("abastecimentos")
        .select("valor")
        .eq("motorista_id", m.id)
        .gt("criado_em", corte),
    ]);
    const somaColetas = (coletas || []).reduce(
      (s, c) => s + Number(c.valor_pago),
      0
    );
    const somaDespesas = (despesas || []).reduce(
      (s, d) => s + Number(d.valor),
      0
    );
    const somaAbast = (abast || []).reduce((s, a) => s + Number(a.valor), 0);

    const saldo = somaAd - somaColetas - somaDespesas - somaAbast + carryOver;

    // Último adiantamento (qualquer status) pra mostrar no painel
    const { data: ultimo } = await supabase
      .from("adiantamentos")
      .select("*")
      .eq("motorista_id", m.id)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Pular contador da última pendente (pra alerta 10+)
    const { data: pendente } = await supabase
      .from("adiantamentos")
      .select("pular_contador")
      .eq("motorista_id", m.id)
      .eq("status", "pendente")
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    result.push({
      id: m.id,
      nome: m.nome,
      is_teste: !!m.is_teste,
      // Centavos existem agora (despesas/abastecimentos com decimais) —
      // arredonda pra 2 casas, não pra inteiro.
      saldo_atual: Math.round(saldo * 100) / 100,
      ultimo_adiantamento: (ultimo as Adiantamento) || null,
      pular_contador_atual: pendente?.pular_contador ?? 0,
    });
  }
  return result;
}

/**
 * Histórico de adiantamentos + acertos de um motorista específico.
 */
export async function buscarHistoricoAdiantamentos(motoristaId: string) {
  const supabase = await getSupabaseServer();
  const [{ data: adiantamentos }, { data: acertos }] = await Promise.all([
    supabase
      .from("adiantamentos")
      .select("*")
      .eq("motorista_id", motoristaId)
      .order("criado_em", { ascending: false }),
    supabase
      .from("acertos")
      .select("*")
      .eq("motorista_id", motoristaId)
      .order("criado_em", { ascending: false }),
  ]);
  return {
    adiantamentos: (adiantamentos as Adiantamento[]) || [],
    acertos: (acertos as Acerto[]) || [],
  };
}

/**
 * Motoristas com o email do login (que vive no Supabase Auth, não no profiles).
 * Usa o cliente service_role pra listar os usuários do Auth e casar por id.
 * Só usar em telas de admin — faz uma chamada extra ao Auth.
 */
export async function buscarMotoristasComEmail(
  opts: { incluirTeste?: boolean } = {}
) {
  const motoristas = await buscarMotoristas(opts);
  const admin = getSupabaseAdmin();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailPorId = new Map(
    (data?.users ?? []).map((u) => [u.id, u.email ?? null])
  );
  return motoristas.map((m) => ({
    ...m,
    email: emailPorId.get(m.id) ?? null,
  }));
}

export interface Kpis {
  total_coletas: number;
  total_litros: number;
  total_pago: number;
  custo_medio: number;
  motoristas_ativos: number;
  coletas_com_gps: number;
  por_motorista: { motorista_id: string; nome: string; coletas: number; litros: number; valor: number }[];
}

export function calcularKpis(coletas: ColetaCompleta[]): Kpis {
  const total_coletas = coletas.length;
  const total_litros = coletas.reduce((s, c) => s + Number(c.litros), 0);
  const total_pago = coletas.reduce((s, c) => s + Number(c.valor_pago), 0);
  const custo_medio = total_litros > 0 ? total_pago / total_litros : 0;
  const coletas_com_gps = coletas.filter((c) => c.gps_capturado).length;
  const setMotoristas = new Set(coletas.map((c) => c.motorista_id));
  const motoristas_ativos = setMotoristas.size;

  const porMap = new Map<string, { nome: string; coletas: number; litros: number; valor: number }>();
  for (const c of coletas) {
    const cur = porMap.get(c.motorista_id) || {
      nome: c.profiles?.nome || "—",
      coletas: 0,
      litros: 0,
      valor: 0,
    };
    cur.coletas += 1;
    cur.litros += Number(c.litros);
    cur.valor += Number(c.valor_pago);
    porMap.set(c.motorista_id, cur);
  }

  return {
    total_coletas,
    total_litros,
    total_pago,
    custo_medio,
    motoristas_ativos,
    coletas_com_gps,
    por_motorista: Array.from(porMap.entries())
      .map(([motorista_id, v]) => ({ motorista_id, ...v }))
      .sort((a, b) => b.litros - a.litros),
  };
}

/**
 * Calcula custo R$/L por motorista — média, min, max.
 * Ordenado do mais barato (melhor pra empresa) pro mais caro.
 */
export interface CustoMotorista {
  motorista_id: string;
  nome: string;
  coletas: number;
  custo_medio: number; // R$/L
  custo_min: number;   // R$/L mais barato que ele já pagou
  custo_max: number;   // R$/L mais caro que ele já pagou
  custo_mediana: number;
}

export function calcularCustoPorMotorista(coletas: ColetaCompleta[]): CustoMotorista[] {
  const porMot = new Map<string, { nome: string; custos: number[]; }>();

  for (const c of coletas) {
    if (c.litros <= 0) continue;
    const custo = Number(c.valor_pago) / Number(c.litros);
    const cur = porMot.get(c.motorista_id) || {
      nome: c.profiles?.nome || "—",
      custos: [],
    };
    cur.custos.push(custo);
    porMot.set(c.motorista_id, cur);
  }

  const result: CustoMotorista[] = [];
  for (const [motorista_id, v] of porMot.entries()) {
    const sorted = [...v.custos].sort((a, b) => a - b);
    const soma = sorted.reduce((s, x) => s + x, 0);
    const custo_medio = soma / sorted.length;
    const mediana =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[(sorted.length - 1) / 2];

    result.push({
      motorista_id,
      nome: v.nome,
      coletas: sorted.length,
      custo_medio,
      custo_min: sorted[0],
      custo_max: sorted[sorted.length - 1],
      custo_mediana: mediana,
    });
  }

  return result.sort((a, b) => a.custo_medio - b.custo_medio);
}

/**
 * % de litros que entraram no certificado por motorista.
 * Fórmula: soma(litros_certificado) / soma(litros)
 * litros_certificado é null quando 'nao', igual a litros quando 'integral',
 * e o valor digitado quando 'parcial'.
 */
export interface CertificadoMotorista {
  motorista_id: string;
  nome: string;
  total_coletas: number;
  total_litros: number;
  litros_certificado: number;
  pct_litros: number; // litros_certificado / total_litros * 100
}

export function calcularCertificadoPorMotorista(coletas: ColetaCompleta[]): CertificadoMotorista[] {
  const por = new Map<string, CertificadoMotorista>();

  for (const c of coletas) {
    const cur = por.get(c.motorista_id) || {
      motorista_id: c.motorista_id,
      nome: c.profiles?.nome || "—",
      total_coletas: 0,
      total_litros: 0,
      litros_certificado: 0,
      pct_litros: 0,
    };
    cur.total_coletas += 1;
    cur.total_litros += Number(c.litros);
    if (c.litros_certificado !== null) {
      cur.litros_certificado += Number(c.litros_certificado);
    }
    por.set(c.motorista_id, cur);
  }

  for (const v of por.values()) {
    v.pct_litros = v.total_litros > 0 ? (v.litros_certificado / v.total_litros) * 100 : 0;
  }

  // Ordena crescente — quem certifica menos volume aparece no topo
  return Array.from(por.values()).sort((a, b) => a.pct_litros - b.pct_litros);
}

/**
 * Top locais por litros coletados. Pode opcionalmente fazer breakdown por motorista.
 */
export interface LocalRanking {
  local_nome: string;
  visitas: number;
  total_litros: number;
  total_pago: number;
  custo_medio: number;
  motoristas: { nome: string; visitas: number; litros: number }[];
}

export function calcularTopLocais(
  coletas: ColetaCompleta[],
  limite = 15
): LocalRanking[] {
  // Normaliza nome (trim + case-insensitive pra agrupar variações leves)
  const por = new Map<string, {
    nome_original: string;
    visitas: number;
    total_litros: number;
    total_pago: number;
    por_motorista: Map<string, { nome: string; visitas: number; litros: number }>;
  }>();

  for (const c of coletas) {
    const chave = c.local_nome.trim().toLowerCase();
    const cur = por.get(chave) || {
      nome_original: c.local_nome.trim(),
      visitas: 0,
      total_litros: 0,
      total_pago: 0,
      por_motorista: new Map(),
    };
    cur.visitas += 1;
    cur.total_litros += Number(c.litros);
    cur.total_pago += Number(c.valor_pago);

    const nomeMot = c.profiles?.nome || "—";
    const curMot = cur.por_motorista.get(nomeMot) || {
      nome: nomeMot,
      visitas: 0,
      litros: 0,
    };
    curMot.visitas += 1;
    curMot.litros += Number(c.litros);
    cur.por_motorista.set(nomeMot, curMot);

    por.set(chave, cur);
  }

  const todos: LocalRanking[] = Array.from(por.values()).map((v) => ({
    local_nome: v.nome_original,
    visitas: v.visitas,
    total_litros: v.total_litros,
    total_pago: v.total_pago,
    custo_medio: v.total_litros > 0 ? v.total_pago / v.total_litros : 0,
    motoristas: Array.from(v.por_motorista.values()).sort(
      (a, b) => b.litros - a.litros
    ),
  }));

  return todos
    .sort((a, b) => b.total_litros - a.total_litros)
    .slice(0, limite);
}

/**
 * Calcula delta entre dois valores numéricos, retornando direção e %.
 */
export interface Delta {
  valor_atual: number;
  valor_anterior: number;
  diff_abs: number;
  diff_pct: number | null; // null se anterior = 0
  direcao: "subiu" | "caiu" | "igual";
}

export function calcularDelta(atual: number, anterior: number): Delta {
  const diff_abs = atual - anterior;
  const diff_pct = anterior !== 0 ? (diff_abs / anterior) * 100 : null;
  const direcao =
    Math.abs(diff_abs) < 0.001 ? "igual" : diff_abs > 0 ? "subiu" : "caiu";
  return { valor_atual: atual, valor_anterior: anterior, diff_abs, diff_pct, direcao };
}
