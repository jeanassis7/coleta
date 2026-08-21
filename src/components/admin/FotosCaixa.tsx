import type { FotoCaixaLinha } from "@/lib/admin/caixa";

/**
 * O histórico do caixa — a foto de toda segunda-feira, lado a lado.
 * Versão automática da aba "ACOMPANHAMENTO DE CAIXA" da planilha antiga:
 * linhas = o que compõe o giro, colunas = as segundas.
 *
 * FOTO É IMUTÁVEL: corrigir o passado não reescreve coluna antiga. Se um
 * dia a foto divergir do recálculo, isso denuncia que mexeram no passado —
 * ela é a testemunha do sistema fechado de dinheiro.
 */

const n2 = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function FotosCaixaTabela({ fotos }: { fotos: FotoCaixaLinha[] }) {
  if (fotos.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold mb-1">Histórico do caixa</h2>
        <p className="text-sm text-cinza-suave">
          Toda segunda-feira às 6h o sistema tira uma <strong>foto</strong> do
          patrimônio acima e guarda aqui, coluna a coluna — sozinho, sem
          ninguém precisar abrir nada. A primeira foto sai na{" "}
          <strong>segunda-feira, 31/08</strong>. A foto nunca muda depois de
          tirada: corrigir o passado não reescreve o histórico.
        </p>
      </div>
    );
  }

  const datas = [...new Set(fotos.map((f) => f.data))].sort();
  // As linhas na ordem da foto mais RECENTE (contas podem nascer/sumir com o
  // tempo — a foto nova manda na ordem; linha que só existe em foto antiga
  // continua aparecendo, no fim do bloco dela).
  const linhas: { chave: string; label: string; ordem: number }[] = [];
  for (const data of [...datas].reverse()) {
    for (const f of fotos.filter((x) => x.data === data)) {
      if (!linhas.some((l) => l.chave === f.chave))
        linhas.push({ chave: f.chave, label: f.label, ordem: f.ordem });
    }
  }
  linhas.sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label));
  const valor = new Map(fotos.map((f) => [`${f.data}|${f.chave}`, f.valor]));

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-1">Histórico do caixa</h2>
      <p className="text-sm text-cinza-suave mb-3">
        A foto de toda segunda-feira, 6h — tirada pelo próprio sistema.
        Imutável: corrigir o passado não reescreve coluna antiga.
      </p>
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
                        {v == null ? (
                          <span className="text-cinza-suave/50">—</span>
                        ) : (
                          n2(v)
                        )}
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
