"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

interface Opcao {
  id: string;
  nome: string;
}

/**
 * Filtros das abas de operação (Despesas, Abastecimentos).
 * Período + motorista + caminhão, tudo na URL (link filtrado é
 * compartilhável e o F5 mantém o filtro).
 */
export function FiltrosOperacao({
  motoristas,
  caminhoes,
  resumo,
}: {
  motoristas: Opcao[];
  caminhoes?: Opcao[];
  /** Linha de totais do período — ex: "23 lançamentos · R$ 4.820" */
  resumo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const periodo = params.get("periodo") || "mes";
  const motorista = params.get("motorista") || "todos";
  const caminhao = params.get("caminhao") || "todos";
  const inicio = params.get("inicio") || "";
  const fim = params.get("fim") || "";

  const set = useCallback(
    (key: string, value: string) => {
      const p = new URLSearchParams(params);
      p.set(key, value);
      router.push(`${pathname}?${p.toString()}`);
    },
    [params, pathname, router]
  );

  const botoes = [
    { key: "hoje", label: "Hoje" },
    { key: "semana", label: "Semana" },
    { key: "mes", label: "Mês" },
    { key: "customizado", label: "Escolher datas" },
    { key: "tudo", label: "Tudo" },
  ];

  return (
    <div className="card mb-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-cinza-suave mr-1">Período:</span>
        {botoes.map((b) => (
          <button
            key={b.key}
            onClick={() => set("periodo", b.key)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              periodo === b.key
                ? "bg-verde text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {periodo === "customizado" && (
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <input
            type="date"
            value={inicio}
            onChange={(e) => set("inicio", e.target.value)}
            className="px-3 py-1.5 border border-cinza-borda rounded-xl"
          />
          <span>até</span>
          <input
            type="date"
            value={fim}
            onChange={(e) => set("fim", e.target.value)}
            className="px-3 py-1.5 border border-cinza-borda rounded-xl"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-cinza-suave">Motorista:</span>
          <select
            value={motorista}
            onChange={(e) => set("motorista", e.target.value)}
            className="px-3 py-1.5 border border-cinza-borda rounded-xl text-sm"
          >
            <option value="todos">Todos</option>
            {motoristas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </div>

        {caminhoes && caminhoes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-cinza-suave">Caminhão:</span>
            <select
              value={caminhao}
              onChange={(e) => set("caminhao", e.target.value)}
              className="px-3 py-1.5 border border-cinza-borda rounded-xl text-sm"
            >
              <option value="todos">Todos</option>
              {caminhoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {resumo && (
        <div className="bg-slate-50 border border-cinza-borda rounded-xl px-3 py-2 text-sm">
          📊 {resumo}
        </div>
      )}
    </div>
  );
}
