# Módulo 2 — Estoque, Vendas e Frota

> Plano formal, escrito depois do brainstorm de 13/08/2026.
> **Revisado após a análise técnica do Evaner** — as correções estão marcadas com ⚠️ REVISÃO.
> **Nada foi implementado ainda.** Este documento é pra ler, cortar e aprovar.
> Contexto permanente em `CLAUDE.md`. Estado do Módulo 1 em `ESTADO.md`.

---

## O que este módulo resolve

Hoje o sistema sabe **quanto óleo entrou e quanto custou**. Não sabe quanto tem, por quanto saiu, quem deve, nem se o caminhão está com documento vencido.

Este módulo fecha o ciclo: **entra óleo → vira estoque → vira venda → vira dinheiro**, e ao lado disso mantém a frota e os motoristas em dia.

---

## Decisões fechadas no brainstorm

| Tema | Decisão |
|---|---|
| Unidade do estoque | **kg**, sempre. Litros só como referência (÷ 0,9) |
| Tipos de óleo | **fino** e **grosso**, saldos e custos separados |
| Origem do grosso | só compra direta. Motorista **sempre** produz fino |
| Saída | a venda escolhe a mistura (quanto era grosso), sem precisão milimétrica |
| Perda de processo | **não é medida.** O ajuste manual é a ferramenta, não a exceção |
| Ajuste | é **inventário**: digita o que tem de verdade, o sistema calcula a diferença |
| Estoque inicial | é um inventário com motivo "abertura" — **e informa o custo por kg** |
| Custo no ajuste | o inventário **preserva o custo médio vigente**; a diferença vira perda/sobra em R$ |
| Venda | **um momento só**, com o peso da balança (qualquer balança) |
| Entrega | é um ciclo: caminhão + gastos da viagem no mesmo lançamento. **Opcional** — às vezes o comprador busca |
| Saldo do comprador | **conta corrente**, pode ficar a mais ou a menos, e **se explica em linhas** |
| Cheque | objeto com vida própria: carteira → depositado/repassado → compensado/devolvido |
| Cheque = recebimento | **1 cheque : 1 recebimento**, sempre. Nunca agrupado |
| Cheque repassado | registra só pra onde foi. A despesa é outro momento |
| Custo | dois números: **custo do óleo por kg** (valoriza o estoque) e **custo total da viagem por kg** |
| Pneu | manutenção comum. Sem rastreio individual |
| Manutenção | dentro da **ficha do caminhão**, não é menu próprio |
| Documentos | um sistema, dois donos (caminhão e motorista), alerta 30 dias, **lista fixa + "Outro"** |
| OCR de cheque | **em lote**: monta a lista, você tica um a um antes de lançar. Retorna vazio quando não tem certeza, nunca chuta |
| Comprador devendo | **sem alerta.** Cortado pelo Evaner |

---

## Modelo de dados

### Estoque

⚠️ **REVISÃO — isto mudou.** O plano original dizia "uma view que soma os movimentos". Está errado, e o Evaner achou o motivo: **custo médio ponderado móvel não é uma soma, é uma sequência.** Cada saída sai pelo custo médio *daquele instante*, que depende de todas as entradas e saídas anteriores. `SUM()` não expressa isso.

Além disso, quando você vende mais do que o sistema acha que tem — o que **vai acontecer**, porque o aviso é amarelo e passa — o saldo fica negativo e a próxima entrada entra numa base torta. Dois ou três ciclos disso e o custo por kg vira ficção.

**A regra, agora explícita:**

1. O estado do estoque é o par **(saldo_kg, valor_em_reais)**. Custo médio é `valor ÷ saldo`.
2. **Entrada** soma kg e soma custo.
3. **Saída** tira kg e tira `kg × custo_médio_vigente`.
4. **Inventário** corrige a quantidade e **congela o custo médio**: o valor passa a ser `saldo_contado × custo_médio`. A diferença em reais é registrada como **perda ou sobra de estoque** — que é, sozinha, um número que o Jean vai querer ver.
5. **Abertura** (o primeiro inventário, com estoque zerado) é a única vez que ele **informa o custo por kg**. Sem isso, o primeiro custo médio nasce zero e contamina tudo pra frente.
6. Se o custo médio ficar sem sentido (saldo ≤ 0), o inventário **restaura a base** com o último custo médio válido.

