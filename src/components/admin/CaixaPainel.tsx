"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InputDinheiro, centavosParaReais, reaisParaCentavos } from "@/components/InputDinheiro";
import { ModalConfirmar } from "./Modais";
import { formatBRL, formatData } from "@/lib/format";
import type {
  ContaFinanceira,
  SaldoConta,
  DinheiroNaMao,
  Patrimonio,
  MovimentoAvulso,
} from "@/lib/admin/caixa";

// Local de propÃ³sito: importar um VALOR de caixa.ts puxaria o mÃ³dulo
// server-only (getSupabaseServer) pro bundle do cliente e o build quebra.
const ROTULO_ENTRADA_AVULSA: Record<string, string> = {
  aporte: "Aporte de sÃ³cio",
  emprestimo: "EmprÃ©stimo recebido",
  reembolso: "Reembolso",
  rendimento: "Rendimento",
  venda_ativo: "Venda de bem",
  outra: "Outra entrada",
  ajuste: "Ajuste de caixa",
};

type TransferenciaLista = {
  id: string;
  valor: number;
  data: string;
  descricao: string | null;
  origem_nome: string;
  destino_nome: string;
};

export function CaixaPainel({
  contas,
  saldos,
  naMao,
  transferencias,
  movimentosAvulsos,
  patrimonio,
}: {
  contas: ContaFinanceira[];
  saldos: SaldoConta[];
  naMao: DinheiroNaMao[];
  transferencias: TransferenciaLista[];
  movimentosAvulsos: MovimentoAvulso[];
  patrimonio: Patrimonio;
}) {
  const router = useRouter();
  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [formTransf, setFormTransf] = useState(false);
  const [formConta, setFormConta] = useState(false);
  const [apagarTransf, setApagarTransf] = useState<TransferenciaLista | null>(null);

  // --- ediÃ§Ã£o de conta ---
  const [editando, setEditando] = useState<ContaFinanceira | null>(null);
  const [edNome, setEdNome] = useState("");
  const [edBanco, setEdBanco] = useState("");
  const [edSaldo, setEdSaldo] = useState<number | null>(null);
  const [edSaldoEm, setEdSaldoEm] = useState("");
  const [confirmarDesativar, setConfirmarDesativar] = useState(false);
  const [confirmarApagarConta, setConfirmarApagarConta] = useState(false);

  // Os dropdowns de lanÃ§amento sÃ³ mostram conta ativa; a lista completa
  // (com inativas) existe pra editar e reativar.
  const contasAtivas = contas.filter((c) => c.ativa);
  const contasInativas = contas.filter((c) => !c.ativa);
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const saldoPorConta = new Map(saldos.map((s) => [s.conta_id, s.saldo]));

  // --- transferÃªncia ---
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [valorTransf, setValorTransf] = useState<number | null>(null);
  const [dataTransf, setDataTransf] = useState(hoje);
  const [descTransf, setDescTransf] = useState("");

  // --- conta nova ---
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"especie" | "banco">("banco");
  const [banco, setBanco] = useState("");
  const [saldoInicial, setSaldoInicial] = useState<number | null>(null);
  const [saldoEm, setSaldoEm] = useState(hoje);

  // --- entrada avulsa (0047: aporte, emprÃ©stimo, reembolsoâ€¦) ---
  const [formEntrada, setFormEntrada] = useState(false);
  const [tipoEntrada, setTipoEntrada] = useState("aporte");
  const [valorEntrada, setValorEntrada] = useState<number | null>(null);
  const [dataEntrada, setDataEntrada] = useState(hoje);
  const [contaEntrada, setContaEntrada] = useState("");
  const [descEntrada, setDescEntrada] = useState("");

  // --- ajuste de caixa (conferÃªncia da gaveta) ---
  const [formAjuste, setFormAjuste] = useState(false);
  const [contaAjuste, setContaAjuste] = useState("");
  const [direcaoAjuste, setDirecaoAjuste] = useState<"falta" | "sobra">("falta");
  const [valorAjuste, setValorAjuste] = useState<number | null>(null);
  const [dataAjuste, setDataAjuste] = useState(hoje);
  const [motivoAjuste, setMotivoAjuste] = useState("");

  const [apagandoAvulso, setApagandoAvulso] = useState<MovimentoAvulso | null>(null);

  const totalContas = saldos.reduce((s, c) => s + c.saldo, 0);
  const totalNaMao = naMao.reduce((s, m) => s + m.saldo, 0);

  async function chamar(url: string, body: unknown, metodo = "POST") {
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: metodo === "DELETE" ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha na operaÃ§Ã£o.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setSalvando(false);
    }
  }

  async function transferir(e: React.FormEvent) {
    e.preventDefault();
    if (!valorTransf) return setErro("Quanto foi transferido?");
    const ok = await chamar("/api/admin/transferencias", {
      conta_origem_id: origem,
      conta_destino_id: destino,
      valor: centavosParaReais(valorTransf),
      data: dataTransf,
      descricao: descTransf.trim() || null,
    });
    if (ok) {
      setValorTransf(null);
      setDescTransf("");
      setFormTransf(false);
    }
  }

  async function criarConta(e: React.FormEvent) {
    e.preventDefault();
    const ok = await chamar("/api/admin/contas-financeiras", {
      nome: nome.trim(),
      tipo,
      banco: tipo === "banco" ? banco.trim() : null,
      saldo_inicial: saldoInicial ? centavosParaReais(saldoInicial) : 0,
      saldo_inicial_em: saldoEm,
    });
    if (ok) {
      setNome("");
      setBanco("");
      setSaldoInicial(null);
      setFormConta(false);
    }
  }

  function abrirEdicao(c: ContaFinanceira) {
    setEditando(c);
    setEdNome(c.nome);
    setEdBanco(c.banco ?? "");
    setEdSaldo(reaisParaCentavos(c.saldo_inicial));
    setEdSaldoEm(c.saldo_inicial_em);
    setFormConta(false);
    setFormTransf(false);
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    if (!edNome.trim()) return setErro("A conta precisa de um nome.");
    const ok = await chamar(
      `/api/admin/contas-financeiras/${editando.id}`,
      {
        nome: edNome.trim(),
        banco: editando.tipo === "banco" ? edBanco.trim() || null : null,
        saldo_inicial: edSaldo != null ? centavosParaReais(edSaldo) : 0,
        saldo_inicial_em: edSaldoEm,
      },
      "PATCH"
    );
    if (ok) setEditando(null);
  }

  async function mudarAtiva(conta: ContaFinanceira, ativa: boolean) {
    const ok = await chamar(
      `/api/admin/contas-financeiras/${conta.id}`,
      { ativa },
      "PATCH"
    );
    if (ok) {
      setConfirmarDesativar(false);
      setEditando(null);
    }
  }

  async function lancarEntrada(e: React.FormEvent) {
    e.preventDefault();
    if (!valorEntrada) return setErro("Quanto entrou?");
    const ok = await chamar("/api/admin/entradas-avulsas", {
      tipo: tipoEntrada,
      valor: centavosParaReais(valorEntrada),
      data: dataEntrada,
      conta_id: contaEntrada,
      descricao: descEntrada.trim(),
    });
    if (ok) {
      setValorEntrada(null);
      setDescEntrada("");
      setFormEntrada(false);
    }
  }

  async function lancarAjuste(e: React.FormEvent) {
    e.preventDefault();
    if (!valorAjuste) return setErro("Qual foi a diferenÃ§a encontrada?");
    const ok = await chamar("/api/admin/ajustes-caixa", {
      valor:
        (direcaoAjuste === "falta" ? -1 : 1) * centavosParaReais(valorAjuste),
      data: dataAjuste,
      conta_id: contaAjuste,
      motivo: motivoAjuste.trim(),
    });
    if (ok) {
      setValorAjuste(null);
      setMotivoAjuste("");
      setFormAjuste(false);
    }
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      {/* --------------------------------------------------- saldos */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {saldos.map((c) => (
          <div key={c.conta_id} className="card">
            <div className="text-sm text-cinza-suave">
              {c.tipo === "especie" ? "ðŸ’µ" : "ðŸ¦"} {c.nome}
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${
                c.saldo < 0 ? "text-alerta" : ""
              }`}
            >
              {formatBRL(c.saldo)}
            </div>
            <div className="text-xs text-cinza-suave mt-1 flex items-center justify-between gap-2">
              <span>
                entrou {formatBRL(c.entradas)} Â· saiu {formatBRL(c.saidas)}
              </span>
              <button
                onClick={() => {
                  const conta = contaPorId.get(c.conta_id);
                  if (conta) abrirEdicao(conta);
                }}
                className="text-verde hover:underline font-medium"
              >
                editar
              </button>
            </div>
          </div>
        ))}

        {naMao.length > 0 && (
          <div className="card bg-slate-50">
            <div className="text-sm text-cinza-suave">ðŸšš Na mÃ£o dos motoristas</div>
            <div className="text-2xl font-bold mt-1">{formatBRL(totalNaMao)}</div>
            <div className="text-xs text-cinza-suave mt-1 space-y-0.5">
              {naMao.map((m) => (
                <div key={m.motorista_id}>
                  {m.nome}: {formatBRL(m.saldo)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --------------------------------------------------- patrimÃ´nio (R87) */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-1">PatrimÃ´nio</h2>
        <p className="text-sm text-cinza-suave mb-3">
          Todo o <strong>giro</strong> da empresa, num nÃºmero sÃ³ â€” dinheiro,
          Ã³leo, papel, o que hÃ¡ pra receber e o que jÃ¡ se deve. O Ã³leo vale o
          preÃ§o de referÃªncia, sempre o mesmo, pra dar pra ver se o patrimÃ´nio
          sobe ou desce sem o preÃ§o do mercado embaralhar a leitura. Bem
          parado (caminhÃ£o, galpÃ£o) fica fora de propÃ³sito.
        </p>

        <table className="w-full text-sm">
          <tbody>
            {saldos.map((c) => (
              <tr key={c.conta_id} className="border-b border-cinza-borda">
                <td className="py-2 pr-3">
                  {c.tipo === "especie" ? "ðŸ’µ" : "ðŸ¦"} {c.nome}
                </td>
                <td className="py-2 text-right font-mono whitespace-nowrap">
                  {formatBRL(c.saldo)}
                </td>
              </tr>
            ))}
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">ðŸšš Em mÃ£os de motoristas</td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(totalNaMao)}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                ðŸ›¢ Valor em estoque{" "}
                <span className="text-cinza-suave text-xs">
                  ({Math.round(patrimonio.estoqueLitros).toLocaleString("pt-BR")}{" "}
                  L Ã— preÃ§o de referÃªncia)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(patrimonio.valorEstoque)}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                ðŸš› Ã“leo nos caminhÃµes{" "}
                <span className="text-cinza-suave text-xs">
                  ({Math.round(patrimonio.oleoCaminhoesLitros).toLocaleString("pt-BR")}{" "}
                  L coletados, ainda nÃ£o pesados)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(patrimonio.valorOleoCaminhoes)}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                ðŸ§¾ Cheques em aberto{" "}
                <span className="text-cinza-suave text-xs">
                  (carteira + depositados; devolvido fica fora â€” a dÃ­vida do
                  comprador jÃ¡ voltou)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(patrimonio.chequesAbertos)}
              </td>
            </tr>
            {patrimonio.adiantamentosPendentes > 0 && (
              <tr className="border-b border-cinza-borda">
                <td className="py-2 pr-3">
                  ðŸ“¨ A caminho{" "}
                  <span className="text-cinza-suave text-xs">
                    (adiantamento enviado, motorista ainda nÃ£o aceitou â€” jÃ¡
                    saiu da conta, ainda nÃ£o estÃ¡ na mÃ£o dele)
                  </span>
                </td>
                <td className="py-2 text-right font-mono whitespace-nowrap">
                  {formatBRL(patrimonio.adiantamentosPendentes)}
                </td>
              </tr>
            )}
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                ðŸ“¥ A receber dos compradores{" "}
                <span className="text-cinza-suave text-xs">
                  (venda entregue, sem dinheiro e sem cheque ainda)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(patrimonio.aReceberCompradores)}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                ðŸ“¤ (âˆ’) Contas a pagar em aberto{" "}
                <span className="text-cinza-suave text-xs">
                  (dÃ­vida certa; prevista fica fora â€” Ã© palpite)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap text-alerta">
                {formatBRL(-patrimonio.contasAPagarAbertas)}
              </td>
            </tr>
            <tr>
              <td className="py-3 pr-3 font-semibold">TOTAL</td>
              <td className="py-3 text-right font-bold text-xl whitespace-nowrap">
                {formatBRL(
                  totalContas +
                    totalNaMao +
                    patrimonio.valorEstoque +
                    patrimonio.valorOleoCaminhoes +
                    patrimonio.chequesAbertos +
                    patrimonio.adiantamentosPendentes +
                    patrimonio.aReceberCompradores -
                    patrimonio.contasAPagarAbertas
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3 text-sm text-cinza-suave">
          PreÃ§o de referÃªncia:{" "}
          <strong>{formatBRL(patrimonio.precoReferenciaLitro)}/litro</strong>{" "}
          (um sÃ³ pra fino e grosso â€” fixo no cÃ³digo por decisÃ£o de 21/08;
          mudar Ã© mexer no cÃ³digo, de propÃ³sito)
        </p>
      </div>

      {/* --------------------------------------------------- aÃ§Ãµes */}
      <div className="flex gap-4 flex-wrap">
        <button
          onClick={() => {
            setFormTransf((v) => !v);
            if (contasAtivas.length >= 2 && !origem) {
              setOrigem(contasAtivas[0].id);
              setDestino(contasAtivas[1].id);
            }
          }}
          className="btn-primario"
          disabled={contasAtivas.length < 2}
          title={
            contasAtivas.length < 2
              ? "Cadastre pelo menos duas contas pra poder transferir"
              : undefined
          }
        >
          â‡„ Transferir entre contas
        </button>
        <button
          onClick={() => {
            setFormEntrada((v) => !v);
            setFormAjuste(false);
            if (!contaEntrada && contasAtivas.length > 0)
              setContaEntrada(contasAtivas[0].id);
          }}
          className="text-verde hover:underline text-sm font-medium"
        >
          + Entrada avulsa
        </button>
        <button
          onClick={() => {
            setFormAjuste((v) => !v);
            setFormEntrada(false);
            if (!contaAjuste && contasAtivas.length > 0)
              setContaAjuste(contasAtivas[0].id);
          }}
          className="text-verde hover:underline text-sm font-medium"
        >
          âš– Conferi a gaveta (ajuste)
        </button>
        <button
          onClick={() => setFormConta((v) => !v)}
          className="text-verde hover:underline text-sm font-medium"
        >
          + Cadastrar conta
        </button>
      </div>

      {/* --------------------------------------------------- form entrada avulsa */}
      {formEntrada && (
        <form onSubmit={lancarEntrada} className="card space-y-3">
          <h2 className="text-lg font-semibold">Entrada avulsa</h2>
          <p className="text-sm text-cinza-suave">
            Dinheiro que entra <strong>sem ser venda de Ã³leo</strong>: aporte
            de sÃ³cio, emprÃ©stimo recebido, reembolso, rendimento, venda de um
            bem. Entra no caixa e <strong>fica fora do DRE</strong> â€” nÃ£o Ã©
            resultado da operaÃ§Ã£o. Pagamento de comprador NÃƒO Ã© aqui: Ã© na
            ficha dele.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">O que Ã©</label>
              <select
                value={tipoEntrada}
                onChange={(e) => setTipoEntrada(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                <option value="aporte">Aporte de sÃ³cio</option>
                <option value="emprestimo">EmprÃ©stimo recebido</option>
                <option value="reembolso">Reembolso</option>
                <option value="rendimento">Rendimento</option>
                <option value="venda_ativo">Venda de bem</option>
                <option value="outra">Outra entrada</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valor</label>
              <InputDinheiro
                centavos={valorEntrada}
                onChange={setValorEntrada}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quando</label>
              <input
                type="date"
                value={dataEntrada}
                onChange={(e) => setDataEntrada(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Entrou em</label>
              <select
                value={contaEntrada}
                onChange={(e) => setContaEntrada(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {contasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">De onde veio</label>
            <input
              value={descEntrada}
              onChange={(e) => setDescEntrada(e.target.value)}
              placeholder="ex: aporte do Jean pra virada / emprÃ©stimo BB 24x"
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>
          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvandoâ€¦" : "LanÃ§ar entrada"}
          </button>
        </form>
      )}

      {/* --------------------------------------------------- form ajuste de caixa */}
      {formAjuste && (
        <form onSubmit={lancarAjuste} className="card space-y-3">
          <h2 className="text-lg font-semibold">Ajuste de caixa</h2>
          <p className="text-sm text-cinza-suave">
            Conferiu a gaveta (ou o extrato) e a conta nÃ£o bateu? LanÃ§a aqui a{" "}
            <strong>diferenÃ§a</strong>, com o motivo â€” igual ao inventÃ¡rio do
            estoque. Fora do DRE: Ã© conferÃªncia, nÃ£o gasto.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Conta conferida</label>
              <select
                value={contaAjuste}
                onChange={(e) => setContaAjuste(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {contasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Deuâ€¦</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDirecaoAjuste("falta")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm ${
                    direcaoAjuste === "falta"
                      ? "bg-alerta text-white border-alerta"
                      : "bg-white border-cinza-borda"
                  }`}
                >
                  Falta
                </button>
                <button
                  type="button"
                  onClick={() => setDirecaoAjuste("sobra")}
                  className={`flex-1 px-3 py-2 rounded-xl border-2 text-sm ${
                    direcaoAjuste === "sobra"
                      ? "bg-verde text-white border-verde"
                      : "bg-white border-cinza-borda"
                  }`}
                >
                  Sobra
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">DiferenÃ§a</label>
              <InputDinheiro
                centavos={valorAjuste}
                onChange={setValorAjuste}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quando conferiu</label>
              <input
                type="date"
                value={dataAjuste}
                onChange={(e) => setDataAjuste(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Motivo</label>
            <input
              value={motivoAjuste}
              onChange={(e) => setMotivoAjuste(e.target.value)}
              placeholder="ex: troco dado errado na semana / tarifa nÃ£o lanÃ§ada"
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>
          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvandoâ€¦" : "LanÃ§ar ajuste"}
          </button>
        </form>
      )}

      {/* --------------------------------------------------- form transferÃªncia */}
      {formTransf && (
        <form onSubmit={transferir} className="card space-y-3">
          <h2 className="text-lg font-semibold">Transferir</h2>
          <p className="text-sm text-cinza-suave">
            Saque, depÃ³sito, PIX entre contas suas. Isso <strong>nÃ£o Ã©
            despesa</strong> â€” Ã© o mesmo dinheiro mudando de lugar, e nÃ£o entra
            no DRE.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Saiu de</label>
              <select
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {contasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Foi pra</label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                {contasAtivas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valor</label>
              <InputDinheiro
                centavos={valorTransf}
                onChange={setValorTransf}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quando</label>
              <input
                type="date"
                value={dataTransf}
                onChange={(e) => setDataTransf(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              O que foi <span className="text-cinza-suave">(opcional)</span>
            </label>
            <input
              value={descTransf}
              onChange={(e) => setDescTransf(e.target.value)}
              placeholder="ex: saque pro pagamento dos motoristas"
              className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
            />
          </div>
          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvandoâ€¦" : "Transferir"}
          </button>
        </form>
      )}

      {/* --------------------------------------------------- form conta */}
      {formConta && (
        <form onSubmit={criarConta} className="card space-y-3">
          <h2 className="text-lg font-semibold">Nova conta</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nome</label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="ex: Banco do Brasil"
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as "especie" | "banco")}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              >
                <option value="banco">Conta de banco</option>
                <option value="especie">Dinheiro em espÃ©cie</option>
              </select>
            </div>
            {tipo === "banco" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Banco <span className="text-cinza-suave">(opcional)</span>
                </label>
                <input
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                Quanto tem hoje
              </label>
              <InputDinheiro
                centavos={saldoInicial}
                onChange={setSaldoInicial}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Esse saldo Ã© de que dia
              </label>
              <input
                type="date"
                value={saldoEm}
                onChange={(e) => setSaldoEm(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>
          <p className="text-xs text-cinza-suave">
            O saldo de partida e a data dele sÃ£o o <strong>corte</strong>: nada
            anterior a essa data Ã© somado, porque jÃ¡ estÃ¡ embutido nesse valor.
            Sem isso o caixa nasce errado e nunca mais bate.
          </p>
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
            <strong>Importante:</strong> informe quanto tinha{" "}
            <strong>ANTES dos lanÃ§amentos desse dia</strong>. Pensa assim: Ã© o
            dinheiro que estava na gaveta quando o dia comeÃ§ou, antes de
            entrar ou sair qualquer coisa. Se vocÃª contar o dinheiro no fim do
            dia, o que entrou e saiu HOJE vai ser contado duas vezes â€” uma no
            seu nÃºmero, outra pelos lanÃ§amentos. Na dÃºvida, use o saldo de
            ontem Ã  noite com a data de hoje.
          </div>
          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvandoâ€¦" : "Cadastrar conta"}
          </button>
        </form>
      )}

      {/* --------------------------------------------------- editar conta */}
      {editando && (
        <form onSubmit={salvarEdicao} className="card space-y-3">
          <h2 className="text-lg font-semibold">
            Editar conta â€” {editando.nome}
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nome</label>
              <input
                value={edNome}
                onChange={(e) => setEdNome(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
            {editando.tipo === "banco" && (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Banco <span className="text-cinza-suave">(opcional)</span>
                </label>
                <input
                  value={edBanco}
                  onChange={(e) => setEdBanco(e.target.value)}
                  className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                Saldo de partida
              </label>
              <InputDinheiro
                centavos={edSaldo}
                onChange={setEdSaldo}
                grande={false}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Esse saldo Ã© de que dia
              </label>
              <input
                type="date"
                value={edSaldoEm}
                onChange={(e) => setEdSaldoEm(e.target.value)}
                className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
              />
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm">
            Mudar o <strong>saldo de partida</strong> ou a <strong>data</strong>{" "}
            recalcula o saldo da conta desde o comeÃ§o. Use pra corrigir um
            cadastro que nasceu errado â€” nÃ£o pra "acertar" uma diferenÃ§a de
            hoje (isso esconderia o motivo da diferenÃ§a).
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <button type="submit" disabled={salvando} className="btn-primario">
              {salvando ? "Salvandoâ€¦" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="px-4 py-2 rounded-xl border border-cinza-borda text-sm"
            >
              Cancelar
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setConfirmarDesativar(true)}
              className="text-alerta hover:underline text-sm"
            >
              Desativar conta
            </button>
            <button
              type="button"
              onClick={() => setConfirmarApagarConta(true)}
              className="text-alerta hover:underline text-sm"
            >
              Apagar
            </button>
          </div>
        </form>
      )}

      {/* --------------------------------------------------- contas desativadas */}
      {contasInativas.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">Contas desativadas</h2>
          <p className="text-sm text-cinza-suave mb-3">
            Fora dos lanÃ§amentos e do saldo. O histÃ³rico delas continua de pÃ©.
          </p>
          <div className="space-y-1">
            {contasInativas.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm border-b border-cinza-borda py-2"
              >
                <span>
                  {c.tipo === "especie" ? "ðŸ’µ" : "ðŸ¦"} {c.nome}
                </span>
                <button
                  onClick={() => mudarAtiva(c, true)}
                  disabled={salvando}
                  className="text-verde hover:underline font-medium"
                >
                  Reativar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editando && confirmarDesativar && (
        <ModalConfirmar
          titulo={`Desativar ${editando.nome}`}
          descricao={
            (saldoPorConta.get(editando.id) ?? 0) !== 0
              ? `Essa conta estÃ¡ com saldo de ${formatBRL(
                  saldoPorConta.get(editando.id) ?? 0
                )}. Desativada, ela some do painel e do total do patrimÃ´nio â€” o saldo vai junto. O certo Ã© primeiro transferir o dinheiro pra outra conta e desativar quando zerar.`
              : "A conta sai dos lanÃ§amentos e do saldo. O histÃ³rico continua de pÃ©, e dÃ¡ pra reativar quando quiser."
          }
          confirmarLabel="Desativar mesmo assim"
          perigo
          carregando={salvando}
          onConfirmar={() => mudarAtiva(editando, false)}
          onFechar={() => setConfirmarDesativar(false)}
        />
      )}

      {editando && confirmarApagarConta && (
        <ModalConfirmar
          titulo={`Apagar ${editando.nome}`}
          descricao="SÃ³ dÃ¡ pra apagar conta que nunca teve movimento â€” se tiver qualquer lanÃ§amento, o sistema recusa e o caminho Ã© desativar. Use pra desfazer um cadastro errado."
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={async () => {
            const ok = await chamar(
              `/api/admin/contas-financeiras/${editando.id}`,
              null,
              "DELETE"
            );
            setConfirmarApagarConta(false);
            if (ok) setEditando(null);
          }}
          onFechar={() => setConfirmarApagarConta(false)}
        />
      )}

      {/* --------------------------------------------------- transferÃªncias */}
      {transferencias.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">TransferÃªncias recentes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">De</th>
                  <th className="py-2 pr-3">Pra</th>
                  <th className="py-2 pr-3">O que foi</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {transferencias.map((t) => (
                  <tr key={t.id} className="border-b border-cinza-borda">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatData(t.data)}
                    </td>
                    <td className="py-2 pr-3">{t.origem_nome}</td>
                    <td className="py-2 pr-3">{t.destino_nome}</td>
                    <td className="py-2 pr-3 text-cinza-suave">
                      {t.descricao || "â€”"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono whitespace-nowrap">
                      {formatBRL(t.valor)}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => setApagarTransf(t)}
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
        </div>
      )}

      {/* --------------------------------------------------- entradas e ajustes */}
      {movimentosAvulsos.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">Entradas e ajustes</h2>
          <p className="text-sm text-cinza-suave mb-3">
            O que mexeu no caixa sem ser operaÃ§Ã£o â€” aporte, emprÃ©stimo,
            reembolso e conferÃªncias da gaveta. Nada daqui entra no DRE.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">O que foi</th>
                  <th className="py-2 pr-3">Conta</th>
                  <th className="py-2 pr-3">Detalhe</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {movimentosAvulsos.map((m) => (
                  <tr key={`${m.origem}-${m.id}`} className="border-b border-cinza-borda">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatData(m.data)}
                    </td>
                    <td className="py-2 pr-3">
                      {ROTULO_ENTRADA_AVULSA[m.tipo] ?? m.tipo}
                    </td>
                    <td className="py-2 pr-3">{m.conta_nome}</td>
                    <td className="py-2 pr-3 text-cinza-suave">{m.descricao}</td>
                    <td
                      className={`py-2 pr-3 text-right font-mono whitespace-nowrap ${
                        m.valor < 0 ? "text-alerta" : "text-verde"
                      }`}
                    >
                      {m.valor < 0 ? "âˆ’" : "+"}
                      {formatBRL(Math.abs(m.valor))}
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => setApagandoAvulso(m)}
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
        </div>
      )}

      {apagandoAvulso && (
        <ModalConfirmar
          titulo={`Apagar ${ROTULO_ENTRADA_AVULSA[apagandoAvulso.tipo] ?? "movimento"}`}
          descricao={`${formatBRL(Math.abs(apagandoAvulso.valor))} em ${apagandoAvulso.conta_nome} (${formatData(apagandoAvulso.data)}). O saldo da conta volta sozinho.`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={async () => {
            await chamar(
              apagandoAvulso.origem === "entrada"
                ? `/api/admin/entradas-avulsas/${apagandoAvulso.id}`
                : `/api/admin/ajustes-caixa/${apagandoAvulso.id}`,
              null,
              "DELETE"
            );
            setApagandoAvulso(null);
          }}
          onFechar={() => setApagandoAvulso(null)}
        />
      )}

      {apagarTransf && (
        <ModalConfirmar
          titulo="Apagar transferÃªncia"
          descricao={`${formatBRL(apagarTransf.valor)} de ${apagarTransf.origem_nome} pra ${apagarTransf.destino_nome}. Os dois saldos voltam sozinhos.`}
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={async () => {
            await chamar(
              `/api/admin/transferencias/${apagarTransf.id}`,
              null,
              "DELETE"
            );
            setApagarTransf(null);
          }}
          onFechar={() => setApagarTransf(null)}
        />
      )}
    </div>
  );
}

