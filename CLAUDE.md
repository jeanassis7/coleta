# Projeto Coleta — Contexto pra Claude

App PWA para coleta de óleo lubrificante usado (OLUC). Construído pelo **Evaner** pra empresa do irmão **Jean**.

> **Começando uma sessão?** Leia dois arquivos:
> - **`ESTADO.md`** — onde paramos, o que está pendente, qual o próximo passo.
> - **`NEGOCIOv3.md`** — as 131 regras do negócio, conferidas pelo Evaner uma a uma. É a fonte da verdade sobre **como a empresa funciona**, e a Parte XII dele é a lista de trabalho aberta.
>
> **Vai mexer em qualquer coisa que toca DINHEIRO?** `REGUA-DO-DINHEIRO.md` —
> as 8 perguntas obrigatórias (maior que o limite, zero/negativo, dois
> cliques, apagar depois, dobra em relatório, tela mascarando, guard no
> servidor, teste do caminho errado). **Não é opcional**: nasceu de um
> buraco real que passou por falta de método, não de atenção.
>
> Este arquivo aqui é o contexto permanente do CÓDIGO (convenções, decisões, armadilhas).

## Quem usa

- **3 motoristas em campo** (Luis, Lucimar, Lucinei) — Android + 1 possivelmente iPhone. PWA instalado.
- Baixa familiaridade tecnológica — regra de ouro: **se exige mais de 3 toques e um pensamento, está complexo demais.**
- **Jean** — gestor, usa painel admin no computador.

## Rotas operacionais

Guaíra, Toledo, Cascavel, Foz do Iguaçu (oeste do PR). Muita área rural sem sinal — **offline-first é mandatório, não opcional.**

## Stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind**
- **Supabase** (Auth + Postgres + Storage) — projeto `jjhs-coleta`
- **Dexie** (IndexedDB) — fila offline no celular
- **Serwist** — Service Worker, estratégia `StaleWhileRevalidate` pra navegação (CRÍTICO pro offline funcionar com sinal ruim)
- **Leaflet + OSM** — mapa do admin (zero custo, sem API key)
- **PDFKit** — gera o manual do Jean

## URLs, acessos e credenciais

- **Produção:** https://coleta-inky.vercel.app
- **Admin (Jean):** https://coleta-inky.vercel.app/admin/login → `jean@coleta.local` / `Progevaner123$`
- **Evaner:** mesmo login → `evaner@coleta.local` / `senharolha` (role `admin`, `ve_log=true`)
- **Repo:** https://github.com/jeanassis7/coleta (Evaner é colaborador com Write)
- **Supabase project:** `jjhs-coleta` (URL `zwghaoubzrkluckrcxwi.supabase.co`)
  - `DATABASE_URL` (session pooler) está no `.env.local` — permite rodar migrations daqui via `scripts/aplicar-migration.mjs`, sem abrir o SQL Editor
- **Motoristas** (todos em `@coleta.local`): Luis/`volante`, Lucimar/`tanque`, Lucinei/`lanterna`
- **Teste 1:** `teste1@coleta.local` / `teste123` — motorista comum hoje. Não existe mais perfil "invisível": pra testar, cria-se um perfil normal e apaga-se depois.

## Roles (2 níveis) + capacidades por coluna

- **`motorista`** — PWA. Features novas chegam via flag individual em `profiles.features`.
- **`admin`** — painel. **Jean e Evaner são os dois `admin`.**

Helpers em `src/lib/auth/roles.ts`: `podeAcessarAdmin`, `hasFeature`. Nos endpoints, `exigirAdmin()` de `src/lib/auth/exigir-admin.ts` (gate único — checa role E `ativo`).

**REGRA (decisão do Evaner, 19/08/2026): capacidade extra vira COLUNA no cadastro, NUNCA papel novo.**
Papel responde "entra ou não entra"; coluna responde "enxerga o quê". Hoje existe uma só:

| Coluna | O que faz | Quem tem |
|---|---|---|
| `profiles.ve_log` | enxerga `/admin/log` | só o Evaner |

Existiu um terceiro papel `dev` enquanto os Módulos 1 e 2 eram invisíveis pro Jean. Depois do flip virou hierarquia sem função e foi apagado (migrations 0023/0024). Se precisar de "só fulano vê X", **acrescente uma coluna booleana** — não recrie o `dev`.

⚠️ **Ao mexer em role, checar 4 lugares** (bug real já aconteceu): `src/middleware.ts`, `/admin/(authed)/layout.tsx`, `/admin/login/page.tsx` e `/motorista/login/page.tsx`. No Postgres, `is_admin()` cobre só `role='admin'` e é `stable` — **não trocar por `volatile`**, senão a RLS reavalia linha a linha.

**Admin não é desativável nem deletável pelo painel** — no servidor e na tela. Sem o papel `dev` não existe backdoor: quem perde o acesso só volta por SQL.

**`profiles.protegido` não é um toggle** (0059). As 6 pessoas de verdade (Evaner, Jean, Lucimar, Lucinei, Luiz, Valdecir) são inapagáveis pelo app: o campo saiu da tela e da API, e o trigger `trg_impedir_delete_protegido` recusa o DELETE **no banco** — vale pra API, script e SQL Editor. Perfil de teste nasce sem a trava e continua apagável (é o fluxo de "crio um perfil normal, testo de verdade, apago depois"). Pra apagar um protegido: `update profiles set protegido=false` por SQL, com intenção, e só então apagar.

## Arquitetura — visão rápida

