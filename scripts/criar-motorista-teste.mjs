/**
 * Cria um motorista de TESTE (is_teste=true).
 * Motoristas de teste NÃO aparecem no dashboard/KPIs/curadoria — servem
 * pra Evaner validar features novas em produção com dados reais dele.
 *
 * Uso:
 *   node scripts/criar-motorista-teste.mjs [nome] [email] [senha]
 *
 * Sem argumentos: cria "Teste 1" com email teste1@coleta.local, senha teste123.
 *
 * Idempotente: se o user já existe, atualiza a senha e garante os campos.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const envRaw = readFileSync(envPath, "utf8");
for (const linha of envRaw.split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("❌ Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const NOME = process.argv[2] || "Teste 1";
const EMAIL = process.argv[3] || "teste1@coleta.local";
const SENHA = process.argv[4] || "teste123";

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: lista, error: errList } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (errList) throw errList;

  const existente = lista.users.find((u) => u.email === EMAIL);
  let userId;

  if (existente) {
    console.log(`↺ User ${EMAIL} já existe — atualizando senha`);
    const { error } = await supabase.auth.admin.updateUserById(existente.id, {
      password: SENHA,
      email_confirm: true,
    });
    if (error) throw error;
    userId = existente.id;
  } else {
    console.log(`+ Criando user ${EMAIL}`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: SENHA,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: errProfile } = await supabase.from("profiles").upsert({
    id: userId,
    nome: NOME,
    role: "motorista",
    ativo: true,
    exige_foto: false,
    is_teste: true,
    features: {},
    mostra_saldo_app: false,
    senha_visivel: SENHA,
  });
  if (errProfile) throw errProfile;

  console.log(`✅ Pronto.`);
  console.log(`   Nome:   ${NOME}`);
  console.log(`   Login:  ${EMAIL} / ${SENHA}`);
  console.log(`   Role:   motorista`);
  console.log(`   Teste:  sim (não aparece em dashboards)`);
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
