import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Gate dos MÓDULOS 1 e 2 (Cargas, Estoque, Vendas, Cheques, Contas a pagar,
 * Compradores, Caminhões, Adiantamentos e Acertos).
 *
 * ESTÁGIO ATUAL: LIBERADO PRO ADMIN (Estágio 2).
 * Liberado em 18/08/2026, a pedido do Evaner, depois que o log de ações
 * (migration 0022) entrou — assim os primeiros dias com dois gestores
 * lançando já nascem com rastro de quem fez o quê.
 *
 * O que o dev ainda tem a mais, e por isso este gate não foi removido:
 * o painel de features (/admin/dev/features) e ver os dados do motorista de
 * teste com 🧪. Quando isso também deixar de importar, dá pra apagar o
 * arquivo inteiro e trocar as chamadas por `podeAcessarAdmin`.
 *
 * PRA VOLTAR ATRÁS: mudar a constante pra `false`. Fecha tudo de uma vez —
 * menus, páginas e endpoints — sem precisar editar mais nada.
 */
export const MODULO1_LIBERADO_PARA_ADMIN = true;

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
 * Pra páginas COMPARTILHADAS (ex: dashboard, que o Jean acessa sempre):
 * diz se o viewer atual enxerga as partes do Módulo 1 — sem redirecionar.
 */
export async function acessoModulo1Atual(): Promise<{
  temAcesso: boolean;
  ehDev: boolean;
}> {
  const { profile } = await getProfileAtual();
  return {
    temAcesso: temAcessoModulo1(profile),
    ehDev: profile?.role === "dev",
  };
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
