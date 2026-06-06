import type { CertificadoMotorista } from "@/lib/admin/queries";

export function CertificadoPorMotorista({ dados }: { dados: CertificadoMotorista[] }) {
  if (dados.length === 0) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-2">Certificado emitido</h3>
        <p className="text-cinza-suave text-sm">Sem dados no período.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="font-semibold">Certificado emitido por motorista</h3>
        <p className="text-xs text-cinza-suave">
          % de coletas que tiveram certificado emitido (integral ou parcial). Atenção em quem fica abaixo de 70%.
        </p>
      </div>
      <div className="space-y-3">
        {dados.map((m) => {
          const pct = Math.round(m.pct_emitido);
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
                <span>integral: {m.integral}</span>
                <span>parcial: {m.parcial}</span>
                <span>sem: {m.nao}</span>
                <span className="ml-auto">total: {m.total}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
