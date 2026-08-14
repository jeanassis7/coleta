"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
} from "@/components/InputDinheiro";
import type {
  CompradorComSaldo,
  Venda,
  Recebimento,
  Cheque,
} from "@/lib/admin/queries";

const FORMA_ROTULO: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  cheque: "Cheque",
};

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface Linha {
  data: string;
  tipo: "venda" | "pagamento";
  descricao: string;
  valor: number;
  anulado?: boolean;
}

export function FichaComprador({
  comprador,
  vendas,
  recebimentos,
  cheques,
}: {
  comprador: CompradorComSaldo;
  vendas: Venda[];
  recebimentos: Recebimento[];
  cheques: Cheque[];
}) {
  const [pagando, setPagando] = useState(false);

  const chequePorRecebimento = new Map(cheques.map((c) => [c.recebimento_id, c]));
  const devolvidos = cheques.filter((c) => c.status === "devolvido");
  // A parte da dívida que NÃO é cheque voltado — é o resíduo das vendas.
  const residual = comprador.saldo - comprador.devolvido;

  const extrato: Linha[] = [
    ...vendas.map((v) => ({
      data: v.data,
      tipo: "venda" as const,
      descricao: `Venda · ${v.peso_total_kg.toLocaleString("pt-BR")} kg`,
      valor: v.valor_total,
    })),
    ...recebimentos.map((r) => {
      const ch = chequePorRecebimento.get(r.id);
      const anulado = ch?.status === "devolvido";
      return {
        data: r.data,
        tipo: "pagamento" as const,
        descricao:
          FORMA_ROTULO[r.forma] +
          (ch ? ` · ${ch.banco}${ch.numero ? ` nº ${ch.numero}` : ""}` : "") +
          (anulado ? ` — voltou em ${formatData(ch.devolvido_em || ch.bom_para)}` : ""),
        valor: r.valor,
        anulado,
      };
    }),
  ].sort((a, b) => (a.data < b.data ? 1 : -1));

  return (
    <>
      {/* O saldo se EXPLICA em linhas — número solto obriga a caçar o
          motivo no WhatsApp. */}
      <div className="card mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-cinza-suave">
            {comprador.saldo > 0
              ? "Deve"
              : comprador.saldo < 0
                ? "Tem crédito de"
                : "Está em dia"}
          </span>
          <span
            className={`text-3xl font-bold font-mono ${
              comprador.saldo > 0 ? "text-alerta" : comprador.saldo < 0 ? "text-verde" : ""
            }`}
          >
            {formatBRL(Math.abs(comprador.saldo))}
          </span>
        </div>

        {comprador.saldo !== 0 && (
          <div className="border-t border-cinza-borda pt-3 space-y-1 text-sm">
            {Math.abs(residual) > 0.009 && (
              <div className="flex justify-between">
                <span className="text-cinza-suave">
                  {residual > 0 ? "Resíduo de vendas em aberto" : "Pagou a mais"}
                </span>
                <span className="font-mono">{formatBRL(Math.abs(residual))}</span>
              </div>
            )}
            {devolvidos.map((c) => (
              <div key={c.id} className="flex justify-between">
                <span className="text-alerta">
                  Cheque {c.banco}
                  {c.numero ? ` nº ${c.numero}` : ""} devolvido
                  {c.devolvido_em ? ` em ${formatData(c.devolvido_em)}` : ""}
                </span>
                <span className="font-mono">{formatBRL(c.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!pagando && (
        <div className="mb-4">
          <button
            onClick={() => setPagando(true)}
            className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
          >
            + Registrar pagamento
          </button>
        </div>
      )}

      {pagando && (
        <FormPagamento
          compradorId={comprador.id}
          sugestao={Math.max(0, comprador.saldo)}
          onFim={() => setPagando(false)}
        />
      )}

      <div className="card overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Extrato</h2>
        {extrato.length === 0 ? (
          <p className="text-cinza-suave text-center py-6">
            Nada lançado ainda pra esse comprador.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3">O que foi</th>
                <th className="py-2 pr-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {extrato.map((l, i) => (
                <tr key={i} className="border-b border-cinza-borda">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatData(l.data)}</td>
                  <td className="py-2 pr-3">
                    <span className={l.anulado ? "text-cinza-suave line-through" : ""}>
                      {l.descricao}
                    </span>
                    {l.anulado && (
                      <span className="ml-2 text-xs text-alerta">
                        não conta no saldo
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 pr-3 text-right font-mono ${
                      l.anulado
                        ? "text-cinza-suave line-through"
                        : l.tipo === "venda"
                          ? "text-alerta"
                          : "text-verde"
                    }`}
                  >
                    {l.tipo === "venda" ? "+" : "−"}
                    {formatBRL(l.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function FormPagamento({
  compradorId,
  sugestao,
  onFim,
}: {
  compradorId: string;
  sugestao: number;
  onFim: () => void;
}) {
  const router = useRouter();
  const [forma, setForma] = useState<"pix" | "dinheiro" | "transferencia" | "cheque">(
    "pix"
  );
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    sugestao > 0 ? Math.round(sugestao * 100) : null
  );
  const [data, setData] = useState(hojeBr());
  const [banco, setBanco] = useState("");
  const [emitente, setEmitente] = useState("");
  const [numero, setNumero] = useState("");
  const [bomPara, setBomPara] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    if (forma === "cheque" && (!banco.trim() || !emitente.trim() || !bomPara)) {
      return setErro("Cheque precisa de banco, emitente e a data do 'bom para'");
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/recebimentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comprador_id: compradorId,
          forma,
          valor: centavosParaReais(valorCentavos),
          data,
          ...(forma === "cheque"
            ? {
                banco: banco.trim(),
                emitente: emitente.trim(),
                numero: numero.trim() || null,
                bom_para: bomPara,
              }
            : {}),
        }),
      });
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      router.refresh();
      onFim();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card mb-6 space-y-4">
      <h2 className="text-lg font-semibold">Registrar pagamento</h2>

      <div>
        <label className="block text-sm font-medium mb-1">Como entrou</label>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["pix", "Pix"],
              ["dinheiro", "Dinheiro"],
              ["transferencia", "Transferência"],
              ["cheque", "Cheque"],
            ] as const
          ).map(([v, r]) => (
            <button
              key={v}
              type="button"
              onClick={() => setForma(v)}
              className={`px-4 py-2 rounded-xl border-2 text-sm ${
                forma === v
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Valor</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Data</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
      </div>

      {forma === "cheque" && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50 border border-cinza-borda rounded-xl p-3">
          <input
            type="text"
            placeholder="Banco"
            className="px-3 py-2 border border-cinza-borda rounded-xl"
            value={banco}
            onChange={(e) => setBanco(e.target.value)}
          />
          <input
            type="text"
            placeholder="Quem emitiu"
            className="px-3 py-2 border border-cinza-borda rounded-xl"
            value={emitente}
            onChange={(e) => setEmitente(e.target.value)}
          />
          <input
            type="text"
            placeholder="Número (opcional)"
            className="px-3 py-2 border border-cinza-borda rounded-xl"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
          <input
            type="date"
            title="Bom para"
            className="px-3 py-2 border border-cinza-borda rounded-xl"
            value={bomPara}
            onChange={(e) => setBomPara(e.target.value)}
          />
        </div>
      )}

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onFim}
          disabled={salvando}
          className="px-4 py-2 rounded-xl border border-cinza-borda"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Registrar"}
        </button>
      </div>
    </div>
  );
}
