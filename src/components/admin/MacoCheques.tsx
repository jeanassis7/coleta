"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import { ModalConfirmar } from "@/components/admin/Modais";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import type { Cheque } from "@/lib/admin/queries";

/**
 * O MAÇO — depositar vários cheques de uma vez e compensar o maço inteiro.
 *
 * Por que isto existe: em 15/09/2026 o Evaner depositou 10 cheques
 * (R$ 36.841,69) clicando um a um. O maço se forma por DATA ("bom para"),
 * misturando emitentes e compradores — é assim que o banco recebe, então é
 * assim que a tela lista. Comprador aparece como informação, nunca como
 * agrupamento.
 *
 * Os dois blocos são o mesmo fluxo em dois momentos:
 *   1. DEPOSITAR  — leva o maço ao banco. NÃO é dinheiro ainda.
 *   2. COMPENSAR  — o gestor abre o extrato, vê o que caiu e tica. Aqui sim
 *                   o dinheiro entra no caixa.
 *
 * O maço de compensação não é tabela: é "mesma conta + mesma data de
 * depósito", que é exatamente como o extrato mostra.
 */
function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function venceu(bomPara: string): boolean {
  return bomPara.slice(0, 10) <= hojeBr();
}

export function MacoCheques({
  cheques,
  contas,
}: {
  cheques: Cheque[];
  contas: ContaOpcao[];
}) {
  const carteira = useMemo(
    () =>
      cheques
        .filter((c) => c.status === "em_carteira")
        .sort((a, b) => a.bom_para.localeCompare(b.bom_para)),
    [cheques]
  );

  const macos = useMemo(() => {
    const porChave = new Map<string, Cheque[]>();
    for (const c of cheques) {
      if (c.status !== "depositado") continue;
      const chave = `${c.conta_id ?? "sem-conta"}|${c.depositado_em ?? "sem-data"}`;
      porChave.set(chave, [...(porChave.get(chave) ?? []), c]);
    }
    return [...porChave.entries()]
      .map(([chave, lista]) => ({
        chave,
        contaId: lista[0].conta_id,
        data: lista[0].depositado_em,
        cheques: lista.sort((a, b) => a.bom_para.localeCompare(b.bom_para)),
        total: lista.reduce((s, c) => s + c.valor, 0),
      }))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }, [cheques]);

  return (
    <div className="space-y-4 mb-6">
      {carteira.length > 0 && (
        <BlocoDeposito carteira={carteira} contas={contas} />
      )}
      {macos.map((m) => (
        <BlocoMaco key={m.chave} maco={m} contas={contas} />
      ))}
    </div>
  );
}

// ===========================================================================
// 1) DEPOSITAR
// ===========================================================================

