"use client";

import { getLocalDB } from "@/lib/db/dexie";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { logEvent } from "@/lib/events/log";
import type { ColetaLocal, EventoLocal } from "@/lib/types";

interface SyncResult {
  total: number;
  enviadas: number;
  falhas: number;
}

const lockedClientIds = new Set<string>();

/**
 * Tenta sincronizar todas as coletas pendentes e eventos pendentes.
 * Idempotente. Não rejeita — sempre resolve com resumo.
 */
export async function runSync(): Promise<SyncResult> {
  const result: SyncResult = { total: 0, enviadas: 0, falhas: 0 };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return result;
  }

  const db = getLocalDB();
  const supabase = getSupabaseBrowser();

  // Verifica sessão antes de tentar
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return result;

  // 1. Sincroniza coletas pendentes — ignora as que ainda estão esperando GPS
  const pendentes = await db.coletas_locais
    .filter((c) => (!c.registro_subido || !c.foto_subida) && !c.gps_pendente)
    .toArray();

  result.total = pendentes.length;

  for (const coleta of pendentes) {
    if (lockedClientIds.has(coleta.client_id)) continue;
    lockedClientIds.add(coleta.client_id);
    try {
      const ok = await sincronizarUmaColeta(coleta);
      if (ok) result.enviadas++;
      else result.falhas++;
    } finally {
      lockedClientIds.delete(coleta.client_id);
    }
  }

  // 2. Sincroniza eventos pendentes
  await sincronizarEventos();

  return result;
}

async function sincronizarUmaColeta(coleta: ColetaLocal): Promise<boolean> {
  const db = getLocalDB();
  const supabase = getSupabaseBrowser();

  try {
    // Passo 1: upload da foto (se houver e ainda não subida)
    let fotoPath = coleta.foto_subida
      ? (await db.coletas_locais.get(coleta.client_id))?.foto_blob
        ? `${coleta.motorista_id}/${coleta.client_id}.jpg`
        : null
      : null;

    if (!coleta.foto_subida && coleta.foto_blob) {
      const path = `${coleta.motorista_id}/${coleta.client_id}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("fotos-coletas")
        .upload(path, coleta.foto_blob, {
          cacheControl: "31536000",
          upsert: true,
          contentType: "image/jpeg",
        });
      if (uploadErr) {
        await registrarFalha(coleta, `upload: ${uploadErr.message}`);
        return false;
      }
      fotoPath = path;
      await db.coletas_locais.update(coleta.client_id, { foto_subida: true });
    } else if (coleta.foto_blob === null) {
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
          return true;
        }
        await registrarFalha(coleta, `insert: ${insertErr.message}`);
        return false;
      }

      await db.coletas_locais.update(coleta.client_id, { registro_subido: true });
    }

    return true;
  } catch (err) {
    await registrarFalha(coleta, String(err));
    return false;
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
