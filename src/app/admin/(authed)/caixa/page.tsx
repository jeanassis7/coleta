import {
  buscarContasFinanceiras,
  buscarSaldoContas,
  buscarDinheiroNaMao,
  buscarTransferencias,
  buscarPatrimonio,
  buscarMovimentosAvulsos,
  buscarFotosCaixa,
} from "@/lib/admin/caixa";
import { CaixaPainel } from "@/components/admin/CaixaPainel";
import { FotosCaixaTabela } from "@/components/admin/FotosCaixa";

export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const [contas, saldos, naMao, transferencias, patrimonio, avulsos, fotos] =
    await Promise.all([
      // Inativas incluídas: a tela precisa delas pra oferecer "reativar".
      // Os dropdowns de lançamento continuam só com as ativas (filtro no painel).
      buscarContasFinanceiras({ incluirInativas: true }),
      buscarSaldoContas(),
      buscarDinheiroNaMao(),
      buscarTransferencias(50),
      buscarPatrimonio(),
      buscarMovimentosAvulsos(50),
      buscarFotosCaixa(),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Caixa</h1>
      <p className="text-sm text-cinza-suave mb-6">
        Dinheiro não aparece nem some: toda saída sai de uma conta e toda
        entrada entra em uma. Saque e depósito são{" "}
        <strong>transferência</strong>, não despesa — o mesmo dinheiro mudando
        de lugar.
      </p>

      {contas.length === 0 ? (
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Comece cadastrando suas contas</h2>
          <p className="text-sm text-cinza-suave mb-4">
            Pelo que você descreveu, são duas: <strong>dinheiro em
            espécie</strong> e <strong>Banco do Brasil</strong>. Pra cada uma,
            informe quanto tem hoje e de que dia é esse saldo — é o ponto de
            partida, e sem ele o caixa nasce errado.
          </p>
          <CaixaPainel
            contas={contas}
            saldos={saldos}
            naMao={naMao}
            transferencias={transferencias}
            movimentosAvulsos={avulsos}
            patrimonio={patrimonio}
          />
        </div>
      ) : (
        <CaixaPainel
          contas={contas}
          saldos={saldos}
          naMao={naMao}
          transferencias={transferencias}
          movimentosAvulsos={avulsos}
          patrimonio={patrimonio}
        />
      )}

      <div className="mt-6">
        <FotosCaixaTabela fotos={fotos} contasNomes={saldos.map((s) => s.nome)} />
      </div>
    </div>
  );
}
