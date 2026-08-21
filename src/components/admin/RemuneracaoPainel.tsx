"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";
import { ModalConfirmar } from "./Modais";
import { formatBRL, formatData } from "@/lib/format";
import {
  TIPOS_REMUNERACAO,
  type Vigencia,
  type TipoRemuneracao,
  type ComissaoMotorista,
} from "@/lib/remuneracao-tipos";

/**
 * Vigências de remuneração + o cálculo da comissão do período.
 *
 * Não existe "editar o valor": mudou, nasce uma vigência nova a partir da
 * data em que passou a valer. É isso que faz o passado continuar batendo
 * depois de um aumento.
 *
 * O cálculo aqui NÃO entra no DRE — o DRE é caixa e só vê o dinheiro quando
 * sai. Esta tela diz quanto se deve; o pagamento se lança em Lançamentos.
 */
export function RemuneracaoPainel({
  vigencias,
  pessoas,
  comissao,
  pagoPorPessoa,
  periodo,
}: {
  vigencias: Vigencia[];
  pessoas: { id: string; nome: string }[];
  comissao: ComissaoMotorista[];
  /** Comissão JÁ PAGA (contas pagas da categoria) no período, por pessoa. */
  pagoPorPessoa: Record<string, number>;
  periodo: { inicio: string; fim: string };
}) {
  const router = useRouter();
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoRemuneracao>("comissao");
  const [pessoaId, setPessoaId] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [litrosBase, setLitrosBase] = useState("200");
  const [desde, setDesde] = useState(hoje);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState<Vigencia | null>(null);

  const nome = new Map(pessoas.map((p) => [p.id, p.nome]));
  const totalComissao = comissao.reduce((s, c) => s + c.valor, 0);
  const semRegra = comissao.filter((c) => !c.regra && c.litros > 0);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valorCentavos) return setErro("Qual o valor?");
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/vigencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          pessoa_id: pessoaId || null,
          valor: centavosParaReais(valorCentavos),
          litros_base: tipo === "comissao" ? Number(litrosBase) : null,
          vigente_desde: desde,
          observacao: obs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao salvar.");
        return;
      }
      setValorCentavos(null);
      setObs("");
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(v: Vigencia) {
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/vigencias/${v.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        setErro(json.error || "Falha ao apagar.");
      } else router.refresh();
    } finally {
      setSalvando(false);
      setApagando(null);
    }
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      {/* ------------------------------------------- comissão do período */}
      <div className="card">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h2 className="text-lg font-semibold">Comissão do período</h2>
          <span className="text-2xl font-bold">{formatBRL(totalComissao)}</span>
        </div>
        <p className="text-sm text-cinza-suave mb-4">
          {formatData(periodo.inicio)} a {formatData(periodo.fim)}. A base são
          os <strong>litros da descarga</strong> — o peso da balança, não a
          soma das coletas: a balança pesa o que tem no caminhão, inclusive a
          coleta que ele esqueceu de lançar. Carga sem descarga fica pendente
          até pesar. Cada descarga usa a regra <strong>do dia dela</strong>, e
          é <strong>proporcional</strong>: 100 L numa base de 200 paga metade.
        </p>

        {semRegra.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm mb-4">
            <strong>Sem regra de comissão cadastrada</strong> pra{" "}
            {semRegra.map((c) => c.nome).join(", ")} no período. Os litros estão
            contados, mas o valor sai zero até você cadastrar a vigência.
          </div>
        )}

        {comissao.length === 0 ? (
          <p className="text-cinza-suave text-sm">
            Nenhuma descarga no período. A comissão nasce quando o peso existe
            — carga ainda aberta conta na descarga dela.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                  <th className="py-2 pr-3">Motorista</th>
                  <th className="py-2 pr-3 text-right">Litros</th>
                  <th className="py-2 pr-3">Regra usada</th>
                  <th className="py-2 pr-3 text-right">Calculado</th>
                  <th
                    className="py-2 pr-3 text-right"
                    title="Lançamentos pagos na categoria Comissão com data de pagamento dentro deste período. A comissão de um mês costuma ser paga no seguinte — mude o período pra conferir o pagamento dela."
                  >
                    Pago no período
                  </th>
                </tr>
              </thead>
              <tbody>
                {comissao.map((c) => {
                  const pago = pagoPorPessoa[c.motorista_id] ?? 0;
                  return (
                    <tr key={c.motorista_id} className="border-b border-cinza-borda">
                      <td className="py-2 pr-3 font-medium">{c.nome}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {c.litros.toLocaleString("pt-BR")} L
                      </td>
                      <td className="py-2 pr-3 text-cinza-suave">
                        {c.regra
                          ? `${formatBRL(c.regra.valor)} a cada ${c.regra.litros_base} L`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold">
                        {formatBRL(c.valor)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-mono ${
                          pago > 0 ? "" : "text-cinza-suave"
                        }`}
                      >
                        {pago > 0 ? formatBRL(pago) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-cinza-suave mt-3">
          Este número <strong>não entra no DRE sozinho</strong> — o DRE é
          regime de caixa e só conta quando o dinheiro sai. Quando pagar, lance
          em{" "}
          <a href="/admin/lancamentos" className="text-verde hover:underline">
            Lançamentos
          </a>{" "}
          na categoria Comissão.
        </p>
      </div>

      {/* ------------------------------------------------- nova vigência */}
      <div className="card">
        <p className="text-xs text-cinza-suave mb-3">
          Hoje só a vigência de <strong>comissão</strong> alimenta cálculo (a
          tabela acima). Salário, bônus e transferência a sócio ficam aqui
          como <strong>registro</strong> do combinado — o pagamento continua
          sendo lançado na mão, em Lançamentos.
        </p>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">Valores vigentes</h2>
          <button
            onClick={() => setAberto((v) => !v)}
            className="text-sm text-verde hover:underline"
          >
            {aberto ? "Cancelar" : "+ Nova vigência"}
          </button>
        </div>

        {aberto && (
          <form
            onSubmit={salvar}
            className="space-y-3 mb-5 border-b border-cinza-borda pb-5"
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">O que é</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoRemuneracao)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                >
                  {TIPOS_REMUNERACAO.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">De quem</label>
                <select
                  value={pessoaId}
                  onChange={(e) => setPessoaId(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                >
                  <option value="">Todos (regra da empresa)</option>
                  {pessoas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
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
                <label className="block text-sm font-medium mb-1">
                  A partir de
                </label>
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                />
              </div>
            </div>

            {tipo === "comissao" && (
              <div className="sm:w-64">
                <label className="block text-sm font-medium mb-1">
                  A cada quantos litros
                </label>
                <input
                  type="number"
                  min={1}
                  value={litrosBase}
                  onChange={(e) => setLitrosBase(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                />
                <p className="text-xs text-cinza-suave mt-1">
                  Proporcional: metade dos litros paga metade do valor.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">
                Observação <span className="text-cinza-suave">(opcional)</span>
              </label>
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="ex: reajuste combinado em reunião"
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>

            <p className="text-xs text-cinza-suave">
              Isto <strong>não altera</strong> os valores anteriores. Coletas e
              pagamentos antes dessa data continuam com a regra antiga — é
              assim que o histórico para de pé depois de um aumento.
            </p>

            <button type="submit" disabled={salvando} className="btn-primario">
              {salvando ? "Salvando…" : "Salvar vigência"}
            </button>
          </form>
        )}

        {vigencias.length === 0 ? (
          <p className="text-cinza-suave text-sm">
            Nenhuma vigência cadastrada. Sem isso a comissão sai zero.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                  <th className="py-2 pr-3">O que é</th>
                  <th className="py-2 pr-3">De quem</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3">Vale desde</th>
                  <th className="py-2 pr-3">Observação</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {vigencias.map((v) => (
                  <tr key={v.id} className="border-b border-cinza-borda">
                    <td className="py-2 pr-3">
                      {TIPOS_REMUNERACAO.find((t) => t.valor === v.tipo)?.label ??
                        v.tipo}
                    </td>
                    <td className="py-2 pr-3">
                      {v.pessoa_id ? (
                        nome.get(v.pessoa_id) ?? "—"
                      ) : (
                        <span className="text-cinza-suave">Todos</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">
                      {formatBRL(v.valor)}
                      {v.litros_base && (
                        <span className="text-cinza-suave">
                          {" "}
                          / {v.litros_base} L
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatData(v.vigente_desde)}
                    </td>
                    <td className="py-2 pr-3 text-cinza-suave">
                      {v.observacao || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => setApagando(v)}
                        className="text-alerta hover:underline"
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {apagando && (
        <ModalConfirmar
          titulo="Apagar vigência"
          descricao={`${formatBRL(apagando.valor)} a partir de ${formatData(apagando.vigente_desde)}. O cálculo da comissão passa a usar a vigência anterior.`}
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
