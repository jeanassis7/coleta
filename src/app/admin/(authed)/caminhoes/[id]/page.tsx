import Link from "next/link";
import { notFound } from "next/navigation";
import { buscarCaminhoes, resolvePeriodo } from "@/lib/admin/queries";
import {
  buscarManutencoes,
  buscarDocumentos,
  kmAtualPorCaminhao,
  resumoCaminhao,
} from "@/lib/admin/frota";
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

  const [caminhoes, manutencoes, documentos, kmPorCaminhao, resumo] =
    await Promise.all([
      buscarCaminhoes(),
      buscarManutencoes({ caminhao_id: id }),
      buscarDocumentos({ caminhao_id: id }),
      kmAtualPorCaminhao(),
      resumoCaminhao(id, inicio, fim),
    ]);

  const caminhao = caminhoes.find((c) => c.id === id);
  if (!caminhao) notFound();

  const kmAtual = kmPorCaminhao.get(id) ?? null;

  // A troca de óleo que vale é a da MAIOR próxima_km: se houve três, a
  // última é a que manda.
  const proximaTroca = manutencoes
    .filter((m) => m.tipo === "troca_oleo" && m.proxima_km != null)
    .reduce<number | null>(
      (maior, m) => (maior == null || m.proxima_km! > maior ? m.proxima_km! : maior),
      null
    );
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

      {/* Próxima troca de óleo — o número que muda decisão */}
      {proximaTroca != null && (
        <div
          className={`card ${
            faltaKm != null && faltaKm < 0
              ? "border-alerta bg-alerta/5"
              : faltaKm != null && faltaKm <= 1000
                ? "border-amber-300 bg-amber-50"
                : ""
          }`}
        >
          <h2 className="text-lg font-semibold mb-1">Próxima troca de óleo</h2>
          <p className="text-sm">
            Marcada pra <strong>{proximaTroca.toLocaleString("pt-BR")} km</strong>
            {kmAtual == null ? (
              <span className="text-cinza-suave">
                {" "}
                — ainda não há km registrado pra este caminhão.
              </span>
            ) : faltaKm! < 0 ? (
              <span className="text-alerta font-bold">
                {" "}
                — já passou {Math.abs(faltaKm!).toLocaleString("pt-BR")} km.
              </span>
            ) : (
              <span> — faltam {faltaKm!.toLocaleString("pt-BR")} km.</span>
            )}
          </p>
        </div>
      )}

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
      />

      <ListaDocumentos
        documentos={documentos}
        dono={{ tipo: "caminhao", id }}
      />
    </div>
  );
}
