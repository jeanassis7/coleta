import { buscarCargas } from "@/lib/admin/queries";
import { TabelaCargas } from "@/components/admin/TabelaCargas";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function CargasPage() {
  await exigirAcessoModulo1OuRedirect();
  const cargas = await buscarCargas();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Cargas</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Todas as cargas dos motoristas (ativas, encerradas e canceladas). Motoristas
        de teste ficam invisíveis por padrão. Clique nas colunas pra ordenar.
      </p>
      <TabelaCargas cargas={cargas} />
    </div>
  );
}
