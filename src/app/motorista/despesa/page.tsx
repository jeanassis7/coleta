"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getCargaAtivaCached } from "@/lib/motorista/carga";
import { captureGPS } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import { parseValorInteiro } from "@/lib/format";
import type { CargaAtivaCache } from "@/lib/types";

export default function DespesaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [valorTexto, setValorTexto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);

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
  }, [router]);

  const valor = parseValorInteiro(valorTexto);
  const podeSalvar =
    !!motoristaId &&
    !!carga &&
    valor !== null &&
    valor > 0 &&
    descricao.trim().length >= 3 &&
    foto !== null &&
    !salvando;

  async function salvar() {
    if (!podeSalvar || !motoristaId || !carga || valor === null || !foto) return;
    if (!navigator.onLine) {
      setErro("Precisa de sinal pra lançar despesa. Tenta quando pegar sinal.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const supabase = getSupabaseBrowser();
      const gps = await captureGPS();
      const path = `${motoristaId}/despesa-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("fotos-coletas")
        .upload(path, foto, {
          cacheControl: "31536000",
          upsert: true,
          contentType: "image/jpeg",
        });
      if (upErr) {
        setErro("Não consegui subir a foto: " + upErr.message);
        return;
      }
      const { error: insErr } = await supabase.from("despesas").insert({
        carga_id: carga.id,
        motorista_id: motoristaId,
        valor,
        descricao: descricao.trim(),
        foto_path: path,
        latitude: gps.ok ? gps.latitude : null,
        longitude: gps.ok ? gps.longitude : null,
      });
      if (insErr) {
        setErro("Não consegui salvar: " + insErr.message);
        return;
      }
      await logEvent(motoristaId, "despesa_saved_local", {
        carga_id: carga.id,
        valor,
        descricao: descricao.trim(),
      });
      router.push("/motorista");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSalvando(false);
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
        <h1 className="text-2xl font-bold ml-2">Nova despesa</h1>
      </header>

      <div className="space-y-6">
        <div>
          <label className="block text-xl font-semibold mb-3">
            💰 Valor (R$)
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="input-grande text-2xl"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            placeholder=""
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            ✏️ Descrição
          </label>
          <input
            type="text"
            className="input-grande"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="ex: almoço Foz"
            required
          />
        </div>

        {motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              📷 Foto do comprovante
              <span className="block text-sm text-cinza-suave font-normal mt-1">
                Obrigatória
              </span>
            </label>
            <FotoPicker onChange={setFoto} motoristaId={motoristaId} />
          </div>
        )}

        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-2xl p-4 text-center text-lg font-medium">
            {erro}
          </div>
        )}

        <button
          onClick={salvar}
          disabled={!podeSalvar}
          className="btn-primario text-2xl"
        >
          {salvando ? "Salvando..." : "✅ SALVAR DESPESA"}
        </button>
      </div>
    </main>
  );
}
