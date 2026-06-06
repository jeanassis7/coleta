"use client";

import { useEffect, useState, useCallback } from "react";
import { runSync, countPendentes } from "@/lib/sync/queue";

let inFlight = false;

async function safeSync() {
  if (inFlight) return { total: 0, enviadas: 0, falhas: 0 };
  inFlight = true;
  try {
    return await runSync();
  } finally {
    inFlight = false;
  }
}

/**
 * Hook que registra os triggers de sync sem polling.
 * Dispara em: mount (se online), evento 'online', visibilitychange visible (se online).
 * Atualiza contador de pendentes em IndexedDB → re-render.
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

    // 1. Trigger inicial
    trySync();

    // 2. Trigger no evento online
    const onOnline = () => {
      setOnline(true);
      trySync();
    };
    const onOffline = () => setOnline(false);

    // 3. Trigger no visibilitychange visible
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        trySync();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshCount]);

  return { pendentes, online, refresh: refreshCount };
}

/**
 * Dispara sync manual (botão "Enviar agora"). Retorna resultado.
 * Debounce de 10s — implementado pelo caller via state.
 */
export async function manualSync(): Promise<{
  total: number;
  enviadas: number;
  falhas: number;
}> {
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
