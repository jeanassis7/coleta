import Link from "next/link";
import { notFound } from "next/navigation";
import {
  buscarCompradores,
  buscarVendas,
  buscarRecebimentos,
  buscarCheques,
} from "@/lib/admin/queries";
import { buscarContasFinanceiras } from "@/lib/admin/caixa";
import { FichaComprador } from "@/components/admin/FichaComprador";

export const dynamic = "force-dynamic";

export default async function FichaCompradorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [compradores, vendas, recebimentos, cheques, contasFin] =
    await Promise.all([
      buscarCompradores(),
      buscarVendas({ compradorId: id }),
      buscarRecebimentos(id),
      buscarCheques({ compradorId: id }),
      buscarContasFinanceiras(),
    ]);
  const opcoesConta = contasFin.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
  }));

  const comprador = compradores.find((c) => c.id === id);
  if (!comprador) notFound();

  return (
    <div>
      <Link
        href="/admin/compradores"
        className="text-sm text-cinza-suave hover:underline"
      >
        ← Compradores
      </Link>
      <h1 className="text-2xl font-bold mt-1 mb-1">{comprador.nome}</h1>
      <p className="text-sm text-cinza-suave mb-4">
        {[comprador.cidade, comprador.contato].filter(Boolean).join(" · ") || "—"}
      </p>

      <FichaComprador
        contas={opcoesConta}
        comprador={comprador}
        vendas={vendas}
        recebimentos={recebimentos}
        cheques={cheques}
      />
    </div>
  );
}
