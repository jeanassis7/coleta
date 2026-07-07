"use client";

import { getLocalDB } from "@/lib/db/dexie";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { logEvent } from "@/lib/events/log";
import type { ColetaLocal, EventoLocal } from "@/lib/types";

export type SyncErrorKind = "auth" | "network" | "data" | "storage" | "unknown";

export interface SyncResult {
  total: number;
  enviadas: number;
  falhas: number;
  /** Motivo do último erro encontrado (pra UI mostrar). */
  ultimo_erro?: string;
  ultimo_erro_kind?: SyncErrorKind;
}

const lockedClientIds = new Set<string>();

/**
 * Classifica o erro pra que a UI possa sugerir ação certa
 * (relogar quando auth, esperar quando network, etc).
 */
function classificarErro(motivo: string): SyncErrorKind {
  const m = motivo.toLowerCase();
  if (
    m.includes("jwt") ||
    m.includes("token") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("auth") ||
    m.includes("pgrst301")
  ) {
    return "auth";
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("err_") ||
    m.includes("timeout") ||
    m.includes("aborted")
  ) {
    return "network";
  }
  if (m.includes("upload") || m.includes("storage")) {
    return "storage";
  }
  if (m.includes("violates") || m.includes("constraint") || m.includes("invalid")) {
    return "data";
  }
  return "unknown";
}

/**
 * Tenta sincronizar todas as coletas pendentes e eventos pendentes.
 * Idempotente. Não rejeita — sempre resolve com resumo.
 */
export async function runSync(): Promise<SyncResult> {
  const result: SyncResult = { total: 0, enviadas: 0, falhas: 0 };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    result.ultimo_erro = "Sem conexão";
    result.ultimo_erro_kind = "network";
    return result;
  }

  const db = getLocalDB();
  const supabase = getSupabaseBrowser();

  // Verifica sessão antes de tentar
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    result.ultimo_erro = "Sessão não encontrada";
    result.ultimo_erro_kind = "auth";
    return result;
  }

  // 1. Sincroniza coletas pendentes — ignora as que ainda estão esperando GPS
  const pendentes = await db.coletas_locais
    .filter((c) => (!c.registro_subido || !c.foto_subida) && !c.gps_pendente)
    .toArray();

  result.total = pendentes.length;
  const sessionUserId = session.user.id;

  for (const coleta of pendentes) {
    if (lockedClientIds.has(coleta.client_id)) continue;

    // Segurança: coleta tem que pertencer ao motorista logado.
    // Se não bater, o INSERT/UPLOAD vai falhar com RLS — melhor skipar e logar.
    if (coleta.motorista_id !== sessionUserId) {
      const motivo = `Coleta pertence ao motorista ${coleta.motorista_id} mas a sessão atual é ${sessionUserId}. Não vai sincronizar nesse login.`;
      console.warn("[sync] skip wrong motorista:", motivo);
      await db.coletas_locais.update(coleta.client_id, { ultimo_erro: motivo });
      await logEvent(coleta.motorista_id, "sync_skipped_wrong_motorista", {
        coleta_client_id: coleta.client_id,
        coleta_motorista_id: coleta.motorista_id,
        sessao_motorista_id: sessionUserId,
      });
      result.falhas++;
      if (!result.ultimo_erro) {
        result.ultimo_erro = "Essa coleta foi feita por outro motorista neste celular.";
        result.ultimo_erro_kind = "auth";
      }
      continue;
    }

    lockedClientIds.add(coleta.client_id);
    try {
      const { ok, erro } = await sincronizarUmaColeta(coleta);
      if (ok) {
        result.enviadas++;
      } else {
        result.falhas++;
        if (erro) {
          result.ultimo_erro = erro;
          result.ultimo_erro_kind = classificarErro(erro);
        }
      }
    } finally {
      lockedClientIds.delete(coleta.client_id);
    }
  }

  // 2. Sincroniza eventos pendentes
  await sincronizarEventos();

  return result;
}