Isso troca a view por uma **função em PL/pgSQL que percorre os movimentos em ordem de data**. Roda sobre centenas de linhas por ano — velocidade é irrelevante aqui, clareza não.

O que **continua valendo** do desenho original: **nada é duplicado.** Descargas, compras diretas e vendas continuam sendo a única fonte; a função lê delas. A tabela nova existe só pros ajustes.

```
função estoque_atual(tipo_oleo) → percorre em ordem de data:
  descargas        → entrada, fino,  custo = Σ valor_pago das coletas da carga
  compras_diretas  → entrada, tipo,  custo = valor     (só entra_no_estoque = true)
  vendas           → saída,  kg_fino e kg_grosso separados
  ajustes_estoque  → redefine saldo e valor conforme a regra acima

retorna: saldo_kg, custo_medio_kg, valor_total
```

```sql
-- 0016
alter table compras_diretas
  add column tipo_oleo text not null default 'fino'
    check (tipo_oleo in ('fino','grosso'));

create table ajustes_estoque (
  id uuid primary key default gen_random_uuid(),
  tipo_oleo text not null check (tipo_oleo in ('fino','grosso')),
  motivo_tipo text not null check (motivo_tipo in ('abertura','inventario')),

  saldo_antes_kg   numeric(10,2) not null,   -- o que o sistema dizia
  saldo_novo_kg    numeric(10,2) not null,   -- o que ele contou
  diferenca_kg     numeric(10,2) generated always as (saldo_novo_kg - saldo_antes_kg) stored,

  -- Congelado no momento do ajuste. Na abertura é digitado; no inventário é
  -- o custo médio vigente. Guardar aqui é o que impede o custo de derreter
  -- depois de vender mais do que tinha.
  custo_medio_kg   numeric(10,4) not null check (custo_medio_kg >= 0),
  perda_valor      numeric(10,2) not null,   -- diferenca_kg × custo_medio_kg

  motivo text not null,
  data date not null,
  registrado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now()
);
```

Guardar `saldo_antes_kg` e `custo_medio_kg` é o que torna o histórico legível daqui a dois anos: *"em março o sistema dizia 14.000 kg a R$ 1,85 e ele contou 11.500 — perdeu R$ 4.625"*.

**Custo médio não inclui diesel nem despesa.** Se incluísse, o custo do kg subiria porque o motorista rodou mais longe, e o número deixaria de responder "paguei caro pelo óleo?". O custo da operação aparece separado.

### Compradores, vendas e recebimentos

```sql
-- 0017
create table compradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cidade text, contato text, observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table vendas (
  id uuid primary key default gen_random_uuid(),
  comprador_id uuid not null references compradores(id),
  data date not null,
  peso_total_kg numeric(10,2) not null check (peso_total_kg > 0),
  kg_fino   numeric(10,2) not null default 0 check (kg_fino   >= 0),
  kg_grosso numeric(10,2) not null default 0 check (kg_grosso >= 0),
  constraint mistura_fecha check (kg_fino + kg_grosso = peso_total_kg),
  preco_kg    numeric(10,4) not null check (preco_kg > 0),
  valor_total numeric(10,2) not null check (valor_total > 0),
  caminhao_id uuid references caminhoes(id),   -- null = comprador buscou
  nota_numero text,
  foto_ticket_path text,
  observacao text,
  registrado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now()
);

create table recebimentos (
  id uuid primary key default gen_random_uuid(),
  comprador_id uuid not null references compradores(id),   -- conta corrente
  venda_id uuid references vendas(id),                     -- vínculo opcional
  forma text not null check (forma in ('pix','dinheiro','transferencia','cheque')),
  valor numeric(10,2) not null check (valor > 0),
  data date not null,
  observacao text,
  registrado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now()
);

create table cheques (
  id uuid primary key default gen_random_uuid(),
  -- ⚠️ 1 CHEQUE : 1 RECEBIMENTO. O unique é o que garante.
  recebimento_id uuid not null unique references recebimentos(id) on delete cascade,
  comprador_id uuid not null references compradores(id),
  banco text not null,
  emitente text not null,
  numero text,
  valor numeric(10,2) not null check (valor > 0),
  bom_para date not null,
  status text not null default 'em_carteira'
    check (status in ('em_carteira','depositado','compensado','devolvido','repassado')),
  repassado_para text, repassado_em date,
  depositado_em date, compensado_em date, devolvido_em date,
  foto_path text,
  criado_em timestamptz not null default now()
);
```

