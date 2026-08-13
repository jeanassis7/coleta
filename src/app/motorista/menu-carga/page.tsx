"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getCargaAtivaCached, clearCargaAtivaCached } from "@/lib/motorista/carga";
import { logEvent } from "@/lib/events/log";
import type { CargaAtivaCache } from "@/lib/types";

export default function MenuCargaPage() {
  const router = useRouter();
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [podeCancelar, setPodeCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    if (!id) {
      router.push("/motorista");
      return;
    }
    setMotoristaId(id);

    const c = getCargaAtivaCached();
    if (!c) {
      router.push("/motorista");
      return;
    }
    setCarga(c);

    // Verifica se ainda pode cancelar (sem coletas, sem despesas, sem abast)
    (async () => {
      const supabase = getSupabaseBrowser();
      try {
        const [{ count: nc }, { count: nd }, { count: na }] = await Promise.all([
          supabase
            .from("coletas")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", c.id),
          supabase
            .from("despesas")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", c.id),
          supabase
            .from("abastecimentos")
            .select("id", { count: "exact", head: true })
            .eq("carga_id", c.id),
        ]);
        // Também checa Dexie local
        const { getLocalDB } = await import("@/lib/db/dexie");
        const db = getLocalDB();
        const coletasLocais = await db.coletas_locais
          .where("carga_id")
          .equals(c.id)
          .count();
        const total = (nc ?? 0) + (nd ?? 0) + (na ?? 0) + coletasLocais;
        setPodeCancelar(total === 0);
      } catch {
        setPodeCancelar(false);
      }
    })();
  }, [router]);

  async function cancelarCarga() {
    if (!carga || !motoristaId) return;
    if (
      !confirm(
        "Cancelar essa carga? Você vai precisar iniciar uma nova pra continuar."
      )
    )
      return;
    setCancelando(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("cargas")
        .update({ status: "cancelada" })
        .eq("id", carga.id)
        .eq("status", "ativa"); // check atomic
      if (error) {
        alert("Erro ao cancelar: " + error.message);
        return;
      }
      await logEvent(motoristaId, "carga_cancelada", { carga_id: carga.id });
      clearCargaAtivaCached();
      router.push("/motorista");
    } finally {
      setCancelando(false);
    }
  }

  if (!carga) return null;

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <header className="flex items-center mb-6 mt-2">
        <button
          onClick={() => router.back()}
          className="text-cinza-suave text-lg p-2 -ml-2"
        >
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold ml-2">Menu carga</h1>
      </header>

      <div className="text-sm text-cinza-suave mb-4">
        🚚 {carga.caminhao_placa} {carga.caminhao_marca} {carga.caminhao_cor}
      </div>

      <div className="space-y-3">
        <Link href="/motorista/descarregar" className="block">
          <div className="bg-red-500 rounded-2xl p-6 text-center shadow active:bg-red-600 transition-colors">
            <p className="text-white text-xl font-bold">🏁 DESCARREGAR</p>
          </div>
        </Link>

        <Link href="/motorista/abastecimento" className="block">
          <div className="bg-slate-800 rounded-2xl p-6 text-center shadow active:bg-slate-900 transition-colors">
            <p className="text-white text-xl font-bold">⛽ ABASTECIMENTO</p>
          </div>
        </Link>

        <Link href="/motorista/despesa" className="block">
          <div className="bg-slate-800 rounded-2xl p-6 text-center shadow active:bg-slate-900 transition-colors">
            <p className="text-white text-xl font-bold">💵 DESPESAS</p>
          </div>
        </Link>

        {podeCancelar && (
          <button
            onClick={cancelarCarga}
            disabled={cancelando}
            className="w-full bg-white rounded-2xl p-6 text-center shadow border-2 border-cinza-borda active:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <p className="text-slate-700 text-lg font-medium">
              {cancelando ? "Cancelando..." : "✗ Cancelar carga"}
            </p>
            <p className="text-xs text-cinza-suave mt-1">
              Só disponível porque não tem coleta nem despesa vinculada
            </p>
          </button>
        )}

        <button
          onClick={() => router.push("/motorista")}
          className="w-full bg-slate-100 rounded-2xl p-6 text-center active:bg-slate-200 transition-colors"
        >
          <p className="text-slate-700 text-lg font-medium">← VOLTAR</p>
        </button>
      </div>
    </main>
  );
}
