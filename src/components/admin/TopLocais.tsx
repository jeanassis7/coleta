"use client";

import { useState } from "react";
import { formatBRL, formatLitros } from "@/lib/format";
import type { LocalRanking } from "@/lib/admin/queries";

export function TopLocais({ dados }: { dados: LocalRanking[] }) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  if (dados.length === 0) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-2">Top locais por litros</h3>
        <p className="text-cinza-suave text-sm">Sem dados no período.</p>
      </div>
    );
  }

  const topLitros = dados[0].total_litros;

  function toggle(nome: string) {
    const s = new Set(expandidos);
    if (s.has(nome)) s.delete(nome);
    else s.add(nome);
    setExpandidos(s);
  }

  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="font-semibold">Top locais por litros</h3>
        <p className="text-xs text-cinza-suave">
          Onde tá saindo mais óleo. Clica na seta ▼ do local pra abrir e fechar a quebra por motorista.
        </p>
      </div>
      <div className="space-y-2">
        {dados.map((l, i) => {
          const pct = topLitros > 0 ? (l.total_litros / topLitros) * 100 : 0;
          const aberto = expandidos.has(l.local_nome);
          return (
            <div key={l.local_nome} className="border border-cinza-borda rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(l.local_nome)}
                className="w-full text-left p-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex justify-between items-center gap-3 mb-1">
                  <span className="font-semibold flex items-center gap-2">
                    <span className="text-cinza-suave text-sm">#{i + 1}</span>
                    {l.local_nome}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold text-base">
                      {formatLitros(l.total_litros)}
                    </span>
                    <span
                      aria-hidden
                      className={`flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-slate-100 text-cinza-suave text-xs transition-transform duration-200 ${
                        aberto ? "rotate-180 bg-verde/10 text-verde" : ""
                      }`}
                    >
                      ▼
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-verde"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex gap-3 text-xs text-cinza-suave">
                  <span>{l.visitas} {l.visitas === 1 ? "visita" : "visitas"}</span>
                  <span>{formatBRL(Math.round(l.total_pago))}</span>
                  <span>R$ {l.custo_medio.toFixed(2).replace(".", ",")}/L</span>
                </div>
              </button>

              {aberto && l.motoristas.length > 0 && (
                <div className="border-t border-cinza-borda bg-slate-50 p-3 space-y-1">
                  <p className="text-xs font-semibold text-cinza-suave mb-2">
                    Por motorista:
                  </p>
                  {l.motoristas.map((m) => (
                    <div
                      key={m.nome}
                      className="flex justify-between text-sm py-1"
                    >
                      <span>{m.nome}</span>
                      <span className="text-cinza-suave">
                        {m.visitas} {m.visitas === 1 ? "visita" : "visitas"} ·{" "}
                        <strong className="text-cinza-texto">
                          {formatLitros(m.litros)}
                        </strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