```
/motorista/*                    → PWA leve, offline-first
  /login                        → primeiro acesso (precisa internet)
  /                             → home (NOVA COLETA + [se features.carga] barra do
                                  caminhão, DESCARREGAR, ABASTECIMENTO, DESPESAS,
                                  CANCELAR CARGA) + [se features.saldo] card de saldo
  /nova-coleta                  → form principal, GPS captura ao abrir
  /confirmacao                  → tela de sucesso
  ── Módulo 1 (só com features.carga=true) ──
  /iniciar-carga                → boas-vindas → form (caminhão + km + foto do painel)
  /abastecimento                → posto, litros, valor, km, foto (antiburro de km)
  /despesa                      → valor, descrição, foto obrigatória
  /descarregar                  → peso bruto → líquido/litros, antiburros no confirmar
  /carga-encerrada              → resumo (duração, coletas, pesos)

/admin/*                        → painel web (sidebar vertical com grupos)
  /login                        → fora do (authed)
  /(authed)/                    → rotas protegidas
    /                           → dashboard: [Módulo 1] alertas + cargas ativas +
                                  descargas recentes, depois KPIs + análises + lista/mapa
    /mapa · /observacoes · /curadoria · /motoristas · /eventos   (como sempre)
    ── Módulo 1 e 2 ──
    /cargas                     → tabela densa (19 col) + umidade na coluna Umid.
    /abastecimentos             → lista + edição (corrigir lançamento errado)
    /adiantamentos              → saldo por motorista + enviar + acerto
    /adiantamentos/[id]         → histórico de dinheiro do motorista
    /caminhoes                  → lista da frota (placa clica pra ficha)
    /caminhoes/[id]             → FICHA: próxima troca de óleo por km, km/L e
                                  gasto do mês, manutenções e documentos
    /motoristas/[id]            → FICHA: documentos (CNH, toxicológico, MOPP,
                                  cursos) + link pro histórico de dinheiro
    /features                   → liga feature por motorista (rollout gradual)
    /log                        → quem fez o quê (só quem tem ve_log)
    /estoque · /vendas · /cheques · /contas · /compradores   (Módulo 2)
    /postos                     → saldo por posto (nota assinada em aberto)
    /postos/[id]                → extrato + FECHAMENTO (cheque/dinheiro/troco)
                                  + curadoria (renomear, juntar grafias)
    ── Módulo financeiro ──
    /caixa                      → saldo por conta + dinheiro na mão dos
                                  motoristas + transferências (saque/depósito)
    /lancamentos                → o que JÁ SAIU, no ritmo do extrato bancário
    /dre                        → painel por REGIME DE CAIXA, abre por pessoa
    /remuneracao                → vigências + cálculo da comissão do período

/api/admin/*                    → endpoints com service_role
  /motoristas[/id][/feature], /coletas/[id], /coletas/bulk-delete, /locais[/id],
  /caminhoes[/id], /descargas/[id], /abastecimentos/[id], /adiantamentos[/id],
  /acertos, /alertas/visto, /manutencoes[/id], /documentos[/id],
  /contas-financeiras[/id], /transferencias[/id], /vigencias[/id],
  /caixa/lancamentos, /cheques/ocr, /cheques/lote,
  /postos/[id] (curadoria), /postos/[id]/fechamento
/api/cron/backup                → backup mensal em CSV (cron da Vercel, dia 1º;
                                  admin logado também pode disparar na mão)
/api/locais/proximos            → busca por proximidade (client motorista)
```

## Convenções IMPORTANTES

- **Tudo em português** (UI, comentários, variáveis quando faz sentido)
- **Timezone:** `America/Sao_Paulo` (UTC-3 fixo). Helpers `nowBrParts`, `fromBrParts` em `src/lib/admin/queries.ts`
- **Dinheiro tem DUAS convenções** (decisão do Evaner após teste de campo):
  - **Coleta:** `valor_pago integer`, valor cheio sempre (100, 125, 200). UI rejeita vírgula com aviso.
  - **Despesa/abastecimento/adiantamento/acerto:** `numeric(10,2)` COM centavos (combustível nunca é redondo). UI usa `InputDinheiro` (src/components/InputDinheiro.tsx) — máscara estilo banco, digita algarismos e preenche da direita ("68047" → R$ 680,47). NUNCA usar input de texto livre pra dinheiro — o parser antigo descartava vírgula e "520,12" virava 52.012.
- **Períodos** alinhados ao calendário BR:
  - Hoje = 00:00-23:59 BR
  - Semana = domingo a sábado da semana atual
  - Mês = dia 1 ao último dia do mês atual
  - Comparações "vs anterior" = **mesmo intervalo até mesma data** (justo)
- **Email dos usuários** = identificador interno `nome@coleta.local`, não é email real
- **Foto:** 800px / JPEG q60 / alvo 100KB. Comprimida no celular antes de salvar. Label na UI = "Foto da fachada/portão"
- **GPS:** captura ao ABRIR Nova Coleta (não no save). Timeout 10s. Flag `gps_pendente` impede sync antes de GPS resolver.

## Números "mágicos" com contexto

- **Curadoria — cluster GPS 20m:** agrupa coletas próximas pra sugerir merge (área urbana precisa)
- **Curadoria — cluster nome:** ainda agrupa se nome normalizado for igual (fallback pra GPS ruim)
- **Local canônico — raio_match_m: 100m FIXO:** NÃO é configurável pelo admin (decisão do Evaner de simplificar)
- **Sugestão pro motorista — busca 100m:** mostra locais cadastrados nesse raio. UI mostra SÓ o nome (sem metros)
- **Cleanup local — 24h:** coletas 100% sincronizadas apagadas do IndexedDB após 24h
- **Cleanup eventos — 7 dias:** eventos sincronizados apagados após 7 dias
- **Recovery GPS pendente — 30s:** libera flag se GPS travou
- **Antiburro de peso na descarga — ±30%:** compara o peso da balança com `soma_litros × 0,9`
- **Antiburro de km — salto de 1.500km:** limite aprovado pelo Evaner entre dois registros do mesmo caminhão
- **Alerta estatístico — 30 coletas OU 60 dias:** base mínima pro alerta de preço fora da curva (alerta ruidoso ensina a ignorar alerta)
- **Carga parada — 15 dias:** vira alerta de "esqueceu de finalizar"
- **Aceite de adiantamento pulado — 10×:** vira alerta pro gestor

