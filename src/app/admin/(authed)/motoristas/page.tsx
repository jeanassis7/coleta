import { buscarMotoristas } from "@/lib/admin/queries";
import { TabelaMotoristas } from "@/components/admin/TabelaMotoristas";
import { FormCriarMotorista } from "@/components/admin/FormCriarMotorista";

export const dynamic = "force-dynamic";

export default async function MotoristasPage() {
  const motoristas = await buscarMotoristas();

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Motoristas</h1>
        <FormCriarMotorista />
      </div>
      <TabelaMotoristas motoristas={motoristas} />
    </div>
  );
}
