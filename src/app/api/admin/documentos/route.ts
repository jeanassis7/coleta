import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { TIPOS_DOC_CAMINHAO, TIPOS_DOC_MOTORISTA } from "@/lib/documentos";

/**
 * POST: cadastra um documento com vencimento, de caminhão OU de motorista.
 *
 * O banco tem CHECK de exatamente um dono (`um_dono_so`, migration 0026);
 * aqui a checagem é repetida pra devolver mensagem em português em vez do
 * 23514 cru do Postgres.
 *
 * Documento NÃO gera conta a pagar — decisão do plano do Módulo 2: ele vira
 * previsão recorrente, que é outra máquina. O `valor` aqui é histórico de
 * quanto custou renovar.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const caminhao_id = body.caminhao_id ? String(body.caminhao_id) : null;
  const motorista_id = body.motorista_id ? String(body.motorista_id) : null;
  const tipo = String(body.tipo || "");
  const descricao = body.descricao ? String(body.descricao).trim() : null;
  const vencimento = String(body.vencimento || "").trim();
  const valor =
    body.valor == null || body.valor === "" ? null : Number(body.valor);
  const arquivo_path = body.arquivo_path ? String(body.arquivo_path) : null;
  const alerta_dias = body.alerta_dias == null ? 30 : Number(body.alerta_dias);
  const observacao = body.observacao ? String(body.observacao).trim() : null;

  const donos = (caminhao_id ? 1 : 0) + (motorista_id ? 1 : 0);
  if (donos !== 1) {
    return NextResponse.json(
      { error: "o documento é de um caminhão OU de um motorista — escolha um" },
      { status: 400 }
    );
  }

  const permitidos = caminhao_id ? TIPOS_DOC_CAMINHAO : TIPOS_DOC_MOTORISTA;
  if (!permitidos.some((t) => t.valor === tipo)) {
    return NextResponse.json(
      { error: "tipo de documento inválido pra esse dono" },
      { status: 400 }
    );
  }
  if (tipo === "outro" && (!descricao || descricao.length < 2)) {
    return NextResponse.json(
      { error: 'escolheu "Outro" — escreva qual é o documento' },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
    return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
  }
  if (valor != null && (!Number.isFinite(valor) || valor < 0)) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!Number.isFinite(alerta_dias) || alerta_dias < 0 || alerta_dias > 365) {
    return NextResponse.json(
      { error: "aviso tem que ser entre 0 e 365 dias" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: criado, error } = await client
    .from("documentos")
    .insert({
      caminhao_id,
      motorista_id,
      tipo,
      descricao: tipo === "outro" ? descricao : null,
      vencimento,
      valor: valor == null ? null : Math.round(valor * 100) / 100,
      arquivo_path,
      alerta_dias,
      observacao,
      registrado_por: admin.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: criado.id });
}
