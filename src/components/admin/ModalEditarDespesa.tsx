"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDataHora } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
  reaisParaCentavos,
} from "@/components/InputDinheiro";
import type { DespesaAdmin } from "@/lib/admin/queries";

/**
 * Editar uma despesa lançada pelo motorista.
 *
 * Mora em arquivo próprio porque tem DOIS donos: a tabela de
 * /admin/despesas e a linha do tempo da carga. Duplicar a tela duplicaria a
 * regra de dinheiro (a despesa pode ter conta a pagar amarrada) — foi
 * exatamente o motivo de a coleta reusar o DrawerDetalhe em vez de
 * reimplementar.
 */
export function ModalEditarDespesa({
  despesa,
  onFechar,
  onAviso,
}: {
  despesa: DespesaAdmin;
  onFechar: () => void;
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [descricao, setDescricao] = useState(despesa.descricao);
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    reaisParaCentavos(despesa.valor)
  );
  const [pagoNaHora, setPagoNaHora] = useState(despesa.pago_na_hora);
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
          pago_na_hora: pagoNaHora,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      onAviso(data.aviso || null);
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
        <div>
          <label className="block text-sm font-medium mb-1">Como foi pago</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPagoNaHora(true)}
              className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm ${
                pagoNaHora
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              Pagou na hora
            </button>
            <button
              type="button"
              onClick={() => setPagoNaHora(false)}
              className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm ${
                !pagoNaHora
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-white border-cinza-borda"
              }`}
            >
              Assinou a nota
            </button>
          </div>
          {pagoNaHora !== despesa.pago_na_hora && (
            <p className="text-xs bg-amber-50 border border-amber-300 rounded-lg p-2 mt-2">
              {pagoNaHora
                ? "Trocando pra PAGOU NA HORA: volta a descontar do saldo do motorista e a conta a pagar é removida. Se a conta já foi paga, o sistema recusa."
                : "Trocando pra ASSINOU A NOTA: sai do saldo do motorista e vira dívida em Contas a pagar (vencimento dia 1 do mês que vem)."}
            </p>
          )}
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
