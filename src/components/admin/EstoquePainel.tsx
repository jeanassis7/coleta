"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import {
  InputDinheiro,
  centavosParaReais,
} from "@/components/InputDinheiro";
import type {
  EstoqueTipo,
  MovimentoEstoque,
  AjusteEstoque,
  TipoOleo,
} from "@/lib/admin/queries";

const ROTULO: Record<TipoOleo, string> = {
  fino: "Óleo fino",
  grosso: "Óleo grosso",
};

const EXPLICACAO: Record<TipoOleo, string> = {
  fino: "Tudo que vem de motorista entra aqui.",
  grosso: "Só entra por compra direta do gestor.",
};

function hojeBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function kg(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
}

function porKg(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

export function EstoquePainel({
  estoque,
  movimentos,
  ajustes,
}: {
  estoque: EstoqueTipo[];
  movimentos: MovimentoEstoque[];
  ajustes: AjusteEstoque[];
}) {
  const [inventariando, setInventariando] = useState<EstoqueTipo | null>(null);

  const valorTotal = estoque.reduce((s, e) => s + e.valor_total, 0);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {estoque.map((e) => (
          <CardTipo
            key={e.tipo_oleo}
            estoque={e}
            onInventariar={() => setInventariando(e)}
          />
        ))}
      </div>

      <div className="card mb-6 flex items-center justify-between">
        <span className="text-cinza-suave">Valor total em óleo</span>
        <span className="text-2xl font-bold font-mono">
          {formatBRL(valorTotal)}
        </span>
      </div>

      {inventariando && (
        <ModalInventario
          estoque={inventariando}
          onFechar={() => setInventariando(null)}
        />
      )}

      <Ajustes ajustes={ajustes} />
      <Extrato movimentos={movimentos} />
    </>
  );
}

function CardTipo({
  estoque: e,
  onInventariar,
}: {
  estoque: EstoqueTipo;
  onInventariar: () => void;
}) {
  // Sem custo médio não há o que preservar — o primeiro ajuste é a abertura
  // e é a única vez que o custo por kg é digitado.
  const precisaAbertura = e.custo_medio_kg <= 0;

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{ROTULO[e.tipo_oleo]}</h2>
        <span className="text-xs text-cinza-suave">
          {EXPLICACAO[e.tipo_oleo]}
        </span>
      </div>

      <div>
        <div
          className={`text-4xl font-bold font-mono ${
            e.saldo_kg < 0 ? "text-alerta" : ""
          }`}
        >
          {kg(e.saldo_kg)}
        </div>
        <div className="text-sm text-cinza-suave">
          ≈ {e.litros_equivalente.toLocaleString("pt-BR")} L
        </div>
      </div>

      {e.saldo_kg < 0 && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          Saiu mais óleo do que o sistema tinha registrado. Conte o tanque e
          faça um inventário.
        </div>
      )}

      {/* O saldo pode ter voltado a positivo com a descarga seguinte e o
          aviso vermelho some — mas a distorção no custo médio FICA. Este
          aviso sobrevive até o inventário fazer o rebase (0054). */}
      {e.saldo_kg >= 0 && !e.custo_confiavel && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-sm">
          <strong>O custo médio abaixo não é confiável.</strong> Em algum
          momento saiu mais óleo do que o sistema tinha, e a conta do custo
          por kg carrega essa distorção mesmo agora que o saldo voltou.
          Um <strong>inventário</strong> (contar o tanque) acerta os dois.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-cinza-borda">
        <div>
          <div className="text-xs text-cinza-suave">
            Custo médio{!e.custo_confiavel && " ⚠️"}
          </div>
          <div
            className={`font-mono font-semibold ${
              !e.custo_confiavel ? "text-amber-700" : ""
            }`}
          >
            {e.custo_medio_kg > 0 ? `${porKg(e.custo_medio_kg)}/kg` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-cinza-suave">Valor em estoque</div>
          <div className="font-mono font-semibold">
            {formatBRL(e.valor_total)}
          </div>
        </div>
      </div>

      <button
        onClick={onInventariar}
        className={`w-full px-4 py-2 rounded-xl font-medium ${
          precisaAbertura
            ? "bg-verde text-white hover:bg-verde/90"
            : "border border-cinza-borda hover:bg-slate-50"
        }`}
      >
        {precisaAbertura ? "Abrir estoque" : "Fazer inventário"}
      </button>
    </div>
  );
}

