"use client";

/**
 * Chama a caixa de impressão do navegador — é lá que o Jean escolhe
 * "Salvar como PDF". Gerar o PDF no servidor exigiria dependência nova e
 * layout escrito em coordenadas na mão; o navegador já faz isso de graça,
 * e o mesmo HTML serve de prévia na tela.
 */
export function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-verde text-white text-sm font-semibold rounded-xl px-4 py-2 active:bg-verde-escuro"
    >
      🖨 Imprimir / Salvar PDF
    </button>
  );
}