## Migrations já aplicadas (NÃO re-criar)

Em `supabase/migrations/` — aplicar com `node scripts/aplicar-migration.mjs <arquivo>`:
- `0001_initial.sql` — schema, RLS, storage bucket
- `0002_admin_features.sql` — `profiles.senha_visivel`
- `0003_locais.sql` — tabela `locais`, função `locais_proximos`, view `locais_com_stats`
- `0004_storage_rls_fix.sql` — UPDATE/DELETE policies pra fotos (resolveu bug "RLS violation")
- `0005_role_dev.sql` — role `dev` + `is_admin()` passa a cobrir admin E dev
- `0006_foundations.sql` — `profiles.features` (jsonb), `is_teste`, `mostra_saldo_app`
- `0007_cargas.sql` — `caminhoes`, `cargas` (índice único de 1 ativa), `coletas.carga_id`, `descargas` (peso_liquido generated), `despesas`, `abastecimentos` + RLS
- `0008_adiantamentos.sql` — `adiantamentos` (pendente/aceito/cancelado), `acertos` (`corte_em timestamptz`)
- `0009_client_ids_offline.sql` — `client_id` unique nas 3 tabelas (sync idempotente)
- `0010_valores_com_centavos.sql` — despesa/abastecimento/adiantamento/acerto viram `numeric(10,2)`
- `0011_acerto_saldo_negativo.sql` — remove CHECK >= 0 (empresa pode dever pro motorista)
- `0012_alertas_vistos.sql` — tabela de alertas dispensados no "OK, VI"
- `0013_saldos_motoristas.sql` — função `saldos_motoristas()` (a conta de saldo inteira no Postgres; matou o N+1 que deixava o painel em 3-4s)
- `0014_compras_diretas.sql` — `compras_diretas` com `peso_kg` generated (kg medido ou litros×0,9)
- `0015_certificado_compra_e_coleta_admin.sql` — certificado na compra direta + `coletas.lancado_por_admin`
- `0016_estoque.sql` — view `movimentos_estoque` + `estoque_atual()` (custo médio ponderado móvel) + `ajustes_estoque` (inventário)
- `0017_vendas.sql` — `compradores`, `vendas`, `recebimentos`, `cheques`, `saldo_compradores()`; redefine `movimentos_estoque` incluindo o braço das vendas
- `0018_gastos_veiculos_postos.sql` — `caminhoes.tipo` (caminhao|carro), posto por GPS em `locais.tipo`, abastecimento "assinei a nota"
- `0019_contas_a_pagar.sql` — `contas_a_pagar`, `despesas_recorrentes`, `resumo_contas_a_pagar()`
- `0020_foto_opcional_lancamento_admin.sql` — lançamento pelo painel sem foto
- `0021_coleta_paga_pela_sede.sql` — coleta que a sede paga vira conta a pagar em vez de sair do saldo do motorista
- `0022_log_admin.sql` — tabela `log_admin` + trigger `trg_log_admin` em 19 tabelas + `profiles.ve_log`
- `0023_evaner_vira_admin.sql` — quem era `dev` vira `admin` (rodou ANTES do deploy, ver comentário no arquivo)
- `0024_fim_do_is_teste.sql` — `is_admin()` perde o `dev` e vira `stable`; `movimentos_estoque` perde o filtro de teste; **`profiles.is_teste` é derrubada** (rodou DEPOIS do deploy)
- `0025_manutencoes.sql` — `manutencoes` (tipo, valor, km, `proxima_km` da troca de óleo), admin-only
- `0026_documentos.sql` — `documentos` com CHECK `um_dono_so` (caminhão XOR motorista) + bucket privado `documentos`, admin-only
- `0027_contas_financeiras.sql` — **caixa de verdade**: `contas_financeiras` (espécie/banco, com saldo inicial e data de CORTE), `transferencias` (saque/depósito), `conta_id` em recebimentos/contas_a_pagar/adiantamentos/acertos, e a função `saldo_contas()`
- `0028_conta_no_cheque.sql` — `cheques.conta_id`: cheque só vira dinheiro na conta quando **compensa**
- `0029_lancamentos.sql` — `contas_a_pagar.pessoa_id` (o QUEM separado do QUÊ)
- `0030_vigencias_remuneracao.sql` — `vigencias_remuneracao`: salário, comissão, bônus e transferência a sócio, cada um valendo **a partir de uma data**
- `0031_coleta_valor_zero.sql` — coleta aceita R$ 0 (doação, R2)
- `0032_vale_quitado.sql` — `acertos.vale_quitado_em/por`: o sistema lembra do vale ao pagar salário
- `0033_meu_saldo.sql` — RPC `meu_saldo()`: o card do motorista usa a MESMA fórmula do painel
- `0034_conta_nasce_da_nota_assinada.sql` — **trigger**: abastecimento `pago_na_hora=false` gera a conta a pagar sozinho (cobre o sync do celular)
- `0035_conta_na_compra_direta.sql` — `compras_diretas.conta_id` + braço da compra no `saldo_contas()`
- `0036_configuracoes.sql` — tabela chave/valor (nasceu pro `preco_referencia_litro` do patrimônio)
- `0037_adiantamento_so_aceite_pelo_motorista.sql` — trigger: motorista só pode ACEITAR (RLS é por linha, não por coluna)
- `0038_vigencia_geral_unica.sql` — índice único parcial pras vigências gerais (NULLs eram distintos)
- `0039_alerta_visto_por_admin.sql` — PK de `alertas_vistos` vira (chave, visto_por): cada admin tem a própria dispensa
- `0040_desempate_movimentos_estoque.sql` — `sub_prioridade` na view: entrada antes de saída no mesmo dia, ordem 100% determinística
- `0041_lote_cheques_idempotente.sql` — `recebimentos.client_id` unique: reenvio do maço de cheques não duplica
- `0042_corte_do_caixa_em_dia_br.sql` — braço dos adiantamentos do `saldo_contas()` corta pelo dia BR (janela de 3h na véspera do corte)
- `0043`–`0054` — ver `ESTADO.md` (troca de óleo por data, ARLA, compra vinculada à carga, motorista×caminhões, caixa fecha de verdade, venda idempotente, perfil protegido, custo da compra na descarga, fotos do caixa, dívidas, buracos financeiros)
- `0055_atores_do_log.sql` — RPC `atores_do_log()`: DISTINCT no banco pro filtro da tela de log (o select cru truncava em 1000 sem ordem)
- `0056_backup_mensal.sql` — bucket privado `backups` + RPC `listar_tabelas_backup()` (lista vem do catálogo: tabela nova entra no backup sozinha)
- `0059_trava_de_apagar_nao_e_toggle.sql` — `profiles.protegido` sai do painel e da API; trigger `trg_impedir_delete_protegido` recusa o DELETE no banco (as 6 pessoas de verdade ficam inapagáveis pelo app)
- `0058_coleta_pagamento_parcial_da_sede.sql` — `coletas.valor_sede`: a sede pode bancar SÓ UMA PARTE da coleta (+ CHECK amarrando o par e `saldos_motoristas()` descontando a diferença)
- `0057_umidade_nao_analisada.sql` — `descargas.umidade_nao_analisada`: "a análise não foi feita" vira LANÇAMENTO, não campo vazio (+ CHECK de coerência e backfill das 131 descargas históricas)
- `0060_adiantamento_de_regularizacao.sql` — `adiantamentos.regularizacao`: o lançamento da virada não é fato vivido pelo motorista e fica fora do relatório dele (conta no saldo normalmente)
- `0061_postos_e_socio.sql` — `abastecimentos.socio_id` + o gatilho da nota assinada passa a ROTEAR a categoria (`combustivel` × `transferencia_socio`); backfill dos postos por GPS em `locais.tipo='posto'`; `saldo_postos()`

