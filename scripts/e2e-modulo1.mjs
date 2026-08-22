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

  await mot.auth.signOut();
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
