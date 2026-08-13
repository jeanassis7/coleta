"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  getCargaAtivaCached,
  clearCargaAtivaCached,
  somaLitrosCargaAtiva,
} from "@/lib/motorista/carga";
import { captureGPS } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import type { CargaAtivaCache } from "@/lib/types";

const DENSIDADE_KG_POR_L = 0.9;

export default function DescarregarPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [litrosEsperados, setLitrosEsperados] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [pesoBrutoTexto, setPesoBrutoTexto] = useState("");
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
    somaLitrosCargaAtiva(c.id, id).then(setLitrosEsperados);
  }, [router]);

  const pesoBruto = Number(pesoBrutoTexto);
  const pesoLiquidoKg =
    Number.isFinite(pesoBruto) && carga ? pesoBruto - carga.tara_kg : 0;
  const litrosEstimados =
    pesoLiquidoKg > 0 ? Math.round(pesoLiquidoKg / DENSIDADE_KG_POR_L) : 0;

  const pesoOk = pesoLiquidoKg > 0;
  const podeSalvar = !!carga && !!motoristaId && pesoOk && !salvando;

  async function salvar() {
    if (!podeSalvar || !carga || !motoristaId) return;
    if (!navigator.onLine) {
      setErro("Precisa de sinal pra registrar descarga. Tenta quando pegar sinal.");
      return;
    }

    // Antiburro: peso ±30% do esperado (soma_litros × densidade)
    if (litrosEsperados > 0) {
      const pesoEsperado = litrosEsperados * DENSIDADE_KG_POR_L;
      const diff = Math.abs(pesoLiquidoKg - pesoEsperado) / pesoEsperado;
      if (diff > 0.3) {
        const confirma = confirm(
          `Peso líquido: ${pesoLiquidoKg} kg\n` +
            `Esperado pelas coletas (${litrosEsperados}L × 0,9): ~${Math.round(pesoEsperado)} kg\n` +
            `Diferença: ${Math.round(diff * 100)}%\n\n` +
            `Confere o peso?`
        );
        if (!confirma) return;
      }
    }

    setErro(null);
    setSalvando(true);
    try {
      const supabase = getSupabaseBrowser();
      const gps = await captureGPS();

      let foto_papel_path: string | null = null;
      if (foto) {
        const path = `${motoristaId}/descarga-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("fotos-coletas")
          .upload(path, foto, {
            cacheControl: "31536000",
            upsert: true,
            contentType: "image/jpeg",
          });
        if (!upErr) foto_papel_path = path;
      }

      const { error: insErr } = await supabase.from("descargas").insert({
        carga_id: carga.id,
        peso_bruto_kg: Math.round(pesoBruto),
        peso_tara_kg: carga.tara_kg,
        litros_estimados: litrosEstimados,
        foto_papel_path,
        latitude: gps.ok ? gps.latitude : null,
        longitude: gps.ok ? gps.longitude : null,
      });
      if (insErr) {
        setErro("Não consegui salvar descarga: " + insErr.message);
        return;
      }

      // Fecha a carga (atomic check pra não pisar em cancelada por outro caminho)
      const { error: updErr } = await supabase
        .from("cargas")
        .update({ status: "encerrada", encerrada_em: new Date().toISOString() })
        .eq("id", carga.id)
        .eq("status", "ativa");
      if (updErr) {
        setErro("Descarga salva mas não fechei carga: " + updErr.message);
        return;
      }

      await logEvent(motoristaId, "descarga_saved_local", {
        carga_id: carga.id,
        peso_bruto_kg: Math.round(pesoBruto),
        peso_tara_kg: carga.tara_kg,
        peso_liquido_kg: pesoLiquidoKg,
        litros_estimados: litrosEstimados,
        litros_declarados: litrosEsperados,
        tem_foto: !!foto,
      });

      await logEvent(motoristaId, "carga_encerrada", {
        carga_id: carga.id,
      });

      clearCargaAtivaCached();
      router.push(
        `/motorista/carga-encerrada?peso_bruto=${Math.round(pesoBruto)}` +
          `&tara=${carga.tara_kg}&liquido=${pesoLiquidoKg}` +
          `&litros=${litrosEstimados}&iniciada=${encodeURIComponent(carga.iniciada_em)}`
      );
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
        <h1 className="text-2xl font-bold ml-2">Descarregar carga</h1>
      </header>

      <div className="space-y-6">
        <div className="bg-slate-50 border border-cinza-borda rounded-2xl p-3 text-sm">
          <div>🚚 {carga.caminhao_placa} {carga.caminhao_marca} {carga.caminhao_cor}</div>
          <div className="text-cinza-suave">
            Tara: {carga.tara_kg.toLocaleString("pt-BR")} kg
          </div>
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            ⚖️ Peso bruto (kg)
          </label>
          <input
            type="number"
            inputMode="numeric"
            className="input-grande text-2xl"
            value={pesoBrutoTexto}
            onChange={(e) => setPesoBrutoTexto(e.target.value)}
            autoFocus
          />
          {pesoOk && (
            <div className="mt-3 bg-slate-50 border border-cinza-borda rounded-xl p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Peso líquido:</span>
                <span className="font-mono font-semibold">
                  {pesoLiquidoKg.toLocaleString("pt-BR")} kg
                </span>
              </div>
              <div className="flex justify-between text-cinza-suave">
                <span>Estimativa:</span>
                <span className="font-mono">
                  ≈ {litrosEstimados.toLocaleString("pt-BR")} L
                </span>
              </div>
            </div>
          )}
        </div>

        {motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              📷 Foto do papel da balança
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
          {salvando ? "Salvando..." : "✅ CONFIRMAR DESCARGA"}
        </button>
      </div>
    </main>
  );
}
