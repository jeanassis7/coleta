import { buscarSaldoDividas } from "@/lib/admin/caixa";
import { DividasPainel } from "@/components/admin/DividasPainel";

export const dynamic = "force-dynamic";

export default async function DividasPage() {
  const dividas = await buscarSaldoDividas();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Dívidas</h1>
      <p className="text-sm text-cinza-suave mb-6">
        O que a empresa <strong>deve</strong> — o outro lado do{" "}
        <a href="/admin/caixa" className="text-verde hover:underline">
          Caixa
        </a>
        . O saldo de cada uma cai sozinho quando você lança um pagamento em{" "}
        <strong>Pagamento de dívidas</strong> e diz qual dívida ele abate.
        Nada aqui mexe no DRE: o gasto conta no dia em que o dinheiro sai,
        como sempre.
      </p>

      <DividasPainel dividas={dividas} />
    </div>
  );
}
