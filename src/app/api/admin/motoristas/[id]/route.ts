import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";


interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  // Um cliente só por handler: é o que faz todas as gravações deste clique
  // compartilharem o mesmo id de operação e saírem agrupadas no log.
  const adminClient = getSupabaseAdmin(admin.id);

  // Desativar admin é caminho sem volta. O middleware tranca na hora e não
  // existe mais o papel `dev` como backdoor — quem se desativar (ou for
  // desativado) só volta por SQL direto no banco.
  //
  // A checagem tem que ser AQUI, não só no checkbox da tela: desabilitar o
  // input não impede uma chamada direta na API.
  if (body.ativo === false) {
    const { data: alvo } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    if (alvo?.role === "admin") {
      return NextResponse.json(
        {
          error:
            "Não dá pra desativar um admin por aqui — quem perde o acesso não consegue voltar sozinho.",
        },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.ativo === "boolean") updates.ativo = body.ativo;
  if (typeof body.exige_foto === "boolean") updates.exige_foto = body.exige_foto;
  // O saldo no app é UMA experiência só: a tela de aceite de adiantamento
  // (gated por features.saldo) e o card "Seu dinheiro" (mostra_saldo_app).
  // Ligar só metade deixaria o motorista com card sem tela de aceite —
  // por isso o servidor move os dois juntos, venha de onde vier.
  if (typeof body.mostra_saldo_app === "boolean") {
    updates.mostra_saldo_app = body.mostra_saldo_app;
    const { data: atual } = await adminClient
      .from("profiles")
      .select("features")
      .eq("id", id)
      .maybeSingle();
    updates.features = {
      ...((atual?.features as Record<string, unknown>) || {}),
      saldo: body.mostra_saldo_app,
    };
  }
  if (typeof body.nome === "string" && body.nome.trim()) updates.nome = body.nome.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  // Se mudou exige_foto, registra evento
  if ("exige_foto" in updates) {
    const { data: anterior } = await adminClient
      .from("profiles")
      .select("exige_foto, nome")
      .eq("id", id)
      .maybeSingle();

    await adminClient.from("app_events").insert({
      motorista_id: id,
      event_type: "foto_toggle_changed",
      payload: {
        de: anterior?.exige_foto ?? false,
        para: updates.exige_foto,
        alterado_por: admin.id,
      },
    });
  }

  const { error } = await adminClient
    .from("profiles")
    .update(updates)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  // Reset de senha
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const { senha } = await req.json();
  if (!senha || typeof senha !== "string" || senha.length < 6) {
    return NextResponse.json(
      { error: "senha precisa ter ao menos 6 caracteres" },
      { status: 400 }
    );
  }
  const adminClient = getSupabaseAdmin(admin.id);
  const { error } = await adminClient.auth.admin.updateUserById(id, {
    password: senha,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Atualiza a senha visível também
  await adminClient
    .from("profiles")
    .update({ senha_visivel: senha })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const url = new URL(req.url);
  const forcado = url.searchParams.get("forcado") === "1";

  const adminClient = getSupabaseAdmin(admin.id);

  // Nenhum admin é deletável pelo painel — nem você mesmo, nem o outro.
  // Antes só a si próprio era protegido, o que deixava um gestor apagar o
  // usuário do outro. Sem o papel `dev` não existe backdoor: o usuário
  // apagado sai do Supabase Auth e só volta por script.
  // A checagem é no servidor porque esconder o botão não impede a chamada.
  const { data: alvo } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (alvo?.role === "admin") {
    return NextResponse.json(
      {
        error:
          "Admin não pode ser deletado pelo painel. Mude o papel pra motorista antes, se for isso mesmo.",
      },
      { status: 400 }
    );
  }

  // ANTES de destruir qualquer coisa, levanta TUDO que é dele. Sem o
  // forcado, recusa com a lista (motorista real se DESATIVA, não se
  // deleta). COM forcado, apaga tudo na ordem certa das FKs — é o fluxo do
  // perfil de teste (decisão do Evaner: testa-se com perfil normal e
  // apaga-se depois, com carga, dinheiro e tudo).
  const [
    { data: cargasDele },
    { data: coletasDele },
    { data: despesasDele },
    { data: abastDele },
    { count: nAdiant },
    { count: nAcertos },
  ] = await Promise.all([
    adminClient.from("cargas").select("id, foto_painel_path").eq("motorista_id", id),
    adminClient.from("coletas").select("id, foto_path").eq("motorista_id", id),
    adminClient.from("despesas").select("id, foto_path").eq("motorista_id", id),
    adminClient.from("abastecimentos").select("id, foto_path").eq("motorista_id", id),
    adminClient.from("adiantamentos").select("id", { count: "exact", head: true }).eq("motorista_id", id),
    adminClient.from("acertos").select("id", { count: "exact", head: true }).eq("motorista_id", id),
  ]);
  const cargaIds = (cargasDele ?? []).map((c) => c.id);
  const coletaIds = (coletasDele ?? []).map((c) => c.id);
  const abastIds = (abastDele ?? []).map((a) => a.id);

  const resumo: string[] = [];
  if (cargaIds.length) resumo.push(`${cargaIds.length} carga(s)`);
  if (coletaIds.length) resumo.push(`${coletaIds.length} coleta(s)`);
  if ((despesasDele ?? []).length) resumo.push(`${despesasDele!.length} despesa(s)`);
  if (abastIds.length) resumo.push(`${abastIds.length} abastecimento(s)`);
  if (nAdiant) resumo.push(`${nAdiant} adiantamento(s)`);
  if (nAcertos) resumo.push(`${nAcertos} acerto(s)`);

  if (resumo.length > 0 && !forcado) {
    return NextResponse.json(
      {
        error: "tem_movimento",
        mensagem: `Esse usuário tem ${resumo.join(", ")}. Motorista de verdade se DESATIVA (o histórico fica). Apagar TUDO de vez é só pra perfil de teste — e não tem volta.`,
      },
      { status: 409 }
    );
  }

  if (forcado && resumo.length > 0) {
    // Contas a pagar amarradas ao que é dele (nota assinada por trigger,
    // coleta paga pela sede) ou registradas por ele — morrem primeiro.
    const orConta = [
      `registrado_por.eq.${id}`,
      abastIds.length
        ? `and(origem_tipo.eq.abastecimento,origem_id.in.(${abastIds.join(",")}))`
        : null,
      coletaIds.length
        ? `and(origem_tipo.eq.coleta,origem_id.in.(${coletaIds.join(",")}))`
        : null,
    ].filter(Boolean) as string[];
    const { error: eContas } = await adminClient
      .from("contas_a_pagar")
      .delete()
      .or(orConta.join(","));
    if (eContas) return NextResponse.json({ error: eContas.message }, { status: 400 });

    // Ordem das FKs: filhos da carga primeiro, a carga depois.
    const passos: Array<() => PromiseLike<{ error: { message: string } | null }>> = [
      () => adminClient.from("descargas").delete().in("carga_id", cargaIds.length ? cargaIds : ["00000000-0000-0000-0000-000000000000"]),
      () => adminClient.from("coletas").delete().eq("motorista_id", id),
      () => adminClient.from("despesas").delete().eq("motorista_id", id),
      () => adminClient.from("abastecimentos").delete().eq("motorista_id", id),
      () => adminClient.from("cargas").delete().eq("motorista_id", id),
      () => adminClient.from("acertos").delete().eq("motorista_id", id),
      () => adminClient.from("adiantamentos").delete().eq("motorista_id", id),
    ];
    for (const passo of passos) {
      const { error } = await passo();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Fotos por último (dado primeiro, blob depois — blob órfão é inócuo,
    // dado órfão não).
    const paths = [
      ...(coletasDele ?? []).map((c) => c.foto_path),
      ...(despesasDele ?? []).map((d) => d.foto_path),
      ...(abastDele ?? []).map((a) => a.foto_path),
      ...(cargasDele ?? []).map((c) => c.foto_painel_path),
    ].filter((p): p is string => !!p);
    if (paths.length > 0) {
      await adminClient.storage.from("fotos-coletas").remove(paths);
    }
  }
  const numColetas = coletaIds.length;

  // Documentos morrem por cascade junto com o profile — mas a conta
  // PREVISTA de cada um e o arquivo no bucket não. Limpa antes (mesma
  // lógica do delete individual de documento).
  const { data: docsDoMotorista } = await adminClient
    .from("documentos")
    .select("id, arquivo_path")
    .eq("motorista_id", id);
  const docIds = (docsDoMotorista ?? []).map((d) => d.id);
  if (docIds.length > 0) {
    const { error: ePrev } = await adminClient
      .from("contas_a_pagar")
      .delete()
      .eq("origem_tipo", "documento")
      .in("origem_id", docIds)
      .in("status", ["prevista", "a_pagar"]);
    if (ePrev) return NextResponse.json({ error: ePrev.message }, { status: 400 });
    const pathsDocs = (docsDoMotorista ?? [])
      .map((d) => d.arquivo_path)
      .filter((p): p is string => !!p);
    if (pathsDocs.length > 0) {
      await adminClient.storage.from("documentos").remove(pathsDocs);
    }
  }

  // Deleta app_events relacionados
  const { error: errEventos } = await adminClient
    .from("app_events")
    .delete()
    .eq("motorista_id", id);
  if (errEventos) {
    return NextResponse.json({ error: errEventos.message }, { status: 400 });
  }

  // Deleta profile — ERRO AQUI TEM QUE PARAR TUDO (o bug histórico do
  // Valdecir era exatamente um update/delete falhando calado).
  const { error: errProfile } = await adminClient
    .from("profiles")
    .delete()
    .eq("id", id);
  if (errProfile) {
    return NextResponse.json({ error: errProfile.message }, { status: 400 });
  }

  // Deleta auth.user (cascade pega o resto)
  const { error: errAuth } = await adminClient.auth.admin.deleteUser(id);
  if (errAuth) {
    return NextResponse.json({ error: errAuth.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, coletas_deletadas: forcado ? numColetas : 0 });
}
