import { getSupabaseServer } from "@/lib/supabase/server";
import { buscarMotoristas } from "@/lib/admin/queries";
import { formatBRL, formatDataHora, formatLitros } from "@/lib/format";

export const dynamic = "force-dynamic";

interface ColetaObs {
  id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  valor_pago: number;
  observacao: string;
  criado_em: string;
  profiles: { nome: string } | null;
}

export default async function ObservacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const motoristaId = params.motorista || "todos";

  const supabase = await getSupabaseServer();
  let q = supabase
    .from("coletas")
    .select(
      "id, motorista_id, litros, local_nome, valor_pago, observacao, criado_em, profiles!coletas_motorista_id_fkey(nome)"
    )
    .not("observacao", "is", null)
    .neq("observacao", "")
    .order("criado_em", { ascending: false })
    .limit(500);

  if (motoristaId !== "todos") {
    q = q.eq("motorista_id", motoristaId);
  }

  const { data } = await q;
  const coletas = (data as unknown as ColetaObs[]) || [];

  const motoristas = await buscarMotoristas();
  const motoristasFiltro = motoristas.filter((m) => m.role === "motorista");

  function linkMotorista(id: string) {
    const p = new URLSearchParams();
    p.set("motorista", id);
    return `?${p.toString()}`;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Observações dos motoristas</h1>
      <p className="text-cinza-suave mb-6">
        Todas as coletas que o motorista deixou observação. Use pra ver de uma vez
        sem precisar abrir uma por uma.
      </p>

      <div className="card mb-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-cinza-suave mr-2">
          Motorista:
        </span>
        <a
          href={linkMotorista("todos")}
          className={`px-3 py-1 rounded-xl text-sm ${
            motoristaId === "todos"
              ? "bg-verde text-white"
              : "bg-slate-100"
          }`}
        >
          Todos
        </a>
        {motoristasFiltro.map((m) => (
          <a
            key={m.id}
            href={linkMotorista(m.id)}
            className={`px-3 py-1 rounded-xl text-sm ${
              motoristaId === m.id
                ? "bg-verde text-white"
                : "bg-slate-100"
            }`}
          >
            {m.nome}
          </a>
        ))}
      </div>

      {coletas.length === 0 ? (
        <div className="card text-center text-cinza-suave py-12">
          Nenhuma observação encontrada.
        </div>
      ) : (
        <>
          <p className="text-sm text-cinza-suave mb-3">
            {coletas.length} observa{coletas.length === 1 ? "ção" : "ções"} encontradas.
          </p>
          <div className="space-y-3">
            {coletas.map((c) => (
              <div key={c.id} className="card">
                <div className="flex justify-between items-baseline flex-wrap gap-2 mb-2">
                  <div>
                    <span className="font-semibold">{c.profiles?.nome || "—"}</span>
                    <span className="text-cinza-suave"> · {c.local_nome}</span>
                  </div>
                  <span className="text-sm text-cinza-suave">
                    {formatDataHora(c.criado_em)}
                  </span>
                </div>
                <div className="bg-slate-50 border-l-4 border-verde p-3 rounded-r-xl mb-2">
                  <p className="text-base whitespace-pre-wrap">{c.observacao}</p>
                </div>
                <div className="text-sm text-cinza-suave">
                  {formatLitros(c.litros)} · {formatBRL(c.valor_pago)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
