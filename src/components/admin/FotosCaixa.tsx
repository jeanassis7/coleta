import type { FotoCaixaLinha } from "@/lib/admin/caixa";

/**
 * Histórico do caixa — a foto de toda segunda-feira, lado a lado.
 * Linhas = os componentes do giro; colunas = as segundas, começando em
 * 31/08/2026 e andando de 7 em 7 dias. Célula vazia = foto ainda não
 * tirada (coluna futura) ou foto que falhou naquela segunda.
 *
 * Sem texto de explicação, por pedido do Evaner (21/08): só o título e a
 * tabela. A foto em si é imutável (0051) — isso vive no banco, não aqui.
 */

const PRIMEIRA_FOTO = "2026-08-31";

const n2 = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** As segundas de 31/08 até hoje (BR) — sempre pelo menos a primeira. */
function segundasProgramadas(): string[] {
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const datas: string[] = [];
  const d = new Date(`${PRIMEIRA_FOTO}T00:00:00Z`);
  while (datas.length === 0 || d.toISOString().slice(0, 10) <= hojeBr) {
    datas.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return datas;
}

/** Esqueleto das linhas antes da primeira foto — espelha a função do banco. */
const LINHAS_PADRAO = (contasNomes: string[]) => [
  ...contasNomes.map((nome, i) => ({ chave: `conta-nome:${nome}`, label: nome, ordem: 10 + i / 100 })),
  { chave: "maos_motoristas", label: "Em mãos de motoristas", ordem: 20 },
  { chave: "estoque", label: "Valor em estoque", ordem: 30 },
  { chave: "oleo_caminhoes", label: "Óleo nos caminhões", ordem: 40 },
  { chave: "cheques_aberto", label: "Cheques em aberto", ordem: 50 },
  { chave: "a_receber", label: "A receber dos compradores", ordem: 60 },
  { chave: "total", label: "TOTAL", ordem: 90 },
  // abaixo do total, sem descontar dele (decisão do Evaner, 21/08)
  { chave: "contas_a_pagar", label: "Contas a pagar em aberto", ordem: 95 },
];

export function FotosCaixaTabela({
  fotos,
  contasNomes,
}: {
  fotos: FotoCaixaLinha[];
  contasNomes: string[];
}) {
  // Colunas: as segundas programadas + qualquer data que já tenha foto.
  const datas = [...new Set([...segundasProgramadas(), ...fotos.map((f) => f.data)])].sort();

  // Linhas: das fotos quando existem (a mais recente manda na ordem);
  // esqueleto padrão enquanto não há nenhuma.
  let linhas: { chave: string; label: string; ordem: number }[];
  if (fotos.length > 0) {
    linhas = [];
    const datasComFoto = [...new Set(fotos.map((f) => f.data))].sort().reverse();
    for (const data of datasComFoto) {
      for (const f of fotos.filter((x) => x.data === data)) {
        if (!linhas.some((l) => l.chave === f.chave))
          linhas.push({ chave: f.chave, label: f.label, ordem: f.ordem });
      }
    }
  } else {
    linhas = LINHAS_PADRAO(contasNomes);
  }
  linhas.sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label));

  const valor = new Map(fotos.map((f) => [`${f.data}|${f.chave}`, f.valor]));

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-3">Histórico do caixa</h2>
      <div className="overflow-x-auto">
        <table className="text-sm min-w-max w-full">
          <thead>
            <tr className="border-b-2 border-preto">
              <th className="sticky left-0 bg-white py-2 pr-3 text-left">
                <span className="text-xs font-normal text-cinza-suave">valores em R$</span>
              </th>
              {datas.map((d) => (
                <th key={d} className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                  {ddmm(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const total = l.chave === "total";
              return (
                <tr
                  key={l.chave}
                  className={total ? "border-t-2 border-preto" : "border-b border-cinza-borda/50"}
                >
                  <td
                    className={`sticky left-0 bg-white py-1.5 pr-3 whitespace-nowrap ${
                      total ? "font-bold py-2.5" : ""
                    }`}
                  >
                    {l.label}
                  </td>
                  {datas.map((d) => {
                    const v = valor.get(`${d}|${l.chave}`);
                    return (
                      <td
                        key={d}
                        className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${
                          v != null && v < 0 ? "text-alerta" : ""
                        } ${total ? "font-bold py-2.5" : ""}`}
                      >
                        {v == null ? <span className="text-cinza-suave/40">—</span> : n2(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
