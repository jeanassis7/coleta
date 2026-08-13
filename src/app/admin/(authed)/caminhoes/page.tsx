import { buscarCaminhoes } from "@/lib/admin/queries";
import { FormCaminhao } from "@/components/admin/FormCaminhao";
import { TabelaCaminhoes } from "@/components/admin/TabelaCaminhoes";

export const dynamic = "force-dynamic";

export default async function CaminhoesPage() {
  const caminhoes = await buscarCaminhoes();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Caminhões</h1>
      <FormCaminhao />
      <TabelaCaminhoes caminhoes={caminhoes} />
    </div>
  );
}
