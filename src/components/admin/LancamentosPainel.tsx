"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import { ModalConfirmar } from "./Modais";
import { formatBRL, formatData } from "@/lib/format";
import {
  CATEGORIAS_LANCAVEIS,
  GRUPOS,
  labelCategoria,
  pedePessoa,
  contaVeioDeLancamento,
} from "@/lib/plano-contas";
import type { Lancamento, ValePendente } from "@/lib/admin/caixa";

/**
 * Lançar o que já saiu, no ritmo do extrato bancário.
 *
 * O Jean olha o extrato e lança linha a linha. Por isso o formulário fica
 * SEMPRE aberto no topo (não é um modal que abre e fecha), a conta vem
 * pré-selecionada na última usada, e salvar limpa só o valor e a descrição —
 * data, conta e categoria ficam, porque a próxima linha do extrato quase
 * sempre é parecida com a anterior.
 */

export interface PessoaOpcao {
  id: string;
  nome: string;
}

export interface ChequeOpcao {
  id: string;
  rotulo: string;
  valor: number;
}

export function LancamentosPainel({
  lancamentos,
  contas,
  pessoas,
  cheques,
  vales,
  filtros,
}: {
  lancamentos: Lancamento[];
  contas: ContaOpcao[];
  pessoas: PessoaOpcao[];
  /** Cheques na carteira — pagar com um deles é o que o repassa. */
  cheques: ChequeOpcao[];
  /** Vales de acerto ainda não descontados de nenhum salário. */
  vales: ValePendente[];
  filtros: { inicio: string; fim: string; categoria: string; conta_id: string };
}) {
  const router = useRouter();
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [data, setData] = useState(hoje);
  const [contaId, setContaId] = useState("");
  const [categoria, setCategoria] = useState(CATEGORIAS_LANCAVEIS[0].chave);
  const [pessoaId, setPessoaId] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [descricao, setDescricao] = useState("");
  // Pagar com cheque: o dinheiro não sai de conta nenhuma, sai do papel.
  // Marcar isto repassa o cheque — e é o único jeito de repassar.
  const [comCheque, setComCheque] = useState(false);
  const [chequeId, setChequeId] = useState("");
  // Vales que este pagamento está quitando.
  const [valesMarcados, setValesMarcados] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [apagando, setApagando] = useState<Lancamento | null>(null);

  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]));
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valorCentavos) return setErro("Quanto foi?");
    if (comCheque && !chequeId) return setErro("Escolha qual cheque pagou.");
    setErro(null);
    setOk(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/caixa/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoria,
          valor: centavosParaReais(valorCentavos),
          data,
          conta_id: comCheque ? null : contaId,
          cheque_id: comCheque ? chequeId : null,
          vales_quitados: valesMarcados,
          pessoa_id: pedePessoa(categoria) ? pessoaId : null,
          descricao: descricao.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao lançar.");
        return;
      }
      // Só o valor e a descrição limpam: a próxima linha do extrato quase
      // sempre é do mesmo dia, da mesma conta e parecida.
      setOk(`${labelCategoria(categoria)} · ${formatBRL(centavosParaReais(valorCentavos))} lançado.`);
      setValorCentavos(null);
      setDescricao("");
      // O cheque saiu da carteira: não dá pra usar de novo.
      setChequeId("");
      setComCheque(false);
      setValesMarcados([]);
      if (json.valesQuitados > 0) {
        setOk(
          (a) =>
            `${a ?? ""} ${json.valesQuitados} vale${json.valesQuitados === 1 ? "" : "s"} quitado${json.valesQuitados === 1 ? "" : "s"}.`
        );
      }
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(l: Lancamento) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/contas/${l.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(json.error || "Falha ao apagar.");
      } else {
        // O servidor desfaz o que o pagamento tinha feito (cheque volta pra
        // carteira, vale volta a pendente) e conta aqui o que desfez —
        // desfazer calado é pior que não desfazer.
        if (Array.isArray(json.desfeito) && json.desfeito.length > 0) {
          setOk(`Apagado. Junto: ${json.desfeito.join("; ")}.`);
        }
        router.refresh();
      }
    } finally {
      setSalvando(false);
      setApagando(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ lançar */}
      <form onSubmit={salvar} className="card space-y-3">
        <h2 className="text-lg font-semibold">Lançar</h2>

        {erro && (
          <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
            {erro}
          </div>
        )}
        {ok && (
          <div className="bg-verde/10 border border-verde text-verde rounded-xl p-2 text-sm">
            {ok}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Quando</label>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>

          {comCheque ? (
            <div>
              <label className="block text-sm font-medium mb-1">
                Pagou com qual cheque
              </label>
              <select
                value={chequeId}
                onChange={(e) => setChequeId(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                <option value="">Escolha da carteira…</option>
                {cheques.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <SelectConta
              contas={contas}
              valor={contaId}
              onChange={setContaId}
              label="Saiu de"
            />
          )}

          <div>
            <label className="block text-sm font-medium mb-1">O que foi</label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            >
              {GRUPOS.map((g) => {
                const doGrupo = CATEGORIAS_LANCAVEIS.filter(
                  (c) => c.grupo === g.chave
                );
                if (doGrupo.length === 0) return null;
                return (
                  <optgroup key={g.chave} label={g.label}>
                    {doGrupo.map((c) => (
                      <option key={c.chave} value={c.chave}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
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
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {pedePessoa(categoria) && (
            <div>
              <label className="block text-sm font-medium mb-1">De quem</label>
              <select
                value={pessoaId}
                onChange={(e) => setPessoaId(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                <option value="">Escolha…</option>
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={pedePessoa(categoria) ? "" : "sm:col-span-2"}>
            <label className="block text-sm font-medium mb-1">
              Observação <span className="text-cinza-suave">(o que aparece no extrato)</span>
            </label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="ex: ALDO CHAPEADOR ECOSPORT"
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>
        </div>

        {categoria === "salario" && pessoaId && (() => {
          const doDele = vales.filter((v) => v.motorista_id === pessoaId);
          if (doDele.length === 0) return null;
          return (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
              <p className="text-sm font-medium">
                Esse pagamento quita algum vale?
              </p>
              <p className="text-xs text-cinza-suave">
                Vales vieram de acertos e ainda não foram descontados de
                nenhum salário. Valor negativo é o contrário: a empresa deve a
                ele e o valor <strong>soma</strong> no pagamento.
              </p>
              {doDele.map((v) => (
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
                    {v.observacao && (
                      <span className="text-cinza-suave"> · {v.observacao}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          );
        })()}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={comCheque}
            disabled={cheques.length === 0}
            onChange={(e) => setComCheque(e.target.checked)}
            className="w-5 h-5 cursor-pointer disabled:opacity-40"
          />
          <span className="text-sm">
            Paguei com um cheque da carteira
            <span className="text-cinza-suave block text-xs">
              {cheques.length === 0
                ? "Nenhum cheque na carteira agora."
                : "O cheque sai da carteira e fica registrado que pagou isto. É assim que se repassa um cheque — sempre com a despesa junto."}
            </span>
          </span>
        </label>

        <button type="submit" disabled={salvando} className="btn-primario">
          {salvando ? "Lançando…" : "Lançar"}
        </button>
      </form>

      {/* ------------------------------------------------ filtros */}
      <form className="card grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end" method="get">
        <div>
          <label className="block text-sm font-medium mb-1">De</label>
          <input
            type="date"
            name="inicio"
            defaultValue={filtros.inicio}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Até</label>
          <input
            type="date"
            name="fim"
            defaultValue={filtros.fim}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select
            name="categoria"
            defaultValue={filtros.categoria}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2"
          >
            <option value="">Todas</option>
            {CATEGORIAS_LANCAVEIS.map((c) => (
              <option key={c.chave} value={c.chave}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Conta</label>
          <select
            name="conta_id"
            defaultValue={filtros.conta_id}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2"
          >
            <option value="">Todas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primario">
          Filtrar
        </button>
      </form>

      {/* ------------------------------------------------ lista */}
      <div className="card">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">
            {lancamentos.length} lançamento{lancamentos.length === 1 ? "" : "s"}
          </h2>
          <span className="text-xl font-bold">{formatBRL(total)}</span>
        </div>

        {lancamentos.length === 0 ? (
          <p className="text-cinza-suave text-sm">
            Nenhum lançamento no período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Conta</th>
                  <th className="py-2 pr-3">O que foi</th>
                  <th className="py-2 pr-3">Quem</th>
                  <th className="py-2 pr-3">Observação</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l) => {
                  const daOrigem = contaVeioDeLancamento(l.origem_tipo);
                  return (
                    <tr key={l.id} className="border-b border-cinza-borda">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatData(l.pago_em)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {l.conta_id ? nomeConta.get(l.conta_id) ?? "—" : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {labelCategoria(l.categoria)}
                        {daOrigem && (
                          <span
                            className="ml-1 text-xs text-cinza-suave"
                            title="Veio de um lançamento operacional (abastecimento, manutenção, coleta, documento). Conta normalmente — mas se apagar, apague na tela de origem."
                          >
                            ↩︎
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {l.pessoa_id ? nomePessoa.get(l.pessoa_id) ?? "—" : "—"}
                      </td>
                      <td className="py-2 pr-3 text-cinza-suave">
                        {l.descricao !== labelCategoria(l.categoria)
                          ? l.descricao
                          : l.observacao || "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">
                        {formatBRL(l.valor)}
                      </td>
                      <td className="py-2 pr-3">
                        {!daOrigem && (
                          <button
                            onClick={() => setApagando(l)}
                            className="text-alerta hover:underline"
                          >
                            Apagar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {apagando && (
        <ModalConfirmar
          titulo="Apagar lançamento"
          descricao={`${labelCategoria(apagando.categoria)} · ${formatBRL(apagando.valor)} em ${formatData(apagando.pago_em)}. O saldo da conta volta sozinho.`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={() => apagar(apagando)}
          onFechar={() => setApagando(null)}
        />
      )}
    </div>
  );
}
