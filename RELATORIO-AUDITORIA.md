# RELATÓRIO DE AUDITORIA COMPLETA DO SOFTWARE

> **Coleta — JJHS** · Auditoria feita em 19-20/08/2026, contra o código em produção
> e as **131 regras do NEGOCIOv3.md** (conferidas pelo Evaner uma a uma).
>
> **Como foi feita:** 10 varreduras independentes e paralelas — uma por domínio
> (dinheiro do motorista, estoque, vendas/cheques, DRE/contas, caixa/remuneração,
> alertas, frota/documentos, app do motorista, inventário do painel, e uma caça
> transversal a bugs) — com **cada achado de gravidade alta re-verificado
> manualmente no código, linha a linha**, antes de entrar aqui. Nenhum arquivo
> foi alterado. Nada será mudado sem autorização.
>
> **O que a auditoria NÃO cobre:** o estado do banco de produção (não executei
> queries) e o comportamento em execução no celular (Service Worker, sync real).
> Onde isso importa, está dito no achado.

---

# 1. RESPOSTA DIRETA ÀS SUAS 5 PERGUNTAS

### 1.1 "O código está condizendo com o ideal da minha empresa?"

**Na maior parte, sim — e nas partes mais difíceis, impressionantemente sim.**
A fórmula do saldo do motorista no servidor bate **termo a termo** com a R30. A
matemática do estoque (custo médio ponderado móvel) está conforme em todos os
casos difíceis: saldo negativo não derrete o custo, abertura dupla é bloqueada,
doação de R$ 0 só dilui o custo. O ciclo do cheque pós-correção está fiel à
Parte XIII. A receita do DRE por recebimento (item 3) está certa, sem dupla
contagem no fluxo normal. Os 45 endpoints do admin têm gate, os segredos estão
só no servidor, não há N+1, e o offline-first do motorista é sólido.

**Mas há um grupo de divergências que importa** — a maioria concentrada em
costuras entre módulos (o fato nasce num lugar, a conta noutro, e o elo falha).
Estão todas na seção 3, com gravidade, cenário concreto e sugestão de correção.

### 1.2 "O painel vai cruzar dado errado e minar minhas decisões?"

**Hoje, com as tabelas financeiras ainda zeradas, o estrago real é
provavelmente zero. Mas existem minas armadas — e as 6 mais graves miram
exatamente os números que você vai usar pra decidir:**

1. **O DRE vai subestimar despesas sistematicamente** assim que contas a pagar
   de origem forem usadas: conta paga de nota assinada, manutenção a prazo,
   coleta paga pela sede e documento **somem do DRE ao serem pagas** (achado A1).
   O resultado parece melhor do que é — o pior tipo de erro gerencial.
2. **O filtro de período customizado desloca o intervalo em 3h**: o último dia
   escolhido fica **fora** dos KPIs, da lista e do CSV (achado A5).
3. **Cheque repassado**: a despesa entra no DRE, a receita da venda que gerou o
   cheque **nunca** entra — resultado distorcido pra baixo a cada repasse (A6).
4. **Compra direta à vista não passa pelo caixa**: o saldo "Em espécie" do
   painel fica acima da gaveta real, sem nenhum erro na tela (A7).
5. **Acerto de saldo negativo pago na hora descarta a conta**: o dinheiro sai
   da gaveta e o caixa nunca fica sabendo (A8).
6. **O card "Seu dinheiro" do motorista calcula diferente do painel** — coleta
   paga pela sede e nota assinada divergem o número; o motorista desconfia (A11).

Nenhum desses erra por má sorte: erram **sempre, na mesma direção, sem avisar**.
A boa notícia: todos têm correção conhecida e a maioria é pequena.

### 1.3 "O que precisa ser feito como melhoria?"

O plano de ação completo está na **seção 8**, em ondas por prioridade. Resumo:
- **Onda 0 (minutos, retorno imediato):** 5 correções de 1-2 linhas cada.
- **Onda 1 (o DRE confiável):** fechar o buraco do 0×, consertar "Nova conta",
  validar recorrentes, gerar conta da nota assinada do app.
- **Onda 2 (o caixa fecha):** acerto negativo, compra direta, vale e cheque no
  apagar, sincronizar fato↔conta.
- **Onda 3 (antes de ligar `features.carga` nos motoristas reais):** avisos que
  se engolem, foto do painel, e o teste offline que já era dívida conhecida.
- **Ondas 4-5:** robustez de médio prazo e limpeza.

### 1.4 "O que você vê de incongruente?"

Três tipos (seções 4 e 6): **regra diz X, código faz Y** (foto do painel
opcional, alertas de foto/GPS com outra régua, carro incadastrável);
**documentação desatualizada em relação ao código** (R57 do NEGOCIOv3, cleanup
de 24h no CLAUDE.md, curadoria dizendo 80m); e **ambiguidade de regra que só
você pode resolver** (9 decisões listadas na seção 6 — não mexi em nenhuma).

### 1.5 "Outros pontos?"

- **A dívida mais perigosa não é bug, é teste:** nada do fluxo offline roda em
  teste automatizado. Já estava anotada no ESTADO.md; esta auditoria confirma
  que é a prioridade certa antes do rollout do Módulo 1.
- **Teto silencioso de 1.000 linhas do Supabase** (seção 5): meia dúzia de
  consultas sem limite que hoje funcionam e daqui a meses passam a truncar
  dados **sem nenhum erro** — inclusive a anti-dobra do DRE.
- **As senhas de produção estão escritas no CLAUDE.md versionado no GitHub.**
  Repo privado, decisão sua — mas fica registrado (seção 7).
