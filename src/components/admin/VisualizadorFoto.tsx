"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * Ícone 📷 que abre a foto num popup na própria tela.
 *
 * O bucket é privado: o link temporário (signed URL) só é gerado quando
 * clica — assim uma tabela com 200 linhas não dispara 200 requisições ao
 * abrir. Sem aba nova, sem recarregar (decisão do Evaner).
 */
export function VisualizadorFoto({
  path,
  legenda,
}: {
  path: string | null;
  legenda?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  if (!path) {
    return <span className="text-cinza-suave" title="Sem foto">—</span>;
  }

  async function abrir() {
    setAberto(true);
    if (url || carregando) return;
    setCarregando(true);
    setErro(false);
    try {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.storage
        .from("fotos-coletas")
        .createSignedUrl(path!, 3600);
      if (data?.signedUrl) setUrl(data.signedUrl);
      else setErro(true);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <button
        onClick={abrir}
        className="text-lg hover:scale-110 transition-transform"
        title="Ver foto"
        aria-label="Ver foto"
      >
        📷
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/85 z-[60] flex flex-col items-center justify-center p-4"
          onClick={() => setAberto(false)}
        >
          <button
            onClick={() => setAberto(false)}
            className="absolute top-4 right-5 text-white text-4xl leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
          {legenda && (
            <p className="text-white text-sm mb-3 text-center">{legenda}</p>
          )}
          {carregando && <p className="text-white">Carregando foto...</p>}
          {erro && (
            <p className="text-white">
              Não consegui carregar essa foto. Ela pode ter sido apagada.
            </p>
          )}
          {url && (
            <img
              src={url}
              alt={legenda || "Foto do lançamento"}
              className="max-h-[85vh] max-w-full rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  );
}