async function sincronizarUmaColeta(
  coleta: ColetaLocal
): Promise<{ ok: boolean; erro?: string }> {
  const db = getLocalDB();
  const supabase = getSupabaseBrowser();

  try {
    // Passo 1: upload da foto (se houver e ainda não subida)
    let fotoPath: string | null = coleta.foto_subida
      ? coleta.foto_blob
        ? `${coleta.motorista_id}/${coleta.client_id}.jpg`
        : null
      : null;

    if (!coleta.foto_subida && coleta.foto_blob) {
      const path = `${coleta.motorista_id}/${coleta.client_id}.jpg`;
      const tamanhoFoto = coleta.foto_blob.size;
      const { data: sessUser } = await supabase.auth.getUser();
      const sessionUserId = sessUser.user?.id ?? null;

      const { error: uploadErr } = await supabase.storage
        .from("fotos-coletas")
        .upload(path, coleta.foto_blob, {
          cacheControl: "31536000",
          upsert: true,
          contentType: "image/jpeg",
        });
      if (uploadErr) {
        const motivo = `upload: ${uploadErr.message}`;
        console.error("[sync] upload falhou:", uploadErr, {
          path,
          tamanho: tamanhoFoto,
          coleta_motorista_id: coleta.motorista_id,
          session_user_id: sessionUserId,
        });
        // Loga contexto detalhado pra admin debugar
        await logEvent(coleta.motorista_id, "sync_failure", {
          coleta_client_id: coleta.client_id,
          motivo,
          fase: "upload_foto",
          path,
          tamanho_bytes: tamanhoFoto,
          tipo_blob: coleta.foto_blob.type,
          coleta_motorista_id: coleta.motorista_id,
          session_user_id: sessionUserId,
          ids_batem: coleta.motorista_id === sessionUserId,
          error_name: (uploadErr as { name?: string }).name ?? null,
        });
        await registrarFalhaSemLog(coleta, motivo);
        return { ok: false, erro: motivo };
      }
      fotoPath = path;
      await db.coletas_locais.update(coleta.client_id, { foto_subida: true });
    } else if (!coleta.foto_subida && coleta.foto_blob === null) {
      // exige_foto=false: sem foto, ok
      fotoPath = null;
      await db.coletas_locais.update(coleta.client_id, { foto_subida: true });
    }

    // Passo 2: INSERT do registro (se ainda não subido)
    if (!coleta.registro_subido) {
      const { error: insertErr } = await supabase.from("coletas").insert({
        motorista_id: coleta.motorista_id,
        litros: coleta.litros,
        local_nome: coleta.local_nome,
        local_id: coleta.local_id,
        valor_pago: coleta.valor_pago,
        certificado_tipo: coleta.certificado_tipo,
        litros_certificado: coleta.litros_certificado,
        observacao: coleta.observacao,
        latitude: coleta.latitude,
        longitude: coleta.longitude,
        gps_accuracy: coleta.gps_accuracy,
        gps_capturado: coleta.gps_capturado,
        foto_path: fotoPath,
        device_id: coleta.device_id,
        session_id: coleta.session_id,
        app_version: coleta.app_version,
        criado_em: new Date(coleta.criado_em).toISOString(),
        client_id: coleta.client_id,
      });

      if (insertErr) {
        // 23505 = unique_violation (já enviado antes) → tratar como sucesso
        if (insertErr.code === "23505") {
          await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
          return { ok: true };
        }
        const motivo = `insert: ${insertErr.message}${insertErr.code ? ` (${insertErr.code})` : ""}`;
        console.error("[sync] insert falhou:", insertErr);
        await registrarFalha(coleta, motivo);
        return { ok: false, erro: motivo };
      }

      await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
    }

    return { ok: true };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error("[sync] exceção:", err);
    await registrarFalha(coleta, motivo);
    return { ok: false, erro: motivo };
  }
}

