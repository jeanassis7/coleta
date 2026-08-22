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
            ⚙️ Liberar recursos no app
          </a>
          <FormCriarMotorista />
        </div>
      </div>
      <p className="text-sm text-cinza-suave mb-6">
        Quem entra no aplicativo. <strong>Liberar recursos</strong> é onde se
        liga carga, saldo e as demais telas no celular de cada um — um
        motorista de cada vez.
      </p>
      <TabelaMotoristas motoristas={motoristas} />
    </div>
  );
}