⚠️ **REVISÃO — cheque é 1:1 com recebimento.** O plano original permitia vários cheques por recebimento, e o Evaner achou o buraco: um recebimento de R$ 12 mil formado por R$ 10 mil de pix e R$ 2 mil de cheque, com o cheque voltando, faria a regra "ignora o recebimento do cheque devolvido" **apagar os R$ 10 mil de pix também**.

Com 1:1, a regra fica trivial e o extrato fica melhor: cada cheque é uma linha própria ("Bradesco 4412, bom para 15/09, R$ 3.240"), e devolver um cheque anula exatamente o valor dele.

**`preco_kg` com 4 casas** porque R$/kg de óleo anda em centavos e arredondar em 2 casas sobre 12 toneladas erra dezenas de reais. O total continua com 2 — é ele que vale.

**Preço e total andam juntos:** digita kg e R$/kg → total sai sozinho; edita o total ("dá 15 mil redondo") → o R$/kg recalcula na tela. Nunca gravar os dois desencontrados.

**`saldo_compradores()`** nasce como função no Postgres, igual `saldos_motoristas()`. O N+1 do saldo do motorista custou meio dia pra descobrir e uma migration pra consertar; não repetir.

### O saldo tem que se explicar

⚠️ Um número solto não serve. Se o comprador deve R$ 3.560, a ficha mostra **de onde vem**:

```
Perfilaz — deve R$ 3.560,00

  R$    320,00   residual da venda de 02/08 (pagou R$ 50.320 de R$ 50.000... )
  R$  3.240,00   cheque Bradesco nº 4412 devolvido em 11/09
```

A dívida do cheque devolvido **renasce sozinha** — o saldo desconsidera o recebimento anulado — mas ela aparece nomeada, com número, banco e data. Sem isso, o Jean vê "3.560" e vai ter que caçar no WhatsApp o motivo.

O cheque devolvido continua no extrato do comprador. É informação sobre o cliente, não sujeira.

### Gastos fora da carga

Hoje abastecimento e despesa exigem carga **e** motorista. A entrega do Jean não tem nem um nem outro.

```sql
-- 0018
alter table abastecimentos
  alter column carga_id      drop not null,
  alter column motorista_id  drop not null,
  add column caminhao_id uuid references caminhoes(id),
  add column venda_id    uuid references vendas(id),
  add column lancado_por uuid references profiles(id);
-- backfill caminhao_id a partir da carga, depois:
alter table abastecimentos
  alter column caminhao_id set not null,
  add constraint tem_origem check (carga_id is not null or lancado_por is not null);
-- idem despesas
```

⚠️ **REVISÃO — diagnóstico antes de rodar.** A cadeia de FKs *deveria* garantir que o backfill nunca deixe nulo (`abastecimentos.carga_id` é NOT NULL, `cargas.caminhao_id` é NOT NULL, e as FKs impedem apagar a carga ou o caminhão). Ou seja: o risco específico que o Evaner levantou está bloqueado pelo schema.

Mas a prática que ele pediu está certa e vale como regra: **migration que mexe em produção roda o SELECT de contagem antes, não descobre o número no erro.** O script vai imprimir quantas linhas ficariam nulas em cada tabela e **abortar a transação se for maior que zero**, em vez de tentar o `set not null` e quebrar no meio.

**`caminhao_id` obrigatório em todos** (inclusive nos antigos, por backfill) é o que faz "todo o diesel do caminhão X" ser uma consulta só — e é disso que dependem o km/L da ficha e o alerta de manutenção por km.

RLS: motorista continua vendo só o que tem `motorista_id = auth.uid()`. Linha lançada pelo painel tem `motorista_id` nulo e some pra ele naturalmente.

