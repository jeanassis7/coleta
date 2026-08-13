"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { getLocalDB } from "@/lib/db/dexie";
import { getCargaAtivaCached } from "@/lib/motorista/carga";
import { captureGPS, type GpsResult } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { triggerSyncAfterSave } from "@/lib/sync/trigger";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import { parseLitros } from "@/lib/format";
import type { CargaAtivaCache, AbastecimentoLocal } from "@/lib/types";

const LAST_KM_KEY_PREFIX = "coleta_ultimo_km_";

/**
 * Offline-first: salva no IndexedDB e sincroniza quando houver sinal.
 */
export default function AbastecimentoPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [postoNome, setPostoNome] = useState("");
  const [litrosTexto, setLitrosTexto] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [kmTexto, setKmTexto] = useState("");
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
    const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + c.caminhao_id);
    if (kmSug) setKmTexto(kmSug);
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

  const litros = parseLitros(litrosTexto);
  const km = Number(kmTexto);
  const podeSalvar =
    !!motoristaId &&
    !!carga &&
    postoNome.trim().length >= 3 &&
    litros !== null &&
    litros > 0 &&
    valorCentavos !== null &&
    valorCentavos > 0 &&
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
      valorCentavos === null ||
      !foto
    )
      return;
    setSalvando(true);

    const valor = centavosParaReais(valorCentavos);
    const client_id = uuid();
    const gpsJa = gpsResultado;
    const abastecimento: AbastecimentoLocal = {
      client_id,
      motorista_id: motoristaId,
      carga_id: carga.id,
      posto_nome: postoNome.trim(),
      litros,
      valor,
      km_atual: Math.round(km),
      latitude: gpsJa?.ok ? gpsJa.latitude : null,
      longitude: gpsJa?.ok ? gpsJa.longitude : null,
      gps_pendente: gpsJa === null,
      criado_em: Date.now(),
      foto_blob: foto,
      foto_subida: false,
      registro_subido: false,
      tentativas: 0,
      ultimo_erro: null,
    };

    const db = getLocalDB();
    await db.abastecimentos_locais.add(abastecimento);
    localStorage.setItem(
      LAST_KM_KEY_PREFIX + carga.caminhao_id,
      String(Math.round(km))
    );

    await logEvent(motoristaId, "abastecimento_saved_local", {
      client_id,
      carga_id: carga.id,
      posto_nome: abastecimento.posto_nome,
      litros,
      valor,
      km_atual: abastecimento.km_atual,
      gps_ja_resolvido: gpsJa !== null,
    });

    router.push("/motorista");

    if (!gpsJa) {
      (async () => {
        const gps = await captureGPS();
        await db.abastecimentos_locais.update(client_id, {
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
            💰 Valor total
          </label>
          <InputDinheiro centavos={valorCentavos} onChange={setValorCentavos} />
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
