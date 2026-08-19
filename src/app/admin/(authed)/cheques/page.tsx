import { buscarCheques } from "@/lib/admin/queries";
import { ChequesPainel } from "@/components/admin/ChequesPainel";

export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const cheques = await buscarCheques();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Cheques</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Cheque na mão <strong>não é dinheiro na conta</strong>. Ele quita a
        dívida do comprador quando você recebe o papel, mas só vira caixa
        quando compensa. Se voltar, a dívida dele renasce sozinha.
      </p>
      <ChequesPainel cheques={cheques} />
    </div>
  );
}
