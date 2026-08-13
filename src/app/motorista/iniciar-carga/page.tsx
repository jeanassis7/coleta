"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  setCargaAtivaCached,
  temDescargaPendenteSync,
} from "@/lib/motorista/carga";
import { manualSync } from "@/lib/sync/trigger";
import { logEvent } from "@/lib/events/log";
import { FotoPicker } from "@/components/motorista/FotoPicker";

interface CaminhaoAtivo {
  id: string;
  placa: string;
  marca: string;
  modelo: string | null;
  cor: string;
  capacidade_l: number;
  tara_kg: number;
}

const LAST_CAMINHAO_KEY = "coleta_ultimo_caminhao";
const LAST_KM_KEY_PREFIX = "coleta_ultimo_km_";

type Estado =
  | "carregando"
  | "descarga_pendente" // descarga anterior ainda não subiu — sync precisa rodar antes
  | "offline"           // iniciar carga precisa de sinal (INSERT no servidor)
  | "sem_caminhoes"
  | "pronto";

/**
 * Iniciar carga PRECISA de sinal: o servidor é quem garante "só 1 carga
 * ativa por motorista" e fornece a lista de caminhões. É uma operação de
 * segundos no depósito/cidade — os lançamentos do dia-a-dia (coleta,
 * despesa, abastecimento, descarga) esses sim são offline-first.
 */
