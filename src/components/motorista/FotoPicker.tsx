"use client";

import { useState, useRef } from "react";
import { compressPhoto } from "@/lib/image/compress";

interface Props {
  onChange: (blob: Blob | null) => void;
}

export function FotoPicker({ onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessando(true);
    try {
      const blob = await compressPhoto(file);
      const url = URL.createObjectURL(blob);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(url);
      onChange(blob);
    } catch (err) {
      console.error("Falha ao comprimir foto:", err);
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
        onClick={() => inputRef.current?.click()}
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
