"use client";

import type { CargaAtivaCache } from "@/lib/types";

/**
 * Barra do caminhão com % de capacidade preenchida.
 * Cores: verde (0-79%), amarelo (80-100%), vermelho (>100%).
 * Aviso sutil quando >= 80% (não empurra pra descarregar — só informa).
 * Aviso quando >100% (provável esquecimento de finalizar carga anterior).
 */
export function BarraCaminhao({
  carga,
  litrosCarregados,
}: {
  carga: CargaAtivaCache;
  litrosCarregados: number;
}) {
  const pct = Math.round((litrosCarregados / carga.capacidade_l) * 100);
  const pctClamp = Math.min(pct, 100); // barra visualmente não passa de 100
  const cor =
    pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-verde";

  return (
    <div className="bg-white border border-cinza-borda rounded-2xl p-3 mb-4">
      <div className="text-sm text-cinza-suave mb-1">
        🚚 {carga.caminhao_placa} {carga.caminhao_marca} {carga.caminhao_cor}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 bg-slate-200 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full ${cor} transition-all`}
            style={{ width: `${pctClamp}%` }}
          />
        </div>
        <span className="text-sm font-mono font-semibold w-12 text-right">
          {pct}%
        </span>
      </div>
      <div className="text-xs text-cinza-suave">
        {litrosCarregados.toLocaleString("pt-BR")} L de{" "}
        {carga.capacidade_l.toLocaleString("pt-BR")} L
      </div>
      {pct >= 80 && pct <= 100 && (
        <div className="text-xs text-yellow-800 mt-2">
          Se você já descarregou, não esquece de finalizar
        </div>
      )}
      {pct > 100 && (
        <div className="text-xs text-red-700 mt-2 font-medium">
          Você passou da capacidade — provavelmente esqueceu de finalizar uma carga
        </div>
      )}
    </div>
  );
}