### Manutenção

```sql
-- 0019
create table manutencoes (
  id uuid primary key default gen_random_uuid(),
  caminhao_id uuid not null references caminhoes(id),
  data date not null,
  km integer,
  tipo text not null check (tipo in ('troca_oleo','pneu','revisao','corretiva','outro')),
  descricao text not null,
  valor numeric(10,2) not null check (valor > 0),
  fornecedor text,
  proxima_km integer,          -- só troca de óleo usa
  foto_path text,
  observacao text,
  registrado_por uuid not null references profiles(id),
  criado_em timestamptz not null default now()
);
```

Pneu é `tipo = 'pneu'` com `descricao = "4 pneus dianteiros"`. Sem estrutura, sem posição, sem carcaça.

### Documentos

⚠️ **REVISÃO — lista fixa, decisão do Evaner.** O plano original tinha texto livre com sugestões. Ele cortou: *"deixamos tudo o que faz sentido e se surgir um novo, eu adiciono por aqui"*. Está certo — com 3 caminhões e 3 motoristas, os tipos são um conjunto fechado que muda talvez uma vez por ano, e texto livre garante que um dia apareçam "CIPP", "cipp" e "C.I.P.P." como três coisas diferentes no painel.

Fica um **enum na aplicação** (não no banco, pra não precisar de migration a cada adição), com uma saída de emergência:

| Caminhão | Motorista |
|---|---|
| IPVA | CNH |
| Licenciamento | Exame toxicológico |
| Seguro | MOPP |
| CIV | Curso / reciclagem |
| CIPP | |
| Cronotacógrafo | |
| ANTT/RNTRC | |
| **Outro (descreva)** | **Outro (descreva)** |

O "Outro" existe pra você não ficar travado num sábado esperando eu deployar. Ele não agrupa nem gera estatística — e não precisa.

```sql
-- 0020
create table documentos (
  id uuid primary key default gen_random_uuid(),
  caminhao_id  uuid references caminhoes(id),
  motorista_id uuid references profiles(id),
  constraint um_dono_so check (
    (caminhao_id is not null)::int + (motorista_id is not null)::int = 1
  ),
  tipo text not null,
  descricao text,              -- preenchido só quando tipo = 'outro'
  vencimento date not null,
  valor numeric(10,2),
  arquivo_path text,
  alerta_dias integer not null default 30,
  observacao text,
  criado_em timestamptz not null default now()
);
```

Dois FKs nulos com check de exatamente um, em vez de dono polimórfico por texto — mantém integridade referencial de verdade e o banco impede documento órfão.

---

## Telas

### `/admin/estoque`
Dois cards — **fino** e **grosso** — com kg, custo médio R$/kg e valor total. Abaixo, o extrato de movimentos.

Botão **"Fazer inventário"**: escolhe o tipo, digita quanto tem de verdade, a tela mostra a diferença **antes** de confirmar e já em reais:

> O sistema dizia **14.000 kg**. Você contou **11.500 kg**.
> Diferença: **−2.500 kg** · a R$ 1,85/kg isso é uma perda de **R$ 4.625,00**.
> O custo por kg continua R$ 1,85.

Motivo obrigatório. Na **abertura** (estoque zerado), pede também o custo por kg — é a única vez.

### `/admin/vendas` e `/admin/vendas/nova`
Formulário único, desktop, dividido em blocos:

1. **Comprador e data**
2. **Peso** — o da balança, e a mistura (quanto era grosso). O campo aparece sempre, mesmo com grosso zerado.
3. **Preço** — R$/kg e total, um recalcula o outro.
4. **Entrega** *(opcional)* — caminhão, e os gastos da viagem: abastecimento, pedágio, almoço. Vazio quando o comprador buscou.
5. **Pagamento** — quanto entrou agora (pix/dinheiro) e os cheques, **um por um**. O que sobrar fica em aberto na conta do comprador.
6. **Ticket da balança** — foto.

Antiburros: peso maior que o estoque → **aviso amarelo, passa no segundo toque** (o estoque é estimado; bloquear travaria você num sábado). Soma dos pagamentos ≠ total → **aviso simples**, segue em frente, a diferença vira saldo.

