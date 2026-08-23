import { buscarMotoristasComEmail } from "@/lib/admin/queries";
import { TabelaMotoristas } from "@/components/admin/TabelaMotoristas";
import { FormCriarMotorista } from "@/components/admin/FormCriarMotorista";

export const dynamic = "force-dynamic";

export default async function MotoristasPage() {
  const motoristas = await buscarMotoristasComEmail();

  return (
    <div>
      <div className="flex justify-between items-center mb-2 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Motoristas</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="/admin/features"
            className="px-4 py-2 rounded-xl border border-cinza-borda text-sm font-medium hover:border-verde hover:text-verde"
          >
            ⚙️ O que cada recurso faz
          </a>
          <FormCriarMotorista />
        </div>
      </div>
      <p className="text-sm text-cinza-suave mb-6">
        Quem entra no aplicativo, e o que cada um enxerga no celular. Os
        toggles ficam todos aqui — <strong>passe o mouse em cima</strong> de
        qualquer um pra ver o que ele faz na prática. Recurso novo nasce
        desligado: ligue em um motorista, acompanhe alguns dias, depois
        estenda.
      </p>
      <TabelaMotoristas motoristas={motoristas} />
    </div>
  );
}
