"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBRL, formatDataHora } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
  reaisParaCentavos,
} from "@/components/InputDinheiro";
import { VisualizadorFoto } from "@/components/admin/VisualizadorFoto";
import { ModalConfirmar } from "@/components/admin/Modais";
import type { AbastecimentoAdmin } from "@/lib/admin/queries";

export function TabelaAbastecimentos({
  abastecimentos,
}: {
  abastecimentos: AbastecimentoAdmin[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<AbastecimentoAdmin | null>(null);
  const [apagando, setApagando] = useState<AbastecimentoAdmin | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function apagar(a: AbastecimentoAdmin) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/abastecimentos/${a.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setAviso("Erro: " + data.error);
        setTimeout(() => setAviso(null), 8000);
      } else {
        router.refresh();
      }
    } finally {
      setLoading(false);
      setApagando(null);
    }
  }

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
              <td className="py-2 pr-3">{a.posto_nome}</td>
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
        />
      )}

      {apagando && (
        <ModalConfirmar
          titulo="Apagar esse abastecimento?"
          descricao={`${apagando.posto_nome} · ${formatBRL(apagando.valor)} · ${apagando.motorista_nome}. A foto do cupom também será apagada. Atenção: o saldo do motorista vai AUMENTAR ${formatBRL(apagando.valor)}, porque esse gasto deixa de contar.`}
          confirmarLabel="Apagar"
          perigo
          carregando={loading}
          onConfirmar={() => apagar(apagando)}
          onFechar={() => setApagando(null)}
        />
      )}
    </div>
  );
}

function ModalEditarAbastecimento({
  abastecimento,
  onFechar,
}: {
  abastecimento: AbastecimentoAdmin;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [posto, setPosto] = useState(abastecimento.posto_nome);
  const [litrosTexto, setLitrosTexto] = useState(
    String(abastecimento.litros).replace(".", ",")
  );
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    reaisParaCentavos(abastecimento.valor)
  );
  const [kmTexto, setKmTexto] = useState(String(abastecimento.km_atual));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    const litros = Number(litrosTexto.trim().replace(",", "."));
    const km = Number(kmTexto);
    if (!posto.trim()) return setErro("Posto obrigatório");
    if (!Number.isFinite(litros) || litros <= 0) return setErro("Litros inválido");
    if (valorCentavos === null || valorCentavos <= 0) return setErro("Valor inválido");
    if (!Number.isFinite(km) || km <= 0) return setErro("Km inválido");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/abastecimentos/${abastecimento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posto_nome: posto.trim(),
          litros,
          valor: centavosParaReais(valorCentavos),
          km_atual: Math.round(km),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      router.refresh();
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-bold">Editar abastecimento</h2>
        <p className="text-sm text-cinza-suave">
          {abastecimento.motorista_nome} ·{" "}
          {formatDataHora(abastecimento.criado_em)}
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">Posto</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={posto}
            onChange={(e) => setPosto(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Litros</label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={litrosTexto}
              onChange={(e) => setLitrosTexto(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Km</label>
            <input
              type="number"
              inputMode="numeric"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={kmTexto}
              onChange={(e) => setKmTexto(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>
        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onFechar}
            disabled={salvando}
            className="px-4 py-2 rounded-xl border border-cinza-borda"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="px-5 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
