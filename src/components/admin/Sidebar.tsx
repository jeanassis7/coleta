"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/admin/LogoutButton";

interface Item {
  href: string;
  label: string;
}

interface Grupo {
  titulo: string;
  icone: string;
  itens: Item[];
}

/**
 * Navegação lateral com grupos (desenho aprovado pelo Evaner).
 * Escala pros próximos módulos do ERP sem virar um header lotado:
 * item novo entra no grupo certo em vez de espremer a barra de cima.
 * No celular vira menu hambúrguer.
 */
export function Sidebar({
  nome,
  dev,
  mostrarModulo1,
}: {
  nome: string;
  dev: boolean;
  mostrarModulo1: boolean;
}) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false); // drawer no mobile

  const grupos: Grupo[] = [
    {
      titulo: "OPERAÇÃO",
      icone: "🚚",
      itens: mostrarModulo1
        ? [
            { href: "/admin/estoque", label: "Estoque" },
            { href: "/admin/vendas", label: "Vendas" },
            { href: "/admin/cheques", label: "Cheques" },
            { href: "/admin/contas", label: "Contas a pagar" },
            { href: "/admin/cargas", label: "Cargas" },
            { href: "/admin/abastecimentos", label: "Abastecimentos" },
            { href: "/admin/despesas", label: "Despesas" },
            { href: "/admin/compras", label: "Compra direta" },
            { href: "/admin/adiantamentos", label: "Adiantamentos" },
          ]
        : [],
    },
    {
      titulo: "ANÁLISE",
      icone: "📈",
      itens: [
        { href: "/admin/mapa", label: "Mapa" },
        { href: "/admin/observacoes", label: "Observações" },
      ],
    },
    {
      titulo: "CADASTROS",
      icone: "📋",
      itens: [
        { href: "/admin/motoristas", label: "Motoristas" },
        { href: "/admin/curadoria", label: "Locais (curadoria)" },
        ...(mostrarModulo1
          ? [
              { href: "/admin/caminhoes", label: "Caminhões" },
              { href: "/admin/compradores", label: "Compradores" },
            ]
          : []),
      ],
    },
    {
      titulo: "SISTEMA",
      icone: "⚙️",
      itens: [
        { href: "/admin/eventos", label: "Eventos" },
        ...(dev ? [{ href: "/admin/dev/features", label: "🧪 Features" }] : []),
      ],
    },
  ].filter((g) => g.itens.length > 0);

  function ativo(href: string): boolean {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  const conteudo = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-cinza-borda">
        <Link
          href="/admin"
          onClick={() => setAberto(false)}
          className="text-xl font-bold flex items-center gap-2"
        >
          <img src="/icons/icon-192.png" alt="" className="w-7 h-7" />
          Coleta
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        <Link
          href="/admin"
          onClick={() => setAberto(false)}
          className={`block px-3 py-2 rounded-xl font-medium ${
            ativo("/admin")
              ? "bg-verde text-white"
              : "hover:bg-slate-100 text-cinza-texto"
          }`}
        >
          📊 Dashboard
        </Link>

        {grupos.map((g) => (
          <GrupoNav
            key={g.titulo}
            grupo={g}
            ativo={ativo}
            aoNavegar={() => setAberto(false)}
          />
        ))}
      </nav>

      <div className="border-t border-cinza-borda px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          {dev && (
            <span
              className="text-xs font-bold px-2 py-1 rounded-md bg-amber-100 text-amber-800 border border-amber-300"
              title="Você está logado como DEV — vê recursos em teste"
            >
              🧪 DEV
            </span>
          )}
          <span className="text-sm text-cinza-suave truncate">{nome}</span>
        </div>
        <LogoutButton />
      </div>
    </div>
  );

  return (
    <>
      {/* Barra do topo — só no celular */}
      <div className="md:hidden sticky top-0 z-30 bg-white border-b border-cinza-borda px-4 py-3 flex items-center justify-between">
        <Link href="/admin" className="font-bold flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="w-6 h-6" />
          Coleta
        </Link>
        <button
          onClick={() => setAberto(true)}
          className="text-2xl px-2"
          aria-label="Abrir menu"
        >
          ☰
        </button>
      </div>

      {/* Sidebar fixa — desktop */}
      <aside className="hidden md:flex w-60 shrink-0 bg-white border-r border-cinza-borda h-screen sticky top-0">
        {conteudo}
      </aside>

      {/* Drawer — celular */}
      {aberto && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setAberto(false)}
          />
          <div className="relative w-64 bg-white h-full shadow-xl">
            <button
              onClick={() => setAberto(false)}
              className="absolute top-3 right-3 text-2xl text-cinza-suave"
              aria-label="Fechar menu"
            >
              ×
            </button>
            {conteudo}
          </div>
        </div>
      )}
    </>
  );
}

function GrupoNav({
  grupo,
  ativo,
  aoNavegar,
}: {
  grupo: Grupo;
  ativo: (href: string) => boolean;
  aoNavegar: () => void;
}) {
  const temAtivo = grupo.itens.some((i) => ativo(i.href));
  const [aberto, setAberto] = useState(true);

  return (
    <div>
      <button
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between px-3 py-1 text-xs font-bold text-cinza-suave tracking-wide hover:text-cinza-texto"
      >
        <span>
          {grupo.icone} {grupo.titulo}
        </span>
        <span className={`transition-transform ${aberto ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {(aberto || temAtivo) && (
        <div className="mt-1 space-y-0.5">
          {grupo.itens.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={aoNavegar}
              className={`block px-3 py-2 rounded-xl text-sm ${
                ativo(i.href)
                  ? "bg-verde text-white font-medium"
                  : "hover:bg-slate-100 text-cinza-texto"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
