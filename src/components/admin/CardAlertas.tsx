"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatData } from "@/lib/format";
import type { Alerta } from "@/lib/admin/alertas";

const CORES: Record<string, string> = {
  alta: "bg-red-50 border-red-300",
  media: "bg-yellow-50 border-yellow-300",
  info: "bg-blue-50 border-blue-200",
};

/**
 * Card de alertas do dashboard. Some inteiro quando não há nenhum.
 * Cada alerta tem "OK, VI" — dispensa aquela ocorrência pra sempre.
 */
export function CardAlertas({ alertas }: { alertas: Alerta[] }) {
  const router = useRouter();
  const [dispensando, setDispensando] = useState<string | null>(null);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());

  const visiveis = alertas.filter((a) => !ocultos.has(a.chave));
  if (visiveis.length === 0) return null;

  async function dispensar(chave: string) {
    setDispensando(chave);
    try {
      const res = await fetch("/api/admin/alertas/visto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave }),
      });
      if (res.ok) {
        setOcultos((s) => new Set(s).add(chave));
        router.refresh();
      }
    } finally {
      setDispensando(null);
    }
  }

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">
        ⚠️ Alertas ({visiveis.length})
      </h2>
      <div className="space-y-3">
        {visiveis.map((a) => (
          <div
            key={a.chave}
            className={`border rounded-2xl p-4 ${CORES[a.severidade] || CORES.info}`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[16rem]">
                <p className="font-bold mb-1">
                  {a.icone} {a.titulo}
                </p>
                <p className="text-sm leading-relaxed">{a.texto}</p>
                <div className="flex items-center gap-3 mt-2 text-sm">
                  {a.data && (
                    <span className="text-cinza-suave">
                      📅 {formatData(a.data)}
                    </span>
                  )}
                  {a.link && (
                    <Link
                      href={a.link.href}
                      className="text-verde font-medium hover:underline"
                    >
                      {a.link.label} →
                    </Link>
                  )}
                </div>
              </div>
              <button
                onClick={() => dispensar(a.chave)}
                disabled={dispensando === a.chave}
                className="px-3 py-1.5 rounded-lg bg-white border border-cinza-borda text-sm font-medium hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                title="Some com esse alerta. Se acontecer de novo em outro registro, ele volta."
              >
                {dispensando === a.chave ? "..." : "OK, VI"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