### `/admin/compradores` e `/admin/compradores/[id]`
Lista com o saldo de cada um. A ficha tem dados, **saldo explicado em linhas** (ver acima), extrato (vendas e pagamentos em ordem de data) e os cheques dele.

### `/admin/cheques`
A carteira, ordenada por "bom para", com o que vence essa semana em destaque.

Ações por cheque: **depositar** → compensou ou voltou; **repassar** → pra quem foi.

**Lançar cheques com foto (OCR em lote).** ⚠️ **REVISÃO — decisão do Evaner: o OCR não preenche um formulário, ele monta uma lista de conferência.** O cheque chega em maço, não um por um. Então:

1. Sobe uma ou várias fotos (a pilha, ou um a um, tanto faz).
2. A IA devolve **uma linha por cheque encontrado** — banco, emitente, valor, bom para.
3. A tela vira uma **tabela de conferência**: a foto de um lado, as linhas do outro. Você confere e **tica uma a uma**, corrigindo o que estiver errado.
4. **Só o que foi ticado é lançado.** Linha não conferida não entra, ponto.

Isso é melhor que o formulário assistido por um motivo que vale registrar: **conferir é comparar, não confiar.** Com a foto do lado e a lista na frente, o erro salta; num formulário já preenchido, ele passa.

Regras que continuam valendo, pelo mesmo motivo de antes (modelo de visão inventa valor plausível quando não enxerga, e cheque tem valor manuscrito):

- Cada campo pode vir **vazio**. O prompt manda **deixar vazio quando não tiver certeza, nunca deduzir**.
- Foto ilegível, verso de cheque ou papel que não é cheque → a linha vem marcada como **"não deu pra ler"**, em branco, pra digitar na mão. Nunca meio preenchida — meio preenchido parece lido.
- Nada é lançado sem o tique.

Precisa de `ANTHROPIC_API_KEY` no Vercel. Custo de centavos por lote. **O lançamento manual funciona sem isso** — a foto é atalho, nunca dependência.

### `/admin/caminhoes/[id]` — a ficha
O menu Caminhões vira lista; clicar abre a ficha:

- Dados e edição (o que hoje é a tela de cadastro)
- **Próximas manutenções** em destaque — o que já venceu por km aparece em vermelho
- Histórico de manutenção + botão de lançar
- **Documentos** e vencimentos
- **Consumo km/L** nas últimas cargas
- Gasto total do caminhão no período

### `/admin/motoristas/[id]` — a ficha
Dados, documentos (CNH, toxicológico, cursos) com vencimento, e link pro histórico de dinheiro que já existe em `/admin/adiantamentos/[id]`.

### Dashboard
Três KPIs novos no topo: **estoque** (kg e valor), **a receber**, **cheques em carteira**.

Alertas novos, no mesmo tom didático dos existentes:
- Documento vencendo ou vencido — caminhão ou motorista
- Caminhão passou do km da próxima troca de óleo
- Cheque vence essa semana e não foi depositado
- Cheque venceu e continua na carteira
- Cheque devolvido ainda não resolvido
- Estoque negativo — sinal de que está na hora de contar o tanque

**Sem alerta de comprador devendo** — cortado pelo Evaner. A conta corrente já está na tela de compradores; alerta ruidoso ensina a ignorar alerta.

---

## Ordem de entrega

Escopo é tudo. O que se divide é o momento de você pôr a mão, porque bloco grande sem teste é onde bug se esconde.

**Bloco 1 — Estoque**
Migration 0016, tipo na compra direta, `estoque_atual()`, tela de estoque com inventário e abertura.
*Você testa:* faz a abertura do estoque e confere se as descargas e compras que já existem aparecem certas.

**Bloco 2 — Vendas, cheques e conta corrente**
Migrations 0017 e 0018. Compradores, venda com entrega e gastos, recebimentos, carteira de cheques, contas a receber, OCR.
*Você testa:* lança uma venda de verdade com cheque e vê o estoque baixar e o saldo aparecer.

**Bloco 3 — Frota e documentos**
Migrations 0019 e 0020. Fichas de caminhão e motorista, manutenção, documentos, alertas novos, KPIs.
*Você testa:* cadastra os documentos reais e vê os alertas nascerem.

