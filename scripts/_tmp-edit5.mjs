import fs from "fs";

function patch(f, pares) {
  let s = fs.readFileSync(f, "utf8");
  for (const [velho, novo, oq] of pares) {
    if (!s.includes(velho)) throw new Error(`${f}: NAO ACHOU ${oq}`);
    if (s.split(velho).length > 2) throw new Error(`${f}: AMBIGUO ${oq}`);
    s = s.replace(velho, novo);
  }
  fs.writeFileSync(f, s);
  console.log("ok:", f);
}

// 1. CSS de impressão
patch("src/app/globals.css", [
  [
    `@layer components {`,
    `/* ---------------------------------------------------------------------------
   IMPRESSÃO — o relatório da carga sai como PDF pela caixa do navegador.
   --------------------------------------------------------------------------- */
@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  body {
    background: #fff;
  }
  /* thead de tabela repete sozinho nas páginas seguintes — é o que faz o
     cabeçalho HORA/O QUE FOI/QUANTIDADE aparecer na folha 2 sem gambiarra. */
  thead {
    display: table-header-group;
  }
  tr {
    break-inside: avoid;
  }
  /* Título do dia órfão no pé da página é o pior corte possível: o leitor
     vira a folha sem saber de que dia são as linhas seguintes. */
  .relatorio-dia td {
    break-after: avoid;
  }
  .relatorio-resumo {
    break-inside: avoid;
  }
}

@layer components {`,
    "bloco @media print",
  ],
]);

// 2. Sidebar e o main do admin somem na impressão
patch("src/components/admin/Sidebar.tsx", [
  [
    `      <div className="md:hidden sticky top-0 z-30 bg-white border-b border-cinza-borda px-4 py-3 flex items-center justify-between">`,
    `      <div className="md:hidden print:hidden sticky top-0 z-30 bg-white border-b border-cinza-borda px-4 py-3 flex items-center justify-between">`,
    "barra do topo",
  ],
  [
    `      <aside className="hidden md:flex w-60 shrink-0 bg-white border-r border-cinza-borda h-screen sticky top-0">`,
    `      <aside className="hidden md:flex print:hidden w-60 shrink-0 bg-white border-r border-cinza-borda h-screen sticky top-0">`,
    "aside desktop",
  ],
]);

patch("src/app/admin/(authed)/layout.tsx", [
  [
    `      <main className="flex-1 min-w-0 px-4 py-6 md:px-6">{children}</main>`,
    `      <main className="flex-1 min-w-0 px-4 py-6 md:px-6 print:p-0">
        {children}
      </main>`,
    "main do admin",
  ],
]);

// 3. Botão do relatório no detalhe da carga
patch("src/app/admin/(authed)/cargas/[id]/page.tsx", [
  [
    `        <StatusBadge status={carga.status} />
      </div>`,
    `        <StatusBadge status={carga.status} />
        <Link
          href={\`/admin/cargas/\${carga.id}/relatorio\`}
          className="ml-auto bg-verde text-white text-sm font-semibold rounded-xl px-4 py-2 hover:bg-verde-escuro"
        >
          📄 Relatório do motorista
        </Link>
      </div>`,
    "botao relatorio",
  ],
]);