async function registrarFalha(coleta: ColetaLocal, motivo: string): Promise<void> {
  const db = getLocalDB();
  await db.coletas_locais.update(coleta.client_id, {
    tentativas: (coleta.tentativas || 0) + 1,
    ultimo_erro: motivo,
  });
  await logEvent(coleta.motorista_id, "sync_failure", {
    coleta_client_id: coleta.client_id,
    motivo,
    tentativas: (coleta.tentativas || 0) + 1,
  });
}

/** Variante sem logEvent (pra quem ja logou contexto rico antes) */
async function registrarFalhaSemLog(coleta: ColetaLocal, motivo: string): Promise<void> {
  const db = getLocalDB();
  await db.coletas_locais.update(coleta.client_id, {
    tentativas: (coleta.tentativas || 0) + 1,
    ultimo_erro: motivo,
  });
}

async function sincronizarEventos(): Promise<void> {
  const db = getLocalDB();
  const supabase = getSupabaseBrowser();

  const pendentes = await db.eventos_locais
    .filter((e) => !e.enviado)
    .limit(50)
    .toArray();

  if (pendentes.length === 0) return;

  const payload = pendentes.map((e: EventoLocal) => ({
    motorista_id: e.motorista_id,
    session_id: e.session_id,
    device_id: e.device_id,
    event_type: e.event_type,
    payload: e.payload,
    app_version: e.app_version,
    criado_em: new Date(e.criado_em).toISOString(),
  }));

  const { error } = await supabase.from("app_events").insert(payload);
  if (error) return;

  await db.eventos_locais.bulkUpdate(
    pendentes.map((e) => ({ key: e.id, changes: { enviado: true } }))
  );

  // Limpa enviados com mais de 7 dias
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await db.eventos_locais
    .filter((e) => e.enviado && e.criado_em < cutoff)
    .delete();
}

/** Conta quantas coletas estão pendentes de envio. */
export async function countPendentes(): Promise<number> {
  const db = getLocalDB();
  return db.coletas_locais
    .filter((c) => (!c.registro_subido || !c.foto_subida) && !c.gps_pendente)
    .count();
}

/**
 * Recovery: limpa flag gps_pendente em coletas onde o GPS já era pra ter
 * resolvido há tempos (>30s). Garante que coletas nunca fiquem presas
 * caso a função de captura tenha quebrado/cancelado.
 */
const GPS_PENDENTE_TIMEOUT_MS = 30_000;

export async function limparGpsPendenteStale(): Promise<number> {
  const db = getLocalDB();
  const cutoff = Date.now() - GPS_PENDENTE_TIMEOUT_MS;
  const stale = await db.coletas_locais
    .filter((c) => c.gps_pendente === true && c.criado_em < cutoff)
    .toArray();

  for (const c of stale) {
    await db.coletas_locais.update(c.client_id, { gps_pendente: false });
  }
  return stale.length;
}

/**
 * Cleanup pós-sync: coleta 100% sincronizada há mais de 24h é apagada
 * do IndexedDB local. O celular do motorista fica limpo e não acumula
 * blob de foto (~100KB cada) indefinidamente.
 *
 * A tela "Minhas coletas hoje" só mostra do dia atual (00:00-23:59),
 * então apagar coletas de 24h+ não afeta a UI dele.
 * Os dados originais continuam intactos no Supabase.
 */
const RETENCAO_APOS_SYNC_MS = 24 * 60 * 60 * 1000;

export async function limparColetasSincronizadasAntigas(): Promise<number> {
  const db = getLocalDB();
  const cutoff = Date.now() - RETENCAO_APOS_SYNC_MS;
  const antigas = await db.coletas_locais
    .filter(
      (c) => c.registro_subido === true && c.foto_subida === true && c.criado_em < cutoff
    )
    .toArray();

  for (const c of antigas) {
    await db.coletas_locais.delete(c.client_id);
  }
  return antigas.length;
}