Tudo nasce **dev-only**, atrás do mesmo gate do Módulo 1. O flip pro Jean é decisão dele, quando ele avisar.

Ao fim de cada bloco: `node scripts/e2e-modulo1.mjs` continua tendo que passar, e o `e2e-modulo2.mjs` cresce junto. O teste do custo médio depois de "vendeu mais que tinha + inventário" entra nele explicitamente — é o cenário que o Evaner achou e é o mais fácil de quebrar sem ninguém notar.

---

## O que ficou de fora, e por quê

- **Rastreio de pneu por carcaça** — cortado pelo Evaner. Pra 3-4 caminhões, o trabalho de manter não se paga.
- **Medição de sulco** — mesma razão. Relatório que ninguém alimenta mente.
- **Nota fiscal** — só o número, texto livre. Emitir NF é outro mundo.
- **Frete de terceiro** — se aparecer, é despesa.
- **Baixa automática de cheque por integração bancária** — manual.
- **Entrega em dois momentos** (saiu / entregou) — volta quando tiver mais caminhão na entrega.
- **Motorista lançando entrega pelo celular** — a entrega é do Jean, pelo painel.

---

## Riscos conhecidos

1. **O estoque vai divergir e isso é normal.** Se o inventário for tratado como conserto de erro em vez de rotina, o Jean vai parar de fazer e o número morre. A tela precisa deixar isso confortável.
2. **O custo médio é o número mais frágil do módulo.** Ele depende de ordem, de saldo positivo e de o inventário congelar a base direito. É o que tem teste dedicado no E2E.
3. **A migration 0018 mexe em tabela com dado em produção.** Diagnóstico antes, backfill dentro de transação, aborta se sobrar nulo, e o E2E do Módulo 1 tem que passar depois.
4. **O OCR pode ler errado.** Por isso o valor tem confirmação separada, o modo "não sei" é obrigatório e a foto fica guardada — dá pra auditar.
5. **A conta corrente esconde venda não paga.** Saldo por cliente não responde "qual venda ficou em aberto". O vínculo opcional `recebimentos.venda_id` já está lá pra virar relatório se um dia precisar.

---

## Módulo 3 (já rondando): Salários

Não faz parte deste plano, mas o Evaner já sinalizou a direção e vale registrar pra não desenhar nada que atrapalhe:

> pega o tanto que coletou → calcula comissão → soma com o salário cadastrado → aplica os descontos que o contador lançar → emite holerite → assina no app com validade jurídica, ou imprime e assina.

O que este módulo já deixa pronto pra isso: a separação entre **coleta do motorista** e **compra direta da empresa** (feita no Módulo 1 pensando exatamente em comissão), a ficha do motorista, e a conta corrente dele.

**A comissão hoje é a cada 200 L coletados.** O Evaner avisou que isso vai mudar — comissão por média, bônus por média, e o que aparecer.

Isso não é detalhe, é a decisão estrutural daquele módulo: **a regra de comissão precisa de vigência e a comissão já paga precisa ficar congelada.** Se a regra virar um número no código e mudar em 2027, todo cálculo de 2026 se reescreve sozinho na próxima vez que alguém abrir a tela — e comissão de motorista recalculada pra trás não é bug de sistema, é problema trabalhista. Então: regra com data de início, e o valor pago gravado com a regra que o gerou.

Fica em aberto pra quando chegar a hora: **200 L é bloco fechado ou proporcional?** (350 L pagam 1 comissão ou 1,75?)

**O holerite nasce no contador e é lançado no sistema** — decisão do Evaner, e ela simplifica muito. O sistema **não calcula folha**: recebe o que o contador fechou, guarda, mostra pro motorista e coleta a assinatura. Sem risco de divergir do eSocial, porque não existe segunda fonte de verdade.

**"Validade jurídica" tem três níveis** com custos diferentes: assinatura simples com trilha de auditoria (grátis, defensável), provedor certificado tipo Clicksign/D4Sign (centavos por documento, prova forte), ou imprimir e assinar (zero risco, zero custo). Escolha do Evaner quando chegar a hora.
