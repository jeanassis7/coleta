# Régua do dinheiro — as 8 perguntas obrigatórias

> Criada em 21/08/2026, depois de um buraco real: o pagamento de dívida
> aceitava valor MAIOR que o saldo devedor sem avisar, o saldo ficava
> negativo e a tela mascarava com `Math.max(0, saldo)` mostrando R$ 0,00.
>
> **A causa raiz não foi distração — foi ausência de método.** A feature foi
> testada nos caminhos que davam certo (7 cenários, todos felizes) e nenhum
> nos caminhos que dão errado. Boa intenção não fecha buraco; checklist fecha.

## A regra

**Toda alteração que toca dinheiro passa por estas 8 perguntas, uma a uma,
ANTES de dizer que está pronta.** Vale pra código novo e pra edição de
código existente. Se a resposta de alguma for "não sei", a feature não está
pronta — teste e descubra.

Dinheiro é: valor, saldo, estoque, litros/kg, data de pagamento, status que
libera dinheiro (cheque, conta paga, adiantamento aceito).

---

### 1. E se for MAIOR que o limite?
Pagar mais do que se deve, devolver mais do que se tem, vender mais kg do
que existe, acertar valor maior que o saldo. **Nunca bloquear em silêncio
nem aceitar em silêncio**: o padrão é o antiburro de duas etapas — o
primeiro clique explica com o número na tela, o segundo faz.

### 2. E se for ZERO ou NEGATIVO?
Zero é válido em alguns lugares (coleta doada, R31) e inválido em outros.
Negativo idem (acerto pode ser negativo — a empresa deve pro motorista).
Decidir explicitamente qual é o caso e escrever o CHECK no banco.

### 3. E se clicar DUAS VEZES?
Reenvio, dois admins ao mesmo tempo, sync repetido do celular. O `UPDATE`
filtra pelo estado anterior (`.eq("status", "em_carteira")`) ou sobrescreve
cego? Tem `client_id` único onde o celular manda?

### 4. E se APAGAR depois?
Apagar o pagamento devolve a dívida? Apagar o lançamento devolve o cheque
pra carteira e o vale pra pendente? **O desfazer tem que ser tão completo
quanto o fazer** — meio desfazer deixa número órfão.

### 5. CONTA DUAS VEZES em algum relatório?
O fato entra no DRE pelo lançamento E pela conta a pagar? Aparece no caixa
e na dívida ao mesmo tempo? A anti-dobra é por `origem_id`/`divida_id` — o
caminho novo respeita?

### 6. A TELA está escondendo o número ruim?
`Math.max(0, x)`, `Math.min`, `Math.abs`, `|| 0`, `?? 0`: cada um desses num
valor financeiro é suspeito de estar mascarando estado inválido. Se o número
pode ficar ruim, **a tela mostra que ficou** e explica o que fazer.

### 7. O guard está no SERVIDOR?
Validação só no componente não é validação — é sugestão. A tela guia; o
endpoint garante. (E a RLS garante contra quem chama a API na mão.)

### 8. O TESTE cobre o caminho que dá errado?
Rodar o cenário feliz prova que funciona quando tudo dá certo — que é
justamente quando ninguém precisa do sistema. **Todo guard novo ganha um
caso no `scripts/e2e-*.mjs`**, com o valor errado de propósito, pra que uma
regressão quebre o CI em vez de quebrar o caixa do Jean.

---

## Como usar na prática

Antes de commitar algo que toca dinheiro, escreva no corpo do commit (ou
na resposta ao Evaner) **quais das 8 você verificou e o que achou**. Não
precisa ser longo — "1 ok (guard + confirmação), 3 ok (filtro por status),
4 recalculado, 6 sem máscara" já mostra que a régua passou.

O que NÃO vale: dizer "testei" sem dizer o quê. Foi exatamente assim que o
buraco da dívida passou.
