import { buscarDescargas } from "@/lib/admin/queries";
import { TabelaDescargas } from "@/components/admin/TabelaDescargas";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function DescarregamentosPage() {
  await exigirAcessoModulo1OuRedirect();
  const descargas = await buscarDescargas();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Descarregamentos</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Todas as descargas registradas. Motoristas de teste ficam invisíveis por
        padrão. Lance a umidade quando testar (fica opcional).
      </p>
      <TabelaDescargas descargas={descargas} />
    </div>
  );
}