- O **placar dos 7 itens da Parte XII** foi confirmado: 5 feitos e corretos no
  caminho feliz (1, 3, 5, 6, 7 — com as ressalvas da seção 3), 2 pendentes
  (2 e 4 — estado exato na seção 5).

---

# 2. O QUE ESTÁ BEM (conferido, não presumido)

Pra dar o peso certo às críticas, o que foi testado **tentando quebrar** e resistiu:

| Área | O que foi verificado |
|---|---|
| **Saldo do motorista (servidor)** | `saldos_motoristas()` bate termo a termo com a R30: carry, aceitos pós-corte, coletas exceto sede, despesas, abastecimentos exceto nota assinada. Coleta retroativa antes do corte cai no ciclo fechado e a tela avisa. |
| **Estoque** | Dois óleos separados; densidade 0,9 na direção certa nas 7 ocorrências; custo = Σ valor_pago da carga; inventário preserva custo e registra perda; abertura obrigatória e não-duplicável; saldo negativo não gera custo inventado; venda com mistura fechada por CHECK no banco. |
| **Cheque (item 5 da Parte XII)** | Botão "Repassar" solto removido de tela e endpoint, sem código morto; "paguei com cheque" nasce pago, sem conta, amarrado por `cheque_id`; devolver reverte a conta e avisa; devolver 2× dá 409; compensado é terminal; 1 cheque = 1 recebimento (UNIQUE). |
| **DRE — receita (item 3)** | Recebimentos não-cheque + cheques compensados pela data de compensação; recebimento em cheque excluído (não dobra); devolvido não conta; sem nenhum caminho de dupla contagem **no fluxo normal**. |
| **Vale (item 7)** | UI mostra vales pendentes no Salário; quitação atômica (filtra pendente — dois pagamentos não descontam o mesmo). |
| **Alertas (item 6)** | "Cheque bom pra semana" e "devolvido sem resolver" removidos de verdade (zero resquício); dinheiro parado em 15 dias; 12 dos 14 alertas com limiar exato; texto didático em todos; sem N+1 (~15 queries por abertura). |
| **Segurança** | 45/45 endpoints admin com `exigirAdmin()` (role + ativo); service_role e OPENAI_API_KEY só no servidor; `.env` fora do git; tabelas financeiras admin-only na RLS; log imutável e gated por `ve_log`; strings de status 100% batendo com os CHECKs (o bug do `'carteira'` não voltou). |
| **Offline-first** | 4 lançamentos offline com `client_id` idempotente (23505 = sucesso); 4 gatilhos de sync sem polling; URL fixa + sessionStorage; logout bloqueado com pendências; troca de motorista no mesmo celular não perde dado; sessão expirada não perde dado. |
| **Antiburros** | Descarga (peso < tara bloqueia; ±30% avisa; sem coleta avisa) e km (duro/aviso/salto 1.500) conformes; validação só no clique; confirmação em duas etapas. |
| **Contas a pagar** | Parcelamento sem perder centavo (última parcela absorve a sobra); recorrentes idempotentes (unique + upsert); prevista fora do DRE e do total de dívida; pagar com cheque com guarda de corrida e rollback. |
| **Infra** | CI real (typecheck + build + 2 E2E com 85 checks contra o banco); migrations 0031/0032 existem e estão corretas. |

---

# 3. ACHADOS DE GRAVIDADE ALTA
*(os que minam decisão ou fazem dinheiro sumir — todos re-verificados por mim no código)*

### A1. O DRE engole contas de origem quando são pagas (conta 0 vezes) — **o achado mais importante da auditoria**

**Onde:** [dre.ts:226-236](src/lib/admin/dre.ts:226) + as 4 criações de conta.
**O quê:** a montagem do DRE tem duas fontes: linhas `automatico` (calculadas dos
fatos) e linhas `lancamento` (contas pagas, por categoria). A anti-dobra (R92)
funciona na ida — o fato com `origem_id` é excluído do automático. Mas as contas
que os fluxos de origem criam usam **categoria automática ou inexistente no
plano**, e o DRE só soma contas pagas de categorias lançáveis. Resultado: o fato
sai do automático E a conta paga é descartada — **o real não conta em lugar nenhum**:

| Fluxo | Categoria gravada | Onde |
|---|---|---|
| Abastecimento "assinou a nota" (painel) | `combustivel` (automática) | [lancamentos/route.ts:101](src/app/api/admin/lancamentos/route.ts:101) |
| Manutenção a prazo | `manutencao` (automática) | [manutencoes/route.ts:107](src/app/api/admin/manutencoes/route.ts:107) |
| Coleta paga pela sede | `oleo` (**não existe** no plano) | [coletas/[id]/route.ts:110](src/app/api/admin/coletas/[id]/route.ts:110) |
| Documento com valor (IPVA, seguro) | `documento` (**não existe** no plano) | [documentos/route.ts:99](src/app/api/admin/documentos/route.ts:99) |

**Cenário concreto:** você lança R$ 800 de diesel "assinou a nota" hoje e paga o
posto dia 5. O DRE de hoje não mostra (correto). O DRE do dia 5 **também não**.
A linha Combustível fica R$ 800 menor pra sempre — e você decide achando que
gasta menos diesel do que gasta. Agravante: a tela de **Lançamentos mostra** a
conta paga no total dela — Lançamentos e DRE do mesmo período exibem números
diferentes, sem ninguém saber qual acreditar.
**Sugestão:** (a) as linhas automáticas passam a somar **também** as contas
pagas da sua categoria (e mapear `oleo`→`oleo_sede`, `documento`→pela função
`categoriaDeDocumento()` que **já existe** em [plano-contas.ts:180](src/lib/plano-contas.ts:180)
e ninguém chama); (b) acrescentar no DRE uma linha "Não classificado" somando
qualquer conta paga cuja categoria não caiu em linha nenhuma — buraco visível é
buraco que se conserta. **Tamanho: médio.**

