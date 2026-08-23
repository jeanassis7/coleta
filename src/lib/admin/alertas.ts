import { getSupabaseServer } from "@/lib/supabase/server";
import { selectTudo } from "@/lib/supabase/select-tudo";
import {
  buscarMotoristasComSaldo,
  type MotoristaComSaldo,
} from "@/lib/admin/queries";
import { formatBRL, formatData } from "@/lib/format";

/**
 * Alertas do dashboard.
 *
 * Regra de escrita (decisão do Evaner): texto DIDÁTICO, como se explicasse
 * pra alguém que vai ler daqui um ano sem lembrar de nada. Cada alerta diz
 * o que aconteceu, hipóteses honestas de causa, e o que fazer. Nada de
 * jargão ("divergência de 32%") solto.
 *
 * Os alertas são CALCULADOS na hora — não existem como linha no banco.
 * A tabela alertas_vistos guarda só o que já foi dispensado no "OK, VI".
 * A chave identifica a OCORRÊNCIA (id do registro), então se a condição
 * voltar em outro registro, é um alerta novo.
 */

export type Severidade = "alta" | "media" | "info";

export interface Alerta {
  chave: string;
  icone: string;
  severidade: Severidade;
  titulo: string;
  texto: string;
  link?: { href: string; label: string };
  /** ISO — mostrado como data do fato */
  data?: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const DENSIDADE_KG_POR_L = 0.9;

// Limiares (documentados no plano; ajustáveis conforme uso real)
const DIAS_CARGA_PARADA = 15;
const DIAS_UMIDADE_PENDENTE = 7;
const SALDO_ALTO = 3000;
// 15 dias, não 7 (Evaner, 19/08/2026). Com 7 o alerta acendia em toda
// folga de fim de semana esticada e virava ruído — e alerta ruidoso ensina
// a ignorar alerta.
const DIAS_SEM_GASTO = 15;
const COLETAS_SEM_GPS_NA_SEMANA = 3;
const PULAR_ACEITE = 10;
// Alerta de preço só liga com base estatística — senão vira ruído e o
// gestor aprende a ignorar alerta (aí o alerta real também morre).
const MIN_COLETAS_HISTORICO = 30;
const MIN_DIAS_HISTORICO = 60;

function diasAtras(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DIA_MS);
}

