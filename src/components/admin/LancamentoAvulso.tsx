"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL } from "@/lib/format";
import { InputDinheiro, centavosParaReais } from "@/components/InputDinheiro";

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface VeiculoOpcao {
  id: string;
  placa: string;
  marca: string;
  tipo: string;
}

/**
 * Lançamento de gasto FEITO PELO PAINEL, preso ao veículo em vez da carga.
 *
 * Serve o Jean entregando óleo com caminhão próprio e o carro do Valdecir —
 * custo de operação legítimo que hoje não teria onde entrar, porque
 * abastecimento e despesa nasceram exigindo carga e motorista.
 *
 * Como não tem motorista, não desconta do saldo de ninguém. E marcando
 * "assinou a nota", a conta a pagar do posto nasce junto.
 */
export function LancamentoAvulso({
  veiculos,
  tipoInicial = "abastecimento",
  vendaId = null,
  caminhaoFixo = null,
  titulo,
  onFechar,
}: {
  veiculos: VeiculoOpcao[];
  tipoInicial?: "abastecimento" | "despesa";
  vendaId?: string | null;
  caminhaoFixo?: string | null;
  titulo?: string;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"abastecimento" | "despesa">(tipoInicial);
  const [caminhaoId, setCaminhaoId] = useState(
    caminhaoFixo || veiculos[0]?.id || ""
  );
  const [data, setData] = useState(hojeBr());
  const [valorCentavos, setValorCentavos] = useState<number | null>(null);
  const [descricao, setDescricao] = useState("");
  const [posto, setPosto] = useState("");
  const [litros, setLitros] = useState("");
  const [tipoAbast, setTipoAbast] = useState<"diesel" | "arla">("diesel");
  const [km, setKm] = useState("");
  const [pagoNaHora, setPagoNaHora] = useState(true);
  const [vencimento, setVencimento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (!caminhaoId) return setErro("Escolha o veículo");
    if (!valorCentavos || valorCentavos <= 0) return setErro("Informe o valor");
    if (tipo === "despesa" && descricao.trim().length < 2) {
      return setErro("Descreva a despesa");
    }
    if (tipo === "abastecimento") {
      if (posto.trim().length < 2) return setErro("Diga o nome do posto");
      if (!Number(litros.replace(",", "."))) return setErro("Informe os litros");
      if (!Number(km)) return setErro("Informe o km do veículo");
    }

    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          caminhao_id: caminhaoId,
          venda_id: vendaId,
          criado_em: data,
          valor: centavosParaReais(valorCentavos),
          ...(tipo === "despesa"
            ? { descricao: descricao.trim() }
            : {
                posto_nome: posto.trim(),
                tipo_abastecimento: tipoAbast,
                litros: Number(litros.replace(",", ".")),
                km_atual: Number(km),
                pago_na_hora: pagoNaHora,
                vencimento: vencimento || null,
              }),
        }),
      });
      const r = await res.json();
      if (!res.ok) {
        setErro(r.error || "erro");
        return;
      }
      if (r.aviso) {
        setErro(r.aviso);
        return;
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
          <h2 className="text-lg font-bold">
            {titulo || "Lançar gasto do veículo"}
          </h2>
          <p className="text-sm text-cinza-suave mt-1">
            Gasto que não veio de carga de motorista — entrega feita pelo
            gestor, carro da empresa. Não desconta do saldo de ninguém.
          </p>
        </div>

        <div className="flex gap-2">
          {(
            [
              ["abastecimento", "Abastecimento"],
              ["despesa", "Despesa"],
            ] as const
          ).map(([v, r]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTipo(v)}
              className={`flex-1 px-4 py-2 rounded-xl border-2 text-sm ${
                tipo === v
                  ? "bg-verde text-white border-verde"
                  : "bg-white border-cinza-borda"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Veículo</label>
            <select
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl disabled:bg-slate-100"
              value={caminhaoId}
              onChange={(e) => setCaminhaoId(e.target.value)}
              disabled={!!caminhaoFixo}
            >
              {veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa} — {v.marca}
                  {v.tipo === "carro" ? " (carro)" : ""}
                </option>
              ))}
            </select>
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

        {tipo === "despesa" ? (
          <div>
            <label className="block text-sm font-medium mb-1">O que foi</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Pedágio, almoço, lavagem..."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Posto</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                value={posto}
                onChange={(e) => setPosto(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">O que abasteceu</label>
              <div className="flex rounded-xl overflow-hidden border border-cinza-borda">
                {(["diesel", "arla"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoAbast(t)}
                    className={`flex-1 px-3 py-2 text-sm ${
                      tipoAbast === t ? "bg-verde text-white" : "bg-white"
                    }`}
                  >
                    {t === "diesel" ? "Diesel" : "ARLA"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Litros</label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-right font-mono"
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Km do veículo
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-right font-mono"
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Valor</label>
          <InputDinheiro
            centavos={valorCentavos}
            onChange={setValorCentavos}
            grande={false}
          />
        </div>

        {tipo === "abastecimento" && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 space-y-2">
            <p className="text-sm font-medium">Como pagou?</p>
            <div className="flex gap-2">
              {(
                [
                  [true, "Pagou agora"],
                  [false, "Assinou a nota"],
                ] as const
              ).map(([v, r]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setPagoNaHora(v)}
                  className={`flex-1 px-4 py-2 rounded-xl border-2 text-sm ${
                    pagoNaHora === v
                      ? "bg-verde text-white border-verde"
                      : "bg-white border-cinza-borda"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {!pagoNaHora && (
              <div>
                <label className="block text-xs text-cinza-suave mb-1">
                  Quando vence a fatura do posto (opcional)
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
                <p className="text-xs text-cinza-suave mt-1">
                  A conta a pagar do posto nasce junto —{" "}
                  {valorCentavos
                    ? formatBRL(centavosParaReais(valorCentavos))
                    : "o valor"}{" "}
                  vai aparecer em Contas a pagar.
                </p>
              </div>
            )}
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
            onClick={salvar}
            disabled={salvando}
            className="px-6 py-2 rounded-xl bg-verde text-white font-medium disabled:opacity-50"
          >
            {salvando ? "Salvando..." : "Lançar"}
          </button>
        </div>
      </div>
    </div>
  );
}
