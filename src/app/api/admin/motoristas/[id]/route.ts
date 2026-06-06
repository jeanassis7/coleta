import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function exigirAdmin() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.ativo) return null;
  return user;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const admin = await exigirAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.ativo === "boolean") updates.ativo = body.ativo;
  if (typeof body.exige_foto === "boolean") updates.exige_foto = body.exige_foto;
  if (typeof body.nome === "string" && body.nome.trim()) updates.nome = body.nome.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nada a atualizar" }, { status: 400 });
  }

  const adminClient = getSupabaseAdmin();

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
  const adminClient = getSupabaseAdmin();
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

  if (id === admin.id) {
    return NextResponse.json(
      { error: "você não pode deletar seu próprio usuário" },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const forcado = url.searchParams.get("forcado") === "1";

  const adminClient = getSupabaseAdmin();

  // Conta coletas do motorista
  const { count: numColetas } = await adminClient
    .from("coletas")
    .select("id", { count: "exact", head: true })
    .eq("motorista_id", id);

  if ((numColetas ?? 0) > 0 && !forcado) {
    return NextResponse.json(
      {
        error: "tem_coletas",
        coletas: numColetas,
        mensagem: `Esse usuário tem ${numColetas} coleta(s). Pra deletar mesmo assim, confirma com forcado=1.`,
      },
      { status: 409 }
    );
  }

  // Se forcado: deleta fotos do storage
  if (forcado && (numColetas ?? 0) > 0) {
    const { data: fotos } = await adminClient
      .from("coletas")
      .select("foto_path")
      .eq("motorista_id", id)
      .not("foto_path", "is", null);

    const paths = (fotos || [])
      .map((f) => f.foto_path)
      .filter((p): p is string => !!p);

    if (paths.length > 0) {
      await adminClient.storage.from("fotos-coletas").remove(paths);
    }

    // Deleta coletas
    await adminClient.from("coletas").delete().eq("motorista_id", id);
  }

  // Deleta app_events relacionados
  await adminClient.from("app_events").delete().eq("motorista_id", id);

  // Deleta profile
  await adminClient.from("profiles").delete().eq("id", id);

  // Deleta auth.user (cascade pega o resto)
  const { error: errAuth } = await adminClient.auth.admin.deleteUser(id);
  if (errAuth) {
    return NextResponse.json({ error: errAuth.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, coletas_deletadas: forcado ? numColetas : 0 });
}
