"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Caminhao } from "@/lib/admin/queries";
import { FormCaminhao } from "./FormCaminhao";

export function TabelaCaminhoes({ caminhoes }: { caminhoes: Caminhao[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Caminhao | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggleAtivo(c: Caminhao) {
    const proximoAtivo = !c.ativo;
    let motivo: string | null = null;
    if (!proximoAtivo) {
      motivo = prompt(
        `Motivo pra desativar ${c.placa}:`,
        "Ex: quebrou · vendeu em agosto de 2026"
      );
      if (motivo === null) return;
    }
    setLoadingId(c.id);
    try {
      const res = await fetch(`/api/admin/caminhoes/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: proximoAtivo, motivo_inativo: motivo }),
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

  async function deletar(c: Caminhao) {
    if (!confirm(`Deletar caminhão ${c.placa}?`)) return;
    setLoadingId(c.id);
    try {
      const res = await fetch(`/api/admin/caminhoes/${c.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
    }
  }

  if (editando) {
    return (
      <FormCaminhao editando={editando} onFim={() => setEditando(null)} />
    );
  }

  return (
    <div className="card overflow-x-auto">
      {caminhoes.length === 0 ? (
        <p className="text-cinza-suave text-center py-6">
          Nenhum caminhão cadastrado ainda. Use o formulário acima.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-cinza-suave border-b border-cinza-borda">
              <th className="py-2 pr-3">Placa</th>
              <th className="py-2 pr-3">Marca / Modelo</th>
              <th className="py-2 pr-3">Cor</th>
              <th className="py-2 pr-3 text-right">Capacidade</th>
              <th className="py-2 pr-3 text-right">Tara</th>
              <th className="py-2 pr-3">Ativo</th>
              <th className="py-2 pr-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {caminhoes.map((c) => (
              <tr
                key={c.id}
                className={`border-b border-cinza-borda last:border-0 ${
                  c.ativo ? "" : "opacity-50"
                }`}
              >
                <td className="py-3 pr-3 font-mono font-semibold">{c.placa}</td>
                <td className="py-3 pr-3">
                  {c.marca}
                  {c.modelo ? ` ${c.modelo}` : ""}
                </td>
                <td className="py-3 pr-3">{c.cor}</td>
                <td className="py-3 pr-3 text-right font-mono">
                  {c.capacidade_l.toLocaleString("pt-BR")} L
                </td>
                <td className="py-3 pr-3 text-right font-mono">
                  {c.tara_kg.toLocaleString("pt-BR")} kg
                </td>
                <td className="py-3 pr-3">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.ativo}
                      disabled={loadingId === c.id}
                      onChange={() => toggleAtivo(c)}
                      className="w-5 h-5 cursor-pointer"
                    />
                    {!c.ativo && c.motivo_inativo && (
                      <span
                        className="text-xs text-cinza-suave italic max-w-[15ch] truncate"
                        title={c.motivo_inativo}
                      >
                        {c.motivo_inativo}
                      </span>
                    )}
                  </label>
                </td>
                <td className="py-3 pr-3">
                  <div className="flex flex-col gap-1 text-sm">
                    <button
                      onClick={() => setEditando(c)}
                      disabled={loadingId === c.id}
                      className="text-verde hover:underline text-left"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => deletar(c)}
                      disabled={loadingId === c.id}
                      className="text-alerta hover:underline text-left"
                    >
                      Deletar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
