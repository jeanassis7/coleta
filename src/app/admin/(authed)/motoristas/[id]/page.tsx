import Link from "next/link";
import { notFound } from "next/navigation";
import { buscarMotoristas, buscarCaminhoes } from "@/lib/admin/queries";
import { buscarDocumentos } from "@/lib/admin/frota";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ListaDocumentos } from "@/components/admin/ListaDocumentos";
import { PlacasDoMotorista } from "@/components/admin/PlacasDoMotorista";
import { formatData } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FichaMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const [perfis, documentos, caminhoes, { data: atribuicoes }] =
    await Promise.all([
      buscarMotoristas(),
      buscarDocumentos({ motorista_id: id }),
      buscarCaminhoes(),
      supabase
        .from("motorista_caminhoes")
        .select("caminhao_id")
        .eq("motorista_id", id),
    ]);

  const pessoa = perfis.find((p) => p.id === id);
  if (!pessoa) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/motoristas"
          className="text-sm text-cinza-suave hover:underline"
        >
          ← Motoristas
        </Link>
        <h1 className="text-2xl font-bold mt-1">{pessoa.nome}</h1>
        <p className="text-sm text-cinza-suave">
          {[
            pessoa.role,
            pessoa.ativo ? null : "INATIVO",
            `cadastrado em ${formatData(pessoa.criado_em)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <ListaDocumentos
        documentos={documentos}
        dono={{ tipo: "motorista", id }}
      />

      {pessoa.role === "motorista" && (
        <PlacasDoMotorista
          motoristaId={id}
          caminhoes={caminhoes
            .filter((c) => c.ativo && c.tipo !== "carro")
            .map((c) => ({ id: c.id, placa: c.placa, marca: c.marca }))}
          atribuidos={((atribuicoes as { caminhao_id: string }[]) ?? []).map(
            (a) => a.caminhao_id
          )}
        />
      )}

      {/* O histórico de dinheiro já tem tela própria — link em vez de cópia:
          duas telas mostrando a mesma conta é uma que um dia diverge. */}
      {pessoa.role === "motorista" && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Dinheiro</h2>
          <p className="text-sm text-cinza-suave mb-3">
            Adiantamentos, acertos e o saldo atual ficam na tela de
            adiantamentos.
          </p>
          <Link
            href={`/admin/adiantamentos/${id}`}
            className="text-verde hover:underline text-sm"
          >
            Ver histórico de dinheiro de {pessoa.nome} →
          </Link>
        </div>
      )}
    </div>
  );
}
