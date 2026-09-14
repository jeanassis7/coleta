"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDataHora } from "@/lib/format";
import { InputInteiro } from "@/components/InputInteiro";

const DENSIDADE_KG_POR_L = 0.9;

/**
 * Corrigir o peso da balança de uma descarga já lançada.
 *
 * Mora em arquivo próprio, mesmo desenho do ModalEditarDespesa/Abastecimento:
 * é a ÚNICA dona da regra (PATCH /api/admin/descargas/[id]), chamada tanto
 * daqui (linha do tempo da carga) quanto de qualquer outra tela futura.
 *
 * peso_liquido_kg é GENERATED ALWAYS no banco — nunca mandamos esse campo,
 * só bruto e tara. É esse peso líquido que entra no estoque, então a tela
 * avisa isso antes do gestor confirmar.
 *
 * Dois antiburros, mesmo número que o motorista já vê no celular
 * (DescarregarPage):
 *  1. bruto <= tara → erro impossível, bloqueia em vermelho, sem segundo
 *     clique (o caminhão não pesa menos que ele mesmo).
 *  2. líquido fora de ±30% de litros declarados × 0,9 → aviso amarelo,
 *     duas etapas ("CONFIRMAR MESMO ASSIM" no segundo clique). Pulado se a
 *     carga não tiver coletas (não dá pra comparar com zero).
 */
export function ModalEditarDescarga({
  descarga,
  motoristaNome,
  caminhaoPlaca,
  litrosDeclarados,
  onFechar,
  onAviso,
}: {
  descarga: {
    id: string;
    peso_bruto_kg: number;
    peso_tara_kg: number;
    criado_em: string;
  };
  motoristaNome: string;
  caminhaoPlaca: string;
  /** soma de litros das coletas da carga — 0 = pula o antiburro de ±30% */
  litrosDeclarados: number;
  onFechar: () => void;
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [pesoBruto, setPesoBruto] = useState<number | null>(
    Math.round(descarga.peso_bruto_kg)
  );
  const [pesoTara, setPesoTara] = useState<number | null>(
    Math.round(descarga.peso_tara_kg)
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Preenchido só depois do primeiro clique, quando a divergência de ±30%
  // aparece. Editar qualquer peso de novo zera o aviso (número mudou, a
  // conta precisa rodar de novo).
  const [avisoDivergencia, setAvisoDivergencia] = useState<{
    esperadoKg: number;
    diffPct: number;
  } | null>(null);

  const bruto = pesoBruto ?? 0;
  const tara = pesoTara ?? 0;
  const digitados = pesoBruto !== null && pesoTara !== null;
  const pesoLiquido = digitados ? bruto - tara : null;

  function trocarBruto(v: number | null) {
    setPesoBruto(v);
    setErro(null);
    setAvisoDivergencia(null);
  }

  function trocarTara(v: number | null) {
    setPesoTara(v);
    setErro(null);
    setAvisoDivergencia(null);
  }

  async function salvar() {
    if (!digitados) return;
    setErro(null);

    // Erro impossível: bloqueia de vez, não tem "confirmar mesmo assim".
    if (bruto <= tara) {
      setErro(
        `O peso bruto (${bruto.toLocaleString("pt-BR")} kg) precisa ser MAIOR que a tara (${tara.toLocaleString("pt-BR")} kg) — o caminhão não pesa menos que ele mesmo.`
      );
      return;
    }

    const liquido = bruto - tara;

    // Antiburro de ±30%: só com base pra comparar, e só no primeiro clique
    // (avisoDivergencia null). Segundo clique já confirmou, passa direto.
    if (litrosDeclarados > 0 && !avisoDivergencia) {
      const esperadoKg = litrosDeclarados * DENSIDADE_KG_POR_L;
      const diff = Math.abs(liquido - esperadoKg) / esperadoKg;
      if (diff > 0.3) {
        setAvisoDivergencia({
          esperadoKg: Math.round(esperadoKg),
          diffPct: Math.round(diff * 100),
        });
        return;
      }
    }

    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/descargas/${descarga.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peso_bruto_kg: bruto,
          peso_tara_kg: tara,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      onAviso(null);
      router.refresh();
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-bold">Corrigir peso da balança</h2>
        <p className="text-sm text-cinza-suave">
          {motoristaNome} · {caminhaoPlaca} · {formatDataHora(descarga.criado_em)}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Peso bruto</label>
            <InputInteiro
              valor={pesoBruto}
              onChange={trocarBruto}
              grande={false}
              sufixo="kg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Tara</label>
            <InputInteiro
              valor={pesoTara}
              onChange={trocarTara}
              grande={false}
              sufixo="kg"
            />
          </div>
        </div>

        {pesoLiquido !== null && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 text-sm">
            <div className="flex justify-between">
              <span>Peso líquido:</span>
              <span className="font-mono font-semibold">
                {pesoLiquido.toLocaleString("pt-BR")} kg
              </span>
            </div>
            <p className="text-xs text-cinza-suave mt-1">
              Esse peso líquido é o que entra no estoque de óleo — corrigir
              aqui muda o estoque atual.
            </p>
          </div>
        )}

        {erro && (
          <div className="bg-alerta/10 border-2 border-alerta text-alerta rounded-xl p-3 text-sm">
            {erro}
          </div>
        )}

        {avisoDivergencia && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
            <p className="font-semibold mb-1">⚠️ Peso bem diferente do esperado</p>
            <p className="text-cinza-suave">
              Pelas coletas dessa carga ({litrosDeclarados.toLocaleString("pt-BR")}{" "}
              L declarados), o peso líquido deveria dar por volta de{" "}
              {avisoDivergencia.esperadoKg.toLocaleString("pt-BR")} kg — está em{" "}
              {(pesoLiquido ?? 0).toLocaleString("pt-BR")} kg (
              {avisoDivergencia.diffPct}% de diferença). Confere o número no
              papel da balança. Se estiver certo mesmo, confirme de novo.
            </p>
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
            onClick={salvar}
            disabled={salvando || !digitados}
            className="px-5 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando
              ? "Salvando..."
              : avisoDivergencia
                ? "CONFIRMAR MESMO ASSIM"
                : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
