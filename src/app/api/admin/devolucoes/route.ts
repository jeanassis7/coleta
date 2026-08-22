import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

/**
 * POST — devolução de troco do motorista no MEIO do ciclo (0047).
 *
 * "Toma R$ 500 de volta, continuo rodando." Sai do saldo na mão dele
 * (braço próprio da saldos_motoristas) e entra na conta escolhida — sem
 * fechar acerto, sem mexer no corte do ciclo.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();

  const motorista_id = String(body.motorista_id || "");
  const valor = Number(body.valor);
  const data = String(body.data || "").trim();
  const conta_id = body.conta_id ? String(body.conta_id) : null;

  if (!motorista_id) {
    return NextResponse.json({ error: "motorista_id obrigatório" }, { status: 400 });
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
  if (!conta_id) {
    return NextResponse.json(
      { error: "diga em qual conta o dinheiro entrou" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #1 — devolver MAIS do que ele tem na mão
  // ---------------------------------------------------------------------
  // Sem isto, digitar 500000 achando que são R$ 500,00 fazia entrar R$
  // 5.000 numa conta que nunca recebeu esse dinheiro, e o saldo do
  // motorista virava −4.500 — estado que o sistema aceita como legítimo
  // (0011: empresa deve pro motorista), então ninguém estranhava.
  const { data: saldos } = await client.rpc("saldos_motoristas");
  const meu = ((saldos as { motorista_id: string; saldo: number }[]) ?? []).find(
    (s) => s.motorista_id === motorista_id
  );
  const naMao = Math.round(Number(meu?.saldo ?? 0) * 100) / 100;
  const passa = Math.round((valor - naMao) * 100) / 100;
  if (passa > 0.009 && !body.confirmado) {
    return NextResponse.json(
      {
        error:
          naMao <= 0
            ? `Esse motorista não tem dinheiro da empresa na mão (saldo ${naMao.toFixed(
                2
              )}). Devolver ${valor.toFixed(2)} deixaria a empresa devendo pra ele.`
            : `Ele tem ${naMao.toFixed(2)} na mão e a devolução é de ${valor.toFixed(
                2
              )} — passa ${passa.toFixed(
                2
              )}. Confira se não faltou lançar coleta ou despesa dele. Se está certo mesmo, confirme.`,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  // ---------------------------------------------------------------------
  // RÉGUA DO DINHEIRO #4/#5 — data retroativa caindo em ciclo já fechado
  // ---------------------------------------------------------------------
  // O DELETE desta mesma rota já tinha esse guard; o POST não tinha. A
  // devolução desconta do saldo por `criado_em`, então uma datada antes do
  // último acerto credita a conta no passado e tira do ciclo ATUAL um
  // valor que o acerto anterior já dividiu.
  const { data: ultimoAcerto, error: eAcerto } = await client
    .from("acertos")
    .select("corte_em")
    .eq("motorista_id", motorista_id)
    .order("corte_em", { ascending: false })
    .limit(1);
  if (eAcerto) return NextResponse.json({ error: eAcerto.message }, { status: 400 });
  const corte = (ultimoAcerto ?? [])[0]?.corte_em as string | undefined;
  if (corte && data < corte.slice(0, 10) && !body.confirmado) {
    return NextResponse.json(
      {
        error: `A data ${data} é anterior ao último acerto dele (${corte.slice(
          0,
          10
        )}), que já dividiu o saldo daquele período. Lançada assim, ela sai do saldo de AGORA. Se é isso mesmo, confirme.`,
        precisaConfirmar: true,
      },
      { status: 409 }
    );
  }

  const { error } = await client.from("devolucoes_motorista").insert({
    motorista_id,
    valor: Math.round(valor * 100) / 100,
    data,
    conta_id,
    observacao: body.observacao ? String(body.observacao).trim() : null,
    registrado_por: admin.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
