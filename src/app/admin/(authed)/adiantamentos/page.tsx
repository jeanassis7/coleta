import { buscarMotoristas, buscarMotoristasComSaldo } from "@/lib/admin/queries";
import { AdiantamentosPanel } from "@/components/admin/AdiantamentosPanel";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function AdiantamentosPage() {
  const { ehDev } = await exigirAcessoModulo1OuRedirect();
  // Dev vê (e pode adiantar pra) motoristas de teste; admin nunca vê.
  const [saldos, motoristas] = await Promise.all([
    buscarMotoristasComSaldo({ incluirTeste: ehDev }),
    buscarMotoristas({ incluirTeste: ehDev }),
  ]);
  const motoristasReais = motoristas
    .filter((m) => m.role === "motorista" && m.ativo)
    .map((m) => ({ id: m.id, nome: m.is_teste ? `${m.nome} 🧪` : m.nome }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Adiantamentos</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Envia dinheiro pro motorista (dinheiro ou PIX). Ele aceita ou pula no app dele.
        Só count no saldo quando aceito. Faz acerto quando fechar o ciclo.
      </p>
      <AdiantamentosPanel motoristas={motoristasReais} saldos={saldos} />
    </div>
  );
}
