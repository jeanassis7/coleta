import { buscarAbastecimentos } from "@/lib/admin/queries";
import { TabelaAbastecimentos } from "@/components/admin/TabelaAbastecimentos";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function AbastecimentosPage() {
  const { ehDev } = await exigirAcessoModulo1OuRedirect();
  const abastecimentos = await buscarAbastecimentos({ incluirTeste: ehDev });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Abastecimentos</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Todos os abastecimentos, mais recente primeiro. Se o motorista lançou
        errado mesmo com o antiburro, edite aqui. Motoristas de teste aparecem
        só pra você (dev), marcados com 🧪.
      </p>
      <TabelaAbastecimentos abastecimentos={abastecimentos} />
    </div>
  );
}
