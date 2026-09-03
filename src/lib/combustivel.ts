/**
 * O que entrou no tanque.
 *
 * Um dono só pro tipo de abastecimento — antes ele estava espalhado em seis
 * arquivos como `tipo === "arla" ? "arla" : "diesel"`, e cada lugar desses
 * transformava gasolina em diesel calado.
 *
 * ARLA é o único que NÃO é combustível: ele abastece no mesmo posto, sai do
 * mesmo dinheiro, mas não move o veículo — e por isso fica fora do km/L
 * (0044). Os outros três contam.
 */
export type TipoCombustivel = "diesel" | "arla" | "gasolina" | "etanol";

export const TIPOS_COMBUSTIVEL: TipoCombustivel[] = [
  "diesel",
  "arla",
  "gasolina",
  "etanol",
];

const ROTULOS: Record<TipoCombustivel, string> = {
  diesel: "Diesel",
  arla: "Arla",
  gasolina: "Gasolina",
  etanol: "Etanol",
};

export function rotuloCombustivel(tipo: string | null | undefined): string {
  return ROTULOS[(tipo ?? "diesel") as TipoCombustivel] ?? "Diesel";
}

/** Texto do usuário → tipo válido. Desconhecido cai em diesel, que é 95% da
 *  operação e o default histórico da coluna. */
export function normalizarCombustivel(v: unknown): TipoCombustivel {
  const s = String(v ?? "").toLowerCase();
  return (TIPOS_COMBUSTIVEL as string[]).includes(s)
    ? (s as TipoCombustivel)
    : "diesel";
}

/**
 * O que oferecer no formulário, pelo veículo.
 *
 * Não é enfeite: oferecer "Arla" pra uma EcoSport é convidar o clique errado,
 * e arla num carro sairia do km/L dele sem ninguém entender por quê.
 */
export function combustiveisDoVeiculo(
  tipoVeiculo: string | null | undefined
): TipoCombustivel[] {
  // Carro a diesel existe (utilitário), então ele fica na lista — mas depois
  // dos dois que são o caso comum.
  return tipoVeiculo === "carro"
    ? ["gasolina", "etanol", "diesel"]
    : ["diesel", "arla"];
}
