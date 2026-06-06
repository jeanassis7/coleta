"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getLocalDB } from "@/lib/db/dexie";
import { formatBRL, formatHora, formatLitros } from "@/lib/format";

export function ListaColetasDia({ motoristaId }: { motoristaId: string }) {
  const coletas = useLiveQuery(async () => {
    const db = getLocalDB();
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    const inicio = inicioDia.getTime();

    return db.coletas_locais
      .filter((c) => c.motorista_id === motoristaId && c.criado_em >= inicio)
      .reverse()
      .sortBy("criado_em");
  }, [motoristaId]);

  if (!coletas || coletas.length === 0) {
    return (
      <div className="text-center text-cinza-suave text-lg py-8">
        Nenhuma coleta hoje ainda.
      </div>
    );
  }

  // Ordena decrescente
  const ordenadas = [...coletas].sort((a, b) => b.criado_em - a.criado_em);

  return (
    <div className="space-y-3">
      {ordenadas.map((c) => {
        const enviada = c.registro_subido && c.foto_subida;
        return (
          <div key={c.client_id} className="card">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{enviada ? "☁️" : "📱"}</span>
                  <span className="text-lg font-semibold">
                    {formatHora(c.criado_em)}
                  </span>
                  <span className="text-lg">·</span>
                  <span className="text-lg font-semibold">
                    {formatLitros(c.litros)}
                  </span>
                </div>
                <p className="text-base text-cinza-suave truncate">
                  {c.local_nome} · {formatBRL(c.valor_pago)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
