/**
 * Aplica um arquivo .sql direto no Postgres do Supabase.
 *
 * Uso:
 *   node scripts/aplicar-migration.mjs supabase/migrations/0005_role_dev.sql
 *
 * Requer DATABASE_URL no .env.local (session pooler do Supabase).
 * Roda todo o arquivo dentro de UMA transação — se qualquer statement
 * falhar, faz rollback e nada é aplicado.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega .env.local manualmente
const envPath = join(__dirname, "..", ".env.local");
const envRaw = readFileSync(envPath, "utf8");
for (const linha of envRaw.split("\n")) {
  const m = linha.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ Falta DATABASE_URL no .env.local");
  process.exit(1);
}

const arquivoSql = process.argv[2];
if (!arquivoSql) {
  console.error("❌ Uso: node scripts/aplicar-migration.mjs <caminho-do-.sql>");
  process.exit(1);
}

const sql = readFileSync(arquivoSql, "utf8");
console.log(`📄 Aplicando: ${arquivoSql}`);
console.log(`   ${sql.split("\n").length} linhas, ${sql.length} chars`);

// Parse manual pra evitar bug do pg com "." no username (session pooler)
const url = new URL(DATABASE_URL);
const client = new pg.Client({
  host: url.hostname,
  port: Number(url.port) || 5432,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, "") || "postgres",
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`✅ Migration aplicada com sucesso.`);
} catch (e) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  console.error(`❌ Erro: ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
