import { calcularDre } from "@/lib/admin/dre";
import { DrePainel } from "@/components/admin/DrePainel";

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

export default async function DrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const padrao = mesAtual();
  const inicio = params.inicio || padrao.inicio;
  const fim = params.fim || padrao.fim;

  const dre = await calcularDre(inicio, fim);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">DRE</h1>
      <p className="text-sm text-cinza-suave mb-6">
        <strong>O dinheiro que saiu, classificado.</strong> Regime de caixa:
        o gasto pesa no dia em que saiu da conta (ou da mão do motorista).
        Quem responde &ldquo;quanto tenho agora?&rdquo; é o{" "}
        <a href="/admin/caixa" className="text-verde hover:underline">
          Caixa
        </a>
        . Isto aqui responde &ldquo;o mês foi bom?&rdquo;. Nada se edita aqui —
        o que muda é o{" "}
        <a href="/admin/lancamentos" className="text-verde hover:underline">
          lançamento
        </a>
        .
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
          Ver
        </button>
      </form>

      <DrePainel dre={dre} />

      <p className="text-xs text-cinza-suave mt-4">
        Linhas marcadas <strong>auto</strong> o sistema calcula sozinho da
        origem (coletas, abastecimentos, manutenções) — por isso elas não
        aparecem pra lançar. A flecha ▸ abre o detalhe da linha: por pessoa
        (Salário, Óleo dos motoristas) ou por origem do dinheiro (a Receita
        abre em à vista, cheques compensados e cheques repassados).
      </p>
    </div>
  );
}
