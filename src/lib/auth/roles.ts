export type Role = "motorista" | "admin";

export interface ProfileMinimo {
  role: Role | string;
  features?: Record<string, unknown> | null;
  mostra_saldo_app?: boolean | null;
}

/**
 * Admin — o único papel com acesso ao painel.
 *
 * Existiu um terceiro papel (`dev`) enquanto os Módulos 1 e 2 eram
 * invisíveis pro Jean. Depois que o gate caiu, ele virou hierarquia sem
 * função e foi removido (19/08/2026).
 *
 * REGRA QUE FICA: capacidade extra vira COLUNA no cadastro, nunca papel
 * novo. Hoje existe uma só — `profiles.ve_log`, que diz quem enxerga
 * /admin/log. Papel responde "entra ou não entra"; coluna responde
 * "enxerga o quê".
 */
export function podeAcessarAdmin(p: ProfileMinimo | null | undefined): boolean {
  return p?.role === "admin";
}

/**
 * Motorista tem uma feature ligada?
 * Pattern:
 *   - Feature nova nasce default OFF pra todos.
 *   - O admin liga num motorista em /admin/features, acompanha alguns dias
 *     e só então estende pros outros.
 * Ex: hasFeature(profile, "carga")
 */
export function hasFeature(
  p: ProfileMinimo | null | undefined,
  feature: string
): boolean {
  const f = p?.features;
  if (!f || typeof f !== "object") return false;
  return !!(f as Record<string, unknown>)[feature];
}
