import Link from "next/link";
import { formatBRL } from "@/lib/format";

/**
 * Três números de SITUAÇÃO, no topo do dashboard: quanto tem no tanque,
 * quanto o mercado deve, quanto está em cheque na gaveta.
 *
 * Ficam separados dos KPIs de período de propósito. Aqueles respondem
 * "como foi este mês contra o anterior"; estes respondem "como está agora"
 * — não têm comparação porque comparar saldo com o mês passado não muda
 * nenhuma decisão.
 */
export function CardsSituacao({
  estoqueKg,
  estoqueValor,
  aReceber,
  chequesValor,
  chequesQtd,
}: {
  estoqueKg: number;
  estoqueValor: number;
  aReceber: number;
  chequesValor: number;
  chequesQtd: number;
}) {
  const cards = [
    {
      label: "Estoque",
      valor: `${Math.round(estoqueKg).toLocaleString("pt-BR")} kg`,
      abaixo: formatBRL(estoqueValor),
      href: "/admin/estoque",
    },
    {
      label: "A receber",
      valor: formatBRL(aReceber),
      abaixo: "dos compradores",
      href: "/admin/compradores",
    },
    {
      label: "Cheques em carteira",
      valor: formatBRL(chequesValor),
      abaixo: `${chequesQtd} cheque${chequesQtd === 1 ? "" : "s"}`,
      href: "/admin/cheques",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {cards.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="card hover:border-verde transition-colors"
        >
          <div className="text-sm text-cinza-suave">{c.label}</div>
          <div className="text-2xl font-bold mt-1">{c.valor}</div>
          <div className="text-sm text-cinza-suave">{c.abaixo}</div>
        </Link>
      ))}
    </div>
  );
}
