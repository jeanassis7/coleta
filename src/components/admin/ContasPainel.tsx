"use client";

import { useMemo, useState } from "react";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
  reaisParaCentavos,
} from "@/components/InputDinheiro";
import { ModalConfirmar } from "@/components/admin/Modais";
import {
  CATEGORIAS_LANCAVEIS,
  labelCategoria,
  pedePessoa,
  pessoaOpcional,
} from "@/lib/plano-contas";
import type {
  ContaAPagar,
  DespesaRecorrente,
  Cheque,
  ResumoContas,
  FormaPagamento,
} from "@/lib/admin/queries";
import type { ValePendente } from "@/lib/admin/caixa";

export interface PessoaOpcaoConta {
  id: string;
  nome: string;
}

// As categorias vêm do PLANO DE CONTAS (as lançáveis) — a mesma lista da
// tela de Lançamentos. A lista antiga (combustivel/oleo/fixa/folha...) era
// de antes do plano existir: o servidor recusava TODAS as 7 opções e criar
// conta pela tela era impossível.
const CATEGORIAS: Array<[string, string]> = CATEGORIAS_LANCAVEIS.map((l) => [
  l.chave,
  l.label,
]);

const FORMAS: Array<[FormaPagamento, string]> = [
  ["pix", "Pix"],
  ["dinheiro", "Dinheiro"],
  ["deposito", "Depósito"],
  ["boleto", "Boleto"],
  ["cheque", "Cheque"],
];

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function diasAte(d: string): number {
  return Math.round(
    (new Date(`${d}T00:00:00`).getTime() - new Date(`${hojeBr()}T00:00:00`).getTime()) /
      86400000
  );
}

type Aba = "a_pagar" | "prevista" | "paga" | "recorrentes";

