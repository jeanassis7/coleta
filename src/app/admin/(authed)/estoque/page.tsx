import {
  buscarEstoque,
  buscarMovimentosEstoque,
  buscarAjustesEstoque,
} from "@/lib/admin/queries";
import { EstoquePainel } from "@/components/admin/EstoquePainel";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  await exigirAcessoModulo1OuRedirect();

  const [estoque, movimentos, ajustes] = await Promise.all([
    buscarEstoque(),
    buscarMovimentosEstoque(),
    buscarAjustesEstoque(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Estoque</h1>
      <p className="text-sm text-cinza-suave mb-4">
        O estoque é <strong>calculado</strong>, não digitado: as descargas dos
        motoristas e as compras diretas entram sozinhas. O inventário serve pra
        alinhar com o que existe de verdade no tanque — e a diferença fica
        registrada em kg e em reais.
      </p>

      <EstoquePainel
        estoque={estoque}
        movimentos={movimentos}
        ajustes={ajustes}
      />
    </div>
  );
}
