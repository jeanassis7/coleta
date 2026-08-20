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
} from "@/lib/admin/caixa";

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
  patrimonio,
}: {
  contas: ContaFinanceira[];
  saldos: SaldoConta[];
  naMao: DinheiroNaMao[];
  transferencias: TransferenciaLista[];
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

  // --- transferência ---
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
        setErro(json.error || "Falha na operação.");
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
              {c.tipo === "especie" ? "💵" : "🏦"} {c.nome}
            </div>
            <div
              className={`text-2xl font-bold mt-1 ${
                c.saldo < 0 ? "text-alerta" : ""
              }`}
            >
              {formatBRL(c.saldo)}
            </div>
            <div className="text-xs text-cinza-suave mt-1">
              entrou {formatBRL(c.entradas)} · saiu {formatBRL(c.saidas)}
            </div>
          </div>
        ))}

        {naMao.length > 0 && (
          <div className="card bg-slate-50">
            <div className="text-sm text-cinza-suave">🚚 Na mão dos motoristas</div>
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

      {/* --------------------------------------------------- patrimônio (R87) */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Patrimônio</h2>
        <p className="text-sm text-cinza-suave mb-3">
          Tudo que a empresa tem, num número só — dinheiro, óleo e papel.
          O óleo vale o <strong>preço de referência</strong>: uma conta de
          cabeça editável, sempre a mesma, pra dar pra ver se o patrimônio
          sobe ou desce mês a mês sem o preço do mercado embaralhar a leitura.
        </p>

        {patrimonio.precoReferenciaLitro === null && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm mb-3">
            <strong>Falta o preço de referência.</strong> Sem ele o óleo (em
            estoque e nos caminhões) aparece sem valor. Defina abaixo — ex.:
            R$ 2,80 por litro.
          </div>
        )}

        <table className="w-full text-sm">
          <tbody>
            {saldos.map((c) => (
              <tr key={c.conta_id} className="border-b border-cinza-borda">
                <td className="py-2 pr-3">
                  {c.tipo === "especie" ? "💵" : "🏦"} {c.nome}
                </td>
                <td className="py-2 text-right font-mono whitespace-nowrap">
                  {formatBRL(c.saldo)}
                </td>
              </tr>
            ))}
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">🚚 Em mãos de motoristas</td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(totalNaMao)}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                🛢 Valor em estoque{" "}
                <span className="text-cinza-suave text-xs">
                  ({Math.round(patrimonio.estoqueLitros).toLocaleString("pt-BR")}{" "}
                  L × preço de referência)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {patrimonio.precoReferenciaLitro !== null
                  ? formatBRL(patrimonio.valorEstoque)
                  : "—"}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                🚛 Óleo nos caminhões{" "}
                <span className="text-cinza-suave text-xs">
                  ({Math.round(patrimonio.oleoCaminhoesLitros).toLocaleString("pt-BR")}{" "}
                  L coletados, ainda não pesados)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {patrimonio.precoReferenciaLitro !== null
                  ? formatBRL(patrimonio.valorOleoCaminhoes)
                  : "—"}
              </td>
            </tr>
            <tr className="border-b border-cinza-borda">
              <td className="py-2 pr-3">
                🧾 Cheques em aberto{" "}
                <span className="text-cinza-suave text-xs">
                  (carteira + depositados; devolvido fica fora — a dívida do
                  comprador já voltou)
                </span>
              </td>
              <td className="py-2 text-right font-mono whitespace-nowrap">
                {formatBRL(patrimonio.chequesAbertos)}
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
                    patrimonio.chequesAbertos
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <PrecoReferencia
          atual={patrimonio.precoReferenciaLitro}
          onSalvo={() => router.refresh()}
        />
      </div>

      {/* --------------------------------------------------- ações */}
      <div className="flex gap-4 flex-wrap">
        <button
          onClick={() => {
            setFormTransf((v) => !v);
            if (contas.length >= 2 && !origem) {
              setOrigem(contas[0].id);
              setDestino(contas[1].id);
            }
          }}
          className="btn-primario"
          disabled={contas.length < 2}
          title={
            contas.length < 2
              ? "Cadastre pelo menos duas contas pra poder transferir"
              : undefined
          }
        >
          ⇄ Transferir entre contas
        </button>
        <button
          onClick={() => setFormConta((v) => !v)}
          className="text-verde hover:underline text-sm font-medium"
        >
          + Cadastrar conta
        </button>
      </div>

      {/* --------------------------------------------------- form transferência */}
      {formTransf && (
        <form onSubmit={transferir} className="card space-y-3">
          <h2 className="text-lg font-semibold">Transferir</h2>
          <p className="text-sm text-cinza-suave">
            Saque, depósito, PIX entre contas suas. Isso <strong>não é
            despesa</strong> — é o mesmo dinheiro mudando de lugar, e não entra
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
                {contas.map((c) => (
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
                {contas.map((c) => (
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
            {salvando ? "Salvando…" : "Transferir"}
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
                <option value="especie">Dinheiro em espécie</option>
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
                Esse saldo é de que dia
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
            O saldo de partida e a data dele são o <strong>corte</strong>: nada
            anterior a essa data é somado, porque já está embutido nesse valor.
            Sem isso o caixa nasce errado e nunca mais bate.
          </p>
          <button type="submit" disabled={salvando} className="btn-primario">
            {salvando ? "Salvando…" : "Cadastrar conta"}
          </button>
        </form>
      )}

      {/* --------------------------------------------------- transferências */}
      {transferencias.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Transferências recentes</h2>
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
                      {t.descricao || "—"}
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

      {apagarTransf && (
        <ModalConfirmar
          titulo="Apagar transferência"
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

/**
 * O preço de referência do óleo, em R$/litro — editável na própria tela.
 * Um valor só pra fino e grosso (decisão do Evaner): é régua de comparação
 * mês a mês, não precisão contábil.
 */
function PrecoReferencia({
  atual,
  onSalvo,
}: {
  atual: number | null;
  onSalvo: () => void;
}) {
  const [editando, setEditando] = useState(atual === null);
  const [centavos, setCentavos] = useState<number | null>(
    atual !== null ? reaisParaCentavos(atual) : null
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!centavos || centavos <= 0) {
      setErro("Diga o preço por litro (ex.: R$ 2,80).");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/configuracoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chave: "preco_referencia_litro",
          valor: centavosParaReais(centavos),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErro(json.error || "Falha ao salvar.");
        return;
      }
      setEditando(false);
      onSalvo();
    } finally {
      setSalvando(false);
    }
  }

  if (!editando && atual !== null) {
    return (
      <div className="mt-3 text-sm text-cinza-suave flex items-center gap-2 flex-wrap">
        <span>
          Preço de referência: <strong>{formatBRL(atual)}/litro</strong> (um só
          pra fino e grosso)
        </span>
        <button
          onClick={() => setEditando(true)}
          className="text-verde hover:underline font-medium"
        >
          mudar
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-sm font-medium mb-1">
            Preço de referência (R$ por litro)
          </label>
          <InputDinheiro centavos={centavos} onChange={setCentavos} grande={false} />
        </div>
        <button onClick={salvar} disabled={salvando} className="btn-primario">
          {salvando ? "Salvando…" : "Salvar preço"}
        </button>
        {atual !== null && (
          <button
            onClick={() => {
              setEditando(false);
              setCentavos(reaisParaCentavos(atual));
              setErro(null);
            }}
            className="px-4 py-2 rounded-xl border border-cinza-borda text-sm"
          >
            Cancelar
          </button>
        )}
      </div>
      <p className="text-xs text-cinza-suave">
        Mudar o preço muda o valor das duas linhas de óleo daqui pra frente —
        o histórico de movimentos não é tocado.
      </p>
    </div>
  );
}
