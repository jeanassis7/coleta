export type Role = "motorista" | "admin" | "dev";

export interface ProfileMinimo {
  role: Role | string;
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
