import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Carrega o .env.local do projeto, se existir.
 *
 * No CI o arquivo NÃO existe — as variáveis chegam pelo ambiente (GitHub
 * Secrets). Por isso a ausência é normal e não é erro: quem reclama é a
 * checagem de `obrigatorias`, que dá uma mensagem útil em vez do ENOENT
 * cru do readFileSync.
 *
 * O caminho é derivado de __dirname de propósito — a versão anterior tinha
 * "C:/Users/Evaner/..." fixo e só funcionava numa máquina.
 */
export function carregarEnv(obrigatorias = []) {
  const caminho = join(__dirname, "..", ".env.local");

  if (existsSync(caminho)) {
    for (const linha of readFileSync(caminho, "utf8").split("\n")) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }

  const faltando = obrigatorias.filter((k) => !process.env[k]);
  if (faltando.length > 0) {
    console.error(
      `❌ Faltando no ambiente: ${faltando.join(", ")}\n` +
        `   Local: cadastre no .env.local.\n` +
        `   CI: cadastre em Settings > Secrets and variables > Actions.`
    );
    process.exit(1);
  }
}