export function ContasPainel({
  contas,
  recorrentes,
  chequesCarteira,
  resumo,
  contasFinanceiras,
  pessoas,
  vales,
  deveMotoristas,
}: {
  contas: ContaAPagar[];
  recorrentes: DespesaRecorrente[];
  chequesCarteira: Cheque[];
  resumo: ResumoContas;
  /** Contas financeiras — de qual caixa o pagamento saiu. */
  contasFinanceiras: ContaOpcao[];
  /** O QUEM das categorias que pedem pessoa (salário, comissão…). */
  pessoas: PessoaOpcaoConta[];
  /** Vales de acerto pendentes — pagamento de Salário desconta por aqui. */
  vales: ValePendente[];
  /** Saldos NEGATIVOS de motoristas: dívida da empresa que não é conta. */
  deveMotoristas: number;
}) {
  const [aba, setAba] = useState<Aba>("a_pagar");
  const [novaConta, setNovaConta] = useState(false);
  const [novaRecorrente, setNovaRecorrente] = useState(false);

  const daAba = useMemo(
    () => contas.filter((c) => c.status === aba),
    [contas, aba]
  );

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="card">
          <div className="text-xs text-cinza-suave">A pagar</div>
          <div className="text-2xl font-bold font-mono">
            {formatBRL(resumo.a_pagar_total)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-cinza-suave">Vencidas</div>
          <div
            className={`text-2xl font-bold font-mono ${
              resumo.vencidas_qtd > 0 ? "text-alerta" : ""
            }`}
          >
            {formatBRL(resumo.vencidas_total)}
          </div>
          <div className="text-xs text-cinza-suave mt-1">
            {resumo.vencidas_qtd} {resumo.vencidas_qtd === 1 ? "conta" : "contas"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-cinza-suave">Vence em 7 dias</div>
          <div className="text-2xl font-bold font-mono">
            {formatBRL(resumo.semana_total)}
          </div>
          <div className="text-xs text-cinza-suave mt-1">
            {resumo.semana_qtd} {resumo.semana_qtd === 1 ? "conta" : "contas"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-cinza-suave">Previsto</div>
          <div className="text-2xl font-bold font-mono text-cinza-suave">
            {formatBRL(resumo.previsto_total)}
          </div>
          <div className="text-xs text-cinza-suave mt-1">
            estimativa — não conta como dívida
          </div>
        </div>
      </div>

      {deveMotoristas > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm mb-4">
          Além das contas acima, a empresa está devendo{" "}
          <strong>{formatBRL(deveMotoristas)}</strong> a motorista(s) com
          saldo negativo (gastaram do próprio bolso) — acerta-se em
          Adiantamentos (pagar agora ou somar no salário).
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {(
          [
            ["a_pagar", "A pagar"],
            ["prevista", "Previstas"],
            ["paga", "Pagas"],
            ["recorrentes", "Recorrentes"],
          ] as Array<[Aba, string]>
        ).map(([v, r]) => (
          <button
            key={v}
            onClick={() => setAba(v)}
            className={`px-4 py-2 rounded-xl border-2 text-sm ${
              aba === v
                ? "bg-verde text-white border-verde"
                : "bg-white border-cinza-borda"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {aba === "recorrentes" ? (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {!novaRecorrente && (
              <button
                onClick={() => setNovaRecorrente(true)}
                className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
              >
                + Nova recorrente
              </button>
            )}
            <BotaoGerarMes />
          </div>
          {novaRecorrente && (
            <FormRecorrente onFim={() => setNovaRecorrente(false)} />
          )}
          <TabelaRecorrentes recorrentes={recorrentes} />
        </>
      ) : (
        <>
          {aba === "a_pagar" && !novaConta && (
            <div className="mb-4">
              <button
                onClick={() => setNovaConta(true)}
                className="px-4 py-2 bg-verde text-white rounded-xl font-medium hover:bg-verde/90"
              >
                + Nova conta
              </button>
            </div>
          )}
          {novaConta && (
            <FormConta pessoas={pessoas} onFim={() => setNovaConta(false)} />
          )}
          <TabelaContas
            contas={daAba}
            aba={aba}
            chequesCarteira={chequesCarteira}
            contasFinanceiras={contasFinanceiras}
            vales={vales}
          />
        </>
      )}
    </>
  );
}

function BotaoGerarMes() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function gerar() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/contas/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const r = await res.json();
      if (!res.ok) {
        setMsg(r.error || "erro");
        return;
      }
      setMsg(
        r.criadas === 0
          ? "As contas desse mês já estavam geradas."
          : `${r.criadas} conta(s) criada(s).`
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={gerar}
        disabled={loading}
        className="px-4 py-2 border border-cinza-borda rounded-xl hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? "Gerando..." : "Gerar contas do mês"}
      </button>
      {msg && <span className="text-sm text-cinza-suave">{msg}</span>}
    </div>
  );
}

function FormConta({
  pessoas,
  onFim,
}: {
  pessoas: PessoaOpcaoConta[];
  onFim: () => void;
}) {
  const router = useRouter();
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  // O default precisa EXISTIR no plano — "outra" não existia e o select
  // renderizava sem seleção, com 400 no salvar.
  const [categoria, setCategoria] = useState(CATEGORIAS_LANCAVEIS[0].chave);
  const [pessoaId, setPessoaId] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [vencimento, setVencimento] = useState(hojeBr());
  const [parcelas, setParcelas] = useState("1");
  const [prevista, setPrevista] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nParcelas = Math.max(1, Number(parcelas) || 1);

  async function salvar() {
    if (descricao.trim().length < 2) return setErro("Descreva a conta");
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    if (pedePessoa(categoria) && !pessoaOpcional(categoria) && !pessoaId) {
      return setErro("Essa categoria pede a pessoa — escolha de quem é");
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: descricao.trim(),
          fornecedor: fornecedor.trim() || null,
          categoria,
          pessoa_id: pedePessoa(categoria) ? pessoaId || null : null,
          valor: centavosParaReais(valorCentavos),
          vencimento,
          parcelas: nParcelas,
          prevista,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
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
      <h2 className="text-lg font-semibold">Nova conta</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">O que é</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Pra quem <span className="text-cinza-suave">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {CATEGORIAS.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {pedePessoa(categoria) && (
          <div>
            <label className="block text-sm font-medium mb-1">De quem</label>
            <select
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={pessoaId}
              onChange={(e) => setPessoaId(e.target.value)}
            >
              <option value="">
                {pessoaOpcional(categoria)
                  ? "Empresa toda (guia coletiva)"
                  : "Escolha…"}
              </option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Valor total</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {nParcelas > 1 ? "1º vencimento" : "Vencimento"}
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Parcelas</label>
          <input
            type="number"
            min={1}
            max={36}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={parcelas}
            onChange={(e) => setParcelas(e.target.value)}
          />
        </div>
      </div>

      {nParcelas > 1 && valorCentavos && (
        <p className="text-sm text-cinza-suave">
          Vai criar {nParcelas} contas de{" "}
          {formatBRL(centavosParaReais(valorCentavos) / nParcelas)}, uma por mês
          a partir de {formatData(vencimento)}. Cada parcela se paga sozinha —
          inclusive com cheque da carteira.
        </p>
      )}

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={prevista}
          onChange={(e) => setPrevista(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm">
          <strong>O valor é estimado</strong>
          <span className="block text-xs text-cinza-suave">
            Entra como previsão: aparece no planejamento mas não conta como
            dívida até você confirmar o valor de verdade.
          </span>
        </span>
      </label>

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
          {salvando ? "Salvando..." : "Criar"}
        </button>
      </div>
    </div>
  );
}

function TabelaContas({
  contas,
  aba,
  chequesCarteira,
  contasFinanceiras,
  vales,
}: {
  contas: ContaAPagar[];
  aba: Aba;
  chequesCarteira: Cheque[];
  contasFinanceiras: ContaOpcao[];
  vales: ValePendente[];
}) {
  const router = useRouter();
  const [pagando, setPagando] = useState<ContaAPagar | null>(null);
  const [confirmando, setConfirmando] = useState<ContaAPagar | null>(null);
  const [editando, setEditando] = useState<ContaAPagar | null>(null);
  const [cancelando, setCancelando] = useState<ContaAPagar | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoOk, setAvisoOk] = useState<string | null>(null);

  async function cancelar(c: ContaAPagar) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/contas/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "cancelar" }),
      });
      const r = await res.json();
      if (!res.ok) setErro(r.error || "erro");
      else {
        // O servidor pode ter desfeito coisa amarrada (ex.: coleta da sede
        // voltou a descontar do motorista) — a tela conta.
        if (r.aviso) setAvisoOk(r.aviso);
        router.refresh();
      }
    } finally {
      setLoading(false);
      setCancelando(null);
    }
  }

  if (contas.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          {aba === "a_pagar"
            ? "Nenhuma conta em aberto."
            : aba === "prevista"
              ? "Nenhuma previsão. Elas nascem das despesas recorrentes marcadas como estimadas."
              : "Nenhuma conta paga ainda."}
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      {avisoOk && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-sm mb-3">
          {avisoOk}
        </div>
      )}
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm mb-3">
          {erro}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Vencimento</th>
            <th className="py-2 pr-3">O que é</th>
            <th className="py-2 pr-3">Pra quem</th>
            <th className="py-2 pr-3">Categoria</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            {aba === "paga" && <th className="py-2 pr-3">Como pagou</th>}
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => {
            const dias = diasAte(c.vencimento);
            const vencida = aba === "a_pagar" && dias < 0;
            return (
              <tr key={c.id} className="border-b border-cinza-borda hover:bg-slate-50">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={vencida ? "font-semibold text-alerta" : ""}>
                    {formatData(c.vencimento)}
                  </span>
                  {aba === "a_pagar" && (
                    <div className="text-xs text-cinza-suave">
                      {dias < 0
                        ? `venceu há ${-dias} ${-dias === 1 ? "dia" : "dias"}`
                        : dias === 0
                          ? "é hoje"
                          : `em ${dias} ${dias === 1 ? "dia" : "dias"}`}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">{c.descricao}</td>
                <td className="py-2 pr-3 text-cinza-suave">{c.fornecedor || "—"}</td>
                <td className="py-2 pr-3 text-cinza-suave text-xs">
                  {labelCategoria(c.categoria)}
                </td>
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  {formatBRL(c.valor)}
                </td>
                {aba === "paga" && (
                  <td className="py-2 pr-3 text-xs text-cinza-suave">
                    {c.forma_pagamento}
                    {c.pago_em ? ` · ${formatData(c.pago_em)}` : ""}
                  </td>
                )}
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-2 text-sm">
                    {aba === "prevista" && (
                      <button
                        onClick={() => setConfirmando(c)}
                        className="text-verde hover:underline"
                      >
                        Confirmar valor
                      </button>
                    )}
                    {(aba === "a_pagar" || aba === "prevista") && (
                      <>
                        <button
                          onClick={() => setPagando(c)}
                          className="text-verde hover:underline"
                        >
                          Pagar
                        </button>
                        {aba === "a_pagar" && (
                          <button
                            onClick={() => setEditando(c)}
                            className="text-verde hover:underline"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => setCancelando(c)}
                          className="text-alerta hover:underline"
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pagando && (
        <ModalPagar
          conta={pagando}
          chequesCarteira={chequesCarteira}
          contasFinanceiras={contasFinanceiras}
          vales={vales}
          onAviso={setAvisoOk}
          onFechar={() => setPagando(null)}
        />
      )}
      {confirmando && (
        <ModalConfirmarPrevisao
          conta={confirmando}
          onFechar={() => setConfirmando(null)}
        />
      )}
      {editando && (
        <ModalEditarConta conta={editando} onFechar={() => setEditando(null)} />
      )}
      {cancelando && (
        <ModalConfirmar
          titulo="Cancelar essa conta?"
          descricao={`${cancelando.descricao} · ${formatBRL(cancelando.valor)}. Ela some das contas em aberto mas continua no histórico.`}
          confirmarLabel="Cancelar conta"
          perigo
          carregando={loading}
          onConfirmar={() => cancelar(cancelando)}
          onFechar={() => setCancelando(null)}
        />
      )}
    </div>
  );
}

function ModalPagar({
  conta,
  chequesCarteira,
  contasFinanceiras,
  vales,
  onAviso,
  onFechar,
}: {
  conta: ContaAPagar;
  chequesCarteira: Cheque[];
  contasFinanceiras: ContaOpcao[];
  vales: ValePendente[];
  onAviso: (aviso: string | null) => void;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [forma, setForma] = useState<FormaPagamento>("pix");
  const [pagoEm, setPagoEm] = useState(hojeBr());
  const [chequeId, setChequeId] = useState("");
  // Pagar COM cheque não tira dinheiro de conta nenhuma — quitou com o papel.
  const [contaFinId, setContaFinId] = useState("");
  // Pagamento parcial: a conta vira paga pelo que foi pago e o resto nasce
  // como conta nova, em aberto.
  const [parcial, setParcial] = useState(false);
  const [valorPagoCentavos, setValorPagoCentavos] = useState<number | null>(null);
  // Juros/multa de atraso — vão pra categoria própria (Juros e multas).
  const [jurosCentavos, setJurosCentavos] = useState<number | null>(null);
  // Vales de acerto que este pagamento (de Salário) desconta.
  const [valesMarcados, setValesMarcados] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cheque = chequesCarteira.find((c) => c.id === chequeId);
  const valesDaPessoa =
    conta.categoria === "salario" && conta.pessoa_id
      ? vales.filter((v) => v.motorista_id === conta.pessoa_id)
      : [];

  async function pagar() {
    if (forma === "cheque" && !chequeId) {
      return setErro("Escolha qual cheque da carteira vai pagar");
    }
    if (forma !== "cheque" && !contaFinId) {
      return setErro("Diga de qual conta saiu o dinheiro");
    }
    if (parcial) {
      if (forma === "cheque") {
        return setErro("Pagamento parcial não funciona com cheque — o papel quita inteiro");
      }
      if (!valorPagoCentavos || valorPagoCentavos <= 0) {
        return setErro("Quanto foi pago agora?");
      }
      if (centavosParaReais(valorPagoCentavos) >= conta.valor) {
        return setErro("O parcial precisa ser MENOR que a conta — senão é pagamento normal");
      }
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/contas/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "pagar",
          forma_pagamento: forma,
          pago_em: pagoEm,
          cheque_id: forma === "cheque" ? chequeId : null,
          conta_id: forma === "cheque" ? null : contaFinId,
          repassado_para: conta.fornecedor || conta.descricao,
          ...(parcial && valorPagoCentavos
            ? { valor_pago: centavosParaReais(valorPagoCentavos) }
            : {}),
          ...(jurosCentavos && forma !== "cheque"
            ? { juros: centavosParaReais(jurosCentavos) }
            : {}),
          ...(valesMarcados.length > 0 ? { vales_quitados: valesMarcados } : {}),
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
        return;
      }
      if (Array.isArray(r.avisos) && r.avisos.length > 0) {
        onAviso(r.avisos.join(". ") + ".");
      }
      router.refresh();
      onFechar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg space-y-4 my-8">
        <div>
          <h2 className="text-lg font-bold">Pagar</h2>
          <p className="text-sm text-cinza-suave mt-1">
            {conta.descricao} · <strong>{formatBRL(conta.valor)}</strong>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Como pagou</label>
          <div className="flex flex-wrap gap-2">
            {FORMAS.map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setForma(v)}
                disabled={v === "cheque" && chequesCarteira.length === 0}
                className={`px-4 py-2 rounded-xl border-2 text-sm disabled:opacity-40 ${
                  forma === v
                    ? "bg-verde text-white border-verde"
                    : "bg-white border-cinza-borda"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {chequesCarteira.length === 0 && (
            <p className="text-xs text-cinza-suave mt-1">
              Não tem cheque na carteira pra repassar.
            </p>
          )}
        </div>

        {forma === "cheque" && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Qual cheque da carteira
            </label>
            <select
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={chequeId}
              onChange={(e) => setChequeId(e.target.value)}
            >
              <option value="">Escolha...</option>
              {chequesCarteira.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.banco} · {formatBRL(c.valor)} · bom para{" "}
                  {formatData(c.bom_para)} · de {c.comprador_nome}
                </option>
              ))}
            </select>
            {cheque && Math.abs(cheque.valor - conta.valor) > 0.009 && (
              <p className="text-xs text-cinza-suave mt-1">
                O cheque é de {formatBRL(cheque.valor)} e a conta é de{" "}
                {formatBRL(conta.valor)} — a diferença você acerta com o
                fornecedor por fora.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Data do pagamento</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={pagoEm}
            onChange={(e) => setPagoEm(e.target.value)}
          />
        </div>

        {forma !== "cheque" && (
          <SelectConta
            contas={contasFinanceiras}
            valor={contaFinId}
            onChange={setContaFinId}
            label="De qual conta saiu"
          />
        )}

        {forma !== "cheque" && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={parcial}
                onChange={(e) => setParcial(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm">
                <strong>Paguei só uma parte</strong>
                <span className="block text-xs text-cinza-suave">
                  A conta fica paga pelo valor de agora e o RESTO continua em
                  aberto, como conta nova — a dívida não perde o fio.
                </span>
              </span>
            </label>
            {parcial && (
              <div>
                <label className="block text-xs text-cinza-suave mb-1">
                  Quanto foi pago agora
                </label>
                <InputDinheiro
                  centavos={valorPagoCentavos}
                  onChange={setValorPagoCentavos}
                  grande={false}
                />
                {valorPagoCentavos != null &&
                  valorPagoCentavos > 0 &&
                  centavosParaReais(valorPagoCentavos) < conta.valor && (
                    <p className="text-xs text-cinza-suave mt-1">
                      Fica em aberto:{" "}
                      {formatBRL(conta.valor - centavosParaReais(valorPagoCentavos))}
                    </p>
                  )}
              </div>
            )}
            <div>
              <label className="block text-xs text-cinza-suave mb-1">
                Juros/multa pagos junto{" "}
                <span className="text-cinza-suave">(opcional)</span>
              </label>
              <InputDinheiro
                centavos={jurosCentavos}
                onChange={setJurosCentavos}
                grande={false}
              />
              <p className="text-xs text-cinza-suave mt-1">
                A diferença de boleto atrasado entra na categoria própria
                (Juros e multas) — não polui a linha original do DRE.
              </p>
            </div>
          </div>
        )}

        {valesDaPessoa.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
            <p className="text-sm font-medium">Esse pagamento quita algum vale?</p>
            <p className="text-xs text-cinza-suave">
              Vales vieram de acertos e ainda não foram descontados de nenhum
              salário. Negativo = a empresa deve e o valor SOMA no pagamento.
            </p>
            {valesDaPessoa.map((v) => (
              <label
                key={v.acerto_id}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={valesMarcados.includes(v.acerto_id)}
                  onChange={(e) =>
                    setValesMarcados((a) =>
                      e.target.checked
                        ? [...a, v.acerto_id]
                        : a.filter((x) => x !== v.acerto_id)
                    )
                  }
                  className="w-5 h-5 cursor-pointer"
                />
                <span>
                  <strong>{formatBRL(v.valor)}</strong> — acerto de{" "}
                  {formatData(v.corte_em)}
                </span>
              </label>
            ))}
          </div>
        )}

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
            onClick={pagar}
            disabled={salvando}
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Marcar como paga"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editar valor/vencimento de uma conta AINDA NÃO PAGA. Seguro por definição:
 * o que gira pro DRE e pro caixa é o pagamento — enquanto deve, é promessa,
 * e promessa se corrige. Caso real: o óleo da sede tem valor certo e
 * vencimento combinado depois (3, 15, 30 dias).
 */
function ModalEditarConta({
  conta,
  onFechar,
}: {
  conta: ContaAPagar;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    reaisParaCentavos(conta.valor)
  );
  const [vencimento, setVencimento] = useState(conta.vencimento);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/contas/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "editar",
          valor: centavosParaReais(valorCentavos),
          vencimento,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
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
        <div>
          <h2 className="text-lg font-bold">Editar conta</h2>
          <p className="text-sm text-cinza-suave mt-1">
            {conta.descricao}. Vale enquanto ela ainda não foi paga — o
            vencimento combinado mudou, ou o valor veio diferente.
          </p>
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
          <label className="block text-sm font-medium mb-1">Vencimento</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
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
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalConfirmarPrevisao({
  conta,
  onFechar,
}: {
  conta: ContaAPagar;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [valorCentavos, setValorCentavos] = useState<number | null>(
    reaisParaCentavos(conta.valor)
  );
  const [vencimento, setVencimento] = useState(conta.vencimento);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/contas/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "confirmar",
          valor: centavosParaReais(valorCentavos),
          vencimento,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
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
        <div>
          <h2 className="text-lg font-bold">Confirmar o valor</h2>
          <p className="text-sm text-cinza-suave mt-1">
            {conta.descricao}. Estava estimada em {formatBRL(conta.valor)}.
            Chegou o boleto? Ponha o valor e a data de verdade — a partir daí
            ela passa a contar como dívida.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Valor real</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Vencimento</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
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
            onClick={confirmar}
            disabled={salvando}
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRecorrente({ onFim }: { onFim: () => void }) {
  const router = useRouter();
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  // "fixa" não é chave do plano — o select renderizava sem seleção e o
  // salvar voltava 400 sem apontar o campo.
  const [categoria, setCategoria] = useState(CATEGORIAS_LANCAVEIS[0].chave);
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [dia, setDia] = useState("10");
  const [periodicidade, setPeriodicidade] = useState<"mensal" | "anual">("mensal");
  const [mes, setMes] = useState("1");
  const [aproximada, setAproximada] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (descricao.trim().length < 2) return setErro("Descreva a despesa");
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/recorrentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descricao: descricao.trim(),
          fornecedor: fornecedor.trim() || null,
          categoria,
          valor: centavosParaReais(valorCentavos),
          dia_vencimento: Number(dia),
          periodicidade,
          mes_vencimento: periodicidade === "anual" ? Number(mes) : null,
          aproximada,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
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
      <h2 className="text-lg font-semibold">Nova despesa recorrente</h2>
      <p className="text-sm text-cinza-suave">
        Aluguel, energia, contador, imposto, IPVA. Todo mês (ou todo ano) o
        botão &quot;Gerar contas do mês&quot; cria a conta correspondente.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">O que é</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Pra quem <span className="text-cinza-suave">(opcional)</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {CATEGORIAS.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
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
          <label className="block text-sm font-medium mb-1">Repete</label>
          <select
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={periodicidade}
            onChange={(e) => setPeriodicidade(e.target.value as "mensal" | "anual")}
          >
            <option value="mensal">Todo mês</option>
            <option value="anual">Uma vez por ano</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {periodicidade === "anual" ? "Mês e dia" : "Dia do mês"}
          </label>
          <div className="flex gap-2">
            {periodicidade === "anual" && (
              <select
                className="px-2 py-2 border border-cinza-borda rounded-xl"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            )}
            <input
              type="number"
              min={1}
              max={31}
              className="flex-1 px-3 py-2 border border-cinza-borda rounded-xl"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={aproximada}
          onChange={(e) => setAproximada(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm">
          <strong>O valor varia (é estimativa)</strong>
          <span className="block text-xs text-cinza-suave">
            Energia, água, IPVA. A conta nasce como previsão e só vira dívida
            quando você confirmar o valor do boleto.
          </span>
        </span>
      </label>

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
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function TabelaRecorrentes({ recorrentes }: { recorrentes: DespesaRecorrente[] }) {
  const router = useRouter();
  const [apagando, setApagando] = useState<DespesaRecorrente | null>(null);
  const [loading, setLoading] = useState(false);

  async function alternar(r: DespesaRecorrente) {
    await fetch(`/api/admin/recorrentes/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativa: !r.ativa }),
    });
    router.refresh();
  }

  async function apagar(r: DespesaRecorrente) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/recorrentes/${r.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
      setApagando(null);
    }
  }

  if (recorrentes.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhuma despesa recorrente. É aqui que entram aluguel, energia,
          internet, contador e imposto — o que hoje não aparece em lugar nenhum
          do sistema.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">O que é</th>
            <th className="py-2 pr-3">Pra quem</th>
            <th className="py-2 pr-3">Quando</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            <th className="py-2 pr-3">Tipo</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {recorrentes.map((r) => (
            <tr key={r.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3">
                {r.descricao}
                {!r.ativa && (
                  <span className="ml-2 text-xs text-cinza-suave">(pausada)</span>
                )}
              </td>
              <td className="py-2 pr-3 text-cinza-suave">{r.fornecedor || "—"}</td>
              <td className="py-2 pr-3 text-cinza-suave">
                {r.periodicidade === "anual"
                  ? `dia ${r.dia_vencimento} do mês ${r.mes_vencimento}`
                  : `todo dia ${r.dia_vencimento}`}
              </td>
              <td className="py-2 pr-3 text-right font-mono">{formatBRL(r.valor)}</td>
              <td className="py-2 pr-3 text-xs">
                {r.aproximada ? (
                  <span className="text-cinza-suave">estimado</span>
                ) : (
                  <span className="text-green-700">fixo</span>
                )}
              </td>
              <td className="py-2 pr-3">
                <div className="flex gap-2 text-sm">
                  <button
                    onClick={() => alternar(r)}
                    className="text-verde hover:underline"
                  >
                    {r.ativa ? "Pausar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => setApagando(r)}
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

      {apagando && (
        <ModalConfirmar
          titulo="Apagar essa recorrente?"
          descricao={`${apagando.descricao}. As contas já geradas continuam lá — só para de gerar novas. Se for pausa temporária, use "Pausar".`}
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
