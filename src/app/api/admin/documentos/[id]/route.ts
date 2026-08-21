import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";
import { TIPOS_DOC_CAMINHAO, TIPOS_DOC_MOTORISTA } from "@/lib/documentos";
import { categoriaDeDocumento } from "@/lib/plano-contas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH: renovar é o caso comum — muda o vencimento (e às vezes o arquivo).
 * Dono e tipo NÃO são editáveis: documento que mudou de dono é outro
 * documento, e trocar isso por engano some com o histórico do anterior.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.vencimento != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.vencimento))) {
      return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
    }
    updates.vencimento = body.vencimento;
  }
  if (body.valor !== undefined) {
    if (body.valor === "" || body.valor == null) {
      updates.valor = null;
    } else {
      const v = Number(body.valor);
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: "valor inválido" }, { status: 400 });
      }
      updates.valor = Math.round(v * 100) / 100;
    }
  }
  if (body.alerta_dias != null) {
    const d = Number(body.alerta_dias);
    if (!Number.isFinite(d) || d < 0 || d > 365) {
      return NextResponse.json(
        { error: "aviso tem que ser entre 0 e 365 dias" },
        { status: 400 }
      );
    }
    updates.alerta_dias = d;
  }
  if (body.arquivo_path !== undefined) {
    updates.arquivo_path = body.arquivo_path
      ? String(body.arquivo_path)
      : null;
  }
  if (body.descricao !== undefined) {
    updates.descricao = body.descricao ? String(body.descricao).trim() : null;
  }
  if (body.observacao !== undefined) {
    updates.observacao = body.observacao
      ? String(body.observacao).trim()
      : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const client = getSupabaseAdmin(admin.id);
  const { error } = await client.from("documentos").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Sincroniza a previsão no caixa. Se mudou vencimento ou valor, a linha
  // que já existe tem que acompanhar — senão renovar o IPVA deixa a previsão
  // velha pendurada e o fluxo de caixa passa a mentir.
  if (updates.vencimento !== undefined || updates.valor !== undefined) {
    const { data: doc } = await client
      .from("documentos")
      .select("tipo, descricao, vencimento, valor, caminhao_id")
      .eq("id", id)
      .maybeSingle();

    // Só mexe na conta que AINDA NÃO foi paga. Se a anterior já virou
    // 'paga', ela é histórico do ano passado — e a nova é a renovação.
    //
    // 'a_pagar' TAMBÉM conta como pendente: quando o Jean confirma o valor
    // da previsão (prevista → a_pagar) e depois edita o documento, o filtro
    // antigo (só 'prevista') não achava nada e criava uma SEGUNDA conta da
    // mesma coisa — dívida real + previsão fantasma, e o maybeSingle() com
    // duas linhas passava a falhar em silêncio e criar mais uma a cada
    // edição. `limit(1)` em vez de maybeSingle: nunca explode com N linhas.
    const { data: pendentes, error: ePend } = await client
      .from("contas_a_pagar")
      .select("id, status")
      .eq("origem_tipo", "documento")
      .eq("origem_id", id)
      .in("status", ["prevista", "a_pagar"])
      .order("criado_em", { ascending: true })
      .limit(1);
    if (ePend) {
      return NextResponse.json({
        ok: true,
        aviso: `documento salvo, mas não consegui conferir a conta prevista: ${ePend.message}`,
      });
    }
    const pendente = (pendentes ?? [])[0] ?? null;

    const temValor = doc?.valor != null && Number(doc.valor) > 0;

    if (pendente && !temValor) {
      // Tirou o valor: a previsão perde o sentido.
      await client.from("contas_a_pagar").delete().eq("id", pendente.id);
    } else if (pendente && temValor) {
      await client
        .from("contas_a_pagar")
        .update({
          descricao: `${rotuloDoc(doc!.tipo, doc!.descricao)} — vence ${doc!.vencimento}`,
          valor: doc!.valor,
          vencimento: doc!.vencimento,
        })
        .eq("id", pendente.id);
    } else if (!pendente && temValor) {
      await client.from("contas_a_pagar").insert({
        descricao: `${rotuloDoc(doc!.tipo, doc!.descricao)} — vence ${doc!.vencimento}`,
        categoria: categoriaDeDocumento(
          doc!.tipo,
          doc!.caminhao_id ? "caminhao" : "motorista"
        ),
        valor: doc!.valor,
        vencimento: doc!.vencimento,
        status: "prevista",
        origem_tipo: "documento",
        origem_id: id,
        registrado_por: admin.id,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Rótulo legível pro texto da conta prevista. */
function rotuloDoc(tipo: string, descricao: string | null): string {
  if (tipo === "outro") return descricao?.trim() || "Documento";
  const achado =
    TIPOS_DOC_CAMINHAO.find((t) => t.valor === tipo) ??
    TIPOS_DOC_MOTORISTA.find((t) => t.valor === tipo);
  return achado?.label ?? tipo;
}

/** DELETE: apaga o cadastro. O arquivo no Storage vai junto, se houver. */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const client = getSupabaseAdmin(admin.id);
  const { data: doc } = await client
    .from("documentos")
    .select("arquivo_path")
    .eq("id", id)
    .maybeSingle();

  // A previsão que ainda não foi paga vai junto: sem o documento ela vira
  // linha órfã no fluxo de caixa. Conta JÁ PAGA fica — aquilo aconteceu, e
  // apagar histórico de dinheiro reescreve o caixa.
  await client
    .from("contas_a_pagar")
    .delete()
    .eq("origem_tipo", "documento")
    .eq("origem_id", id)
    .eq("status", "prevista");

  const { error } = await client.from("documentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Arquivo órfão no bucket é lixo que ninguém vê e ninguém limpa. Falha
  // aqui não desfaz o delete — o cadastro já foi, e é ele que a tela mostra.
  if (doc?.arquivo_path) {
    await client.storage.from("documentos").remove([doc.arquivo_path]);
  }

  return NextResponse.json({ ok: true });
}