⚠️ **Consulta sem limite natural usa `selectTudo()`** (`src/lib/supabase/select-tudo.ts`): o Supabase trunca em 1.000 linhas SEM ERRO. Toda query que cresce com o tempo (histórico inteiro, janelas de 90 dias) pagina com o helper — exige `.order()` estável. Já aplicado em DRE (jaTemConta), coletas do dashboard, coletas dos alertas, alertas_vistos e km da frota. Query nova sem teto = selectTudo, sempre.

⚠️ **Tabela nova ganha log sozinha.** A `0022` instalou o event trigger `trg_auto_ligar_log`: toda `create table` em `public` recebe `trg_log_admin` automaticamente. **Não criar o trigger na mão** — dá trigger duplicado e log em dobro.

## MÓDULO 1 (Cargas/ERP) — regras que valem pra tudo daqui pra frente

**Estágio atual: LIBERADO.** Jean vê tudo. O gate (`gate-modulo1.ts`) foi apagado em 19/08/2026 — endpoints usam `exigirAdmin()`, páginas não precisam de gate próprio porque o `(authed)/layout.tsx` já barra quem não é admin.

**Ciclo de vida de feature:** admin liga em UM motorista em `/admin/features`, acompanha alguns dias, estende pros outros. Feature nova nasce **OFF** pra todos. Desligar não apaga nada que já foi lançado.

**Não existe mais motorista de teste.** A coluna `is_teste` foi derrubada (0024). Decisão do Evaner: pra testar, cria-se um **perfil normal**, testa-se de verdade — entrando nos relatórios como qualquer motorista — e apaga-se depois de 1-2h. Não reintroduzir filtro de teste em query nova.

**Ciclo = CARGA** (não "viagem"): dura 3-10 dias, encerra na descarga (pesagem na balança). Só 1 ativa por motorista (índice único no banco).

**Unidade:** motorista declara **LITROS**; da balança em diante é **KG** (densidade fixa **0,9 kg/L**). Estoque e venda em kg; litros só como referência.

**Tara:** fonte única é o cadastro do caminhão. A descarga grava um **snapshot** — se Jean recalibrar depois, descarga antiga preserva a tara da época.

**Offline-first vale pros 4 lançamentos** (coleta, despesa, abastecimento, descarga): GPS na hora + fila no IndexedDB + sync com `client_id` idempotente. *Iniciar carga* é a única ação que exige sinal (o servidor garante "1 carga ativa"). Descarga encerra a carga **localmente** na hora; o sync fecha no servidor.

**Antiburros são inline e só no clique do botão** — nunca enquanto digita. Padrão: primeiro toque mostra bloco amarelo explicando, segundo toque ("CONFIRMAR MESMO ASSIM") prossegue. Erro impossível (peso < tara, km < início da carga) **bloqueia** em vermelho.

**Compra direta (`compras_diretas`):** óleo que o GESTOR negocia e paga do caixa da empresa — o motorista não coletou. Não desconta saldo de ninguém, não entra em custo/certificado por motorista nem em comissão. Entra no estoque (em kg) e no custo médio do óleo (KPIs de topo do dashboard). Quem pesou lança em **kg** (medido); quem não pesou lança em **litros** (estimado, converte por 0,9). A flag `entra_no_estoque=false` cobre o caso raro do óleo ter ido num caminhão que ainda vai pesar na descarga — aí conta só o custo, senão o mesmo óleo entraria duas vezes.

