import { buscarCargas } from "@/lib/admin/queries";
import { TabelaCargas } from "@/components/admin/TabelaCargas";
import { ExportCsv } from "@/components/admin/ExportCsv";
import { formatDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CargasPage() {
  // Dev vê cargas de motorista de teste (com badge 🧪); admin nunca vê.
  const cargas = await buscarCargas();

  const linhasCsv = cargas.map((c) => {
    const kmRodado =
      c.km_final !== null && c.km_final > c.km_inicial
        ? c.km_final - c.km_inicial
        : null;
    const custoTotal =
      c.total_valor_coletas + c.total_valor_despesas + c.total_valor_abastecimentos;
    return {
      inicio: formatDataHora(c.iniciada_em),
      fim: c.encerrada_em ? formatDataHora(c.encerrada_em) : "",
      motorista: c.motorista_nome,
      caminhao: `${c.caminhao_placa} ${c.caminhao_marca}`,
      status: c.status,
      km_inicial: c.km_inicial,
      km_final: c.km_final ?? "",
      km_rodado: kmRodado ?? "",
      litros_combustivel: c.total_litros_combustivel.toFixed(2),
      km_por_litro:
        kmRodado !== null && c.total_litros_combustivel > 0
          ? (kmRodado / c.total_litros_combustivel).toFixed(2)
          : "",
      coletas: c.total_coletas,
      litros_declarados: c.total_litros_coletas.toFixed(2),
      peso_bruto_kg: c.descarga?.peso_bruto_kg ?? "",
      tara_kg: c.descarga?.peso_tara_kg ?? c.caminhao_tara_kg,
      peso_liquido_kg: c.descarga?.peso_liquido_kg ?? "",
      umidade_pct: c.descarga?.umidade_pct ?? "",
      valor_coletas: c.total_valor_coletas.toFixed(2),
      qtd_despesas: c.total_despesas,
      valor_despesas: c.total_valor_despesas.toFixed(2),
      qtd_abastecimentos: c.total_abastecimentos,
      valor_abastecimentos: c.total_valor_abastecimentos.toFixed(2),
      custo_total: custoTotal.toFixed(2),
      custo_por_kg:
        c.descarga && c.descarga.peso_liquido_kg > 0
          ? (custoTotal / c.descarga.peso_liquido_kg).toFixed(2)
          : "",
    };
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold">Cargas</h1>
        <ExportCsv linhas={linhasCsv} nomeArquivo="cargas" />
      </div>
      <p className="text-sm text-cinza-suave mb-6">
        Todas as cargas dos motoristas (ativas, encerradas e canceladas).
        Motoristas de teste aparecem só pra você (dev), marcados com 🧪 — o
        admin não vê. Clique nas colunas pra ordenar.
      </p>
      <TabelaCargas cargas={cargas} />
    </div>
  );
}
