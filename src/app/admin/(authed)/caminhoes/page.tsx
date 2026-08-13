import { buscarCaminhoes } from "@/lib/admin/queries";
import { FormCaminhao } from "@/components/admin/FormCaminhao";
import { TabelaCaminhoes } from "@/components/admin/TabelaCaminhoes";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function CaminhoesPage() {
  await exigirAcessoModulo1OuRedirect();
  const caminhoes = await buscarCaminhoes();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Caminhões</h1>
      <FormCaminhao />
      <TabelaCaminhoes caminhoes={caminhoes} />
    </div>
  );
}
