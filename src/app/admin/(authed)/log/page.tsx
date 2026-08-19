import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { buscarLog, buscarAtoresDoLog } from "@/lib/admin/queries";
import { LogPainel } from "@/components/admin/LogPainel";

export const dynamic = "force-dynamic";

const TABELAS_FILTRO = [
  "coletas",
  "vendas",
  "recebimentos",
  "cheques",
  "contas_a_pagar",
  "adiantamentos",
  "acertos",
  "ajustes_estoque",
  "compras_diretas",
  "despesas",
  "abastecimentos",
  "caminhoes",
  "compradores",
  "locais",
  "profiles",
];

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Gate próprio: `ve_log` no cadastro, NÃO o papel. Assim o dia em que o
  // papel `dev` for aposentado, o acesso ao log não vai junto.
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: perfil } = await supabase
    .from("profiles")
    .select("ve_log, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!perfil?.ve_log || !perfil.ativo) redirect("/admin");

  const params = await searchParams;
  const [grupos, atores] = await Promise.all([
    buscarLog({ ator: params.ator, tabela: params.tabela }),
    buscarAtoresDoLog(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Log do painel</h1>
      <p className="text-sm text-cinza-suave mb-4">
        Quem alterou o quê, com data e hora. Só entra o que foi feito{" "}
        <strong>pelo painel</strong> — a sincronização do celular do motorista
        fica de fora, senão as ações de vocês sumiriam no meio de centenas de
        coletas. Cada clique aparece como uma entrada, mesmo quando mexe em
        vários registros de uma vez.
      </p>
      <LogPainel
        grupos={grupos}
        atores={atores}
        tabelas={TABELAS_FILTRO}
        filtroAtor={params.ator}
        filtroTabela={params.tabela}
      />
    </div>
  );
}
