/**
 * Cria o usuário DEV (Evaner) no Supabase Auth + profiles.
 *
 * Uso:
 *   1. Rodar migration 0005_role_dev.sql no Supabase SQL Editor primeiro
 *   2. node scripts/criar-dev.mjs
 *
 * Idempotente: se o user já existe, atualiza a senha e garante role='dev'.
 * Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Carrega .env.local manualmente (sem depender de dotenv)
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

const EMAIL = "evaner@coleta.local";
const SENHA = "senharolha";
const NOME = "Evaner";

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1) Vê se já existe
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

  // 2) Upsert profile com role='dev'
  const { error: errProfile } = await supabase.from("profiles").upsert({
    id: userId,
    nome: NOME,
    role: "dev",
    ativo: true,
    exige_foto: false,
  });
  if (errProfile) throw errProfile;

  console.log(`✅ Pronto. Login: ${EMAIL} / ${SENHA}  |  role: dev`);
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
