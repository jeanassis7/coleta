/**
 * E2E da camada de dados do Módulo 1 — roda contra produção.
 *
 * ISOLAMENTO: cria um motorista próprio descartável ("E2E Bot") e deleta
 * ele no final. NUNCA toca em dado que não criou.
 *
 * O bot é um motorista comum — a coluna is_teste deixou de existir em
 * 19/08/2026. Enquanto o run acontece (~1 min) os lançamentos dele ficam
 * visíveis no painel; é a mesma escolha de testar com perfil real e
 * apagar depois.
 *
 * Testa: RLS como motorista, unique de 1 carga ativa, inserts idempotentes
 * (client_id 23505), coluna generated peso_liquido, update atômico de
 * carga/adiantamento, queries aninhadas do admin (PostgREST nested filter),
 * cálculo de saldo, acerto com corte_em.
 *
 * LIMPA tudo que criou no final (registros, fotos, o próprio bot).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { carregarEnv } from "./carregar-env.mjs";
import ws from "ws";
if (!globalThis.WebSocket) globalThis.WebSocket = ws;

carregarEnv([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;

const svc = createClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });
const mot = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const resultados = [];
function check(nome, ok, detalhe = "") {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? "✅" : "❌"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

// JPEG mínimo válido (4 bytes SOI+EOI)
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const criados = {
  caminhaoId: null,
  cargaId: null,
  coletaClientId: randomUUID(),
  despesaClientId: randomUUID(),
  abastClientId: randomUUID(),
  descargaClientId: randomUUID(),
  adiantamentoId: null,
  acertoId: null,
  motoristaId: null,
  compraKgId: null,
  compraLitrosId: null,
  compraCertId: null,
  coletaAdminClientId: null,
  logDesdeId: null,
  fotos: [],
  // maço de cheques (0071)
  contaFinId: null,
  compradorId: null,
  chequeIds: [],
  recebimentoIds: [],
};

async function main() {
  // O E2E escreve com a chave de serviço, então o gatilho da 0022 grava
  // cada gravação dele no log como "não identificado". O marco tem que ser
  // a PRIMEIRA coisa do run: anotado depois, o próprio insert do perfil do
  // bot já teria escapado.
  const { data: ultimoLog } = await svc
    .from("log_admin").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  criados.logDesdeId = ultimoLog?.id ?? 0;

  // ---- setup: motorista descartável só deste run ----
  const E2E_EMAIL = `e2e-bot-${Date.now()}@coleta.local`;
  const E2E_SENHA = randomUUID();
  const { data: criado, error: errBot } = await svc.auth.admin.createUser({
    email: E2E_EMAIL, password: E2E_SENHA, email_confirm: true,
  });
  if (errBot || !criado?.user) throw new Error("criar bot: " + errBot?.message);
  const { error: errPerfil } = await svc.from("profiles").insert({
    id: criado.user.id, nome: "E2E Bot", role: "motorista",
    ativo: true, exige_foto: false, features: {},
  });
  if (errPerfil) throw new Error("perfil bot: " + errPerfil.message);
  const teste1 = { id: criado.user.id }; // "motorista" deste run
  criados.motoristaId = teste1.id;

  // Um admin qualquer serve como "quem lançou pelo painel". O papel `dev`
  // deixou de existir em 19/08/2026 — sobrou motorista | admin.
  const { data: dev } = await svc.from("profiles").select("id").eq("role", "admin").eq("ativo", true).limit(1).maybeSingle();
  if (!dev) throw new Error("nenhum admin ativo encontrado");

  const { data: cam, error: errCam } = await svc
    .from("caminhoes")
    .insert({ placa: "ZZZ9Z99", marca: "TesteE2E", cor: "Cinza", capacidade_l: 10000, tara_kg: 8000 })
    .select().maybeSingle();
  if (errCam) throw new Error("criar caminhão E2E: " + errCam.message);
  criados.caminhaoId = cam.id;

  const { error: errLogin } = await mot.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_SENHA,
  });
  check("login motorista E2E", !errLogin, errLogin?.message);
  if (errLogin) throw new Error("sem login não dá pra seguir");

  // ---- 1. motorista lê caminhões ativos (RLS) ----
  const { data: cams, error: e1 } = await mot.from("caminhoes").select("id, placa").eq("ativo", true);
  check("RLS: motorista lê caminhões ativos", !e1 && (cams || []).some((c) => c.id === cam.id), e1?.message);

  // ---- 2. motorista cria carga ----
  const { data: carga, error: e2 } = await mot
    .from("cargas")
    .insert({ motorista_id: teste1.id, caminhao_id: cam.id, km_inicial: 100000 })
    .select("id, status, iniciada_em").maybeSingle();
  check("motorista cria carga (status ativa)", !e2 && carga?.status === "ativa", e2?.message);
  criados.cargaId = carga?.id;

  // ---- 3. segunda carga ativa → bloqueada pelo índice único ----
  const { error: e3 } = await mot
    .from("cargas")
    .insert({ motorista_id: teste1.id, caminhao_id: cam.id, km_inicial: 100001 });
  check("índice único: 2ª carga ativa rejeitada (23505)", e3?.code === "23505", e3?.code || "inseriu (ERRADO)");

  // ---- 4. coleta vinculada à carga ----
  const { error: e4 } = await mot.from("coletas").insert({
    motorista_id: teste1.id,
    litros: 500,
    local_nome: "Cliente E2E",
    valor_pago: 400,
    certificado_tipo: "nao",
    criado_em: new Date().toISOString(),
    client_id: criados.coletaClientId,
    carga_id: carga.id,
  });
  check("coleta com carga_id", !e4, e4?.message);

  // ── Reconciliação: o motorista consegue perguntar "isso entrou?" ───────
  // Sem esse SELECT, o conserto do iOS (14/09/2026) não tem como funcionar:
  // ele consulta pelo client_id depois de um erro de rede pra descobrir se o
  // servidor gravou. Se a RLS barrar, a consulta volta vazia e o app conclui
  // "não entrou" — exatamente o bug que se quer consertar, agora silencioso.
  {
    const { data: achada, error: errAchar } = await mot
      .from("coletas")
      .select("id")
      .eq("client_id", criados.coletaClientId)
      .maybeSingle();
    check(
      "motorista lê a própria coleta pelo client_id (base da reconciliação)",
      !errAchar && !!achada,
      errAchar ? errAchar.message : achada ? "" : "voltou vazio"
    );
  }

  // ---- 5. upload de foto como motorista (storage RLS) ----
  const fotoDespesa = `${teste1.id}/despesa-${criados.despesaClientId}.jpg`;
  const { error: e5 } = await mot.storage.from("fotos-coletas")
    .upload(fotoDespesa, JPG, { upsert: true, contentType: "image/jpeg" });
  check("storage: upload foto despesa", !e5, e5?.message);
  criados.fotos.push(fotoDespesa);

  // ---- 6. despesa + idempotência ----
  const payloadDespesa = {
    client_id: criados.despesaClientId,
    carga_id: carga.id,
    motorista_id: teste1.id,
    valor: 45,
    descricao: "almoço E2E",
    foto_path: fotoDespesa,
    criado_em: new Date().toISOString(),
  };
  const { error: e6 } = await mot.from("despesas").insert(payloadDespesa);
  check("despesa insere", !e6, e6?.message);
  const { error: e6b } = await mot.from("despesas").insert(payloadDespesa);
  check("despesa retry → 23505 (idempotente)", e6b?.code === "23505", e6b?.code || "duplicou (ERRADO)");

  // ---- 7. abastecimento ----
  const fotoAbast = `${teste1.id}/abastecimento-${criados.abastClientId}.jpg`;
  await mot.storage.from("fotos-coletas").upload(fotoAbast, JPG, { upsert: true, contentType: "image/jpeg" });
  criados.fotos.push(fotoAbast);
  const { error: e7 } = await mot.from("abastecimentos").insert({
    client_id: criados.abastClientId,
    carga_id: carga.id,
    motorista_id: teste1.id,
    posto_nome: "Posto E2E",
    litros: 120.5,
    valor: 680,
    km_atual: 100200,
    foto_path: fotoAbast,
    criado_em: new Date().toISOString(),
  });
  check("abastecimento insere", !e7, e7?.message);

  // ---- 7b. trigger preenche caminhao_id sozinho (0018) ----
  // O cliente NÃO manda caminhao_id — o PWA fica cacheado no celular do
  // motorista e a versão antiga continua rodando por vários usos. Se o
  // banco exigisse a coluna, todo lançamento de quem está na versão velha
  // falharia no sync, sem sinal nenhum pra ele.
  const { data: cargaDb } = await svc.from("cargas")
    .select("caminhao_id").eq("id", carga.id).maybeSingle();
  const { data: abastSalvo } = await svc.from("abastecimentos")
    .select("caminhao_id, pago_na_hora").eq("client_id", criados.abastClientId).maybeSingle();
  check("trigger preencheu caminhao_id a partir da carga",
    !!cargaDb?.caminhao_id && abastSalvo?.caminhao_id === cargaDb.caminhao_id,
    `gravado=${abastSalvo?.caminhao_id} esperado=${cargaDb?.caminhao_id}`);
  check("abastecimento nasce como PAGUEI AGORA (pago_na_hora = true)",
    abastSalvo?.pago_na_hora === true, `pago_na_hora=${abastSalvo?.pago_na_hora}`);

  // ---- 7c. "ASSINEI A NOTA": empresa paga depois, motorista não gastou ----
  criados.abastAssinadoClientId = randomUUID();
  const { error: e7c } = await mot.from("abastecimentos").insert({
    client_id: criados.abastAssinadoClientId,
    carga_id: carga.id,
    motorista_id: teste1.id,
    posto_nome: "Posto E2E (nota assinada)",
    litros: 90,
    valor: 500,
    km_atual: 100300,
    foto_path: fotoAbast,
    pago_na_hora: false,
    criado_em: new Date().toISOString(),
  });
  check("abastecimento com nota assinada insere", !e7c, e7c?.message);

  // O trigger 0034 tem que ter criado a conta a pagar da nota — é ele que
  // garante que a dívida com o posto existe mesmo quando o lançamento veio
  // do celular (o sync insere direto, sem passar por endpoint).
  const { data: abastAssinadoRow } = await svc.from("abastecimentos")
    .select("id").eq("client_id", criados.abastAssinadoClientId).maybeSingle();
  const { data: contaNota } = await svc.from("contas_a_pagar")
    .select("id, categoria, valor, status")
    .eq("origem_tipo", "abastecimento")
    .eq("origem_id", abastAssinadoRow?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check("nota assinada gera conta a pagar por trigger (0034)",
    contaNota?.status === "a_pagar" && contaNota?.categoria === "combustivel" && Number(contaNota?.valor) === 500,
    contaNota ? `status=${contaNota.status} cat=${contaNota.categoria} valor=${contaNota.valor}` : "conta não nasceu");

  // ---- 8. descarga + generated column + idempotência ----
  const { data: desc, error: e8 } = await mot.from("descargas").insert({
    client_id: criados.descargaClientId,
    carga_id: carga.id,
    peso_bruto_kg: 8450,
    peso_tara_kg: 8000,
    litros_estimados: 500,
    criado_em: new Date().toISOString(),
  }).select("peso_liquido_kg").maybeSingle();
  check("descarga insere + peso_liquido generated = 450", !e8 && desc?.peso_liquido_kg === 450,
    e8?.message || `liquido=${desc?.peso_liquido_kg}`);
  const { error: e8b } = await mot.from("descargas").insert({
    client_id: criados.descargaClientId,
    carga_id: carga.id,
    peso_bruto_kg: 8450,
    peso_tara_kg: 8000,
  });
  check("descarga retry → 23505 (idempotente)", e8b?.code === "23505", e8b?.code || "duplicou (ERRADO)");

  // ---- 9. fechar carga atomicamente (como o sync faz) ----
  const { data: fech1 } = await mot.from("cargas")
    .update({
      status: "encerrada",
      encerrada_em: new Date().toISOString(),
      km_final: 100500,
    })
    .eq("id", carga.id).eq("status", "ativa").select("id, km_final, km_inicial");
  check("fechar carga atômico: 1ª vez fecha", (fech1 || []).length === 1);
  check("km_final gravado no encerramento (km rodado = 500)",
    (fech1 || [])[0]?.km_final - (fech1 || [])[0]?.km_inicial === 500,
    `km_final=${(fech1 || [])[0]?.km_final}`);
  const { data: fech2 } = await mot.from("cargas")
    .update({ status: "encerrada" })
    .eq("id", carga.id).eq("status", "ativa").select();
  check("fechar carga atômico: retry → 0 rows (ok)", (fech2 || []).length === 0);

  // ---- 10. query aninhada do /admin/cargas (sintaxe PostgREST — risco D7) ----
  const SELECT_CARGAS = `id, motorista_id, caminhao_id, km_inicial, km_final, status,
       iniciada_em, encerrada_em,
       profiles!cargas_motorista_id_fkey!inner(nome),
       caminhoes(placa, marca, cor, capacidade_l),
       coletas(id, litros, valor_pago),
       despesas(id, valor),
       abastecimentos(id, valor),
       descargas(peso_bruto_kg, peso_tara_kg, peso_liquido_kg, litros_estimados, umidade_pct, criado_em)`;
  const { error: e10 } = await svc.from("cargas")
    .select(SELECT_CARGAS).order("iniciada_em", { ascending: false });
  check("query /admin/cargas roda sem erro", !e10, e10?.message);
  const { data: cargasTodas, error: e10b } = await svc.from("cargas").select(SELECT_CARGAS);
  const minha = (cargasTodas || []).find((c) => c.id === carga.id);
  check("agregados da carga corretos (1 coleta, 1 despesa, 2 abast, 1 descarga)",
    !e10b && minha && minha.coletas?.length === 1 && minha.despesas?.length === 1 &&
    minha.abastecimentos?.length === 2 && minha.descargas?.length === 1,
    e10b?.message || (minha ? `c=${minha.coletas?.length} d=${minha.despesas?.length} a=${minha.abastecimentos?.length} desc=${minha.descargas?.length}` : "carga não veio"));

  // ---- 11. query aninhada do /admin/descarregamentos (3 níveis — risco D7) ----
  const SELECT_DESC = `id, carga_id, peso_bruto_kg, peso_tara_kg, peso_liquido_kg,
       litros_estimados, umidade_pct, foto_papel_path, criado_em,
       cargas!inner(
         motorista_id,
         profiles!cargas_motorista_id_fkey!inner(nome),
         caminhoes(placa)
       )`;
  const { error: e11 } = await svc.from("descargas").select(SELECT_DESC);
  check("query /admin/descarregamentos roda sem erro", !e11, e11?.message);
  const { data: descTodas } = await svc.from("descargas").select(SELECT_DESC);
  check("descarga do bot aparece na query do admin",
    (descTodas || []).some((d) => d.carga_id === carga.id));

  // ---- 12. lançar umidade (como o PATCH do admin faz) ----
  const { error: e12 } = await svc.from("descargas")
    .update({ umidade_pct: 12.5 }).eq("client_id", criados.descargaClientId);
  const { data: descUmid } = await svc.from("descargas")
    .select("umidade_pct").eq("client_id", criados.descargaClientId).maybeSingle();
  check("umidade lançada = 12.5", !e12 && Number(descUmid?.umidade_pct) === 12.5,
    e12?.message || `umidade=${descUmid?.umidade_pct}`);

  // ---- 13. adiantamento: envia (Jean) → aceita atômico (motorista) ----
  const { data: adiant, error: e13 } = await svc.from("adiantamentos").insert({
    motorista_id: teste1.id, valor: 5000, forma_pagamento: "pix",
    observacao: "E2E", registrado_por: dev.id,
  }).select("id, status").maybeSingle();
  check("adiantamento criado pendente", !e13 && adiant?.status === "pendente", e13?.message);
  criados.adiantamentoId = adiant?.id;

  const { data: aceite } = await mot.from("adiantamentos")
    .update({ status: "aceito", aceito_em: new Date().toISOString() })
    .eq("id", adiant.id).eq("status", "pendente").select();
  check("aceite atômico: 1 row", (aceite || []).length === 1);
  const { data: aceite2 } = await mot.from("adiantamentos")
    .update({ status: "aceito" }).eq("id", adiant.id).eq("status", "pendente").select();
  check("aceite duplo → 0 rows", (aceite2 || []).length === 0);
  const { data: cancelPos } = await svc.from("adiantamentos")
    .update({ status: "cancelado" }).eq("id", adiant.id).eq("status", "pendente").select();
  check("cancelar após aceite → 0 rows (409 do endpoint)", (cancelPos || []).length === 0);

  // ---- 14. saldo: 5000 − 400 (coleta) − 45 (despesa) − 680 (abast) = 3875 ----
  const corte0 = "1970-01-01T00:00:00Z";
  const soma = async (tabela, campo) => {
    const { data } = await svc.from(tabela).select(campo)
      .eq("motorista_id", teste1.id).gt("criado_em", corte0);
    return (data || []).reduce((s, r) => s + Number(r[campo]), 0);
  };
  const { data: ads } = await svc.from("adiantamentos").select("valor")
    .eq("motorista_id", teste1.id).eq("status", "aceito").gt("aceito_em", corte0);
  const somaAd = (ads || []).reduce((s, a) => s + Number(a.valor), 0);
  // Só o abastecimento que ele PAGOU sai do bolso dele. O de nota assinada
  // (R$ 500) é dívida da empresa com o posto, não gasto do motorista.
  const { data: abastPagos } = await svc.from("abastecimentos")
    .select("valor").eq("motorista_id", teste1.id)
    .eq("pago_na_hora", true).gt("criado_em", corte0);
  const somaAbastPagos = (abastPagos || []).reduce((s, a) => s + Number(a.valor), 0);
  const saldo = somaAd - (await soma("coletas", "valor_pago")) -
    (await soma("despesas", "valor")) - somaAbastPagos;
  check("saldo calculado = 3875", saldo === 3875, `saldo=${saldo}`);

  // ---- 14b. a função saldos_motoristas() dá o MESMO número (perf fix) ----
  const { data: saldosRpc, error: eRpc } = await svc.rpc("saldos_motoristas");
  check("rpc saldos_motoristas roda", !eRpc, eRpc?.message);
  const saldoRpcBot = (saldosRpc || []).find((s) => s.motorista_id === teste1.id);
  check("rpc bate com o cálculo manual (3875)",
    Number(saldoRpcBot?.saldo) === 3875, `rpc=${saldoRpcBot?.saldo}`);

  // ---- 14c. o abastecimento assinado NÃO pode ter mexido no saldo ----
  // Se um dia alguém tirar o `and ab.pago_na_hora` da saldos_motoristas(),
  // o motorista recebe R$ 500 a menos no acerto e ninguém descobre pela tela.
  const { data: todosAbast } = await svc.from("abastecimentos")
    .select("valor").eq("motorista_id", teste1.id).gt("criado_em", corte0);
  const somaAbastTodos = (todosAbast || []).reduce((s, a) => s + Number(a.valor), 0);
  check("nota assinada fica FORA do saldo do motorista (1180 lançados, 680 descontados)",
    somaAbastTodos === 1180 && somaAbastPagos === 680 &&
      Number(saldoRpcBot?.saldo) === 3875,
    `lancado=${somaAbastTodos} descontado=${somaAbastPagos} saldo=${saldoRpcBot?.saldo}`);

  // ---- 14d. coleta paga pela SEDE não desconta do motorista ----
  // Caso real: óleo negociado com pagamento pelo escritório. O valor conta
  // no custo do óleo mas não sai da mão dele — antes da 0021 não havia como
  // registrar o valor certo sem furar o saldo, e o motorista lançava R$ 2
  // numa coleta de R$ 4.000.
  criados.coletaSedeClientId = randomUUID();
  const { error: eSede } = await svc.from("coletas").insert({
    client_id: criados.coletaSedeClientId,
    motorista_id: teste1.id,
    litros: 2000,
    local_nome: "Fornecedor E2E (sede paga)",
    valor_pago: 4000,
    certificado_tipo: "nao",
    gps_capturado: false,
    device_id: "e2e",
    session_id: "e2e",
    app_version: "e2e",
    pago_pela_sede: true,
    // valor_sede junto (0058): o CHECK exige que os dois concordem. Insert
    // direto na tabela nao passa pela API, entao o par vem na mao aqui.
    valor_sede: 4000,
    criado_em: new Date().toISOString(),
  });
  check("coleta paga pela sede insere", !eSede, eSede?.message);

  const { data: saldosDepois } = await svc.rpc("saldos_motoristas");
  const saldoDepois = (saldosDepois || []).find((x) => x.motorista_id === teste1.id);
  check(
    "R$ 4.000 pagos pela sede NÃO mexem no saldo do motorista (segue 3875)",
    Number(saldoDepois?.saldo) === 3875,
    `saldo=${saldoDepois?.saldo}`
  );

  // -------------------------------------------------------------------
  // 0058 — pagamento PARCIAL da sede
  // -------------------------------------------------------------------
  // Caso do Luiz: R$ 4.005 de oleo, R$ 3.105 pela empresa, R$ 900 do bolso
  // dele. So os 900 podem descontar do saldo.
  criados.coletaParcialClientId = randomUUID();
  const { error: eParcial } = await svc.from("coletas").insert({
    client_id: criados.coletaParcialClientId,
    motorista_id: teste1.id,
    litros: 2225,
    local_nome: "Fornecedor E2E (sede paga parte)",
    valor_pago: 4005,
    valor_sede: 3105,
    pago_pela_sede: true,
    certificado_tipo: "nao",
    gps_capturado: false,
    device_id: "e2e",
    session_id: "e2e",
    app_version: "e2e",
    criado_em: new Date().toISOString(),
  });
  check("coleta com pagamento parcial da sede insere", !eParcial, eParcial?.message);

  const { data: saldosParcial } = await svc.rpc("saldos_motoristas");
  const saldoParcial = (saldosParcial || []).find((x) => x.motorista_id === teste1.id);
  check(
    "parcial desconta SO a parte do motorista (3875 - 900 = 2975)",
    Number(saldoParcial?.saldo) === 2975,
    `saldo=${saldoParcial?.saldo}`
  );

  // Caminho que da errado (regua #8): a sede nao pode pagar mais que o oleo
  const { error: eMaior } = await svc.from("coletas").insert({
    client_id: randomUUID(),
    motorista_id: teste1.id,
    litros: 100,
    local_nome: "Fornecedor E2E (sede maior que o oleo)",
    valor_pago: 100,
    valor_sede: 500,
    pago_pela_sede: true,
    certificado_tipo: "nao",
    gps_capturado: false,
    device_id: "e2e",
    session_id: "e2e",
    app_version: "e2e",
    criado_em: new Date().toISOString(),
  });
  check(
    "banco RECUSA sede pagando mais do que o oleo custou",
    !!eMaior,
    eMaior ? "" : "inseriu e nao devia"
  );

  // E os dois campos nao podem discordar
  const { error: eDiscorda } = await svc.from("coletas").insert({
    client_id: randomUUID(),
    motorista_id: teste1.id,
    litros: 100,
    local_nome: "Fornecedor E2E (flag sem valor)",
    valor_pago: 100,
    valor_sede: 0,
    pago_pela_sede: true,
    certificado_tipo: "nao",
    gps_capturado: false,
    device_id: "e2e",
    session_id: "e2e",
    app_version: "e2e",
    criado_em: new Date().toISOString(),
  });
  check(
    "banco RECUSA marcado como sede sem parte da sede",
    !!eDiscorda,
    eDiscorda ? "" : "inseriu e nao devia"
  );

  // ---- 15. acerto com corte: saldo pós-acerto = valor_saldo carry ----
  // corte_em EXPLÍCITO com o relógio LOCAL — o mesmo que carimbou aceito_em
  // e criado_em dos lançamentos acima. Deixar o default now() do banco
  // misturava dois relógios: com o do Windows ~meio segundo adiantado, os
  // lançamentos "recém-criados" caíam DEPOIS do corte e o saldo dava
  // 75+5000-90=4985 em vez de -15 (a armadilha "relógio local ≠ relógio do
  // banco" do CLAUDE.md, falhando sozinha conforme o skew do dia).
  const { data: acerto, error: e15 } = await svc.from("acertos").insert({
    motorista_id: teste1.id, valor_devolvido: 3000, valor_vale: 800,
    valor_saldo: 75, registrado_por: dev.id,
    corte_em: new Date().toISOString(),
  }).select("id, corte_em").maybeSingle();
  check("acerto criado com corte_em timestamptz", !e15 && !!acerto?.corte_em, e15?.message);
  criados.acertoId = acerto?.id;
  const { data: adsPos } = await svc.from("adiantamentos").select("valor")
    .eq("motorista_id", teste1.id).eq("status", "aceito").gt("aceito_em", acerto.corte_em);
  const { data: colPos } = await svc.from("coletas").select("valor_pago")
    .eq("motorista_id", teste1.id).gt("criado_em", acerto.corte_em);
  const saldoPos = (adsPos || []).length === 0 && (colPos || []).length === 0 ? 75 : -1;
  check("pós-acerto: eventos antigos fora do ciclo, saldo = carry 75", saldoPos === 75,
    `adiantamentos pós-corte=${(adsPos || []).length}, coletas pós-corte=${(colPos || []).length}`);

  // ---- 16. query do dashboard ----
  const { data: dash, error: e16 } = await svc.from("coletas")
    .select("*, profiles!coletas_motorista_id_fkey!inner(nome)")
    .gte("criado_em", new Date(Date.now() - 3600_000).toISOString());
  check("dashboard: query roda e enxerga a coleta do bot", !e16 &&
    (dash || []).some((c) => c.client_id === criados.coletaClientId), e16?.message);

  // ---- 17. query da curadoria ----
  const { data: cur, error: e17 } = await svc.from("coletas")
    .select("id, client_id, profiles!coletas_motorista_id_fkey!inner(nome)")
    .is("local_id", null);
  check("curadoria: query roda e enxerga a coleta do bot", !e17 &&
    (cur || []).some((c) => c.client_id === criados.coletaClientId), e17?.message);

  // ---- 18. queries do motor de alertas (PostgREST aninhado — risco de 400) ----
  const { error: eA1 } = await svc.from("cargas").select(
    `id, iniciada_em,
     profiles!cargas_motorista_id_fkey!inner(nome),
     caminhoes(placa, capacidade_l),
     coletas(litros, criado_em),
     despesas(criado_em),
     abastecimentos(criado_em)`
  ).eq("status", "ativa");
  check("alertas: query de cargas ativas roda", !eA1, eA1?.message);

  const { error: eA2 } = await svc.from("descargas").select(
    `id, peso_liquido_kg, umidade_pct, criado_em,
     cargas!inner(
       profiles!cargas_motorista_id_fkey!inner(nome),
       coletas(litros)
     )`
  );
  check("alertas: query de descargas roda", !eA2, eA2?.message);

  const { error: eA3 } = await svc.from("adiantamentos").select(
    `id, valor, pular_contador,
     profiles!adiantamentos_motorista_id_fkey!inner(nome)`
  ).eq("status", "pendente").gte("pular_contador", 10);
  check("alertas: query de adiantamentos pulados roda", !eA3, eA3?.message);

  const { error: eA4 } = await svc.from("coletas").select(
    `id, motorista_id, litros, valor_pago, gps_capturado, foto_path, local_nome, criado_em,
     profiles!coletas_motorista_id_fkey!inner(nome, exige_foto)`
  ).limit(5);
  check("alertas: query de coletas (foto/gps/preco) roda", !eA4, eA4?.message);

  // ---- 19. alertas_vistos: dispensar e ler de volta ----
  const chaveTeste = `e2e_teste:${criados.coletaClientId}`;
  const { error: eV1 } = await svc.from("alertas_vistos").upsert({
    chave: chaveTeste, visto_por: dev.id,
  });
  check("alertas_vistos: dispensa grava", !eV1, eV1?.message);
  const { data: vistos } = await svc.from("alertas_vistos").select("chave");
  check("alertas_vistos: dispensa aparece na leitura",
    (vistos || []).some((v) => v.chave === chaveTeste));
  await svc.from("alertas_vistos").delete().eq("chave", chaveTeste);

  // ---- 20. queries das abas de operacao (filtro por caminhao via join) ----
  const { error: eO1 } = await svc.from("despesas").select(
    `id, carga_id, valor, descricao, foto_path, criado_em,
     profiles!despesas_motorista_id_fkey!inner(nome),
     cargas!inner(caminhao_id, caminhoes(placa))`
  ).eq("cargas.caminhao_id", cam.id);
  check("aba Despesas: query com filtro de caminhao roda", !eO1, eO1?.message);

  const { error: eO2 } = await svc.from("abastecimentos").select(
    `id, carga_id, posto_nome, litros, valor, km_atual, foto_path, criado_em,
     profiles!abastecimentos_motorista_id_fkey!inner(nome),
     cargas!inner(caminhao_id, caminhoes(placa))`
  ).eq("cargas.caminhao_id", cam.id);
  check("aba Abastecimentos: query com filtro de caminhao roda", !eO2, eO2?.message);

  // ---- 21. drill-down: carga completa com todos os filhos ----
  const { data: completa, error: eD } = await svc.from("cargas").select(
    `id, motorista_id, km_inicial, km_final, status, iniciada_em, encerrada_em,
     foto_painel_path,
     profiles!cargas_motorista_id_fkey(nome),
     caminhoes(placa, marca, cor, capacidade_l, tara_kg),
     coletas(id, local_nome, litros, valor_pago, foto_path, latitude, longitude, observacao, criado_em),
     despesas(id, valor, descricao, foto_path, latitude, longitude, criado_em),
     abastecimentos(id, posto_nome, litros, valor, km_atual, foto_path, latitude, longitude, criado_em),
     descargas(id, peso_bruto_kg, peso_tara_kg, peso_liquido_kg, litros_estimados, umidade_pct, foto_papel_path, latitude, longitude, criado_em)`
  ).eq("id", carga.id).maybeSingle();
  check("drill-down: query da carga completa roda", !eD, eD?.message);
  check("drill-down: traz coleta, despesa, abastecimentos e descarga",
    !!completa && completa.coletas?.length === 1 && completa.despesas?.length === 1 &&
    completa.abastecimentos?.length === 2 && completa.descargas?.length === 1,
    completa ? `c=${completa.coletas?.length} d=${completa.despesas?.length} a=${completa.abastecimentos?.length} desc=${completa.descargas?.length}` : "carga nao veio");

  // ---- 22. foto: admin consegue gerar link temporario (auditoria) ----
  const { data: signed, error: eS } = await svc.storage
    .from("fotos-coletas").createSignedUrl(fotoDespesa, 60);
  check("foto da despesa: admin gera link pra visualizar",
    !eS && !!signed?.signedUrl, eS?.message);

  // ---- 23. compra direta: kg medido vs litros estimados ----
  const { data: compraKg, error: eC1 } = await svc.from("compras_diretas").insert({
    data: new Date().toISOString().slice(0, 10),
    fornecedor: "Fornecedor E2E",
    valor: 4000,
    quantidade: 4500,
    unidade: "kg",
    registrado_por: dev.id,
  }).select("id, peso_kg").maybeSingle();
  check("compra direta em kg: peso_kg = quantidade (medido)",
    !eC1 && Number(compraKg?.peso_kg) === 4500, eC1?.message || `peso=${compraKg?.peso_kg}`);
  criados.compraKgId = compraKg?.id;

  const { data: compraL, error: eC2 } = await svc.from("compras_diretas").insert({
    data: new Date().toISOString().slice(0, 10),
    fornecedor: "Fornecedor E2E litros",
    valor: 1000,
    quantidade: 1000,
    unidade: "litros",
    entra_no_estoque: false,
    registrado_por: dev.id,
  }).select("id, peso_kg, entra_no_estoque").maybeSingle();
  check("compra direta em litros: converte por 0,9 (1000 L = 900 kg)",
    !eC2 && Number(compraL?.peso_kg) === 900, eC2?.message || `peso=${compraL?.peso_kg}`);
  check("compra que vai pesar na carga fica marcada pra nao entrar no estoque",
    compraL?.entra_no_estoque === false);
  criados.compraLitrosId = compraL?.id;

  // ---- 24. motorista NAO ve nem mexe em compra direta (RLS) ----
  const { data: comprasMot } = await mot.from("compras_diretas").select("id");
  check("RLS: motorista nao ve compras diretas", (comprasMot || []).length === 0);

  // ---- 25. certificado na compra direta ----
  const { data: compraCert, error: eCert } = await svc.from("compras_diretas").insert({
    data: new Date().toISOString().slice(0, 10),
    fornecedor: "Fornecedor E2E cert",
    valor: 500,
    quantidade: 500,
    unidade: "litros",
    certificado_tipo: "parcial",
    litros_certificado: 300,
    registrado_por: dev.id,
  }).select("id, certificado_tipo, litros_certificado").maybeSingle();
  check("compra direta aceita certificado parcial",
    !eCert && compraCert?.certificado_tipo === "parcial" &&
    Number(compraCert?.litros_certificado) === 300, eCert?.message);
  criados.compraCertId = compraCert?.id;

  // ---- 26. coleta lançada pelo admin numa carga encerrada ----
  // criado_em derivado do corte do acerto (que veio do relógio do
  // servidor) em vez do relógio desta máquina — senão uma diferença de
  // horário entre os dois faria a coleta cair no ciclo anterior e o
  // teste falharia sem haver bug.
  const clientIdAdmin = randomUUID();
  const depoisDoCorte = new Date(
    new Date(acerto.corte_em).getTime() + 1000
  ).toISOString();
  const { error: eAdm } = await svc.from("coletas").insert({
    motorista_id: teste1.id,
    carga_id: carga.id,          // essa carga JÁ foi encerrada no passo 9
    litros: 100,
    local_nome: "Cliente esquecido E2E",
    valor_pago: 90,
    certificado_tipo: "nao",
    gps_capturado: false,
    criado_em: depoisDoCorte,
    client_id: clientIdAdmin,
    lancado_por_admin: dev.id,
  });
  check("admin lanca coleta em carga ENCERRADA", !eAdm, eAdm?.message);
  criados.coletaAdminClientId = clientIdAdmin;

  const { data: colAdm } = await svc.from("coletas")
    .select("lancado_por_admin, carga_id").eq("client_id", clientIdAdmin).maybeSingle();
  check("coleta retroativa fica marcada como lancada no painel",
    colAdm?.lancado_por_admin === dev.id && colAdm?.carga_id === carga.id);

  // O saldo tem que cair 90 (o dinheiro saiu da mao do motorista).
  // Como o acerto do passo 15 zerou o ciclo, o esperado e -90 (so o
  // gasto novo, depois do corte) + o carry de 75 = -15.
  const { data: saldosAposColeta } = await svc.rpc("saldos_motoristas");
  const saldoAposColeta = Number(
    (saldosAposColeta || []).find((s) => s.motorista_id === teste1.id)?.saldo
  );
  check("coleta retroativa desconta do saldo do motorista (75 carry - 90)",
    saldoAposColeta === -15, `saldo=${saldoAposColeta}`);

  // ---- 27. DELETE /api/admin/descargas/[id]: peso bruto <= tara ----
  // O CHECK da 0007 só cobre peso_bruto_kg > 0 e peso_tara_kg > 0
  // isoladamente — nada garante bruto > tara no banco. Se aceitar, não
  // força o check a passar: registra que a defesa é só o endpoint (PATCH
  // route.ts recusa com "o peso bruto precisa ser MAIOR que a tara") e
  // confirma que o valor volta ao normal, sem mentir sobre o resultado.
  {
    const { data: descargaParaTestar } = await svc
      .from("descargas")
      .select("id, peso_bruto_kg")
      .eq("client_id", criados.descargaClientId)
      .maybeSingle();
    const { error: errPesoRuim } = await svc
      .from("descargas")
      .update({ peso_bruto_kg: 1 })
      .eq("id", descargaParaTestar?.id);
    if (errPesoRuim) {
      check("descarga recusa peso bruto menor que a tara", true);
    } else {
      const { error: errRestaura } = await svc
        .from("descargas")
        .update({ peso_bruto_kg: descargaParaTestar?.peso_bruto_kg })
        .eq("id", descargaParaTestar?.id);
      check(
        "banco aceita peso bruto < tara (sem CHECK) — defesa é só o endpoint; valor restaurado",
        !errRestaura,
        errRestaura
          ? errRestaura.message
          : `o banco não tem CHECK bruto>tara — restaurado peso_bruto_kg=${descargaParaTestar?.peso_bruto_kg}`
      );
    }
  }

  // ---- 28. apagar descarga reabre a carga (14/09/2026) ----
  // O posInsert do queue.ts grava TRÊS campos ao encerrar (status,
  // encerrada_em, km_final). Desfazer só dois deixaria a carga rodando com
  // km rodado já calculado, envenenando o km/L da frota. A rota é HTTP
  // (não dá pra chamar direto do script) — reproduz aqui só os dois passos
  // que o teste quer confirmar: apagar a descarga e reabrir a carga.
  //
  // POSICIONADO NO FIM DE PROPÓSITO: depois deste bloco a descarga não
  // existe mais e a carga volta a "ativa" — qualquer check que dependa de
  // descargas?.length===1 ou de status "encerrada" (passos 10-21, 26)
  // precisa rodar ANTES daqui.
  {
    const { data: descargaParaApagar } = await svc
      .from("descargas")
      .select("id")
      .eq("client_id", criados.descargaClientId)
      .maybeSingle();
    await svc.from("descargas").delete().eq("id", descargaParaApagar?.id);
    await svc
      .from("cargas")
      .update({ status: "ativa", encerrada_em: null, km_final: null })
      .eq("id", carga.id);
    const { data: reaberta } = await svc
      .from("cargas")
      .select("status, encerrada_em, km_final")
      .eq("id", carga.id)
      .maybeSingle();
    check(
      "apagar descarga reabre a carga com km_final nulo",
      reaberta?.status === "ativa" &&
        reaberta?.encerrada_em === null &&
        reaberta?.km_final === null,
      JSON.stringify(reaberta)
    );
  }

  // ---- trava de apagar (0059): o BANCO recusa, nao so a API ----
  // O bot nasce desprotegido (default false). Protege, tenta apagar com a
  // chave de servico — que ignora RLS — e so entao desprotege de volta, pro
  // cleanup do fim conseguir remover o perfil.
  await svc.from("profiles").update({ protegido: true }).eq("id", teste1.id);
  const { error: eProt } = await svc.from("profiles").delete().eq("id", teste1.id);
  check(
    "banco RECUSA apagar perfil protegido (nem com service_role)",
    !!eProt,
    eProt ? "" : "apagou e nao devia"
  );
  const { data: aindaLa } = await svc
    .from("profiles").select("id").eq("id", teste1.id).maybeSingle();
  check("o perfil protegido continua no banco depois da tentativa", !!aindaLa);
  await svc.from("profiles").update({ protegido: false }).eq("id", teste1.id);

  await chequesEmMaco();

  await mot.auth.signOut();
}

/**
 * MAÇO DE CHEQUES (0071) — depositar e compensar em lote.
 *
 * O que estes checks defendem, em ordem de importância:
 *
 *  1. DEPÓSITO NÃO É DINHEIRO. A 0071 passou a gravar `cheques.conta_id` já
 *     no depósito, e a segurança disso depende de UM fato: o caixa só lê
 *     cheque com status 'compensado'. Se alguém acrescentar um braço que
 *     leia `conta_id` sem filtrar o status, o depositado vira dinheiro que
 *     não existe — e ninguém percebe. O check do delta zero é o guardião
 *     dessa promessa.
 *  2. TUDO-OU-NADA. Lote meio-aplicado (8 depositados, 2 na carteira) não dá
 *     erro e não dá pra reproduzir. O check manda um lote com um cheque
 *     "sujo" e exige que os OUTROS continuem intactos.
 */