export default function IniciarCargaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>("carregando");
  const [caminhoes, setCaminhoes] = useState<CaminhaoAtivo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [caminhaoId, setCaminhaoId] = useState<string>("");
  const [kmInicial, setKmInicial] = useState<string>("");
  const [fotoPainel, setFotoPainel] = useState<Blob | null>(null);
  // Tela de boas-vindas antes do formulário (pedido do Evaner)
  const [formAberto, setFormAberto] = useState(false);
  const [nomeMotorista, setNomeMotorista] = useState("");

  const preparar = useCallback(
    async (id: string) => {
      setEstado("carregando");

      // 1. Descarga anterior ainda não sincronizada? O servidor ainda vê a
      //    carga velha como ativa e rejeitaria a nova. Tenta subir agora.
      if (await temDescargaPendenteSync(id)) {
        if (navigator.onLine) {
          await manualSync();
        }
        if (await temDescargaPendenteSync(id)) {
          setEstado("descarga_pendente");
          return;
        }
      }

      // 2. Sem sinal não tem como abrir carga (INSERT no servidor)
      if (!navigator.onLine) {
        setEstado("offline");
        return;
      }

      // 3. Lista de caminhões ativos
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase
        .from("caminhoes")
        .select("id, placa, marca, modelo, cor, capacidade_l, tara_kg")
        .eq("ativo", true)
        .order("placa");
      if (error) {
        // Rede caiu no meio — trata como offline, não como "sem caminhões"
        setEstado("offline");
        return;
      }
      const lista = (data || []) as CaminhaoAtivo[];
      if (lista.length === 0) {
        setEstado("sem_caminhoes");
        return;
      }
      setCaminhoes(lista);
      const last = localStorage.getItem(LAST_CAMINHAO_KEY);
      const escolhido = lista.find((c) => c.id === last) || lista[0];
      setCaminhaoId(escolhido.id);
      const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + escolhido.id);
      if (kmSug) setKmInicial(kmSug);
      setEstado("pronto");
    },
    []
  );

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    if (!id) {
      router.push("/motorista");
      return;
    }
    setMotoristaId(id);
    setNomeMotorista(sessionStorage.getItem("coleta_motorista_nome") || "");
    preparar(id);

    // Se o sinal voltar enquanto ele olha a tela de offline, tenta de novo
    const onOnline = () => preparar(id);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [router, preparar]);

  // Quando trocar caminhão, atualiza sugestão de km
  useEffect(() => {
    if (!caminhaoId) return;
    const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + caminhaoId);
    if (kmSug) setKmInicial(kmSug);
  }, [caminhaoId]);

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    if (!motoristaId || !caminhaoId) return;
    const kmNum = Number(kmInicial);
    if (!Number.isFinite(kmNum) || kmNum <= 0) {
      setErro("Km inicial inválido");
      return;
    }
    setErro(null);
    setSalvando(true);

    const supabase = getSupabaseBrowser();
    try {
      let foto_painel_path: string | null = null;
      if (fotoPainel) {
        const path = `${motoristaId}/carga-painel-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("fotos-coletas")
          .upload(path, fotoPainel, {
            cacheControl: "31536000",
            upsert: true,
            contentType: "image/jpeg",
          });
        if (!upErr) foto_painel_path = path;
      }

      const { data, error } = await supabase
        .from("cargas")
        .insert({
          motorista_id: motoristaId,
          caminhao_id: caminhaoId,
          km_inicial: Math.round(kmNum),
          foto_painel_path,
        })
        .select("id, iniciada_em")
        .maybeSingle();

      if (error || !data) {
        if (error?.code === "23505") {
          setErro(
            "Você já tem uma carga aberta. Volta pra home que ela vai aparecer."
          );
        } else {
          setErro(error?.message || "Não consegui iniciar a carga.");
        }
        return;
      }

      const caminhao = caminhoes.find((c) => c.id === caminhaoId);
      if (!caminhao) {
        setErro("Caminhão sumiu da lista, tenta de novo");
        return;
      }

      setCargaAtivaCached({
        id: data.id,
        motorista_id: motoristaId,
        caminhao_id: caminhao.id,
        caminhao_placa: caminhao.placa,
        caminhao_marca: caminhao.marca,
        caminhao_cor: caminhao.cor,
        capacidade_l: caminhao.capacidade_l,
        tara_kg: caminhao.tara_kg,
        km_inicial: Math.round(kmNum),
        iniciada_em: data.iniciada_em,
      });

      localStorage.setItem(LAST_CAMINHAO_KEY, caminhao.id);
      localStorage.setItem(
        LAST_KM_KEY_PREFIX + caminhao.id,
        String(Math.round(kmNum))
      );

      await logEvent(motoristaId, "carga_iniciada", {
        carga_id: data.id,
        caminhao_id: caminhao.id,
        km_inicial: Math.round(kmNum),
        tem_foto_painel: !!fotoPainel,
      });

      router.push("/motorista");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSalvando(false);
    }
  }

  if (estado === "carregando") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-cinza-suave text-xl">Carregando...</p>
      </main>
    );
  }

  if (estado === "descarga_pendente") {
    return (
      <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
        <div className="bg-white rounded-3xl shadow p-8 text-center space-y-4">
          <div className="text-5xl">📤</div>
          <h1 className="text-xl font-bold">Descarga esperando sinal</h1>
          <p className="text-cinza-suave">
            Sua última descarga ainda não foi enviada. Assim que pegar um
            pinguinho de sinal ela sobe sozinha e aí você consegue iniciar a
            carga nova.
          </p>
          <button
            onClick={() => motoristaId && preparar(motoristaId)}
            className="btn-primario"
          >
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }

  if (estado === "offline") {
    return (
      <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
        <div className="bg-white rounded-3xl shadow p-8 text-center space-y-4">
          <div className="text-5xl">📵</div>
          <h1 className="text-xl font-bold">Sem sinal</h1>
          <p className="text-cinza-suave">
            Iniciar uma carga precisa de internet (é rapidinho, qualquer 3G
            serve). Quando o sinal voltar essa tela destrava sozinha.
          </p>
          <button
            onClick={() => motoristaId && preparar(motoristaId)}
            className="btn-primario"
          >
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }

  if (estado === "sem_caminhoes") {
    return (
      <main className="min-h-screen p-4 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-4">Nenhum caminhão disponível</h1>
        <p className="text-cinza-suave">
          Nenhum caminhão foi cadastrado ainda. Fala com o Jean.
        </p>
      </main>
    );
  }

  if (!formAberto) {
    return (
      <main className="min-h-screen p-4 max-w-md mx-auto flex flex-col justify-center">
        <div className="text-center space-y-6">
          <div className="text-6xl">🚚</div>
          <h1 className="text-3xl font-bold">
            Seja bem-vindo{nomeMotorista ? `, ${nomeMotorista}` : ""}!
          </h1>
          <p className="text-xl text-cinza-suave">Bom trabalho!</p>
          <button
            onClick={() => setFormAberto(true)}
            className="btn-primario text-2xl"
          >
            🚀 INICIAR NOVA CARGA
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6 mt-2">Iniciar nova carga</h1>

      <form onSubmit={iniciar} className="space-y-6">
        <div>
          <label className="block text-xl font-semibold mb-3">
            🚚 Caminhão
          </label>
          <select
            value={caminhaoId}
            onChange={(e) => setCaminhaoId(e.target.value)}
            className="input-grande"
            required
          >
            {caminhoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.placa} {c.marca} {c.cor}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xl font-semibold mb-3">
            📍 Km inicial
          </label>
          <input
            type="number"
            inputMode="numeric"
            className="input-grande text-2xl"
            value={kmInicial}
            onChange={(e) => setKmInicial(e.target.value)}
            required
            min={1}
          />
        </div>

        {motoristaId && (
          <div>
            <label className="block text-xl font-semibold mb-3">
              Foto do painel
            </label>
            <FotoPicker onChange={setFotoPainel} motoristaId={motoristaId} />
          </div>
        )}

        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-2xl p-4 text-center text-lg font-medium">
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={salvando || !caminhaoId || !kmInicial}
          className="btn-primario text-2xl"
        >
          {salvando ? "Iniciando..." : "🚀 INICIAR CARGA"}
        </button>
      </form>
    </main>
  );
}
