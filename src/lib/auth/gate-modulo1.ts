import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Gate do MÓDULO 1 (Cargas, Caminhões, Descargas, Adiantamentos, Acertos).
 *
 * ESTÁGIO ATUAL: DEV-ONLY (Estágio 1 do ciclo de vida de feature).
 * Só o Evaner (role='dev') vê os menus, acessa as páginas e chama os endpoints.
 * Jean (role='admin') não vê nada do módulo até a promoção.
 *
 * PRA PROMOVER PRO JEAN (Estágio 2): mudar a constante abaixo pra `true`.
 * Um único flip libera de uma vez: links do menu, as 4 páginas e os 6 endpoints.
 * Nada mais precisa ser editado.
 */
export const MODULO1_LIBERADO_PARA_ADMIN = false;

interface ProfileGate {
  role: string;
  ativo: boolean;
}

function temAcessoModulo1(profile: ProfileGate | null): boolean {
  if (!profile || !profile.ativo) return false;
  if (profile.role === "dev") return true;
  if (MODULO1_LIBERADO_PARA_ADMIN && profile.role === "admin") return true;
  return false;
}

async function getProfileAtual(): Promise<{
  user: { id: string } | null;
  profile: ProfileGate | null;
}> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  return { user, profile: (profile as ProfileGate) ?? null };
}

/**
 * Pra API routes do Módulo 1: retorna o user se tem acesso, senão null.
 * Uso: const user = await exigirAcessoModulo1();
 *      if (!user) return 403
 */
export async function exigirAcessoModulo1() {
  const { user, profile } = await getProfileAtual();
  return temAcessoModulo1(profile) ? user : null;
}

/**
 * Pra páginas server do Módulo 1: redireciona pra /admin se sem acesso.
 * Chamar no topo do componente da página.
 * Retorna ehDev pra página decidir se mostra dados de motorista de teste
 * (dev vê tudo com badge 🧪; admin nunca vê dados de teste).
 */
export async function exigirAcessoModulo1OuRedirect() {
  const { user, profile } = await getProfileAtual();
  if (!temAcessoModulo1(profile)) {
    redirect("/admin");
  }
  return { user, ehDev: profile?.role === "dev" };
}
