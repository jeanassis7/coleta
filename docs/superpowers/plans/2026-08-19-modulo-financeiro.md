# Módulo Financeiro — caixa, lançamentos, DRE e folha

> Plano de execução. Substitui o desenho do DRE — que virou a **fase C** disto.

**O que você descreveu:** dinheiro não aparece nem some. Pra entregar dinheiro
pro funcionário, saiu de algum lugar. Se entrou espécie, veio de uma venda ou
de um saque. Isso é um **caixa de verdade**, e é a fundação que faltava.

**Por isso são 4 fases.** Cada uma fecha com deploy e teste seu. A ordem não é
negociável: DRE sem caixa mostra número sem lastro.

| Fase | O quê | Depende de |
|---|---|---|
| **A** | Contas financeiras e caixa | — |
| **B** | Lançamentos e plano de contas | A |
| **C** | DRE | A + B |
| **D** | Folha: salários e comissão com vigência | B |

---

## Estado atual — quase nada pra migrar

Levantado em 19/08/2026:

| | |
|---|---|
| recebimentos, adiantamentos, contas pagas, despesas, abastecimentos, acertos | **0** |
| contas_a_pagar (não pagas) | 2 |
| coletas | 121 |

Ou seja: `conta_id` pode nascer **obrigatório**, sem backfill.

---

## ❓ A recomendação que quero que você confirme

**O "dinheiro na mão do motorista" NÃO vira conta financeira agora.**

Conceitualmente ele é uma conta — é dinheiro da empresa, na mão de uma pessoa.
Mas isso **já existe e funciona**: a função `saldos_motoristas()` (migration
0013) faz essa conta inteira dentro do Postgres, e foi ela que tirou o painel
de 4 segundos.

Transformar isso em conta genérica seria refatorar o motor de dinheiro que
funciona, pra ganhar elegância e nenhum número novo.

**Proposta:** no painel de caixa o motorista aparece como uma linha — *"Na mão
do Lucimar: R$ 800"* — lida da função que já existe. Entregar dinheiro é uma
saída da conta de origem **e** um adiantamento, como já é hoje.

Se um dia a conciliação exigir tratar tudo igual, dá pra unificar depois — mas
aí com motivo.

---

## FASE A — Contas financeiras e caixa

### Migration 0027

```sql
create table public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                      -- "Dinheiro em espécie", "Banco do Brasil"
  tipo text not null check (tipo in ('especie','banco')),
  banco text,                              -- só quando tipo='banco'
  agencia text,
  numero text,
  -- Sem saldo inicial o caixa nasce errado e nunca mais bate. A data é o
  -- corte: movimento anterior a ela não conta, porque já está no saldo.
  saldo_inicial numeric(12,2) not null default 0,
  saldo_inicial_em date not null,
  ativa boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

-- Saque e depósito: dinheiro que troca de bolso sem ser receita nem despesa.
-- É a linha que faz o caixa fechar e o DRE ignorar.
create table public.transferencias (
  id uuid primary key default gen_random_uuid(),
  conta_origem_id  uuid not null references public.contas_financeiras(id),
  conta_destino_id uuid not null references public.contas_financeiras(id),
  valor numeric(12,2) not null check (valor > 0),
  data date not null,
  descricao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now(),
  constraint origem_diferente_do_destino
    check (conta_origem_id <> conta_destino_id)
);

alter table public.recebimentos
  add column conta_id uuid references public.contas_financeiras(id);
alter table public.contas_a_pagar
  add column conta_id uuid references public.contas_financeiras(id);
alter table public.adiantamentos
  add column conta_id uuid references public.contas_financeiras(id);
```

`conta_id` entra anulável e vira obrigatório **na aplicação** desde já — as
linhas antigas (2 contas não pagas) não têm de onde tirar conta, e forçar
`not null` no banco quebraria o insert delas.

### Saldo de uma conta

```
saldo = saldo_inicial
      + recebimentos naquela conta        (desde saldo_inicial_em)
      + transferências que ENTRARAM
      − contas pagas daquela conta
      − adiantamentos daquela conta
      − transferências que SAÍRAM
```

Função `saldo_contas()` em PL/pgSQL, mesma escolha da `saldos_motoristas()`:
uma ida ao banco, não uma por conta.

### Telas

- **`/admin/caixa`** — um card por conta com o saldo, mais a linha "na mão de
  cada motorista", e o total. Botão de **transferir** (saque/depósito).
- **`/admin/contas-financeiras`** — cadastro: nome, tipo, banco/agência/número,
  saldo inicial e a data dele.

### Onde o `conta_id` passa a ser pedido

Recebimento de venda, maço de cheques, pagar uma conta, enviar adiantamento.
Em todos: campo obrigatório, com a última conta usada pré-selecionada.

