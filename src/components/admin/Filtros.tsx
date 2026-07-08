"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

interface Motorista {
  id: string;
  nome: string;
  ativo: boolean;
}

export function Filtros({
  motoristas,
  intervaloLabel,
}: {
  motoristas: Motorista[];
  intervaloLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const periodo = params.get("periodo") || "mes";
  const motorista = params.get("motorista") || "todos";
  const inicio = params.get("inicio") || "";
  const fim = params.get("fim") || "";

  const updateParam = useCallback(
    (key: string, value: string) => {
      const p = new URLSearchParams(params);
      p.set(key, value);
      router.push(`${pathname}?${p.toString()}`);
    },
    [params, pathname, router]
  );

  const botoes: { key: string; label: string }[] = [
    { key: "hoje", label: "Hoje" },
    { key: "semana", label: "Semana" },
    { key: "mes", label: "Mês" },
    { key: "customizado", label: "Customizado" },
  ];

  const explicacao: Record<string, string> = {
    hoje: "só o dia de hoje",
    semana: "esta semana (de domingo a sábado)",
    mes: "este mês inteiro (do dia 1 ao último dia)",
    customizado: "o intervalo que você escolher",
  };

  return (
    <div className="card mb-6 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-cinza-suave mr-2">Período:</span>
        {botoes.map((b) => (
          <button
            key={b.key}
            onClick={() => updateParam("periodo", b.key)}
            className={`px-4 py-2 rounded-xl text-base font-medium transition-colors ${
              periodo === b.key
                ? "bg-verde text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {intervaloLabel && (
        <div className="flex items-start gap-2 text-sm bg-slate-50 border border-cinza-borda rounded-xl px-3 py-2">
          <span aria-hidden>📅</span>
          <span>
            Mostrando <strong>{intervaloLabel}</strong>
            {explicacao[periodo] && (
              <span className="text-cinza-suave">
                {" "}
                ({explicacao[periodo]})
              </span>
            )}
          </span>
        </div>
      )}

      {periodo === "customizado" && (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={inicio}
            onChange={(e) => updateParam("inicio", e.target.value)}
            className="px-3 py-2 border border-cinza-borda rounded-xl"
          />
          <span>até</span>
          <input
            type="date"
            value={fim}
            onChange={(e) => updateParam("fim", e.target.value)}
            className="px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-cinza-suave mr-2">Motorista:</span>
        <select
          value={motorista}
          onChange={(e) => updateParam("motorista", e.target.value)}
          className="px-3 py-2 border border-cinza-borda rounded-xl"
        >
          <option value="todos">Todos</option>
          {motoristas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
