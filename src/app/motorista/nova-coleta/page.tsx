"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { getLocalDB } from "@/lib/db/dexie";
import { captureGPS, checkPermissionsState, type GpsResult } from "@/lib/gps/capture";
import { logEvent } from "@/lib/events/log";
import { triggerSyncAfterSave } from "@/lib/sync/trigger";
import { getDeviceId, getSessionId, APP_VERSION } from "@/lib/device/device-id";
import { formatBRL, parseLitros, parseValorInteiro } from "@/lib/format";
import { CertificadoPicker } from "@/components/motorista/CertificadoPicker";
import { FotoPicker } from "@/components/motorista/FotoPicker";
import { SugestaoLocal } from "@/components/motorista/SugestaoLocal";
import type { CertificadoTipo, ColetaLocal } from "@/lib/types";

export default function NovaColetaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [exigeFoto, setExigeFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [litrosTexto, setLitrosTexto] = useState("");
  const [cert, setCert] = useState<{
    tipo: CertificadoTipo | null;
    litrosCert: number | null;
  }>({ tipo: null, litrosCert: null });
  const [localNome, setLocalNome] = useState("");
  const [localId, setLocalId] = useState<string | null>(null);
  const [valorTexto, setValorTexto] = useState("");
  const [valorFormatado, setValorFormatado] = useState("");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [observacao, setObservacao] = useState("");

  // GPS começa a ser capturado já na abertura da tela (em paralelo ao preenchimento).
  // Quando motorista termina de digitar, geralmente o GPS já resolveu.
  const [gpsResultado, setGpsResultado] = useState<GpsResult | null>(null);

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

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    const ef = sessionStorage.getItem("coleta_exige_foto");
    if (!id) {
      router.push("/motorista");
      return;
    }
    setMotoristaId(id);
    setExigeFoto(ef === "true");
    logEvent(id, "nova_coleta_opened", {
      exige_foto: ef === "true",
    });
  }, [router]);

  const litros = parseLitros(litrosTexto);
  const valor = parseValorInteiro(valorTexto);

  const podeSalvar =
    !!motoristaId &&
    litros !== null &&
    cert.tipo !== null &&
    (cert.tipo !== "parcial" || (cert.litrosCert !== null && cert.litrosCert > 0)) &&
    localNome.trim().length > 0 &&
    valor !== null &&
    (!exigeFoto || foto !== null) &&
    !salvando;

  async function salvar() {
    if (!podeSalvar || !motoristaId || litros === null || valor === null || !cert.tipo) {
      return;
    }
    setSalvando(true);

    const client_id = uuid();
    const criado_em = Date.now();

    // Se GPS já resolveu durante o preenchimento, usa de cara. Senão marca pendente.
    const gpsJaResolvido = gpsResultado;
    const coleta: ColetaLocal = {
      client_id,
      motorista_id: motoristaId,
      litros,
      local_nome: localNome.trim(),
      local_id: localId,
      valor_pago: valor,
      certificado_tipo: cert.tipo,
      litros_certificado: cert.litrosCert,
      observacao: observacao.trim() || null,
      latitude: gpsJaResolvido?.ok ? gpsJaResolvido.latitude : null,
      longitude: gpsJaResolvido?.ok ? gpsJaResolvido.longitude : null,
      gps_accuracy: gpsJaResolvido?.ok ? gpsJaResolvido.accuracy : null,
      gps_capturado: gpsJaResolvido?.ok ?? false,
      gps_pendente: gpsJaResolvido === null, // só pendente se ainda não resolveu
      device_id: getDeviceId(),
      session_id: getSessionId(),
      app_version: APP_VERSION,
      criado_em,
      foto_blob: foto,
      foto_subida: false,
      registro_subido: false,
      tentativas: 0,
      ultimo_erro: null,
    };

    const db = getLocalDB();
    await db.coletas_locais.add(coleta);

    // Loga o save local — útil pra debug
    await logEvent(motoristaId, "coleta_saved_local", {
      client_id,
      tem_foto: foto !== null,
      gps_ja_resolvido: gpsJaResolvido !== null,
      gps_ok: gpsJaResolvido?.ok ?? false,
      gps_accuracy: gpsJaResolvido?.ok ? gpsJaResolvido.accuracy : null,
      tem_local_id: localId !== null,
      tem_observacao: observacao.trim().length > 0,
      certificado_tipo: cert.tipo,
    });

    // Loga GPS bem-sucedido se já tinha
    if (gpsJaResolvido && gpsJaResolvido.ok) {
      await logEvent(motoristaId, "gps_success", {
        coleta_client_id: client_id,
        accuracy: gpsJaResolvido.accuracy,
      });
    }

    // Se GPS já falhou na captura inicial, loga
    if (gpsJaResolvido && !gpsJaResolvido.ok) {
      const permState = await checkPermissionsState();
      await logEvent(
        motoristaId,
        gpsJaResolvido.failure?.kind === "denied"
          ? "gps_denied"
          : gpsJaResolvido.failure?.kind === "timeout"
          ? "gps_timeout"
          : "gps_error",
        {
          coleta_client_id: client_id,
          permissions_state: permState,
          code: gpsJaResolvido.failure?.code,
          message: gpsJaResolvido.failure?.message,
          kind: gpsJaResolvido.failure?.kind,
        }
      );
    }

    // Navega já — GPS pendente e sync ficam em background
    router.push(`/motorista/confirmacao?cid=${client_id}`);

    // Se ainda não tinha GPS no momento do save, continua tentando
    if (!gpsJaResolvido) {
      (async () => {
        const gps = await captureGPS();
        if (gps.ok) {
          await db.coletas_locais.update(client_id, {
            latitude: gps.latitude,
            longitude: gps.longitude,
            gps_accuracy: gps.accuracy,
            gps_capturado: true,
            gps_pendente: false,
          });
          await logEvent(motoristaId, "gps_success", {
            coleta_client_id: client_id,
            accuracy: gps.accuracy,
            via: "background_after_save",
          });
        } else {
          await db.coletas_locais.update(client_id, {
            gps_pendente: false,
          });
          const permState = await checkPermissionsState();
          await logEvent(
            motoristaId,
            gps.failure?.kind === "denied"
              ? "gps_denied"
              : gps.failure?.kind === "timeout"
              ? "gps_timeout"
              : "gps_error",
            {
              coleta_client_id: client_id,
              permissions_state: permState,
              code: gps.failure?.code,
              message: gps.failure?.message,
              kind: gps.failure?.kind,
            }
          );
        }
        triggerSyncAfterSave();
      })();
    } else {
      // GPS já estava pronto — dispara sync direto
      triggerSyncAfterSave();
    }
  }

  function handleValorChange(s: string) {
    setValorTexto(s);
    setValorFormatado("");
  }

  function handleValorBlur() {
    const v = parseValorInteiro(valorTexto);
    if (v !== null) {
      setValorFormatado(formatBRL(v));
    } else {
      setValorFormatado("");
    }
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <header className="flex items-center mb-6 mt-2">
        <button
          onClick={() => router.back()}
          className="text-cinza-suave text-lg p-2 -ml-2"
        >
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold ml-2">Nova Coleta</h1>
      </header>

      <div className="space-y-6">
        {/* 1. LITROS */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Quantos litros?
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="input-grande text-2xl"
            placeholder=""
            value={litrosTexto}
            onChange={(e) => setLitrosTexto(e.target.value)}
            autoFocus
          />
        </div>

        {/* 2. CERTIFICADO */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Entregou certificado?
          </label>
          <CertificadoPicker
            litros={litros}
            valor={cert}
            onChange={setCert}
          />
        </div>

        {/* 3. LOCAL */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Nome do local?
          </label>
          <SugestaoLocal
            nomeAtual={localNome}
            setNomeAtual={setLocalNome}
            onSelecionar={({ local_id, nome }) => {
              setLocalId(local_id);
              setLocalNome(nome);
            }}
          />
        </div>

        {/* 4. VALOR */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Quanto pagou no total?
          </label>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-cinza-texto">R$</span>
            <input
              type="text"
              inputMode="numeric"
              className="input-grande text-2xl flex-1"
              placeholder=""
              value={valorTexto}
              onChange={(e) => handleValorChange(e.target.value)}
              onBlur={handleValorBlur}
            />
          </div>
          {valorFormatado && (
            <p className="text-base text-cinza-suave mt-1 text-right">
              {valorFormatado}
            </p>
          )}
        </div>

        {/* 5. FOTO (condicional) */}
        {exigeFoto && motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              Foto da fachada/portão
            </label>
            <FotoPicker onChange={setFoto} motoristaId={motoristaId} />
          </div>
        )}

        {/* 6. OBSERVAÇÃO */}
        <div>
          <label className="block text-xl font-semibold mb-3">
            Algo a observar? <span className="text-cinza-suave text-base">(opcional)</span>
          </label>
          <textarea
            className="input-grande min-h-[100px] resize-none"
            placeholder=""
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
          />
        </div>

        {/* SALVAR */}
        <button
          onClick={salvar}
          disabled={!podeSalvar}
          className="btn-primario text-2xl"
        >
          {salvando ? "Salvando..." : "✅ SALVAR COLETA"}
        </button>
      </div>
    </main>
  );
}
