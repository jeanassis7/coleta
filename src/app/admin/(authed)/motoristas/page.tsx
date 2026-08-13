import { buscarMotoristasComEmail } from "@/lib/admin/queries";
import { TabelaMotoristas } from "@/components/admin/TabelaMotoristas";
import { FormCriarMotorista } from "@/components/admin/FormCriarMotorista";
import { getSupabaseServer } from "@/lib/supabase/server";
import { isDev } from "@/lib/auth/roles";
import { acessoModulo1Atual } from "@/lib/auth/gate-modulo1";

export const dynamic = "force-dynamic";

export default async function MotoristasPage() {
  const motoristas = await buscarMotoristasComEmail({ incluirTeste: true });
  // Coluna do saldo no app faz parte do Módulo 1 — segue o mesmo gate
  const { temAcesso: verModulo1 } = await acessoModulo1Atual();

  // Só o dev vê o checkbox "motorista de teste" no form de criação
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: viewer } = user
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Motoristas</h1>
        <FormCriarMotorista ehDev={isDev(viewer)} />
      </div>
      <TabelaMotoristas
        motoristas={motoristas}
        mostrarColunaSaldo={verModulo1}
      />
    </div>
  );
}
