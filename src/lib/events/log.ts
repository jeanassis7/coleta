"use client";

import { v4 as uuid } from "uuid";
import { getLocalDB } from "@/lib/db/dexie";
import { getDeviceId, getSessionId, APP_VERSION } from "@/lib/device/device-id";
import type { EventType, EventoLocal } from "@/lib/types";

/**
 * Adiciona evento na fila local. Envio acontece via sync queue.
 * Não faz network — só grava em IndexedDB.
 */
export async function logEvent(
  motoristaId: string | null,
  event_type: EventType,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const db = getLocalDB();
    const evento: EventoLocal = {
      id: uuid(),
      motorista_id: motoristaId,
      event_type,
      payload,
      session_id: getSessionId(),
      device_id: getDeviceId(),
      app_version: APP_VERSION,
      criado_em: Date.now(),
      enviado: false,
    };
    await db.eventos_locais.add(evento);
  } catch (err) {
    console.error("[logEvent] erro ao gravar:", err);
  }
}