### A2. "Nova conta" em /admin/contas está quebrada — toda criação manual falha

**Onde:** [ContasPainel.tsx:21-29](src/components/admin/ContasPainel.tsx:21) × [contas/route.ts:33-39](src/app/api/admin/contas/route.ts:33).
**O quê:** o formulário oferece a lista velha de categorias (combustivel,
manutencao, oleo, imposto, fixa, folha, outra) e a API valida contra o plano
novo exigindo categoria lançável. **Nenhuma das 7 opções passa**: duas são
automáticas, cinco não existem. Toda tentativa devolve "categoria inválida pra
uma conta a pagar". O comentário no endpoint diz que a lista velha "foi
substituída" — no servidor sim, na tela não.
**Sugestão:** o dropdown passa a usar `CATEGORIAS_LANCAVEIS` (o mesmo da tela
de Lançamentos). **Tamanho: pequeno.**

### A3. Recorrentes gravam categoria órfã — as contas geradas ficam invisíveis no DRE

**Onde:** [recorrentes/route.ts:37](src/app/api/admin/recorrentes/route.ts:37) (grava `body.categoria || "fixa"` sem validar) + a mesma lista velha na UI.
**O quê:** "fixa" não é categoria do plano; as contas geradas herdam a categoria
e, quando pagas, caem no buraco do A1. Aluguel, energia e contador — justamente
os gastos mais previsíveis — sumindo do resultado.
**Sugestão:** validar contra o plano no endpoint (como contas/route.ts já faz) e
trocar a lista na UI. **Tamanho: pequeno.**

### A4. "ASSINEI A NOTA" lançado pelo motorista NÃO gera a conta a pagar

**Onde:** [sync/queue.ts:314-345](src/lib/sync/queue.ts:314) (o sync insere o abastecimento e nada mais); só o fluxo do painel cria a conta ([lancamentos/route.ts:96-115](src/app/api/admin/lancamentos/route.ts:96)); não há trigger no banco.
**O quê:** o diesel assinado em campo não desconta do saldo do motorista
(correto) — mas **a dívida com o posto não existe em lugar nenhum** e o gasto
nunca entra no DRE (o DRE descarta abastecimento não-pago-na-hora contando que
a conta exista). Hoje é inofensivo porque nenhuma carga rodou; **é a bomba
armada do rollout do Módulo 1.**
**Sugestão:** gerar a conta no pós-sync (o gancho `posInsert` já existe em
queue.ts, hoje nulo) ou trigger `after insert on abastecimentos where pago_na_hora = false`
— a segunda opção cobre qualquer caminho de inserção. **Tamanho: pequeno-médio.**

### A5. Filtro de período customizado desloca o intervalo — o último dia escolhido fica FORA

**Onde:** [queries.ts:40](src/lib/admin/queries.ts:40) — `new Date("2026-08-31")` é meia-noite **UTC** = 21:00 BR **do dia 30**.
**O quê:** você escolhe 01/08 a 31/08 e o filtro real vira "31/07 21:00 → 30/08
21:00". Todas as coletas do dia 31 somem dos KPIs, da lista, do mapa e do CSV
exportado; 3 horas do dia 31/07 entram indevidamente. Afeta o dashboard e as
telas de Abastecimentos/Despesas/Compra direta (mesmo resolvedor). Os períodos
fixos (Hoje/Semana/Mês) estão corretos.
**Sugestão:** parsear com fuso explícito: `new Date(inicio + "T00:00:00-03:00")`
e `new Date(fim + "T23:59:59.999-03:00")` — o padrão certo já existe no
[dre.ts:82-86](src/lib/admin/dre.ts:82). **Tamanho: 2 linhas.**

### A6. Cheque repassado: o DRE conta a despesa mas nunca a receita

**Onde:** [dre.ts:110-121](src/lib/admin/dre.ts:110) (receita = recebimentos não-cheque + cheques **compensados**).
**O quê:** cheque de R$ 3.000 recebido do comprador e repassado ao posto: a
despesa conta no dia do repasse (como a Parte XIII manda), mas aquele cheque
nunca compensa "do seu lado" — a venda **jamais vira receita**. DRE do mês:
despesa 3.000, receita 0, resultado −3.000, quando economicamente foi ~0. Com
"repassar é frequente" (R66), a distorção é sistemática e sempre pra baixo.
**É decisão de negócio** (o código segue a regra escrita — a regra é que tem o
furo). **Sugestão que recomendo:** a receita soma também cheques `repassado`
pela data do repasse — simétrico com a decisão já tomada pro lado do gasto; o
devolvido sai sozinho porque o status muda. **Tamanho: pequeno.** *(Decisão D1,
seção 6.)*

### A7. Compra direta paga à vista é invisível pro caixa

**Onde:** [compras/route.ts:55-77](src/app/api/admin/compras/route.ts:55) — o insert não tem `conta_id` e nenhum código cria conta a pagar de compra direta (o CHECK da 0021 até prevê `origem_tipo`, nada usa).
**O quê:** você paga R$ 5.000 de compra direta em espécie → o DRE vê o gasto
(`oleo_sede`), mas `saldo_contas()` nunca vê a saída → o card "Em espécie"
fica R$ 5.000 acima da gaveta real, silenciosamente. **Ressalva honesta:** a
lista literal da R88 também não inclui compra direta — pode ser omissão da
regra, não só do código. *(Decisão D2, seção 6.)*
**Sugestão:** campo "De qual conta saiu" na compra à vista (a matemática do
`saldo_contas()` ganha o braço) — ou compra a prazo gerando conta a pagar.
**Tamanho: médio.**

