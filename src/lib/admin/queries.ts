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

/**
 * Motoristas com o email do login (que vive no Supabase Auth, não no profiles).
 * Usa o cliente service_role pra listar os usuários do Auth e casar por id.
 * Só usar em telas de admin — faz uma chamada extra ao Auth.
 */
export async function buscarMotoristasComEmail() {
  const motoristas = await buscarMotoristas();
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