> **Regra de processo pro tutorial do Jean** (não é código, é combinado): quem for pegar um caminhão que já tem óleo pra descarregar precisa avisar o motorista **encerrar a carga dele e mandar a foto do peso**. Buscar óleo de fora sempre com **caminhão vazio**.

> **Regra de processo pro tutorial — inventário de estoque:** o inventário vale pro **fim do dia escolhido**. Se entrou óleo naquele mesmo dia, o sistema entende que a contagem já inclui ele. Como a contagem acontece a cada **2-3 meses** e a diferença esperada é sutil (uns 10.000 kg em 85.000), a ambiguidade cabe na margem de erro — decisão consciente do Evaner de não pedir a hora da contagem. Se um dia a contagem virar rotina semanal, aí sim vale perguntar "contou antes ou depois da descarga de hoje?".

**Coleta retroativa (`coletas.lancado_por_admin`):** o motorista coletou, esqueceu de lançar e avisou depois. Botão "+ Adicionar coleta" no detalhe da carga (`/admin/cargas/[id]`), funciona **mesmo com a carga encerrada**. Pertence ao motorista da carga e **desconta do saldo dele** (o dinheiro saiu da mão dele). Sem GPS e sem foto — não foi capturada em campo, e a linha do tempo marca "lançada no painel". Se a data for anterior ao último acerto, cai no ciclo fechado e não mexe no saldo atual (a tela avisa).

**Alertas do dashboard** (`src/lib/admin/alertas.ts`): calculados na hora, texto **didático** (o que aconteceu → hipóteses de causa → o que fazer). `alertas_vistos` guarda os dispensados; a chave é a **ocorrência** (id do registro), então condição repetida em outro registro = alerta novo. Alerta estatístico só liga com base suficiente (30+ coletas ou 60+ dias) — alerta ruidoso ensina a ignorar alerta.

## MÓDULO FINANCEIRO — as regras que valem

> **As regras de NEGÓCIO inteiras estão em `NEGOCIOv3.md`** (131 regras
> numeradas, conferidas pelo Evaner uma a uma). Aqui ficam só as que mudam
> como se escreve código.

**O caixa é a fundação.** Dinheiro não aparece nem some: toda saída sai de uma
conta, toda entrada entra em uma. Sem `conta_id` o movimento não existe pro
caixa — e o DRE em cima disso seria número sem lastro.

**Na coleta, "quanto custou" e "de quem saiu" são números diferentes.**
`valor_pago` é o custo do óleo (é ele que entra no estoque); `valor_sede` é
a parte que a empresa pagou direto ao fornecedor; a diferença é o que saiu
do bolso do motorista e desconta do saldo dele. Os três podem coexistir na
MESMA coleta (0058) — o `pago_pela_sede` virou só "a sede entrou nessa", com
CHECK amarrando os dois. Query nova que fala de saldo soma a **diferença**,
nunca filtra por `not pago_pela_sede`.

**A saída que nasce de um fato NÃO se lança de novo pelo extrato.** A conta
a pagar de origem `coleta`/`abastecimento`/`manutencao` já é a linha do
banco. Lançar a mesma de novo em /admin/lancamentos deixa o saldo do app
abaixo do saldo real — por isso o endpoint avisa quando encontra uma saída
igual (mesma conta, mesmo valor, ±3 dias) e pede o segundo clique.

**Saque e depósito são `transferencias`**, não despesa. É o mesmo dinheiro
mudando de bolso, e por isso mora em tabela própria: é o que faz o caixa
fechar e o DRE ignorar corretamente.

**Cheque NÃO é dinheiro na conta.** Recebimento em cheque fica sem
`conta_id`; a conta é gravada no próprio cheque, na **compensação**. Conta
paga COM cheque também fica sem conta — quitou com o papel.

**O DRE é REGIME DE CAIXA, dos dois lados.** Conta a pagar conta quando é
**paga** (`pago_em`); lançamento operacional só conta se **não virou conta**.
O `origem_id` é quem diz "esse fato já tem conta". Não existe mais lista de
"origens espelho" — se um dia voltar, é sinal de que alguém reintroduziu
competência sem querer.

**`prevista` nunca entra no DRE.** É palpite sobre o futuro; entra no fluxo
de caixa e sai do resultado.

**O plano de contas (`src/lib/plano-contas.ts`) separa o QUÊ do QUEM.**
Categoria é o quê; `pessoa_id` é o quem, e só nas marcadas `pedePessoa`.
Contratar alguém **não** cria categoria nova. Categoria `automatico` não
aparece no dropdown — o sistema calcula da origem e lançar na mão dobraria.

**Remuneração tem VIGÊNCIA, não valor.** Nada se edita: mudou, nasce uma
vigência a partir da data em que passou a valer. Vale a de maior
`vigente_desde <= a data`, e a específica da pessoa vence a geral. Comissão é
**proporcional**: `litros ÷ base × valor`.

**Comissão calculada não é comissão paga.** Sob caixa ela só entra no DRE
quando o pagamento é lançado — por isso é categoria lançável, não automática.

⚠️ **`update` em zero linhas volta SUCESSO.** Um script criou o auth user do
Valdecir e tentou `update` num profile que não existia: nada reclamou e a
pessoa ficou sem perfil. Em criação, sempre `insert`.

⚠️ **Os arquivos estão em CRLF** (autocrlf do git no Windows). Script de
refactor que casa texto multilinha precisa normalizar (`.replace(/\r\n/g,"\n")`)
— senão o match falha calado.

## O que NÃO fazer

