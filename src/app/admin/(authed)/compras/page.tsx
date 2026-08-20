import { buscarComprasDiretas, buscarCargas, buscarCheques } from "@/lib/admin/queries";
import { buscarContasFinanceiras } from "@/lib/admin/caixa";
import { CompraDiretaPainel } from "@/components/admin/CompraDiretaPainel";
import { FiltrosOperacao } from "@/components/admin/FiltrosOperacao";
import { ExportCsv } from "@/components/admin/ExportCsv";
import { formatBRL, formatData } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const [compras, contas, cargasAtivas, chequesCarteira] = await Promise.all([
    buscarComprasDiretas({
      periodo: params.periodo,
      inicio: params.inicio,
      fim: params.fim,
    }),
    buscarContasFinanceiras(),
    buscarCargas({ status: "ativa" }),
    buscarCheques({ status: ["em_carteira"] }),
  ]);

  const totalValor = compras.reduce((s, c) => s + c.valor, 0);
  const totalKg = compras.reduce((s, c) => s + c.peso_kg, 0);
  const rsPorKg = totalKg > 0 ? totalValor / totalKg : 0;
  const resumo =
    `${compras.length} ${compras.length === 1 ? "compra" : "compras"} · ` +
    `${totalKg.toLocaleString("pt-BR")} kg · ${formatBRL(totalValor)}` +
    (totalKg > 0 ? ` · R$ ${rsPorKg.toFixed(2).replace(".", ",")}/kg` : "");

  const linhasCsv = compras.map((c) => ({
    data: formatData(c.data),
    fornecedor: c.fornecedor,
    quantidade: c.quantidade.toFixed(2),
    unidade: c.unidade,
    tipo_oleo: c.tipo_oleo,
    peso_kg: c.peso_kg.toFixed(2),
    medido_ou_estimado: c.unidade === "kg" ? "medido (balança)" : "estimado",
    valor: c.valor.toFixed(2),
    valor_por_kg: c.peso_kg > 0 ? (c.valor / c.peso_kg).toFixed(2) : "",
    entra_no_estoque: c.entra_no_estoque ? "sim" : "não (conta na descarga)",
    certificado: c.certificado_tipo,
    litros_certificado: c.litros_certificado?.toFixed(2) ?? "",
    observacao: c.observacao || "",
  }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="text-2xl font-bold">Compra direta de óleo</h1>
        <ExportCsv linhas={linhasCsv} nomeArquivo="compras_diretas" />
      </div>
      <p className="text-sm text-cinza-suave mb-4">
        Óleo que <strong>o gestor</strong> negociou e pagou do caixa da empresa —
        o motorista não coletou. Por isso não desconta do saldo de ninguém e não
        entra no custo por motorista. Entra no estoque e no custo médio do óleo.
      </p>

      <FiltrosOperacao motoristas={[]} resumo={resumo} />

      <CompraDiretaPainel
        compras={compras}
        contas={contas}
        cargasAtivas={cargasAtivas.map((c) => ({
          id: c.id,
          rotulo: `${c.caminhao_placa ?? "—"} — ${c.motorista_nome}`,
        }))}
        chequesCarteira={chequesCarteira.map((ch) => ({
          id: ch.id,
          rotulo: `${ch.banco} · R$ ${Number(ch.valor).toFixed(2).replace(".", ",")} · bom para ${new Date(ch.bom_para + "T12:00:00").toLocaleDateString("pt-BR")} · de ${ch.comprador_nome ?? "—"}`,
        }))}
      />
    </div>
  );
}
