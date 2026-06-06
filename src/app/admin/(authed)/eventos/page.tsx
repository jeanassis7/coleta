import { getSupabaseServer } from "@/lib/supabase/server";
import { buscarMotoristas } from "@/lib/admin/queries";
import { formatDataHora } from "@/lib/format";

export const dynamic = "force-dynamic";

const TIPOS = [
  { key: "todos", label: "Todos" },
  { key: "gps_timeout", label: "GPS timeout" },
  { key: "gps_denied", label: "GPS negado" },
  { key: "gps_error", label: "GPS erro" },
  { key: "sync_failure", label: "Falha de sync" },
  { key: "login", label: "Login" },
  { key: "logout", label: "Logout" },
  { key: "app_install", label: "Instalação" },
  { key: "foto_toggle_changed", label: "Toggle foto" },
];

export default async function EventosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const tipo = params.tipo || "todos";
  const motoristaId = params.motorista || "todos";

  const supabase = await getSupabaseServer();
  let q = supabase
    .from("app_events")
    .select("*, profiles!app_events_motorista_id_fkey(nome)")
    .order("criado_em", { ascending: false })
    .limit(500);

  if (tipo !== "todos") q = q.eq("event_type", tipo);
  if (motoristaId !== "todos") q = q.eq("motorista_id", motoristaId);

  const { data: eventos } = await q;
  const motoristas = await buscarMotoristas();

  // Filtros: mantém querystring
  function linkParam(key: string, value: string) {
    const p = new URLSearchParams();
    p.set("tipo", key === "tipo" ? value : tipo);
    p.set("motorista", key === "motorista" ? value : motoristaId);
    return `?${p.toString()}`;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Eventos do App</h1>

      <div className="card mb-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="text-sm font-medium text-cinza-suave mr-2 self-center">
            Tipo:
          </span>
          {TIPOS.map((t) => (
            <a
              key={t.key}
              href={linkParam("tipo", t.key)}
              className={`px-3 py-1 rounded-xl text-sm ${
                tipo === t.key
                  ? "bg-verde text-white"
                  : "bg-slate-100 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-medium text-cinza-suave mr-2">
            Motorista:
          </span>
          <a
            href={linkParam("motorista", "todos")}
            className={`px-3 py-1 rounded-xl text-sm ${
              motoristaId === "todos"
                ? "bg-verde text-white"
                : "bg-slate-100"
            }`}
          >
            Todos
          </a>
          {motoristas.map((m) => (
            <a
              key={m.id}
              href={linkParam("motorista", m.id)}
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
      </div>

      {!eventos || eventos.length === 0 ? (
        <div className="card text-center text-cinza-suave py-12">
          Nenhum evento encontrado.
        </div>
      ) : (
        <div className="space-y-2">
          {eventos.map((e: any) => (
            <div key={e.id} className="card">
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-1 bg-slate-100 rounded font-mono">
                      {e.event_type}
                    </span>
                    <span className="text-sm text-cinza-suave">
                      {formatDataHora(e.criado_em)}
                    </span>
                    {e.profiles?.nome && (
                      <span className="text-sm font-medium">
                        {e.profiles.nome}
                      </span>
                    )}
                  </div>
                  {e.payload && Object.keys(e.payload).length > 0 && (
                    <pre className="text-xs bg-slate-50 rounded p-2 overflow-x-auto mt-2">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  )}
                </div>
                {e.app_version && (
                  <span className="text-xs text-cinza-suave">
                    v{e.app_version}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
