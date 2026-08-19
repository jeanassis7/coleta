"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBRL, formatData } from "@/lib/format";
import { ModalConfirmar, ModalInputTexto } from "@/components/admin/Modais";
import { SelectConta, type ContaOpcao } from "@/components/admin/SelectConta";
import type { Cheque, StatusCheque } from "@/lib/admin/queries";

const ROTULO: Record<StatusCheque, string> = {
  em_carteira: "Na carteira",
  depositado: "Depositado",
  compensado: "Compensado",
  devolvido: "Devolvido",
  repassado: "Repassado",
};

const COR: Record<StatusCheque, string> = {
  em_carteira: "bg-slate-100 text-slate-700 border-slate-300",
  depositado: "bg-blue-50 text-blue-700 border-blue-300",
  compensado: "bg-green-50 text-green-700 border-green-300",
  devolvido: "bg-red-50 text-red-700 border-red-300",
  repassado: "bg-amber-50 text-amber-800 border-amber-300",
};

function hojeBr(): Date {
  const s = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00`);
}

function diasAte(bomPara: string): number {
  const alvo = new Date(`${bomPara}T00:00:00`);
  return Math.round((alvo.getTime() - hojeBr().getTime()) / 86400000);
}

export function ChequesPainel({
  cheques,
  contas,
}: {
  cheques: Cheque[];
  contas: ContaOpcao[];
}) {
  const [filtro, setFiltro] = useState<"ativos" | "todos">("ativos");

  // "Ativo" = ainda mexe com dinheiro. Compensado e repassado já acabaram
  // a vida deles; devolvido continua ativo porque virou problema a resolver.
  const visiveis = useMemo(
    () =>
      filtro === "todos"
        ? cheques
        : cheques.filter((c) =>
            ["em_carteira", "depositado", "devolvido"].includes(c.status)
          ),
    [cheques, filtro]
  );

  const carteira = cheques.filter((c) => c.status === "em_carteira");
  const totalCarteira = carteira.reduce((s, c) => s + c.valor, 0);
  const vencendo = carteira.filter((c) => diasAte(c.bom_para) <= 7);
  const totalVencendo = vencendo.reduce((s, c) => s + c.valor, 0);
  const devolvidos = cheques.filter((c) => c.status === "devolvido");

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="card">
          <div className="text-xs text-cinza-suave">Na carteira</div>
          <div className="text-2xl font-bold font-mono">{formatBRL(totalCarteira)}</div>
          <div className="text-xs text-cinza-suave mt-1">
            {carteira.length} {carteira.length === 1 ? "cheque" : "cheques"} em mãos
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-cinza-suave">Pra depositar essa semana</div>
          <div
            className={`text-2xl font-bold font-mono ${
              totalVencendo > 0 ? "text-alerta" : ""
            }`}
          >
            {formatBRL(totalVencendo)}
          </div>
          <div className="text-xs text-cinza-suave mt-1">
            {vencendo.length} {vencendo.length === 1 ? "cheque" : "cheques"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-cinza-suave">Devolvidos sem resolver</div>
          <div
            className={`text-2xl font-bold font-mono ${
              devolvidos.length > 0 ? "text-alerta" : ""
            }`}
          >
            {formatBRL(devolvidos.reduce((s, c) => s + c.valor, 0))}
          </div>
          <div className="text-xs text-cinza-suave mt-1">
            a dívida do comprador voltou sozinha
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(
          [
            ["ativos", "Ativos"],
            ["todos", "Todos"],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            onClick={() => setFiltro(v)}
            className={`px-4 py-2 rounded-xl border-2 text-sm ${
              filtro === v
                ? "bg-verde text-white border-verde"
                : "bg-white border-cinza-borda"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <Tabela cheques={visiveis} contas={contas} />
    </>
  );
}

