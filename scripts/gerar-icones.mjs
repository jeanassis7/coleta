/**
 * Gera os 3 PNGs do PWA a partir de icone-gota.jfif:
 *  - public/icons/icon-192.png   (192x192, qualquer purpose)
 *  - public/icons/icon-512.png   (512x512, qualquer purpose)
 *  - public/icons/icon-maskable-512.png (512x512, com safe zone pra Android)
 *  - public/favicon.png          (32x32, pro browser)
 *
 * Estratégia: a gota original tem fundo branco (JPEG). Colocamos
 * sobre um canvas verde (#16a34a), centralizada, com padding pra Android
 * não cortar nos cantos (especialmente o maskable).
 *
 * Rodar: node scripts/gerar-icones.mjs
 */

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ORIGEM = join(ROOT, "icone-gota.jfif");
const DESTINO = join(ROOT, "public", "icons");

mkdirSync(DESTINO, { recursive: true });

const VERDE = { r: 22, g: 163, b: 74, alpha: 1 }; // #16a34a

/**
 * Para cada pixel: se for branco/quase-branco, vira BRANCO PURO (verde no final).
 * Pixels escuros mantêm cor escura. Isso elimina o ruído JPEG ao redor da gota.
 */
async function limparRuidoJpeg(buffer, limiar = 200) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 3) {
    if (data[i] > limiar && data[i + 1] > limiar && data[i + 2] > limiar) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function gerar({ tamanho, padding, nome }) {
  const conteudoSize = tamanho - padding * 2;

  // Limpa ruído da JFIF
  const original = await sharp(ORIGEM).toBuffer();
  const limpo = await limparRuidoJpeg(original);

  // Redimensiona — usa verde como fundo do canvas do resize
  const gotaComFundoVerde = await sharp(limpo)
    .resize(conteudoSize, conteudoSize, {
      fit: "contain",
      background: VERDE,
    })
    .toBuffer();

  // Canvas verde + drop em cima com blend multiply:
  // branco × verde = verde, preto × verde = preto. Resultado: gota preta sobre verde.
  await sharp({
    create: {
      width: tamanho,
      height: tamanho,
      channels: 4,
      background: VERDE,
    },
  })
    .composite([{ input: gotaComFundoVerde, gravity: "center", blend: "multiply" }])
    .png()
    .toFile(join(DESTINO, nome));

  console.log(`✓ ${nome} (${tamanho}x${tamanho})`);
}

await gerar({ tamanho: 192, padding: 16, nome: "icon-192.png" });
await gerar({ tamanho: 512, padding: 48, nome: "icon-512.png" });
// Maskable: safe zone = 80% central. Padding maior pra borda.
await gerar({ tamanho: 512, padding: 96, nome: "icon-maskable-512.png" });

// Favicon
await sharp(ORIGEM)
  .resize(32, 32, { fit: "contain", background: VERDE })
  .png()
  .toFile(join(ROOT, "public", "favicon.png"));
console.log(`✓ favicon.png (32x32)`);

console.log("\nFeito. Atualize public/manifest.json pra apontar pros PNGs.");