### A8. Acerto com saldo negativo "pagar agora" descarta a conta escolhida

**Onde:** [acertos/route.ts:21-36](src/app/api/admin/acertos/route.ts:21) — só exige e grava `conta_id` quando `valor_devolvido > 0`.
**O quê:** o motorista gastou R$ 800 do bolso; você acerta pagando na hora. O
modal pergunta "De qual conta você vai pagar" e envia — o servidor **joga
fora**. O dinheiro sai da conta na vida real e o caixa nunca fica sabendo.
"Dinheiro não aparece nem some" (R83) violado exatamente no caso raro. Detalhe:
a aritmética do `saldo_contas()` já funcionaria — um devolvido negativo com
conta abateria certo.
**Sugestão:** exigir e gravar `conta_id` quando `valor_devolvido != 0`.
**Tamanho: 2 linhas.**

### A9. Apagar um pagamento de salário deixa o vale "quitado" órfão — o desconto evapora

**Onde:** [contas/[id]/route.ts:149-160](src/app/api/admin/contas/[id]/route.ts:149) (DELETE cru) + FK da 0032 `on delete set null` (limpa só `vale_quitado_por`; **`vale_quitado_em` fica preenchido**).
**O quê:** você lança o salário, marca o vale de R$ 500, depois percebe erro e
apaga o lançamento. O vale some da lista de pendentes **pra sempre** — os R$ 500
que deviam ser descontados evaporam, sem rastro de qual pagamento teria quitado.
O modal de apagar nem menciona vales.
**Sugestão:** no DELETE, antes de apagar: `update acertos set vale_quitado_em = null,
vale_quitado_por = null where vale_quitado_por = :id` (ou trigger); e avisar no
modal quando o lançamento tem vales amarrados. **Tamanho: pequeno.**

### A10. Km atual dos caminhões ignora os abastecimentos — coluna com nome errado e erro engolido

**Onde:** [frota.ts:56-59](src/lib/admin/frota.ts:56) — consulta `abastecimentos.km`; a coluna real é **`km_atual`** ([0007_cargas.sql:85](supabase/migrations/0007_cargas.sql)). O erro do banco (42703) é descartado porque só `data` é lido.
**O quê:** o braço dos abastecimentos está morto. Ficha do caminhão e alerta de
troca de óleo usam só o fim das cargas. Cenário: caminhão encerrou a última
carga com 250.000 km, abasteceu 3× na carga atual chegando a 251.400, troca
marcada pra 251.000 — a ficha mostra 250.000 e **o alerta não acende**, embora
o texto do alerta prometa "o km vem do fim das cargas e dos abastecimentos". É
o mesmo padrão do bug histórico do `'carteira'`: consulta que nunca casa parece
sistema sem nada a avisar.
**Sugestão:** `select("caminhao_id, km_atual")` + `.not("km_atual","is",null)`
+ passar a olhar o `error`. **Tamanho: 3 linhas.**

### A11. O card "Seu dinheiro" do motorista calcula diferente do painel

**Onde:** [CardSaldo.tsx:50-64](src/components/motorista/CardSaldo.tsx:50) — refaz a conta no celular **sem** os dois filtros da fórmula oficial: soma coletas sem excluir `pago_pela_sede` e abastecimentos sem exigir `pago_na_hora`.
**O quê:** você marca a coleta de R$ 6.000 como paga pela sede (o caso real do
Lucimar que motivou a migration 0021) → o painel mostra o saldo certo; o
celular do motorista mostra R$ 6.000 **a menos**. Toda nota assinada reabre a
divergência. Motorista que desconfia do número para de usar o aceite.
**Sugestão:** replicar os dois filtros nas queries do card — ou, melhor, expor
a própria `saldos_motoristas()` pro motorista via RPC (a RLS já restringe ao
próprio). **Tamanho: 2 linhas (paliativo) / pequeno (RPC).**

### A12. Documento renovado nunca mais alerta depois de um "OK, VI" — e "renovar" não tem botão

**Onde:** chave do alerta `documento:${id}` em [alertas-frota.ts:77](src/lib/admin/alertas-frota.ts:77); o PATCH de renovação existe e **nenhuma tela o chama** ([documentos/[id]/route.ts](src/app/api/admin/documentos/[id]/route.ts) — grep: só POST e DELETE são usados).
**O quê:** (a) a CNH vence, você dispensa o alerta, o vencimento é atualizado —
em 2031 o alerta **não acende nunca mais** (a chave já está dispensada pra
sempre; o alerta de troca de óleo resolveu isso certo incluindo o alvo na
chave). (b) O texto do alerta ensina "é só cadastrar a data nova na ficha" —
fluxo que não existe: na ficha só dá pra criar documento novo (que não apaga o
alerta velho) ou apagar e recadastrar (perde histórico).
**Sugestão:** chave `documento:${id}:${vencimento}` + botão "Renovar" na
ListaDocumentos chamando o PATCH que já está pronto (ele até sincroniza a conta
prevista). **Tamanho: pequeno.**

---

# 4. ACHADOS DE GRAVIDADE MÉDIA

**M1. Vencimento digitado na coleta paga pela sede é sempre descartado (regex sem escape).**
[coletas/[id]/route.ts:100](src/app/api/admin/coletas/[id]/route.ts:100): `/^d{4}-d{2}-d{2}$/` sem as barras (`\d`) — só casaria com a string "dddd-dd-dd". Qualquer data digitada é ignorada e a conta nasce no dia 1 do mês seguinte — e vencimento de conta `a_pagar` não é editável depois. Os outros 12 regexes do projeto estão certos. **Correção: 1 caractere ×3.**

