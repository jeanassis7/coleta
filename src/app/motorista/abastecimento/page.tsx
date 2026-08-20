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
import { SugestaoLocal } from "@/components/motorista/SugestaoLocal";
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
  const [postoLocalId, setPostoLocalId] = useState<string | null>(null);
  // "PAGUEI AGORA" x "ASSINEI A NOTA" — pergunta física, não contábil.
  // Assinar a nota NÃO tira do bolso dele: vira dívida da empresa com o
  // posto e some do saldo (0018). Nasce em true porque é o caso comum.
  const [pagoNaHora, setPagoNaHora] = useState(true);
  const [litrosTexto, setLitrosTexto] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [kmTexto, setKmTexto] = useState("");
  // Antiburro do km — erro duro e avisos de segundo toque, tudo no app
  const [erroKm, setErroKm] = useState<string | null>(null);
  const [avisoKm, setAvisoKm] = useState<
    | { tipo: "menor_que_ultimo"; ultimoKm: number }
    | { tipo: "salto_grande"; salto: number }
    | null
  >(null);
  // Avisos já confirmados neste preenchimento — confirmar um não pula os
  // outros (editar o km zera a lista).
  const [avisosConfirmados, setAvisosConfirmados] = useState<string[]>([]);
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

  // Salto entre abastecimentos acima disso pede confirmação extra
  const SALTO_MAXIMO_KM = 1500;

  function trocarKm(s: string) {
    setKmTexto(s);
    setErroKm(null);
    setAvisoKm(null);
    setAvisosConfirmados([]);
  }

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

    const kmNum = Math.round(km);

    // REGRA DURA: odômetro nunca volta — km menor que o início da carga
    // é fisicamente impossível (provável dígito a menos).
    if (kmNum < carga.km_inicial) {
      setErroKm(
        `Km menor que o km do início da carga (${carga.km_inicial.toLocaleString("pt-BR")}) — confere se lançou certo.`
      );
      return;
    }
    setErroKm(null);

    // AVISOS de segundo toque (primeiro toque mostra, segundo confirma).
    // Confirmar UM aviso não pula os outros — a cadeia re-roda e o próximo
    // ainda aparece. Editar o km zera as confirmações.
    const confirmados = [...avisosConfirmados];
    if (avisoKm) {
      confirmados.push(avisoKm.tipo);
      setAvisosConfirmados(confirmados);
      setAvisoKm(null);
    }
    {
      const ultimoKmRaw = localStorage.getItem(
        LAST_KM_KEY_PREFIX + carga.caminhao_id
      );
      const ultimoKm = ultimoKmRaw ? Number(ultimoKmRaw) : null;
      if (
        !confirmados.includes("menor_que_ultimo") &&
        ultimoKm !== null &&
        Number.isFinite(ultimoKm) &&
        kmNum < ultimoKm
      ) {
        setAvisoKm({ tipo: "menor_que_ultimo", ultimoKm });
        return;
      }
      const referencia = Math.max(
        carga.km_inicial,
        ultimoKm !== null && Number.isFinite(ultimoKm) ? ultimoKm : 0
      );
      if (
        !confirmados.includes("salto_grande") &&
        kmNum - referencia > SALTO_MAXIMO_KM
      ) {
        setAvisoKm({ tipo: "salto_grande", salto: kmNum - referencia });
        return;
      }
    }

    setSalvando(true);

    const valor = centavosParaReais(valorCentavos);
    const client_id = uuid();
    const gpsJa = gpsResultado;
    const abastecimento: AbastecimentoLocal = {
      client_id,
      motorista_id: motoristaId,
      carga_id: carga.id,
      posto_nome: postoNome.trim(),
      local_id: postoLocalId,
      pago_na_hora: pagoNaHora,
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
      pago_na_hora: pagoNaHora,
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
          {/* Mesma máquina da coleta: o GPS já foi capturado ao abrir a tela,
              então o posto onde ele já abasteceu antes aparece sozinho. Um
              toque em vez de digitar. Sem metros na tela — só o nome. */}
          <SugestaoLocal
            tipo="posto"
            rotulo="⛽ Você está no posto:"
            rotuloOutro="➕ Outro posto"
            nomeAtual={postoNome}
            setNomeAtual={setPostoNome}
            onSelecionar={({ local_id, nome }) => {
              setPostoLocalId(local_id);
              setPostoNome(nome);
            }}
          />
        </div>

        {/* A pergunta é sobre o ATO FÍSICO, não sobre contabilidade:
            "a pagar" é vocabulário de escritório e ele não usaria. */}
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
            onChange={(e) => trocarKm(e.target.value)}
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

        {erroKm && (
          <div className="bg-alerta/10 border-2 border-alerta text-alerta rounded-2xl p-4 text-center text-lg font-medium">
            {erroKm}
          </div>
        )}

        {avisoKm?.tipo === "menor_que_ultimo" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Km menor que o último registro</p>
            <p>
              O último km registrado desse caminhão foi{" "}
              {avisoKm.ultimoKm.toLocaleString("pt-BR")} — confere se lançou
              certo. Se o número estiver certo mesmo, aperta o botão de novo.
            </p>
          </div>
        )}

        {avisoKm?.tipo === "salto_grande" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Salto grande de km</p>
            <p>
              Esse caminhão andou {avisoKm.salto.toLocaleString("pt-BR")} km
              desde o último registro? Confere se lançou certo. Se estiver certo
              mesmo, aperta o botão de novo.
            </p>
          </div>
        )}

        <button
          onClick={salvar}
          disabled={!podeSalvar}
          className="btn-primario text-2xl"
        >
          {salvando
            ? "Salvando..."
            : avisoKm
              ? "⚠️ CONFIRMAR MESMO ASSIM"
              : "✅ SALVAR ABASTECIMENTO"}
        </button>
      </div>
    </main>
  );
}