async function chequesEmMaco() {
  // ⚠️ Devolve NaN quando a conta não aparece, nunca null. A primeira versão
  // devolvia null e o check de "depósito não mexe no caixa" passou VERDE
  // comparando null === null — sem ter medido nada. Falso positivo num check
  // de dinheiro é pior que vermelho: ele promete uma garantia que não existe.
  const saldoDaConta = async (id) => {
    const { data } = await svc.rpc("saldo_contas");
    const linha = (data ?? []).find((c) => c.conta_id === id);
    return linha ? Number(linha.saldo) : NaN;
  };

  // Conta e comprador descartáveis — nada de usar os de verdade.
  const { data: conta } = await svc
    .from("contas_financeiras")
    .insert({
      nome: `E2E Banco ${Date.now()}`,
      tipo: "banco",
      saldo_inicial: 0,
      saldo_inicial_em: "2020-01-01",
      // ATIVA de propósito: a `saldo_contas()` filtra `ativa = true`. Com a
      // conta inativa ela não aparece na resposta e os checks de saldo
      // mediriam o nada. Ela existe por ~1 minuto e some no cleanup — mesma
      // escolha do motorista descartável.
      ativa: true,
    })
    .select("id")
    .single();
  criados.contaFinId = conta?.id ?? null;

  const { data: comprador } = await svc
    .from("compradores")
    .insert({ nome: `E2E Comprador ${Date.now()}`, ativo: false })
    .select("id")
    .single();
  criados.compradorId = comprador?.id ?? null;
  if (!conta || !comprador) {
    check("maço de cheques: conseguiu montar o cenário", false, "conta/comprador");
    return;
  }

  // 3 cheques na carteira, R$ 100 + 200 + 300 = 600.
  const valores = [100, 200, 300];
  const ids = [];
  for (const v of valores) {
    const { data: rec } = await svc
      .from("recebimentos")
      .insert({
        comprador_id: comprador.id,
        forma: "cheque",
        valor: v,
        data: "2026-01-02",
        registrado_por: criados.motoristaId,
      })
      .select("id")
      .single();
    const { data: ch } = await svc
      .from("cheques")
      .insert({
        recebimento_id: rec.id,
        comprador_id: comprador.id,
        banco: "999",
        emitente: "E2E Emitente",
        numero: String(v),
        valor: v,
        bom_para: "2026-02-01",
      })
      .select("id")
      .single();
    ids.push(ch.id);
    criados.chequeIds.push(ch.id);
    criados.recebimentoIds.push(rec.id);
  }

  const saldoAntes = await saldoDaConta(conta.id);

  // ---- guards que têm que RECUSAR ----
  const { error: eSemConta } = await svc.rpc("depositar_cheques", {
    ids,
    conta: null,
    quando: "2026-02-02",
  });
  check("depósito sem conta é RECUSADO", !!eSemConta, eSemConta ? "" : "passou");

  const { error: eRepetido } = await svc.rpc("depositar_cheques", {
    ids: [ids[0], ids[0]],
    conta: conta.id,
    quando: "2026-02-02",
  });
  check("depósito com cheque repetido é RECUSADO", !!eRepetido);

  // ---- tudo-ou-nada: um cheque sujo derruba o lote inteiro ----
  await svc.from("cheques").update({ status: "depositado" }).eq("id", ids[2]);
  const { error: eSujo } = await svc.rpc("depositar_cheques", {
    ids,
    conta: conta.id,
    quando: "2026-02-02",
  });
  const { data: intactos } = await svc
    .from("cheques")
    .select("id, status")
    .in("id", [ids[0], ids[1]]);
  check(
    "lote com 1 cheque fora da carteira é RECUSADO",
    !!eSujo,
    eSujo ? "" : "depositou e não devia"
  );
  check(
    "e os OUTROS cheques do lote recusado ficam intactos na carteira",
    (intactos ?? []).length === 2 &&
      intactos.every((c) => c.status === "em_carteira"),
    JSON.stringify(intactos)
  );
  await svc.from("cheques").update({ status: "em_carteira" }).eq("id", ids[2]);

  // ---- o caminho feliz ----
  const { error: eDep } = await svc.rpc("depositar_cheques", {
    ids,
    conta: conta.id,
    quando: "2026-02-02",
  });
  const { data: depositados } = await svc
    .from("cheques")
    .select("status, conta_id, depositado_em")
    .in("id", ids);
  check("depósito do maço inteiro funciona", !eDep, eDep?.message ?? "");
  check(
    "os 3 ficam depositados, com a conta e a data gravadas",
    (depositados ?? []).length === 3 &&
      depositados.every(
        (c) =>
          c.status === "depositado" &&
          c.conta_id === conta.id &&
          String(c.depositado_em).slice(0, 10) === "2026-02-02"
      ),
    JSON.stringify(depositados)
  );

  // ⚠️ O CHECK MAIS IMPORTANTE DESTE BLOCO.
  const saldoDepois = await saldoDaConta(conta.id);
  check(
    "DEPÓSITO NÃO MEXE NO CAIXA (a conta continua com o mesmo saldo)",
    Number(saldoAntes) === Number(saldoDepois),
    `antes=${saldoAntes} depois=${saldoDepois}`
  );

  // ---- idempotência: reenviar o mesmo lote não deposita de novo ----
  const { error: eDeNovo } = await svc.rpc("depositar_cheques", {
    ids,
    conta: conta.id,
    quando: "2026-02-02",
  });
  check("reenviar o mesmo maço é RECUSADO", !!eDeNovo);

  // ---- tirar do maço devolve o cheque limpo ----
  await svc
    .from("cheques")
    .update({ status: "em_carteira", depositado_em: null, conta_id: null })
    .eq("id", ids[2]);
  const { data: tirado } = await svc
    .from("cheques")
    .select("status, conta_id, depositado_em")
    .eq("id", ids[2])
    .maybeSingle();
  check(
    "tirar do maço devolve o cheque SEM conta e SEM data de depósito",
    tirado?.status === "em_carteira" &&
      tirado?.conta_id === null &&
      tirado?.depositado_em === null,
    JSON.stringify(tirado)
  );

  // ---- compensar: agora sim o dinheiro entra ----
  const doMaco = [ids[0], ids[1]];
  const { error: eComp } = await svc.rpc("compensar_cheques", {
    ids: doMaco,
    quando: "2026-02-05",
    conta: null,
  });
  const saldoCompensado = await saldoDaConta(conta.id);
  check("compensação do maço funciona", !eComp, eComp?.message ?? "");
  check(
    "COMPENSAR PÕE O DINHEIRO NA CONTA (+300 dos dois cheques)",
    Math.round((Number(saldoCompensado) - Number(saldoAntes)) * 100) === 30000,
    `antes=${saldoAntes} depois=${saldoCompensado}`
  );

  // ---- compensar sem saber a conta é recusado ----
  await svc
    .from("cheques")
    .update({ status: "depositado", conta_id: null, depositado_em: "2026-02-02" })
    .eq("id", ids[2]);
  const { error: eSemDestino } = await svc.rpc("compensar_cheques", {
    ids: [ids[2]],
    quando: "2026-02-05",
    conta: null,
  });
  check(
    "compensar cheque que não sabe em qual conta caiu é RECUSADO",
    !!eSemDestino,
    eSemDestino ? "" : "compensou sem conta — o dinheiro sumiria do caixa"
  );
}