function ModalInventario({
  estoque: e,
  onFechar,
}: {
  estoque: EstoqueTipo;
  onFechar: () => void;
}) {
  const router = useRouter();
  const ehAbertura = e.custo_medio_kg <= 0;

  // Sempre hoje — ver o comentário no campo Data lá embaixo.
  const data = hojeBr();
  const [contado, setContado] = useState("");
  const [custoCentavos, setCustoCentavos] = useState<number | null>(null);
  const [motivo, setMotivo] = useState(
    ehAbertura ? "Abertura do estoque" : ""
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contadoNum = Number(contado.trim().replace(",", "."));
  const valido = Number.isFinite(contadoNum) && contadoNum >= 0 && contado.trim() !== "";

  const custoPreview = ehAbertura
    ? custoCentavos
      ? centavosParaReais(custoCentavos)
      : 0
    : e.custo_medio_kg;
  const diferenca = valido ? contadoNum - e.saldo_kg : 0;
  const impacto = diferenca * custoPreview;

  async function salvar() {
    if (!valido) return setErro("Diga quantos kg você contou");
    if (ehAbertura && (!custoCentavos || custoCentavos <= 0)) {
      return setErro("Na abertura é preciso informar quanto custa o kg");
    }
    if (motivo.trim().length < 3) return setErro("Escreva o motivo do ajuste");

    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/estoque/ajuste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_oleo: e.tipo_oleo,
          saldo_novo_kg: contadoNum,
          motivo: motivo.trim(),
          data,
          ...(ehAbertura && custoCentavos
            ? { custo_medio_kg: centavosParaReais(custoCentavos) }
            : {}),
        }),
      });
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
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
            {ehAbertura ? "Abrir estoque" : "Inventário"} — {ROTULO[e.tipo_oleo]}
          </h2>
          <p className="text-sm text-cinza-suave mt-1">
            {ehAbertura
              ? "Primeira contagem. Diga quanto tem hoje e quanto custa o kg — é a única vez que o custo é digitado."
              : "Contar o tanque de tempos em tempos é rotina, não conserto de erro. A diferença fica registrada."}
          </p>
        </div>

        {/* O número de partida fica visível ANTES de digitar: a contagem
            acontece a cada 2-3 meses e a diferença esperada é sutil, então
            o que importa é ele comparar com o que o sistema diz. */}
        {!ehAbertura && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 flex items-baseline justify-between">
            <span className="text-cinza-suave">Estoque atual no sistema</span>
            <span className="text-2xl font-bold font-mono">{kg(e.saldo_kg)}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* A data é SEMPRE hoje — o "Dizia / Você contou / Diferença" da
              prévia compara com o saldo DE AGORA; datar no passado fazia a
              perda registrada sair errada (o rebase da view acontecia lá
              atrás, mas a diferença gravada era contra o saldo de hoje).
              Contou no domingo? Lança no domingo — ou lança hoje sabendo
              que a contagem vale pro fim de hoje. */}
          <div>
            <label className="block text-sm font-medium mb-1">Data</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl bg-slate-50 text-cinza-suave"
              value={data}
              disabled
              readOnly
            />
            <p className="text-xs text-cinza-suave mt-1">
              O inventário vale pro fim do dia de hoje — a comparação é com o
              estoque de agora.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Quanto tem de verdade (kg)
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl text-right font-mono"
              value={contado}
              onChange={(ev) => setContado(ev.target.value)}
              autoFocus
            />
          </div>
        </div>

        {ehAbertura && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Quanto custa o kg
            </label>
            <InputDinheiro
              centavos={custoCentavos}
              onChange={setCustoCentavos}
              grande={false}
            />
            <p className="text-xs text-cinza-suave mt-1">
              É o que valoriza o estoque. Daqui pra frente o sistema calcula
              sozinho pelas coletas e compras.
            </p>
          </div>
        )}

        {/* A prévia é o coração da tela: ele vê a consequência ANTES de
            confirmar, em kg e em reais. */}
        {valido && (
          <div className="bg-slate-50 border border-cinza-borda rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-cinza-suave">O sistema dizia</span>
              <span className="font-mono">{kg(e.saldo_kg)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cinza-suave">Você contou</span>
              <span className="font-mono">{kg(contadoNum)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-cinza-borda pt-1 mt-1">
              <span>Diferença</span>
              <span
                className={`font-mono ${
                  diferenca < 0 ? "text-alerta" : diferenca > 0 ? "text-verde" : ""
                }`}
              >
                {diferenca > 0 ? "+" : ""}
                {kg(diferenca)}
              </span>
            </div>
            {custoPreview > 0 && (
              <p className="text-cinza-suave pt-1">
                A {porKg(custoPreview)}/kg isso é uma{" "}
                <strong>
                  {diferenca < 0 ? "perda" : "sobra"} de{" "}
                  {formatBRL(Math.abs(impacto))}
                </strong>
                .
                {!ehAbertura && (
                  <> O custo por kg continua {porKg(e.custo_medio_kg)}.</>
                )}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Motivo</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            placeholder="Contagem do tanque"
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
            {salvando ? "Salvando..." : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Ajustes({ ajustes }: { ajustes: AjusteEstoque[] }) {
  if (ajustes.length === 0) return null;

  return (
    <div className="card mb-6 overflow-x-auto">
      <h2 className="text-lg font-semibold mb-3">Inventários</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Data</th>
            <th className="py-2 pr-3">Tipo</th>
            <th className="py-2 pr-3 text-right">Dizia</th>
            <th className="py-2 pr-3 text-right">Contou</th>
            <th className="py-2 pr-3 text-right">Diferença</th>
            <th className="py-2 pr-3 text-right">R$/kg da época</th>
            <th className="py-2 pr-3 text-right">Impacto</th>
            <th className="py-2 pr-3">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {ajustes.map((a) => (
            <tr key={a.id} className="border-b border-cinza-borda hover:bg-slate-50">
              <td className="py-2 pr-3 whitespace-nowrap">{formatData(a.data)}</td>
              <td className="py-2 pr-3">
                {ROTULO[a.tipo_oleo]}
                {a.motivo_tipo === "abertura" && (
                  <span className="ml-1 text-xs text-cinza-suave">(abertura)</span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {a.saldo_antes_kg.toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {a.saldo_novo_kg.toLocaleString("pt-BR")}
              </td>
              <td
                className={`py-2 pr-3 text-right font-mono ${
                  a.diferenca_kg < 0 ? "text-alerta" : "text-verde"
                }`}
              >
                {a.diferenca_kg > 0 ? "+" : ""}
                {a.diferenca_kg.toLocaleString("pt-BR")}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {porKg(a.custo_medio_kg)}
              </td>
              <td
                className={`py-2 pr-3 text-right font-mono ${
                  a.perda_valor < 0 ? "text-alerta" : "text-verde"
                }`}
              >
                {formatBRL(a.perda_valor)}
              </td>
              <td className="py-2 pr-3 text-cinza-suave">{a.motivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ORIGEM_ROTULO: Record<string, string> = {
  descarga: "Descarga",
  compra_direta: "Compra direta",
  venda: "Venda",
  ajuste: "Inventário",
};

function Extrato({ movimentos }: { movimentos: MovimentoEstoque[] }) {
  if (movimentos.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhum movimento de estoque ainda. As descargas dos motoristas e as
          compras diretas entram aqui sozinhas.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <h2 className="text-lg font-semibold mb-3">Movimentos</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Data</th>
            <th className="py-2 pr-3">Origem</th>
            <th className="py-2 pr-3">De quem / o quê</th>
            <th className="py-2 pr-3">Tipo</th>
            <th className="py-2 pr-3 text-right">Peso</th>
            <th className="py-2 pr-3 text-right">Custo</th>
            <th className="py-2 pr-3 text-right">R$/kg</th>
          </tr>
        </thead>
        <tbody>
          {movimentos.map((m) => (
            <tr
              key={`${m.origem}-${m.referencia_id}`}
              className="border-b border-cinza-borda hover:bg-slate-50"
            >
              <td className="py-2 pr-3 whitespace-nowrap">{formatData(m.dia)}</td>
              <td className="py-2 pr-3">{ORIGEM_ROTULO[m.origem] || m.origem}</td>
              <td className="py-2 pr-3">{m.descricao}</td>
              <td className="py-2 pr-3">{ROTULO[m.tipo_oleo]}</td>
              <td className="py-2 pr-3 text-right font-mono">
                {m.especie === "ajuste" ? (
                  <span className="text-cinza-suave" title="Inventário: redefine o saldo">
                    = {m.kg.toLocaleString("pt-BR")}
                  </span>
                ) : (
                  <span className={m.especie === "saida" ? "text-alerta" : ""}>
                    {m.especie === "saida" ? "−" : "+"}
                    {m.kg.toLocaleString("pt-BR")}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-mono">
                {m.especie === "entrada" ? formatBRL(m.custo) : "—"}
              </td>
              <td className="py-2 pr-3 text-right font-mono text-cinza-suave">
                {m.especie === "entrada" && m.kg > 0
                  ? porKg(m.custo / m.kg)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
