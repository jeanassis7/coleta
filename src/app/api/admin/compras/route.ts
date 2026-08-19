import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAcessoModulo1 } from "@/lib/auth/gate-modulo1";

// Módulo 1 — Estágio 1: dev-only. Promoção pro Jean é um flip em gate-modulo1.ts.
const exigirAdmin = exigirAcessoModulo1;

/** POST: registra uma compra direta de óleo feita pelo gestor. */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const data = String(body.data || "").trim();
  const fornecedor = String(body.fornecedor || "").trim();
  const valor = Number(body.valor);
  const quantidade = Number(body.quantidade);
  const unidade = String(body.unidade || "");
  const tipo_oleo = body.tipo_oleo === "grosso" ? "grosso" : "fino";
  const entra_no_estoque = body.entra_no_estoque !== false;
  const foto_path = body.foto_path ? String(body.foto_path) : null;
  const observacao = body.observacao ? String(body.observacao).trim() : null;
  const certificado_tipo = ["integral", "parcial", "nao"].includes(
    body.certificado_tipo
  )
    ? body.certificado_tipo
    : "nao";
  // Integral = tudo que entrou; parcial = o que o gestor informar
  let litros_certificado: number | null = null;
  if (certificado_tipo === "parcial") {
    const n = Number(body.litros_certificado);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "certificado parcial precisa dos litros" },
        { status: 400 }
      );
    }
    litros_certificado = Math.round(n * 100) / 100;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "data inválida" }, { status: 400 });
  }
  if (fornecedor.length < 2) {
    return NextResponse.json({ error: "diga de quem comprou" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return NextResponse.json({ error: "quantidade inválida" }, { status: 400 });
  }
  if (!["kg", "litros"].includes(unidade)) {
    return NextResponse.json({ error: "unidade deve ser kg ou litros" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { data: criada, error } = await client
    .from("compras_diretas")
    .insert({
      data,
      fornecedor,
      valor: Math.round(valor * 100) / 100,
      quantidade: Math.round(quantidade * 100) / 100,
      unidade,
      tipo_oleo,
      entra_no_estoque,
      certificado_tipo,
      litros_certificado:
        certificado_tipo === "integral"
          ? unidade === "litros"
            ? Math.round(quantidade * 100) / 100
            : Math.round((quantidade / 0.9) * 100) / 100
          : litros_certificado,
      foto_path,
      observacao,
      registrado_por: admin.id,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, compra: criada });
}
