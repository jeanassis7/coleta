"use client";

import { useEffect, useState, useCallback } from "react";
import { getCargaAtivaCached } from "@/lib/motorista/carga";
import {
  runSync,
  countPendentes,
  limparGpsPendenteStale,
  limparColetasSincronizadasAntigas,
  type SyncResult,
} from "@/lib/sync/queue";

let inFlight = false;
let rerunPedido = false;

/** Evento que a UI escuta pra atualizar o contador de pendentes. */
export const EVENTO_SYNC_FINALIZADO = "coleta-sync-finalizado";

async function umaRodada(): Promise<SyncResult> {
  await limparGpsPendenteStale();
  const result = await runSync();
  // Depois do sync: libera o blob da foto e apaga só o que é de carga
  // ANTERIOR. O registro da carga atual fica — é o que a lista "Coletas
  // dessa carga" mostra, e foi apagá-lo que fez o motorista voltar pro papel.
  const motoristaId =
    typeof window !== "undefined"
      ? sessionStorage.getItem("coleta_motorista_id")
      : null;
  const cargaAtiva = motoristaId ? getCargaAtivaCached(motoristaId) : null;
  await limparColetasSincronizadasAntigas(cargaAtiva?.id ?? null);
  return result;
}

async function safeSync(): Promise<SyncResult> {
  if (inFlight) {
    // Já tem sync rodando. Um lançamento recém-salvo pode ter entrado na
    // fila DEPOIS do sync em curso começar — sem isso ele ficava "1
    // pendente" esperando o próximo gatilho (bug real de campo).
    rerunPedido = true;
    return { total: 0, enviadas: 0, falhas: 0 };
  }
  inFlight = true;
  try {
    let result = await umaRodada();
    while (rerunPedido) {
      rerunPedido = false;
      result = await umaRodada();
    }
    return result;
  } finally {
    inFlight = false;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(EVENTO_SYNC_FINALIZADO));
    }
  }
}

/**
 * Hook que registra os triggers de sync sem polling.
 * Dispara em: mount (se online), evento 'online', visibilitychange visible (se online).
 */
export function useSyncTriggers() {
  const [pendentes, setPendentes] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const refreshCount = useCallback(async () => {
    try {
      const n = await countPendentes();
      setPendentes(n);
    } catch {
      // db pode não estar pronto na primeira render
    }
  }, []);

  useEffect(() => {
    refreshCount();

    let mounted = true;

    const trySync = async () => {
      if (typeof navigator === "undefined" || !navigator.onLine) return;
      await safeSync();
      if (mounted) await refreshCount();
    };

    trySync();

    const onOnline = () => {
      setOnline(true);
      trySync();
    };
    const onOffline = () => setOnline(false);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        trySync();
      }
    };

    // Sempre que QUALQUER ciclo de sync termina (inclusive o disparado em
    // background após salvar), atualiza o contador de pendentes na tela.
    const onSyncFinalizado = () => {
      if (mounted) refreshCount();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(EVENTO_SYNC_FINALIZADO, onSyncFinalizado);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(EVENTO_SYNC_FINALIZADO, onSyncFinalizado);
    };
  }, [refreshCount]);

  return { pendentes, online, refresh: refreshCount };
}

/**
 * Dispara sync manual (botão "Enviar agora"). Retorna resultado completo
 * com motivo do último erro pra UI mostrar.
 */
export async function manualSync(): Promise<SyncResult> {
  return safeSync();
}

/**
 * Dispara sync após salvar uma nova coleta — non-blocking.
 */
export function triggerSyncAfterSave() {
  if (typeof navigator !== "undefined" && navigator.onLine) {
    safeSync();
  }
}
