"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDataHora } from "@/lib/format";
import type { CargaDetalhada } from "@/lib/admin/queries";

interface UmidadeModalDados {
  descargaId: string;
  motorista: string;
  data: string;
  atual: number | null;
}

type SortKey =
  | "data"
  | "motorista"
  | "caminhao"
  | "coletas"
  | "peso_liquido"
  | "litros"
  | "custo_total"
  | "status";

export function TabelaCargas({ cargas }: { cargas: CargaDetalhada[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("data");
  const [asc, setAsc] = useState(false);
  const [umidadeModal, setUmidadeModal] = useState<UmidadeModalDados | null>(
    null
  );

  const sorted = [...cargas].sort((a, b) => {
    const dir = asc ? 1 : -1;
    switch (sortBy) {
      case "data":
        return (a.iniciada_em || "").localeCompare(b.iniciada_em || "") * dir;
      case "motorista":
        return a.motorista_nome.localeCompare(b.motorista_nome) * dir;
      case "caminhao":
        return a.caminhao_placa.localeCompare(b.caminhao_placa) * dir;
      case "coletas":
        return (a.total_coletas - b.total_coletas) * dir;
      case "peso_liquido":
        return (
          ((a.descarga?.peso_liquido_kg || 0) - (b.descarga?.peso_liquido_kg || 0)) *
          dir
        );
      case "litros":
        return ((a.total_litros_coletas - b.total_litros_coletas) as number) * dir;
      case "custo_total": {
        const ca = a.total_valor_coletas + a.total_valor_despesas + a.total_valor_abastecimentos;
        const cb = b.total_valor_coletas + b.total_valor_despesas + b.total_valor_abastecimentos;
        return (ca - cb) * dir;
      }
      case "status":
        return a.status.localeCompare(b.status) * dir;
    }
  });

  function ordenar(key: SortKey) {
    if (sortBy === key) setAsc(!asc);
    else {
      setSortBy(key);
      setAsc(false);
    }
  }

  function th(label: string, key: SortKey, right = false) {
    return (
      <th
        onClick={() => ordenar(key)}
        className={`py-2 pr-3 cursor-pointer select-none hover:text-verde ${
          right ? "text-right" : "text-left"
        }`}
      >
        {label}
        {sortBy === key && <span className="ml-1">{asc ? "▲" : "▼"}</span>}
      </th>
    );
  }

  if (cargas.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma carga registrada ainda.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[1200px]">
        <thead>
          <tr className="text-cinza-suave border-b border-cinza-borda sticky top-0 bg-white">
            {th("Data", "data")}
            {th("Caminhão", "caminhao")}
            {th("Motorista", "motorista")}
            <th className="py-2 pr-3 text-left">Fim</th>
            <th className="py-2 pr-3 text-right">Km rodado</th>
            {th("Coletas", "coletas", true)}
            {th("Litros decl.", "litros", true)}
            <th className="py-2 pr-3 text-right">Peso bruto</th>
            <th className="py-2 pr-3 text-right">Tara</th>
            {th("Peso líq.", "peso_liquido", true)}
            <th className="py-2 pr-3 text-right">Litros (est.)</th>
            <th className="py-2 pr-3 text-right">Umid.</th>
            <th className="py-2 pr-3 text-right">$ coletas</th>
            <th className="py-2 pr-3 text-right">N desp.</th>
            <th className="py-2 pr-3 text-right">$ desp.</th>
            <th className="py-2 pr-3 text-right">N abast.</th>
            <th className="py-2 pr-3 text-right">$ abast.</th>
            {th("$ total", "custo_total", true)}
            {th("Status", "status")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const kmRodado =
              c.km_final !== null && c.km_final > c.km_inicial
                ? c.km_final - c.km_inicial
                : null;
            const custoTotal =
              c.total_valor_coletas +
              c.total_valor_despesas +
              c.total_valor_abastecimentos;
            return (
              <tr
                key={c.id}
                className="border-b border-cinza-borda hover:bg-slate-50"
              >
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatDataHora(c.iniciada_em)}
                </td>
                <td className="py-2 pr-3 font-mono">
                  {c.caminhao_placa}{" "}
                  <span className="text-cinza-suave">{c.caminhao_marca}</span>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.motorista_nome}
                  {c.motorista_is_teste && (
                    <span title="Motorista de teste — invisível pro admin"> 🧪</span>
                  )}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {c.encerrada_em ? formatDataHora(c.encerrada_em) : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {kmRodado !== null ? `${kmRodado} km` : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_coletas}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_litros_coletas.toLocaleString("pt-BR")} L
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.descarga
                    ? `${c.descarga.peso_bruto_kg.toLocaleString("pt-BR")} kg`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                  {/* Antes da descarga, mostra a tara do CADASTRO do caminhão */}
                  {(c.descarga?.peso_tara_kg ?? c.caminhao_tara_kg) > 0
                    ? `${(c.descarga?.peso_tara_kg ?? c.caminhao_tara_kg).toLocaleString("pt-BR")} kg`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  {c.descarga
                    ? `${c.descarga.peso_liquido_kg.toLocaleString("pt-BR")} kg`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                  {c.descarga?.litros_estimados
                    ? `≈ ${c.descarga.litros_estimados.toLocaleString("pt-BR")} L`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.descarga ? (
                    <button
                      onClick={() =>
                        setUmidadeModal({
                          descargaId: c.descarga!.id,
                          motorista: c.motorista_nome,
                          data: formatDataHora(c.descarga!.criado_em),
                          atual: c.descarga!.umidade_pct,
                        })
                      }
                      className="hover:underline"
                      title="Clique pra lançar/editar a umidade"
                    >
                      {c.descarga.umidade_pct !== null &&
                      c.descarga.umidade_pct !== undefined ? (
                        <span className="text-green-700">
                          {c.descarga.umidade_pct}%
                        </span>
                      ) : (
                        <span className="text-verde font-sans text-xs font-semibold">
                          lançar
                        </span>
                      )}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  R$ {c.total_valor_coletas.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_despesas}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  R$ {c.total_valor_despesas.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_abastecimentos}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  R$ {c.total_valor_abastecimentos.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  R$ {custoTotal.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {umidadeModal && (
        <ModalUmidade
          dados={umidadeModal}
          onClose={() => setUmidadeModal(null)}
        />
      )}
    </div>
  );
}

/**
 * Modal DO APP pra lançar/editar umidade — nada de prompt() do navegador.
 * (Futuro: vira uma tela dedicada com mais contexto da descarga.)
 */
function ModalUmidade({
  dados,
  onClose,
}: {
  dados: UmidadeModalDados;
  onClose: () => void;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(
    dados.atual !== null ? String(dados.atual).replace(".", ",") : ""
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(valor: number | null) {
    if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) {
      setErro("Umidade deve ser um número entre 0 e 100");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/descargas/${dados.descargaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ umidade_pct: valor }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold">Umidade da descarga</h2>
        <p className="text-sm text-cinza-suave">
          {dados.motorista} · {dados.data}
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">Umidade (%)</label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-lg"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="ex: 12,5"
            autoFocus
          />
        </div>
        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}
        <div className="flex gap-2 justify-between items-center">
          {dados.atual !== null ? (
            <button
              onClick={() => salvar(null)}
              disabled={salvando}
              className="text-sm text-alerta hover:underline"
            >
              Apagar umidade
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-cinza-borda"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                const n = Number(texto.trim().replace(",", "."));
                if (texto.trim() === "") {
                  setErro("Digite a umidade — ou use 'Apagar umidade'");
                  return;
                }
                salvar(n);
              }}
              disabled={salvando}
              className="px-5 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ativa"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : status === "encerrada"
        ? "bg-green-100 text-green-800 border-green-300"
        : "bg-slate-100 text-slate-600 border-slate-300";
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}
    >
      {status}
    </span>
  );
}
