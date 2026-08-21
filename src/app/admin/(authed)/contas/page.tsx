import {
  buscarContasAPagar,
  buscarDespesasRecorrentes,
  buscarCheques,
  resumoContasAPagar,
  buscarMotoristas,
} from "@/lib/admin/queries";
import {
  buscarContasFinanceiras,
  buscarValesPendentes,
} from "@/lib/admin/caixa";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ContasPainel } from "@/components/admin/ContasPainel";

export const dynamic = "force-dynamic";

export default async function ContasPage() {
  const supabase = await getSupabaseServer();
  const [contas, recorrentes, chequesCarteira, resumo, contasFin, perfis, vales, { data: saldos }] =
    await Promise.all([
      buscarContasAPagar(),
      buscarDespesasRecorrentes(),
      buscarCheques({ status: ["em_carteira"] }),
      resumoContasAPagar(),
      buscarContasFinanceiras(),
      buscarMotoristas(),
      // O vale do acerto desconta do salário — o sistema lembra, não o gestor.
      buscarValesPendentes(),
      // Saldo NEGATIVO de motorista = a empresa deve a ele. Não é conta a
      // pagar, mas é dívida — o resumo só mostrava o que estava na tabela.
      supabase.rpc("saldos_motoristas"),
    ]);
  const opcoesConta = contasFin.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
  }));
  const deveMotoristas = ((saldos as { saldo: number }[]) ?? [])
    .filter((s) => Number(s.saldo) < 0)
    .reduce((acc, s) => acc + Math.abs(Number(s.saldo)), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Contas a pagar</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Tudo que a empresa deve: nota assinada no posto, manutenção, óleo a
        prazo, imposto. Dá pra pagar com{" "}
        <strong>cheque da carteira</strong> — ele sai de lá e fica registrado
        pra onde foi.
      </p>
      <ContasPainel
        contasFinanceiras={opcoesConta}
        contas={contas}
        recorrentes={recorrentes}
        chequesCarteira={chequesCarteira}
        resumo={resumo}
        pessoas={perfis.map((p) => ({ id: p.id, nome: p.nome }))}
        vales={vales}
        deveMotoristas={Math.round(deveMotoristas * 100) / 100}
      />
    </div>
  );
}
