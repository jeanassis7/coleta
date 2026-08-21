# Estado do projeto — onde paramos

> Atualizado em 21/08/2026 (rodada de edição pós-varredura do dinheiro).
> Ler junto com `CLAUDE.md` (contexto permanente), `PLANO-MODULO-1.md`,
> `PLANO-MODULO-2.md` e `VARREDURA-DINHEIRO.md` (os 47 buracos do sistema
> fechado de dinheiro, mapeados em 20/08).

---

## Resumo em uma frase

**Módulos 1, 2, 3 (frota e documentos) e o módulo FINANCEIRO estão no ar.**
O sistema fecha o ciclo inteiro: entra óleo → vira estoque → vira venda →
vira dinheiro → vira DRE. Os papéis foram reduzidos a dois (`motorista` e
`admin`), com `ve_log` como única diferença entre Jean e Evaner.

**Mas quase nada rodou com dado real ainda** — 0 cargas, estoque zerado,
nenhuma conta financeira cadastrada. O sistema está à frente da operação.

---

## Números

| | |
|---|---|
| Migrations aplicadas | 30 (`0001` → `0030`) |
| Páginas admin | 22 |
| Telas do motorista | 9 |
| Endpoints de API | 33 |
| Linhas em `src/` | ~23.000 |
| Checks automatizados | 55 (Módulo 1) + ~30 (Módulo 2) |

---

## O que existe

### Motorista (PWA, offline-first)

**No ar pros motoristas reais (Luis, Lucimar):** login, nova coleta com GPS
silencioso e sugestão de local por proximidade, foto comprimida, fila
offline no IndexedDB, sync automático em 4 gatilhos, e a lista
**"Coletas dessa carga"** com total de litros e total pago.

