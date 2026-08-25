# Relatório da carga pro motorista — design

> Brainstorm Evaner × Claude, 25/08/2026. Nasceu da primeira carga real do
> Lucimar: "ao finalizar, quero mandar um relatório pro funcionário guardar".

## Por que existe

**O objetivo não é informar — é fazer o caderno de papel virar inútil.** Hoje o
motorista anota à mão o que coletou e o que gastou, porque não confia (ainda)
que o app guardou. O relatório é a prova: se depois de 2-3 meses o papel que o
app entrega bate com o que ele anotaria, ele para de anotar.

Disso decorre tudo: linguagem de 5ª série, uma linha por lançamento, e
**nenhum número que possa divergir do que ele tem no bolso**.

## Formato

Rota `/admin/cargas/[id]/relatorio` (admin), HTML com CSS de impressão →
o Jean usa "Salvar como PDF" do navegador e manda no WhatsApp.

Descartados: PDF no servidor com pdfkit (dependência nova + layout em
coordenadas na mão) e PNG (exigiria SVG na mão ou puppeteer). Se um dia
imagem for melhor, a mesma página vira PNG sem refazer conteúdo.

## O relatório é um RETRATO, não um espelho

Decisão do Evaner: **saldo não entra no PDF.** Entre o Jean gerar e o
motorista abrir, ele pode ter coletado — o número ficaria desatualizado e
viraria atrito. O PDF é um retrato imutável do passado; saldo é filme, e
filme se vê no app.

Consequência: o adiantamento **aparece na linha do tempo** (pra ele se
situar: "é, aceitei nesse dia") mas **não entra em soma nenhuma**. Somar
"recebeu" convidaria à subtração e produziria um "sobrou" que não é o saldo.

## Janela dos adiantamentos

Adiantamento não tem `carga_id` — só `aceito_em`. Regra escolhida:
**do fim da carga anterior até o fim desta.** Como só existe 1 carga ativa
por motorista (índice único), os períodos se encaixam sem sobreposição: todo
adiantamento aceito aparece em exatamente um relatório, nenhum fica órfão.
Os aceitos antes da abertura ganham a marca *"antes de abrir a carga"*.

Descartada a janela "abrir → encerrar": o PIX de sexta com carga aberta na
segunda sumiria da história dele pra sempre.

## As três armadilhas de dinheiro (régua do dinheiro)

1. **`valor_pago` ≠ o que saiu do bolso dele.** Desde a 0058 a sede pode
   bancar parte da coleta. O que sai do bolso é `valor_pago - valor_sede`.
   Somar o valor cheio faria o papel acusar um gasto que não houve.
2. **Nota assinada não é dinheiro dele.** `pago_na_hora = false` (0018 pro
   abastecimento, 0047 pra despesa) vira conta da empresa. Aparece na linha
   do tempo como fato, marcado, fora da soma do bolso.
3. **Mesma fórmula do saldo, sempre.** Os filtros acima são os mesmos de
   `saldos_motoristas()` (0058). Nenhuma conta nova é inventada aqui.

## Conteúdo

**Cabeçalho:** nome, caminhão, saiu/voltou, dias, km inicial → final, rodado.

**Linha do tempo**, agrupada por dia (título do dia), uma linha por
lançamento com hora, descrição, litros e valor:
- recebeu do gestor (pix/dinheiro)
- abriu a carga · km
- coleta: nome do local, litros, valor
- diesel/arla: posto, litros, valor
- despesa: descrição, valor
- descarregou: kg líquidos

Segunda linha só nos casos raros: sede pagou parte, nota assinada, coleta
lançada no painel pelo gestor.

**Rodapé, dois blocos lado a lado:**
- *O óleo que você pegou*: litros lançados, peso na balança (bruto − tara),
  e a conversão aberta (litros × 0,9 ≈ kg). **Sem linha de "diferença"** —
  números lado a lado ensinam, uma linha de falta acusa.
- *O dinheiro do seu bolso*: coletas, combustível, outras despesas, total.
  Abaixo, nomeado: o que a empresa pagou direto.

**Fora, por decisão:** custo por litro, km/L, % do tanque (números de
avaliação do motorista, ficam só no painel do Jean), fotos, acerto, saldo.

## Densidade

Medido na produção: o Luiz fez 19 coletas em 1 dia. Uma carga de 5 dias nesse
ritmo dá ~90 lançamentos. Com bloco de 3 linhas por evento seriam 6 páginas —
por isso o formato é **tabela de uma linha por lançamento**, data como título
de dia, resumos lado a lado. 90 lançamentos ≈ 2 páginas; a carga real do
Lucimar (10 lançamentos) cabe em 1 folha com o resumo junto.

Impressão: A4, margem 12mm, `thead` repete sozinho nas páginas seguintes,
resumo com `break-inside: avoid`, sidebar do admin escondida com `print:hidden`.

## Entregável 2 — saldo na tela de boas-vindas

Achado durante o brainstorm: com `features.carga` ligado e sem carga ativa, a
home do motorista **redireciona** pra `/iniciar-carga`
([motorista/page.tsx:176](../../../src/app/motorista/page.tsx)). Como o
`CardSaldo` e o `AdiantamentoBlocking` só existem na home, sem carga aberta
ele não vê o saldo **e não tem onde aceitar um adiantamento** — o dinheiro
fica pendente até ele abrir uma carga, e o `aceito_em` carimba a data errada.

Correção: a tela de boas-vindas do "Iniciar carga" recebe os dois
componentes, reaproveitados. Nada é removido dos lugares atuais — é adição.

## Fora de escopo

- Motorista gerar o próprio relatório pelo app (o Jean envia).
- Envio automático por WhatsApp.
- Assinatura de conferência no papel.
