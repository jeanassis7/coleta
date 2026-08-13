import Link from "next/link";
import { formatBRL } from "@/lib/format";
import type { CargaDetalhada } from "@/lib/admin/queries";

/**
 * Operação em tempo real: quem está rodando agora, com quanto de óleo no
 * caminhão e quanto de dinheiro da empresa na mão. Tabela (não cards) —
 * pedido do Evaner: linha por motorista, escaneável de uma olhada.
 */
export function CardCargasAtivas({
  cargas,
  saldoPorMotorista,
}: {
  cargas: CargaDetalhada[];
  /** null = módulo de adiantamentos ainda sem dado pra esse motorista */
  saldoPorMotorista: Map<string, number | null>;
}) {
  if (cargas.length === 0) {
    return (
      <div className="card mb-6">
        <h2 className="text-lg font-semibold mb-1">🚚 Cargas ativas</h2>
        <p className="text-cinza-suave text-sm">
          Nenhum motorista com carga aberta agora.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-6 overflow-x-auto">
      <h2 className="text-lg font-semibold mb-3">
        🚚 Cargas ativas ({cargas.length})
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-cinza-suave border-b border-cinza-borda">
            <th className="py-2 pr-3">Motorista</th>
            <th className="py-2 pr-3">Caminhão</th>
            <th className="py-2 pr-3 text-right">Dias</th>
            <th className="py-2 pr-3">Cheio</th>
            <th className="py-2 pr-3 text-right">Coletas</th>
            <th className="py-2 pr-3 text-right">Litros</th>
            <th className="py-2 pr-3 text-right">R$ na mão</th>
          </tr>
        </thead>
        <tbody>
          {cargas.map((c) => {
            const dias = Math.max(
              1,
              Math.floor(
                (Date.now() - new Date(c.iniciada_em).getTime()) /
                  (24 * 60 * 60 * 1000)
              )
            );
            const pct =
              c.capacidade_l > 0
                ? Math.round((c.total_litros_coletas / c.capacidade_l) * 100)
                : 0;
            const cor =
              pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-verde";
            const saldo = saldoPorMotorista.get(c.motorista_id);
            return (
              <tr
                key={c.id}
                className="border-b border-cinza-borda last:border-0 hover:bg-slate-50"
              >
                <td className="py-2 pr-3 whitespace-nowrap font-medium">
                  <Link href="/admin/cargas" className="hover:text-verde">
                    {c.motorista_nome}
                  </Link>
                  {c.motorista_is_teste && (
                    <span title="Motorista de teste"> 🧪</span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">
                  {c.caminhao_placa}{" "}
                  <span className="text-cinza-suave">{c.caminhao_marca}</span>
                </td>
                <td className="py-2 pr-3 text-right font-mono">{dias}</td>
                <td className="py-2 pr-3 min-w-[9rem]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full ${cor}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs w-10 text-right">
                      {pct}%
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_coletas}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {c.total_litros_coletas.toLocaleString("pt-BR")} L
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {saldo === null || saldo === undefined ? (
                    <span className="text-cinza-suave">—</span>
                  ) : (
                    <span className={saldo < 0 ? "text-alerta" : ""}>
                      {formatBRL(saldo)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
