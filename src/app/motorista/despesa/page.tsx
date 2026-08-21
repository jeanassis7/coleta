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

  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [descricao, setDescricao] = useState("");
  // O combustível já tinha os dois botões; a despesa não — e a borracharia
  // que fia obrigava a lançar como se tivesse pago do bolso (saldo errado).
  const [pagoNaHora, setPagoNaHora] = useState(true);
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

  const podeSalvar =
    !!motoristaId &&
    !!carga &&
    valorCentavos !== null &&
    valorCentavos > 0 &&
    descricao.trim().length >= 3 &&
    foto !== null &&
    !salvando;

  async function salvar() {
    if (!podeSalvar || !motoristaId || !carga || valorCentavos === null || !foto)
      return;
    setSalvando(true);

    const valor = centavosParaReais(valorCentavos);
    const client_id = uuid();
    const gpsJa = gpsResultado;
    const despesa: DespesaLocal = {
      client_id,
      motorista_id: motoristaId,
      carga_id: carga.id,
      valor,
      descricao: descricao.trim(),
      pago_na_hora: pagoNaHora,
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
            💰 Valor
          </label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
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
            placeholder=""
            required
          />
        </div>

        {/* Mesma pergunta do abastecimento — sobre o ATO, não contabilidade */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            💵 Como pagou?
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPagoNaHora(true)}
              className={`rounded-2xl py-6 px-2 border-2 text-center transition-colors ${
                pagoNaHora
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              <span className="block text-lg font-bold leading-tight">
                PAGUEI AGORA
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPagoNaHora(false)}
              className={`rounded-2xl py-6 px-2 border-2 text-center transition-colors ${
                !pagoNaHora
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              <span className="block text-lg font-bold leading-tight">
                ASSINEI A NOTA
              </span>
            </button>
          </div>
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
