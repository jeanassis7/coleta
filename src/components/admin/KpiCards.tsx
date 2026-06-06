import { formatBRL, formatLitros } from "@/lib/format";
import type { Kpis } from "@/lib/admin/queries";

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const pctGps =
    kpis.total_coletas > 0
      ? Math.round((kpis.coletas_com_gps / kpis.total_coletas) * 100)
      : 100;
  const alertaGps = pctGps < 80 && kpis.total_coletas > 0;

  const cards = [
    { label: "Coletas", value: kpis.total_coletas.toString() },
    { label: "Litros", value: formatLitros(kpis.total_litros) },
    { label: "Total pago", value: formatBRL(Math.round(kpis.total_pago)) },
    {
      label: "R$/litro",
      value:
        kpis.custo_medio > 0
          ? `R$ ${kpis.custo_medio.toFixed(2).replace(".", ",")}`
          : "—",
    },
    { label: "Motoristas", value: kpis.motoristas_ativos.toString() },
    {
      label: "Com GPS",
      value: `${pctGps}%`,
      destaque: alertaGps ? "atencao" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`card text-center ${
            c.destaque === "atencao" ? "border-atencao bg-atencao/5" : ""
          }`}
        >
          <p className="text-2xl font-bold">{c.value}</p>
          <p className="text-sm text-cinza-suave">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

export function BarrasMotorista({ kpis }: { kpis: Kpis }) {
  if (kpis.por_motorista.length === 0) return null;
  const topLitros = Math.max(...kpis.por_motorista.map((m) => m.litros));

  return (
    <div className="card mb-6">
      <h3 className="font-semibold mb-3">Por motorista</h3>
      <div className="space-y-3">
        {kpis.por_motorista.map((m) => {
          const pct = topLitros > 0 ? (m.litros / topLitros) * 100 : 0;
          return (
            <div key={m.motorista_id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{m.nome}</span>
                <span className="text-cinza-suave">
                  {m.coletas} coletas · {formatLitros(m.litros)} · {formatBRL(Math.round(m.valor))}
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-verde"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
