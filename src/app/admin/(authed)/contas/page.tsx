import {
  buscarContasAPagar,
  buscarDespesasRecorrentes,
  buscarCheques,
  resumoContasAPagar,
} from "@/lib/admin/queries";
import { buscarContasFinanceiras } from "@/lib/admin/caixa";
import { ContasPainel } from "@/components/admin/ContasPainel";

export const dynamic = "force-dynamic";

export default async function ContasPage() {

  const [contas, recorrentes, chequesCarteira, resumo, contasFin] =
    await Promise.all([
      buscarContasAPagar(),
      buscarDespesasRecorrentes(),
      buscarCheques({ status: ["em_carteira"] }),
      resumoContasAPagar(),
      buscarContasFinanceiras(),
    ]);
  const opcoesConta = contasFin.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
  }));


  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Contas a pagar</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Tudo que a empresa deve: nota assinada no posto, manutenção, óleo a
        prazo, aluguel, imposto. Dá pra pagar com{" "}
        <strong>cheque da carteira</strong> — ele sai de lá e fica registrado
        pra onde foi.
      </p>
      <ContasPainel
        contasFinanceiras={opcoesConta}
        contas={contas}
        recorrentes={recorrentes}
        chequesCarteira={chequesCarteira}
        resumo={resumo}
      />
    </div>
  );
}
