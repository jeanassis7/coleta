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
import { parseValorInteiro } from "@/lib/format";
import type { CargaAtivaCache, DespesaLocal } from "@/lib/types";

/**
 * Offline-first: salva no IndexedDB e sincroniza quando houver sinal.
 * GPS captura silenciosa ao abrir a tela (não depende de internet).
 */
export default function DespesaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [carga, setCarga] = useState<CargaAtivaCache | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [valorTexto, setValorTexto] = useState("");
  const [descricao, setDescricao] = useState("");
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
  }, [router]);

  // GPS silencioso em paralelo ao preenchimento
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
    setSalvando(true);

    const client_id = uuid();
    const gpsJa = gpsResultado;
    const despesa: DespesaLocal = {
      client_id,
      motorista_id: motoristaId,
      carga_id: carga.id,
      valor,
      descricao: descricao.trim(),
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
    await db.despesas_locais.add(despesa);

    await logEvent(motoristaId, "despesa_saved_local", {
      client_id,
      carga_id: carga.id,
      valor,
      descricao: despesa.descricao,
      gps_ja_resolvido: gpsJa !== null,
    });

    router.push("/motorista");

    // Se GPS ainda não resolveu, resolve em background e libera o sync
    if (!gpsJa) {
      (async () => {
        const gps = await captureGPS();
        await db.despesas_locais.update(client_id, {
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
