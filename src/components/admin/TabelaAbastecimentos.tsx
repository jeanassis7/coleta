"use client";

import { useState } from "react";
import Link from "next/link";
import { formatBRL, formatDataHora } from "@/lib/format";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { ModalEditarAbastecimento } from "@/components/admin/ModalEditarAbastecimento";
import { ModalApagarAbastecimento } from "@/components/admin/ModalApagarAbastecimento";
import type { AbastecimentoAdmin } from "@/lib/admin/queries";

export function TabelaAbastecimentos({
  abastecimentos,
}: {
  abastecimentos: AbastecimentoAdmin[];
}) {
  const [editando, setEditando] = useState<AbastecimentoAdmin | null>(null);
  const [apagando, setApagando] = useState<AbastecimentoAdmin | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (abastecimentos.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhum abastecimento no período/filtro escolhido.
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
            <th className="py-2 pr-3">Posto</th>
            <th className="py-2 pr-3 text-right">Litros</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            <th className="py-2 pr-3 text-right">R$/L</th>
            <th className="py-2 pr-3 text-right">Km</th>
            <th className="py-2 pr-3 text-center">Foto</th>
            <th className="py-2 pr-3">Carga</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {abastecimentos.map((a) => (
            <tr key={a.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">
                {formatDataHora(a.criado_em)}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {a.motorista_nome}
              </td>
              <td className="py-2 pr-3 font-mono">{a.caminhao_placa}</td>
              <td className="py-2 pr-3">
                {a.posto_nome}
                {a.tipo === "arla" && (
                  <span
                    className="ml-2 inline-block px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-xs font-medium align-middle"
                    title="ARLA 32 — não é combustível: fica fora do km/L calculado do caminhão."
                  >
                    ARLA
                  </span>
                )}
                {!a.pago_na_hora && (
                  <span
                    className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium align-middle"
                    title="O motorista assinou a nota: o posto cobra da empresa depois. A conta a pagar nasceu sozinha — está em Contas a pagar."
                  >
                    assinou a nota
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {a.litros.toLocaleString("pt-BR")} L
              </td>
              <td className="py-2 pr-3 text-right font-mono">{formatBRL(a.valor)}</td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {a.litros > 0 ? formatBRL(a.valor / a.litros) : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {a.km_atual.toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-3 text-center">
                <VisualizadorFoto
                  path={a.foto_path}
                  legenda={`Cupom · ${a.posto_nome} · ${a.motorista_nome} · ${formatDataHora(a.criado_em)}`}
                />
              </td>
              <td className="py-2 pr-3">
                <Link
                  href={`/admin/cargas/${a.carga_id}`}
                  className="text-verde hover:underline text-sm"
                >
                  ver
                </Link>
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => setEditando(a)}
                    className="text-verde hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setApagando(a)}
                    className="text-alerta hover:underline"
                  >
                    Apagar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {aviso && (
        <div className="mt-3 bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {aviso}
        </div>
      )}

      {editando && (
        <ModalEditarAbastecimento
          abastecimento={editando}
          onFechar={() => setEditando(null)}
          onAviso={setAviso}
        />
      )}

      {apagando && (
        <ModalApagarAbastecimento
          abastecimento={apagando}
          onFechar={() => setApagando(null)}
          onAviso={setAviso}
        />
      )}
    </div>
  );
}
