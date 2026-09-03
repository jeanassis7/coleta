import { getSupabaseServer } from "@/lib/supabase/server";
import { selectTudo } from "@/lib/supabase/select-tudo";

/**
 * Postos de combustível — o lugar onde a nota é assinada.
 *
 * Posto NÃO tem tabela própria: é `locais` com `tipo='posto'` (0018). Assim
 * a busca por GPS (`locais_proximos`) e a curadoria valem de graça, e não
 * existem duas donas da mesma verdade sobre "onde fica o Texas".
 *
 * A dívida também não é copiada pra cá: ela mora em `contas_a_pagar`, e o
 * posto vem pelo abastecimento que a originou.
 */
export interface PostoComSaldo {
  id: string;
  nome: string;
  notas_abertas: number;
  saldo: number;
}

export async function buscarPostosComSaldo(): Promise<PostoComSaldo[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("saldo_postos");
  if (error || !data) return [];
  return (data as { local_id: string; nome: string; notas_abertas: number; saldo: number }[])
    .map((p) => ({
      id: p.local_id,
      nome: p.nome,
      notas_abertas: Number(p.notas_abertas),
      saldo: Number(p.saldo),
    }))
    .sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome));
}

export interface NotaDoPosto {
  conta_id: string | null;
  abastecimento_id: string;
  quando: string;
  quem: string;
  veiculo: string;
  litros: number;
  valor: number;
  /** 'a_pagar' | 'paga' | 'prevista' | null (sem conta: foi pago na hora) */
  status: string | null;
  pago_em: string | null;
  /** true = particular de sócio, não é custo da operação (0061) */
  do_socio: boolean;
}

export interface PostoDetalhe {
  id: string;
  nome: string;
  apelidos: string[];
  latitude: number;
  longitude: number;
  notas: NotaDoPosto[];
  saldo: number;
}

export async function buscarPostoDetalhe(
  id: string
): Promise<PostoDetalhe | null> {
  const supabase = await getSupabaseServer();

  const { data: local } = await supabase
    .from("locais")
    .select("id, nome_canonico, apelidos, latitude, longitude, tipo")
    .eq("id", id)
    .maybeSingle();
  if (!local || (local as { tipo: string }).tipo !== "posto") return null;

  // PAGINADO: o histórico de um posto cresce sem teto natural — em um ano
  // de operação são centenas de notas.
  const abast = await selectTudo<{
    id: string;
    criado_em: string;
    litros: number;
    valor: number;
    socio_id: string | null;
    profiles: { nome: string } | null;
    socio: { nome: string } | null;
    caminhoes: { placa: string } | null;
  }>((de, ate) =>
    supabase
      .from("abastecimentos")
      .select(
        `id, criado_em, litros, valor, socio_id,
         profiles!abastecimentos_motorista_id_fkey(nome),
         socio:profiles!abastecimentos_socio_id_fkey(nome),
         caminhoes!abastecimentos_caminhao_id_fkey(placa)`
      )
      .eq("local_id", id)
      .order("criado_em", { ascending: false })
      .order("id")
      .range(de, ate)
  );

  const ids = abast.map((a) => a.id);
  const contas = ids.length
    ? await selectTudo<{
        id: string;
        origem_id: string;
        status: string;
        pago_em: string | null;
      }>((de, ate) =>
        supabase
          .from("contas_a_pagar")
          .select("id, origem_id, status, pago_em")
          .eq("origem_tipo", "abastecimento")
          .in("origem_id", ids)
          .order("id")
          .range(de, ate)
      )
    : [];
  const porOrigem = new Map(contas.map((c) => [c.origem_id, c]));

  const notas: NotaDoPosto[] = abast.map((a) => {
    const c = porOrigem.get(a.id);
    return {
      conta_id: c?.id ?? null,
      abastecimento_id: a.id,
      quando: a.criado_em,
      quem: a.socio?.nome
        ? `${a.socio.nome} (particular)`
        : (a.profiles?.nome ?? "painel"),
      veiculo: a.caminhoes?.placa ?? "—",
      litros: Number(a.litros),
      valor: Number(a.valor),
      status: c?.status ?? null,
      pago_em: c?.pago_em ?? null,
      do_socio: a.socio_id !== null,
    };
  });

  const l = local as unknown as {
    id: string;
    nome_canonico: string;
    apelidos: string[] | null;
    latitude: number;
    longitude: number;
  };

  return {
    id: l.id,
    nome: l.nome_canonico,
    apelidos: l.apelidos ?? [],
    latitude: l.latitude,
    longitude: l.longitude,
    notas,
    saldo: notas
      .filter((n) => n.status === "a_pagar")
      .reduce((s, n) => s + n.valor, 0),
  };
}
