"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InputInteiro } from "@/components/InputInteiro";
import type { Caminhao } from "@/lib/admin/queries";

/**
 * Corrigir km inicial/final, caminhão e data/hora de início de uma carga.
 *
 * km_inicial digitado errado envenena o km/L da frota inteira e, até
 * 14/09/2026, só existia o DELETE da carga toda pra consertar. O endpoint
 * (PATCH /api/admin/cargas/[id]) já conhece as duas travas — este modal é só
 * o segundo caminho até ele, mesmo desenho do ModalApagarDescarga:
 *
 *  - 400 (km final <= km inicial): bloqueia, mostra a mensagem do servidor.
 *  - 409 com precisa_confirmar (salto > 1.500km contra o histórico do
 *    caminhão): mostra a mensagem PRONTA do servidor — já traz os números —
 *    e o próximo clique reenvia com confirmado: true. Não inventa texto
 *    próprio pro salto, igual o ModalApagarDescarga faz com o estoque
 *    negativo.
 */
export function ModalEditarCarga({
  carga,
  caminhoes,
  onFechar,
}: {
  carga: {
    id: string;
    caminhao_id: string;
    km_inicial: number;
    km_final: number | null;
    iniciada_em: string;
  };
  caminhoes: Pick<Caminhao, "id" | "placa" | "marca">[];
  onFechar: () => void;
}) {
  const router = useRouter();

  // datetime-local só entende horário sem fuso — trata os dígitos como se
  // fossem o relógio de Brasília. É conta sobre o instante (fixa, BR não
  // tem horário de verão desde 2019), não depende do fuso da máquina que
  // roda isto. Mesma ideia que a página da carga já usa pra sugerir a data
  // da coleta retroativa.
  function paraDatetimeLocal(iso: string): string {
    return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  }

  const [kmInicial, setKmInicial] = useState<number | null>(carga.km_inicial);
  const [kmFinal, setKmFinal] = useState<number | null>(carga.km_final);
  const [caminhaoId, setCaminhaoId] = useState(carga.caminhao_id);
  const [quando, setQuando] = useState(paraDatetimeLocal(carga.iniciada_em));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Preenchido quando o servidor pede o segundo clique — a mensagem É a
  // dele, já com os números do salto. Editar qualquer campo de novo zera:
  // a confirmação anterior valia pros números de antes.
  const [pedidoServidor, setPedidoServidor] = useState<string | null>(null);

  function limparAvisos() {
    setErro(null);
    setPedidoServidor(null);
  }

  async function salvar(confirmado: boolean) {
    if (kmInicial === null) {
      setErro("Km inicial é obrigatório");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/cargas/${carga.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          km_inicial: kmInicial,
          km_final: kmFinal,
          caminhao_id: caminhaoId,
          iniciada_em: new Date(quando).toISOString(),
          confirmado,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.precisa_confirmar) {
          setPedidoServidor(data.error);
          return;
        }
        setPedidoServidor(null);
        setErro(data.error || "erro");
        return;
      }
      router.refresh();
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-bold">Corrigir dados da carga</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Km inicial</label>
            <InputInteiro
              valor={kmInicial}
              onChange={(v) => {
                setKmInicial(v);
                limparAvisos();
              }}
              grande={false}
              sufixo="km"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Km final <span className="text-cinza-suave">(vazio = em aberto)</span>
            </label>
            <InputInteiro
              valor={kmFinal}
              onChange={(v) => {
                setKmFinal(v);
                limparAvisos();
              }}
              grande={false}
              sufixo="km"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Caminhão</label>
          <select
            value={caminhaoId}
            onChange={(e) => {
              setCaminhaoId(e.target.value);
              limparAvisos();
            }}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            {caminhoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.placa} — {c.marca}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Início da carga
          </label>
          <input
            type="datetime-local"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={quando}
            onChange={(e) => {
              setQuando(e.target.value);
              limparAvisos();
            }}
          />
        </div>

        {erro && (
          <div className="bg-alerta/10 border-2 border-alerta text-alerta rounded-xl p-3 text-sm">
            {erro}
          </div>
        )}

        {pedidoServidor && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
            {pedidoServidor}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onFechar}
            disabled={salvando}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={() => salvar(!!pedidoServidor)}
            disabled={salvando}
            className="px-5 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando
              ? "Salvando..."
              : pedidoServidor
                ? "CONFIRMAR MESMO ASSIM"
                : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