- **Não usar `supabase.auth.getUser()`** no client — faz chamada de rede, quebra offline. Use `getSession()`.
- **Não usar NetworkFirst** pra navegação do PWA — sinal ruim trava. `StaleWhileRevalidate` é deliberado.
- **Não amarrar RLS de storage em path string** comparison — historicamente bugou. Atual é "authenticated pode upload, SELECT é restrito" (segurança via path controlado pelo código).
- **Não reintroduzir raio_match_m configurável** — Evaner decidiu explicitamente que é 100m fixo pra todos.
- **Não mostrar metros na UI de sugestão do motorista** — decisão explícita, só nome.
- **Não criar features sem direção do Evaner** — ele é opinionado e prefere recortar escopo a adicionar coisas que "talvez sejam úteis".
- **Não adicionar tracking GPS contínuo** — limitação de PWA + LGPD + bateria. Discutido e descartado. Se virar prioridade, alternativa é rastreador veicular físico.
- **Não suportar iOS como target primário** — Android é o principal, iOS funciona mas com atenção extra na instalação (manual via Safari > Compartilhar > Adicionar à Tela de Início).
- **ZERO popup do navegador** — `alert()`, `confirm()` e `prompt()` são proibidos na UI. Admin usa `ModalConfirmar`/`ModalInputTexto` (`src/components/admin/Modais.tsx`); motorista usa confirmação em **duas etapas** na própria tela.
- **Não mostrar GPS pro motorista** — captura é silenciosa em TODO evento. Nem ícone, nem "GPS capturado ✓". Ele pode suspeitar; a UI nunca conta.
- **Não usar input de texto livre pra dinheiro** — sempre `InputDinheiro`. O parser antigo engolia vírgula e "520,12" virou R$ 52.012 em produção.
- **Não criar submenu no motorista** — o "MENU CARGA" existiu e foi cortado: tudo fica na home, um toque. Se a home crescer demais, discutir com o Evaner antes de esconder algo.
- **Não pedir confirmação enquanto o motorista digita** — validação só no clique do botão.
- **Não recriar o papel `dev` nem o `is_teste`** — os dois foram apagados de propósito. Capacidade extra é **coluna**.
- **Não apagar `caches.delete("static-resources")`... quer dizer, não ACRESCENTAR** — ver o comentário grande em `src/app/sw.ts`. O `activate` dispara a cada deploy; apagar o cache de scripts ali quebra o app do motorista offline.
- **Não escrever asserção de total absoluto nos E2E** — eles rodam contra produção. Medir **delta** (o teste de contas a pagar ficou vermelho sozinho quando o Jean lançou uma conta de verdade).

## Ciclo de vida dos dados

| Dado | Servidor | Retenção local (IndexedDB do celular) |
|---|---|---|
| Coleta (registro) | Supabase Postgres, permanente | Apagada 24h após sync 100% |
| Despesa / Abastecimento / Descarga | Supabase Postgres, permanente | Apagados 24h após sync 100% |
| Foto (blob) | Supabase Storage (`fotos-coletas`), permanente | Blob apagado junto com o lançamento (24h) |
| Documento (CNH, CIPP, nota de manutenção) | Supabase Storage (`documentos`), permanente | **Nunca vai pro celular** — bucket é admin-only |
| Evento (log) | Supabase Postgres, permanente | Apagado 7 dias após sync |
| Perfil + carga ativa | Supabase Auth + Postgres | Cache em localStorage (limpo no logout) |

Cleanup automático roda dentro de cada `safeSync` — motorista não precisa fazer nada. Ver `limparColetasSincronizadasAntigas` e `limparGpsPendenteStale` em `src/lib/sync/queue.ts`.

## Estratégia de sync (proteção de bateria)

- Zero polling, zero `setInterval`
- 4 gatilhos discretos: mount, evento `online`, `visibilitychange` visible, após save
- Flag `inFlight` evita syncs simultâneos
- `getSession()` pra checar auth local (sem network)
- Se `navigator.onLine === false` → retorna imediato
- Botão "Enviar agora" manual só aparece se há pendente + online
- Erros categorizados: `auth` / `network` / `storage` / `data` / `unknown` — UI mostra mensagem específica + botão "Sair e entrar de novo" quando auth

## Eventos capturados (log robusto)

25+ tipos em `src/lib/types.ts` (union `EventType`):

- **Lifecycle:** `app_loaded`, `app_focused`, `app_blurred`
- **Rede:** `network_online`, `network_offline` (com `navigator.connection` info)
- **Auth:** `login`, `logout`, `session_expired`
- **Ações:** `nova_coleta_opened`, `coleta_saved_local`, `enviar_agora_clicked`, `foto_capture_started`, `foto_capture_cancelled`, `foto_compress_completed`, `foto_compress_failed`
- **GPS:** `gps_success`, `gps_timeout`, `gps_denied`, `gps_error`, `permission_geolocation_changed`
- **Sync:** `sync_started`, `sync_completed`, `sync_failure`, `sync_skipped_wrong_motorista`
- **JS:** `js_error`, `js_unhandled_rejection` (via window handlers em `EventLogger.tsx`)
- **PWA / admin:** `app_install`, `foto_toggle_changed`

`EventLogger.tsx` no motorista layout registra os listeners globais automaticamente.

## Coisas curiosas que aprendi e podem confundir

