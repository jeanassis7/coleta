"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";

/**
 * Lançar e corrigir as notas assinadas de UM posto.
 *
 * Nasce de como a coisa funciona de verdade: o Jean e o Valdecir não lançam
 * nada na hora de abastecer. Uma vez por mês o posto entrega o extrato com as
 * notas do período, e é aí que tudo entra no software — dez, vinte notas de
 * uma sentada.
 *
 * Por isso o formulário NÃO fecha ao salvar: ele guarda posto, veículo, quem
 * assinou e a data, e limpa só litros e valor. Digitar vinte notas fechando e
 * reabrindo a tela vinte vezes é o tipo de atrito que faz o gestor voltar pro
 * caderno.
 *
 * Quem manda nas regras continua sendo `/api/admin/lancamentos` — esta tela é
 * só um formulário. Nota assinada é fixa aqui: se foi pago na hora, não é
 * dívida do posto e não pertence a esta tela.
 */
export function NotasDoPosto({
  postoId,
  postoNome,
  veiculos,
  pessoas,
}: {
  postoId: string;
  postoNome: string;
  veiculos: { id: string; placa: string; marca: string; tipo: string }[];
  pessoas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [veiculoId, setVeiculoId] = useState(veiculos[0]?.id ?? "");
  const [quemId, setQuemId] = useState("");
  const [particular, setParticular] = useState(false);
  const [tipoAbast, setTipoAbast] = useState<"diesel" | "arla">("diesel");
  const [litros, setLitros] = useState("");
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [km, setKm] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lancadas, setLancadas] = useState(0);

  async function salvar() {
    setErro(null);
    if (!veiculoId) return setErro("Escolha o veículo");
    if (!quemId) return setErro("Diga quem assinou a nota");
    const litrosNum = Number(litros.replace(",", "."));
    if (!litrosNum || litrosNum <= 0) return setErro("Informe os litros");
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");

    setSalvando(true);
    try {
      const res = await fetch("/api/admin/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "abastecimento",
          caminhao_id: veiculoId,
          criado_em: data,
          valor: centavosParaReais(valorCentavos),
          // Nota do posto é sempre nota assinada: é ela que vira a dívida.
          pago_na_hora: false,
          conta_id: null,
          posto_nome: postoNome,
          local_id: postoId,
          // Particular = transferência a sócio no DRE; da operação = quem
          // assinou fica registrado e o custo é de combustível.
          socio_id: particular ? quemId : null,
          motorista_id: particular ? null : quemId,
          tipo_abastecimento: tipoAbast,
          litros: litrosNum,
          km_atual: km ? Number(km) : null,
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não deu pra lançar");
        return;
      }
      if (r.aviso) setErro(r.aviso);
      // Fica aberto pro próximo: só o que muda de nota pra nota é limpo.
      setLitros("");
      setValorCentavos(null);
      setKm("");
      setLancadas((n) => n + 1);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="bg-white border-2 border-verde text-verde font-semibold rounded-xl px-5 py-3 hover:bg-verde hover:text-white transition-colors"
      >
        ➕ Lançar notas do extrato
      </button>
    );
  }

  return (
    <div className="card border-2 border-verde space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Notas assinadas em {postoNome}
        </h2>
        <button
          onClick={() => setAberto(false)}
          className="text-sm text-cinza-suave hover:text-cinza-texto"
        >
          fechar
        </button>
      </div>

      <p className="text-sm text-cinza-suave">
        Uma linha do extrato por vez. O formulário fica aberto e guarda data,
        veículo e quem assinou — pro resto do extrato você digita só litros e
        valor.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Data da nota</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Veículo</label>
          <select
            value={veiculoId}
            onChange={(e) => setVeiculoId(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            {veiculos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.placa} {v.marca}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">Quem assinou</label>
          <select
            value={quemId}
            onChange={(e) => setQuemId(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="">—</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer bg-slate-50 border border-cinza-borda rounded-xl p-3">
        <input
          type="checkbox"
          checked={particular}
          onChange={(e) => setParticular(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <strong>Foi particular</strong> — carro próprio, não é da operação.
          <span className="block text-xs text-cinza-suave">
            Marcando isso, o gasto sai do custo de combustível e vira
            transferência a sócio no DRE, no nome de quem assinou.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">O que abasteceu</label>
          <select
            value={tipoAbast}
            onChange={(e) => setTipoAbast(e.target.value as "diesel" | "arla")}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          >
            <option value="diesel">Diesel</option>
            <option value="arla">Arla</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Litros</label>
          <input
            inputMode="decimal"
            value={litros}
            onChange={(e) => setLitros(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Km <span className="text-cinza-suave font-normal">(opcional)</span>
          </label>
          <input
            inputMode="numeric"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder="o extrato não traz"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={salvando}
          className="bg-verde text-white font-semibold rounded-xl px-5 py-3 hover:bg-verde-escuro disabled:bg-cinza-borda"
        >
          {salvando ? "Lançando..." : "Lançar e continuar"}
        </button>
        {lancadas > 0 && (
          <span className="text-sm text-verde font-medium">
            {lancadas} {lancadas === 1 ? "nota lançada" : "notas lançadas"} agora
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Correção de uma nota já lançada — o extrato foi digitado errado.
 *
 * Bate no PATCH que já existe (`/api/admin/abastecimentos/[id]`), que além de
 * corrigir a nota **acerta a conta a pagar amarrada**: sem isso a dívida com o
 * posto continuaria com o valor velho e o acerto não fecharia.
 */
export function CorrigirNota({
  id,
  litros,
  valor,
  onFim,
}: {
  id: string;
  litros: number;
  valor: number;
  onFim: () => void;
}) {
  const router = useRouter();
  const [l, setL] = useState(String(litros).replace(".", ","));
  const [v, setV] = useState<number | null>(Math.round(valor * 100));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setErro(null);
    const litrosNum = Number(l.replace(",", "."));
    if (!litrosNum || litrosNum <= 0) return setErro("litros inválidos");
    if (!v || v <= 0) return setErro("valor inválido");
    setSalvando(true);
    try {
      const res = await fetch(`/api/admin/abastecimentos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          litros: litrosNum,
          valor: centavosParaReais(v),
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "não deu");
        return;
      }
      router.refresh();
      onFim();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 bg-slate-50 border border-cinza-borda rounded-xl p-3">
      <div>
        <label className="block text-xs text-cinza-suave mb-1">Litros</label>
        <input
          inputMode="decimal"
          value={l}
          onChange={(e) => setL(e.target.value)}
          className="w-24 px-2 py-1 border border-cinza-borda rounded-lg text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-cinza-suave mb-1">Valor</label>
        <InputDinheiro centavos={v} onChange={setV} />
      </div>
      <button
        onClick={salvar}
        disabled={salvando}
        className="px-4 py-2 rounded-xl bg-verde text-white text-sm font-semibold disabled:bg-cinza-borda"
      >
        {salvando ? "Salvando..." : "Salvar"}
      </button>
      <button
        onClick={onFim}
        className="px-3 py-2 text-sm text-cinza-suave hover:text-cinza-texto"
      >
        cancelar
      </button>
      {erro && (
        <span className="text-sm text-alerta w-full">{erro}</span>
      )}
    </div>
  );
}

/**
 * As notas EM ABERTO, com correção inline.
 *
 * Só as abertas ganham o botão de corrigir: mexer no valor de uma nota já
 * paga não mudaria o pagamento que saiu do caixa — ficaria a nota dizendo uma
 * coisa e o dinheiro outra. Nota paga errada se conserta desfazendo o
 * pagamento, não reescrevendo a nota.
 */
export function TabelaNotasEditavel({
  notas,
}: {
  notas: {
    abastecimento_id: string;
    quando: string;
    quem: string;
    veiculo: string;
    litros: number;
    valor: number;
    do_socio: boolean;
  }[];
}) {
  const [editando, setEditando] = useState<string | null>(null);

  if (notas.length === 0) {
    return (
      <p className="text-sm text-cinza-suave py-4">Nada em aberto nesse posto.</p>
    );
  }

  return (
    <div className="space-y-2">
      {notas.map((n) => (
        <div
          key={n.abastecimento_id}
          className={`card ${n.do_socio ? "bg-amber-50 border-amber-300" : ""}`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="text-cinza-suave">
                {new Date(n.quando).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
              </span>{" "}
              · <strong>{n.quem}</strong> · {n.veiculo}
              {n.do_socio && (
                <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                  particular
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-cinza-suave font-mono">
                {n.litros.toLocaleString("pt-BR")} L
              </span>
              <span className="font-mono font-semibold">
                {formatBRL(n.valor)}
              </span>
              <button
                onClick={() =>
                  setEditando(editando === n.abastecimento_id ? null : n.abastecimento_id)
                }
                className="text-sm text-cinza-suave hover:text-verde"
              >
                ✎ corrigir
              </button>
            </div>
          </div>
          {editando === n.abastecimento_id && (
            <div className="mt-3">
              <CorrigirNota
                id={n.abastecimento_id}
                litros={n.litros}
                valor={n.valor}
                onFim={() => setEditando(null)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
