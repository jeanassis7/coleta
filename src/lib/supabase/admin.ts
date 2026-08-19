import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Cliente Supabase com service_role — bypass de RLS.
 * USAR APENAS NO SERVER. Nunca importar em código de client.
 *
 * ---------------------------------------------------------------------------
 * O PARÂMETRO `atorId` ALIMENTA O LOG (migration 0022)
 * ---------------------------------------------------------------------------
 * A chave de serviço é a mesma pro Jean e pro Evaner, então o banco não
 * consegue distinguir os dois sozinho. O nome viaja por cabeçalho HTTP e o
 * gatilho lê de lá.
 *
 * `x-operacao` é gerado UMA VEZ por cliente. Como cada endpoint cria o
 * cliente uma vez e reusa, todas as gravações daquele clique compartilham o
 * mesmo id — e a tela agrupa por ele. É isso que evita ter que classificar
 * quais ações são "em lote": o agrupamento vem do que aconteceu junto, não
 * de uma regra minha que envelheceria na próxima feature.
 *
 * ⚠️ Chamar esta função DUAS VEZES no mesmo endpoint quebra o agrupamento
 * (sai em dois grupos em vez de um). Crie uma vez no topo e reuse.
 *
 * Sem `atorId` a gravação ainda acontece — só aparece como "não
 * identificado" no log. Esquecer deixa a linha feia, nunca invisível.
 */
export function getSupabaseAdmin(atorId?: string | null) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: atorId
          ? { "x-ator": atorId, "x-operacao": randomUUID() }
          : {},
      },
    }
  );
}