/** aaaa-mm-dd em BR — usado nas chaves que re-alertam a cada dia */
function diaBr(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Link de um alerta que fala de UMA coleta específica.
 *
 * Mandar pra /admin puro não resolvia: o dashboard abre no MÊS atual com o
 * filtro padrão, e a coleta do alerta costuma ser de dias antes — o gestor
 * clicava, caía numa lista enorme (ou vazia) e tinha que caçar na mão.
 *
 * Agora o link fixa o período no DIA BR da coleta e manda o id em ?coleta=,
 * que a ListaColetas usa pra já abrir a gaveta em modo edição.
 */
function linkColeta(
  id: string,
  criadoEm: string,
  label = "Abrir a coleta pra corrigir"
): { href: string; label: string } {
  const dia = new Date(new Date(criadoEm).getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    href: `/admin?periodo=customizado&inicio=${dia}&fim=${dia}&coleta=${id}`,
    label,
  };
}

export async function buscarAlertas(
  opts: {
    /** Quem já calculou os saldos passa aqui — evita recalcular (o
     *  dashboard chamava duas vezes e dobrava o tempo de carregamento). */
    saldos?: MotoristaComSaldo[];
  } = {}
): Promise<Alerta[]> {
  const supabase = await getSupabaseServer();
  const alertas: Alerta[] = [];

  // ---------------------------------------------------------------------
  // Cargas ativas → carga parada + caminhão acima da capacidade
  // ---------------------------------------------------------------------
  try {
    let q = supabase
      .from("cargas")
      .select(
        `id, iniciada_em,
         profiles!cargas_motorista_id_fkey!inner(nome),
         caminhoes(placa, capacidade_l),
         coletas(litros, criado_em),
         despesas(criado_em),
         abastecimentos(criado_em)`
      )
      .eq("status", "ativa");
    const { data } = await q;

    type Row = {
      id: string;
      iniciada_em: string;
      profiles: { nome: string } | null;
      caminhoes: { placa: string; capacidade_l: number } | null;
      coletas: { litros: number; criado_em: string }[] | null;
      despesas: { criado_em: string }[] | null;
      abastecimentos: { criado_em: string }[] | null;
    };

    for (const c of (data as unknown as Row[]) || []) {
      const nome = c.profiles?.nome || "Um motorista";
      const coletas = c.coletas || [];
      const datas = [
        c.iniciada_em,
        ...coletas.map((x) => x.criado_em),
        ...(c.despesas || []).map((x) => x.criado_em),
        ...(c.abastecimentos || []).map((x) => x.criado_em),
      ];
      const ultimaAtividade = datas.sort().at(-1) || c.iniciada_em;
      const parada = diasAtras(ultimaAtividade);

      if (parada >= DIAS_CARGA_PARADA) {
        alertas.push({
          chave: `carga_esquecida:${c.id}`,
          icone: "⏰",
          severidade: "media",
          titulo: "Carga aberta e parada",
          texto:
            `${nome} iniciou uma carga há ${diasAtras(c.iniciada_em)} dias e não lança nada de novo ` +
            `há ${parada} dias. Se ele descarregou de verdade, precisa finalizar a carga no app pra ` +
            `ela encerrar. Se não descarregou, tudo bem — provavelmente parou de trabalhar (folga, ` +
            `doente, caminhão na oficina).`,
          link: { href: "/admin/cargas", label: "Ver cargas" },
          data: ultimaAtividade,
        });
      }

      const capacidade = c.caminhoes?.capacidade_l || 0;
      const somaLitros = coletas.reduce((s, x) => s + Number(x.litros), 0);
      if (capacidade > 0 && somaLitros > capacidade) {
        const pct = Math.round((somaLitros / capacidade) * 100);
        alertas.push({
          chave: `caminhao_cheio:${c.id}`,
          icone: "🔋",
          severidade: "media",
          titulo: "Caminhão passou da capacidade",
          texto:
            `O caminhão ${c.caminhoes?.placa || ""} do ${nome} está marcando ${pct}% cheio no sistema ` +
            `(${somaLitros.toLocaleString("pt-BR")} L lançados, capacidade ${capacidade.toLocaleString("pt-BR")} L). ` +
            `Ele provavelmente descarregou e esqueceu de finalizar a carga aqui no app. Não precisa fazer nada ` +
            `agora — na próxima vez que descarregar, é só finalizar essa carga (mesmo que junte 2 descargas ` +
            `físicas em 1 lançamento). O peso da balança vai ser o total real, então o dado fecha certo.`,
          link: { href: "/admin/cargas", label: "Ver cargas" },
        });
      }
    }
  } catch {
    // um alerta que falha não derruba o card inteiro
  }

  // ---------------------------------------------------------------------
  // Descargas → peso divergente + umidade pendente
  // ---------------------------------------------------------------------
  try {
    type Row = {
      id: string;
      peso_liquido_kg: number;
      umidade_pct: number | null;
      umidade_nao_analisada: boolean;
      criado_em: string;
      cargas: {
        profiles: { nome: string } | null;
        coletas: { litros: number }[] | null;
      } | null;
    };

    // PAGINADO (selectTudo): 90 dias seguram o volume hoje, mas crescem
    // junto com a frota — e alerta truncado é alerta que não acende.
    const desde90 = new Date(Date.now() - 90 * DIA_MS).toISOString();
    const data = await selectTudo<Row>((de, ate) =>
      supabase
        .from("descargas")
        .select(
          `id, peso_liquido_kg, umidade_pct, umidade_nao_analisada, criado_em,
           cargas!inner(
             profiles!cargas_motorista_id_fkey!inner(nome),
             coletas(litros)
           )`
        )
        .gte("criado_em", desde90)
        .order("criado_em", { ascending: false })
        .order("id")
        .range(de, ate)
    );

    for (const d of data) {
      const nome = d.cargas?.profiles?.nome || "Um motorista";
      const litros = (d.cargas?.coletas || []).reduce(
        (s, x) => s + Number(x.litros),
        0
      );
      if (litros > 0) {
        const esperado = litros * DENSIDADE_KG_POR_L;
        const diff = Math.abs(d.peso_liquido_kg - esperado) / esperado;
        if (diff > 0.3) {
          const aMais = d.peso_liquido_kg > esperado;
          alertas.push({
            chave: `peso_divergente:${d.id}`,
            icone: "⚖️",
            severidade: "alta",
            titulo: "Peso da balança bem diferente das coletas",
            texto:
              `${nome} lançou ${litros.toLocaleString("pt-BR")} L em coletas nessa carga. Convertendo pra ` +
              `quilo (multiplicando por 0,9), o peso líquido deveria dar por volta de ` +
              `${Math.round(esperado).toLocaleString("pt-BR")} kg. Só que na balança deu ` +
              `${d.peso_liquido_kg.toLocaleString("pt-BR")} kg — ${Math.round(diff * 100)}% ${aMais ? "a mais" : "a menos"}. ` +
              `Pode ser: erro ao digitar o peso, coleta declarada errada (chutou o litro), água ou borra no óleo, ` +
              `ou vazamento. Vale conferir o papelzinho da balança com ele.`,
            link: { href: "/admin/cargas", label: "Ver cargas" },
            data: d.criado_em,
          });
        }
      }
      // "Não foi analisada" (0057) é uma DECISÃO registrada, não uma
      // pendência — cobrar de novo seria pedir pro gestor responder duas
      // vezes a mesma pergunta, e alerta que não tem resposta vira ruído.
      if (
        d.umidade_pct === null &&
        !d.umidade_nao_analisada &&
        diasAtras(d.criado_em) >= DIAS_UMIDADE_PENDENTE
      ) {
        alertas.push({
          chave: `umidade_pendente:${d.id}`,
          icone: "💧",
          severidade: "info",
          titulo: "Umidade não lançada",
          texto:
            `A descarga de ${nome} do dia ${formatData(d.criado_em)} está há ${diasAtras(d.criado_em)} dias ` +
            `sem lançamento de umidade. Clique na coluna "Umid." da carga: se você testou, lance o ` +
            `número; se não testou, marque "Não foi analisada" e a carga para de aparecer aqui. ` +
            `De um jeito ou de outro nenhum desconto é aplicado — a umidade hoje é só registro.`,
          link: { href: "/admin/cargas", label: "Lançar na tabela de cargas" },
          data: d.criado_em,
        });
      }
    }
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Adiantamento pendente sendo pulado
  // ---------------------------------------------------------------------
  try {
    let q = supabase
      .from("adiantamentos")
      .select(
        `id, valor, pular_contador,
         profiles!adiantamentos_motorista_id_fkey!inner(nome)`
      )
      .eq("status", "pendente")
      .gte("pular_contador", PULAR_ACEITE);
    const { data } = await q;

    type Row = {
      id: string;
      valor: number;
      pular_contador: number;
      profiles: { nome: string } | null;
    };
    for (const a of (data as unknown as Row[]) || []) {
      const nome = a.profiles?.nome || "Um motorista";
      alertas.push({
        chave: `pular_repetido:${a.id}`,
        icone: "⏸",
        severidade: "media",
        titulo: "Motorista não confirma que recebeu",
        texto:
          `${nome} abriu o app ${a.pular_contador} vezes e sempre apertou "ainda não recebi" no ` +
          `adiantamento de ${formatBRL(Number(a.valor))}. Enquanto ele não confirmar, esse dinheiro não ` +
          `entra no saldo dele. Pode ser que ele realmente não tenha recebido, ou que esteja pulando a ` +
          `tela sem ler. Vale uma ligação.`,
        link: { href: "/admin/adiantamentos", label: "Ver adiantamentos" },
      });
    }
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Dinheiro parado na mão do motorista
  // ---------------------------------------------------------------------
  try {
    const saldos =
      opts.saldos ?? (await buscarMotoristasComSaldo());
    const candidatos = saldos.filter((s) => s.saldo_atual >= SALDO_ALTO);
    if (candidatos.length > 0) {
      // Quem lançou ALGO nos últimos dias — 3 consultas no total, não 3
      // por motorista (era outro pedaço da lentidão do dashboard).
      // PAGINADAS (selectTudo): a janela de 15 dias de coletas passa de
      // 1000 linhas com o uso pleno — truncada, um motorista ATIVO caía
      // fora do set e este alerta acendia sem motivo.
      const desde = new Date(Date.now() - DIAS_SEM_GASTO * DIA_MS).toISOString();
      const [lc, ld, la] = await Promise.all([
        selectTudo<{ motorista_id: string }>((de, ate) =>
          supabase
            .from("coletas")
            .select("motorista_id")
            .gte("criado_em", desde)
            .order("id")
            .range(de, ate)
        ),
        selectTudo<{ motorista_id: string }>((de, ate) =>
          supabase
            .from("despesas")
            .select("motorista_id")
            .gte("criado_em", desde)
            .order("id")
            .range(de, ate)
        ),
        selectTudo<{ motorista_id: string }>((de, ate) =>
          supabase
            .from("abastecimentos")
            .select("motorista_id")
            .gte("criado_em", desde)
            .order("id")
            .range(de, ate)
        ),
      ]);
      const ativos = new Set<string>([
        ...lc.map((x) => x.motorista_id),
        ...ld.map((x) => x.motorista_id),
        ...la.map((x) => x.motorista_id),
      ]);

      for (const s of candidatos) {
        if (ativos.has(s.id)) continue;
        alertas.push({
          chave: `vale_alto:${s.id}:${diaBr()}`,
          icone: "💰",
          severidade: "media",
          titulo: "Dinheiro parado na mão do motorista",
          texto:
            `${s.nome} está com ${formatBRL(s.saldo_atual)} da empresa na mão e não lança nada ` +
            `(nem coleta, nem despesa, nem combustível) há mais de ${DIAS_SEM_GASTO} dias. Pode ser normal ` +
            `(ele está de folga ou parado), ou pode ser sinal de que está esquecendo de lançar as coletas no ` +
            `app. Vale checar com ele.`,
          link: { href: `/admin/adiantamentos/${s.id}`, label: "Ver histórico dele" },
        });
      }
    }
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Coletas dos últimos 90 dias → foto faltando, GPS falhando, preço fora
  // ---------------------------------------------------------------------
  try {
    // PAGINADO (selectTudo): 90 dias já beiram 1000 coletas no ritmo atual —
    // truncar faria a média de preço e a contagem de foto/GPS saírem erradas
    // sem nenhum erro.
    const data = await selectTudo<Record<string, unknown>>((de, ate) =>
      supabase
        .from("coletas")
        .select(
          `id, motorista_id, litros, valor_pago, gps_capturado, foto_path, local_nome, criado_em,
           profiles!coletas_motorista_id_fkey!inner(nome, exige_foto)`
        )
        .gte("criado_em", new Date(Date.now() - 90 * DIA_MS).toISOString())
        .order("id")
        .range(de, ate)
    );

    type Row = {
      id: string;
      motorista_id: string;
      litros: number;
      valor_pago: number;
      gps_capturado: boolean;
      foto_path: string | null;
      local_nome: string;
      criado_em: string;
      profiles: { nome: string; exige_foto: boolean } | null;
    };
    const coletas = (data as unknown as Row[]) || [];

    const porMotorista = new Map<string, Row[]>();
    for (const c of coletas) {
      const lista = porMotorista.get(c.motorista_id) || [];
      lista.push(c);
      porMotorista.set(c.motorista_id, lista);
    }

    for (const [motoristaId, lista] of porMotorista.entries()) {
      const nome = lista[0].profiles?.nome || "Um motorista";
      const exigeFoto = !!lista[0].profiles?.exige_foto;

      // Foto faltando (últimas 48h, só se o toggle está ligado pra ele)
      if (exigeFoto) {
        const semFoto = lista.filter(
          (c) => !c.foto_path && diasAtras(c.criado_em) <= 2
        );
        if (semFoto.length > 0) {
          alertas.push({
            chave: `foto_faltando:${motoristaId}:${diaBr()}`,
            icone: "📷",
            severidade: "info",
            titulo: "Coletas chegando sem foto",
            texto:
              `${nome} lançou ${semFoto.length} ${semFoto.length === 1 ? "coleta" : "coletas"} nos últimos ` +
              `2 dias sem foto, mesmo com a exigência de foto ligada pra ele. Pode ser câmera travada, ` +
              `memória cheia no celular, ou ele achando um jeito de pular a etapa. Vale olhar.`,
            link: { href: "/admin", label: "Ver coletas" },
          });
        }
      }

      // GPS falhando (últimos 7 dias)
      const semGps = lista.filter(
        (c) => !c.gps_capturado && diasAtras(c.criado_em) <= 7
      );
      if (semGps.length > COLETAS_SEM_GPS_NA_SEMANA) {
        alertas.push({
          chave: `gps_falhando:${motoristaId}:${diaBr()}`,
          icone: "📍",
          severidade: "info",
          titulo: "Coletas chegando sem localização",
          texto:
            `${nome} teve ${semGps.length} coletas nos últimos 7 dias sem o GPS pegar. Isso deixa essas ` +
            `coletas de fora do mapa e atrapalha a curadoria de locais. Pode ser GPS desligado no celular, ` +
            `permissão de localização retirada do app, ou ele coletando dentro de galpão fechado (onde o ` +
            `sinal não pega). Vale conversar.`,
          link: { href: "/admin/eventos", label: "Ver eventos de GPS" },
        });
      }

      // Preço fora da curva (só com base histórica suficiente)
      const comLitros = lista.filter((c) => Number(c.litros) > 0);
      const diasSpan =
        comLitros.length > 0
          ? diasAtras(comLitros.map((c) => c.criado_em).sort()[0])
          : 0;
      const baseOk =
        comLitros.length >= MIN_COLETAS_HISTORICO || diasSpan >= MIN_DIAS_HISTORICO;
      if (baseOk && comLitros.length > 1) {
        const custos = comLitros.map((c) => Number(c.valor_pago) / Number(c.litros));
        const media = custos.reduce((s, x) => s + x, 0) / custos.length;
        for (const c of comLitros) {
          if (diasAtras(c.criado_em) > 2) continue;
          const custo = Number(c.valor_pago) / Number(c.litros);
          if (media > 0 && custo > media * 2) {
            alertas.push({
              chave: `coleta_suspeita:${c.id}`,
              icone: "🛑",
              severidade: "alta",
              titulo: "Coleta muito acima do preço normal",
              texto:
                `${nome} pagou R$ ${custo.toFixed(2).replace(".", ",")} por litro na coleta em ` +
                `"${c.local_nome}". A média dele é R$ ${media.toFixed(2).replace(".", ",")} por litro — ` +
                `essa saiu mais que o dobro. Pode ser óleo especial, preço combinado com um cliente antigo, ` +
                `ou erro ao digitar o valor. Vale confirmar.`,
              link: linkColeta(c.id, c.criado_em),
              data: c.criado_em,
            });
          }
        }
      }
    }
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Coleta com lançamento fora da curva (rede de segurança do antiburro)
  // ---------------------------------------------------------------------
  // O app do motorista bloqueia abaixo de 20 L e avisa em preço absurdo —
  // mas o aviso passa no segundo toque, e quem confirma no automático
  // continua gerando dado ruim. Este alerta é pra isso: o gestor vê mesmo
  // que o motorista tenha confirmado.
  //
  // Caso real que originou: 1,80 L por R$ 2.880 (R$ 1.600/L). O motorista
  // digitou o PREÇO no campo dos litros — a coleta era de 1.600 L.
  //
  // A chave é o id da coleta, então "OK, VI" dispensa aquela ocorrência e
  // uma nova coleta torta vira alerta novo.
  try {
    type Row = {
      id: string;
      litros: number;
      valor_pago: number;
      local_nome: string;
      criado_em: string;
      profiles: { nome: string } | null;
    };

    // PAGINADO (selectTudo): o limit(500) antigo prometia "últimos 30 dias"
    // mas varria só as 500 coletas mais recentes — no uso pleno, metade da
    // janela nunca era conferida e a coleta torta escapava da rede.
    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const data = await selectTudo<Row>((de, ate) =>
      supabase
        .from("coletas")
        .select(
          "id, litros, valor_pago, local_nome, criado_em, profiles!coletas_motorista_id_fkey!inner(nome)"
        )
        .gte("criado_em", desde)
        .order("criado_em", { ascending: false })
        .order("id")
        .range(de, ate)
    );

    for (const c of data) {
      const litros = Number(c.litros);
      const valor = Number(c.valor_pago);
      if (!(litros > 0)) continue;
      const rsPorLitro = valor / litros;
      // Mesma faixa do app do motorista (R$ 0,50 a R$ 4,00 por litro).
      const poucoOleo = litros < 20;
      const precoAbsurdo = rsPorLitro < 0.5 || rsPorLitro > 4;
      if (!poucoOleo && !precoAbsurdo) continue;

      const nome = c.profiles?.nome || "Um motorista";
      const litrosFmt = litros.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

      // R$ 0 é DOAÇÃO (R2) — caso legítimo desde a 0031. O alerta continua
      // aparecendo (decisão do Evaner, 20/08/2026: "é atípico e merece
      // atenção"), mas com o texto certo — dizer "faltou dígito" pra uma
      // doação ensinaria a desconfiar do alerta.
      if (valor === 0) {
        alertas.push({
          chave: `coleta_fora_da_curva:${c.id}`,
          icone: "🎁",
          severidade: "media",
          titulo: "Coleta de R$ 0 — foi doação?",
          texto:
            `${nome} lançou ${litrosFmt} L em "${c.local_nome}" sem pagar nada. ` +
            `Óleo doado se lança com valor zero mesmo — se foi isso, é só dispensar este aviso. ` +
            `Se na verdade ele pagou e errou o campo, corrija a coleta: o valor desconta do saldo dele.`,
          link: linkColeta(c.id, c.criado_em, "Abrir a coleta"),
          data: c.criado_em,
        });
        continue;
      }

      // A leitura provável depende de PRA QUE LADO o preço saiu da faixa:
      //   caro demais  → os litros é que estão baixos (digitou o preço ali)
      //   barato demais → o valor é que está errado
      // Sugerir o mesmo conserto nos dois casos daria bobagem (R$ 2 por
      // 2.000 L viraria "a coleta era de 1 litro").
      const PRECO_TIPICO = 1.8;
      const litrosProvaveis =
        rsPorLitro > 4 ? Math.round(valor / PRECO_TIPICO) : null;
      const valorProvavel =
        rsPorLitro < 0.5 ? Math.round(litros * PRECO_TIPICO) : null;

      alertas.push({
        chave: `coleta_fora_da_curva:${c.id}`,
        icone: "🧮",
        severidade: "alta",
        titulo: "Coleta com número estranho",
        texto:
          `${nome} lançou ${litrosFmt} L em "${c.local_nome}" por ${formatBRL(valor)} — ` +
          `dá ${formatBRL(Math.round(rsPorLitro * 100) / 100)} por litro, quando o normal de vocês é ` +
          `perto de R$ 1,80. ` +
          (litrosProvaveis
            ? `Se o preço foi o de sempre, a coleta era de umas ${litrosProvaveis.toLocaleString("pt-BR")} L e ` +
              `alguém digitou o PREÇO no campo dos litros. `
            : "") +
          (valorProvavel
            ? `Se o preço foi o de sempre, o pago era perto de ${formatBRL(valorProvavel)} — ` +
              `provavelmente faltou dígito no valor. `
            : "") +
          `Confirme com ele antes de corrigir: o valor pago desconta do saldo dele, e o óleo entra no estoque.`,
        link: linkColeta(c.id, c.criado_em),
        data: c.criado_em,
      });
    }
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Frota, documentos, cheques e estoque (módulo separado — ver o porquê lá)
  // ---------------------------------------------------------------------
  try {
    const { alertasFrota } = await import("@/lib/admin/alertas-frota");
    alertas.push(...(await alertasFrota()));
  } catch {
    // segue
  }

  // ---------------------------------------------------------------------
  // Remove os já dispensados no "OK, VI" — só os dispensados POR MIM.
  // Cada admin tem a própria dispensa (0039): o Evaner dispensar não some
  // com o alerta do dashboard do Jean.
  // ---------------------------------------------------------------------
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const meuId = session?.user?.id ?? null;
    // PAGINADO (selectTudo): as chaves diárias (vale_alto, foto_faltando,
    // gps_falhando) acumulam sem limpeza — truncado em 1000, alerta já
    // dispensado voltava a aparecer aleatoriamente.
    const vistos = await selectTudo<{ chave: string }>((de, ate) => {
      let q = supabase.from("alertas_vistos").select("chave");
      if (meuId) q = q.eq("visto_por", meuId);
      return q.order("chave").range(de, ate);
    });
    const set = new Set(vistos.map((v) => v.chave));
    const restantes = alertas.filter((a) => !set.has(a.chave));
    return ordenar(restantes);
  } catch {
    return ordenar(alertas);
  }
}

function ordenar(alertas: Alerta[]): Alerta[] {
  const peso: Record<Severidade, number> = { alta: 0, media: 1, info: 2 };
  return alertas.sort((a, b) => {
    const s = peso[a.severidade] - peso[b.severidade];
    if (s !== 0) return s;
    return (b.data || "").localeCompare(a.data || "");
  });
}
