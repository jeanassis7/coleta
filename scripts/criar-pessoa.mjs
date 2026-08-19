/**
 * Cria uma PESSOA de cadastro contábil — alguém que recebe dinheiro da
 * empresa mas não usa o app.
 *
 * Nasce com `ativo = false`: fica fora do login e de qualquer tela
 * operacional (o middleware barra), mas existe pra ser o `pessoa_id` de um
 * lançamento e aparecer no DRE aberto por pessoa.
 *
 * Existe porque `profiles.id` tem FK pra `auth.users`: não dá pra criar
 * pessoa por SQL puro numa migration — ela precisa nascer no Supabase Auth
 * primeiro, e isso exige a service_role.
 *
 * Uso:
 *   node scripts/criar-pessoa.mjs "Valdecir"
 *   node scripts/criar-pessoa.mjs "Nome" outro@coleta.local
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Supabase JS quebra no Node 20 sem WebSocket nativo
globalThis.WebSocket = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const linha of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const nome = process.argv[2];
if (!nome) {
  console.error('❌ Uso: node scripts/criar-pessoa.mjs "Nome da pessoa" [email]');
  process.exit(1);
}
const slug = nome.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, "");
const email = process.argv[3] || `${slug}@coleta.local`;

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: lista } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
const jaExiste = lista.users.find((u) => u.email === email);
if (jaExiste) {
  console.log(`ℹ️  ${email} já existe (${jaExiste.id}) — nada a fazer.`);
  process.exit(0);
}

// Senha aleatória: ela não vai ser usada, mas o Auth exige uma.
const senha = `x${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const { data: criado, error } = await svc.auth.admin.createUser({
  email,
  password: senha,
  email_confirm: true,
});
if (error) {
  console.error("❌", error.message);
  process.exit(1);
}

// INSERT, não update: não existe trigger criando o profile a partir do
// auth.users — quem cria é o app, explicitamente. Um update aqui rodaria em
// zero linhas e voltaria SUCESSO, deixando a pessoa sem perfil e sem erro.
const { error: errP } = await svc.from("profiles").insert({
  id: criado.user.id,
  nome: nome.trim(),
  role: "motorista",
  ativo: false,
});
if (errP) {
  console.error("❌ perfil:", errP.message);
  process.exit(1);
}

console.log(`✅ ${nome} criado como pessoa de cadastro (inativo).`);
console.log(`   id: ${criado.user.id}`);
console.log(`   email: ${email} — não usa o app, ativo = false`);
