"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { setCargaAtivaCached } from "@/lib/motorista/carga";
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

export default function IniciarCargaPage() {
  const router = useRouter();
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [caminhoes, setCaminhoes] = useState<CaminhaoAtivo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [caminhaoId, setCaminhaoId] = useState<string>("");
  const [kmInicial, setKmInicial] = useState<string>("");
  const [fotoPainel, setFotoPainel] = useState<Blob | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem("coleta_motorista_id");
    if (!id) {
      router.push("/motorista");
      return;
    }
    setMotoristaId(id);

    (async () => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase
        .from("caminhoes")
        .select("id, placa, marca, modelo, cor, capacidade_l, tara_kg")
        .eq("ativo", true)
        .order("placa");
      if (error) {
        setErro("Não consegui carregar os caminhões. Verifica o sinal.");
        setCarregando(false);
        return;
      }
      const lista = (data || []) as CaminhaoAtivo[];
      setCaminhoes(lista);
      if (lista.length > 0) {
        const last = localStorage.getItem(LAST_CAMINHAO_KEY);
        const escolhido = lista.find((c) => c.id === last) || lista[0];
        setCaminhaoId(escolhido.id);
        // Sugere último km conhecido daquele caminhão
        const kmSug = localStorage.getItem(LAST_KM_KEY_PREFIX + escolhido.id);
        if (kmSug) setKmInicial(kmSug);
      }
      setCarregando(false);
    })();
  }, [router]);

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
      // Se tiver foto do painel, sobe pra storage
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
            "Você já tem uma carga ativa. Volta pra home e finaliza ela antes."
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
      localStorage.setItem(LAST_KM_KEY_PREFIX + caminhao.id, String(Math.round(kmNum)));

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

  if (carregando) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-cinza-suave text-xl">Carregando...</p>
      </main>
    );
  }

  if (caminhoes.length === 0) {
    return (
      <main className="min-h-screen p-4 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-4">Nenhum caminhão disponível</h1>
        <p className="text-cinza-suave">
          Nenhum caminhão foi cadastrado ainda. Fala com o Jean.
        </p>
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
