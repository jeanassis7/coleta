"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getCargaAtivaCached } from "@/lib/motorista/carga";
import { captureGPS } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import { parseLitros, parseValorInteiro } from "@/lib/format";
import type { CargaAtivaCache } from "@/lib/types";

const LAST_KM_KEY_PREFIX = "coleta_ultimo_km_";

export default function AbastecimentoPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [postoNome, setPostoNome] = useState("");
  const [litrosTexto, setLitrosTexto] = useState("");
  const [valorTexto, setValorTexto] = useState("");
  const [kmTexto, setKmTexto] = useState("");
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
    // Sugere último km conhecido daquele caminhão
    const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + c.caminhao_id);
    if (kmSug) setKmTexto(kmSug);
  }, [router]);

  const litros = parseLitros(litrosTexto);
  const valor = parseValorInteiro(valorTexto);
  const km = Number(kmTexto);
  const podeSalvar =
    !!motoristaId &&
    !!carga &&
    postoNome.trim().length >= 3 &&
    litros !== null &&
    litros > 0 &&
    valor !== null &&
    valor > 0 &&
    Number.isFinite(km) &&
    km > 0 &&
    foto !== null &&
    !salvando;

  async function salvar() {
    if (
      !podeSalvar ||
      !motoristaId ||
      !carga ||
      litros === null ||
      valor === null ||
      !foto
    )
      return;
    if (!navigator.onLine) {
      setErro("Precisa de sinal pra lançar abastecimento. Tenta quando pegar sinal.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const supabase = getSupabaseBrowser();
      const gps = await captureGPS();
      const path = `${motoristaId}/abast-${Date.now()}.jpg`;
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
      const { error: insErr } = await supabase.from("abastecimentos").insert({
        carga_id: carga.id,
        motorista_id: motoristaId,
        posto_nome: postoNome.trim(),
        litros,
        valor,
        km_atual: Math.round(km),
        foto_path: path,
        latitude: gps.ok ? gps.latitude : null,
        longitude: gps.ok ? gps.longitude : null,
      });
      if (insErr) {
        setErro("Não consegui salvar: " + insErr.message);
        return;
      }
      localStorage.setItem(LAST_KM_KEY_PREFIX + carga.caminhao_id, String(Math.round(km)));
      await logEvent(motoristaId, "abastecimento_saved_local", {
        carga_id: carga.id,
        posto_nome: postoNome.trim(),
        litros,
        valor,
        km_atual: Math.round(km),
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
        <h1 className="text-2xl font-bold ml-2">Abastecimento</h1>
      </header>

      <div className="space-y-6">
        <div>
          <label className="block text-xl font-semibold mb-3">
            ⛽ Nome do posto
          </label>
          <input
            type="text"
            className="input-grande"
            value={postoNome}
            onChange={(e) => setPostoNome(e.target.value)}
            placeholder="ex: Ipiranga Cascavel"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            💧 Litros
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="input-grande text-2xl"
            value={litrosTexto}
            onChange={(e) => setLitrosTexto(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            💰 Valor total (R$)
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="input-grande text-2xl"
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            📍 Km atual
          </label>
          <input
            type="number"
            inputMode="numeric"
            className="input-grande text-2xl"
            value={kmTexto}
            onChange={(e) => setKmTexto(e.target.value)}
          />
        </div>

        {motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              📷 Foto do cupom
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
          {salvando ? "Salvando..." : "✅ SALVAR ABASTECIMENTO"}
        </button>
      </div>
    </main>
  );
}
