import { formatBRL, formatLitros } from "@/lib/format";
import type { Kpis, Delta, FiltrosDashboard } from "@/lib/admin/queries";
import { calcularDelta } from "@/lib/admin/queries";

interface Props {
  kpisAtuais: Kpis;
  kpisAnterior: Kpis;
  periodo: FiltrosDashboard["periodo"];
}

const LABEL_ANTERIOR: Record<FiltrosDashboard["periodo"], string> = {
  hoje: "vs ontem",
  semana: "vs semana anterior",
  mes: "vs mês anterior",
  customizado: "vs período anterior",
};

export function KpiCardsComDelta({ kpisAtuais, kpisAnterior, periodo }: Props) {
  const labelComparacao = LABEL_ANTERIOR[periodo];
  const pctGps =
    kpisAtuais.total_coletas > 0
      ? Math.round((kpisAtuais.coletas_com_gps / kpisAtuais.total_coletas) * 100)
      : 100;
  const alertaGps = pctGps < 80 && kpisAtuais.total_coletas > 0;

  const cards: {
    label: string;
    valor: string;
    delta: Delta;
    inverter?: boolean; // se true: queda é boa, alta é ruim (custo médio por ex)
  }[] = [
    {
      label: "Coletas",
      valor: kpisAtuais.total_coletas.toString(),
      delta: calcularDelta(kpisAtuais.total_coletas, kpisAnterior.total_coletas),
    },
    {
      label: "Litros",
      valor: formatLitros(kpisAtuais.total_litros),
      delta: calcularDelta(kpisAtuais.total_litros, kpisAnterior.total_litros),
    },
    {
      label: "Total pago",
      valor: formatBRL(Math.round(kpisAtuais.total_pago)),
      delta: calcularDelta(kpisAtuais.total_pago, kpisAnterior.total_pago),
      inverter: true, // gastar mais não é necessariamente bom
    },
    {
      label: "R$/litro",
      valor:
        kpisAtuais.custo_medio > 0
          ? `R$ ${kpisAtuais.custo_medio.toFixed(2).replace(".", ",")}`
          : "—",
      delta: calcularDelta(kpisAtuais.custo_medio, kpisAnterior.custo_medio),
      inverter: true, // custo subiu é ruim
    },
    {
      label: "Motoristas",
      valor: kpisAtuais.motoristas_ativos.toString(),
      delta: calcularDelta(
        kpisAtuais.motoristas_ativos,
        kpisAnterior.motoristas_ativos
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="card">
          <p className="text-sm text-cinza-suave">{c.label}</p>
          <p className="text-2xl font-bold">{c.valor}</p>
          <DeltaIndicator
            delta={c.delta}
            inverter={c.inverter}
            labelComparacao={labelComparacao}
          />
        </div>
      ))}
      <div
        className={`card ${
          alertaGps ? "border-atencao bg-atencao/5" : ""
        }`}
      >
        <p className="text-sm text-cinza-suave">Com GPS</p>
        <p className="text-2xl font-bold">{pctGps}%</p>
        <p className="text-xs text-cinza-suave">
          {kpisAtuais.coletas_com_gps}/{kpisAtuais.total_coletas}
        </p>
      </div>
    </div>
  );
}

function DeltaIndicator({
  delta,
  inverter,
  labelComparacao,
}: {
  delta: Delta;
  inverter?: boolean;
  labelComparacao: string;
}) {
  if (delta.valor_anterior === 0 && delta.valor_atual === 0) {
    return (
      <p className="text-xs text-cinza-suave mt-1">
        sem dados {labelComparacao}
      </p>
    );
  }

  if (delta.valor_anterior === 0) {
    return (
      <p className="text-xs text-cinza-suave mt-1">
        novo (sem dado {labelComparacao})
      </p>
    );
  }

  if (delta.direcao === "igual") {
    return (
      <p className="text-xs text-cinza-suave mt-1">→ igual {labelComparacao}</p>
    );
  }

  const subiu = delta.direcao === "subiu";
  // Se inverter=true, "subiu" vira ruim (vermelho)
  const bom = inverter ? !subiu : subiu;
  const cor = bom ? "text-verde" : "text-alerta";
  const seta = subiu ? "↑" : "↓";

  return (
    <p className={`text-xs font-medium mt-1 ${cor}`}>
      {seta} {Math.abs(delta.diff_pct ?? 0).toFixed(1)}% {labelComparacao}
    </p>
  );
}
