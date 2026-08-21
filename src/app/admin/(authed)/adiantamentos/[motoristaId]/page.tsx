import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { buscarHistoricoAdiantamentos } from "@/lib/admin/queries";
import { formatBRL, formatDataHora } from "@/lib/format";
import { DesfazerAcerto } from "@/components/admin/DesfazerAcerto";

export const dynamic = "force-dynamic";

export default async function HistoricoAdiantamentosPage({
  params,
}: {
  params: Promise<{ motoristaId: string }>;
}) {
  const { motoristaId } = await params;

  const supabase = await getSupabaseServer();
  const { data: motorista } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", motoristaId)
    .maybeSingle();

  const { adiantamentos, acertos } = await buscarHistoricoAdiantamentos(motoristaId);

  const totalEnviado = adiantamentos
    .filter((a) => a.status === "aceito")
    .reduce((s, a) => s + Number(a.valor), 0);
  const totalVale = acertos.reduce((s, a) => s + Number(a.valor_vale), 0);
  const totalDevolvido = acertos.reduce((s, a) => s + Number(a.valor_devolvido), 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link href="/admin/adiantamentos" className="text-cinza-suave hover:text-verde">
          ← Adiantamentos
        </Link>
        <h1 className="text-2xl font-bold">
          Histórico — {motorista?.nome || "—"}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-cinza-suave">Total recebido (aceitos)</p>
          <p className="text-2xl font-bold font-mono">{formatBRL(totalEnviado)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-cinza-suave">Total devolvido em acertos</p>
          <p className="text-2xl font-bold font-mono">{formatBRL(totalDevolvido)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-cinza-suave">Total em vales (desconto salário)</p>
          <p className="text-2xl font-bold font-mono">{formatBRL(totalVale)}</p>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-2">Dinheiro enviado</h2>
      <div className="card overflow-x-auto mb-6">
        {adiantamentos.length === 0 ? (
          <p className="text-cinza-suave text-center py-4">Nenhum adiantamento.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                <th className="py-2 pr-3">Enviado em</th>
                <th className="py-2 pr-3 text-right">Valor</th>
                <th className="py-2 pr-3">Forma</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Aceito em</th>
                <th className="py-2 pr-3">Obs</th>
              </tr>
            </thead>
            <tbody>
              {adiantamentos.map((a) => (
                <tr key={a.id} className="border-b border-cinza-borda last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDataHora(a.data_envio)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatBRL(Number(a.valor))}
                  </td>
                  <td className="py-2 pr-3">
                    {a.forma_pagamento === "pix" ? "PIX" : "Dinheiro"}
                  </td>
                  <td className="py-2 pr-3">
                    {a.status === "aceito"
                      ? "✓ Aceito"
                      : a.status === "pendente"
                        ? `⏳ Pendente${a.pular_contador > 0 ? ` (pulou ${a.pular_contador}×)` : ""}`
                        : "✗ Cancelado"}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {a.aceito_em ? formatDataHora(a.aceito_em) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-cinza-suave">
                    {a.observacao || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-2">Acertos</h2>
      <div className="card overflow-x-auto">
        {acertos.length === 0 ? (
          <p className="text-cinza-suave text-center py-4">Nenhum acerto ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-cinza-suave border-b border-cinza-borda">
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3 text-right">Devolvido (cash)</th>
                <th className="py-2 pr-3 text-right">Vale (salário)</th>
                <th className="py-2 pr-3 text-right">Ficou de saldo</th>
                <th className="py-2 pr-3">Obs</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {acertos.map((a, i) => (
                <tr key={a.id} className="border-b border-cinza-borda last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {formatDataHora(a.corte_em)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatBRL(Number(a.valor_devolvido))}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatBRL(Number(a.valor_vale))}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatBRL(Number(a.valor_saldo))}
                  </td>
                  <td className="py-2 pr-3 text-cinza-suave">
                    {a.observacao || "—"}
                  </td>
                  <td className="py-2 pr-3">
                    {/* Só o mais recente pode ser desfeito — o servidor
                        garante; a tela nem oferece nos outros. */}
                    {i === 0 && (
                      <DesfazerAcerto
                        acertoId={a.id}
                        motoristaNome={motorista?.nome || "—"}
                        valorDevolvido={Number(a.valor_devolvido)}
                        valorVale={Number(a.valor_vale)}
                        valorSaldo={Number(a.valor_saldo)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {acertos.some(
          (a) =>
            Number(a.valor_devolvido) < 0 ||
            Number(a.valor_vale) < 0 ||
            Number(a.valor_saldo) < 0
        ) && (
          <p className="text-xs text-cinza-suave mt-3">
            Valores negativos = a empresa devia pro motorista (ele tinha gastado
            do próprio bolso): pagou na hora, somou no salário ou levou pro
            próximo ciclo.
          </p>
        )}
      </div>
    </div>
  );
}
