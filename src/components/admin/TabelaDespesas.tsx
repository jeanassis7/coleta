"use client";

import { useState } from "react";
import Link from "next/link";
import { formatBRL, formatDataHora } from "@/lib/format";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { ModalEditarDespesa } from "@/components/admin/ModalEditarDespesa";
import { ModalApagarDespesa } from "@/components/admin/ModalApagarDespesa";
import type { DespesaAdmin } from "@/lib/admin/queries";

export function TabelaDespesas({ despesas }: { despesas: DespesaAdmin[] }) {
  const [editando, setEditando] = useState<DespesaAdmin | null>(null);
  const [apagando, setApagando] = useState<DespesaAdmin | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (despesas.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma despesa no período/filtro escolhido.
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
            <th className="py-2 pr-3">Descrição</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            <th className="py-2 pr-3 text-center">Foto</th>
            <th className="py-2 pr-3">Carga</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {despesas.map((d) => (
            <tr key={d.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">
                {formatDataHora(d.criado_em)}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {d.motorista_nome}
              </td>
              <td className="py-2 pr-3 font-mono">{d.caminhao_placa}</td>
              <td className="py-2 pr-3">
                {d.descricao}
                {!d.pago_na_hora && (
                  <span
                    className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium align-middle"
                    title="Assinou a nota / faturado: não saiu do bolso do motorista. A conta a pagar nasceu sozinha — está em Contas a pagar."
                  >
                    assinou a nota
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono">{formatBRL(d.valor)}</td>
              <td className="py-2 pr-3 text-center">
                <VisualizadorFoto
                  path={d.foto_path}
                  legenda={`${d.descricao} · ${d.motorista_nome} · ${formatDataHora(d.criado_em)}`}
                />
              </td>
              <td className="py-2 pr-3">
                <Link
                  href={`/admin/cargas/${d.carga_id}`}
                  className="text-verde hover:underline text-sm"
                >
                  ver
                </Link>
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => setEditando(d)}
                    className="text-verde hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setApagando(d)}
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
        <ModalEditarDespesa
          despesa={editando}
          onFechar={() => setEditando(null)}
          onAviso={setAviso}
        />
      )}

      {apagando && (
        <ModalApagarDespesa
          despesa={apagando}
          onFechar={() => setApagando(null)}
          onAviso={setAviso}
        />
      )}
    </div>
  );
}
