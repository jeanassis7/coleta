import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exigirAdmin } from "@/lib/auth/exigir-admin";


export async function POST(req: NextRequest) {
  const auth = await exigirAdmin();
  if (!auth) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: {
    nome?: string;
    email?: string;
    senha?: string;
    role?: string;
    /** true = pessoa de verdade (nasce com a trava de apagar, 0059). */
    permanente?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const nome = body.nome?.trim();
  const email = body.email?.trim().toLowerCase();
  const senha = body.senha;
  const role = body.role === "admin" ? "admin" : "motorista";
  // A trava de apagar (0059) se escolhe UMA vez, no nascimento — não existe
  // mais toggle depois. O default é TRANCADO de propósito: se um caminho
  // futuro esquecer de mandar o campo, o estrago é ter que destrancar por
  // SQL, não ter apagado o histórico de uma pessoa sem querer.
  const permanente = body.permanente !== false;

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

  const admin = getSupabaseAdmin(auth.id);
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
    protegido: permanente,
  });

  if (errProfile) {
    // Rollback usuário criado
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: errProfile.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id });
}
