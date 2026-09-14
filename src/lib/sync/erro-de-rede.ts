/**
 * Erro de REDE (a resposta morreu) x erro de DADO (o servidor recusou).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISSO EXISTE
 * ---------------------------------------------------------------------------
 * O WebKit aborta o fetch quando o app vai pro bolso e escreve
 * "TypeError: Load failed"; o Chrome escreve "Failed to fetch".
 *
 * Medido em 14/09/2026 contra produção: das 37 coletas que deram
 * `sync_failure` com "Load failed" no iPhone do Lucimar, **37 estavam no
 * banco**. O insert funcionou; morreu a resposta. O app marcava pendente, o
 * motorista via "não foi" e relançava na mão — com client_id novo, que a
 * idempotência não pega.
 *
 * O `23505` já era tratado como sucesso porque o Postgres FALA. Erro de rede
 * não fala nada, e é justamente por isso que precisa da pergunta de volta.
 *
 * ⚠️ Erro de DADO (tem `code` do Postgres) NUNCA se reconcilia: ali a linha
 * realmente não entrou, e marcar como subida perderia o lançamento.
 */
export function ehErroDeRede(
  err: { code?: string; message?: string } | null | undefined
): boolean {
  if (!err) return false;
  // Postgres respondeu: então a resposta chegou, e o problema é o dado.
  if (err.code) return false;
  const m = (err.message || "").toLowerCase();
  return (
    m.includes("load failed") || // Safari / WebKit
    m.includes("failed to fetch") || // Chrome / Firefox
    m.includes("networkerror") ||
    m.includes("network request failed")
  );
}
