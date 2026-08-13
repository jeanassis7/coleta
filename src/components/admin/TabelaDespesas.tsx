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
import type { DespesaAdmin } from "@/lib/admin/queries";

export function TabelaDespesas({ despesas }: { despesas: DespesaAdmin[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<DespesaAdmin | null>(null);
  const [apagando, setApagando] = useState<DespesaAdmin | null>(null);
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function apagar(d: DespesaAdmin) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/despesas/${d.id}`, { method: "DELETE" });
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
                {d.motorista_is_teste && (
                  <span title="Motorista de teste — invisível pro admin"> 🧪</span>
                )}
              </td>
              <td className="py-2 pr-3 font-mono">{d.caminhao_placa}</td>
              <td className="py-2 pr-3">{d.descricao}</td>
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
        <ModalEditarDespesa despesa={editando} onFechar={() => setEditando(null)} />
      )}

      {apagando && (
        <ModalConfirmar
          titulo="Apagar essa despesa?"
          descricao={`"${apagando.descricao}" · ${formatBRL(apagando.valor)} · ${apagando.motorista_nome}. A foto do comprovante também será apagada. Atenção: o saldo do motorista vai AUMENTAR ${formatBRL(apagando.valor)}, porque esse gasto deixa de contar.`}
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

function ModalEditarDespesa({
  despesa,
  onFechar,
}: {
  despesa: DespesaAdmin;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [descricao, setDescricao] = useState(despesa.descricao);
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    reaisParaCentavos(despesa.valor)
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (descricao.trim().length < 3) return setErro("Descrição muito curta");
    if (valorCentavos === null || valorCentavos <= 0) return setErro("Valor inválido");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/despesas/${despesa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: descricao.trim(),
          valor: centavosParaReais(valorCentavos),
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
        <h2 className="text-lg font-bold">Editar despesa</h2>
        <p className="text-sm text-cinza-suave">
          {despesa.motorista_nome} · {formatDataHora(despesa.criado_em)}
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">Descrição</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
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
