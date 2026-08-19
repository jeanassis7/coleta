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
 * PROPORCIONAL: `litros ÷ litros_base × valor`. 100 L numa base de 200 paga
 * metade — decisão do Evaner, não é bloco fechado.
 *
 * Cada coleta usa a vigência do DIA DELA. Uma mudança de comissão no meio do
 * mês parte a conta na data certa sozinha, sem ninguém precisar lembrar.
 */
export async function calcularComissao(
  inicio: string,
  fim: string
): Promise<ComissaoMotorista[]> {
  const supabase = await getSupabaseServer();
  const de = new Date(`${inicio}T00:00:00.000-03:00`).toISOString();
  const ate = new Date(`${fim}T23:59:59.999-03:00`).toISOString();

  const [{ data: coletas }, { data: perfis }, vigencias] = await Promise.all([
    supabase
      .from("coletas")
      .select("motorista_id, litros, criado_em")
      .gte("criado_em", de)
      .lte("criado_em", ate),
    supabase.from("profiles").select("id, nome").eq("role", "motorista"),
    buscarVigencias(),
  ]);

  const nome = new Map(
    ((perfis as { id: string; nome: string }[]) ?? []).map((p) => [p.id, p.nome])
  );

  const acc = new Map<
    string,
    { litros: number; valor: number; regra: ComissaoMotorista["regra"] }
  >();

  for (const c of ((coletas as {
    motorista_id: string;
    litros: number;
    criado_em: string;
  }[]) ?? [])) {
    // Data BR da coleta — a vigência é por dia, e o fuso muda o dia.
    const dia = new Date(new Date(c.criado_em).getTime() - 3 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const v = vigenciaEm(vigencias, "comissao", c.motorista_id, dia);

    const atual = acc.get(c.motorista_id) ?? { litros: 0, valor: 0, regra: null };
    atual.litros += Number(c.litros || 0);
    if (v && v.litros_base) {
      atual.valor += (Number(c.litros || 0) / v.litros_base) * v.valor;
      atual.regra = { valor: v.valor, litros_base: v.litros_base };
    }
    acc.set(c.motorista_id, atual);
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