**M2. Apagar lançamento pago com cheque deixa o cheque "repassado" pra sempre.**
[contas/[id]/route.ts:149-160](src/app/api/admin/contas/[id]/route.ts:149) + [LancamentosPainel.tsx:130-144](src/components/admin/LancamentosPainel.tsx:130). A despesa some, o cheque não volta à carteira, não pode pagar outra conta, e futura devolução não acha o que reverter. **Sugestão:** no DELETE, cheque `repassado` amarrado volta a `em_carteira` (o rollback do PATCH já faz isso — copiar).

**M3. Editar/apagar o fato não sincroniza a conta a pagar de origem.**
Corrigir abastecimento assinado de R$ 800→680 deixa a dívida em R$ 800 ([abastecimentos/[id]/route.ts](src/app/api/admin/abastecimentos/[id]/route.ts)); apagá-lo deixa conta órfã que será paga e entrará no DRE sem fato. **Desmarcar** "paga pela sede" não cancela a conta — a coleta volta a descontar do motorista E a dívida continua: **o mesmo valor sai duas vezes** ([coletas/[id]/route.ts:66-92](src/app/api/admin/coletas/[id]/route.ts:66)). **Sugestão:** PATCH/DELETE do fato atualiza/cancela a conta por `origem_tipo`+`origem_id`.

**M4. Devolução de cheque repassado: reversão não-atômica com erro engolido.**
[cheques/[id]/route.ts:100-117](src/app/api/admin/cheques/[id]/route.ts:100): duas escritas sem transação; o `error` do update da conta é descartado. Se a segunda falha: cheque devolvido + conta paga + resposta "ok" — e sem retry (devolver de novo dá 409). **Sugestão mínima:** checar o erro e avisar; ideal: função Postgres transacional.

**M5. Apagar motorista: destruição parcial com erro engolido.**
[motoristas/[id]/route.ts:187-197](src/app/api/admin/motoristas/[id]/route.ts:187): apaga coletas + fotos + eventos, e o delete do profile falha calado se ele tem cargas/despesas/adiantamentos (FKs sem cascade) — as coletas **já foram destruídas** numa operação que não completou. Mesmo padrão do bug histórico do Valdecir. **Sugestão:** checar dependências antes (como contas-financeiras faz) ou abortar no primeiro erro.

**M6. POSTs de dinheiro sem idempotência — duas abas duplicam.**
Acertos, adiantamentos, recebimentos, vendas, lançamentos e transferências não têm client_id nem trava. Pior caso: **dois acertos quase simultâneos** pro mesmo motorista — o devolvido entra 2× no caixa e o carry fica errado. Também: lançamento do motorista que sincroniza **entre abrir o modal do acerto e confirmar** cai no ciclo fechado sem entrar na divisão — some de todo mundo. **Sugestão:** o POST do acerto recebe `saldo_esperado` e recusa com 409 se `saldos_motoristas()` divergir.

**M7. RLS de adiantamentos é por linha, não por coluna.**
[0008:56-59](supabase/migrations/0008_adiantamentos.sql): a policy de update do motorista permite alterar **qualquer coluna** do próprio adiantamento — um motorista tecnicamente hábil, com a anon key (pública) e o próprio login, poderia mudar `valor` ou `status` e reduzir o que deve. O app só mexe em aceite/GPS/contador. **Sugestão:** trigger BEFORE UPDATE bloqueando mudança de valor/motorista/data pra não-admin, ou aceite via função `security definer`.

**M8. Editar compra direta descarta o certificado em silêncio.**
O form envia `certificado_tipo`/`litros_certificado`; o PATCH ([compras/[id]/route.ts:15-53](src/app/api/admin/compras/[id]/route.ts:15)) não os aceita. A tela diz salvo, o banco não muda — e certificado é rastro quase-legal. Editar quantidade também não recalcula os litros do certificado integral. **Sugestão:** aceitar os campos no PATCH + recalcular.

**M9. Inventário com data retroativa grava perda errada na tabela de auditoria.**
[estoque/ajuste/route.ts:43-55](src/app/api/admin/estoque/ajuste/route.ts:43) congela o `saldo_antes` **de agora**, mas a UI deixa datar no passado — o saldo final fica certo (a view rebaseia), mas `diferenca_kg`/`perda_valor` comparam a contagem de domingo com o saldo de terça. **Sugestão:** travar data = hoje (coerente com a decisão de não pedir hora) ou computar o saldo na data escolhida.

**M10. Compra × venda no mesmo dia: ordem não-determinística no custo médio.**
As duas entram com `momento` = meia-noite do dia ([0024](supabase/migrations/0024_fim_do_is_teste.sql)); o `order by` empata e a ordem vira detalhe do plano de execução — o custo médio pode mudar entre duas consultas. E venda/compra do dia processam **antes** da descarga do mesmo dia (que usa hora real). Contido pelos inventários periódicos. **Sugestão:** desempate estável + entradas antes de saídas dentro do dia.

**M11. Confirmar um aviso engole os outros (descarga e abastecimento).**
[descarregar/page.tsx:128](src/app/motorista/descarregar/page.tsx:128), [abastecimento/page.tsx:123](src/app/motorista/abastecimento/page.tsx:123): o segundo toque pula **todos** os avisos, não só o confirmado. Cenário: salto de km (aviso 1) + peso 45% fora (aviso 2) — o motorista só vê o do km; a divergência de peso nunca aparece. **Sugestão:** re-rodar a cadeia marcando quais já foram confirmados.

**M12. R14 divergente: a foto do painel ao iniciar carga é opcional — e o upload falha em silêncio.**
[iniciar-carga/page.tsx:352](src/app/motorista/iniciar-carga/page.tsx:352) só exige caminhão e km; a regra diz "exige... foto do painel". E se o upload da foto falha, a carga nasce sem foto sem ninguém saber (linha 150). *(Decisão D6.)*

