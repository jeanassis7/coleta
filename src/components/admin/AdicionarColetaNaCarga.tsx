"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "+ Adicionar coleta" no detalhe da carga.
 *
 * Serve pro caso real: o motorista coletou, esqueceu de lançar e avisou
 * depois (WhatsApp). Funciona mesmo com a carga já encerrada — o óleo
 * entrou naquela carga de qualquer jeito.
 *
 * A tela avisa que o valor desconta do saldo do motorista, porque o
 * dinheiro saiu da mão dele de verdade — diferente da compra direta,
 * onde quem pagou foi a empresa.
 */
export function AdicionarColetaNaCarga({
  cargaId,
  motoristaNome,
  dataSugerida,
}: {
  cargaId: string;
  motoristaNome: string;
  /** aaaa-mm-ddThh:mm pro input datetime-local */
  dataSugerida: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [litros, setLitros] = useState("");
  const [local, setLocal] = useState("");
  const [valor, setValor] = useState("");
  const [quando, setQuando] = useState(dataSugerida);
  const [certTipo, setCertTipo] = useState<"integral" | "parcial" | "nao">("nao");
  const [litrosCert, setLitrosCert] = useState("");
  const [observacao, setObservacao] = useState("");

  async function salvar() {
    const litrosNum = Number(litros.trim().replace(",", "."));
    const valorNum = Number(valor.trim());
    if (!Number.isFinite(litrosNum) || litrosNum <= 0) {
      return setErro("Litros inválido");
    }
    // Zero é válido — óleo doado (R2). O regex já garante inteiro >= 0.
    if (!/^\d+$/.test(valor.trim()) || valorNum < 0) {
      return setErro("Valor da coleta é número inteiro, sem vírgula (ex: 150)");
    }
    if (local.trim().length < 2) return setErro("Diga o nome do local");
    const litrosCertNum = Number(litrosCert.trim().replace(",", "."));
    if (
      certTipo === "parcial" &&
      (!Number.isFinite(litrosCertNum) || litrosCertNum <= 0)
    ) {
      return setErro("Quantos litros foram no certificado parcial?");
    }
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/coletas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carga_id: cargaId,
          litros: litrosNum,
          local_nome: local.trim(),
          valor_pago: valorNum,
          certificado_tipo: certTipo,
          litros_certificado: certTipo === "parcial" ? litrosCertNum : null,
          observacao: observacao.trim() || null,
          criado_em: quando ? new Date(quando).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || "erro");
        return;
      }
      setLitros("");
      setLocal("");
      setValor("");
      setObservacao("");
      setCertTipo("nao");
      setLitrosCert("");
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
        className="px-4 py-2 bg-white border-2 border-verde text-verde rounded-xl font-medium hover:bg-verde hover:text-white transition-colors text-sm"
      >
        + Adicionar coleta
      </button>
    );
  }

  return (
    <div className="card border-2 border-verde space-y-4 w-full">
      <div>
        <h3 className="font-semibold">Adicionar coleta nessa carga</h3>
        <p className="text-sm text-cinza-suave">
          Pro caso do motorista ter coletado e esquecido de lançar no app. O
          valor <strong>desconta do saldo de {motoristaNome}</strong>, porque o
          dinheiro saiu da mão dele. Se quem pagou foi a empresa, o lugar certo é{" "}
          <strong>Compra direta</strong>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Litros</label>
          <input
            type="text"
            inputMode="decimal"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={litros}
            onChange={(e) => setLitros(e.target.value)}
            autoFocus
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">Local</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Valor pago (R$)
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="150"
          />
          <p className="text-xs text-cinza-suave mt-1">Inteiro, sem centavos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Quando foi</label>
          <input
            type="datetime-local"
            className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
          />
          <p className="text-xs text-cinza-suave mt-1">
            Se a data for anterior ao último acerto desse motorista, o valor
            entra no ciclo já fechado e não mexe no saldo de agora.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Certificado</label>
          <div className="flex gap-1">
            {(
              [
                ["nao", "Não"],
                ["integral", "Total"],
                ["parcial", "Parcial"],
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setCertTipo(v)}
                className={`px-3 py-2 rounded-xl border-2 text-sm ${
                  certTipo === v
                    ? "bg-verde text-white border-verde"
                    : "bg-white border-cinza-borda"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {certTipo === "parcial" && (
          <div>
            <label className="block text-sm font-medium mb-1">
              Litros no certificado
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
              value={litrosCert}
              onChange={(e) => setLitrosCert(e.target.value)}
            />
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Observação <span className="text-cinza-suave">(opcional)</span>
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-cinza-borda rounded-xl"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>

      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
          {erro}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setAberto(false)}
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
          {salvando ? "Salvando..." : "Adicionar coleta"}
        </button>
      </div>
    </div>
  );
}
