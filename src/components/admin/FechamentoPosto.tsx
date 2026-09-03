"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";

interface NotaAberta {
  conta_id: string;
  quando: string;
  quem: string;
  valor: number;
}

/**
 * O acerto com o posto.
 *
 * A tela faz a conta na cara do gestor ANTES de ele confirmar: quanto está
 * selecionado, quanto está sendo pago, e o que sobra. O troco não é um campo
 * escondido — ele APARECE sozinho no instante em que o pagamento passa do
 * total, com o valor já calculado, porque foi assim que o dinheiro sumiu do
 * caixa da última vez (varredura 21/08: cheque maior que a despesa).
 */
export function FechamentoPosto({
  postoId,
  postoNome,
  notas,
  contas,
  cheques,
}: {
  postoId: string;
  postoNome: string;
  notas: NotaAberta[];
  contas: { id: string; nome: string }[];
  cheques: {
    id: string;
    valor: number;
    banco: string | null;
    numero: string | null;
    bom_para: string | null;
  }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(
    new Set(notas.map((n) => n.conta_id))
  );
  const [chequesUsados, setChequesUsados] = useState<Set<string>>(new Set());
  const [dinheiroCentavos, setDinheiroCentavos] = useState<number | null>(null);
  const [dinheiroForma, setDinheiroForma] = useState("dinheiro");
  const [dinheiroConta, setDinheiroConta] = useState("");
  const [trocoConta, setTrocoConta] = useState("");
  const [data, setData] = useState(
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const totalDevido = notas
    .filter((n) => marcadas.has(n.conta_id))
    .reduce((s, n) => s + n.valor, 0);
  const totalCheques = cheques
    .filter((c) => chequesUsados.has(c.id))
    .reduce((s, c) => s + c.valor, 0);
  const dinheiro = dinheiroCentavos ? centavosParaReais(dinheiroCentavos) : 0;
  const totalPago = totalCheques + dinheiro;
  const diferenca = Math.round((totalPago - totalDevido) * 100) / 100;

  function alternar(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const novo = new Set(set);
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    setter(novo);
    setConfirmando(false);
    setErro(null);
  }

  async function enviar() {
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/postos/${postoId}/fechamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data,
          posto_nome: postoNome,
          contas: [...marcadas],
          cheques: [...chequesUsados],
          dinheiro_valor: dinheiro,
          dinheiro_forma: dinheiroForma,
          dinheiro_conta_id: dinheiro > 0 ? dinheiroConta : null,
          troco_valor: diferenca > 0 ? diferenca : 0,
          troco_conta_id: diferenca > 0 ? trocoConta : null,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não deu pra fechar");
        setConfirmando(false);
        return;
      }
      setAberto(false);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="bg-verde text-white font-semibold rounded-xl px-5 py-3 hover:bg-verde-escuro"
      >
        🤝 Fechar conta com o posto
      </button>
    );
  }

  return (
    <div className="card border-2 border-verde space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Acerto com {postoNome}</h2>
        <button
          onClick={() => setAberto(false)}
          className="text-sm text-cinza-suave hover:text-cinza-texto"
        >
          cancelar
        </button>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">
          Quais notas entram no acerto
        </p>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {notas.map((n) => (
            <label
              key={n.conta_id}
              className="flex items-center gap-2 text-sm py-1 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={marcadas.has(n.conta_id)}
                onChange={() => alternar(marcadas, n.conta_id, setMarcadas)}
              />
              <span className="flex-1">
                {formatData(n.quando)} · {n.quem}
              </span>
              <span className="font-mono">{formatBRL(n.valor)}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Data do acerto</label>
        <input
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
          className="px-3 py-2 border border-cinza-borda rounded-xl"
        />
      </div>

      {cheques.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">
            Cheques entregues ao posto (saem da carteira)
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {cheques.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 text-sm py-1 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={chequesUsados.has(c.id)}
                  onChange={() =>
                    alternar(chequesUsados, c.id, setChequesUsados)
                  }
                />
                <span className="flex-1">
                  banco {c.banco ?? "—"} nº {c.numero ?? "—"}
                  {c.bom_para ? ` · bom para ${formatData(c.bom_para)}` : ""}
                </span>
                <span className="font-mono">{formatBRL(c.valor)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">
            Em dinheiro/pix
          </label>
          <InputDinheiro
            centavos={dinheiroCentavos}
            onChange={(v) => {
              setDinheiroCentavos(v);
              setConfirmando(false);
            }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Forma</label>
          <select
            value={dinheiroForma}
            onChange={(e) => setDinheiroForma(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="dinheiro">Dinheiro</option>
            <option value="pix">PIX</option>
            <option value="deposito">Depósito</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            De qual conta saiu
          </label>
          <select
            value={dinheiroConta}
            onChange={(e) => setDinheiroConta(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">—</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* A conta na cara dele, atualizando a cada clique. */}
      <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 text-sm space-y-1">
        <Linha rotulo="Notas selecionadas" valor={formatBRL(totalDevido)} />
        <Linha rotulo="Cheques" valor={formatBRL(totalCheques)} />
        <Linha rotulo="Dinheiro" valor={formatBRL(dinheiro)} />
        <div className="border-t border-cinza-borda pt-1">
          <Linha rotulo="Total pago" valor={formatBRL(totalPago)} forte />
        </div>
        {diferenca < 0 && (
          <p className="text-alerta font-medium">
            Faltam {formatBRL(Math.abs(diferenca))} pra cobrir essas notas.
          </p>
        )}
      </div>

      {diferenca > 0 && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3 space-y-2">
          <p className="text-sm font-bold">
            O posto devolve {formatBRL(diferenca)} de troco
          </p>
          <p className="text-xs">
            Você está pagando mais do que as notas somam. Diga em qual conta
            esse dinheiro entrou — sem isso ele sumiria do caixa e o resultado
            ficaria inflado.
          </p>
          <select
            value={trocoConta}
            onChange={(e) => setTrocoConta(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">— escolha a conta —</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      <button
        onClick={() => (confirmando ? enviar() : setConfirmando(true))}
        disabled={
          salvando ||
          marcadas.size === 0 ||
          diferenca < 0 ||
          (dinheiro > 0 && !dinheiroConta) ||
          (diferenca > 0 && !trocoConta)
        }
        className={`w-full font-semibold rounded-xl px-5 py-3 text-white disabled:bg-cinza-borda disabled:text-cinza-suave ${
          confirmando ? "bg-amber-500 hover:bg-amber-600" : "bg-verde hover:bg-verde-escuro"
        }`}
      >
        {salvando
          ? "Fechando..."
          : confirmando
            ? `CONFIRMAR: quitar ${marcadas.size} ${
                marcadas.size === 1 ? "nota" : "notas"
              } de ${formatBRL(totalDevido)}${
                diferenca > 0 ? ` e receber ${formatBRL(diferenca)} de troco` : ""
              }`
            : "Fechar o acerto"}
      </button>
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
}) {
  return (
    <div className={`flex justify-between ${forte ? "font-bold" : ""}`}>
      <span>{rotulo}</span>
      <span className="font-mono">{valor}</span>
    </div>
  );
}
