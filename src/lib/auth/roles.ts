export type Role = "motorista" | "admin" | "dev";

export interface ProfileMinimo {
  role: Role | string;
  features?: Record<string, unknown> | null;
  is_teste?: boolean | null;
  mostra_saldo_app?: boolean | null;
}

/** Só o Jean (admin puro). Usado quando algo é EXCLUSIVO do admin operacional. */
export function isAdminPuro(p: ProfileMinimo | null | undefined): boolean {
  return p?.role === "admin";
}

/** Só o Evaner (dev). Usado pra gate de features em teste/validação. */
export function isDev(p: ProfileMinimo | null | undefined): boolean {
  return p?.role === "dev";
}

/** Admin OU dev. Usado pra permitir acesso ao painel /admin. */
export function podeAcessarAdmin(p: ProfileMinimo | null | undefined): boolean {
  return p?.role === "admin" || p?.role === "dev";
}

/**
 * Motorista tem uma feature ligada?
 * Pattern:
 *   - Feature novas nascem default OFF pra todos.
 *   - Dev liga em motorista de teste pra validar.
 *   - Admin liga pros reais gradualmente quando aprova.
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
