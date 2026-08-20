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

  // 2. Sincroniza lançamentos offline do Módulo 1
  await sincronizarDespesas(sessionUserId, result);
  await sincronizarAbastecimentos(sessionUserId, result);
  await sincronizarDescargas(sessionUserId, result);

  // 3. Sincroniza eventos pendentes
  await sincronizarEventos();

  return result;
}

// ============================================================================
// Sync dos lançamentos offline do Módulo 1 (despesas, abastecimentos,
// descargas). Mesmo contrato das coletas: foto sobe primeiro (path
// determinístico por client_id, upsert), depois INSERT idempotente —
// client_id é unique no servidor, então 23505 = "já subiu antes" = sucesso.
// ============================================================================

interface LancamentoBase {
  client_id: string;
  motorista_id: string;
  foto_blob: Blob | null;
  foto_subida: boolean;
  registro_subido: boolean;
  gps_pendente: boolean;
  criado_em: number;
  tentativas: number;
}

type TabelaLancamento =
  | "despesas_locais"
  | "abastecimentos_locais"
  | "descargas_locais";

async function sincronizarLancamentos<T extends LancamentoBase>(opts: {
  tabela: TabelaLancamento;
  tipo: string; // pra log e path da foto: "despesa" | "abastecimento" | "descarga"
  tabelaServidor: string;
  precisaSync: (item: T) => boolean;
  buildPayload: (item: T, fotoPath: string | null) => Record<string, unknown>;
  posInsert: ((item: T) => Promise<void>) | null;
  sessionUserId: string;
  result: SyncResult;
}): Promise<void> {
  const db = getLocalDB();
  const supabase = getSupabaseBrowser();
  const { result } = opts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tab = db[opts.tabela] as any;

  const pendentes: T[] = await tab
    .filter((i: T) => opts.precisaSync(i) && !i.gps_pendente)
    .toArray();

  result.total += pendentes.length;

  for (const item of pendentes) {
    if (item.motorista_id !== opts.sessionUserId) {
      await logEvent(item.motorista_id, "sync_skipped_wrong_motorista", {
        tipo: opts.tipo,
        client_id: item.client_id,
        item_motorista_id: item.motorista_id,
        sessao_motorista_id: opts.sessionUserId,
      });
      result.falhas++;
      continue;
    }

    try {
      // Passo 1: foto (se tem e ainda não subiu)
      let fotoPath: string | null = null;
      if (item.foto_blob) {
        fotoPath = `${item.motorista_id}/${opts.tipo}-${item.client_id}.jpg`;
        if (!item.foto_subida) {
          const { error: upErr } = await supabase.storage
            .from("fotos-coletas")
            .upload(fotoPath, item.foto_blob, {
              cacheControl: "31536000",
              upsert: true,
              contentType: "image/jpeg",
            });
          if (upErr) {
            const motivo = `upload ${opts.tipo}: ${upErr.message}`;
            await tab.update(item.client_id, {
              tentativas: (item.tentativas || 0) + 1,
              ultimo_erro: motivo,
            });
            await logEvent(item.motorista_id, "sync_failure", {
              tipo: opts.tipo,
              client_id: item.client_id,
              motivo,
              fase: "upload_foto",
            });
            result.falhas++;
            if (!result.ultimo_erro) {
              result.ultimo_erro = motivo;
              result.ultimo_erro_kind = classificarErro(motivo);
            }
            continue;
          }
          await tab.update(item.client_id, { foto_subida: true });
        }
      } else if (!item.foto_subida) {
        // sem foto (ex: descarga sem papel) — nada a subir
        await tab.update(item.client_id, { foto_subida: true });
      }

      // Passo 2: INSERT idempotente
      if (!item.registro_subido) {
        const { error: insErr } = await supabase
          .from(opts.tabelaServidor)
          .insert(opts.buildPayload(item, fotoPath));
        if (insErr && insErr.code !== "23505") {
          const motivo = `insert ${opts.tipo}: ${insErr.message}${insErr.code ? ` (${insErr.code})` : ""}`;
          await tab.update(item.client_id, {
            tentativas: (item.tentativas || 0) + 1,
            ultimo_erro: motivo,
          });
          await logEvent(item.motorista_id, "sync_failure", {
            tipo: opts.tipo,
            client_id: item.client_id,
            motivo,
            fase: "insert",
          });
          result.falhas++;
          if (!result.ultimo_erro) {
            result.ultimo_erro = motivo;
            result.ultimo_erro_kind = classificarErro(motivo);
          }
          continue;
        }
        await tab.update(item.client_id, { registro_subido: true });
      }

      // Passo 3: pós-insert (descarga fecha a carga no servidor)
      if (opts.posInsert) {
        await opts.posInsert(item);
      }

      result.enviadas++;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      await tab.update(item.client_id, {
        tentativas: (item.tentativas || 0) + 1,
        ultimo_erro: motivo,
      });
      await logEvent(item.motorista_id, "sync_failure", {
        tipo: opts.tipo,
        client_id: item.client_id,
        motivo,
      });
      result.falhas++;
      if (!result.ultimo_erro) {
        result.ultimo_erro = motivo;
        result.ultimo_erro_kind = classificarErro(motivo);
      }
    }
  }
}

