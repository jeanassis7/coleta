/**
 * Tipos e rótulos da remuneração — SEM import de servidor.
 *
 * Existe separado de `admin/remuneracao.ts` porque aquele importa
 * `getSupabaseServer` (que usa `next/headers`), e um componente client que
 * puxasse a lista de tipos arrastaria o servidor junto e o build quebraria.
 */

export type TipoRemuneracao =
  | "salario"
  | "comissao"
  | "bonus"
  | "transferencia_socio";

export const TIPOS_REMUNERACAO: { valor: TipoRemuneracao; label: string }[] = [
  { valor: "salario", label: "Salário" },
  { valor: "comissao", label: "Comissão" },
  { valor: "bonus", label: "Bônus" },
  { valor: "transferencia_socio", label: "Transferência a sócio" },
];

export interface Vigencia {
  id: string;
  pessoa_id: string | null;
  tipo: TipoRemuneracao;
  valor: number;
  litros_base: number | null;
  vigente_desde: string;
  observacao: string | null;
  criado_em: string;
}

export interface ComissaoMotorista {
  motorista_id: string;
  nome: string;
  litros: number;
  valor: number;
  /** null quando não há vigência cobrindo o período — a tela avisa. */
  regra: { valor: number; litros_base: number } | null;
}
