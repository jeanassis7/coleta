import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — saque, depósito, ou qualquer dinheiro trocando de conta.
 *
 * NÃO é receita nem despesa: é o mesmo dinheiro mudando de lugar. Por isso
 * mora em tabela própria — é o que faz o caixa fechar e o DRE ignorar
 * corretamente, em vez de virar uma despesa fantasma.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const conta_origem_id = String(body.conta_origem_id || "");
  const conta_destino_id = String(body.conta_destino_id || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();

  if (!conta_origem_id || !conta_destino_id) {
    return NextResponse.json(
      { error: "diga de qual conta saiu e pra qual foi" },
      { status: 400 }
    );
  }
  if (conta_origem_id === conta_destino_id) {
    return NextResponse.json(
      { error: "a conta de origem e a de destino são a mesma" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  const hojeBr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (data > hojeBr) {
    return NextResponse.json({ error: "a data está no futuro" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);

  // RÉGUA DO DINHEIRO #1 — tirar mais do que a conta tem (varredura 21/08).
  // Saque de R$ 5.000 de um caixa em espécie com R$ 800 era aceito calado;
  // o saldo virava −4.200 e só aparecia depois, em vermelho no card, sem
  // nada ter dito no momento do lançamento.
  const { data: saldos } = await client.rpc("saldo_contas");
  const origem = ((saldos as { conta_id: string; nome: string; saldo: number }[]) ?? []).find(
    (s) => s.conta_id === conta_origem_id
  );
  const tem = Math.round(Number(origem?.saldo ?? 0) * 100) / 100;
  if (valor > tem + 0.009 && !body.confirmado) {
    return NextResponse.json(
      {
        error: `"${origem?.nome ?? "A conta de origem"}" tem ${tem.toFixed(
          2
        )} e a transferência é de ${valor.toFixed(2)} — ficaria ${(tem - valor).toFixed(
          2
        )} negativo. Confira se não faltou lançar alguma entrada. Se está certo, confirme.`,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { error } = await client.from("transferencias").insert({
    conta_origem_id,
    conta_destino_id,
    valor: Math.round(valor * 100) / 100,
    data,
    descricao: body.descricao ? String(body.descricao).trim() : null,
    registrado_por: admin.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
