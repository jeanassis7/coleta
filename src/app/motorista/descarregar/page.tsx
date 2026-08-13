"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { getLocalDB } from "@/lib/db/dexie";
import {
  getCargaAtivaCached,
  clearCargaAtivaCached,
  resumoCargaAtiva,
  type ResumoCarga,
} from "@/lib/motorista/carga";
import { captureGPS, type GpsResult } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { triggerSyncAfterSave } from "@/lib/sync/trigger";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import type { CargaAtivaCache, DescargaLocal } from "@/lib/types";

const DENSIDADE_KG_POR_L = 0.9;

/**
 * Offline-first: a descarga salva no IndexedDB e a carga encerra
 * LOCALMENTE na hora (motorista segue a vida). O sync envia a descarga
 * e fecha a carga no servidor quando houver sinal.
 */
export default function DescarregarPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [resumo, setResumo] = useState<ResumoCarga>({ litros: 0, coletas: 0 });
  const [salvando, setSalvando] = useState(false);

  const [pesoBrutoTexto, setPesoBrutoTexto] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [gpsResultado, setGpsResultado] = useState<GpsResult | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    if (!id) {
      router.push("/motorista");
      return;
    }
    setMotoristaId(id);
    const c = getCargaAtivaCached(id);
    if (!c) {
      router.push("/motorista");
      return;
    }
    setCarga(c);
    resumoCargaAtiva(c.id, id).then(setResumo);
  }, [router]);

  useEffect(() => {
    if (!motoristaId) return;
    let cancelado = false;
    captureGPS().then((r) => {
      if (!cancelado) setGpsResultado(r);
    });
    return () => {
      cancelado = true;
    };
  }, [motoristaId]);

  const pesoBruto = Number(pesoBrutoTexto);
  const pesoDigitado = pesoBrutoTexto.trim() !== "" && Number.isFinite(pesoBruto);
  const pesoLiquidoKg = pesoDigitado && carga ? pesoBruto - carga.tara_kg : 0;
  const pesoMenorQueTara = pesoDigitado && carga !== null && pesoLiquidoKg <= 0;
  const litrosEstimados =
    pesoLiquidoKg > 0 ? Math.round(pesoLiquidoKg / DENSIDADE_KG_POR_L) : 0;

  const podeSalvar =
    !!carga && !!motoristaId && pesoDigitado && pesoLiquidoKg > 0 && !salvando;

  async function salvar() {
    if (!podeSalvar || !carga || !motoristaId) return;

    // Antiburro 1: carga sem nenhuma coleta lançada
    if (resumo.coletas === 0) {
      const confirma = confirm(
        "Essa carga não tem NENHUMA coleta lançada. Descarregar mesmo assim?"
      );
      if (!confirma) return;
    }

    // Antiburro 2: peso ±30% do esperado pelas coletas declaradas
    if (resumo.litros > 0) {
      const pesoEsperado = resumo.litros * DENSIDADE_KG_POR_L;
      const diff = Math.abs(pesoLiquidoKg - pesoEsperado) / pesoEsperado;
      if (diff > 0.3) {
        const confirma = confirm(
          `Peso líquido: ${pesoLiquidoKg.toLocaleString("pt-BR")} kg\n` +
            `Esperado pelas coletas (${resumo.litros.toLocaleString("pt-BR")}L × 0,9): ~${Math.round(pesoEsperado).toLocaleString("pt-BR")} kg\n` +
            `Diferença: ${Math.round(diff * 100)}%\n\n` +
            `Confere o peso?`
        );
        if (!confirma) return;
      }
    }

    setSalvando(true);

    const client_id = uuid();
    const gpsJa = gpsResultado;
    const descarga: DescargaLocal = {
      client_id,
      motorista_id: motoristaId,
      carga_id: carga.id,
      peso_bruto_kg: Math.round(pesoBruto),
      peso_tara_kg: carga.tara_kg,
      litros_estimados: litrosEstimados,
      latitude: gpsJa?.ok ? gpsJa.latitude : null,
      longitude: gpsJa?.ok ? gpsJa.longitude : null,
      gps_pendente: gpsJa === null,
      criado_em: Date.now(),
      foto_blob: foto,
      foto_subida: false,
      registro_subido: false,
      carga_encerrada_servidor: false,
      tentativas: 0,
      ultimo_erro: null,
    };

    const db = getLocalDB();
    await db.descargas_locais.add(descarga);

    await logEvent(motoristaId, "descarga_saved_local", {
      client_id,
      carga_id: carga.id,
      peso_bruto_kg: descarga.peso_bruto_kg,
      peso_tara_kg: descarga.peso_tara_kg,
      peso_liquido_kg: pesoLiquidoKg,
      litros_estimados: litrosEstimados,
      litros_declarados: resumo.litros,
      coletas_na_carga: resumo.coletas,
      tem_foto: !!foto,
      gps_ja_resolvido: gpsJa !== null,
    });
    await logEvent(motoristaId, "carga_encerrada", { carga_id: carga.id });

    // Carga encerrada LOCALMENTE — home volta pra "Iniciar nova carga".
    clearCargaAtivaCached();

    router.push(
      `/motorista/carga-encerrada?peso_bruto=${descarga.peso_bruto_kg}` +
        `&tara=${descarga.peso_tara_kg}&liquido=${pesoLiquidoKg}` +
        `&litros=${litrosEstimados}&coletas=${resumo.coletas}` +
        `&iniciada=${encodeURIComponent(carga.iniciada_em)}`
    );

    if (!gpsJa) {
      (async () => {
        const gps = await captureGPS();
        await db.descargas_locais.update(client_id, {
          latitude: gps.ok ? gps.latitude : null,
          longitude: gps.ok ? gps.longitude : null,
          gps_pendente: false,
        });
        triggerSyncAfterSave();
      })();
    } else {
      triggerSyncAfterSave();
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
          <div>
            🚚 {carga.caminhao_placa} {carga.caminhao_marca} {carga.caminhao_cor}
          </div>
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
          {pesoMenorQueTara && (
            <div className="mt-3 bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-base font-medium">
              Peso bruto menor que a tara ({carga.tara_kg.toLocaleString("pt-BR")}{" "}
              kg) — confira o número.
            </div>
          )}
          {pesoLiquidoKg > 0 && (
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
