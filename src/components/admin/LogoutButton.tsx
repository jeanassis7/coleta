"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function sair() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <button
      onClick={sair}
      className="text-sm text-cinza-suave hover:text-alerta px-3 py-2"
    >
      Sair
    </button>
  );
}
