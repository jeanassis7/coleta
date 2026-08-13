import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { podeAcessarAdmin, isDev } from "@/lib/auth/roles";
import { MODULO1_LIBERADO_PARA_ADMIN } from "@/lib/auth/gate-modulo1";

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
    .select("nome, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !podeAcessarAdmin(profile)) {
    redirect("/admin/login?erro=acesso");
  }

  const dev = isDev(profile);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-cinza-borda">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-xl font-bold flex items-center gap-2">
              <img src="/icons/icon-192.png" alt="" className="w-7 h-7" />
              Coleta
            </Link>
            <nav className="hidden md:flex gap-3 text-base flex-wrap">
              <Link href="/admin" className="hover:text-verde">Dashboard</Link>
              {/* Módulo 1 — Estágio 1 (dev-only). Promoção pro Jean: flip em gate-modulo1.ts */}
              {(dev || MODULO1_LIBERADO_PARA_ADMIN) && (
                <>
                  <Link href="/admin/cargas" className="hover:text-verde">Cargas</Link>
                  <Link href="/admin/abastecimentos" className="hover:text-verde">Abastecimentos</Link>
                  <Link href="/admin/adiantamentos" className="hover:text-verde">Adiantamentos</Link>
                  <Link href="/admin/caminhoes" className="hover:text-verde">Caminhões</Link>
                </>
              )}
              <Link href="/admin/mapa" className="hover:text-verde">Mapa</Link>
              <Link href="/admin/observacoes" className="hover:text-verde">Observações</Link>
              <Link href="/admin/curadoria" className="hover:text-verde">Curadoria</Link>
              <Link href="/admin/motoristas" className="hover:text-verde">Motoristas</Link>
              <Link href="/admin/eventos" className="hover:text-verde">Eventos</Link>
              {dev && (
                <Link
                  href="/admin/dev/features"
                  className="hover:text-verde text-amber-700"
                  title="Painel de features (só dev)"
                >
                  🧪 Features
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {dev && (
              <span
                className="text-xs font-bold px-2 py-1 rounded-md bg-amber-100 text-amber-800 border border-amber-300"
                title="Você está logado como DEV — vê recursos em teste"
              >
                🧪 DEV
              </span>
            )}
            <span className="text-sm text-cinza-suave hidden md:inline">
              {profile.nome}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
