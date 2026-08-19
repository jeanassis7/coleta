import {
  buscarColetas,
  buscarColetasAnterior,
  buscarMotoristas,
  buscarCargas,
  buscarMotoristasComSaldo,
  resumoComprasDiretas,
  resolvePeriodoAnterior,
  calcularKpis,
  calcularCustoPorMotorista,
  calcularCertificadoPorMotorista,
  calcularTopLocais,
  resolvePeriodo,
  type FiltrosDashboard,
  type CargaDetalhada,
} from "@/lib/admin/queries";
import { buscarAlertas, type Alerta } from "@/lib/admin/alertas";
import { formatData } from "@/lib/format";
import { Filtros } from "@/components/admin/Filtros";
import { KpiCardsComDelta } from "@/components/admin/KpiCardsComDelta";
import { BarrasMotorista } from "@/components/admin/KpiCards";
import { CustoPorMotorista } from "@/components/admin/CustoPorMotorista";
import { CertificadoPorMotorista } from "@/components/admin/CertificadoPorMotorista";
import { TopLocais } from "@/components/admin/TopLocais";
import { AbasView } from "@/components/admin/AbasView";
import { CardAlertas } from "@/components/admin/CardAlertas";
import { CardCargasAtivas } from "@/components/admin/CardCargasAtivas";
import { CardDescargasRecentes } from "@/components/admin/CardDescargasRecentes";

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

  // Painel de operação. Uma busca de cargas só (as ativas saem daqui por
  // filtro em memória) e os saldos calculados UMA vez, repassados pros
  // alertas — antes o dashboard fazia tudo em dobro e demorava ~4s.
  const [cargasTodas, saldos] = await Promise.all([
    buscarCargas(),
    buscarMotoristasComSaldo(),
  ]);
  const cargasAtivas = cargasTodas.filter((c) => c.status === "ativa");
  const saldoPorMotorista = new Map<string, number | null>();
  for (const s of saldos) saldoPorMotorista.set(s.id, s.saldo_atual);
  const alertas = await buscarAlertas({ saldos });

  const motoristasMotoristas = motoristas.filter((m) => m.role === "motorista");
  const kpisAtuais = calcularKpis(coletas);
  const kpisAnterior = calcularKpis(coletasAnterior);

  // Compra direta entra no custo/litros do topo (é óleo que a empresa
  // pagou), mas NÃO nos gráficos por motorista — lá a comparação é entre
  // pessoas, e compra direta não é pessoa.
  const intervaloAtual = resolvePeriodo(filtros);
  const intervaloAnterior = resolvePeriodoAnterior(filtros);
  const [compraAtual, compraAnterior] = await Promise.all([
    resumoComprasDiretas(intervaloAtual.inicio, intervaloAtual.fim),
    resumoComprasDiretas(intervaloAnterior.inicio, intervaloAnterior.fim),
  ]);

  const somarCompras = (
    kpis: typeof kpisAtuais,
    compra: { valor: number; kg: number }
  ) => {
    if (compra.valor <= 0 && compra.kg <= 0) return kpis;
    const litros = compra.kg / 0.9; // mesma densidade do resto do sistema
    const total_litros = kpis.total_litros + litros;
    const total_pago = kpis.total_pago + compra.valor;
    return {
      ...kpis,
      total_litros,
      total_pago,
      custo_medio: total_litros > 0 ? total_pago / total_litros : 0,
    };
  };

  const kpisAtuaisComCompras = somarCompras(kpisAtuais, compraAtual);
  const kpisAnteriorComCompras = somarCompras(kpisAnterior, compraAnterior);
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

      {/* Operação agora — antes dos filtros porque não depende de período */}
      <CardAlertas alertas={alertas} />
      <CardCargasAtivas
        cargas={cargasAtivas}
        saldoPorMotorista={saldoPorMotorista}
      />
      <CardDescargasRecentes cargas={cargasTodas} />

      <Filtros
        motoristas={motoristasMotoristas}
        intervaloLabel={intervaloLabel}
      />

      {/* Comparação atual vs anterior */}
      <KpiCardsComDelta
        kpisAtuais={kpisAtuaisComCompras}
        kpisAnterior={kpisAnteriorComCompras}
        periodo={filtros.periodo}
        compraDireta={compraAtual}
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
