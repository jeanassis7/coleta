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

export async function POST(req: NextRequest) {
  const auth = await exigirAdmin();
  if (!auth) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { nome?: string; email?: string; senha?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const nome = body.nome?.trim();
  const email = body.email?.trim().toLowerCase();
  const senha = body.senha;
  const role = body.role === "admin" ? "admin" : "motorista";

  if (!nome || !email || !senha) {
    return NextResponse.json(
      { error: "nome, email, senha são obrigatórios" },
      { status: 400 }
    );
  }
  if (senha.length < 6) {
    return NextResponse.json(
      { error: "senha precisa ter ao menos 6 caracteres" },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: created, error: errAuth } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (errAuth || !created.user) {
    return NextResponse.json(
      { error: errAuth?.message || "falha ao criar" },
      { status: 400 }
    );
  }

  const { error: errProfile } = await admin.from("profiles").insert({
    id: created.user.id,
    nome,
    role,
    ativo: true,
    exige_foto: false,
    senha_visivel: senha,
  });

  if (errProfile) {
    // Rollback usuário criado
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: errProfile.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id });
}