**M13. Teto silencioso de 1.000 linhas do Supabase — inclusive na anti-dobra do DRE.**
Consultas sem `.limit()`/paginação que hoje passam e vão truncar caladas: a lista de `origem_id` do DRE ([dre.ts:145-148](src/lib/admin/dre.ts:145) — **acima de 1.000 contas de origem, fatos voltam a contar 2×**), coletas de 90 dias dos alertas (~810 já no ritmo atual), coletas do período do dashboard, `alertas_vistos` (chaves diárias acumulam — dispensados voltam a aparecer), e os abastecimentos do km atual. **Sugestão:** no DRE, buscar só os origem_id dos fatos do período; nos demais, limite consciente + ordenação, e limpeza das chaves diárias antigas.

**M14. Carro é incadastrável pela interface (R71 divergente).**
O banco está pronto (0018); [FormCaminhao.tsx](src/components/admin/FormCaminhao.tsx) não tem campo tipo e o POST exige tara/capacidade sempre. Carro só nasce por SQL — e editá-lo pelo painel quebra (tara null vira NaN). O gasto de carro que a regra quer rastrear não tem porta de entrada. **Sugestão:** seletor caminhão/carro no form, escondendo tara/capacidade.

**M15. Apagar caminhão/motorista deixa conta prevista órfã e arquivo órfão.**
Os documentos somem por cascade, mas a conta prevista do IPVA (R$ 4.000) fica pendurada no fluxo de caixa futuro apontando pra um documento que não existe, e o PDF fica no bucket pra sempre. **Sugestão:** replicar no delete do dono a limpeza que o delete de documento já faz.

**M16. Alertas de foto e GPS não implementam a regra (R121/R122).**
Foto: dispara com **1 coleta sem foto em 48h** (regra: 3 na semana). GPS: dispara com **4 em 7 dias corridos** (regra: 3 na semana domingo-sábado). Ou o código muda, ou o NEGOCIOv3 registra o comportamento real. *(Decisão D7.)*

**M17. Doação de R$ 0 dispara alerta enganoso e pede confirmação extra.**
No painel: "Coleta com número estranho" diz "provavelmente faltou dígito" e sugere valor provável ([alertas.ts:461-494](src/lib/admin/alertas.ts:461)) — pra uma coleta certa. No app: R$ 0 sempre exige o segundo toque do aviso de preço. E o admin não consegue lançar retroativa de R$ 0 nem corrigir uma coleta pra 0 ([coletas/route.ts:42](src/app/api/admin/coletas/route.ts:42) exige > 0; o PATCH ignora zero em silêncio) — a 0031 liberou só o caminho do motorista. **Sugestão:** tratar `valor === 0` como caso legítimo nos três lugares. *(Decisão D4.)*

**M18. Manutenção: retry duplica, e editar não propaga pra conta.**
POST não-idempotente (manutenção grava, conta falha, usuário reenvia → duas manutenções); PATCH altera valor sem tocar a conta gerada. Latente (sem UI de edição hoje).

**M19. Duas vigências GERAIS na mesma data entram (NULLs distintos no unique).**
[0030:45](supabase/migrations/0030_vigencias_remuneracao.sql): `unique (pessoa_id, tipo, vigente_desde)` não pega duplicata com `pessoa_id NULL` — e o desempate no código é arbitrário. **Sugestão:** índice único parcial `where pessoa_id is null`.

**M20. `alert()` proibido sobreviveu em 11 lugares.**
Motorista: [FotoPicker.tsx:48](src/components/motorista/FotoPicker.tsx:48) (foto que falha — candidato clássico: HEIC de iPhone) e [CancelarCarga.tsx:77](src/components/motorista/CancelarCarga.tsx:77). Admin: **9 ocorrências** em [ClusterCard.tsx](src/components/admin/ClusterCard.tsx) (curadoria). **Sugestão:** trocar por erro inline, como o resto do app.

**M21. Parcelamento com vencimento dia 29-31 pula fevereiro.**
[contas/route.ts:52-61](src/app/api/admin/contas/route.ts:52): `setMonth` com overflow — 31/01 + 1 mês = 3 de março (nenhuma parcela em fevereiro, duas em março). O gerador de recorrentes já faz o clamp certo; copiar dele.

**M22. Lote de cheques sem idempotência + OCR pode estourar o limite de payload.**
Timeout de rede após gravar + re-clique = maço em dobro; 10 fotos em base64 podem passar de 4,5MB (limite da Vercel) com erro genérico. Fora isso o OCR está bem defendido (501 didático sem chave, nada lança sem tique humano).

---

# 5. OS DOIS PENDENTES CONHECIDOS (Parte XII, itens 2 e 4) — estado exato

### Item 2 — Comissão pela descarga (R108)
**Confirmado pendente:** `calcularComissao()` em [remuneracao.ts:90-147](src/lib/admin/remuneracao.ts:90) soma `coletas.litros` pela data da coleta. Notas pra implementação (levantadas agora):
- `descargas` **não tem** `motorista_id` — vem de `cargas.motorista_id` (join).
- `descargas.litros_estimados` é **anulável** — decidir fallback (`peso_liquido_kg ÷ 0,9`).
- A vigência deve resolver pelo **dia BR de `descargas.criado_em`**.
- Filtrar carga `encerrada` resolve os dois casos de borda (cancelada fora, aberta pendente).
- **Único consumidor é a tela de Remuneração** — o DRE não usa o cálculo (comissão lá é lançável), então a mudança não toca o DRE.

