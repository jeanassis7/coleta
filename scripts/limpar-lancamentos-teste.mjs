/**
 * Zera os LANÇAMENTOS de um motorista de TESTE — coletas, despesas,
 * abastecimentos, descargas, cargas, adiantamentos, acertos e as fotos
 * do storage. O perfil continua existindo com as features ligadas.
 *
 * TRAVA DE SEGURANÇA: exige a flag --sim-eu-confirmo.
 * A trava antiga era a coluna is_teste, que deixou de existir quando o
 * conceito de motorista de teste foi removido (19/08/2026). Sem uma trava
 * explícita, este script apagaria lançamento de motorista real calado.
 *
 * Uso:
 *   node scripts/limpar-lancamentos-teste.mjs <email> --sim-eu-confirmo
 *   node scripts/limpar-lancamentos-teste.mjs outro@coleta.local
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const envRaw = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const linha of envRaw.split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const EMAIL = process.argv[2] || "teste1@coleta.local";
const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  // Acha o user pelo email (Auth) e o perfil
  const { data: lista, error: errL } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (errL) throw errL;
  const user = lista.users.find((u) => u.email === EMAIL);
  if (!user) throw new Error(`user ${EMAIL} não existe`);

  const { data: perfil, error: errP } = await svc
    .from("profiles").select("id, nome, role").eq("id", user.id).maybeSingle();
  if (errP || !perfil) throw new Error("perfil não encontrado");

  // TRAVA: este script APAGA lançamento. Quem chama declara que sabe.
  if (!process.argv.includes("--sim-eu-confirmo")) {
    throw new Error(
      `RECUSADO: isto APAGA todos os lançamentos de ${perfil.nome} (${EMAIL}).\n` +
        `Se é isso mesmo, rode de novo acrescentando --sim-eu-confirmo`
    );
  }

  const id = perfil.id;
  console.log(`🧹 Limpando lançamentos de "${perfil.nome}" (${EMAIL})...`);

  const del = async (tabela, query) => {
    const { data, error } = await query.select("id");
    if (error) throw new Error(`${tabela}: ${error.message}`);
    console.log(`   ${tabela}: ${(data || []).length} apagados`);
  };

  // Ordem respeita FKs: filhos antes de cargas
  const { data: cargas } = await svc.from("cargas").select("id").eq("motorista_id", id);
  const cargaIds = (cargas || []).map((c) => c.id);

  await del("acertos", svc.from("acertos").delete().eq("motorista_id", id));
  await del("adiantamentos", svc.from("adiantamentos").delete().eq("motorista_id", id));
  // Nota assinada e coleta paga pela sede geram conta a pagar (trigger 0034 /
  // endpoint) com registrado_por = motorista. Sem limpar, o FK segura tudo.
  await del("contas_a_pagar", svc.from("contas_a_pagar").delete().eq("registrado_por", id));
  if (cargaIds.length > 0) {
    await del("descargas", svc.from("descargas").delete().in("carga_id", cargaIds));
  }
  await del("despesas", svc.from("despesas").delete().eq("motorista_id", id));
  await del("abastecimentos", svc.from("abastecimentos").delete().eq("motorista_id", id));
  await del("coletas", svc.from("coletas").delete().eq("motorista_id", id));
  await del("cargas", svc.from("cargas").delete().eq("motorista_id", id));

  // Fotos do storage (prefixo = uid do motorista)
  const { data: objetos } = await svc.storage.from("fotos-coletas").list(id, { limit: 1000 });
  const paths = (objetos || []).map((o) => `${id}/${o.name}`);
  if (paths.length > 0) {
    await svc.storage.from("fotos-coletas").remove(paths);
  }
  console.log(`   fotos no storage: ${paths.length} apagadas`);

  console.log(`✅ Pronto. Perfil e features de "${perfil.nome}" intactos — só os lançamentos foram zerados.`);
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
