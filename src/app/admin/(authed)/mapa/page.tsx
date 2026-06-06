import nextDynamic from "next/dynamic";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  buscarColetas,
  buscarMotoristas,
  resolvePeriodo,
  type FiltrosDashboard,
} from "@/lib/admin/queries";
import { Filtros } from "@/components/admin/Filtros";
import type {
  PontoMapa,
  LocalAgregado,
  ColetaIndividual,
} from "@/components/admin/MapaAgregado";

const MapaAgregado = nextDynamic(
  () => import("@/components/admin/MapaAgregado"),
  {
    ssr: false,
    loading: () => (
      <div className="card text-center text-cinza-suave py-12">
        Carregando mapa...
      </div>
    ),
  }
);

export const dynamic = "force-dynamic";

export default async function MapaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const filtros: FiltrosDashboard = {
    periodo: (params.periodo as FiltrosDashboard["periodo"]) || "mes",
    inicio: params.inicio,
    fim: params.fim,
    motorista: params.motorista,
  };

  const supabase = await getSupabaseServer();
  const { inicio, fim } = resolvePeriodo(filtros);
  const [coletas, motoristas] = await Promise.all([
    buscarColetas(filtros),
    buscarMotoristas(),
  ]);

  const motoristasFiltro = motoristas.filter((m) => m.role === "motorista");

  const { data: locaisRaw } = await supabase
    .from("locais")
    .select("id, nome_canonico, latitude, longitude")
    .eq("ativo", true);

  const locaisPorId = new Map<
    string,
    { id: string; nome_canonico: string; latitude: number; longitude: number }
  >((locaisRaw || []).map((l) => [l.id, l]));

  // Agrega coletas por local_id e separa as soltas
  const agregadoLocal = new Map<
    string,
    {
      local_id: string;
      visitas: number;
      total_litros: number;
      total_pago: number;
      ultima_visita: string | null;
      motoristas: Map<string, number>;
    }
  >();
  const soltas: ColetaIndividual[] = [];

  for (const c of coletas) {
    const cAny = c as typeof c & { local_id: string | null };
    if (cAny.local_id && locaisPorId.has(cAny.local_id)) {
      const cur = agregadoLocal.get(cAny.local_id) || {
        local_id: cAny.local_id,
        visitas: 0,
        total_litros: 0,
        total_pago: 0,
        ultima_visita: null as string | null,
        motoristas: new Map<string, number>(),
      };
      cur.visitas += 1;
      cur.total_litros += Number(c.litros);
      cur.total_pago += Number(c.valor_pago);
      if (!cur.ultima_visita || c.criado_em > cur.ultima_visita) {
        cur.ultima_visita = c.criado_em;
      }
      const nomeMot = c.profiles?.nome || "—";
      cur.motoristas.set(nomeMot, (cur.motoristas.get(nomeMot) || 0) + 1);
      agregadoLocal.set(cAny.local_id, cur);
    } else if (c.gps_capturado && c.latitude && c.longitude) {
      soltas.push({
        tipo: "coleta",
        coleta_id: c.id,
        local_nome: c.local_nome,
        motorista_id: c.motorista_id,
        motorista_nome: c.profiles?.nome || "—",
        latitude: c.latitude,
        longitude: c.longitude,
        litros: Number(c.litros),
        valor_pago: Number(c.valor_pago),
        criado_em: c.criado_em,
      });
    }
  }

  const pontos: PontoMapa[] = [];
  for (const [, agg] of agregadoLocal.entries()) {
    const l = locaisPorId.get(agg.local_id);
    if (!l) continue;
    const ponto: LocalAgregado = {
      tipo: "local",
      local_id: l.id,
      nome_canonico: l.nome_canonico,
      latitude: l.latitude,
      longitude: l.longitude,
      visitas: agg.visitas,
      total_litros: agg.total_litros,
      total_pago: agg.total_pago,
      ultima_visita: agg.ultima_visita,
      motoristas_lista: Array.from(agg.motoristas.entries())
        .map(([nome, visitas]) => ({ nome, visitas }))
        .sort((a, b) => b.visitas - a.visitas),
    };
    pontos.push(ponto);
  }
  for (const s of soltas) pontos.push(s);

  const motoristasUnicosSet = new Set(soltas.map((s) => s.motorista_id));
  const motoristasUnicos = Array.from(motoristasUnicosSet).map((id) => ({
    id,
    nome: motoristas.find((m) => m.id === id)?.nome || "—",
  }));

  const totalCurados = pontos.filter((p) => p.tipo === "local").length;
  const totalSoltas = soltas.length;
  const periodoStr =
    filtros.periodo === "hoje"
      ? "hoje"
      : filtros.periodo === "semana"
      ? "última semana"
      : filtros.periodo === "mes"
      ? "este mês"
      : `${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Mapa de coletas</h1>
      <Filtros motoristas={motoristasFiltro} />

      <div className="card mb-4">
        <p className="text-sm">
          <strong>{totalCurados}</strong> locais cadastrados aparecem com badge
          de visitas. <strong>{totalSoltas}</strong> coletas soltas (sem vínculo
          a um local) aparecem como pin individual colorido por motorista.
          Período: {periodoStr}.
        </p>
        {totalSoltas > 0 && (
          <p className="text-sm text-atencao mt-2">
            💡 Tem {totalSoltas} coletas soltas no período — vá em{" "}
            <a href="/admin/curadoria" className="underline font-medium">
              Curadoria
            </a>{" "}
            pra vincular elas a locais cadastrados.
          </p>
        )}
      </div>

      <MapaAgregado pontos={pontos} motoristasUnicos={motoristasUnicos} />
    </div>
  );
}
