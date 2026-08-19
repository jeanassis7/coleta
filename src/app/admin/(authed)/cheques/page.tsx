import { buscarCheques, buscarCompradores } from "@/lib/admin/queries";
import { ChequesPainel } from "@/components/admin/ChequesPainel";
import { LoteChequesPainel } from "@/components/admin/LoteChequesPainel";

export const dynamic = "force-dynamic";

export default async function ChequesPage() {
  const [cheques, compradores] = await Promise.all([
    buscarCheques(),
    buscarCompradores(),
  ]);

  // A leitura por foto é atalho, não dependência: sem a chave no servidor a
  // tela some o botão e o lançamento manual segue funcionando igual.
  const ocrDisponivel = !!process.env.OPENAI_API_KEY;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Cheques</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Cheque na mão <strong>não é dinheiro na conta</strong>. Ele quita a
        dívida do comprador quando você recebe o papel, mas só vira caixa
        quando compensa. Se voltar, a dívida dele renasce sozinha.
      </p>

      <LoteChequesPainel
        compradores={compradores.map((c) => ({ id: c.id, nome: c.nome }))}
        ocrDisponivel={ocrDisponivel}
      />

      <ChequesPainel cheques={cheques} />
    </div>
  );
}
