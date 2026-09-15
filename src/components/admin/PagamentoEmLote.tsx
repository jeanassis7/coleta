"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import { ModalConfirmar } from "@/components/admin/Modais";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import type { ContaAPagar, Cheque } from "@/lib/admin/queries";

/**
 * PAGAR VÁRIAS CONTAS DE UMA VEZ, COM VÁRIOS MEIOS.
 *
 * "Às vezes 3 contas dão R$ 1.000 e um cheque de R$ 1.000 paga. Às vezes 1
 * conta dá R$ 1.000 e cheque de 600 + outro de 400 paga." (Evaner, 15/09)
 *
 * A tela faz a conta na cara do gestor ANTES de ele confirmar: quanto está
 * selecionado, quanto está sendo pago, e o que sobra ou falta. O troco não é
 * campo escondido — ele APARECE no instante em que o pagamento passa do
 * total, com o valor já calculado. Mesmo desenho do fechamento do posto, que
 * é a peça que já provou funcionar.
 *
 * O identificador do acerto é gerado AQUI, no navegador, e vai junto: se a
 * resposta se perder e o gestor clicar de novo, o servidor reconhece e
 * recusa. Clique duplo não paga duas vezes.
 */

type LinhaDinheiro = {
  chave: string;
  forma: string;
  contaId: string;
  centavos: number | null;
};

const FORMAS: [string, string][] = [
  ["dinheiro", "Dinheiro"],
  ["pix", "PIX"],
  ["deposito", "Depósito"],
  ["boleto", "Boleto"],
];

function novaLinha(): LinhaDinheiro {
  return {
    chave: Math.random().toString(36).slice(2),
    forma: "pix",
    contaId: "",
    centavos: null,
  };
}

