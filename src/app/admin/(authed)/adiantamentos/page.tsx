import { buscarMotoristas, buscarMotoristasComSaldo } from "@/lib/admin/queries";
import { AdiantamentosPanel } from "@/components/admin/AdiantamentosPanel";

export const dynamic = "force-dynamic";

export default async function AdiantamentosPage() {
  const [saldos, motoristas] = await Promise.all([
    buscarMotoristasComSaldo(),
    buscarMotoristas(),
  ]);
  const motoristasReais = motoristas
    .filter((m) => m.role === "motorista" && m.ativo)
    .map((m) => ({ id: m.id, nome: m.nome }));

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
