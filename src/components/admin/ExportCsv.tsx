"use client";

import Papa from "papaparse";

/**
 * Export CSV genérico das abas de operação.
 * Recebe as linhas já montadas (chave = cabeçalho da coluna) — cada tela
 * decide o que exportar e com que nome, sem duplicar a mecânica do arquivo.
 *
 * BOM no começo: sem ele o Excel abre acentuação quebrada em PT-BR.
 */
export function ExportCsv({
  linhas,
  nomeArquivo,
  label = "📥 Exportar CSV",
}: {
  linhas: Record<string, string | number>[];
  /** sem extensão — a data entra automaticamente */
  nomeArquivo: string;
  label?: string;
}) {
  function exportar() {
    if (linhas.length === 0) return;
    const csv = Papa.unparse(linhas, { delimiter: "," });
    const bom = "﻿";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${nomeArquivo}_${hoje}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={exportar}
      disabled={linhas.length === 0}
      className="px-4 py-2 bg-white border-2 border-verde text-verde rounded-xl font-medium hover:bg-verde hover:text-white transition-colors disabled:opacity-50 text-sm"
    >
      {label}
    </button>
  );
}
