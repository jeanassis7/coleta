"use client";

import imageCompression from "browser-image-compression";

/**
 * Comprime foto pra reconhecimento visual: 800px largura máx, JPEG q=60, alvo 100KB.
 * Suficiente pra outro motorista reconhecer fachada/portão de uma oficina
 * sem virar um app que come dados.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.1, // 100KB
    maxWidthOrHeight: 800,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.6,
  });
  return compressed;
}