---

## FASE B — Lançamentos e plano de contas

### Plano de contas (`src/lib/plano-contas.ts`)

Lista fixa em código, com grupo do DRE e se pede pessoa:

| Categoria | Grupo | Pede pessoa? |
|---|---|---|
| Óleo comprado | Custo do óleo | sim (motorista) |
| Óleo pago pela sede | Custo do óleo | não |
| Combustível · Troca de óleo · Pneus · Manutenção | Operacional | não |
| Lavagem · Equipamento veículo · Custos de viagem · Benfeitorias sede | Operacional | não |
| Transferência a sócio | Fixa | **sim** (Jean, Valdecir) |
| Salário | Fixa | **sim** |
| Advogado · Contabilidade · Sistema · Luz/Internet/Telefone | Fixa | não |
| Seguro Caminhão · IPVA da frota · Taxas e Licenças · Custos bancários | Fixa | não |
| Empréstimos e financiamentos · Dívidas PF | Financeiro | não |
| Impostos | Impostos | não |

### Migration 0028

`contas_a_pagar` ganha `pessoa_id` (nullable) e `categoria` passa a ser
validada contra a lista na aplicação. As 2 contas existentes são
reclassificadas.

⚠️ **Valdecir não é motorista nem admin** — precisa existir como pessoa pra
receber transferência. Opções: perfil com `role='motorista'` e `ativo=false`
(não usa o app), ou uma coluna `tipo` em profiles. **A decidir na hora.**

### Tela `/admin/lancamentos`

No ritmo do seu extrato: **data · fonte · valor · categoria · [pessoa] · obs**,
com a última fonte pré-selecionada e Enter salvando. Filtros por período,
categoria, fonte e pessoa. Grava em `contas_a_pagar` já com `status='paga'`.

---

## FASE C — DRE

Função `dre(inicio, fim)` **por competência**, com a regra anti-dobra:

> Lançamento **com** `origem_tipo` é espelho de algo operacional — conta pro
> caixa, nunca pro DRE. **Sem** `origem_tipo` é gasto próprio e entra.

Tela `/admin/dre` com as linhas do desenho, comparativo do período anterior, e
**clique na flecha pra abrir por pessoa** (Salários → cada funcionário;
Óleo comprado → cada motorista).

**O check que prova que não dobrou:** no E2E, somar o DRE inteiro e comparar
com a soma crua de todas as fontes de dinheiro que sai. Diferente = dobrou ou
sumiu, e o teste fica vermelho antes de você ver na tela.

---

## FASE D — Folha: salário e comissão com vigência

### Migration 0029

```sql
-- Valor que muda no tempo, sem recalcular o passado. Serve salário,
-- comissão, bônus e aumento — o mecanismo é o mesmo.
create table public.vigencias_remuneracao (
  id uuid primary key default gen_random_uuid(),
  -- null = vale pra todo mundo (ex: a comissão padrão da empresa)
  pessoa_id uuid references public.profiles(id),
  tipo text not null check (tipo in ('salario','comissao','bonus','transferencia_socio')),
  valor numeric(12,2) not null check (valor >= 0),
  -- Só comissão usa: "R$ valor a cada litros_base litros", proporcional.
  -- 350 L com base 200 e valor 100 = R$ 175.
  litros_base integer check (litros_base > 0),
  vigente_desde date not null,
  observacao text,
  registrado_por uuid not null references public.profiles(id),
  criado_em timestamptz not null default now()
);
```

**A busca:** pra um fato na data D, vale a vigência de maior `vigente_desde`
que seja `<= D`, preferindo a específica da pessoa sobre a geral. Mudar hoje
não mexe em nada do passado — que é exatamente o que você pediu.

**Comissão é proporcional:** `litros ÷ litros_base × valor`. 100 L numa base
de 200 paga metade.

Tela `/admin/remuneracao`: por pessoa, o valor vigente e o histórico de
vigências, com "nova vigência a partir de tal data".

---

## Fora de escopo (de propósito)

- **Conciliação bancária** (importar OFX e casar linha a linha) — você
  mencionou; é fase E, depois que o caixa estiver de pé com dado real.
- **Rateio por caminhão · margem por comprador · DRE contábil** — dá pra fazer
  em cima disso depois; agora seria adivinhar.
- **Motorista virar conta financeira** — ver a recomendação acima.

## ❓ Aberto

1. **Confirma** que "dinheiro na mão do motorista" fica como está (lido da
   `saldos_motoristas()`) e não vira conta genérica?
2. **Valdecir**: crio como perfil inativo, ou prefere outra saída?
3. Além de espécie e BB, **tem outra conta** pra já deixar cadastrada?
