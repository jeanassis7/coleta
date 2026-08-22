"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import { InputDinheiro, centavosParaReais, reaisParaCentavos } from "@/components/InputDinheiro";
import { ModalConfirmar } from "@/components/admin/Modais";
import type { SaldoDivida } from "@/lib/admin/caixa";

/**
 * O que a empresa DEVE, cadastrado.
 *
 * Dois formatos porque a vida tem dois: PARCELADA (acordo fechado, 8×12k) e
 * ABERTA (valor devido sem cronograma — o texto guarda a situação).
 *
 * O saldo NÃO se digita: sai de `total − pagamentos vinculados`. Quem abate
 * é o lançamento em "Pagamento de dívidas", que pergunta qual dívida.
 */
export function DividasPainel({ dividas }: { dividas: SaldoDivida[] }) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<SaldoDivida | null>(null);
  const [quitando, setQuitando] = useState<SaldoDivida | null>(null);
  const [apagando, setApagando] = useState<SaldoDivida | null>(null);

  // formulário
  const [credor, setCredor] = useState("");
  const [tipo, setTipo] = useState<"parcelada" | "aberta">("parcelada");
  const [totalCent, setTotalCent] = useState<number | null>(null);
  const [parcelas, setParcelas] = useState("");
  const [parcelaCent, setParcelaCent] = useState<number | null>(null);
  const [primeiraEm, setPrimeiraEm] = useState("");
  const [obs, setObs] = useState("");

  const abertas = dividas.filter((d) => d.status === "aberta");
  const quitadas = dividas.filter((d) => d.status === "quitada");
  const totalDevido = abertas.reduce((s, d) => s + Math.max(0, d.saldo), 0);

  function limpar() {
    setCredor("");
    setTipo("parcelada");
    setTotalCent(null);
    setParcelas("");
    setParcelaCent(null);
    setPrimeiraEm("");
    setObs("");
    setErro(null);
  }

  async function chamar(url: string, body: unknown, metodo = "POST") {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(json.error || "não deu certo");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setSalvando(false);
    }
  }

  async function criar(confirmado = false) {
    if (!credor.trim()) return setErro("Diga a quem a empresa deve.");
    if (!totalCent) return setErro("Diga quanto é a dívida.");
    const ok = await chamar("/api/admin/dividas", {
      credor,
      tipo,
      valor_total: centavosParaReais(totalCent),
      parcelas_total: tipo === "parcelada" ? Number(parcelas) : null,
      valor_parcela: tipo === "parcelada" && parcelaCent ? centavosParaReais(parcelaCent) : null,
      primeira_em: primeiraEm || null,
      observacao: obs,
      confirmado,
    });
    if (ok) {
      limpar();
      setNovo(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ topo */}
      <div className="card">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Total devido hoje</h2>
            <p className="text-sm text-cinza-suave">
              {abertas.length} dívida{abertas.length === 1 ? "" : "s"} em aberto
            </p>
          </div>
          <span className="text-3xl font-bold text-alerta font-mono">
            {formatBRL(totalDevido)}
          </span>
        </div>
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-3 text-sm">
          {erro}
        </div>
      )}

      {/* ------------------------------------------------------ nova */}
      {!novo ? (
        <button onClick={() => setNovo(true)} className="btn-primario">
          + Cadastrar dívida
        </button>
      ) : (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">Cadastrar dívida</h2>

          <div>
            <label className="block text-sm font-medium mb-1">A quem a empresa deve</label>
            <input
              type="text"
              value={credor}
              onChange={(e) => setCredor(e.target.value)}
              placeholder="Evaner, Joyce, Engler…"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Como está combinado</label>
            <div className="grid sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo("parcelada")}
                className={`text-left p-3 rounded-xl border-2 ${
                  tipo === "parcelada" ? "border-verde bg-verde/5" : "border-cinza-borda"
                }`}
              >
                <div className="font-medium">Parcelada</div>
                <div className="text-xs text-cinza-suave">
                  Acordo fechado — 8× de R$ 12.000
                </div>
              </button>
              <button
                type="button"
                onClick={() => setTipo("aberta")}
                className={`text-left p-3 rounded-xl border-2 ${
                  tipo === "aberta" ? "border-verde bg-verde/5" : "border-cinza-borda"
                }`}
              >
                <div className="font-medium">Em aberto</div>
                <div className="text-xs text-cinza-suave">
                  Deve, sem cronograma definido ainda
                </div>
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Valor total da dívida</label>
              <InputDinheiro centavos={totalCent} onChange={setTotalCent} grande={false} />
            </div>
            {tipo === "parcelada" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantas parcelas</label>
                  <input
                    type="number"
                    min={1}
                    value={parcelas}
                    onChange={(e) => setParcelas(e.target.value)}
                    className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Valor de cada parcela</label>
                  <InputDinheiro centavos={parcelaCent} onChange={setParcelaCent} grande={false} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Primeira parcela{" "}
                    <span className="text-cinza-suave font-normal">(opcional)</span>
                  </label>
                  <input
                    type="date"
                    value={primeiraEm}
                    onChange={(e) => setPrimeiraEm(e.target.value)}
                    className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Situação{" "}
              <span className="text-cinza-suave font-normal">
                (juro combinado, estado da negociação — em palavras mesmo)
              </span>
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              placeholder="Tem juro combinado de boca, está parado — uma hora vira algo tipo 40×1.000"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={() => criar(false)} disabled={salvando} className="btn-primario">
              {salvando ? "Salvando…" : "Cadastrar"}
            </button>
            {erro?.includes("Confira") && (
              <button
                onClick={() => criar(true)}
                disabled={salvando}
                className="px-4 py-2 rounded-xl border-2 border-amber-400 bg-amber-50 text-sm font-medium"
              >
                Está certo, cadastrar assim
              </button>
            )}
            <button
              onClick={() => {
                limpar();
                setNovo(false);
              }}
              className="px-4 py-2 rounded-xl border border-cinza-borda text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ lista */}
      {abertas.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Em aberto</h2>
          <div className="space-y-3">
            {abertas.map((d) => (
              <LinhaDivida
                key={d.id}
                d={d}
                onEditar={() => setEditando(d)}
                onQuitar={() => setQuitando(d)}
                onApagar={() => setApagando(d)}
              />
            ))}
          </div>
        </div>
      )}

      {quitadas.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">Quitadas</h2>
          <p className="text-sm text-cinza-suave mb-3">
            Fora do total devido. O histórico continua aqui.
          </p>
          <div className="space-y-2">
            {quitadas.map((d) => (
              <div
                key={d.id}
                className="flex items-baseline justify-between gap-3 text-sm border-b border-cinza-borda pb-2"
              >
                <span>
                  {d.credor}{" "}
                  <span className="text-cinza-suave text-xs">
                    {formatBRL(d.valor_total)} · quitada em{" "}
                    {d.quitada_em ? formatData(d.quitada_em) : "—"}
                  </span>
                </span>
                <button
                  onClick={() =>
                    chamar(`/api/admin/dividas/${d.id}`, { status: "aberta" }, "PATCH")
                  }
                  className="text-verde hover:underline"
                >
                  Reabrir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ modais */}
      {editando && (
        <ModalEditar
          d={editando}
          salvando={salvando}
          onSalvar={async (body) => {
            const ok = await chamar(`/api/admin/dividas/${editando.id}`, body, "PATCH");
            if (ok) setEditando(null);
          }}
          onFechar={() => setEditando(null)}
        />
      )}

      {quitando && (
        <ModalConfirmar
          titulo={`Quitar dívida — ${quitando.credor}`}
          descricao={
            quitando.saldo > 0.009
              ? `Ainda faltam ${formatBRL(
                  quitando.saldo
                )} pelos pagamentos lançados. Quitando mesmo assim, ela sai do total devido e o que falta deixa de ser cobrado pelo sistema — use quando o acordo foi perdoado ou fechado por fora.`
              : "Os pagamentos lançados já cobrem a dívida inteira. Ela sai do total devido e fica no histórico."
          }
          confirmarLabel="Quitar"
          carregando={salvando}
          onConfirmar={async () => {
            const ok = await chamar(
              `/api/admin/dividas/${quitando.id}`,
              { status: "quitada" },
              "PATCH"
            );
            if (ok) setQuitando(null);
          }}
          onFechar={() => setQuitando(null)}
        />
      )}

      {apagando && (
        <ModalConfirmar
          titulo={`Apagar ${apagando.credor}`}
          descricao="Só dá pra apagar dívida que nunca recebeu pagamento — use pra desfazer cadastro errado. Se ela existiu de verdade e acabou, o caminho é quitar."
          confirmarLabel="Apagar"
          perigo
          carregando={salvando}
          onConfirmar={async () => {
            const ok = await chamar(`/api/admin/dividas/${apagando.id}`, null, "DELETE");
            if (ok) setApagando(null);
          }}
          onFechar={() => setApagando(null)}
        />
      )}
    </div>
  );
}

function LinhaDivida({
  d,
  onEditar,
  onQuitar,
  onApagar,
}: {
  d: SaldoDivida;
  onEditar: () => void;
  onQuitar: () => void;
  onApagar: () => void;
}) {
  const pct = d.valor_total > 0 ? Math.min(100, (d.pago / d.valor_total) * 100) : 0;
  const zerada = d.saldo <= 0.009;
  // Pago a MAIS que a dívida: aparece, nunca vira R$ 0,00 disfarçado.
  const excedente = d.saldo < -0.009 ? -d.saldo : 0;

  return (
    <div className="border border-cinza-borda rounded-xl p-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <span className="font-medium">{d.credor}</span>{" "}
          <span className="text-xs text-cinza-suave">
            {d.tipo === "parcelada"
              ? `${d.parcelas_total}× ${formatBRL(d.valor_parcela ?? 0)}`
              : "em aberto, sem cronograma"}
          </span>
        </div>
        <div className="text-right">
          <div className="font-mono font-semibold">{formatBRL(Math.max(0, d.saldo))}</div>
          <div className="text-xs text-cinza-suave">
            de {formatBRL(d.valor_total)}
            {d.tipo === "parcelada" && d.parcelas_pagas != null && (
              <>
                {" "}
                · {Math.min(d.parcelas_pagas, d.parcelas_total ?? 0)} de{" "}
                {d.parcelas_total} parcelas
              </>
            )}
          </div>
        </div>
      </div>

      {d.pago > 0 && (
        <div className="mt-2 h-1.5 bg-cinza-borda rounded-full overflow-hidden">
          <div className="h-full bg-verde" style={{ width: `${pct}%` }} />
        </div>
      )}

      {d.observacao && (
        <p className="mt-2 text-sm text-cinza-suave">{d.observacao}</p>
      )}

      {excedente > 0 ? (
        <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-300 rounded-lg p-2">
          <strong>Pago {formatBRL(excedente)} a mais</strong> do que o valor
          cadastrado. Se entrou juro ou o acordo mudou, atualize o valor total
          em <em>Editar</em> — aí a conta volta a fechar.
        </p>
      ) : (
        zerada && (
          <p className="mt-2 text-sm text-verde">
            Os pagamentos já cobrem tudo — dá pra quitar.
          </p>
        )
      )}

      <div className="mt-2 flex gap-3 text-sm">
        <button onClick={onEditar} className="text-verde hover:underline">
          Editar
        </button>
        <button onClick={onQuitar} className="text-verde hover:underline">
          Quitar
        </button>
        {d.pago === 0 && (
          <button onClick={onApagar} className="text-alerta hover:underline">
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}

function ModalEditar({
  d,
  salvando,
  onSalvar,
  onFechar,
}: {
  d: SaldoDivida;
  salvando: boolean;
  onSalvar: (body: Record<string, unknown>) => void;
  onFechar: () => void;
}) {
  const [credor, setCredor] = useState(d.credor);
  const [totalCent, setTotalCent] = useState<number | null>(reaisParaCentavos(d.valor_total));
  const [parcelas, setParcelas] = useState(d.parcelas_total ? String(d.parcelas_total) : "");
  const [parcelaCent, setParcelaCent] = useState<number | null>(
    d.valor_parcela != null ? reaisParaCentavos(d.valor_parcela) : null
  );
  const [obs, setObs] = useState(d.observacao ?? "");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-xl font-bold">Editar dívida</h2>
        <p className="text-sm text-cinza-suave">
          Mudou a negociação (entrou juro, refizeram o acordo)? Atualize aqui — o
          log guarda o antes e o depois.
        </p>

        <div>
          <label className="block text-sm font-medium mb-1">A quem deve</label>
          <input
            type="text"
            value={credor}
            onChange={(e) => setCredor(e.target.value)}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Valor total</label>
          <InputDinheiro centavos={totalCent} onChange={setTotalCent} grande={false} />
        </div>
        {d.tipo === "parcelada" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Parcelas</label>
              <input
                type="number"
                min={1}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
                className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valor da parcela</label>
              <InputDinheiro centavos={parcelaCent} onChange={setParcelaCent} grande={false} />
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">Situação</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onFechar} className="px-4 py-2 rounded-xl border border-cinza-borda">
            Cancelar
          </button>
          <button
            disabled={salvando}
            onClick={() =>
              onSalvar({
                credor,
                valor_total: totalCent ? centavosParaReais(totalCent) : undefined,
                parcelas_total: d.tipo === "parcelada" ? Number(parcelas) || null : undefined,
                valor_parcela:
                  d.tipo === "parcelada" && parcelaCent
                    ? centavosParaReais(parcelaCent)
                    : undefined,
                observacao: obs,
              })
            }
            className="btn-primario"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
