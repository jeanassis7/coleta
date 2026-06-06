import { buscarColetasSemLocal, agruparEmClusters } from "@/lib/admin/curadoria";
import { getSupabaseServer } from "@/lib/supabase/server";
import { ClusterCard } from "@/components/admin/ClusterCard";
import type { LocalComStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CuradoriaPage() {
  const coletasSemLocal = await buscarColetasSemLocal();
  const clusters = agruparEmClusters(coletasSemLocal);

  const supabase = await getSupabaseServer();
  const { data: locaisRaw } = await supabase
    .from("locais_com_stats")
    .select("*")
    .eq("ativo", true)
    .order("total_visitas", { ascending: false });

  const locaisExistentes = (locaisRaw as LocalComStats[]) || [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Curadoria de locais</h1>
      <p className="text-cinza-suave mb-6">
        Coletas que ainda não foram vinculadas a um local canônico. Agrupadas por
        proximidade GPS (80m) ou nome equivalente. Crie um local pra cada cluster
        — depois disso os motoristas verão como sugestão automática nas próximas
        coletas no mesmo lugar.
      </p>

      {clusters.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-cinza-suave text-lg">
            🎉 Tudo curado! Nenhuma coleta órfã no momento.
          </p>
          <p className="text-cinza-suave text-sm mt-2">
            Volta aqui depois que os motoristas fizerem novas coletas em locais não cadastrados.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 text-sm text-cinza-suave">
            {clusters.length} {clusters.length === 1 ? "cluster" : "clusters"} ·{" "}
            {coletasSemLocal.length} coletas pendentes
          </div>
          <div className="space-y-3">
            {clusters.map((c) => (
              <ClusterCard
                key={c.id}
                cluster={c}
                locaisExistentes={locaisExistentes}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
