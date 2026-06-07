"use client";

import { useState, useRef } from "react";
import { compressPhoto } from "@/lib/image/compress";
import { logEvent } from "@/lib/events/log";

interface Props {
  onChange: (blob: Blob | null) => void;
  motoristaId: string;
}

export function FotoPicker({ onChange, motoristaId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  function abrirCamera() {
    logEvent(motoristaId, "foto_capture_started", {});
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      await logEvent(motoristaId, "foto_capture_cancelled", {});
      return;
    }
    const tamanhoOriginal = file.size;
    setProcessando(true);
    try {
      const blob = await compressPhoto(file);
      const url = URL.createObjectURL(blob);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(url);
      onChange(blob);
      await logEvent(motoristaId, "foto_compress_completed", {
        tamanho_original_bytes: tamanhoOriginal,
        tamanho_final_bytes: blob.size,
        tipo_original: file.type,
      });
    } catch (err) {
      console.error("Falha ao comprimir foto:", err);
      await logEvent(motoristaId, "foto_compress_failed", {
        tamanho_original_bytes: tamanhoOriginal,
        tipo_original: file.type,
        erro: err instanceof Error ? err.message : String(err),
      });
      alert("Não consegui processar a foto. Tenta outra.");
      onChange(null);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={abrirCamera}
        disabled={processando}
        className="w-full bg-white border-2 border-cinza-borda rounded-2xl p-6 active:bg-cinza-fundo transition-colors"
      >
        {processando ? (
          <span className="text-lg text-cinza-suave">Processando...</span>
        ) : preview ? (
          <div className="flex items-center gap-3">
            <img
              src={preview}
              alt="Preview"
              className="w-20 h-20 object-cover rounded-xl"
            />
            <span className="text-lg font-semibold text-verde">
              📷 TROCAR FOTO
            </span>
          </div>
        ) : (
          <span className="text-lg font-semibold">📷 TIRAR FOTO</span>
        )}
      </button>
    </div>
  );
}
