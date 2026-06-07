"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";
import { DrawerDetalhe } from "@/components/admin/DrawerDetalhe";

interface Coleta {
  id: string;
  client_id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  valor_pago: number;
  certificado_tipo: string;
  litros_certificado: number | null;
  observacao: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  foto_path: string | null;
  criado_em: string;
  sincronizado_em: string | null;
  profiles: { nome: string } | null;
}

export function ListaColetas({ coletas }: { coletas: Coleta[] }) {
  const router = useRouter();
  const [selecionada, setSelecionada] = useState<Coleta | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [apagando, setApagando] = useState(false);

  if (coletas.length === 0) {
    return (
      <div className="card text-center text-cinza-suave py-12">
        Nenhuma coleta no período.
      </div>
    );
  }

  function toggleMarcada(id: string) {
    const nova = new Set(marcadas);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    setMarcadas(nova);
  }

  function toggleTodas() {
    if (marcadas.size === coletas.length) {
      setMarcadas(new Set());
    } else {
      setMarcadas(new Set(coletas.map((c) => c.id)));
    }
  }

  async function apagarMarcadas() {
    if (marcadas.size === 0) return;
    const confirma = prompt(
      `Vai apagar ${marcadas.size} ${marcadas.size === 1 ? "coleta" : "coletas"} permanentemente (incluindo fotos). Digite APAGAR pra confirmar:`
    );
    if (confirma !== "APAGAR") {
      if (confirma !== null) alert("Confirmação errada, cancelado.");
      return;
    }
    setApagando(true);
    try {
      const res = await fetch("/api/admin/coletas/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(marcadas) }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Erro: " + data.error);
      } else {
        alert(
          `${data.apagadas} coleta(s) apagadas${data.fotos_apagadas > 0 ? ` (${data.fotos_apagadas} fotos)` : ""}.`
        );
        setMarcadas(new Set());
        router.refresh();
      }
    } finally {
      setApagando(false);
    }
  }

  const todasMarcadas = marcadas.size === coletas.length;

  return (
    <>
      {/* Barra de bulk action */}
      <div className="card mb-3 flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={toggleTodas}
            className="w-5 h-5"
          />
          <span className="text-sm">
            {marcadas.size === 0
              ? "Selecionar todas"
              : `${marcadas.size} de ${coletas.length} selecionadas`}
          </span>
        </label>
        {marcadas.size > 0 && (
          <button
            onClick={apagarMarcadas}
            disabled={apagando}
            className="px-4 py-2 bg-alerta text-white rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50"
          >
            {apagando
              ? "Apagando..."
              : `🗑 Apagar ${marcadas.size} ${marcadas.size === 1 ? "coleta" : "coletas"}`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {coletas.map((c) => {
          const custoLitro = c.litros > 0 ? c.valor_pago / c.litros : 0;
          const marcada = marcadas.has(c.id);
          return (
            <div
              key={c.id}
              className={`card flex gap-3 items-start ${
                marcada ? "border-alerta bg-alerta/5" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={marcada}
                onChange={() => toggleMarcada(c.id)}
                className="w-5 h-5 mt-1 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setSelecionada(c)}
                className="flex-1 min-w-0 text-left hover:bg-slate-50 -m-2 p-2 rounded transition-colors"
              >
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">
                      {formatDataHora(c.criado_em)} · {c.profiles?.nome || "—"} · {c.local_nome}
                    </p>
                    <p className="text-base text-cinza-suave">
                      {formatLitros(c.litros)} · {formatBRL(c.valor_pago)} · R$ {custoLitro.toFixed(2).replace(".", ",")}/L
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-base shrink-0">
                    {c.gps_capturado ? (
                      <span title={`±${Math.round(c.gps_accuracy || 0)}m`}>📍</span>
                    ) : (
                      <span className="text-cinza-suave" title="Sem GPS">📍❌</span>
                    )}
                    {c.foto_path ? <span>📷</span> : null}
                    {c.certificado_tipo !== "nao" ? (
                      <span title={c.certificado_tipo}>📄</span>
                    ) : null}
                    {c.observacao ? <span title="Tem observação">💬</span> : null}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {selecionada && (
        <DrawerDetalhe
          coleta={selecionada}
          onClose={() => setSelecionada(null)}
        />
      )}
    </>
  );
}