### Item 4 — Painel de caixa com o patrimônio (R87)
**Confirmado pendente:** a tela mostra só contas + mão dos motoristas + total. Falta:
1. **Valor em estoque** — a query já existe (`buscarEstoque()` devolve kg e litros); falta só × preço de referência.
2. **Óleo nos caminhões** — query nova: Σ `coletas.litros` das cargas `ativa` × preço de referência.
3. **Cheques em aberto** — Σ `cheques.valor` com status `em_carteira` + `depositado` (⚠️ `em_carteira`, com o `em_`); devolvido fica FORA (senão conta 2× com a dívida do comprador).
4. **Preço de referência** — **não existe nada no código** (grep: zero). Precisa de armazenamento novo (tabela de configuração), em R$/litro, editável, um só pros dois óleos.
5. **TOTAL** das seis linhas.

---

# 6. DECISÕES QUE SÓ VOCÊ PODE TOMAR
*(não são bugs — ou a regra é ambígua, ou regra e código divergem de propósito. Não mexi em nada.)*

| # | Decisão | Minha recomendação |
|---|---|---|
| **D1** | Cheque **repassado** entra na receita do DRE (pela data do repasse)? Hoje a despesa entra e a receita nunca (A6). | **Sim** — simétrico com a regra já tomada pro gasto; senão o resultado fica sempre subestimado. |
| **D2** | Compra direta à vista ganha **"de qual conta saiu"**? A R88 hoje não a lista (A7). | **Sim** — sem isso o caixa não fecha com a gaveta. |
| **D3** | **R112**: hoje uma vigência **geral mais nova** vence uma **específica mais antiga** (o Luis com comissão própria cai na regra geral nova, silenciosamente). A regra diz "a específica vence" sem condição de data. | Decidir e registrar. Se a específica deve sobreviver, a resolução muda (primeiro pessoa, depois data). |
| **D4** | Coleta de R$ 0 (doação): pula o aviso de preço no app e o alerta no painel? E o admin pode lançar/corrigir pra 0? | Zero é legítimo desde a R2 — eu trataria como caso normal nos três lugares (M17). |
| **D5** | O "OK, VI" de um admin esconde o alerta **do outro também** (dispensa é global). | Provavelmente ok pra 2 admins — só registrar que é assim. |
| **D6** | **R14**: exigir a foto do painel no código, ou relaxar a regra? (M12) | Exigir — é o comprovante do km inicial, e custa um `disabled` a mais. |
| **D7** | **R121/R122** (foto/GPS): ajustar o código pra "3 na semana" ou reescrever a regra pro comportamento atual? (M16) | O comportamento atual (foto em 48h) até avisa mais rápido; eu atualizaria a REGRA e manteria o código — mas é seu critério. |
| **D8** | **R57** está desatualizada: o "+ gasto" da tela de Vendas **usa** `venda_id` (foi pedido seu, pelo comentário no código). Atualizar o NEGOCIOv3 ou reverter a feature? | Atualizar o documento. |
| **D9** | **Dia do corte** da conta financeira: movimento **no dia** do corte soma (`>=`). Se o saldo informado for "fim do dia", dobra. | Documentar na tela: "informe o saldo do **início** do dia" — 1 linha de texto. |
| **D10** | **Senhas reais de produção estão no CLAUDE.md versionado** no GitHub (repo privado). | Eu removeria do arquivo e trocaria as senhas (elas também vivem em `senha_visivel`, rotacionar é barato). Decisão sua. |

---

# 7. ACHADOS BAIXOS E COSMÉTICOS (a lista completa, curta)

**Baixos (funcionais, dano limitado):**
1. Documento/cheque "vence" 3h mais cedo à noite — dia calculado em UTC ([documentos.ts:76](src/lib/documentos.ts:76), [alertas-frota.ts:173](src/lib/admin/alertas-frota.ts:173)); o `diaBr()` certo já existe em alertas.ts.
2. Corte do `saldo_contas()`: o braço dos adiantamentos compara sem converter pra BR (janela de 3h na véspera do corte) — os outros braços convertem.
3. Comparativo de compras diretas inclui +1 dia no período anterior (`toISOString().slice` em fim 23:59 BR).
4. Chave do alerta de estoque negativo é só `fino|grosso` — dispensou uma vez, nunca mais alerta (nem anos depois, por causa diferente).
5. "Dinheiro parado" dispara com R$ 3.000,00 exatos (`>=` onde a regra diz `>`).
6. Aviso de documento não aceita 0 dias pela UI (`|| 30` transforma 0 em 30).
7. Vales quitados sem validar categoria/pessoa no servidor; quitação parcial responde ok silencioso.
8. `pular_contador` incrementa em read-then-write (perde pulo concorrente — só telemetria).
9. `aceito_em`/`criado_em` vêm do relógio do celular; o corte do acerto vem do servidor (desvio de relógio grande pode esconder lançamento do saldo).
10. Rollback do cheque no 409 de pagar conta não guarda o status (janela mínima de sobrescrever um `devolvido`).
11. Fotos órfãs no Storage (upload ok + insert falho; retry do iniciar-carga com `Date.now()` no path).
12. km/L do mês com janelas desalinhadas (km pela carga iniciada, diesel pelo abastecimento — carga que cruza o mês distorce os dois).
13. Nota/foto da manutenção sobe pro bucket e **nenhuma tela mostra**; apagar a manutenção não remove o arquivo.
14. Ajuste de estoque não tem editar/apagar — abertura com custo errado (um zero a mais no InputDinheiro) é permanente, só SQL conserta.
15. Chave React duplicada na tabela de movimentos (venda mista = 2 linhas com a mesma key).
16. Em Lançamentos, pagar com cheque de valor diferente não avisa a diferença (a tela de Contas avisa).
17. `sync_skipped_wrong_motorista` mostra "Sua sessão expirou" (mensagem mente, a ação sugerida por acaso resolve).
18. `jaTemConta` do DRE inclui contas **canceladas** — fato fica oculto pra sempre (defensável sob caixa, mas cancelamento por engano esconde o gasto).
19. Tooltip do "auto" de Óleo pago pela sede promete "compra direta e coletas da sede", mas o número só tem compra direta.
20. Um check do e2e-modulo2 atesta um isolamento (`is_teste`) que não existe mais — passa por vácuo.
21. Iniciar carga não tem antiburro de salto de km — é a única ação online (o servidor conhece o km real) e a única sem checagem.
22. `min={1}`/`required` nativos no km do iniciar-carga podem disparar balão do navegador.
23. Salário pago com cheque que volta não desmarca os vales quitados (cenário raro).
24. RLS: motorista pode inserir coleta apontando pra carga de **outro** motorista (exige má-fé + chamada direta; polui o custo daquela carga).
25. Deletar caminhão com manutenção e sem carga estoura FK crua (23503) na cara do usuário.
26. Devolver cheque não limpa `repassado_para`/`repassado_em` (cosmético, a tela não confunde).