async function sincronizarDespesas(
  sessionUserId: string,
  result: SyncResult
): Promise<void> {
  await sincronizarLancamentos<import("@/lib/types").DespesaLocal>({
    tabela: "despesas_locais",
    tipo: "despesa",
    tabelaServidor: "despesas",
    precisaSync: (d) => !d.registro_subido || !d.foto_subida,
    buildPayload: (d, fotoPath) => ({
      client_id: d.client_id,
      carga_id: d.carga_id,
      motorista_id: d.motorista_id,
      valor: d.valor,
      descricao: d.descricao,
      foto_path: fotoPath,
      latitude: d.latitude,
      longitude: d.longitude,
      criado_em: new Date(d.criado_em).toISOString(),
    }),
    posInsert: null,
    sessionUserId,
    result,
  });
}

async function sincronizarAbastecimentos(
  sessionUserId: string,
  result: SyncResult
): Promise<void> {
  await sincronizarLancamentos<import("@/lib/types").AbastecimentoLocal>({
    tabela: "abastecimentos_locais",
    tipo: "abastecimento",
    tabelaServidor: "abastecimentos",
    precisaSync: (a) => !a.registro_subido || !a.foto_subida,
    buildPayload: (a, fotoPath) => ({
      client_id: a.client_id,
      carga_id: a.carga_id,
      motorista_id: a.motorista_id,
      posto_nome: a.posto_nome,
      local_id: a.local_id ?? null,
      // Versões antigas do app (PWA cacheado no celular) não mandam esse
      // campo. O default do banco é true, mas mandar explícito evita que um
      // undefined vire null e quebre o NOT NULL.
      pago_na_hora: a.pago_na_hora !== false,
      // PWA antigo não manda tipo — o default do banco é diesel (0044).
      tipo: a.tipo ?? "diesel",
      litros: a.litros,
      valor: a.valor,
      km_atual: a.km_atual,
      foto_path: fotoPath,
      latitude: a.latitude,
      longitude: a.longitude,
      criado_em: new Date(a.criado_em).toISOString(),
    }),
    posInsert: null,
    sessionUserId,
    result,
  });
}

