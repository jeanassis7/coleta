import { buscarComprasDiretas } from "@/lib/admin/queries";
import { CompraDiretaPainel } from "@/components/admin/CompraDiretaPainel";
import { FiltrosOperacao } from "@/components/admin/FiltrosOperacao";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await exigirAcessoModulo1OuRedirect();
  const params = await searchParams;

  const compras = await buscarComprasDiretas({
    periodo: params.periodo,
    inicio: params.inicio,
    fim: params.fim,
  });

  const totalValor = compras.reduce((s, c) => s + c.valor, 0);
  const totalKg = compras.reduce((s, c) => s + c.peso_kg, 0);
  const rsPorKg = totalKg > 0 ? totalValor / totalKg : 0;
  const resumo =
    `${compras.length} ${compras.length === 1 ? "compra" : "compras"} · ` +
    `${totalKg.toLocaleString("pt-BR")} kg · ${formatBRL(totalValor)}` +
    (totalKg > 0 ? ` · R$ ${rsPorKg.toFixed(2).replace(".", ",")}/kg` : "");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Compra direta de óleo</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Óleo que <strong>o gestor</strong> negociou e pagou do caixa da empresa —
        o motorista não coletou. Por isso não desconta do saldo de ninguém e não
        entra no custo por motorista. Entra no estoque e no custo médio do óleo.
      </p>

      <FiltrosOperacao motoristas={[]} resumo={resumo} />

      <CompraDiretaPainel compras={compras} />
    </div>
  );
}
