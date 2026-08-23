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
import { InputInteiro } from "@/components/InputInteiro";
import type { CargaAtivaCache, DescargaLocal } from "@/lib/types";

const DENSIDADE_KG_POR_L = 0.9;
const LAST_KM_KEY_PREFIX = "coleta_ultimo_km_";
const SALTO_MAXIMO_KM = 1500;

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

  const [pesoBrutoValor, setPesoBrutoValor] = useState<number | null>(null);
  const [kmValor, setKmValor] = useState<number | null>(null);
  const [foto, setFoto] = useState<Blob | null>(null);
  const [gpsResultado, setGpsResultado] = useState<GpsResult | null>(null);
  // Validações aparecem SÓ quando aperta confirmar (nunca enquanto digita)
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<
    | { tipo: "sem_coletas" }
    | { tipo: "divergencia"; diffPct: number; esperadoKg: number }
    | { tipo: "km_menor_inicio"; ultimoKm: number }
    | { tipo: "km_menor"; ultimoKm: number }
    | { tipo: "km_salto"; salto: number }
    | null
  >(null);
  // Avisos que o motorista JÁ confirmou neste preenchimento — confirmar um
  // não pula os outros (editar qualquer número zera a lista).
  const [avisosConfirmados, setAvisosConfirmados] = useState<string[]>([]);

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
    // Sugere o último km conhecido do caminhão (do início da carga ou do
    // último abastecimento) — motorista só confirma ou corrige.
    const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + c.caminhao_id);
    setKmValor(kmSug ? Number(kmSug) || c.km_inicial : c.km_inicial);
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

  const pesoBruto = pesoBrutoValor ?? 0;
  const pesoDigitado = pesoBrutoValor !== null;
  const pesoLiquidoKg = pesoDigitado && carga ? pesoBruto - carga.tara_kg : 0;
  const litrosEstimados =
    pesoLiquidoKg > 0 ? Math.round(pesoLiquidoKg / DENSIDADE_KG_POR_L) : 0;

  const km = kmValor ?? 0;
  const kmDigitado = kmValor !== null && kmValor > 0;

  // Botão fica clicável assim que digitou os números — validações no clique
  const podeSalvar =
    !!carga && !!motoristaId && pesoDigitado && kmDigitado && !salvando;

  function trocarPeso(v: number | null) {
    setPesoBrutoValor(v);
    // Editou o número → validações antigas não valem mais
    setErro(null);
    setAviso(null);
    setAvisosConfirmados([]);
  }

  function trocarKm(v: number | null) {
    setKmValor(v);
    setErro(null);
    setAviso(null);
    setAvisosConfirmados([]);
  }

  async function salvar() {
    if (!podeSalvar || !carga || !motoristaId) return;

    // ÚNICA TRAVA que sobrou no app (decisão do Evaner, 22/08): peso menor
    // que a tara é impossível, e liberar entraria como óleo NEGATIVO no
    // estoque, corrompendo o custo médio. Com o campo já rejeitando ponto
    // e vírgula, isto só dispara se ele digitar um número pequeno mesmo.
    if (pesoLiquidoKg <= 0) {
      setErro(
        `Esse caminhão vazio já pesa ${carga.tara_kg.toLocaleString("pt-BR")} kg. Confere o peso do papel da balança.`
      );
      return;
    }
    // ⚠️ 22/08/2026 — "km menor que o início da carga" deixou de TRAVAR e
    // virou aviso (decisão do Evaner): ele está na balança, com o papel na
    // mão. Travar ali deixava a carga impossível de encerrar quando o km
    // inicial tinha sido digitado errado. O aviso está na cadeia abaixo.
    const kmNum = Math.round(km);
    setErro(null);

    // Antiburros em duas etapas: primeiro clique mostra o aviso NO APP,
    // segundo clique ("CONFIRMAR MESMO ASSIM") prossegue.
    //
    // Cada "CONFIRMAR MESMO ASSIM" confirma SÓ o aviso que está na tela —
    // a cadeia roda de novo e o próximo aviso ainda aparece. Antes, um
    // salto de km confirmado engolia junto a divergência de peso de 45%,
    // que o motorista nunca via.
    const confirmados = [...avisosConfirmados];
    if (aviso) {
      confirmados.push(aviso.tipo);
      setAvisosConfirmados(confirmados);
      setAviso(null);
    }
    {
      if (!confirmados.includes("km_menor_inicio") && kmNum < carga.km_inicial) {
        setAviso({ tipo: "km_menor_inicio", ultimoKm: carga.km_inicial });
        return;
      }
      const ultimoKmRaw = localStorage.getItem(
        LAST_KM_KEY_PREFIX + carga.caminhao_id
      );
      const ultimoKm = ultimoKmRaw ? Number(ultimoKmRaw) : null;
      if (
        !confirmados.includes("km_menor") &&
        ultimoKm !== null &&
        Number.isFinite(ultimoKm) &&
        kmNum < ultimoKm
      ) {
        setAviso({ tipo: "km_menor", ultimoKm });
        return;
      }
      const referencia = Math.max(
        carga.km_inicial,
        ultimoKm !== null && Number.isFinite(ultimoKm) ? ultimoKm : 0
      );
      if (
        !confirmados.includes("km_salto") &&
        kmNum - referencia > SALTO_MAXIMO_KM
      ) {
        setAviso({ tipo: "km_salto", salto: kmNum - referencia });
        return;
      }
      if (!confirmados.includes("sem_coletas") && resumo.coletas === 0) {
        setAviso({ tipo: "sem_coletas" });
        return;
      }
      if (!confirmados.includes("divergencia") && resumo.litros > 0) {
        const pesoEsperado = resumo.litros * DENSIDADE_KG_POR_L;
        const diff = Math.abs(pesoLiquidoKg - pesoEsperado) / pesoEsperado;
        if (diff > 0.3) {
          setAviso({
            tipo: "divergencia",
            diffPct: Math.round(diff * 100),
            esperadoKg: Math.round(pesoEsperado),
          });
          return;
        }
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
      km_final: Math.round(km),
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
    try {
      await db.descargas_locais.add(descarga);
    } catch (e) {
      // O celular recusou gravar (memória cheia, duas janelas do app
      // abertas durante uma atualização). Sem isto o botão ficava
      // travado em "Salvando..." e nada aparecia na tela.
      setSalvando(false);
      setErro(
        "O celular não conseguiu guardar o lançamento. Feche o aplicativo e abra de novo — se continuar, fala com o Jean."
      );
      return;
    }
    // Guarda o km pra sugerir na próxima carga desse caminhão
    localStorage.setItem(
      LAST_KM_KEY_PREFIX + carga.caminhao_id,
      String(Math.round(km))
    );

    await logEvent(motoristaId, "descarga_saved_local", {
      km_final: Math.round(km),
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

    // Resumo vai por sessionStorage e a URL fica fixa. Com parâmetros na
    // URL, o Service Worker não achava essa página no cache e o motorista
    // sem sinal via erro do navegador (bug real de campo) — mesmo com a
    // descarga já salva no celular.
    sessionStorage.setItem(
      "coleta_resumo_carga",
      JSON.stringify({
        peso_bruto: descarga.peso_bruto_kg,
        tara: descarga.peso_tara_kg,
        liquido: pesoLiquidoKg,
        litros: litrosEstimados,
        coletas: resumo.coletas,
        km: Math.max(0, Math.round(km) - carga.km_inicial),
        iniciada: carga.iniciada_em,
      })
    );
    router.push("/motorista/carga-encerrada");

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
          {/* Peso é número cheio: o ponto não entra. Era o "12.850"
              virando 12,85 kg — menor que a tara — que travava a descarga. */}
          <InputInteiro
            valor={pesoBrutoValor}
            onChange={trocarPeso}
            autoFocus
            sufixo="kg"
          />
          <p className="text-sm text-cinza-suave mt-1">
            Peso que vem no papelzinho da balança
          </p>
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

        <div>
          <label className="block text-xl font-semibold mb-3">
            📍 Km do painel agora
          </label>
          <InputInteiro valor={kmValor} onChange={trocarKm} sufixo="km" />
          <p className="text-sm text-cinza-suave mt-1">
            Saiu com {carga.km_inicial.toLocaleString("pt-BR")} km
          </p>
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
          <div className="bg-alerta/10 border-2 border-alerta text-alerta rounded-2xl p-4 text-center text-lg font-medium">
            {erro}
          </div>
        )}

        {aviso?.tipo === "sem_coletas" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Carga sem nenhuma coleta</p>
            <p>
              Essa carga não tem nenhuma coleta lançada. Se você coletou e
              esqueceu de lançar, volta e lança primeiro. Se quer descarregar
              assim mesmo, aperta o botão de novo.
            </p>
          </div>
        )}

        {aviso?.tipo === "km_menor_inicio" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Km menor que o início da carga</p>
            <p>
              A carga começou com {aviso.ultimoKm.toLocaleString("pt-BR")} km —
              confere se lançou certo. Se o número estiver certo mesmo, aperta
              o botão de novo.
            </p>
          </div>
        )}

        {aviso?.tipo === "km_menor" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Km menor que o último registro</p>
            <p>
              O último km registrado desse caminhão foi{" "}
              {aviso.ultimoKm.toLocaleString("pt-BR")} — confere se lançou certo.
              Se o número estiver certo mesmo, aperta o botão de novo.
            </p>
          </div>
        )}

        {aviso?.tipo === "km_salto" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Salto grande de km</p>
            <p>
              Esse caminhão andou {aviso.salto.toLocaleString("pt-BR")} km desde
              o último registro? Confere se lançou certo. Se estiver certo mesmo,
              aperta o botão de novo.
            </p>
          </div>
        )}

        {aviso?.tipo === "divergencia" && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-900 rounded-2xl p-4 text-base">
            <p className="font-bold mb-1">⚠️ Peso bem diferente do esperado</p>
            <p>
              Pelas coletas que você lançou, o peso líquido deveria dar por
              volta de {aviso.esperadoKg.toLocaleString("pt-BR")} kg — deu{" "}
              {pesoLiquidoKg.toLocaleString("pt-BR")} kg ({aviso.diffPct}% de
              diferença). Confere o número no papelzinho da balança. Se estiver
              certo mesmo, aperta o botão de novo.
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
            : aviso
              ? "⚠️ CONFIRMAR MESMO ASSIM"
              : "✅ CONFIRMAR DESCARGA"}
        </button>
      </div>
    </main>
  );
}
