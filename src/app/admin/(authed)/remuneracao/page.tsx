import { buscarVigencias, calcularComissao } from "@/lib/admin/remuneracao";
import { buscarMotoristas } from "@/lib/admin/queries";
import { getSupabaseServer } from "@/lib/supabase/server";
import { RemuneracaoPainel } from "@/components/admin/RemuneracaoPainel";

export const dynamic = "force-dynamic";

/** Primeiro e último dia do mês atual em Brasília. */
function mesAtual(): { inicio: string; fim: string } {
  const br = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const ano = br.getUTCFullYear();
  const mes = br.getUTCMonth();
  const p = (d: Date) => d.toISOString().slice(0, 10);
  return {
    inicio: p(new Date(Date.UTC(ano, mes, 1))),
    fim: p(new Date(Date.UTC(ano, mes + 1, 0))),
  };
}

export default async function RemuneracaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const padrao = mesAtual();
  const inicio = params.inicio || padrao.inicio;
  const fim = params.fim || padrao.fim;

  const supabase = await getSupabaseServer();
  const [vigencias, pessoas, comissao, { data: pagos }] = await Promise.all([
    buscarVigencias(),
    buscarMotoristas(),
    calcularComissao(inicio, fim),
    // O que JÁ FOI PAGO de comissão no período — a amarração leve entre o
    // calculado e o pago: sem isso nada avisava pagamento em dobro ou
    // esquecido.
    supabase
      .from("contas_a_pagar")
      .select("pessoa_id, valor")
      .eq("status", "paga")
      .eq("categoria", "comissao")
      .gte("pago_em", inicio)
      .lte("pago_em", fim),
  ]);
  const pagoPorPessoa: Record<string, number> = {};
  for (const p of (pagos as { pessoa_id: string | null; valor: number }[]) ?? []) {
    if (!p.pessoa_id) continue;
    pagoPorPessoa[p.pessoa_id] =
      (pagoPorPessoa[p.pessoa_id] ?? 0) + Number(p.valor || 0);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Remuneração</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Salário, comissão, bônus e transferência a sócio — cada um com{" "}
        <strong>vigência</strong>: um valor que vale a partir de uma data.
        Mudar hoje <strong>não recalcula o passado</strong>.
      </p>

      <form className="card mb-6 flex flex-wrap gap-3 items-end" method="get">
        <div>
          <label className="block text-sm font-medium mb-1">De</label>
          <input
            type="date"
            name="inicio"
            defaultValue={inicio}
            className="border border-cinza-borda rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Até</label>
          <input
            type="date"
            name="fim"
            defaultValue={fim}
            className="border border-cinza-borda rounded-lg px-3 py-2"
          />
        </div>
        <button type="submit" className="btn-primario">
          Calcular
        </button>
      </form>

      <RemuneracaoPainel
        vigencias={vigencias}
        pessoas={pessoas.map((p) => ({ id: p.id, nome: p.nome }))}
        comissao={comissao}
        pagoPorPessoa={pagoPorPessoa}
        periodo={{ inicio, fim }}
      />
    </div>
  );
}
