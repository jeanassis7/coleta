import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * PATCH acao "estornar" — reverte um adiantamento já ACEITO.
 *
 * Só pra quando o dinheiro voltou de verdade (pix devolvido, mandado
 * errado): o status vira cancelado, o valor volta pro saldo da conta
 * (o braço do caixa ignora cancelado) e sai do saldo do motorista (que só
 * soma aceito). Não é pra "ajustar" saldo — pra isso existem a devolução
 * e o acerto.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  if (String(body.acao || "") !== "estornar") {
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: atual, error: eAtual } = await client
    .from("adiantamentos")
    .select("id, status, observacao, motorista_id, aceito_em")
    .eq("id", id)
    .maybeSingle();
  if (eAtual) return NextResponse.json({ error: eAtual.message }, { status: 400 });
  if (!atual) return NextResponse.json({ error: "adiantamento não encontrado" }, { status: 404 });
  if (atual.status !== "aceito") {
    return NextResponse.json(
      { error: "só adiantamento ACEITO se estorna — pendente se cancela" },
      { status: 409 }
    );
  }

  // Aceito ANTES do último acerto já foi acertado — estornar agora tiraria
  // dinheiro de um ciclo fechado e o saldo atual nem mudaria. Sem volta.
  // ⚠️ `error` era descartado e `?? []` fazia o guard passar em silêncio
  // se a consulta falhasse — guard que falha aberto não é guard (21/08).
  const { data: acertoDepois, error: eAcerto } = await client
    .from("acertos")
    .select("id")
    .eq("motorista_id", atual.motorista_id)
    .gt("corte_em", atual.aceito_em)
    .limit(1);
  if (eAcerto) return NextResponse.json({ error: eAcerto.message }, { status: 400 });
  if ((acertoDepois ?? []).length > 0) {
    return NextResponse.json(
      { error: "esse adiantamento já entrou num acerto fechado — desfaça o acerto primeiro (no histórico do motorista)" },
      { status: 409 }
    );
  }

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nota = `[estornado em ${hoje}]`;
  const { data: mexeu, error } = await client
    .from("adiantamentos")
    .update({
      status: "cancelado",
      observacao: atual.observacao ? `${atual.observacao} ${nota}` : nota,
    })
    .eq("id", id)
    .eq("status", "aceito")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!mexeu?.length) {
    return NextResponse.json(
      { error: "esse adiantamento já mudou de situação — recarregue a tela" },
      { status: 409 }
    );
  }
  return NextResponse.json({
    ok: true,
    avisos: [
      "o valor voltou pro saldo da conta de onde saiu e deixou de contar na mão do motorista",
    ],
  });
}

/**
 * DELETE cancela adiantamento pendente. Atômico: só cancela se ainda pendente.
 * Se motorista aceitou entre load e clique, retorna 409.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const client = getSupabaseAdmin(admin.id);
  const { data, error } = await client
    .from("adiantamentos")
    .update({ status: "cancelado" })
    .eq("id", id)
    .eq("status", "pendente")
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) {
    return NextResponse.json(
      { error: "Motorista já aceitou esse adiantamento. Se quer reverter, faz ajuste manual no próximo acerto." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
