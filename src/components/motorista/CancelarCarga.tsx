"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { clearCargaAtivaCached } from "@/lib/motorista/carga";
import { logEvent } from "@/lib/events/log";
import type { CargaAtivaCache } from "@/lib/types";

/**
 * Botão "Cancelar carga" da home. Só aparece se a carga NÃO tem nenhum
 * lançamento (coleta/despesa/abastecimento, servidor + filas locais) —
 * senão o caminho certo é descarregar.
 */
export function CancelarCarga({
  carga,
  motoristaId,
  onCancelada,
}: {
  carga: CargaAtivaCache;
  motoristaId: string;
  onCancelada: () => void;
}) {
  const [podeCancelar, setPodeCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  // Confirmação em duas etapas no próprio app — sem confirm() do navegador
  const [confirmandoEtapa, setConfirmandoEtapa] = useState(false);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const supabase = getSupabaseBrowser();
      try {
        const [{ count: nc }, { count: nd }, { count: na }] = await Promise.all([
          supabase
            .from("coletas")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", carga.id),
          supabase
            .from("despesas")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", carga.id),
          supabase
            .from("abastecimentos")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", carga.id),
        ]);
        const { getLocalDB } = await import("@/lib/db/dexie");
        const db = getLocalDB();
        const [coletasLocais, despesasLocais, abastLocais] = await Promise.all([
          db.coletas_locais.where("carga_id").equals(carga.id).count(),
          db.despesas_locais.where("carga_id").equals(carga.id).count(),
          db.abastecimentos_locais.where("carga_id").equals(carga.id).count(),
        ]);
        const total =
          (nc ?? 0) + (nd ?? 0) + (na ?? 0) +
          coletasLocais + despesasLocais + abastLocais;
        if (ativo) setPodeCancelar(total === 0);
      } catch {
        if (ativo) setPodeCancelar(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [carga.id]);

  async function cancelar() {
    setCancelando(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("cargas")
        .update({ status: "cancelada" })
        .eq("id", carga.id)
        .eq("status", "ativa");
      if (error) {
        alert("Erro ao cancelar: " + error.message);
        return;
      }
      await logEvent(motoristaId, "carga_cancelada", { carga_id: carga.id });
      clearCargaAtivaCached();
      onCancelada();
    } finally {
      setCancelando(false);
    }
  }

  if (!podeCancelar) return null;

  if (confirmandoEtapa) {
    return (
      <div className="bg-white rounded-2xl p-5 border-2 border-alerta mb-4 space-y-3">
        <p className="text-center text-lg font-medium">
          Cancelar essa carga?
          <span className="block text-base text-cinza-suave mt-1">
            Você vai precisar iniciar uma nova pra continuar.
          </span>
        </p>
        <button
          onClick={cancelar}
          disabled={cancelando}
          className="w-full bg-alerta text-white rounded-2xl p-4 text-lg font-bold disabled:opacity-50"
        >
          {cancelando ? "Cancelando..." : "✗ SIM, CANCELAR"}
        </button>
        <button
          onClick={() => setConfirmandoEtapa(false)}
          disabled={cancelando}
          className="w-full bg-slate-100 text-slate-700 rounded-2xl p-4 text-lg font-medium border border-cinza-borda disabled:opacity-50"
        >
          ← VOLTAR
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirmandoEtapa(true)}
      className="w-full bg-white rounded-2xl p-5 text-center border-2 border-cinza-borda active:bg-slate-50 transition-colors mb-4"
    >
      <p className="text-slate-700 text-lg font-bold">✗ CANCELAR CARGA</p>
      <p className="text-xs text-cinza-suave mt-1">
        CANCELE EM CASO DE ERRAR O CAMINHÃO OU O KM INICIAL
      </p>
    </button>
  );
}