function BlocoDeposito({
  carteira,
  contas,
}: {
  carteira: Cheque[];
  contas: ContaOpcao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [conta, setConta] = useState("");
  const [data, setData] = useState(hojeBr());
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const vencidos = carteira.filter((c) => venceu(c.bom_para));
  const total = carteira
    .filter((c) => marcados.has(c.id))
    .reduce((s, c) => s + c.valor, 0);

  function alternar(id: string) {
    const novo = new Set(marcados);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setMarcados(novo);
    setErro(null);
  }

  async function enviar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/admin/cheques/deposito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cheques: [...marcados],
          conta_id: conta,
          data,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não consegui depositar");
        return;
      }
      setMarcados(new Set());
      setConfirmando(false);
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">Depositar um maço de cheques</div>
            <div className="text-sm text-cinza-suave">
              {carteira.length} na carteira
              {vencidos.length > 0 && (
                <>
                  {" · "}
                  <span className="text-alerta font-medium">
                    {vencidos.length} já passaram do bom para
                  </span>
                </>
              )}
            </div>
          </div>
          <button onClick={() => setAberto(true)} className="btn-primario">
            Montar maço
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Depositar um maço de cheques</div>
        <button
          onClick={() => setAberto(false)}
          className="text-sm text-cinza-suave hover:underline"
        >
          fechar
        </button>
      </div>

      <p className="text-sm text-cinza-suave">
        Ordenados pelo <strong>bom para</strong>, do mais antigo pro mais novo —
        de quem é o cheque não importa aqui. Depositar{" "}
        <strong>não é dinheiro na conta</strong>: o caixa só muda quando você
        confirmar que o valor caiu.
      </p>

      <div className="flex gap-2 flex-wrap">
        {vencidos.length > 0 && (
          <button
            onClick={() => setMarcados(new Set(vencidos.map((c) => c.id)))}
            className="text-sm px-3 py-1.5 rounded-lg border border-cinza-borda hover:bg-slate-50"
          >
            Marcar os {vencidos.length} vencidos
          </button>
        )}
        <button
          onClick={() => setMarcados(new Set(carteira.map((c) => c.id)))}
          className="text-sm px-3 py-1.5 rounded-lg border border-cinza-borda hover:bg-slate-50"
        >
          Marcar todos
        </button>
        {marcados.size > 0 && (
          <button
            onClick={() => setMarcados(new Set())}
            className="text-sm px-3 py-1.5 rounded-lg border border-cinza-borda hover:bg-slate-50"
          >
            Limpar
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto border border-cinza-borda rounded-xl">
        <table className="w-full text-sm">
          <tbody>
            {carteira.map((c) => (
              <tr
                key={c.id}
                className="border-b border-cinza-borda last:border-0 hover:bg-slate-50"
              >
                <td className="py-2 pl-3 w-8">
                  <input
                    type="checkbox"
                    checked={marcados.has(c.id)}
                    onChange={() => alternar(c.id)}
                    className="w-4 h-4"
                  />
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={venceu(c.bom_para) ? "text-alerta font-medium" : ""}>
                    {formatData(c.bom_para)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-cinza-suave">
                  {c.banco} · {c.numero || "s/nº"}
                </td>
                <td className="py-2 pr-3">{c.emitente}</td>
                <td className="py-2 pr-3 text-cinza-suave text-xs">
                  {c.comprador_nome}
                </td>
                <td className="py-2 pr-3 text-right font-mono font-semibold whitespace-nowrap">
                  {formatBRL(c.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <SelectConta
          contas={contas}
          valor={conta}
          onChange={setConta}
          label="Depositado em qual conta"
        />
        <div>
          <label className="block text-sm font-medium mb-1">
            Data do depósito
          </label>
          <input
            type="date"
            value={data}
            max={hojeBr()}
            onChange={(e) => setData(e.target.value)}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-cinza-borda pt-3">
        <div>
          <div className="text-xs text-cinza-suave">
            {marcados.size} cheque{marcados.size === 1 ? "" : "s"} no maço
          </div>
          <div className="text-2xl font-bold font-mono">{formatBRL(total)}</div>
        </div>
        <button
          onClick={() => setConfirmando(true)}
          disabled={marcados.size === 0 || !conta}
          className="btn-primario disabled:opacity-40"
        >
          Depositar
        </button>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {confirmando && (
        <ModalConfirmar
          titulo={`Depositar ${marcados.size} cheque${marcados.size === 1 ? "" : "s"}?`}
          descricao={`${formatBRL(total)} em ${
            contas.find((c) => c.id === conta)?.nome ?? "a conta escolhida"
          }, em ${formatData(data)}. Isso NÃO põe dinheiro no caixa — o valor só entra quando você confirmar que caiu. Ou o maço inteiro entra, ou nenhum entra.`}
          confirmarLabel="Depositar o maço"
          carregando={salvando}
          onConfirmar={enviar}
          onFechar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// 2) COMPENSAR O MAÇO
// ===========================================================================

function BlocoMaco({
  maco,
  contas,
}: {
  maco: {
    chave: string;
    contaId: string | null;
    data: string | null;
    cheques: Cheque[];
    total: number;
  };
  contas: ContaOpcao[];
}) {
  const router = useRouter();
  // Nasce com tudo marcado: o caso normal é o maço inteiro cair. Quem não
  // caiu, o gestor desmarca — e resolve individualmente.
  const [marcados, setMarcados] = useState<Set<string>>(
    new Set(maco.cheques.map((c) => c.id))
  );
  const [data, setData] = useState(hojeBr());
  const [contaFallback, setContaFallback] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nomeConta =
    contas.find((c) => c.id === maco.contaId)?.nome ?? null;
  const total = maco.cheques
    .filter((c) => marcados.has(c.id))
    .reduce((s, c) => s + c.valor, 0);

  function alternar(id: string) {
    const novo = new Set(marcados);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setMarcados(novo);
    setErro(null);
  }

  async function compensar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/admin/cheques/compensacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cheques: [...marcados],
          data,
          conta_id: maco.contaId ? null : contaFallback || null,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não consegui compensar");
        return;
      }
      setConfirmando(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  async function tirarDoMaco(id: string) {
    setErro(null);
    const res = await fetch(`/api/admin/cheques/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "desfazer_deposito" }),
    });
    const r = await res.json();
    if (!res.ok) {
      setErro(r.error || "não consegui tirar do maço");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card border-2 border-blue-200 space-y-3">
      <div>
        <div className="font-semibold">
          Depositado{nomeConta ? ` no ${nomeConta}` : ""}
          {maco.data ? ` em ${formatData(maco.data)}` : ""}
        </div>
        <div className="text-sm text-cinza-suave">
          {maco.cheques.length} cheque{maco.cheques.length === 1 ? "" : "s"} ·{" "}
          {formatBRL(maco.total)} — esperando cair na conta
        </div>
      </div>

      <p className="text-sm text-cinza-suave">
        Abra o extrato e <strong>tique o que caiu</strong>. O que não caiu,
        desmarque — e resolva com &quot;Voltou&quot; na lista abaixo, ou tire do
        maço se o depósito nem aconteceu.
      </p>

      <div className="border border-cinza-borda rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {maco.cheques.map((c) => (
              <tr
                key={c.id}
                className="border-b border-cinza-borda last:border-0 hover:bg-slate-50"
              >
                <td className="py-2 pl-3 w-8">
                  <input
                    type="checkbox"
                    checked={marcados.has(c.id)}
                    onChange={() => alternar(c.id)}
                    className="w-4 h-4"
                  />
                </td>
                <td className="py-2 pr-3 text-cinza-suave whitespace-nowrap">
                  {c.banco} · {c.numero || "s/nº"}
                </td>
                <td className="py-2 pr-3">{c.emitente}</td>
                <td className="py-2 pr-3 text-right font-mono font-semibold whitespace-nowrap">
                  {formatBRL(c.valor)}
                </td>
                <td className="py-2 pr-3 text-right">
                  <button
                    onClick={() => tirarDoMaco(c.id)}
                    className="text-xs text-cinza-suave hover:underline"
                    title="O depósito desse cheque não aconteceu — ele volta pra carteira."
                  >
                    tirar do maço
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Maço anterior à 0071: não sabe em qual conta caiu. */}
      {!maco.contaId && (
        <SelectConta
          contas={contas}
          valor={contaFallback}
          onChange={setContaFallback}
          label="Em qual conta esse dinheiro caiu"
        />
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">
            Data em que caiu
          </label>
          <input
            type="date"
            value={data}
            max={hojeBr()}
            onChange={(e) => setData(e.target.value)}
            className="w-full border border-cinza-borda rounded-lg px-3 py-2 text-base"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => setConfirmando(true)}
            disabled={
              marcados.size === 0 || (!maco.contaId && !contaFallback)
            }
            className="btn-primario w-full disabled:opacity-40"
          >
            Caiu {formatBRL(total)}
          </button>
        </div>
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {confirmando && (
        <ModalConfirmar
          titulo={`Confirmar ${formatBRL(total)} na conta?`}
          descricao={`${marcados.size} cheque${marcados.size === 1 ? "" : "s"} compensado${marcados.size === 1 ? "" : "s"} em ${formatData(data)}. A partir daqui esse dinheiro é caixa de verdade e entra no saldo${
            marcados.size < maco.cheques.length
              ? `. Os outros ${maco.cheques.length - marcados.size} ficam depositados, esperando`
              : ""
          }.`}
          confirmarLabel="Confirmar entrada"
          carregando={salvando}
          onConfirmar={compensar}
          onFechar={() => setConfirmando(false)}
        />
      )}
    </div>
  );
}
