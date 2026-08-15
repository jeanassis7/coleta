import {
  buscarAbastecimentos,
  buscarMotoristas,
  buscarCaminhoes,
} from "@/lib/admin/queries";
import { TabelaAbastecimentos } from "@/components/admin/TabelaAbastecimentos";
import { FiltrosOperacao } from "@/components/admin/FiltrosOperacao";
import { ExportCsv } from "@/components/admin/ExportCsv";
import { BotaoLancamentoAvulso } from "@/components/admin/BotaoLancamentoAvulso";
import { exigirAcessoModulo1OuRedirect } from "@/lib/auth/gate-modulo1";
import { formatBRL, formatDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AbastecimentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ehDev } = await exigirAcessoModulo1OuRedirect();
  const params = await searchParams;

  const [abastecimentos, motoristas, caminhoes] = await Promise.all([
    buscarAbastecimentos({
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

  const total = abastecimentos.reduce((s, a) => s + a.valor, 0);
  const litros = abastecimentos.reduce((s, a) => s + a.litros, 0);
  const precoMedio = litros > 0 ? total / litros : 0;
  const resumo =
    `${abastecimentos.length} ${abastecimentos.length === 1 ? "abastecimento" : "abastecimentos"} · ` +
    `${litros.toLocaleString("pt-BR")} L · ${formatBRL(total)}` +
    (litros > 0 ? ` · média ${formatBRL(precoMedio)}/L` : "");

  const linhasCsv = abastecimentos.map((a) => ({
    data: formatDataHora(a.criado_em),
    motorista: a.motorista_nome,
    caminhao: a.caminhao_placa,
    posto: a.posto_nome,
    litros: a.litros.toFixed(2),
    valor: a.valor.toFixed(2),
    preco_por_litro: a.litros > 0 ? (a.valor / a.litros).toFixed(2) : "",
    km: a.km_atual,
    tem_foto: a.foto_path ? "sim" : "não",
  }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold">Abastecimentos</h1>
        <div className="flex gap-2">
          <BotaoLancamentoAvulso
            veiculos={caminhoes.filter((c) => c.ativo)}
            tipoInicial="abastecimento"
          />
          <ExportCsv linhas={linhasCsv} nomeArquivo="abastecimentos" />
        </div>
      </div>
      <p className="text-sm text-cinza-suave mb-4">
        Todos os abastecimentos, do mais recente pro mais antigo. Clique em 📷 pra
        ver o cupom. Se o motorista lançou errado mesmo com o antiburro, dá pra
        editar ou apagar. Motoristas de teste aparecem só pra você (dev), com 🧪.
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

      <TabelaAbastecimentos abastecimentos={abastecimentos} />
    </div>
  );
}