- **Compilação de path emoji 💧 quebra em PDFKit** — usar SVG path no lugar
- **Storage `upsert: true` precisa de UPDATE policy** — Supabase faz UPDATE quando objeto existe (migration 0004 fixou)
- **`getSession()` é local-only**, `getUser()` é network — preferir o primeiro no client
- **`navigator.connection` API** funciona em Android Chrome mas não em Safari/iOS — capturar com try/catch (já feito)
- **Dexie filter `c.gps_pendente === true`** trata `undefined` como false — bom pra backward compat
- **Service Worker cacheOnNavigation** no Serwist tem comportamento implícito — checar antes de adicionar runtime caching custom
- **Supabase FREE TIER PAUSA APÓS 7 DIAS SEM ATIVIDADE** — em produção com motoristas usando diariamente nunca pausa, mas em desenvolvimento longo (~30 dias) pausa. Solução: dashboard Supabase → botão "Restore project" (2-5 min, sem perda de dados).
- **Foto RLS "new row violates policy"** — era falta de UPDATE policy + estava amarrando path a string comparison. Migration 0004 relaxou pra "authenticated pode upload".
- **N+1 mata a percepção de velocidade** — o cálculo de saldo fazia ~7 consultas POR MOTORISTA em fila (~42 idas ao banco) e o dashboard chamava isso 2×. Virou a função `saldos_motoristas()` (1 ida). Se o painel voltar a ficar lento, procurar `await` dentro de `for` antes de qualquer outra coisa.
- **Parâmetro na URL quebra navegação offline** — o SW guarda a página pela URL INTEIRA. `/motorista/confirmacao?cid=<único>` gerava uma URL nova a cada coleta, que nunca esteve no cache: sem sinal, o motorista via "não é possível acessar esse site" mesmo com o dado salvo. Telas do motorista devem ter **URL fixa** e receber dados por `sessionStorage`.
- **Mudança nova não aparece no PWA na primeira abertura** — é o `StaleWhileRevalidate` servindo o cache e atualizando por baixo. Abrir e fechar o app 2× antes de concluir que o deploy não chegou.
- **Server Component sem `loading.tsx` parece travado** — o clique não muda nada na tela até o servidor responder. O esqueleto em `/admin/(authed)/loading.tsx` resolve a percepção mesmo sem mudar o tempo real.
- **Relógio local ≠ relógio do banco** — teste que compara `new Date()` do Node com `now()` do Postgres falha sozinho. Em teste, derivar a data do próprio banco.
- **Coluna `date` NÃO tem fuso — converter joga um dia pra trás.** `new Date("2026-09-02")` é meia-noite UTC, e meia-noite UTC em São Paulo são 21h do dia ANTERIOR. O `formatData` convertia tudo, então vencimento, pagamento, data de venda e data de acerto apareciam **um dia antes** no sistema inteiro (achado pelo Evaner em 03/09: salário lançado dia 02 aparecia dia 01). Hoje o `formatData` detecta `aaaa-mm-dd` e formata como TEXTO; timestamp (que é instante de verdade) continua convertido pra Brasília. **Data pura nunca passa por fuso.**
- **Supabase JS quebra no Node 20** ("Node.js 20 detected without native WebSocket") — scripts precisam de `import ws` + `globalThis.WebSocket = ws`.
- **`pg` + session pooler** — parsear a connection string na mão (`new URL`) e passar host/user/password separados, com `ssl: { rejectUnauthorized: false }`.
- **Status de cheque é `em_carteira`, não `carteira`** — errar isso numa query com `.in("status", [...])` não dá erro nenhum: só faz o filtro nunca casar. Alerta que nunca acende parece alerta que não tem o que alertar. Conferir o CHECK da 0017 antes de escrever filtro de status.
- **iOS Safari NÃO tem `beforeinstallprompt`** — motorista iPhone precisa instalar manual via Compartilhar > Adicionar à Tela de Início. Fluxo pós-instalação é idêntico.

## Workflow de deploy

```cmd
cd C:\Users\Evaner\Desktop\JJHS
git add .
git commit -m "descreve a mudança"
git push
# Vercel detecta o push e faz deploy em ~2 min
```

Scripts auxiliares:
- `node scripts/aplicar-migration.mjs <arquivo.sql>` — aplica migration direto no Postgres (usa `DATABASE_URL`, roda em transação)
- `node scripts/e2e-modulo1.mjs` — **rodar após qualquer mexida no Módulo 1**: **55 checks** contra produção (RLS, idempotência, updates atômicos, queries aninhadas do admin e dos alertas, cálculo de saldo). Cria e apaga o próprio motorista descartável.
- `node scripts/limpar-lancamentos-teste.mjs <email> --sim-eu-confirmo` — zera os lançamentos de um motorista. **A trava agora é a flag**, não mais o `is_teste`: sem ela, recusa. Rodar em perfil real APAGA de verdade.
- `node scripts/gerar-icones.mjs` — regenera PNGs a partir de `icone-gota.jfif`
- `node scripts/gerar-tutorial-pdf.mjs` — regenera o manual do Jean (`tutorial-coleta.pdf` fica na raiz, ignorado pelo .gitignore)

## Features especiais no admin

**Bulk delete:** checkbox por coleta na aba Lista + botão "Apagar X coletas" (confirma digitando APAGAR).

**Separar cluster (curadoria):** checkbox por coleta dentro do cluster expandido. Se algumas marcadas → aparece modo separação com 2 formulários lado a lado ("Local 1" / "Local 2"), cada um cria um local canônico separado com centro GPS médio próprio.

**Google Maps clicável:** coordenadas nos clusters/coletas são `<a>` que abre `https://www.google.com/maps?q=lat,lng`.

**Filtros com label explicativo (intervaloLabel):** o `Filtros.tsx` recebe uma prop opcional que mostra "Mostrando X (esta semana de domingo a sábado)". Melhora legibilidade — feature adicionada pelo Evaner direto.

**TopLocais com chevron animado:** botão de expandir cluster é um círculo com ▼ que rotaciona ao abrir — polido pelo Evaner.

## TO-DO / Backlog futuro

