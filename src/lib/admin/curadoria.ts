import { getSupabaseServer } from "@/lib/supabase/server";

export interface ColetaSemLocal {
  id: string;
  motorista_id: string;
  local_nome: string;
  litros: number;
  valor_pago: number;
  latitude: number | null;
  longitude: number | null;
  gps_capturado: boolean;
  criado_em: string;
  profiles: { nome: string } | null;
}

export interface ClusterCuradoria {
  id: string; // chave: nome normalizado + lat/lng bucket
  nome_sugerido: string; // mais frequente dos nomes
  latitude: number;
  longitude: number;
  coletas: ColetaSemLocal[];
  nomes_distintos: string[]; // variações de digitação
  motoristas: string[];
  total_litros: number;
  total_pago: number;
}

const RAIO_CLUSTER_M = 80;

function distanciaHaversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalizarNome(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function buscarColetasSemLocal(): Promise<ColetaSemLocal[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("coletas")
    .select(
      "id, motorista_id, local_nome, litros, valor_pago, latitude, longitude, gps_capturado, criado_em, profiles!coletas_motorista_id_fkey(nome)"
    )
    .is("local_id", null)
    .order("criado_em", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data as unknown as ColetaSemLocal[]) || [];
}

/**
 * Agrupa coletas órfãs em clusters por:
 *  1. Proximidade GPS (raio 80m) quando ambas têm GPS
 *  2. Nome normalizado idêntico (quando uma ou ambas não têm GPS)
 *
 * Algoritmo simples de aglomeração: percorre cada coleta, tenta encaixar em
 * cluster existente; senão, cria novo.
 */
export function agruparEmClusters(coletas: ColetaSemLocal[]): ClusterCuradoria[] {
  const clusters: ClusterCuradoria[] = [];

  for (const c of coletas) {
    const nomeNorm = normalizarNome(c.local_nome);
    let alvo: ClusterCuradoria | null = null;

    for (const cl of clusters) {
      // Match por GPS quando ambos têm
      if (c.latitude && c.longitude && cl.latitude && cl.longitude) {
        const d = distanciaHaversineM(c.latitude, c.longitude, cl.latitude, cl.longitude);
        if (d < RAIO_CLUSTER_M) {
          alvo = cl;
          break;
        }
      }
      // Match por nome normalizado
      const nomesClusterNorm = cl.nomes_distintos.map(normalizarNome);
      if (nomesClusterNorm.includes(nomeNorm)) {
        alvo = cl;
        break;
      }
    }

    if (alvo) {
      alvo.coletas.push(c);
      alvo.total_litros += Number(c.litros);
      alvo.total_pago += Number(c.valor_pago);
      if (!alvo.nomes_distintos.includes(c.local_nome)) {
        alvo.nomes_distintos.push(c.local_nome);
      }
      const nomeMot = c.profiles?.nome || "—";
      if (!alvo.motoristas.includes(nomeMot)) {
        alvo.motoristas.push(nomeMot);
      }
      // Atualiza GPS canônico do cluster se ainda não tinha
      if (!alvo.latitude && c.latitude && c.longitude) {
        alvo.latitude = c.latitude;
        alvo.longitude = c.longitude;
      }
    } else {
      clusters.push({
        id: `${nomeNorm}-${c.latitude?.toFixed(3) || "x"}-${c.longitude?.toFixed(3) || "x"}`,
        nome_sugerido: c.local_nome,
        latitude: c.latitude || 0,
        longitude: c.longitude || 0,
        coletas: [c],
        nomes_distintos: [c.local_nome],
        motoristas: [c.profiles?.nome || "—"],
        total_litros: Number(c.litros),
        total_pago: Number(c.valor_pago),
      });
    }
  }

  // Define nome_sugerido como o mais frequente do cluster
  for (const cl of clusters) {
    const contagem = new Map<string, number>();
    for (const c of cl.coletas) {
      contagem.set(c.local_nome, (contagem.get(c.local_nome) || 0) + 1);
    }
    let melhor = cl.nome_sugerido;
    let melhorCount = 0;
    for (const [nome, n] of contagem.entries()) {
      if (n > melhorCount) {
        melhor = nome;
        melhorCount = n;
      }
    }
    cl.nome_sugerido = melhor;
  }

  // Ordena por quantidade de coletas decrescente
  return clusters.sort((a, b) => b.coletas.length - a.coletas.length);
}
