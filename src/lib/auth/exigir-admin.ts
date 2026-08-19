import { getSupabaseServer } from "@/lib/supabase/server";
import { podeAcessarAdmin } from "@/lib/auth/roles";

/**
 * Gate único dos endpoints de /api/admin.
 *
 * Substitui o antigo `exigirAcessoModulo1` (gate-modulo1.ts), que existia
 * só enquanto o Módulo 1 era invisível pro Jean, e as seis cópias caseiras
 * que tinham nascido espalhadas pelos endpoints antes dele.
 *
 * Checa `ativo` de propósito: quem foi desativado perde a API, não só o
 * painel. Antes isso era inconsistente — `coletas/[id]` não checava, então
 * um admin desativado ainda editava coleta por chamada direta.
 *
 * Uso:
 *   const user = await exigirAdmin();
 *   if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
 */
export async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.ativo || !podeAcessarAdmin(profile)) return null;
  return user;
}
