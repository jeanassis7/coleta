import Link from "next/link";
import { notFound } from "next/navigation";
import { buscarPostoDetalhe, buscarPostosComSaldo } from "@/lib/admin/postos";
import { buscarContasFinanceiras } from "@/lib/admin/caixa";
import { buscarCheques } from "@/lib/admin/queries";
import { formatBRL, formatData, formatLitros } from "@/lib/format";
import { FechamentoPosto } from "@/components/admin/FechamentoPosto";
import { CuradoriaPosto } from "@/components/admin/CuradoriaPosto";

export const dynamic = "force-dynamic";

export default async function PostoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [posto, contas, cheques, todos] = await Promise.all([
    buscarPostoDetalhe(id),
    buscarContasFinanceiras(),
    buscarCheques({ status: ["em_carteira"] }),
    buscarPostosComSaldo(),
  ]);
  if (!posto) notFound();

  const abertas = posto.notas.filter((n) => n.status === "a_pagar");
  const resto = posto.notas.filter((n) => n.status !== "a_pagar");

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Link href="/admin/postos" className="text-cinza-suave hover:text-verde">
          ← Postos
        </Link>
        <h1 className="text-2xl font-bold">{posto.nome}</h1>
        <a
          href={`https://www.google.com/maps?q=${posto.latitude},${posto.longitude}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-verde hover:underline"
        >
          ver no mapa
        </a>
      </div>

      <div className="mb-3">
        <CuradoriaPosto
          postoId={posto.id}
          nomeAtual={posto.nome}
          outros={todos
            .filter((p) => p.id !== posto.id)
            .map((p) => ({ id: p.id, nome: p.nome, notas: p.notas_abertas }))}
        />
      </div>

      {posto.apelidos.length > 0 && (
        <p className="text-sm text-cinza-suave mb-4">
          Também já foi digitado como:{" "}
          <strong>{posto.apelidos.join(", ")}</strong>
        </p>
      )}

      <div className="card border-2 border-verde mb-6 flex items-baseline justify-between">
        <span className="text-sm text-cinza-suave">Saldo em aberto</span>
        <span className="text-2xl font-bold font-mono">
          {formatBRL(posto.saldo)}
        </span>
      </div>

      {abertas.length > 0 && (
        <FechamentoPosto
          postoId={posto.id}
          postoNome={posto.nome}
          notas={abertas.map((n) => ({
            conta_id: n.conta_id as string,
            quando: n.quando,
            quem: n.quem,
            valor: n.valor,
          }))}
          contas={contas.map((c) => ({ id: c.id, nome: c.nome }))}
          cheques={cheques.map((c) => ({
            id: c.id,
            valor: Number(c.valor),
            banco: c.banco,
            numero: c.numero,
            bom_para: c.bom_para,
          }))}
        />
      )}

      <h2 className="text-lg font-semibold mt-8 mb-2">
        Notas em aberto ({abertas.length})
      </h2>
      <Tabela notas={abertas} vazio="Nada em aberto nesse posto." />

      <h2 className="text-lg font-semibold mt-8 mb-2">Histórico</h2>
      <Tabela notas={resto} vazio="Sem histórico ainda." />
    </div>
  );
}

function Tabela({
  notas,
  vazio,
}: {
  notas: Awaited<ReturnType<typeof buscarPostoDetalhe>> extends null
    ? never
    : NonNullable<Awaited<ReturnType<typeof buscarPostoDetalhe>>>["notas"];
  vazio: string;
}) {
  if (notas.length === 0) {
    return <p className="text-sm text-cinza-suave py-4">{vazio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-cinza-suave border-b border-cinza-borda">
            <th className="py-2">Quando</th>
            <th className="py-2">Quem assinou</th>
            <th className="py-2">Veículo</th>
            <th className="py-2 text-right">Litros</th>
            <th className="py-2 text-right">Valor</th>
            <th className="py-2">Situação</th>
          </tr>
        </thead>
        <tbody>
          {notas.map((n) => (
            <tr
              key={n.abastecimento_id}
              className={`border-b border-slate-100 ${
                n.do_socio ? "bg-amber-50" : ""
              }`}
            >
              <td className="py-2 whitespace-nowrap">{formatData(n.quando)}</td>
              <td className="py-2">{n.quem}</td>
              <td className="py-2">{n.veiculo}</td>
              <td className="py-2 text-right font-mono">
                {formatLitros(n.litros)}
              </td>
              <td className="py-2 text-right font-mono">{formatBRL(n.valor)}</td>
              <td className="py-2 whitespace-nowrap">
                {n.status === "a_pagar" ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                    em aberto
                  </span>
                ) : n.status === "paga" ? (
                  <span className="text-xs text-cinza-suave">
                    paga {n.pago_em ? formatData(n.pago_em) : ""}
                  </span>
                ) : (
                  <span className="text-xs text-cinza-suave">
                    pago na hora
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
