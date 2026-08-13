import Link from "next/link";
import { formatData } from "@/lib/format";
import type { CargaDetalhada } from "@/lib/admin/queries";

/**
 * Últimas descargas — o que entrou de óleo no depósito, e quais ainda
 * estão sem o teste de umidade lançado.
 */
export function CardDescargasRecentes({ cargas }: { cargas: CargaDetalhada[] }) {
  const comDescarga = cargas
    .filter((c) => c.descarga !== null)
    .sort((a, b) =>
      (b.descarga!.criado_em || "").localeCompare(a.descarga!.criado_em || "")
    )
    .slice(0, 5);

  if (comDescarga.length === 0) return null;

  return (
    <div className="card mb-6">
      <h2 className="text-lg font-semibold mb-3">⚖️ Descarregamentos recentes</h2>
      <div className="space-y-2">
        {comDescarga.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 flex-wrap border-b border-cinza-borda last:border-0 pb-2 last:pb-0"
          >
            <div className="text-sm">
              <span className="font-medium">{c.motorista_nome}</span>
              {c.motorista_is_teste && <span title="Motorista de teste"> 🧪</span>}
              <span className="text-cinza-suave">
                {" "}· {formatData(c.descarga!.criado_em)} ·{" "}
              </span>
              <span className="font-mono">
                {c.descarga!.peso_liquido_kg.toLocaleString("pt-BR")} kg
              </span>
            </div>
            {c.descarga!.umidade_pct !== null ? (
              <span className="text-sm text-green-700">
                umidade {c.descarga!.umidade_pct}% ✓
              </span>
            ) : (
              <Link
                href="/admin/cargas"
                className="text-sm text-verde font-medium hover:underline"
              >
                Lançar umidade →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
