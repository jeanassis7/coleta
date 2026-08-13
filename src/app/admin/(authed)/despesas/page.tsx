import {
  buscarDespesas,
  buscarMotoristas,
  buscarCaminhoes,
} from "@/lib/admin/queries";
import { TabelaDespesas } from "@/components/admin/TabelaDespesas";
import { FiltrosOperacao } from "@/components/admin/FiltrosOperacao";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ehDev } = await exigirAcessoModulo1OuRedirect();
  const params = await searchParams;

  const [despesas, motoristas, caminhoes] = await Promise.all([
    buscarDespesas({
      incluirTeste: ehDev,
      periodo: params.periodo,
      inicio: params.inicio,
      fim: params.fim,
      motorista: params.motorista,
      caminhao: params.caminhao,
    }),
    buscarMotoristas({ incluirTeste: ehDev }),
    buscarCaminhoes(),
  ]);

  const total = despesas.reduce((s, d) => s + d.valor, 0);
  const resumo = `${despesas.length} ${despesas.length === 1 ? "lançamento" : "lançamentos"} · ${formatBRL(total)}`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Despesas</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Tudo que o motorista gastou fora combustível (almoço, hotel, lavagem…),
        do mais recente pro mais antigo. Clique em 📷 pra ver o comprovante.
        Motoristas de teste aparecem só pra você (dev), marcados com 🧪.
      </p>

      <FiltrosOperacao
        motoristas={motoristas
          .filter((m) => m.role === "motorista")
          .map((m) => ({ id: m.id, nome: m.is_teste ? `${m.nome} 🧪` : m.nome }))}
        caminhoes={caminhoes.map((c) => ({
          id: c.id,
          nome: `${c.placa} ${c.marca}`,
        }))}
        resumo={resumo}
      />

      <TabelaDespesas despesas={despesas} />
    </div>
  );
}