async function sincronizarDescargas(
  sessionUserId: string,
  result: SyncResult
): Promise<void> {
  await sincronizarLancamentos<import("@/lib/types").DescargaLocal>({
    tabela: "descargas_locais",
    tipo: "descarga",
    tabelaServidor: "descargas",
    // Descarga só está "pronta" quando o registro subiu E a carga foi
    // fechada no servidor — senão o servidor ainda vê a carga como ativa
    // e bloquearia a próxima carga do motorista.
    precisaSync: (d) =>
      !d.registro_subido || !d.foto_subida || !d.carga_encerrada_servidor,
    buildPayload: (d, fotoPath) => ({
      client_id: d.client_id,
      carga_id: d.carga_id,
      peso_bruto_kg: d.peso_bruto_kg,
      peso_tara_kg: d.peso_tara_kg,
      litros_estimados: d.litros_estimados,
      foto_papel_path: fotoPath,
      latitude: d.latitude,
      longitude: d.longitude,
      criado_em: new Date(d.criado_em).toISOString(),
    }),
    posInsert: async (d) => {
      if (d.carga_encerrada_servidor) return;
      const supabase = getSupabaseBrowser();
      // encerrada_em = momento REAL da descarga (não do sync).
      // km_final vem junto: é o que fecha o cálculo de km rodado e consumo.
      // 0 rows afetadas = carga já encerrada por retry anterior — sucesso.
      const { error } = await supabase
        .from("cargas")
        .update({
          status: "encerrada",
          encerrada_em: new Date(d.criado_em).toISOString(),
          ...(d.km_final ? { km_final: d.km_final } : {}),
        })
        .eq("id", d.carga_id)
        .eq("status", "ativa");
      if (error) throw new Error(`fechar carga: ${error.message}`);
      const db = getLocalDB();
      await db.descargas_locais.update(d.client_id, {
        carga_encerrada_servidor: true,
      });
    },
    sessionUserId,
    result,
  });
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
        // Módulo 1: se motorista tem features.carga ligado, coleta vai atrelada
        // à carga ativa dele. Sem features: sempre null (backward compat).
        carga_id: coleta.carga_id ?? null,
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

/**
 * Conta quantos lançamentos estão pendentes de envio — coletas, despesas,
 * abastecimentos e descargas. É o número do botão "Enviar agora".
 */
export async function countPendentes(): Promise<number> {
  const db = getLocalDB();
  const [coletas, despesas, abastecimentos, descargas] = await Promise.all([
    db.coletas_locais
      .filter((c) => (!c.registro_subido || !c.foto_subida) && !c.gps_pendente)
      .count(),
    db.despesas_locais
      .filter((d) => (!d.registro_subido || !d.foto_subida) && !d.gps_pendente)
      .count(),
    db.abastecimentos_locais
      .filter((a) => (!a.registro_subido || !a.foto_subida) && !a.gps_pendente)
      .count(),
    db.descargas_locais
      .filter(
        (d) =>
          (!d.registro_subido || !d.foto_subida || !d.carga_encerrada_servidor) &&
          !d.gps_pendente
      )
      .count(),
  ]);
  return coletas + despesas + abastecimentos + descargas;
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
  let total = 0;

  const staleColetas = await db.coletas_locais
    .filter((c) => c.gps_pendente === true && c.criado_em < cutoff)
    .toArray();
  for (const c of staleColetas) {
    await db.coletas_locais.update(c.client_id, { gps_pendente: false });
    total++;
  }

  // Mesma recuperação pras filas do Módulo 1
  const staleDespesas = await db.despesas_locais
    .filter((d) => d.gps_pendente === true && d.criado_em < cutoff)
    .toArray();
  for (const d of staleDespesas) {
    await db.despesas_locais.update(d.client_id, { gps_pendente: false });
    total++;
  }
  const staleAbast = await db.abastecimentos_locais
    .filter((a) => a.gps_pendente === true && a.criado_em < cutoff)
    .toArray();
  for (const a of staleAbast) {
    await db.abastecimentos_locais.update(a.client_id, { gps_pendente: false });
    total++;
  }
  const staleDescargas = await db.descargas_locais
    .filter((d) => d.gps_pendente === true && d.criado_em < cutoff)
    .toArray();
  for (const d of staleDescargas) {
    await db.descargas_locais.update(d.client_id, { gps_pendente: false });
    total++;
  }

  return total;
}

/**
 * Cleanup pós-sync.
 *
 * MUDOU (pedido de campo do Evaner): antes a coleta inteira era apagada 24h
 * depois de subir. O motorista abria o app no dia seguinte, via a lista
 * zerada, e voltava a anotar no papel — o controle da empresa virava
 * decoração. Agora:
 *
 *   • a FOTO (blob, ~100KB) some 24h depois de subir — é ela que ocupa
 *     espaço, e o original está no Storage;
 *   • o REGISTRO (~200 bytes) fica enquanto pertence à carga atual, pra
 *     lista "Coletas dessa carga" ter o que mostrar;
 *   • o registro só é apagado quando pertence a uma carga ANTERIOR — ou
 *     seja, depois que ele descarregou e começou outra.
 *
 * Sem carga ativa (situação de hoje, antes de features.carga ser ligada),
 * nada é apagado: não existe fronteira, e o volume real é irrelevante
 * (~9 coletas/dia × 200 bytes).
 */
const RETENCAO_APOS_SYNC_MS = 24 * 60 * 60 * 1000;

export async function limparColetasSincronizadasAntigas(
  cargaAtivaId?: string | null
): Promise<number> {
  const db = getLocalDB();
  const cutoff = Date.now() - RETENCAO_APOS_SYNC_MS;
  let total = 0;

  // 1. Libera o blob da foto, mantendo o registro.
  const comFoto = await db.coletas_locais
    .filter(
      (c) =>
        c.registro_subido === true &&
        c.foto_subida === true &&
        c.foto_blob !== null &&
        c.criado_em < cutoff
    )
    .toArray();
  for (const c of comFoto) {
    await db.coletas_locais.update(c.client_id, { foto_blob: null });
    total++;
  }

  // 2. Apaga registro de carga JÁ ENCERRADA (nunca o da carga atual, nunca
  //    o de quem ainda não usa carga).
  const deCargaAntiga = await db.coletas_locais
    .filter(
      (c) =>
        c.registro_subido === true &&
        c.foto_subida === true &&
        !!c.carga_id &&
        c.carga_id !== cargaAtivaId &&
        c.criado_em < cutoff
    )
    .toArray();
  for (const c of deCargaAntiga) {
    await db.coletas_locais.delete(c.client_id);
    total++;
  }

  // Mesma limpeza pras filas do Módulo 1 (blobs de foto não acumulam)
  const despesasAntigas = await db.despesas_locais
    .filter((d) => d.registro_subido && d.foto_subida && d.criado_em < cutoff)
    .toArray();
  for (const d of despesasAntigas) {
    await db.despesas_locais.delete(d.client_id);
    total++;
  }
  const abastAntigos = await db.abastecimentos_locais
    .filter((a) => a.registro_subido && a.foto_subida && a.criado_em < cutoff)
    .toArray();
  for (const a of abastAntigos) {
    await db.abastecimentos_locais.delete(a.client_id);
    total++;
  }
  const descargasAntigas = await db.descargas_locais
    .filter(
      (d) =>
        d.registro_subido &&
        d.foto_subida &&
        d.carga_encerrada_servidor &&
        d.criado_em < cutoff
    )
    .toArray();
  for (const d of descargasAntigas) {
    await db.descargas_locais.delete(d.client_id);
    total++;
  }

  return total;
}
