/**
 * selectTudo — busca TODAS as linhas de uma consulta, paginando por baixo.
 *
 * O Supabase devolve NO MÁXIMO 1000 linhas por consulta, SEM ERRO NENHUM:
 * a linha 1001 simplesmente não vem. Consulta que cresce com o tempo (todas
 * as contas com origem, coletas de 90 dias, abastecimentos desde sempre)
 * funciona por meses e um dia começa a truncar dados em silêncio — KPI
 * subcontado, anti-dobra do DRE furada, alerta que não acende.
 *
 * Este helper é a solução DEFINITIVA (pedido do Evaner, 20/08/2026): pagina
 * com `.range()` até a última linha, não importa o tamanho. Pra funcionar,
 * a consulta PRECISA de um `.order()` estável (id serve) — sem ordem, as
 * páginas podem se sobrepor.
 *
 * Uso:
 *   const linhas = await selectTudo<MinhaLinha>((de, ate) =>
 *     supabase.from("coletas").select("id, litros").order("id").range(de, ate)
 *   );
 */
export async function selectTudo<T>(
  // `data: unknown` de propósito: o postgrest-js infere o tipo do embed
  // ERRADO (promete array onde o runtime entrega objeto) e a assinatura
  // estrita rejeitava toda consulta com join. O chamador declara T e o
  // cast acontece aqui dentro, num lugar só.
  montarPagina: (
    de: number,
    ate: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  tamanhoPagina = 1000
): Promise<T[]> {
  const tudo: T[] = [];
  // Trava de segurança MUITO acima de qualquer volume real (500 páginas =
  // 500 mil linhas) — protege contra um range ignorado virar loop infinito.
  const MAX_PAGINAS = 500;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * tamanhoPagina;
    const { data, error } = await montarPagina(de, de + tamanhoPagina - 1);
    if (error) throw new Error(error.message);
    const lote = (data as T[] | null) ?? [];
    tudo.push(...lote);
    if (lote.length < tamanhoPagina) return tudo;
  }
  return tudo;
}
