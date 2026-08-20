import { getSupabaseServer } from "@/lib/supabase/server";
import type {
  TipoRemuneracao,
  Vigencia,
  ComissaoMotorista,
} from "@/lib/remuneracao-tipos";

/**
 * Remuneração com vigência.
 *
 * Um valor que vale A PARTIR de uma data. Mudar hoje não mexe em nada do
 * passado — é isso que faz o histórico parar de pé.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO ALIMENTA O DRE DIRETO
 * ---------------------------------------------------------------------------
 * O DRE é regime de CAIXA: só conta dinheiro que saiu. Comissão calculada
 * não é comissão paga. Então a vigência serve pra CALCULAR quanto se deve —
 * e o DRE só vê quando o pagamento é lançado.
 *
 * Sem essa separação a comissão apareceria no resultado antes de sair do
 * bolso, e o mês fecharia com um gasto que ainda não aconteceu.
 */

// Tipos e rótulos moram em `@/lib/remuneracao-tipos` — sem import de
// servidor, pra que os componentes client possam usá-los sem arrastar o
// `next/headers` junto e quebrar o build.
export type {
  TipoRemuneracao,
  Vigencia,
  ComissaoMotorista,
} from "@/lib/remuneracao-tipos";
export { TIPOS_REMUNERACAO } from "@/lib/remuneracao-tipos";

export async function buscarVigencias(): Promise<Vigencia[]> {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("vigencias_remuneracao")
    .select("*")
    .order("tipo")
    .order("vigente_desde", { ascending: false });
  if (error) throw error;
  return ((data as Vigencia[]) || []).map((v) => ({
    ...v,
    valor: Number(v.valor),
  }));
}

/**
 * A vigência que vale pra um fato numa data.
 *
 * Regra: a de MAIOR `vigente_desde` que seja <= a data, preferindo a
 * específica da pessoa sobre a geral da empresa. Se as duas começam no mesmo
 * dia, a da pessoa vence — é o caso de "todo mundo ganha X, menos o Luis".
 */
export function vigenciaEm(
  vigencias: Vigencia[],
  tipo: TipoRemuneracao,
  pessoaId: string,
  data: string
): Vigencia | null {
  const candidatas = vigencias.filter(
    (v) =>
      v.tipo === tipo &&
      v.vigente_desde <= data &&
      (v.pessoa_id === pessoaId || v.pessoa_id === null)
  );
  if (candidatas.length === 0) return null;

  candidatas.sort((a, b) => {
    if (a.vigente_desde !== b.vigente_desde) {
      return a.vigente_desde < b.vigente_desde ? 1 : -1;
    }
    // Mesmo dia: a da pessoa manda.
    const especifica = (v: Vigencia) => (v.pessoa_id ? 0 : 1);
    return especifica(a) - especifica(b);
  });
  return candidatas[0];
}

/**
 * Quanto de comissão cada motorista acumulou num período.
 *
 * A BASE SÃO OS LITROS DA DESCARGA (R108) — o peso da balança convertido em
 * litros, não a soma do que foi declarado nas coletas. O argumento decisivo:
 * a balança pesa o que tem no caminhão, inclusive a coleta que o motorista
 * esqueceu de lançar e o admin digitou depois — o retroativo é absorvido
 * sozinho, sem regra especial nenhuma.
 *
 * Casos de borda, resolvidos pela própria consulta:
 *  - carga CANCELADA não tem descarga → não entra;
 *  - carga ABERTA ainda não pesou → fica pendente até descarregar;
 *  - a vigência que vale é a DO DIA DA DESCARGA (a pesagem é o fato gerador).
 *
 * PROPORCIONAL: `litros ÷ litros_base × valor`. 100 L numa base de 200 paga
 * metade — decisão do Evaner, não é bloco fechado.
 */
export async function calcularComissao(
  inicio: string,
  fim: string
): Promise<ComissaoMotorista[]> {
  const supabase = await getSupabaseServer();
  const de = new Date(`${inicio}T00:00:00.000-03:00`).toISOString();
  const ate = new Date(`${fim}T23:59:59.999-03:00`).toISOString();

  const [{ data: descargas, error: eDesc }, { data: perfis }, vigencias] =
    await Promise.all([
      // descargas não tem motorista_id — o dono vem da carga. Só carga
      // ENCERRADA: a descarga é o que encerra, e cancelada nunca pesa.
      supabase
        .from("descargas")
        .select(
          "litros_estimados, peso_liquido_kg, criado_em, cargas!inner(motorista_id, status)"
        )
        .eq("cargas.status", "encerrada")
        .gte("criado_em", de)
        .lte("criado_em", ate),
      supabase.from("profiles").select("id, nome").eq("role", "motorista"),
      buscarVigencias(),
    ]);
  if (eDesc) throw eDesc;

  const nome = new Map(
    ((perfis as { id: string; nome: string }[]) ?? []).map((p) => [p.id, p.nome])
  );

  const acc = new Map<
    string,
    { litros: number; valor: number; regra: ComissaoMotorista["regra"] }
  >();

  type DescargaRow = {
    litros_estimados: number | null;
    peso_liquido_kg: number | null;
    criado_em: string;
    cargas: { motorista_id: string; status: string } | null;
  };
  for (const d of ((descargas as unknown as DescargaRow[]) ?? [])) {
    const motoristaId = d.cargas?.motorista_id;
    if (!motoristaId) continue;
    // litros_estimados é anulável no schema — o fallback é o próprio peso
    // pela densidade oficial (0,9 kg/L), a mesma conta que gera a coluna.
    const litros =
      Number(d.litros_estimados ?? 0) ||
      Number(d.peso_liquido_kg ?? 0) / 0.9;
    if (!litros) continue;

    // Data BR da descarga — a vigência é por dia, e o fuso muda o dia.
    const dia = new Date(new Date(d.criado_em).getTime() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const v = vigenciaEm(vigencias, "comissao", motoristaId, dia);

    const atual = acc.get(motoristaId) ?? { litros: 0, valor: 0, regra: null };
    atual.litros += litros;
    if (v && v.litros_base) {
      atual.valor += (litros / v.litros_base) * v.valor;
      atual.regra = { valor: v.valor, litros_base: v.litros_base };
    }
    acc.set(motoristaId, atual);
  }

  return [...acc.entries()]
    .map(([id, a]) => ({
      motorista_id: id,
      nome: nome.get(id) ?? "—",
      litros: Math.round(a.litros * 100) / 100,
      valor: Math.round(a.valor * 100) / 100,
      regra: a.regra,
    }))
    .filter((m) => nome.has(m.motorista_id))
    .sort((a, b) => b.valor - a.valor);
}
