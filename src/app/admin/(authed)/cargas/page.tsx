import { buscarCargas } from "@/lib/admin/queries";
import { TabelaCargas } from "@/components/admin/TabelaCargas";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function CargasPage() {
  const { ehDev } = await exigirAcessoModulo1OuRedirect();
  // Dev vê cargas de motorista de teste (com badge 🧪); admin nunca vê.
  const cargas = await buscarCargas({ incluirTeste: ehDev });
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Cargas</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Todas as cargas dos motoristas (ativas, encerradas e canceladas).
        Motoristas de teste aparecem só pra você (dev), marcados com 🧪 — o
        admin não vê. Clique nas colunas pra ordenar.
      </p>
      <TabelaCargas cargas={cargas} />
    </div>
  );
}
