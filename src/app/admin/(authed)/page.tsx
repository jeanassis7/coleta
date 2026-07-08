import {
  buscarColetas,
  buscarColetasAnterior,
  buscarMotoristas,
  calcularKpis,
  calcularCustoPorMotorista,
  calcularCertificadoPorMotorista,
  calcularTopLocais,
  resolvePeriodo,
  type FiltrosDashboard,
} from "@/lib/admin/queries";
import { formatData } from "@/lib/format";
import { Filtros } from "@/components/admin/Filtros";
import { KpiCardsComDelta } from "@/components/admin/KpiCardsComDelta";
import { BarrasMotorista } from "@/components/admin/KpiCards";
import { CustoPorMotorista } from "@/components/admin/CustoPorMotorista";
import { CertificadoPorMotorista } from "@/components/admin/CertificadoPorMotorista";
import { TopLocais } from "@/components/admin/TopLocais";
import { AbasView } from "@/components/admin/AbasView";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filtros: FiltrosDashboard = {
    periodo: (params.periodo as FiltrosDashboard["periodo"]) || "mes",
    inicio: params.inicio,
    fim: params.fim,
    motorista: params.motorista,
  };

  const [coletas, coletasAnterior, motoristas] = await Promise.all([
    buscarColetas(filtros),
    buscarColetasAnterior(filtros),
    buscarMotoristas(),
  ]);

  const motoristasMotoristas = motoristas.filter((m) => m.role === "motorista");
  const kpisAtuais = calcularKpis(coletas);
  const kpisAnterior = calcularKpis(coletasAnterior);
  const custoPorMotorista = calcularCustoPorMotorista(coletas);
  const certificadoPorMotorista = calcularCertificadoPorMotorista(coletas);
  const topLocais = calcularTopLocais(coletas, 15);

  // Intervalo real de datas do período selecionado (pra mostrar ao usuário)
  const { inicio, fim } = resolvePeriodo(filtros);
  const precisaDatas =
    filtros.periodo === "customizado" && (!filtros.inicio || !filtros.fim);
  const intervaloLabel = precisaDatas
    ? "Escolha as datas de início e fim acima"
    : formatData(inicio) === formatData(fim)
      ? formatData(inicio)
      : `${formatData(inicio)} a ${formatData(fim)}`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <Filtros
        motoristas={motoristasMotoristas}
        intervaloLabel={intervaloLabel}
      />

      {/* Comparação atual vs anterior */}
      <KpiCardsComDelta
        kpisAtuais={kpisAtuais}
        kpisAnterior={kpisAnterior}
        periodo={filtros.periodo}
      />

      {/* Volume por motorista */}
      <BarrasMotorista kpis={kpisAtuais} />

      {/* Análises lado a lado */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <CustoPorMotorista dados={custoPorMotorista} />
        <CertificadoPorMotorista dados={certificadoPorMotorista} />
      </div>

      {/* Top locais full-width */}
      <div className="mb-6">
        <TopLocais dados={topLocais} />
      </div>

      {/* Lista / Mapa */}
      <AbasView coletas={coletas} />
    </div>
  );
}
