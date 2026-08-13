"use client";

import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { CargaAtivaCache } from "@/lib/types";

const CACHE_KEY = "coleta_carga_ativa";
const RESUMO_KEY = "coleta_carga_resumo";

/**
 * Snapshot do que o SERVIDOR sabe sobre a carga ativa (litros e nº de
 * coletas já sincronizadas). Guardado em localStorage pra que a barra do
 * caminhão e o resumo da descarga funcionem offline: total = snapshot do
 * servidor + coletas locais criadas depois do snapshot.
 */
interface ResumoServidorCache {
  carga_id: string;
  litros_servidor: number;
  coletas_servidor: number;
  /** Date.now() do momento do snapshot (mesmo relógio das coletas locais). */
  atualizado_em: number;
}

/**
 * Lê carga ativa do cache local, VALIDANDO o dono. Se o cache pertence a
 * outro motorista (troca de login no mesmo celular), descarta e retorna
 * null — evita coleta do motorista B cair na carga do motorista A.
 * Cache antigo sem motorista_id também é descartado.
 */
export function getCargaAtivaCached(motoristaId: string): CargaAtivaCache | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const carga = JSON.parse(raw) as CargaAtivaCache;
    if (!carga.motorista_id || carga.motorista_id !== motoristaId) {
      clearCargaAtivaCached();
      return null;
    }
    return carga;
  } catch {
    return null;
  }
}

export function setCargaAtivaCached(carga: CargaAtivaCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(carga));
}

export function clearCargaAtivaCached(): void {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(RESUMO_KEY);
}

/**
 * Há descarga registrada no celular ainda não confirmada no servidor?
 * Enquanto houver, a carga correspondente está encerrada LOCALMENTE
 * (mesmo que o servidor ainda a veja como 'ativa') e o motorista não
 * pode abrir carga nova (o servidor rejeitaria pela unique de 1 ativa).
 */
export async function temDescargaPendenteSync(motoristaId: string): Promise<boolean> {
  try {
    const { getLocalDB } = await import("@/lib/db/dexie");
    const db = getLocalDB();
    const n = await db.descargas_locais
      .where("motorista_id")
      .equals(motoristaId)
      .filter((d) => !d.registro_subido || !d.carga_encerrada_servidor)
      .count();
    return n > 0;
  } catch {
    return false;
  }
}

/**
 * Busca carga ativa do servidor. Retorna null se não há.
 * Regras:
 *  - Se existe descarga local pendente de sync pra carga que o servidor
 *    ainda vê como ativa, a carga está encerrada localmente → null
 *    (não "ressuscitar" a carga antes do sync fechar ela no servidor).
 *  - Se a rede falhar, cai pro cache validado (não lança).
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
    if (errCarga) return getCargaAtivaCached(motoristaId);
    if (!carga) {
      clearCargaAtivaCached();
      return null;
    }

    // Carga ativa no servidor MAS com descarga local esperando sync?
    // Então ela já foi encerrada aqui — o sync vai fechar no servidor.
    try {
      const { getLocalDB } = await import("@/lib/db/dexie");
      const db = getLocalDB();
      const pendente = await db.descargas_locais
        .where("carga_id")
        .equals(carga.id)
        .count();
      if (pendente > 0) {
        clearCargaAtivaCached();
        return null;
      }
    } catch {
      // Dexie indisponível — segue o fluxo normal
    }

    const { data: caminhao, error: errCam } = await supabase
      .from("caminhoes")
      .select("id, placa, marca, cor, capacidade_l, tara_kg")
      .eq("id", carga.caminhao_id)
      .maybeSingle();
    if (errCam || !caminhao) return getCargaAtivaCached(motoristaId);

    const cache: CargaAtivaCache = {
      id: carga.id,
      motorista_id: motoristaId,
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
    return getCargaAtivaCached(motoristaId);
  }
}

export interface ResumoCarga {
  litros: number;
  coletas: number;
}

/**
 * Litros declarados + nº de coletas da carga ativa. Funciona offline:
 *  - Online: consulta o servidor e salva snapshot em localStorage.
 *  - Offline: usa o último snapshot.
 *  - Sempre: soma coletas locais que ainda não entraram no snapshot
 *    (não sincronizadas, OU sincronizadas depois do snapshot).
 */
export async function resumoCargaAtiva(
  cargaId: string,
  motoristaId: string
): Promise<ResumoCarga> {
  let litrosServidor = 0;
  let coletasServidor = 0;
  let snapshotEm = 0;

  const supabase = getSupabaseBrowser();
  let servidorOk = false;
  try {
    const { data, error } = await supabase
      .from("coletas")
      .select("litros")
      .eq("carga_id", cargaId)
      .eq("motorista_id", motoristaId);
    if (!error && data) {
      snapshotEm = Date.now();
      litrosServidor = data.reduce((s, c) => s + Number(c.litros), 0);
      coletasServidor = data.length;
      servidorOk = true;
      const snap: ResumoServidorCache = {
        carga_id: cargaId,
        litros_servidor: litrosServidor,
        coletas_servidor: coletasServidor,
        atualizado_em: snapshotEm,
      };
      localStorage.setItem(RESUMO_KEY, JSON.stringify(snap));
    }
  } catch {
    // offline — cai pro snapshot abaixo
  }

  if (!servidorOk) {
    try {
      const raw = localStorage.getItem(RESUMO_KEY);
      if (raw) {
        const snap = JSON.parse(raw) as ResumoServidorCache;
        if (snap.carga_id === cargaId) {
          litrosServidor = snap.litros_servidor;
          coletasServidor = snap.coletas_servidor;
          snapshotEm = snap.atualizado_em;
        }
      }
    } catch {
      // sem snapshot — só locais
    }
  }

  let litrosLocais = 0;
  let coletasLocais = 0;
  try {
    const { getLocalDB } = await import("@/lib/db/dexie");
    const db = getLocalDB();
    const locais = await db.coletas_locais
      .where("carga_id")
      .equals(cargaId)
      .filter((c) => !c.registro_subido || c.criado_em > snapshotEm)
      .toArray();
    for (const c of locais) {
      litrosLocais += Number(c.litros);
      coletasLocais += 1;
    }
  } catch {
    // Dexie indisponível
  }

  return {
    litros: litrosServidor + litrosLocais,
    coletas: coletasServidor + coletasLocais,
  };
}
