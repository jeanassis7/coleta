import Link from "next/link";
import { buscarPostosComSaldo } from "@/lib/admin/postos";
import { formatBRL } from "@/lib/format";
import { NovoPosto } from "@/components/admin/NovoPosto";

export const dynamic = "force-dynamic";

export default async function PostosPage() {
  const postos = await buscarPostosComSaldo();
  const total = postos.reduce((s, p) => s + p.saldo, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Postos de combustível</h1>
      <p className="text-sm text-cinza-suave mb-4">
        O que a empresa deve em cada posto — só as notas assinadas que ainda
        não foram pagas. Nota paga na hora não aparece aqui: ela já saiu do
        caixa e não é dívida.
      </p>

      <div className="mb-4">
        <NovoPosto />
      </div>

      <div className="card border-2 border-verde mb-6 flex items-baseline justify-between">
        <span className="text-sm text-cinza-suave">
          Total em aberto nos postos
        </span>
        <span className="text-2xl font-bold font-mono">{formatBRL(total)}</span>
      </div>

      {postos.length === 0 ? (
        <p className="text-cinza-suave py-8 text-center">
          Nenhum posto cadastrado ainda. Cadastre pelo nome aqui em cima —
          ele descobre onde fica no primeiro abastecimento.
        </p>
      ) : (
        <div className="space-y-2">
          {postos.map((p) => (
            <Link
              key={p.id}
              href={`/admin/postos/${p.id}`}
              className="card flex items-center justify-between hover:border-verde transition-colors"
            >
              <div>
                <p className="font-semibold">{p.nome}</p>
                <p className="text-sm text-cinza-suave">
                  {p.notas_abertas === 0
                    ? "sem nota em aberto"
                    : `${p.notas_abertas} ${
                        p.notas_abertas === 1
                          ? "nota em aberto"
                          : "notas em aberto"
                      }`}
                </p>
              </div>
              <span
                className={`text-xl font-bold font-mono ${
                  p.saldo > 0 ? "" : "text-cinza-suave"
                }`}
              >
                {formatBRL(p.saldo)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
