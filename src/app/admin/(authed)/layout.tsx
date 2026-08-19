import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { podeAcessarAdmin, isDev } from "@/lib/auth/roles";
import { MODULO1_LIBERADO_PARA_ADMIN } from "@/lib/auth/gate-modulo1";
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
    .select("nome, role, ve_log")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !podeAcessarAdmin(profile)) {
    redirect("/admin/login?erro=acesso");
  }

  const dev = isDev(profile);
  // O log é por marca no cadastro, não por papel — quando o `dev` for
  // aposentado, o acesso continua de pé.
  const veLog = !!(profile as { ve_log?: boolean }).ve_log;
  // Módulo 1 — Estágio 1 (dev-only). Promoção pro Jean: flip em gate-modulo1.ts
  const mostrarModulo1 = dev || MODULO1_LIBERADO_PARA_ADMIN;

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <Sidebar
        nome={profile.nome}
        dev={dev}
        mostrarModulo1={mostrarModulo1}
        veLog={veLog}
      />
      <main className="flex-1 min-w-0 px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
