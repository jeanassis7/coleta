import Link from "next/link";
import { notFound } from "next/navigation";
import { formatData } from "@/lib/format";
import { buscarCaminhoes, resolvePeriodo } from "@/lib/admin/queries";
import {
  buscarManutencoes,
  buscarDocumentos,
  kmAtualPorCaminhao,
  resumoCaminhao,
} from "@/lib/admin/frota";
import { buscarContasFinanceiras } from "@/lib/admin/caixa";
import { HistoricoManutencao } from "@/components/admin/HistoricoManutencao";
import { ListaDocumentos } from "@/components/admin/ListaDocumentos";

export const dynamic = "force-dynamic";

const real = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

export default async function FichaCaminhaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { inicio, fim } = resolvePeriodo({ periodo: "mes" });

  const [caminhoes, manutencoes, documentos, kmPorCaminhao, resumo, contas] =
    await Promise.all([
      buscarCaminhoes(),
      buscarManutencoes({ caminhao_id: id }),
      buscarDocumentos({ caminhao_id: id }),
      kmAtualPorCaminhao(),
      resumoCaminhao(id, inicio, fim),
      buscarContasFinanceiras(),
    ]);

  const caminhao = caminhoes.find((c) => c.id === id);
  if (!caminhao) notFound();

  const kmAtual = kmPorCaminhao.get(id) ?? null;

  // A troca de óleo que vale é a MAIS RECENTE lançada — é ela que carrega o
  // alvo atual, por km e/ou por data (o que vencer primeiro manda).
  const ultimaTroca = manutencoes
    .filter(
      (m) => m.tipo === "troca_oleo" && (m.proxima_km != null || m.proxima_data != null)
    )
    .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))[0];
  const proximaTroca = ultimaTroca?.proxima_km ?? null;
  const proximaTrocaData = ultimaTroca?.proxima_data ?? null;
  const faltaKm =
    proximaTroca != null && kmAtual != null ? proximaTroca - kmAtual : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/caminhoes"
          className="text-sm text-cinza-suave hover:underline"
        >
          ← Caminhões
        </Link>
        <h1 className="text-2xl font-bold mt-1">
          {caminhao.placa}{" "}
          <span className="text-cinza-suave font-normal text-lg">
            {caminhao.marca} {caminhao.modelo || ""}
          </span>
        </h1>
        <p className="text-sm text-cinza-suave">
          {[
            caminhao.tipo === "carro" ? "Carro" : "Caminhão",
            caminhao.cor,
            caminhao.de_quem,
            kmAtual != null ? `${kmAtual.toLocaleString("pt-BR")} km` : null,
            caminhao.ativo ? null : "INATIVO",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Próxima troca de óleo — o número que muda decisão. Vence pelo que
          vier primeiro: km OU data (0043). */}
      {(proximaTroca != null || proximaTrocaData != null) && (() => {
        const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        const passouData = proximaTrocaData != null && hojeBr > proximaTrocaData;
        const vencida = (faltaKm != null && faltaKm < 0) || passouData;
        const quase = !vencida && faltaKm != null && faltaKm <= 1000;
        return (
          <div
            className={`card ${
              vencida ? "border-alerta bg-alerta/5" : quase ? "border-amber-300 bg-amber-50" : ""
            }`}
          >
            <h2 className="text-lg font-semibold mb-1">Próxima troca de óleo</h2>
            <p className="text-sm">
              {proximaTroca != null && (
                <>
                  Marcada pra <strong>{proximaTroca.toLocaleString("pt-BR")} km</strong>
                  {kmAtual == null ? (
                    <span className="text-cinza-suave">
                      {" "}
                      — ainda não há km registrado pra este caminhão
                    </span>
                  ) : faltaKm! < 0 ? (
                    <span className="text-alerta font-bold">
                      {" "}
                      — já passou {Math.abs(faltaKm!).toLocaleString("pt-BR")} km
                    </span>
                  ) : (
                    <span> — faltam {faltaKm!.toLocaleString("pt-BR")} km</span>
                  )}
                </>
              )}
              {proximaTroca != null && proximaTrocaData != null && " · "}
              {proximaTrocaData != null && (
                <>
                  {proximaTroca != null ? "ou até " : "Marcada pra até "}
                  <strong>{formatData(proximaTrocaData)}</strong>
                  {passouData && (
                    <span className="text-alerta font-bold"> — já passou</span>
                  )}
                </>
              )}
              .
            </p>
          </div>
        );
      })()}

      {/* Consumo e gasto no mês */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Este mês</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-cinza-suave">Km rodado</div>
            <div className="text-xl font-bold">
              {resumo.km_rodado.toLocaleString("pt-BR")}
            </div>
          </div>
          <div>
            <div className="text-cinza-suave">Consumo</div>
            <div className="text-xl font-bold">
              {resumo.km_por_litro != null
                ? `${resumo.km_por_litro.toFixed(2)} km/L`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-cinza-suave">Combustível</div>
            <div className="text-xl font-bold">
              R$ {real(resumo.gasto_combustivel)}
            </div>
          </div>
          <div>
            <div className="text-cinza-suave">Manutenção</div>
            <div className="text-xl font-bold">
              R$ {real(resumo.gasto_manutencao)}
            </div>
          </div>
        </div>
        <p className="text-sm text-cinza-suave mt-3">
          Gasto total no mês (combustível + manutenção + despesas):{" "}
          <strong className="text-preto">R$ {real(resumo.gasto_total)}</strong>
        </p>
      </div>

      <HistoricoManutencao
        manutencoes={manutencoes}
        caminhaoId={id}
        kmAtual={kmAtual}
        contas={contas}
      />

      <ListaDocumentos
        documentos={documentos}
        dono={{ tipo: "caminhao", id }}
      />
    </div>
  );
}
