import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

const exigirAdmin = exigirAcessoModulo1;

/**
 * O cheque tem DOIS RELÓGIOS:
 *   • a dívida do comprador quita quando ele entrega o papel
 *   • o dinheiro entra quando o cheque compensa
 * Por isso "em carteira" não é caixa, e devolver ressuscita a dívida sozinho
 * (a saldo_compradores() ignora recebimento de cheque devolvido).
 *
 * Cada ação declara DE QUAIS estados ela pode sair. O update carrega esses
 * estados no WHERE — se voltar 0 linhas, alguém já mexeu no cheque em outra
 * aba e a resposta é 409 em vez de sobrescrever em silêncio. Mesmo padrão
 * do aceite de adiantamento.
 */
const TRANSICOES: Record<
  string,
  { de: string[]; para: string; carimbo: string }
> = {
  depositar: {
    de: ["em_carteira", "devolvido"], // devolvido → reapresentado no banco
    para: "depositado",
    carimbo: "depositado_em",
  },
  compensar: { de: ["depositado"], para: "compensado", carimbo: "compensado_em" },
  devolver: {
    de: ["em_carteira", "depositado", "repassado"],
    para: "devolvido",
    carimbo: "devolvido_em",
  },
  repassar: { de: ["em_carteira"], para: "repassado", carimbo: "repassado_em" },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  const t = TRANSICOES[String(body.acao || "")];
  if (!t) return NextResponse.json({ error: "ação inválida" }, { status: 400 });

  const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const updates: Record<string, unknown> = {
    status: t.para,
    [t.carimbo]: body.data && /^\d{4}-\d{2}-\d{2}$/.test(body.data) ? body.data : hoje,
  };

  if (t.para === "repassado") {
    const para = String(body.repassado_para || "").trim();
    if (para.length < 2) {
      return NextResponse.json(
        { error: "diga pra quem o cheque foi" },
        { status: 400 }
      );
    }
    updates.repassado_para = para;
  }

  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("cheques")
    .update(updates)
    .eq("id", id)
    .in("status", t.de)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "esse cheque já mudou de situação — recarregue a tela" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, cheque: data[0] });
}
