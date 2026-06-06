"use client";

import Papa from "papaparse";

interface Coleta {
  id: string;
  motorista_id: string;
  litros: number;
  local_nome: string;
  valor_pago: number;
  certificado_tipo: string;
  litros_certificado: number | null;
  observacao: string | null;
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
  gps_capturado: boolean;
  criado_em: string;
  sincronizado_em: string | null;
  profiles: { nome: string } | null;
}

function dataLocal(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BotaoExportCsv({ coletas }: { coletas: Coleta[] }) {
  function exportar() {
    if (coletas.length === 0) return;
    const rows = coletas.map((c) => {
      const custoLitro = c.litros > 0 ? c.valor_pago / c.litros : 0;
      return {
        data: dataLocal(c.criado_em),
        hora: horaLocal(c.criado_em),
        motorista: c.profiles?.nome || "",
        local: c.local_nome,
        litros: c.litros.toFixed(2),
        valor_pago: c.valor_pago.toString(),
        custo_por_litro: custoLitro.toFixed(2),
        certificado: c.certificado_tipo,
        litros_certificado:
          c.litros_certificado !== null ? c.litros_certificado.toFixed(2) : "",
        latitude: c.latitude !== null ? c.latitude.toString() : "",
        longitude: c.longitude !== null ? c.longitude.toString() : "",
        gps_precisao_metros: c.gps_accuracy !== null ? Math.round(c.gps_accuracy).toString() : "",
        observacao: c.observacao || "",
        sincronizado_em: c.sincronizado_em
          ? `${dataLocal(c.sincronizado_em)} ${horaLocal(c.sincronizado_em)}`
          : "",
      };
    });

    const csv = Papa.unparse(rows, { delimiter: "," });
    const bom = "﻿";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `coletas_${hoje}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={exportar}
      disabled={coletas.length === 0}
      className="px-4 py-2 bg-white border-2 border-verde text-verde rounded-xl font-medium hover:bg-verde hover:text-white transition-colors disabled:opacity-50"
    >
      📥 Exportar CSV
    </button>
  );
}
