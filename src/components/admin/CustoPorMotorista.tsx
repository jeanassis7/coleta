import type { CustoMotorista } from "@/lib/admin/queries";

function fmtCusto(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

export function CustoPorMotorista({ dados }: { dados: CustoMotorista[] }) {
  if (dados.length === 0) {
    return (
      <div className="card">
        <h3 className="font-semibold mb-2">Custo R$/L por motorista</h3>
        <p className="text-cinza-suave text-sm">Sem dados no período.</p>
      </div>
    );
  }

  const melhor = dados[0].custo_medio;
  const pior = dados[dados.length - 1].custo_medio;

  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="font-semibold">Custo R$/L por motorista</h3>
        <p className="text-xs text-cinza-suave">
          Quanto cada motorista paga por litro, em média. Ordenado do mais barato pro mais caro.
        </p>
      </div>
      <div className="space-y-3">
        {dados.map((m) => {
          const ehMelhor = m.custo_medio === melhor && dados.length > 1;
          const ehPior = m.custo_medio === pior && dados.length > 1;
          return (
            <div
              key={m.motorista_id}
              className={`border rounded-xl p-3 ${
                ehMelhor
                  ? "border-verde bg-verde/5"
                  : ehPior
                  ? "border-atencao bg-atencao/5"
                  : "border-cinza-borda"
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold">
                  {m.nome}
                  {ehMelhor && (
                    <span className="ml-2 text-xs bg-verde text-white px-2 py-0.5 rounded">
                      melhor
                    </span>
                  )}
                  {ehPior && (
                    <span className="ml-2 text-xs bg-atencao text-white px-2 py-0.5 rounded">
                      mais caro
                    </span>
                  )}
                </span>
                <span className="text-xl font-bold">
                  {fmtCusto(m.custo_medio)}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-cinza-suave">
                <span>{m.coletas} coletas</span>
                <span>min {fmtCusto(m.custo_min)}</span>
                <span>med {fmtCusto(m.custo_mediana)}</span>
                <span>máx {fmtCusto(m.custo_max)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
