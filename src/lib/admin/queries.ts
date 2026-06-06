import { getSupabaseServer } from "@/lib/supabase/server";

export interface FiltrosDashboard {
  periodo: "hoje" | "semana" | "mes" | "customizado";
  inicio?: string; // ISO
  fim?: string;
  motorista?: string; // uuid ou 'todos'
}

/**
 * Períodos alinhados ao calendário:
 *  - hoje: 00:00 a 23:59 do dia atual
 *  - semana: domingo 00:00 a sábado 23:59 da SEMANA atual
 *  - mês: dia 1 00:00 a último dia 23:59 do MÊS atual
 *  - customizado: o que o usuário escolheu
 */
export function resolvePeriodo(filtros: FiltrosDashboard): { inicio: Date; fim: Date } {
  const agora = new Date();

  if (filtros.periodo === "customizado" && filtros.inicio && filtros.fim) {
    return { inicio: new Date(filtros.inicio), fim: new Date(filtros.fim) };
  }

  if (filtros.periodo === "hoje") {
    const inicio = new Date(agora);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(agora);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }

  if (filtros.periodo === "semana") {
    // Domingo da semana atual (getDay: 0=domingo .. 6=sábado)
    const inicio = new Date(agora);
    inicio.setDate(agora.getDate() - agora.getDay());
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6); // sábado
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }

  // mês: dia 1 ao último dia do mês atual
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio, fim };
}

/**
 * Período anterior alinhado ao calendário:
 *  - hoje → ontem
 *  - semana → semana anterior (domingo-sábado)
 *  - mês → mês anterior (calendário completo)
 *  - customizado → mesmo número de dias imediatamente antes
 */
export function resolvePeriodoAnterior(filtros: FiltrosDashboard): { inicio: Date; fim: Date } {
  const agora = new Date();

  if (filtros.periodo === "hoje") {
    const inicio = new Date(agora);
    inicio.setDate(agora.getDate() - 1);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }

  if (filtros.periodo === "semana") {
    const { inicio: inicioAtual } = resolvePeriodo(filtros);
    const inicio = new Date(inicioAtual);
    inicio.setDate(inicioAtual.getDate() - 7);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);
    return { inicio, fim };
  }

  if (filtros.periodo === "mes") {
    const inicio = new Date(agora.getFullYear(), agora.getMonth() - 1, 1, 0, 0, 0, 0);
    const fim = new Date(agora.getFullYear(), agora.getMonth(), 0, 23, 59, 59, 999);
    return { inicio, fim };
  }

  // customizado: mesma duração imediatamente antes
  const { inicio, fim } = resolvePeriodo(filtros);
  const duracao = fim.getTime() - inicio.getTime();
  const previo_fim = new Date(inicio.getTime() - 1);
  const previo_inicio = new Date(previo_fim.getTime() - duracao);
  return { inicio: previo_inicio, fim: previo_fim };
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
  let q = supabase
    .from("coletas")
    .select("*, profiles!coletas_motorista_id_fkey(nome)")
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

export async function buscarMotoristas() {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nome, role, ativo, exige_foto, senha_visivel, criado_em")
    .order("nome");
  if (error) throw error;
  return data || [];
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
