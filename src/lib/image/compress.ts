"use client";

import imageCompression from "browser-image-compression";

/**
 * Comprime foto pra tamanho ínfimo: 640px largura máx, JPEG q=50, alvo 30-60KB.
 * Suficiente pra confirmar "sim, é um local válido" sem gastar dados.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.06, // 60KB
    maxWidthOrHeight: 640,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.5,
  });
  return compressed;
}
