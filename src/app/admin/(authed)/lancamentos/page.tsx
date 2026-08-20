import {
  buscarLancamentos,
  buscarContasFinanceiras,
  buscarValesPendentes,
} from "@/lib/admin/caixa";
import { buscarMotoristas, buscarCheques } from "@/lib/admin/queries";
import { LancamentosPainel } from "@/components/admin/LancamentosPainel";

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

export default async function LancamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const padrao = mesAtual();
  const filtros = {
    inicio: params.inicio || padrao.inicio,
    fim: params.fim || padrao.fim,
    categoria: params.categoria || "",
    conta_id: params.conta_id || "",
  };

  const [lancamentos, contas, perfis, chequesCarteira, vales] =
    await Promise.all([
      buscarLancamentos({
        inicio: filtros.inicio,
        fim: filtros.fim,
        categoria: filtros.categoria || undefined,
        conta_id: filtros.conta_id || undefined,
      }),
      buscarContasFinanceiras(),
      buscarMotoristas(),
      // Pagar com cheque tira o papel da carteira — é o caminho que
      // substituiu o antigo botão "Repassar" solto.
      buscarCheques({ status: ["em_carteira"] }),
      // O vale do acerto desconta do salário — o sistema lembra, não o gestor.
      buscarValesPendentes(),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Lançamentos</h1>
      <p className="text-sm text-cinza-suave mb-6">
        O que <strong>já saiu</strong> — no ritmo do extrato: data, de qual
        conta, o que foi, quanto. O que ainda vai vencer fica em{" "}
        <a href="/admin/contas" className="text-verde hover:underline">
          Contas a pagar
        </a>
        . É isto que alimenta o DRE.
      </p>

      <LancamentosPainel
        lancamentos={lancamentos}
        contas={contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }))}
        // Inclui inativos: quem saiu da empresa continua tendo histórico, e
        // o Valdecir é cadastro contábil que nunca fica ativo.
        pessoas={perfis.map((p) => ({ id: p.id, nome: p.nome }))}
        cheques={chequesCarteira.map((c) => ({
          id: c.id,
          rotulo: `${c.banco} · ${c.emitente} · R$ ${c.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · bom para ${c.bom_para.slice(8, 10)}/${c.bom_para.slice(5, 7)}`,
          valor: c.valor,
        }))}
        vales={vales}
        filtros={filtros}
      />
    </div>
  );
}
