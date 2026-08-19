import {
  buscarVendas,
  buscarCompradores,
  buscarEstoque,
  buscarVeiculos,
} from "@/lib/admin/queries";
import { VendaPainel } from "@/components/admin/VendaPainel";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VendasPage() {

  const [vendas, compradores, estoque, veiculos] = await Promise.all([
    buscarVendas(),
    buscarCompradores(),
    buscarEstoque(),
    buscarVeiculos(),
  ]);

  const totalKg = vendas.reduce((s, v) => s + v.peso_total_kg, 0);
  const totalValor = vendas.reduce((s, v) => s + v.valor_total, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Vendas</h1>
      <p className="text-sm text-cinza-suave mb-4">
        O peso que vale é o da balança — é o que o comprador paga. O óleo sai
        do estoque na hora, e o que não for pago agora fica em aberto na conta
        do comprador.
      </p>

      {vendas.length > 0 && (
        <div className="card mb-4 flex flex-wrap gap-6">
          <div>
            <div className="text-xs text-cinza-suave">Vendas</div>
            <div className="text-xl font-bold">{vendas.length}</div>
          </div>
          <div>
            <div className="text-xs text-cinza-suave">Peso total</div>
            <div className="text-xl font-bold font-mono">
              {totalKg.toLocaleString("pt-BR")} kg
            </div>
          </div>
          <div>
            <div className="text-xs text-cinza-suave">Faturado</div>
            <div className="text-xl font-bold font-mono">{formatBRL(totalValor)}</div>
          </div>
          <div>
            <div className="text-xs text-cinza-suave">R$/kg médio</div>
            <div className="text-xl font-bold font-mono">
              {totalKg > 0
                ? `R$ ${(totalValor / totalKg).toFixed(2).replace(".", ",")}`
                : "—"}
            </div>
          </div>
        </div>
      )}

      <VendaPainel
        vendas={vendas}
        compradores={compradores}
        estoque={estoque}
        veiculos={veiculos}
      />
    </div>
  );
}