**Atrás de `features.carga` (nenhum motorista real ainda):** iniciar carga, barra do
caminhão, abastecimento (com posto por GPS e "PAGUEI AGORA / ASSINEI A
NOTA"), despesa, descarregar e cancelar carga.

**Atrás de `features.saldo`:** aceite de adiantamento e card "Seu dinheiro".

### Admin (o Jean já usa tudo)

- **Dashboard** — alertas didáticos, cargas ativas, descargas recentes, KPIs
- **Estoque** — fino e grosso, saldo, custo médio ponderado móvel, inventário
- **Vendas** — peso da balança, mistura, preço, entrega e pagamento
- **Cheques** — carteira por "bom para", depositar/compensar/repassar/voltou
- **Contas a pagar** — a pagar, previstas, pagas, recorrentes
- **Compradores** — conta corrente com saldo explicado em linhas + ficha
- **Cargas** — tabela densa + drill-down com mapa, linha do tempo e fotos
- **Abastecimentos · Despesas · Compra direta · Adiantamentos**
- **Caminhões · Motoristas · Curadoria de locais · Eventos**
- **Ficha do caminhão** (`/admin/caminhoes/[id]`) — próxima troca de óleo por km com semáforo, km/L e gasto do mês, histórico de manutenção e documentos
- **Ficha do motorista** (`/admin/motoristas/[id]`) — CNH, toxicológico, MOPP, cursos, com vencimento e arquivo anexado
- **`/admin/caixa`** — saldo por conta, dinheiro na mão dos motoristas, transferências (saque/depósito)
- **`/admin/lancamentos`** — o que já saiu, no ritmo do extrato, com filtros
- **`/admin/dre`** — painel por regime de caixa, com abertura por pessoa
- **`/admin/remuneracao`** — vigências de salário/comissão + cálculo da comissão do período
- **`/admin/features`** — liga feature por motorista (rollout gradual)
- **`/admin/log`** — quem fez o quê (só quem tem `ve_log`; hoje só o Evaner)

---

## Testes

**CI no GitHub Actions**, a cada push: typecheck, build e os dois E2E.
Segredos cadastrados — os quatro jobs rodam de verdade.

- `scripts/e2e-modulo1.mjs` — **55 checks**. Cria e apaga o próprio motorista
  descartável ("E2E Bot"). Enquanto roda (~1 min) o dado dele fica visível no
  painel — o conceito de motorista invisível deixou de existir em 19/08.
- `scripts/e2e-modulo2.mjs` — read-only: simula dentro de transação e dá
  ROLLBACK. Cobre a matemática do custo médio, venda baixando os dois
  estoques, cheque devolvido, contas a pagar e geração idempotente.

**O que os testes NÃO cobrem** (e é o buraco real): nada roda no navegador.
Zero cobertura de Service Worker, fila offline e sync — a parte mais
arriscada do sistema é verificada só pelo Evaner com o celular no modo
avião. Ver "Dívidas" abaixo.

---

## Pendências reais

### Só o Evaner pode fazer

1. **Testar o Módulo 2 em produção** — estoque, venda, cheque, contas a pagar.
   Em 19/08 as tabelas ainda estavam zeradas.
2. **Calibrar o zoom do mapa** do drill-down (precisa de carga real espalhada).
3. **Ligar `features.carga`** nos motoristas reais, em `/admin/features` — um
   de cada vez. Antes disso, **cadastrar os caminhões de verdade**: hoje só
   existe o AAA-0000 de teste, e sem caminhão o motorista não inicia carga.
4. **Limpar o resto do dado de teste** — o caminhão AAA-0000 e o perfil
   Teste 1. Ele disse que faz na mão.

### As 7 correções do NEGOCIOv3.md — 7 DE 7 FEITAS ✅

Em **19/08/2026** o Evaner conferiu **131 regras de negócio** uma a uma (ver
`NEGOCIOv3.md`). Os 5 primeiros itens saíram em 19/08; em **20/08** saíram
os dois últimos — **item 2** (comissão pelos litros da DESCARGA, vigência do
dia da pesagem, só carga encerrada) e **item 4** (card Patrimônio no Caixa:
seis linhas + total + preço de referência editável em R$/litro, tabela
`configuracoes` na 0036).

### A auditoria completa de 20/08/2026 — e a onda de correções

O Evaner pediu uma varredura completa (código × 131 regras). O resultado
está em **`RELATORIO-AUDITORIA.md`** (achados, gravidade, decisões) e o
**`MANUAL-DO-SOFTWARE.md`** nasceu junto. Ele respondeu achado por achado e
autorizou as correções, que foram TODAS aplicadas em 20/08, nas migrations
0033-0040 e nos commits do dia. Destaques:

- **DRE nunca mais engole dinheiro**: linha automática soma as contas pagas
  da categoria; conta órfã cai na linha "Não classificado"; "Nova conta" e
  recorrentes validam contra o plano; receita inclui cheque repassado
  (R67-b nova).
- **Caixa fecha com a gaveta**: compra direta com conta (0035), acerto
  negativo grava a conta, "assinei a nota" vira conta por trigger (0034),
  apagar/editar fato desfaz/ajusta a conta amarrada, vale e cheque voltam
  quando o pagamento é apagado.
- **Comissão pela descarga** e **patrimônio** (itens 2 e 4).
- **selectTudo()** (`src/lib/supabase/select-tudo.ts`): paginação automática
  que mata DE VEZ o teto silencioso de 1.000 linhas do Supabase — usar em
  TODA consulta sem limite natural (já aplicado em DRE/jaTemConta, coletas
  do dashboard, coletas 90d dos alertas, alertas_vistos, km da frota).
- **Alertas**: dispensa por admin (0039), chave de documento com vencimento,
  doação de R$ 0 com texto próprio, período customizado com fuso certo.
- **Motorista**: avisos não se engolem mais, zero alert(), CardSaldo usa a
  RPC `meu_saldo()` (0033 — a MESMA fórmula do painel).
- **RLS**: motorista só ACEITA adiantamento (trigger 0037).

**Decisões que o Evaner deixou EM ABERTO (não mexer sem ordem):**
- **D6/R14**: foto do painel ao iniciar carga continua opcional no código
  (a regra diz obrigatória) — "por enquanto deixa aberto".
- **D3/R112**: vigência geral mais nova hoje VENCE específica mais antiga —
  aguardando resposta dele aos exemplos.
- **Categorias do DRE pra documentos**: hoje IPVA→ipva_frota etc.
  (categoriaDeDocumento); debate sobre linha única "Documentos" em aberto.
- **D10**: senhas continuam no CLAUDE.md (decisão dele, projeto interno).
- **Item 7 do relatório** (baixos/cosméticos): NÃO autorizado em lote — ele
  quer entender melhor antes. Detalhar em grupos pequenos quando pedir.
- **Debate das categorias do DRE**: proposta enviada em 20/08 (aluguel,
  água, etc.) — aguardando as respostas dele. Categoria nova só entra
  quando ele pedir. A RECEITA já abre em 3 (à vista / cheques compensados /
  cheques repassados) — isso ele pediu explicitamente e foi feito.

**Segunda rodada de 20/08 (depois das respostas dele):** M1 (Editar
valor/vencimento de conta a_pagar — ação "editar" + modal), M4 (devolução
de cheque virou tudo-ou-nada: se a reversão da conta falhar, o cheque volta
pro status anterior e a tela explica), M22 (maço idempotente por client_id
— migration 0041 — e OCR em levas de 3 fotos pra não estourar payload), D9
(texto no cadastro de conta: informe o saldo de ANTES dos lançamentos do
dia), e a abertura da Receita no DRE.

**Terceira rodada de 20/08 (fechamento do debate):**
- Categorias decididas: SEM outras-receitas (só óleo entra), SEM aluguel
  (sede própria); "Luz, água, internet e telefone"; **Encargos de
  funcionário** (fixa, por pessoa); **Documentos dos caminhões** (nova,
  absorveu a IPVA-da-frota) + Seguro + Taxas e Licenças como os 3 baldes de
  documento (`categoriaDeDocumento` agora recebe o dono).
- **Comissão FICA SEPARADA do Salário** (decisão do Evaner): Jean lança da
  folha do contador item a item — Salário, Comissão e Encargos, cada um na
  sua categoria. Não juntar.
- **Item 7 do relatório: regra do Evaner** = só corrigir o que influencia
  número gerencial/relatório; o resto ele valida usando. Corrigidos por
  essa régua: fuso do corte do caixa (0042), +1 dia no comparativo de
  compras (diaBrIso), quitação parcial de vale deixou de ser silenciosa
  (+ guardas de categoria/pessoa no servidor), cheque devolvido desmarca os
  vales da conta revertida. O resto do item 7 fica dormindo — NÃO mexer.
- **Teste offline no navegador: RECUSADO pelo Evaner** ("não precisa") em
  20/08. Não insistir; o teste manual dele com o celular segue sendo a
  verificação do fluxo offline.

### Quarta rodada de 20/08 (noite) — folha, virada e os 9 da revisão dele

- **Holerites reais analisados** (07/2026): receita da folha na seção 4.6 do
  manual (Comissão = COMISSÕES+DSR bruta; Salário = líquido − comissão;
  guias como Encargos "Empresa toda" — decisão dele: NÃO ratear; consignado
  como Salário da pessoa). NEGOCIOv3 ganhou R110-c/R110-d.
- **Plano de contas fechado no debate**: + Encargos de funcionário
  (pessoaOpcional — guia coletiva aceita "Empresa toda"), + Documentos dos
  caminhões (absorveu ipva_frota), Luz ganhou água. Comissão FICA separada
  do Salário. Receita do DRE abre em 3 (à vista/compensados/repassados).
- **A virada do regime antigo**: os −66k do card são adiantamentos mandados
  por fora antes do módulo. Regularização = adiantamento retroativo (campo
  "Quando foi", datado antes do corte das contas → não mexe no caixa) +
  motorista aceita no app. Cronograma dele: Lucimar na descarga de amanhã
  (21/08), Luis nesta semana (roda semana que vem), Lucinei na semana dele.
  Regras de ouro: carga só liga com caminhão VAZIO; abertura do estoque =
  depois da ÚLTIMA descarga do regime antigo e antes da 1ª venda/descarga
  do sistema.
- **Os 9 da revisão dele (migrations 0043-0046)**: apagar perfil de teste
  COM TUDO (forcado total) + DELETE de carga com cascade; manutenção à
  vista exige conta (nasce conta paga de origem); troca de óleo por km E/OU
  data; compra direta vinculada à carga aberta (não-vazio) e pagável com
  CHEQUE da carteira (conta paga origem compra_direta); coleta da sede com
  "sede JÁ PAGOU" (conta nasce paga); ARLA no abastecimento (fora do km/L);
  litros com máscara de dinheiro (InputLitros); placas por motorista
  (motorista_caminhoes — vazio = todas).
- **e2e-modulo2 do estoque virou DELTA** (o CI quebrou quando o Evaner pôs
  dado real com o perfil "teste" — o bloco afirmava totais absolutos).

**Aguardando resposta do Evaner:** a frase cortada sobre a VENDA ("no saldo
tem a entrada... ou até mesmo em alguns" — pediu-se o resto); régua da
comissão em litros (atual) ou kg (só rótulo); D3 (gestor); D6 (foto do
painel). Pra reunião: combinar o número da regularização com cada motorista
ANTES, e alinhar com o contador se o vale vira linha de desconto na folha.

### A varredura do dinheiro (20/08 à noite) e a rodada de EDIÇÃO (21/08)

O Evaner pediu a varredura completa do sistema fechado de dinheiro antes dos
lançamentos reais — resultado em **`VARREDURA-DINHEIRO.md`** (47 buracos,
numerados, com arquivo:linha). Da varredura ele autorizou a **rodada de
edição** ("o que precisa edição?"), 9 itens implementados em 21/08, um
commit por item, regra única: **editar/apagar arrasta o dinheiro amarrado**:

1. **Conta financeira** ganhou tela de edição no Caixa (nome, saldo de
   partida, data de corte), desativar/reativar e apagar (só sem movimento;
   o guard do DELETE agora cobre cheques e compras diretas).
2. **Acerto**: "Desfazer" no ÚLTIMO acerto (histórico do motorista). Reabre
   o ciclo; recusa se não for o mais recente ou se o vale já foi quitado.
3. **Recebimento**: "apagar" no extrato do comprador, desfazendo tudo.
   Cheque junto só em carteira/depositado (compensado/repassado recusam).
4. **Cheque**: "Editar" dados (valor/banco/emitente/bom para — o
   recebimento par acompanha o valor, tudo-ou-nada) e "corrigir conta" da
   compensação. Falha na reversão de vales deixou de ser engolida.
5. **Abastecimento**: troca PAGUEI AGORA ↔ ASSINEI A NOTA no modal de
   edição — cria/remove a conta amarrada (trigger 0034 é só INSERT); conta
   paga recusa a troca. Avisos do servidor agora aparecem na tela.
6. **Pagamento feito** (Lançamentos): "Editar" — data, conta, categoria,
   pessoa, obs. Valor de fora (apagar e relançar). Conta de origem: só
   data/conta. Cheque: repassado_em anda junto. Categoria de pagamento que
   quitou vale só pode continuar salario.
7. **Venda**: "Editar" campos simples (data, comprador, preço→total, nota,
   obs). Peso/mistura de fora (estoque). Trocar comprador só sem
   recebimento vinculado. Apagar venda recebida avisa do crédito.
8. **Manutenção**: "Editar" na ficha do caminhão (o PATCH já existia sem
   caller); apagar agora remove a conta EM ABERTO amarrada (paga fica, com
   aviso) — igual ao abastecimento.
9. **Compra direta**: editar propaga valor/data/fornecedor pra conta do
   cheque (e o repassado_em); PATCH recusa dupla fonte de pagamento e
   fora-do-estoque sem carga; **apagar devolve o cheque pra carteira** e
   remove a conta espelho.

Verificação: typecheck + build limpos, e2e-modulo1 56/56, e2e-modulo2 tudo
verde.

### A rodada FINAL da varredura (21/08, tarde) — "o restante pode implementar"

O Evaner autorizou o resto da varredura inteiro (e decidiu o item 41:
apagar forçado continua levando tudo — é o erase de perfil simulado — e a
blindagem virou a coluna `profiles.protegido`, marcada nos 3 motoristas
reais + Valdecir). **Migrations 0047-0050 aplicadas.** O que entrou:

- **0047 (caixa fecha de verdade):** `entradas_avulsas` (aporte,
  empréstimo, reembolso, rendimento, venda de bem — entra no caixa, FORA
  do DRE), `ajustes_caixa` (inventário do dinheiro, com motivo),
  `devolucoes_motorista` (troco no meio do ciclo, sem resetar o corte),
  `despesas.pago_na_hora` + trigger da nota assinada de despesa,
  `conta_id` em despesas/abastecimentos (sede paga direto), forma
  `abatimento` no recebimento, e as duas funções de saldo redefinidas.
- **0048** venda com `client_id` (clique duplo não duplica). **0049**
  perfil protegido. **0050** o custo da compra "no caminhão"
  (`entra_no_estoque=false`) entra no custo da descarga da carga.
- **Telas:** Caixa ganhou Entrada avulsa + Ajuste + linha "A caminho"
  (adiantamento pendente) no patrimônio; Adiantamentos ganhou Devolução e
  Estornar (aceito, com guarda de ciclo); coleta retroativa nasce com o
  pagador (bolso/sede/sede-já-pagou) e o pacote inteiro da coleta da sede
  fechou (delete desfaz a conta, valor-0 corrigido nasce a dívida, badge
  "sede", conta cancelada desmarca a coleta); despesa ganhou ASSINEI A NOTA
  no app do motorista e no painel; avulso do painel exige conta e aparece
  nas listas (LEFT join); ModalPagar ganhou parcial + juros/multa
  (categoria nova `juros_multas`) + vales; conta manual pede pessoa;
  compra direta a prazo; cheque compensado pode "voltar" (devolução
  tardia); documento não duplica mais a conta; datas futuras bloqueadas em
  toda saída; Remuneração mostra calculado × pago; contas com selectTudo.
- **De fora, com justificativa:** item 31 (cheque sem comprador —
  invasivo, sem caso real) e 36 (acerto retroativo — o Desfazer cobre).

Verificação da rodada final: typecheck + build limpos, e2e-modulo1 56/56,
e2e-modulo2 tudo verde. VARREDURA-DINHEIRO.md ganhou o placar no topo.

### Aberto sem causa raiz

**O painel travou de forma intermitente em 19/08** — telas presas no esqueleto
por 20-30s, inclusive o login. Investigado a fundo e **descartados com
medição**: banco (0 linhas, RLS em 0,055ms), Supabase (135-200ms), Service
Worker (limpo, continuou), JS quebrado (React estava hidratado). Os motoristas
trabalhavam normalmente na mesma janela, então não foi queda de plataforma.
**Se curou sozinho**, o que aponta pra algo com janela de tempo (rate limit ou
estado de sessão). Se voltar: F12 → Network com Preserve log + Console, é o
que falta pra fechar.

Suspeita não confirmada: a sidebar tem 21 `<Link>`, o Next faz prefetch de
todos, e o middleware roda `auth.getUser()` (ida de rede) + query de
`profiles` em CADA requisição — ~45 chamadas ao Supabase por abertura de
página. Otimização pendente: `prefetch={false}` na sidebar e colapsar os 3
`getUser()` em um.

### Feito nesta sessão (19/08/2026)

- **Bloco 3 — frota e documentos.** Manutenção com custo, documentos com
  vencimento (CIPP, CIV, IPVA, CNH, toxicológico, cursos), as duas fichas,
  alertas de vencimento e de km, e os 3 KPIs de topo.
- **OCR de cheque em lote.** Sobe até 10 fotos, monta a lista de conferência
  com a foto ao lado, e só lança o que for ticado. Usa **OpenAI** (decisão do
  Evaner: já paga por ela). Falta `OPENAI_API_KEY` na Vercel — sem ela o
  botão some e o lançamento manual funciona igual.
- **Módulo financeiro inteiro** — caixa, lançamentos, DRE e remuneração.
  Migrations 0027 a 0030.
- **NEGOCIOv3.md** — 131 regras de negócio conferidas uma a uma pelo Evaner.

### Em aberto, sem decisão

1. **Umidade não desconta nada** — espera a máquina de medir.
2. **Checklist ao iniciar carga** — o Evaner quer, mas decidiu deixar pra
   depois.
3. **Kit de emergência** (carga perigosa) — mesma coisa.

---

## Dívidas técnicas

1. **Nenhum teste roda no navegador.** O fluxo offline — Service Worker,
   IndexedDB, sync — é o mais complexo e o mais arriscado, e é testado só na
   mão. Playwright cobrindo modo avião: ~4-6h de trabalho. **Fazer antes de
   ligar features nos motoristas reais**, porque a partir daí uma regressão
   ali não é incômodo, é coleta perdida no meio do Paraná.
2. **Os E2E rodam contra produção** — é o único ambiente que existe. Está
   mitigado (bot descartável, rollback), mas um projeto Supabase separado pra
   teste resolveria de vez.
3. **Sem monitoramento de erro centralizado** — só `app_events`.
4. **Backup PITR do Supabase** — free tier tem 7 dias.
5. **ESLint nunca foi configurado** — o CI pula lint por isso.

---

## Como o Evaner trabalha (pra próxima sessão não errar)

- Ele decide o escopo; eu recomendo, ele corta. Prefere recortar a adicionar.
- Quer **debate antes de código** em qualquer coisa que envolva modelagem — e
  a conversa costuma melhorar o desenho. O posto por GPS, a conta corrente
  por comprador e o previsto × real nasceram assim.
- **Revisa o plano tecnicamente** e acha buracos reais (o cheque devolvido
  levando o pix junto, o custo médio derretendo depois de saldo negativo).
- Testa em produção com o celular. O que ele acha em 10 minutos, nenhum teste
  automatizado acha.
- **Ele quer o diagnóstico antes do conserto.** Uma sessão anterior saiu
  mexendo em tudo sem causa raiz e ele perdeu a confiança no resultado.
  Medir, mostrar o número, e só então propor.
