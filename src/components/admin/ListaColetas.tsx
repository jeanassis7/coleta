"use client";

import { useState } from "react";
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
  const [selecionada, setSelecionada] = useState<Coleta | null>(null);

  if (coletas.length === 0) {
    return (
      <div className="card text-center text-cinza-suave py-12">
        Nenhuma coleta no período.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {coletas.map((c) => {
          const custoLitro = c.litros > 0 ? c.valor_pago / c.litros : 0;
          return (
            <button
              key={c.id}
              onClick={() => setSelecionada(c)}
              className="w-full card text-left hover:bg-slate-50 transition-colors"
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
                <div className="flex items-center gap-2 text-base">
                  {c.gps_capturado ? (
                    <span title={`±${Math.round(c.gps_accuracy || 0)}m`}>📍</span>
                  ) : (
                    <span className="text-cinza-suave" title="Sem GPS">📍❌</span>
                  )}
                  {c.foto_path ? <span>📷</span> : null}
                  {c.certificado_tipo !== "nao" ? (
                    <span title={c.certificado_tipo}>📄</span>
                  ) : null}
                </div>
              </div>
            </button>
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
