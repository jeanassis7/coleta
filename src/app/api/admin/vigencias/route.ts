import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";

const TIPOS = ["salario", "comissao", "bonus", "transferencia_socio"];

/**
 * POST — cadastra uma vigência de remuneração.
 *
 * Não existe "editar o valor": mudou o valor, nasce uma vigência nova a
 * partir da data em que passou a valer. É isso que faz o passado continuar
 * batendo depois de um aumento.
 */
export async function POST(req: NextRequest) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const tipo = String(body.tipo || "");
  const valor = Number(body.valor);
  const vigente_desde = String(body.vigente_desde || "").trim();
  const pessoa_id = body.pessoa_id ? String(body.pessoa_id) : null;
  const litros_base =
    body.litros_base == null || body.litros_base === ""
      ? null
      : Number(body.litros_base);

  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigente_desde)) {
    return NextResponse.json(
      { error: "diga a partir de que dia esse valor vale" },
      { status: 400 }
    );
  }
  if (tipo === "comissao") {
    if (!litros_base || !Number.isFinite(litros_base) || litros_base <= 0) {
      return NextResponse.json(
        { error: "comissão precisa da base de litros (ex: 200)" },
        { status: 400 }
      );
    }
  } else if (litros_base != null) {
    return NextResponse.json(
      { error: "só comissão usa base de litros" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("vigencias_remuneracao").insert({
    pessoa_id,
    tipo,
    valor: Math.round(valor * 100) / 100,
    litros_base: tipo === "comissao" ? litros_base : null,
    vigente_desde,
    observacao: body.observacao ? String(body.observacao).trim() : null,
    registrado_por: admin.id,
  });

  if (error) {
    // A unique (pessoa, tipo, data) recusa duas vigências começando no mesmo
    // dia — seria ambíguo qual vale, e o banco prefere recusar a escolher.
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Já existe uma vigência desse tipo começando nessa data. Apague a outra ou escolha outro dia.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