function Tabela({ cheques, contas }: { cheques: Cheque[]; contas: ContaOpcao[] }) {
  const router = useRouter();
  const [acao, setAcao] = useState<{ cheque: Cheque; tipo: string } | null>(null);
  const [repassando, setRepassando] = useState<Cheque | null>(null);
  // Compensar tem modal próprio: é o único momento em que o cheque vira
  // dinheiro numa conta, e precisa dizer em QUAL.
  const [compensando, setCompensando] = useState<Cheque | null>(null);
  const [contaCompensou, setContaCompensou] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(
    cheque: Cheque,
    tipo: string,
    repassadoPara?: string,
    contaId?: string
  ) {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/admin/cheques/${cheque.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: tipo,
          repassado_para: repassadoPara,
          conta_id: contaId,
        }),
      });
      const resposta = await res.json();
      if (!res.ok) {
        setErro(resposta.error || "erro");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
      setAcao(null);
      setRepassando(null);
      setCompensando(null);
    }
  }

  if (cheques.length === 0) {
    return (
      <div className="card">
        <p className="text-cinza-suave text-center py-6">
          Nenhum cheque aqui. Eles entram sozinhos quando você lança uma venda
          recebida em cheque.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      {erro && (
        <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm mb-3">
          {erro}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Bom para</th>
            <th className="py-2 pr-3">Banco</th>
            <th className="py-2 pr-3">Emitente</th>
            <th className="py-2 pr-3">Nº</th>
            <th className="py-2 pr-3">De quem veio</th>
            <th className="py-2 pr-3 text-right">Valor</th>
            <th className="py-2 pr-3">Situação</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {cheques.map((c) => {
            const dias = diasAte(c.bom_para);
            const urgente = c.status === "em_carteira" && dias <= 7;
            return (
              <tr key={c.id} className="border-b border-cinza-borda hover:bg-slate-50">
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={urgente ? "font-semibold text-alerta" : ""}>
                    {formatData(c.bom_para)}
                  </span>
                  {c.status === "em_carteira" && (
                    <div className="text-xs text-cinza-suave">
                      {dias < 0
                        ? `venceu há ${-dias} ${-dias === 1 ? "dia" : "dias"}`
                        : dias === 0
                          ? "é hoje"
                          : `em ${dias} ${dias === 1 ? "dia" : "dias"}`}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">{c.banco}</td>
                <td className="py-2 pr-3">{c.emitente}</td>
                <td className="py-2 pr-3 text-cinza-suave">{c.numero || "—"}</td>
                <td className="py-2 pr-3 text-cinza-suave">{c.comprador_nome}</td>
                <td className="py-2 pr-3 text-right font-mono font-semibold">
                  {formatBRL(c.valor)}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-md border ${COR[c.status]}`}
                  >
                    {ROTULO[c.status]}
                  </span>
                  {c.status === "repassado" && c.repassado_para && (
                    <div className="text-xs text-cinza-suave mt-0.5">
                      pra {c.repassado_para}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-2 text-sm">
                    {(c.status === "em_carteira" || c.status === "devolvido") && (
                      <button
                        onClick={() => setAcao({ cheque: c, tipo: "depositar" })}
                        className="text-verde hover:underline"
                      >
                        {c.status === "devolvido" ? "Reapresentar" : "Depositar"}
                      </button>
                    )}
                    {c.status === "em_carteira" && (
                      <button
                        onClick={() => setRepassando(c)}
                        className="text-verde hover:underline"
                      >
                        Repassar
                      </button>
                    )}
                    {c.status === "depositado" && (
                      <button
                        onClick={() => setCompensando(c)}
                        className="text-verde hover:underline"
                      >
                        Compensou
                      </button>
                    )}
                    {["em_carteira", "depositado", "repassado"].includes(c.status) && (
                      <button
                        onClick={() => setAcao({ cheque: c, tipo: "devolver" })}
                        className="text-alerta hover:underline"
                      >
                        Voltou
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {acao && (
        <ModalConfirmar
          titulo={
            acao.tipo === "depositar"
              ? "Depositar esse cheque?"
              : acao.tipo === "compensar"
                ? "O dinheiro caiu na conta?"
                : "Esse cheque voltou?"
          }
          descricao={
            acao.tipo === "depositar"
              ? `${acao.cheque.banco} · ${formatBRL(acao.cheque.valor)}. Marcar como depositado não é o mesmo que compensado — o dinheiro só entra no caixa quando você confirmar que caiu.`
              : acao.tipo === "compensar"
                ? `${acao.cheque.banco} · ${formatBRL(acao.cheque.valor)}. A partir daqui esse dinheiro é caixa de verdade.`
                : `${acao.cheque.banco} · ${formatBRL(acao.cheque.valor)} de ${acao.cheque.emitente}. A dívida de ${acao.cheque.comprador_nome} volta automaticamente${acao.cheque.status === "repassado" ? `, e o trâmite é direto entre o emitente e ${acao.cheque.repassado_para}` : ""}.`
          }
          confirmarLabel={
            acao.tipo === "depositar"
              ? "Depositar"
              : acao.tipo === "compensar"
                ? "Confirmar"
                : "Marcar como devolvido"
          }
          perigo={acao.tipo === "devolver"}
          carregando={loading}
          onConfirmar={() => executar(acao.cheque, acao.tipo)}
          onFechar={() => setAcao(null)}
        />
      )}

      {compensando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <div>
              <h2 className="text-lg font-bold">O dinheiro caiu na conta?</h2>
              <p className="text-sm text-cinza-suave mt-1">
                {compensando.banco} · {formatBRL(compensando.valor)}. A partir
                daqui esse dinheiro é caixa de verdade — por isso preciso saber
                em qual conta ele entrou.
              </p>
            </div>

            <SelectConta
              contas={contas}
              valor={contaCompensou}
              onChange={setContaCompensou}
              label="Caiu em qual conta"
            />

            {erro && (
              <div className="bg-alerta/10 border border-alerta text-alerta rounded-xl p-2 text-sm">
                {erro}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCompensando(null)}
                className="px-4 py-2 text-cinza-suave hover:underline"
              >
                Cancelar
              </button>
              <button
                onClick={() =>
                  executar(compensando, "compensar", undefined, contaCompensou)
                }
                disabled={loading || !contaCompensou}
                className="btn-primario disabled:opacity-40"
              >
                {loading ? "Salvando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {repassando && (
        <ModalInputTexto
          titulo="Repassar o cheque"
          descricao={`${repassando.banco} · ${formatBRL(repassando.valor)}. Ele sai da carteira e fica registrado pra onde foi. Se voltar depois, você vê os dois lados aqui.`}
          placeholder="Pra quem foi (oficina, posto, fornecedor)"
          confirmarLabel="Repassar"
          carregando={loading}
          validar={(v) => (v.trim().length < 2 ? "Diga pra quem o cheque foi" : null)}
          onConfirmar={(v) => executar(repassando, "repassar", v.trim())}
          onFechar={() => setRepassando(null)}
        />
      )}
    </div>
  );
}