Categorizado por valor estimado vs esforço. Ordem decidida pelo Evaner conforme uso real.

### Curto prazo (quando aparecer demanda real)

- [ ] **Curadoria de locais** — Jean fará após 40-90 dias de uso real (decisão consciente pra ter base com nomes reais de campo)
- [ ] **Lançamentos administrativos** — Jean inserir coleta retroativa quando motorista esqueceu / pediu por WhatsApp. Hoje ele pode editar coletas mas não criar novas
- [ ] **Reconhecimento visual da foto** — validar se 800px ficou ok pra outro motorista identificar fachada. Se não, subir pra 1024px (~150KB)

### Médio prazo (semanas/meses)

- [ ] **Rollout efetivo da foto** — semanas 1-3 OFF, semana 4 em 1 motorista, semana 5 em todos
- [ ] **Detector de outliers automático** — alerta se R$/L > 2× média do motorista
- [ ] **Análise de frequência por cliente** — só faz sentido após curadoria ter dados (3+ meses)
- [ ] **Heatmap dia × hora** — produtividade visual
- [ ] **Tendência 12 semanas** — gráfico de linha
- [ ] **Snapshot mensal automático** — backup em CSV no Storage

### Longo prazo / V2

- [ ] **DRE e controle financeiro** — V1 só tem export CSV; DRE estruturado virá depois
- [ ] **Otimização de rota** — usar OSRM (gratuito com OSM) quando volume justificar
- [ ] **Multi-tenant** — se Evaner quiser oferecer pra outras empresas similares
- [ ] **iOS install helper** — detectar iOS user-agent e mostrar tutorial visual passo a passo
- [ ] **Rastreador veicular físico** — alternativa séria ao tracking via PWA, R$50-200 + R$15/mês por veículo

### Dívidas técnicas

- [ ] **Testes automatizados** — spec menciona TDD mas nada implementado
- [ ] **Monitoramento de erros centralizado** — hoje só temos `app_events`. Sentry ou similar quando crescer
- [ ] **Backup PITR do Supabase** — free tier só tem 7 dias. Upgrade Pro ($25/mês) quando dados forem valiosos

### Coisas que considerei mas descartei (com motivo)

- ❌ **PIN de 4 dígitos no lugar de senha** — Evaner escolheu senha tradicional explicitamente
- ❌ **Tracking GPS contínuo do motorista** — PWA não suporta background, bateria pesada
- ❌ **raio_match_m configurável pelo admin** — Evaner simplificou pra 100m fixo
- ❌ **Distância em metros na sugestão pro motorista** — só nome, sem informação técnica
- ❌ **Rastreador via WhatsApp Live Location** — alternativa zero-código mencionada se realmente precisar
- ❌ **Papel `dev` separado de `admin`** — existiu enquanto o Módulo 1 era invisível pro Jean. Depois do flip virou hierarquia sem função: 42 arquivos importando um gate que não gateava mais nada. Decisão do Evaner (19/08/2026): capacidade extra vira **coluna** no cadastro (`ve_log`), nunca papel novo.
- ❌ **Script "conferidor" (auditoria contínua do dinheiro fechado)** — proposto em 22/08/2026 junto com o backup mensal; Evaner descartou ("tem cara de não conseguir diagnosticar na prática"). O que ficou no lugar: régua do dinheiro + e2e-guards + backup CSV mensal.
- ❌ **Motorista de teste (`is_teste`)** — sandbox invisível pro admin. Decisão do Evaner: *"se eu quiser testar um real eu crio um perfil do zero e testo na prática como se fosse um real mesmo, entrando nos relatórios tudo, sabendo que dali 1-2h eu deleto tudo"*. Mais simples e mais fiel ao que o motorista vive.

## Quando o Evaner voltar com bugs

Ordem natural de investigação:

1. **Bug no fluxo do motorista?** → Veja `app_events` em `/admin/eventos`, filtre por ❌ erros. Eventos têm payload rico.
2. **Coletas presas?** → Filtre `sync_failure` e `sync_skipped_wrong_motorista`. Cada um tem `motivo` claro. Se `sync_skipped_wrong_motorista`, coleta foi feita por outro motorista no mesmo celular (edge case testes).
3. **Foto não chegou?** → Filtre `foto_compress_failed` e `sync_failure` com `fase: "upload_foto"`. Payload tem `path`, `tamanho_bytes`, `session_user_id`, `coleta_motorista_id`, `ids_batem` — geralmente diagnostica na hora.
4. **GPS estranho?** → Filtre eventos `gps_*`. `accuracy` no payload mostra qualidade.
5. **App não abre?** → Provavelmente cache do Service Worker OU Supabase pausou (7 dias inativo). Force refresh, ou vai no dashboard Supabase e restaura.
6. **Login falha com "email/senha inválido"?** → Se foi >7 dias sem uso, Supabase pausou. Restaure o projeto.

Os logs foram instrumentados especificamente pra que o motorista NÃO precise descrever o problema — Evaner consegue debugar remotamente pelo painel.

## Como o Evaner trabalha (importante pra próximas sessões)

- **Ele pede alteração aqui, o Claude implementa + faz deploy** (git push automático). Não é ele quem edita código.
- **Ele é opinionado sobre UX e escopo** — se algo tá dando complexidade demais, ele corta.
- **Ele testa cada mudança em produção** com o celular dele antes de dar OK.
- **Ele às vezes ajusta o código direto pra polir UI** (ex: chevron, intervaloLabel) — respeitar essas mudanças, não reverter.
- **Perguntas técnicas ele quer resposta honesta** — se algo não vai funcionar (ex: 1m raio GPS), explicar o motivo e sugerir alternativa realista.
- **Ele quer feedback antes de implementar mudanças questionáveis**, não "sim senhor" cego.
