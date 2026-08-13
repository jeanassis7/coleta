"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDataHora } from "@/lib/format";
import type { DescargaDetalhada } from "@/lib/admin/queries";

export function TabelaDescargas({ descargas }: { descargas: DescargaDetalhada[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function lancarUmidade(d: DescargaDetalhada) {
    const input = prompt(
      `Umidade (%) da descarga de ${d.motorista_nome} do dia ${formatDataHora(d.criado_em)}:\n\n` +
        `Deixa em branco pra apagar (voltar pra 'não lançada').`,
      d.umidade_pct !== null ? String(d.umidade_pct) : ""
    );
    if (input === null) return;
    const valor = input.trim();
    const body: Record<string, unknown> = {};
    if (valor === "") body.umidade_pct = null;
    else {
      const n = Number(valor.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        alert("Umidade deve ser um número entre 0 e 100");
        return;
      }
      body.umidade_pct = n;
    }
    setLoadingId(d.id);
    try {
      const res = await fetch(`/api/admin/descargas/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        alert("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  if (descargas.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma descarga registrada ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Data</th>
            <th className="py-2 pr-3">Motorista</th>
            <th className="py-2 pr-3">Caminhão</th>
            <th className="py-2 pr-3 text-right">Bruto</th>
            <th className="py-2 pr-3 text-right">Tara</th>
            <th className="py-2 pr-3 text-right">Líquido</th>
            <th className="py-2 pr-3 text-right">Litros (est.)</th>
            <th className="py-2 pr-3 text-right">Umidade</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {descargas.map((d) => (
            <tr key={d.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">
                {formatDataHora(d.criado_em)}
              </td>
              <td className="py-2 pr-3">{d.motorista_nome}</td>
              <td className="py-2 pr-3 font-mono">{d.caminhao_placa}</td>
              <td className="py-2 pr-3 text-right font-mono">
                {d.peso_bruto_kg.toLocaleString("pt-BR")} kg
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {d.peso_tara_kg.toLocaleString("pt-BR")} kg
              </td>
              <td className="py-2 pr-3 text-right font-mono font-semibold">
                {d.peso_liquido_kg.toLocaleString("pt-BR")} kg
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {d.litros_estimados
                  ? `≈ ${d.litros_estimados.toLocaleString("pt-BR")} L`
                  : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {d.umidade_pct !== null ? (
                  <span className="text-green-700">{d.umidade_pct}%</span>
                ) : (
                  <span className="text-yellow-700 italic text-xs">pendente</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <button
                  onClick={() => lancarUmidade(d)}
                  disabled={loadingId === d.id}
                  className="text-verde hover:underline text-sm"
                >
                  {d.umidade_pct !== null ? "Editar umidade" : "Lançar umidade"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
