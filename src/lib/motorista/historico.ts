"use client";

import { getLocalDB } from "@/lib/db/dexie";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { ColetaLocal } from "@/lib/types";

/**
 * Reabastece o histórico local a partir do servidor.
 *
 * A tela do motorista continua lendo SÓ do IndexedDB — é isso que faz ela
 * abrir sem sinal, e essa regra não muda. O que esta função faz é o
 * caminho contrário: quando há sinal, traz do banco o que falta no celular.
 *
 * Resolve três coisas que só o banco sabe:
 *   • celular novo ou app reinstalado — o histórico volta sozinho
 *   • coleta apagada no painel pelo Jean — some da lista dele também
 *   • coletas antigas apagadas pela regra de retenção anterior
 *
 * NUNCA toca em coleta que ainda não subiu: o que está na fila é a única
 * cópia que existe daquele dado.
 */
export async function reabastecerHistoricoLocal(
  motoristaId: string,
  cargaId: string | null
): Promise<{ adicionadas: number; removidas: number }> {
  const vazio = { adicionadas: 0, removidas: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) return vazio;

  const supabase = getSupabaseBrowser();
  const db = getLocalDB();

  // getSession() é local — getUser() faria chamada de rede e quebraria o
  // offline-first (regra dura do projeto).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return vazio;

  let q = supabase
    .from("coletas")
    .select(
      "client_id, litros, local_nome, local_id, valor_pago, certificado_tipo, litros_certificado, observacao, latitude, longitude, foto_path, criado_em, carga_id"
    )
    .eq("motorista_id", motoristaId)
    .order("criado_em", { ascending: false })
    .limit(500);

  // Com carga, a fronteira é ela. Sem carga (antes de features.carga ser
  // ligada), traz o que existe — é temporário e o volume é pequeno.
  if (cargaId) q = q.eq("carga_id", cargaId);

  const { data, error } = await q;
  if (error || !data) return vazio;

  type Row = {
    client_id: string | null;
    litros: number;
    local_nome: string;
    local_id: string | null;
    valor_pago: number;
    certificado_tipo: string;
    litros_certificado: number | null;
    observacao: string | null;
    latitude: number | null;
    longitude: number | null;
    foto_path: string | null;
    criado_em: string;
    carga_id: string | null;
  };
  const linhas = (data as Row[]).filter((r) => !!r.client_id);
  const idsServidor = new Set(linhas.map((r) => r.client_id as string));

  const locais = await db.coletas_locais
    .filter((c) => c.motorista_id === motoristaId)
    .toArray();
  const idsLocais = new Set(locais.map((c) => c.client_id));

  let adicionadas = 0;
  for (const r of linhas) {
    if (idsLocais.has(r.client_id as string)) continue;
    const coleta: ColetaLocal = {
      client_id: r.client_id as string,
      litros: Number(r.litros),
      local_nome: r.local_nome,
      local_id: r.local_id,
      valor_pago: Number(r.valor_pago),
      certificado_tipo: (r.certificado_tipo || "nao") as ColetaLocal["certificado_tipo"],
      litros_certificado: r.litros_certificado,
      observacao: r.observacao,
      latitude: r.latitude,
      longitude: r.longitude,
      gps_accuracy: null,
      gps_capturado: r.latitude !== null,
      device_id: "servidor",
      session_id: "servidor",
      app_version: "servidor",
      motorista_id: motoristaId,
      criado_em: new Date(r.criado_em).getTime(),
      // A foto fica no Storage. O celular guarda só o registro — o blob é
      // o que pesa, e ele já foi enviado.
      foto_blob: null,
      foto_subida: true,
      registro_subido: true,
      gps_pendente: false,
      tentativas: 0,
      ultimo_erro: null,
      carga_id: r.carga_id,
    };
    await db.coletas_locais.put(coleta);
    adicionadas++;
  }

  // Sumiu do servidor = o Jean apagou no painel. Só remove o que já tinha
  // subido; o que está na fila é a única cópia existente.
  let removidas = 0;
  const noEscopo = cargaId
    ? locais.filter((c) => c.carga_id === cargaId)
    : locais;
  for (const c of noEscopo) {
    if (c.registro_subido && c.foto_subida && !idsServidor.has(c.client_id)) {
      await db.coletas_locais.delete(c.client_id);
      removidas++;
    }
  }

  return { adicionadas, removidas };
}
