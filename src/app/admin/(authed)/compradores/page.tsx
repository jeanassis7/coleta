import { buscarCompradores } from "@/lib/admin/queries";
import { CompradoresPainel } from "@/components/admin/CompradoresPainel";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function CompradoresPage() {
  await exigirAcessoModulo1OuRedirect();
  const compradores = await buscarCompradores();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Compradores</h1>
      <p className="text-sm text-cinza-suave mb-4">
        As fundições pra quem o óleo é vendido. O saldo é uma{" "}
        <strong>conta corrente</strong>: a venda debita, o pagamento credita.
        Pode ficar a favor dele quando paga a mais.
      </p>
      <CompradoresPainel compradores={compradores} />
    </div>
  );
}
