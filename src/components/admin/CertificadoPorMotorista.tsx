import { formatLitros } from "@/lib/format";
import type { CertificadoMotorista } from "@/lib/admin/queries";

export function CertificadoPorMotorista({ dados }: { dados: CertificadoMotorista[] }) {
  if (dados.length === 0) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-2">Certificado emitido por motorista</h3>
        <p className="text-cinza-suave text-sm">Sem dados no período.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Certificado emitido por motorista</h3>
      <div className="space-y-3">
        {dados.map((m) => {
          const pct = Math.round(m.pct_litros);
          const corBarra =
            pct >= 90 ? "bg-verde" : pct >= 70 ? "bg-atencao" : "bg-alerta";

          return (
            <div key={m.motorista_id}>
              <div className="flex justify-between mb-1 text-sm">
                <span className="font-medium">{m.nome}</span>
                <span className="font-semibold">{pct}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-1">
                <div className={`h-full ${corBarra}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex gap-3 text-xs text-cinza-suave">
                <span>{formatLitros(m.litros_certificado)} certificados</span>
                <span>de {formatLitros(m.total_litros)} coletados</span>
                <span className="ml-auto">{m.total_coletas} coletas</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