**Cosméticos / documentação:**
27. Textos de Cargas/Abastecimentos/Despesas ainda mencionam "motoristas de teste 🧪" (removidos na 0024).
28. Typo em Adiantamentos: "Só **count** no saldo quando aceito."
29. Curadoria diz "80m" na tela; o CLAUDE.md fala 20m (o que o Jean lê é 80m — alinhar doc ou tela).
30. Papel `dev` sobrevive em [types.ts:55](src/lib/types.ts:55) e em 2 checagens mortas no motorista.
31. `trocasDeOleoVencidas()` é código morto (a lógica foi reimplementada inline nos alertas) — duas cópias divergem um dia.
32. Comentário do GPS diz "timeout de 5s"; o código usa 10s.
33. CLAUDE.md desatualizado no cleanup de 24h (hoje só o blob da foto sai; o registro fica — evolução deliberada documentada no código).
34. `package.json` declara **Next ^14.2.18**; a documentação diz Next 15.
35. **`pdfkit` não está instalado** — `node scripts/gerar-tutorial-pdf.mjs` quebra num `npm ci` limpo.
36. Re-aplicar a migration 0017 hoje quebraria (referencia `is_teste`, derrubada na 0024) — vale um comentário de aviso no arquivo.
37. R57 do NEGOCIOv3 desatualizada (ver D8).
38. Docstring de `buscarCargas` diz que filtra teste; não filtra (e está certo não filtrar).

---

# 8. PLANO DE AÇÃO SUGERIDO (nada será feito sem sua autorização)

### Onda 0 — minutos de trabalho, retorno imediato
| # | Correção | Tamanho |
|---|---|---|
| A5 | Período customizado com fuso BR (padrão do dre.ts) | 2 linhas |
| A10 | `km` → `km_atual` no kmAtualPorCaminhao + olhar o error | 3 linhas |
| M1 | Regex do vencimento (`\d`) | 3 caracteres |
| A8 | Acerto negativo grava `conta_id` | 2 linhas |
| A11 | CardSaldo com os 2 filtros da fórmula | 2 linhas |

### Onda 1 — o DRE vira confiável (fazer antes de usar o financeiro pra decidir)
A1 (0× das contas de origem + linha "Não classificado"), A2 (dropdown de Nova conta), A3 (validação das recorrentes), A4 (nota assinada do app gera conta — recomendo trigger no banco), A6+D1 (cheque repassado na receita, se você aprovar).

### Onda 2 — o caixa fecha com a gaveta
A7+D2 (conta na compra direta), A9 (vale no DELETE), M2 (cheque no DELETE), M3 (sincronizar fato↔conta), M6 (acerto com saldo_esperado).

### Onda 3 — antes de ligar `features.carga` nos motoristas reais
M11 (avisos que se engolem), M12+D6 (foto do painel), M20 (os 2 alert() do motorista), e a dívida já conhecida: **teste do fluxo offline no navegador** (Playwright modo avião, ~4-6h — o ESTADO.md já pedia).

### Onda 4 — robustez de médio prazo
M13 (limites de 1.000 linhas — começando pela anti-dobra do DRE), M7 (RLS de adiantamentos), A12 (alerta + botão Renovar de documento), M16/M17+D4/D7 (alertas de foto/GPS e doação), M19 (unique das vigências), M21 (parcelas de fevereiro), M5 (delete de motorista), itens 2 e 4 da Parte XII (os pendentes que você já conhece).

### Onda 5 — limpeza
Os baixos e cosméticos da seção 7, em lote.

---

# 9. PALAVRA FINAL

O sistema está **bem construído onde mais importa**: as fundações (fórmula do
saldo, custo médio, ciclo do cheque, idempotência offline, segurança de
endpoint) resistiram a auditoria adversarial. Os problemas graves têm um padrão
claro — **as costuras entre módulos** (fato → conta → DRE → caixa), onde um elo
usa categoria que o outro não conhece, ou um apagar não desfaz o que o criar
fez. É exatamente o tipo de coisa que só aparece quando alguém puxa todos os
fios de uma vez, e é tudo consertável em pequeno volume de código.

A recomendação mais importante não é nenhum bug: é **fazer a Onda 1 antes do
dinheiro real passar pelo financeiro**, porque os erros dela não avisam — eles
só fazem o resultado parecer melhor do que é. E manter a regra que você já
segue: testar cada mudança em produção com o celular na mão.

*Relatório gerado em 20/08/2026. Nenhum arquivo de código foi alterado. Os dois
documentos novos são este e o [MANUAL-DO-SOFTWARE.md](MANUAL-DO-SOFTWARE.md).*