export function PagamentoEmLote({
  contas,
  chequesCarteira,
  contasFinanceiras,
  onAviso,
}: {
  contas: ContaAPagar[];
  chequesCarteira: Cheque[];
  contasFinanceiras: ContaOpcao[];
  onAviso: (aviso: string | null) => void;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [chequesUsados, setChequesUsados] = useState<Set<string>>(new Set());
  const [linhas, setLinhas] = useState<LinhaDinheiro[]>([]);
  const [trocoConta, setTrocoConta] = useState("");
  const [data, setData] = useState(
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só conta REALMENTE em aberto entra no lote. Previsão tem valor de chute e
  // precisa ser confirmada uma a uma antes — o servidor recusa também.
  const elegiveis = useMemo(
    () =>
      contas
        .filter((c) => c.status === "a_pagar")
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    [contas]
  );

  const totalDevido = elegiveis
    .filter((c) => marcadas.has(c.id))
    .reduce((s, c) => s + Math.round(c.valor * 100), 0);
  const totalCheques = chequesCarteira
    .filter((c) => chequesUsados.has(c.id))
    .reduce((s, c) => s + Math.round(c.valor * 100), 0);
  const totalDinheiro = linhas.reduce((s, l) => s + (l.centavos ?? 0), 0);
  const totalPago = totalCheques + totalDinheiro;
  const diferenca = totalPago - totalDevido;

  function alternar(
    set: Set<string>,
    id: string,
    setter: (s: Set<string>) => void
  ) {
    const novo = new Set(set);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setter(novo);
    setConfirmando(false);
    setErro(null);
  }

  function mudarLinha(chave: string, campo: Partial<LinhaDinheiro>) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campo } : l)));
    setConfirmando(false);
    setErro(null);
  }

  function limpar() {
    setMarcadas(new Set());
    setChequesUsados(new Set());
    setLinhas([]);
    setTrocoConta("");
    setConfirmando(false);
  }

  async function enviar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/admin/contas/pagamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Gerado a cada envio: é o que torna o clique duplo inofensivo.
          pagamento_id: crypto.randomUUID(),
          data,
          contas: [...marcadas],
          cheques: [...chequesUsados],
          dinheiro: linhas
            .filter((l) => (l.centavos ?? 0) > 0)
            .map((l) => ({
              forma: l.forma,
              conta_id: l.contaId,
              valor: centavosParaReais(l.centavos!),
            })),
          ...(diferenca > 0
            ? { troco_valor: diferenca / 100, troco_conta_id: trocoConta }
            : {}),
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não consegui pagar");
        return;
      }
      if (Array.isArray(r.avisos) && r.avisos.length > 0) {
        onAviso(r.avisos.join(". ") + ".");
      } else if (r.partidas > 0) {
        onAviso(
          `${r.contas} conta(s) paga(s). ${r.partidas} foi(ram) dividida(s) entre mais de um meio de pagamento — na lista elas aparecem como uma linha só.`
        );
      }
      limpar();
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="card mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold">Pagar várias contas de uma vez</div>
          <div className="text-sm text-cinza-suave">
            Um cheque pode pagar 3 contas; uma conta pode ser paga com 2 cheques
            mais PIX. {elegiveis.length} conta(s) em aberto.
          </div>
        </div>
        <button
          onClick={() => setAberto(true)}
          disabled={elegiveis.length === 0}
          className="btn-primario disabled:opacity-40"
        >
          Montar pagamento
        </button>
      </div>
    );
  }

  const podeEnviar =
    marcadas.size > 0 &&
    totalPago > 0 &&
    diferenca >= 0 &&
    (diferenca === 0 || !!trocoConta) &&
    linhas.every((l) => (l.centavos ?? 0) === 0 || !!l.contaId);

  return (
    <div className="card mb-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Pagar várias contas de uma vez</div>
        <button
          onClick={() => {
            limpar();
            setAberto(false);
          }}
          className="text-sm text-cinza-suave hover:underline"
        >
          fechar
        </button>
      </div>

      {/* ----------------------------------------------------- as contas */}
      <div>
        <div className="text-sm font-medium mb-1">
          O que está sendo pago
          <span className="text-cinza-suave font-normal">
            {" "}
            — da mais antiga pra mais nova
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto border border-cinza-borda rounded-xl">
          <table className="w-full text-sm">
            <tbody>
              {elegiveis.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-cinza-borda last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pl-3 w-8">
                    <input
                      type="checkbox"
                      checked={marcadas.has(c.id)}
                      onChange={() => alternar(marcadas, c.id, setMarcadas)}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-cinza-suave">
                    {formatData(c.vencimento)}
                  </td>
                  <td className="py-2 pr-3">{c.descricao}</td>
                  <td className="py-2 pr-3 text-cinza-suave text-xs">
                    {c.fornecedor || "—"}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono font-semibold whitespace-nowrap">
                    {formatBRL(c.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------------------ os meios */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium mb-1">Cheques da carteira</div>
          {chequesCarteira.length === 0 ? (
            <p className="text-sm text-cinza-suave">Nenhum cheque na carteira.</p>
          ) : (
            <div className="max-h-52 overflow-y-auto border border-cinza-borda rounded-xl">
              <table className="w-full text-sm">
                <tbody>
                  {chequesCarteira.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-cinza-borda last:border-0 hover:bg-slate-50"
                    >
                      <td className="py-2 pl-3 w-8">
                        <input
                          type="checkbox"
                          checked={chequesUsados.has(c.id)}
                          onChange={() =>
                            alternar(chequesUsados, c.id, setChequesUsados)
                          }
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="py-2 pr-3 text-cinza-suave text-xs">
                        {c.banco} · {c.numero || "s/nº"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold whitespace-nowrap">
                        {formatBRL(c.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-1">Dinheiro, PIX, depósito</div>
          <div className="space-y-2">
            {linhas.map((l) => (
              <div key={l.chave} className="border border-cinza-borda rounded-xl p-2 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={l.forma}
                    onChange={(e) => mudarLinha(l.chave, { forma: e.target.value })}
                    className="border border-cinza-borda rounded-lg px-2 py-2 text-sm"
                  >
                    {FORMAS.map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <div className="flex-1">
                    <InputDinheiro
                      centavos={l.centavos}
                      onChange={(v) => mudarLinha(l.chave, { centavos: v })}
                    />
                  </div>
                  <button
                    onClick={() =>
                      setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))
                    }
                    className="text-sm text-alerta px-2"
                    title="tirar esta linha"
                  >
                    ✕
                  </button>
                </div>
                <SelectConta
                  contas={contasFinanceiras}
                  valor={l.contaId}
                  onChange={(id) => mudarLinha(l.chave, { contaId: id })}
                  label="Saiu de"
                />
              </div>
            ))}
            <button
              onClick={() => setLinhas((ls) => [...ls, novaLinha()])}
              className="text-sm px-3 py-1.5 rounded-lg border border-cinza-borda hover:bg-slate-50"
            >
              + acrescentar valor
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- a conta */}
      <div className="border-t border-cinza-borda pt-3 grid sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-cinza-suave">
            {marcadas.size} conta(s) selecionada(s)
          </div>
          <div className="text-xl font-bold font-mono">
            {formatBRL(totalDevido / 100)}
          </div>
        </div>
        <div>
          <div className="text-xs text-cinza-suave">Sendo pago</div>
          <div className="text-xl font-bold font-mono">
            {formatBRL(totalPago / 100)}
          </div>
        </div>
        <div>
          <div className="text-xs text-cinza-suave">
            {diferenca === 0 ? "Bate certinho" : diferenca > 0 ? "Sobra" : "Falta"}
          </div>
          <div
            className={`text-xl font-bold font-mono ${
              diferenca === 0 ? "" : "text-alerta"
            }`}
          >
            {formatBRL(Math.abs(diferenca) / 100)}
          </div>
        </div>
      </div>

      {diferenca > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
          <p className="text-sm">
            Você está pagando <strong>{formatBRL(diferenca / 100)}</strong> a
            mais do que as contas. Diga em qual conta o troco entrou — sem isso
            esse dinheiro sumiria do caixa.
          </p>
          <SelectConta
            contas={contasFinanceiras}
            valor={trocoConta}
            onChange={setTrocoConta}
            label="O troco entrou em"
          />
        </div>
      )}

      {diferenca < 0 && marcadas.size > 0 && totalPago > 0 && (
        <p className="text-sm bg-amber-50 border border-amber-300 rounded-xl p-3">
          O pagamento não cobre as contas escolhidas. Faltam{" "}
          <strong>{formatBRL(-diferenca / 100)}</strong> — tire uma conta da
          lista ou acrescente pagamento.
        </p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-cinza-suave mb-1">
            Data do pagamento
          </label>
          <input
            type="date"
            value={data}
            max={new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            onChange={(e) => setData(e.target.value)}
            className="border border-cinza-borda rounded-lg px-3 py-2 text-base"
          />
        </div>
        <button
          onClick={() => setConfirmando(true)}
          disabled={!podeEnviar}
          className="btn-primario disabled:opacity-40 self-end"
        >
          Pagar
        </button>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {confirmando && (
        <ModalConfirmar
          titulo={`Pagar ${marcadas.size} conta(s)?`}
          descricao={
            `${formatBRL(totalDevido / 100)} em ${chequesUsados.size} cheque(s) e ` +
            `${linhas.filter((l) => (l.centavos ?? 0) > 0).length} valor(es) em dinheiro` +
            (diferenca > 0 ? `, com ${formatBRL(diferenca / 100)} de troco` : "") +
            `. Conta que ficar dividida entre dois meios aparece como uma linha só na lista.`
          }
          confirmarLabel="Pagar"
          carregando={salvando}
          onConfirmar={enviar}
          onFechar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}
