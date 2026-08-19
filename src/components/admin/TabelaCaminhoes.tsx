"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Caminhao } from "@/lib/admin/queries";
import { FormCaminhao } from "./FormCaminhao";
import { ModalConfirmar, ModalInputTexto } from "./Modais";

export function TabelaCaminhoes({ caminhoes }: { caminhoes: Caminhao[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Caminhao | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [modalMotivo, setModalMotivo] = useState<Caminhao | null>(null);
  const [modalDeletar, setModalDeletar] = useState<Caminhao | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function executarToggle(
    c: Caminhao,
    ativo: boolean,
    motivo: string | null
  ) {
    setLoadingId(c.id);
    setErroAcao(null);
    try {
      const res = await fetch(`/api/admin/caminhoes/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo, motivo_inativo: motivo }),
      });
      if (!res.ok) {
        const err = await res.json();
        setErroAcao("Erro: " + err.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
      setModalMotivo(null);
    }
  }

  function toggleAtivo(c: Caminhao) {
    if (c.ativo) {
      // Desativar exige motivo — modal do app
      setModalMotivo(c);
    } else {
      executarToggle(c, true, null);
    }
  }

  async function executarDeletar(c: Caminhao) {
    setLoadingId(c.id);
    setErroAcao(null);
    try {
      const res = await fetch(`/api/admin/caminhoes/${c.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setErroAcao("Erro: " + data.error);
      } else {
        router.refresh();
      }
    } finally {
      setLoadingId(null);
      setModalDeletar(null);
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
                <td className="py-3 pr-3 font-mono font-semibold">
                  <Link
                    href={`/admin/caminhoes/${c.id}`}
                    className="text-verde hover:underline"
                  >
                    {c.placa}
                  </Link>
                </td>
                <td className="py-3 pr-3">
                  {c.marca}
                  {c.modelo ? ` ${c.modelo}` : ""}
                </td>
                <td className="py-3 pr-3">{c.cor}</td>
                {/* Carro não tem tara nem capacidade — o CHECK da 0018 só
                    exige essas duas de veículo do tipo caminhão. */}
                <td className="py-3 pr-3 text-right font-mono">
                  {c.capacidade_l !== null
                    ? `${c.capacidade_l.toLocaleString("pt-BR")} L`
                    : "—"}
                </td>
                <td className="py-3 pr-3 text-right font-mono">
                  {c.tara_kg !== null
                    ? `${c.tara_kg.toLocaleString("pt-BR")} kg`
                    : "—"}
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
                      onClick={() => setModalDeletar(c)}
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

      {erroAcao && (
        <div className="mt-3 bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erroAcao}
        </div>
      )}

      {modalMotivo && (
        <ModalInputTexto
          titulo={`Desativar ${modalMotivo.placa}`}
          descricao="Qual o motivo? Fica registrado no cadastro."
          placeholder="Ex: quebrou · vendeu em agosto de 2026"
          confirmarLabel="Desativar"
          perigo
          carregando={loadingId === modalMotivo.id}
          validar={(v) => (v.trim().length >= 3 ? null : "Escreve o motivo")}
          onConfirmar={(motivo) => executarToggle(modalMotivo, false, motivo.trim())}
          onFechar={() => setModalMotivo(null)}
        />
      )}

      {modalDeletar && (
        <ModalConfirmar
          titulo={`Deletar caminhão ${modalDeletar.placa}?`}
          descricao="Só é possível se ele nunca teve carga. Se já rodou, desative em vez de deletar."
          confirmarLabel="Deletar"
          perigo
          carregando={loadingId === modalDeletar.id}
          onConfirmar={() => executarDeletar(modalDeletar)}
          onFechar={() => setModalDeletar(null)}
        />
      )}
    </div>
  );
}
