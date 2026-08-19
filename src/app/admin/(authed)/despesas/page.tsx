import {
  buscarDespesas,
  buscarMotoristas,
  buscarCaminhoes,
} from "@/lib/admin/queries";
import { TabelaDespesas } from "@/components/admin/TabelaDespesas";
import { FiltrosOperacao } from "@/components/admin/FiltrosOperacao";
import { ExportCsv } from "@/components/admin/ExportCsv";
import { BotaoLancamentoAvulso } from "@/components/admin/BotaoLancamentoAvulso";
import { formatBRL, formatDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const [despesas, motoristas, caminhoes] = await Promise.all([
    buscarDespesas({
      periodo: params.periodo,
      inicio: params.inicio,
      fim: params.fim,
      motorista: params.motorista,
      caminhao: params.caminhao,
    }),
    buscarMotoristas(),
    buscarCaminhoes(),
  ]);

  const total = despesas.reduce((s, d) => s + d.valor, 0);
  const resumo = `${despesas.length} ${despesas.length === 1 ? "lançamento" : "lançamentos"} · ${formatBRL(total)}`;

  const linhasCsv = despesas.map((d) => ({
    data: formatDataHora(d.criado_em),
    motorista: d.motorista_nome,
    caminhao: d.caminhao_placa,
    descricao: d.descricao,
    valor: d.valor.toFixed(2),
    tem_foto: d.foto_path ? "sim" : "não",
  }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold">Despesas</h1>
        <div className="flex gap-2">
          <BotaoLancamentoAvulso
            veiculos={caminhoes.filter((c) => c.ativo)}
            tipoInicial="despesa"
          />
          <ExportCsv linhas={linhasCsv} nomeArquivo="despesas" />
        </div>
      </div>
      <p className="text-sm text-cinza-suave mb-4">
        Tudo que o motorista gastou fora combustível (almoço, hotel, lavagem…),
        do mais recente pro mais antigo. Clique em 📷 pra ver o comprovante.
        Motoristas de teste aparecem só pra você (dev), marcados com 🧪.
      </p>

      <FiltrosOperacao
        motoristas={motoristas
          .filter((m) => m.role === "motorista")
          .map((m) => ({ id: m.id, nome: m.nome }))}
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