async function cleanup() {
  console.log("\n🧹 Limpando dados do E2E...");

  // Cada delete tem que RECLAMAR quando falha. A versão anterior ignorava o
  // erro e imprimia "Limpo" do mesmo jeito — um abastecimento esquecido
  // segurava a carga por FK, que segurava o caminhão, que segurava o bot, e
  // o run seguinte quebrava em "duplicate key placa" sem ninguém entender
  // por quê. Limpeza que mente é pior que limpeza que falha.
  const sobrou = [];
  const del = async (tabela, coluna, valor) => {
    if (!valor) return;
    const { error } = await svc.from(tabela).delete().eq(coluna, valor);
    if (error) sobrou.push(`${tabela}.${coluna}=${valor}: ${error.message}`);
  };

  try {
    // Maço de cheques: o cheque segura a conta financeira por FK e o
    // recebimento segura o comprador. Ordem importa — cheque, recebimento,
    // comprador, conta. (O cheque cai junto com o recebimento por cascade,
    // mas o delete explícito deixa o erro visível se algo prender.)
    for (const id of criados.chequeIds) await del("cheques", "id", id);
    for (const id of criados.recebimentoIds) await del("recebimentos", "id", id);
    await del("compradores", "id", criados.compradorId);
    await del("contas_financeiras", "id", criados.contaFinId);

    // SÓ ids que este run criou — nunca deletes amplos por motorista
    // (o Teste 1 do Evaner vive no mesmo banco).
    await del("coletas", "client_id", criados.coletaAdminClientId);
    await del("compras_diretas", "id", criados.compraCertId);
    await del("compras_diretas", "id", criados.compraKgId);
    await del("compras_diretas", "id", criados.compraLitrosId);
    await del("acertos", "id", criados.acertoId);
    await del("adiantamentos", "id", criados.adiantamentoId);
    await del("descargas", "client_id", criados.descargaClientId);
    await del("despesas", "client_id", criados.despesaClientId);
    await del("abastecimentos", "client_id", criados.abastClientId);
    // A nota assinada gera conta a pagar por trigger (0034) — a conta
    // referencia o bot em registrado_por e seguraria o delete do profile.
    if (criados.motoristaId) {
      await del("contas_a_pagar", "registrado_por", criados.motoristaId);
    }
    await del("abastecimentos", "client_id", criados.abastAssinadoClientId);
    await del("coletas", "client_id", criados.coletaSedeClientId);
    await del("coletas", "client_id", criados.coletaParcialClientId);
    await del("coletas", "client_id", criados.coletaClientId);
    await del("cargas", "id", criados.cargaId);
    await del("caminhoes", "id", criados.caminhaoId);
    if (criados.fotos.length) await svc.storage.from("fotos-coletas").remove(criados.fotos);
    // Por fim, o próprio bot
    if (criados.motoristaId) {
      await del("app_events", "motorista_id", criados.motoristaId);
      await del("profiles", "id", criados.motoristaId);
      const { error } = await svc.auth.admin.deleteUser(criados.motoristaId);
      if (error) sobrou.push(`auth.users ${criados.motoristaId}: ${error.message}`);
    }

    // POR ÚLTIMO: apagar o bot também gera linha de log. Se isto rodasse
    // antes, a linha da própria exclusão ficaria pra trás.
    if (criados.logDesdeId !== undefined && criados.logDesdeId !== null) {
      const { error } = await svc
        .from("log_admin").delete().gt("id", criados.logDesdeId);
      if (error) sobrou.push(`log_admin > ${criados.logDesdeId}: ${error.message}`);
    }
  } catch (e) {
    sobrou.push(`exceção: ${e.message}`);
  }

  if (sobrou.length === 0) {
    console.log("🧹 Limpo (incluindo o bot).");
  } else {
    console.error("⚠️ LIMPEZA INCOMPLETA — sobrou lixo no banco:");
    for (const s of sobrou) console.error(`   • ${s}`);
    resultados.push({
      nome: "limpeza do E2E",
      ok: false,
      detalhe: `${sobrou.length} item(ns) não apagados`,
    });
  }
}

main()
  .catch((e) => {
    console.error("💥 E2E abortou:", e.message);
    resultados.push({ nome: "execução completa", ok: false, detalhe: e.message });
  })
  .finally(async () => {
    await cleanup();
    const falhas = resultados.filter((r) => !r.ok);
    console.log(`\n===== ${resultados.length - falhas.length}/${resultados.length} passaram =====`);
    if (falhas.length) {
      console.log("FALHAS:");
      for (const f of falhas) console.log(`  ❌ ${f.nome} — ${f.detalhe}`);
      process.exit(1);
    }
    process.exit(0);
  });
