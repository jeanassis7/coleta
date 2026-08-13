import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isDev } from "@/lib/auth/roles";

/**
 * Layout aninhado /admin/dev/*
 * Bloqueia tudo aqui pra quem NÃO é dev — mesmo admin (Jean) não entra.
 */
export default async function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!isDev(profile)) {
    redirect("/admin");
  }

  return <>{children}</>;
}
