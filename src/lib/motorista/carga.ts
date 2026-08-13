"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { CargaAtivaCache } from "@/lib/types";

const CACHE_KEY = "coleta_carga_ativa";

/**
 * Lê carga ativa do cache local. Retorna null se não há.
 * Serve pra funcionar offline (motorista abre app sem sinal e ainda
 * consegue lançar coletas vinculadas à carga que iniciou com sinal).
 */
export function getCargaAtivaCached(): CargaAtivaCache | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CargaAtivaCache;
  } catch {
    return null;
  }
}

export function setCargaAtivaCached(carga: CargaAtivaCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(carga));
}

export function clearCargaAtivaCached(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * Busca carga ativa do servidor. Retorna null se motorista não tem
 * carga ativa. Se rede falhar, cai pro cache (não lança).
 */
export async function fetchCargaAtiva(
  motoristaId: string
): Promise<CargaAtivaCache | null> {
  const supabase = getSupabaseBrowser();
  try {
    const { data: carga, error: errCarga } = await supabase
      .from("cargas")
      .select("id, caminhao_id, km_inicial, iniciada_em")
      .eq("motorista_id", motoristaId)
      .eq("status", "ativa")
      .maybeSingle();
    if (errCarga || !carga) {
      // Sem carga ativa no servidor: limpa cache também
      clearCargaAtivaCached();
      return null;
    }
    const { data: caminhao, error: errCam } = await supabase
      .from("caminhoes")
      .select("id, placa, marca, cor, capacidade_l, tara_kg")
      .eq("id", carga.caminhao_id)
      .maybeSingle();
    if (errCam || !caminhao) return getCargaAtivaCached();
    const cache: CargaAtivaCache = {
      id: carga.id,
      caminhao_id: caminhao.id,
      caminhao_placa: caminhao.placa,
      caminhao_marca: caminhao.marca,
      caminhao_cor: caminhao.cor,
      capacidade_l: caminhao.capacidade_l,
      tara_kg: caminhao.tara_kg,
      km_inicial: carga.km_inicial,
      iniciada_em: carga.iniciada_em,
    };
    setCargaAtivaCached(cache);
    return cache;
  } catch {
    return getCargaAtivaCached();
  }
}

/**
 * Soma dos litros declarados nas coletas da carga (locais + servidor).
 * Usado pra barra de %cheio do caminhão.
 * Retorna 0 se falhar.
 */
export async function somaLitrosCargaAtiva(
  cargaId: string,
  motoristaId: string
): Promise<number> {
  const supabase = getSupabaseBrowser();
  let total = 0;
  try {
    // 1. Coletas já sincronizadas na carga
    const { data } = await supabase
      .from("coletas")
      .select("litros")
      .eq("carga_id", cargaId)
      .eq("motorista_id", motoristaId);
    for (const c of data || []) total += Number(c.litros);
  } catch {
    // ignora, retorna só o que tiver
  }
  // 2. Coletas locais ainda não sincronizadas (com esse carga_id)
  try {
    const { getLocalDB } = await import("@/lib/db/dexie");
    const db = getLocalDB();
    const locais = await db.coletas_locais
      .where("carga_id")
      .equals(cargaId)
      .filter((c) => !c.registro_subido)
      .toArray();
    for (const c of locais) total += Number(c.litros);
  } catch {
    // dexie offline first, mas se falhar ignoramos
  }
  return total;
}
