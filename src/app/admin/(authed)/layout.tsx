import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { podeAcessarAdmin } from "@/lib/auth/roles";
import { Sidebar } from "@/components/admin/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, role, ativo, ve_log")
    .eq("id", user.id)
    .maybeSingle();

  // `ativo` entra aqui de propósito: antes só o middleware checava, então
  // esta camada confiava numa checagem que vive em outro arquivo.
  if (!profile || !profile.ativo || !podeAcessarAdmin(profile)) {
    redirect("/admin/login?erro=acesso");
  }

  // O log é por marca no cadastro, não por papel. Hoje `admin` é o único
  // papel do painel — capacidade extra vira COLUNA, nunca papel novo.
  const veLog = !!(profile as { ve_log?: boolean }).ve_log;

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <Sidebar nome={profile.nome} veLog={veLog} />
      <main className="flex-1 min-w-0 px-4 py-6 md:px-6 print:p-0">
        {children}
      </main>
    </div>
  );
}
