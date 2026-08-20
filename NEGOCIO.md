# As regras deste negócio

> **Versão 2** — 19/08/2026. Reescrito depois da conferência do Evaner regra
> por regra. O que era pergunta virou resposta; o que era inferência minha e
> ele corrigiu está corrigido.
>
> Regras extraídas do **código em produção**. `[CONFIRMADO]` = ele conferiu.
> `[A CORRIGIR]` = o software não faz o que a regra diz — está na lista da
> Parte XII.

---

# PARTE I — O NEGÓCIO

## 1. O modelo

**R1.** A JJHS **compra** óleo lubrificante usado de muitos geradores
pequenos, acumula, e **vende** em poucos lotes grandes. A receita é o spread
entre comprar em volume pequeno e vender em volume grande, menos o custo de
rodar caminhão pelo oeste do Paraná.

**R2.** **Óleo é sempre pago.** Não existe caso de a empresa receber para
retirar. Se em algum momento o óleo for doado, lança-se com **valor zero** —
não há regra especial.
`[CONFIRMADO]` · `[A CORRIGIR — o banco tem check (valor_pago > 0) e recusa
zero hoje]`

**R3.** **O certificado de coleta não é o motor do negócio.** Ele é emitido na
hora, em **bloco físico, escrito à mão pelo motorista**. Não há consequência
por não emitir, nem ganho por emitir — é **política de mercado**, e ponto.
`[CONFIRMADO — isto corrige uma inferência minha da v1, onde eu tratava o
certificado como a razão de o gerador escolher um coletor formal]`

**R4.** Rotas: **Guaíra, Toledo, Cascavel, Foz do Iguaçu**. Muita área rural
sem sinal — por isso o app do motorista é offline-first, não por elegância.

---

## 2. O produto

**R5.** O motorista mede em **litros**. Ele nunca estima peso.

**R6.** Da balança em diante, tudo é **quilo**.

**R7.** A conversão é **0,9 kg/L**, fixa no sistema inteiro.
`[CONFIRMADO — é a densidade usada há anos na prática]`

**R8.** Existem **dois óleos** com estoque, saldo e custo médio separados:
**fino** e **grosso**. O que os define é **o tipo, não um critério técnico**.

**R9.** **O motorista só traz fino.** Se é grosso, entrou por **compra
direta**. Não existe caminho no software para um motorista lançar grosso, e
isso está certo.
`[CONFIRMADO]`

**R10.** Na venda você escolhe quantos kg de cada saem. A soma tem que bater
com o peso total — o banco recusa se não bater.

**R11.** A **umidade** é registrada na descarga mas **não desconta nada**.
Fica pendente até existir a máquina de medir.

---

# PARTE II — A OPERAÇÃO DE CAMPO

## 3. A carga

**R12.** A unidade operacional é a **carga** — não o dia, não a viagem.
**Dura de 3 a 10 dias.** `[CONFIRMADO]`

**R13.** **Um motorista só pode ter uma carga aberta.** Garantido por índice
único no banco, não por tela.

**R14.** Iniciar carga exige **caminhão, km inicial e foto do painel**. É a
**única ação do motorista que exige internet** — o servidor precisa garantir
a regra R13.

**R15.** Coleta, despesa, abastecimento e descarga funcionam **100% offline** e
sincronizam sozinhos.

**R16.** **A descarga é sempre total. Nunca parcial.** O motorista não leva
parte pra sede e volta pra rota. `[CONFIRMADO]`

**R17.** A carga encerra na descarga. Localmente na hora; o servidor confirma
no sync.

**R18.** Uma carga pode ser **cancelada** pelo motorista.

## 4. A descarga

**R19.** `peso bruto (balança) − tara do caminhão = peso líquido`.

**R20.** A **balança é sempre a mesma**, e **quem confere o ticket é o gestor,
na hora da pesagem**. `[CONFIRMADO]`

**R21.** A **tara vem do cadastro do caminhão**, mas a descarga grava um
**snapshot**. Recalibrar depois não reescreve descargas antigas.

**R22.** Antiburros ao confirmar:
- **Erro duro (bloqueia):** peso bruto menor que a tara.
- **Aviso (segundo toque libera):** peso líquido diverge mais de **30%** do
  esperado (`litros declarados × 0,9`). `[CONFIRMADO — 30% está bom]`

**R23.** Descarga sem nenhuma coleta na carga dispara aviso.

**R24.** A foto do papel da balança é **opcional**.

## 5. Fotos e GPS

**R25.** Foto **obrigatória** em despesa e abastecimento. Na coleta é
configurável por motorista. Na descarga é opcional.

**R26.** A foto é comprimida no celular para **800px / JPEG q60 / ~100KB**
antes de subir. A rede rural não aguenta mais.

**R27.** O **GPS é capturado em todo evento**, silenciosamente. A interface
**nunca** mostra, nem confirma, nem indica.

**R28.** **Os motoristas não sabem, e não precisam saber.** `[CONFIRMADO]`

**R29.** Na coleta o GPS é capturado **ao abrir a tela**, não ao salvar, com
timeout de 10 segundos.

---

# PARTE III — O DINHEIRO DO MOTORISTA

## 6. A fórmula exata

**R30.** O saldo na mão do motorista é, literalmente:

```
  saldo do último acerto (carry)
+ adiantamentos ACEITOS depois do corte
− coletas depois do corte, EXCETO as pagas pela sede
− despesas depois do corte
− abastecimentos depois do corte, EXCETO os que ele "assinou a nota"
= saldo atual
```
`[verificado na função saldos_motoristas() em produção]`

**R31.** Adiantamento **pendente não conta**. Só entra quando ele **aceita no
aplicativo** — e o aceite captura GPS.

**R32.** **Os motoristas ainda não usam o aceite, mas vão passar a usar.** O
gestor confere no painel. `[CONFIRMADO]`

**R33.** O motorista pode **pular** a tela de aceite. Pular muitas vezes vira
alerta.

## 7. O acerto

**R34.** **Não há cadência fixa.** O ciclo pode ser: adianta R$ 5.000, ele
aceita e usa; manda mais R$ 5.000, aceita e usa; manda mais R$ 5.000 — e só
então acerta. **Quando for a hora, será.** `[CONFIRMADO]`

**R35.** O acerto **fecha um ciclo** e cria um ponto de corte. Nada antes dele
volta a ser contado.

**R36.** O saldo se divide em três: **devolvido** (dinheiro vivo), **vale**
(desconta do salário) e **saldo** (carrega pro próximo ciclo).

**R37.** **O saldo pode ser negativo** — ele gastou do próprio bolso e **a
empresa deve a ele**. Os três campos invertem: pagar agora, somar no salário,
levar pro próximo ciclo.

## 8. Quem paga o quê

**R38.** Por padrão o motorista paga o óleo **do próprio bolso**, com o
dinheiro adiantado.

**R39.** **Coleta paga pela sede** — o Jean pagou direto. Vira conta a pagar
da empresa e **não desconta do motorista**.

**R40.** No abastecimento, o motorista escolhe **"PAGUEI AGORA"** ou
**"ASSINEI A NOTA"**. Na segunda, o posto cobra da empresa depois — vira conta
a pagar e **não sai do bolso dele**.

**R41.** Antiburro de km no abastecimento:
- **Erro duro:** km menor que o km inicial da carga.
- **Aviso:** km menor que o último registro daquele caminhão.
- **Aviso:** salto maior que **1.500 km**. `[CONFIRMADO — folga suficiente]`

---

# PARTE IV — O ESTOQUE

## 9. A matemática

**R42.** O estado do estoque é o par **(quilos, valor em reais)**. O custo
médio é `valor ÷ quilos`.

**R43.** **Entrada** soma kg e custo:
- **Descarga** → entra fino. Custo = **soma do `valor_pago` das coletas
  daquela carga**.
- **Compra direta** → entra fino ou grosso, custo = valor pago.

**R44.** **Saída** (venda) tira kg e tira `kg × custo médio daquele instante`.

**R45.** É **ponderado móvel** — a ordem importa. Não é soma, é sequência.

**R46.** **O custo do óleo NÃO inclui o custo de buscá-lo, e isso é
proposital.** Combustível, despesas e comissão da carga **não entram** no
custo por kg. Eles aparecem no DRE como **abastecimento geral do mês** e
**despesas gerais do mês**.
`[CONFIRMADO — decisão do Evaner. Os dados por motorista e por caminhão
existem e permitem calcular médias, mas por ora o DRE trata como bloco]`

## 10. O inventário

**R47.** O inventário **não é conserto de erro — é rotina**, a cada **2 a 3
meses**.

**R48.** Você conta o tanque e digita. O sistema corrige a **quantidade**,
**preserva o custo médio**, e registra a diferença como **perda ou sobra em
reais**.

**R49.** A **primeira contagem** ("abertura") é a única vez em que você
**informa o custo por kg**. Sem isso o custo médio nasce zero e contamina
tudo para frente.

**R50.** O inventário vale para o **fim do dia escolhido**.

**R51.** **A diferença esperada ainda não é conhecida** — a estimativa é que
possa subir ou descer na ordem de **10.000 kg**. Existe perda de **borra de
fundo de tanque**, mas é **impossível estimar frequência e quantia** — e
mesmo que fosse possível, seria muito trabalho para pouco resultado.
`[CONFIRMADO — é por isso que o sistema não tenta medir perda, só conta o que
tem]`

---

# PARTE V — A VENDA

**R52.** A venda é **um momento só**, com o peso da balança.

**R53.** Registra: comprador, data, peso total, quanto era fino e quanto era
grosso, preço por kg, valor total, número da nota (texto livre), foto do
ticket.

**R54.** **O preço é negociado por carga. Negociação livre.** Não há tabela
nem contrato de preço fixo. `[CONFIRMADO]`

**R55.** O **caminhão é opcional**. Nulo significa **o comprador veio
buscar**.

**R56.** Emitir nota fiscal está **fora do sistema** — guarda só o número.

**R57.** **Os custos de viagem não são atrelados a uma venda específica.**
Existe a categoria "Custos de viagem" como **gasto geral**, não por entrega.
`[CONFIRMADO — o campo venda_id existe em despesa e abastecimento mas
nenhuma tela usa, e está certo assim]`

## 11. A conta corrente do comprador

**R58.** Não existe "esta venda foi paga". Existe **saldo**:
`total vendido − total recebido`.

**R59.** O saldo pode ficar **negativo** (ele adiantou ou pagou a mais).

**R60.** **Cheque devolvido não conta como recebimento** — a dívida **renasce
sozinha**.

**R61.** O vínculo recebimento↔venda é **opcional**; o saldo não depende dele.

**R62.** **Não existe prazo combinado com comprador, e não existe alerta de
comprador devendo.** A conta corrente supre a necessidade. `[CONFIRMADO]`

---

# PARTE VI — O CHEQUE

**R63.** **Cheque na mão não é dinheiro na conta.** Quando o comprador
entrega, **a dívida dele quita** — mas o dinheiro está no papel.

**R64.** Existem **três destinos possíveis, e só três**:

```
  ┌─► DEPOSITADO ─► COMPENSADO      vira dinheiro na conta
  │
  ├─► REPASSADO                     paga uma despesa da empresa
  │
  └─► DEVOLVIDO                     a dívida do comprador RENASCE
```

**R65.** **1 cheque = 1 recebimento, sempre.** Nunca agrupado. Se um voltar,
some só o valor dele. `[UNIQUE no banco]`

**R66.** **Repassar cheque é frequente.** Postos, fornecedores, clientes.
`[CONFIRMADO]`

**R67.** ⚠️ **REGRA NOVA — repassar exige despesa.** Não é possível repassar
um cheque sem que exista o gasto que ele pagou. Todo repasse tem motivo, e o
motivo é um lançamento.
`[CONFIRMADO — regra do Evaner]` · `[A CORRIGIR — hoje o painel de cheques
tem um botão "Repassar" solto que só grava um texto livre de "pra quem foi",
sem criar despesa nenhuma. Ver Parte XII, item 5]`

**R68.** **Devolvido faz a dívida do comprador voltar automaticamente.** Se já
tinha sido repassado, o trâmite passa a ser direto entre o emitente e quem
recebeu — a empresa sai do meio.

**R69.** **Reapresentação de cheque é automática no banco** e **não precisa
ser tratada no sistema**. `[CONFIRMADO]`

**R70.** O dinheiro só entra na conta bancária **quando compensa** — e é aí
que o sistema pergunta em qual conta caiu.

---

# PARTE VII — A FROTA

**R71.** Cadastra **caminhão e carro**. O carro entra porque o custo é da
operação do mesmo jeito.

**R72.** Só caminhão tem tara e capacidade. Carro não faz carga.

**R73.** **O OLUC é carga perigosa** e o caminhão é de produto perigoso.
`[CONFIRMADO]` — é por isso que CIPP, CIV e MOPP estão na lista de documentos.

**R74.** **Pneu é manutenção comum** — sem rastreio por carcaça, sem sulco.

**R75.** **Troca de óleo é o único tipo que marca o km da próxima** e gera
alerta por quilometragem.

**R76.** O **km atual** de um caminhão não é campo — é o **maior valor** entre
os fins de carga e os abastecimentos.

**R77.** Manutenção pode ser **à vista** ou **a prazo**. A prazo vira conta a
pagar.

**R78.** Documentos têm dois donos possíveis (caminhão **ou** motorista) e o
banco garante **exatamente um**.

**R79.** Lista fixa. Caminhão: IPVA, Licenciamento, Seguro, CIV, CIPP,
Cronotacógrafo, ANTT/RNTRC. Motorista: CNH, exame toxicológico, MOPP,
curso/reciclagem. Mais "Outro" nos dois.

**R80.** Aviso configurável por documento, **padrão 30 dias**.

**R81.** Documento **com valor** vira **conta prevista** no vencimento.

**R82.** 🔜 **Backlog:** kit de emergência e um **checklist ao iniciar
carga**. Decidido: fica para depois. `[CONFIRMADO]`

---

# PARTE VIII — O FINANCEIRO

## 12. O caixa

**R83.** **Dinheiro não aparece nem some.** Toda saída sai de uma conta, toda
entrada entra em uma.

**R84.** Hoje são duas contas — **espécie** e **Banco do Brasil** — mas o
sistema **precisa aceitar contas novas** quando surgirem. `[CONFIRMADO]`

**R85.** Cada conta tem **saldo de partida e data de corte**. Movimento
anterior à data não é somado.

**R86.** **Saque e depósito são transferência**, não despesa. O mesmo dinheiro
mudando de bolso. Não entra no resultado.

**R87.** ⚠️ **REGRA NOVA — a tela de caixa mostra o patrimônio inteiro**, e
não só as contas bancárias:

```
Em espécie                          R$
Na conta [banco]                    R$
Em mãos de motoristas               R$
Valor em estoque                    R$   (preço de referência × litros)
Óleo nos caminhões                  R$   (preço de referência × litros)
Cheques em aberto                   R$
─────────────────────────────────────────
TOTAL                               R$
```

O **preço de referência** é um valor fixo aproximado (ex.: **R$ 2,80 por
litro**), não o custo médio. É "quanto isso vale", não "quanto custou".
`[CONFIRMADO — regra do Evaner]` · `[A CORRIGIR — hoje a tela só mostra as
contas e o dinheiro dos motoristas. Ver Parte XII, item 4]`

**R88.** Entra no caixa: recebimento, transferência recebida, acerto
devolvido, **cheque compensado**.
Sai: conta paga, adiantamento (exceto cancelado), transferência enviada.

**R89.** O **dinheiro na mão do motorista** aparece como linha, mas **não é
conta financeira** — é lido da função que já calcula o saldo dele.

## 13. O DRE

**R90.** **Regime de caixa dos dois lados — despesa E receita.** O gasto pesa
no dia em que saiu; a receita pesa no dia em que **entrou**.
`[CONFIRMADO]` · `[A CORRIGIR — hoje a receita entra pela data da VENDA. Ver
Parte XII, item 3]`

**R91.** O Evaner sabe e aceita a consequência: **um mês bom pode aparecer
como mês ruim** no DRE, se a venda foi feita e o dinheiro não entrou. E
tudo bem — mais para frente um mês ruim vira um mês bom. **A ideia é manter o
fluxo de caixa alinhado**; com o tempo isso se paga e o fluxo se mantém, se a
empresa tiver caixa. `[CONFIRMADO]`

**R92.** A regra anti-dobra: **conta a pagar conta quando é paga; lançamento
operacional só conta se não virou conta.**

**R93.** A estrutura:

```
RECEITA (venda de óleo, pelo RECEBIMENTO)
(−) CUSTO DO ÓLEO (óleo do motorista, óleo da sede, comissão)
= MARGEM BRUTA
(−) OPERACIONAIS (combustível, troca de óleo, pneus, manutenção,
                  lavagem, equipamento, viagem, benfeitorias)
(−) FIXAS (transferência a sócio, salários, advogado, contabilidade,
           sistema, luz/internet/telefone, seguro, IPVA, taxas, banco)
= RESULTADO OPERACIONAL
(−) FINANCEIRO (empréstimos, dívidas PF)
(−) IMPOSTOS
= RESULTADO
```

**R94.** Linhas **automáticas** (o sistema calcula da origem e não deixa
lançar na mão): venda, óleo do motorista, óleo da sede, combustível, troca de
óleo, pneus, manutenção.

**R95.** Linhas **lançadas** (você digita do extrato): todo o resto.

**R96.** Despesa lançada pelo motorista em campo cai em **"Custos de viagem"**.

**R97.** **A separação ASSIS / JJHS é tratada fora do software.** Eles sabem
lidar. Não é problema do sistema. `[CONFIRMADO]`

## 14. Contas a pagar

**R98.** Três estados: **prevista** (valor estimado), **a pagar** (valor
confirmado), **paga**. Mais **cancelada**.

**R99.** Prevista **não é dívida** e **não entra no DRE** — é previsão de
fluxo.

**R100.** "Confirmar valor" transforma prevista em a pagar, deixando editar
valor e vencimento. É quando o boleto chega.

**R101.** Parcelamento gera **N linhas**, uma por mês, cada uma se pagando
sozinha. Sem perder centavo.

**R102.** **Despesa recorrente** gera conta automaticamente, **mensal** ou
**anual**. Marcada como **aproximada**, nasce como prevista.

**R103.** Gerar o mês duas vezes **não duplica**.

**R104.** Pagar com **cheque da carteira** tira o cheque da carteira, marca
como repassado, e **não sai de conta nenhuma**.

## 15. Remuneração

**R105.** Todo valor de remuneração tem **vigência**: vale **a partir de** uma
data. Mudar hoje **não recalcula o passado**.

**R106.** Vale para **salário, comissão, bônus e transferência a sócio**.

**R107.** A comissão é **proporcional**: `litros ÷ base × valor`. 100 L numa
base de 200 pagam **metade**.

**R108.** ⚠️ **A base da comissão são os LITROS DA DESCARGA** — os litros que
o motorista lançou ao descarregar, derivados do peso da balança. **Não** a
soma dos litros declarados nas coletas.
`[CONFIRMADO — regra do Evaner]` · `[A CORRIGIR — hoje calculo sobre
coletas.litros. Ver Parte XII, item 2]`

**R109.** É **por motorista**, conforme a coleta de cada um. Como uma carga
tem um motorista só, a descarga daquela carga é dele.

**R110.** **Paga junto com o salário, no pagamento mensal.** `[CONFIRMADO]`

**R111.** Cada coleta usa a regra **do dia dela**. Mudança no meio do mês
parte a conta na data certa.

**R112.** Existe regra **geral da empresa** e regra **específica de uma
pessoa**. A específica vence.

**R113.** **Comissão calculada não é comissão paga.** Só entra no DRE quando
o pagamento é lançado.

**R114.** Compra direta **não gera comissão** — o motorista não trabalhou
nisso.

---

# PARTE IX — O QUE O SISTEMA CONSIDERA ANORMAL

| # | Alerta | Dispara quando |
|---|---|---|
| **R115** | Carga aberta e parada | **15 dias** sem lançamento |
| **R116** | Caminhão acima da capacidade | litros > capacidade cadastrada |
| **R117** | Peso da balança diferente | descarga fora de ±30% |
| **R118** | Umidade não lançada | **7 dias** após a descarga |
| **R119** | Motorista não confirma | **10** aceites pulados |
| **R120** | Dinheiro parado na mão | saldo > **R$ 3.000** e **15 dias** sem gastar `[MUDOU de 7 para 15 dias]` |
| **R121** | Coletas sem foto | **3** na semana |
| **R122** | Coletas sem localização | **3** na semana |
| **R123** | Coleta acima do preço | fora da curva estatística |
| **R124** | Coleta com número estranho | valor implausível |
| **R125** | Documento vencendo | dentro do aviso (padrão 30 dias) |
| **R126** | Passou do km da troca | km atual > próxima marcada |
| **R127** | Cheque vencido na carteira | passou do "bom para" |
| **R128** | Estoque negativo | saldo < 0 |

**R129.** O alerta de preço fora da curva **só liga com base estatística**:
mínimo **30 coletas** ou **60 dias** de histórico. Alerta ruidoso ensina a
ignorar alerta.

**R130.** ❌ **Removidos por decisão do Evaner:** "cheque bom para esta
semana" e "cheque devolvido sem resolver".
`[A CORRIGIR — ainda estão no código. Ver Parte XII, item 6]`

---

# PARTE X — QUEM É QUEM

| Pessoa | Papel |
|---|---|
| **Jean** | Gestor. Painel no computador. Compra direta, vendas, dinheiro. |
| **Evaner** | Irmão do Jean. Construiu o sistema. Também administra. |
| **Valdecir** | "Faz-tudo" da empresa. Sem caminhão, recebe transferência. |
| **Luis** (apelido **"Fumaça"**) | Motorista |
| **Lucimar** | Motorista |
| **Lucinei** (apelido **"Nei"**) | Motorista |
| **Suzana** | Cadastrada como motorista. Papel não documentado. |

**R131.** A regra de ouro do app do motorista:
> **Se exige mais de 3 toques e um pensamento, está complexo demais.**

---

# PARTE XI — ONDE A OPERAÇÃO ESTÁ (19/08/2026)

Foto, não regra — isto muda rápido.

| | |
|---|---|
| Coletas registradas | ~121 |
| Cargas | **0** — o módulo está pronto, nenhum motorista usou |
| Estoque, vendas, cheques | zerados — nunca rodaram com dado real |
| Frota | 1 caminhão de teste (AAA-0000) |
| Contas financeiras | nenhuma cadastrada |
| Vigências de remuneração | nenhuma — o valor da comissão ainda não foi definido |

**O sistema está à frente da operação.** Quase tudo construído, quase nada
usado com dado de verdade. As regras acima são hipóteses bem testadas em
conversa, não em uso — o estoque, a conta corrente e o ciclo do cheque só vão
revelar se estão certos quando passar dinheiro de verdade por eles.

---

# PARTE XII — O QUE O SOFTWARE PRECISA MUDAR

Cada item saiu da conferência. Nenhum é opinião minha.

### 1. Coleta com valor zero
**Regra:** R2 — óleo doado lança com valor zero.
**Hoje:** o banco tem `check (valor_pago > 0)` e **recusa**.
**Correção:** migration mudando para `>= 0`, e o app deixando salvar zero.
**Tamanho:** pequeno.

### 2. Comissão sobre os litros da descarga
**Regra:** R108 — a base são os litros lançados ao descarregar (derivados do
peso da balança), não a soma das coletas.
**Hoje:** calculo sobre `coletas.litros`.
**Correção:** `calcularComissao()` passa a ler `descargas.litros_estimados`,
atribuindo à carga (e portanto ao motorista dela). A vigência continua sendo
a do dia — mas agora o dia é o **da descarga**.
**Tamanho:** médio. Muda quanto cada motorista recebe.

### 3. Receita do DRE por recebimento
**Regra:** R90 — regime de caixa dos dois lados.
**Hoje:** a receita entra pela **data da venda**.
**Correção:** a linha de receita passa a somar **recebimentos** no período, e
não vendas. Cheque entra quando **compensa**.
**Tamanho:** pequeno no código, grande no significado.

### 4. Painel de caixa com o patrimônio inteiro
**Regra:** R87 — seis linhas mais o total.
**Hoje:** só contas + dinheiro dos motoristas.
**Falta:** valor do estoque, óleo nos caminhões (coletas de cargas ainda não
descarregadas), cheques em aberto, e um **preço de referência configurável**
(ex.: R$ 2,80/L).
**Tamanho:** médio. Precisa de um lugar pra guardar o preço de referência.

### 5. Repassar cheque exige despesa
**Regra:** R67 — todo repasse tem um motivo, e o motivo é um lançamento.
**Hoje:** existe um botão "Repassar" solto que só grava texto livre.
**Correção:** ver o debate na Parte XIII.
**Tamanho:** médio.

### 6. Alertas
**Regra:** R120 e R130.
**Correção:** remover "cheque bom para esta semana" e "cheque devolvido sem
resolver"; mudar "dinheiro parado" de 7 para **15 dias**.
**Tamanho:** pequeno.

### 7. Backlog declarado
- Checklist ao iniciar carga (R82)
- Kit de emergência (R82)
- Umidade descontando algo (R11), quando existir a máquina

---

# PARTE XIII — O DEBATE DO CHEQUE REPASSADO

O Evaner pediu para eu debater a correção. Aqui está.

## O problema, em números

Hoje um cheque de R$ 3.000 repassado para o posto:
- **sai** do patrimônio (era um valor a receber, deixou de ser)
- **não** aparece no caixa (correto — não passou por conta bancária)
- **não** aparece no DRE (**errado** — a empresa gastou R$ 3.000 e o
  relatório não sabe)

O texto livre "pra quem foi" não é despesa: não tem categoria, não entra em
grupo do DRE, não soma com nada.

## O caminho certo já existe

Pagar uma **conta a pagar com cheque** já faz tudo certo:
- a conta fica **paga**, com categoria e valor → **entra no DRE**
- o cheque sai da carteira e vira **repassado**
- `cheque_id` amarra os dois, então dá para auditar

O buraco não é falta de mecanismo — é ter **dois caminhos**, e um deles ser
solto.

## A correção, em duas partes

**Parte 1 — fechar o buraco.**
Remover o botão "Repassar" do painel de cheques. **Repassar deixa de ser uma
ação do cheque** e passa a ser **consequência de pagar algo com ele**.

**Parte 2 — abrir o caminho rápido.**
Hoje, para pagar com cheque a conta precisa existir antes. Se o Jean chega no
posto e paga na hora, teria que criar a conta e depois pagá-la — dois passos
para um ato só.

Então a tela de **Lançamentos** ganha a opção **"paguei com cheque"**:
escolhe o cheque da carteira → o lançamento nasce **já pago**, com categoria e
pessoa → o cheque vira **repassado**, amarrado a ele. Um clique.

E o lançamento fica **sem conta financeira** — porque o dinheiro não saiu de
conta nenhuma, saiu do papel.

## O detalhe de regime que isso resolve

Sob caixa, **quando o gasto pago com cheque conta?**

O dinheiro sai da conta do **emitente** quando o posto depositar — data que
você não controla e nem fica sabendo. Mas **do seu ponto de vista você se
desfez do ativo no dia do repasse**.

Então: **conta no dia do repasse**. É coerente com o resto (o cheque recebido
também só vira caixa quando compensa, do seu lado).

## O que eu recomendo

Fazer as duas partes juntas. Só a parte 1 tornaria o repasse burocrático e
você acabaria não usando; só a parte 2 deixaria o buraco aberto.

**Uma pergunta que sobra:** e o cheque repassado que **volta**? Hoje o
software permite (repassado → devolvido) e a regra R68 diz que o trâmite
passa a ser direto entre o emitente e quem recebeu. Mas a **despesa que ele
pagou continua paga** — e provavelmente deveria voltar a ser dívida sua com o
posto. Isso precisa de decisão: quando um cheque repassado volta, a conta que
ele pagou volta a ser "a pagar"?

---

*Documento revisado em 19/08/2026 com a conferência do Evaner. Cada regra
marcada `[A CORRIGIR]` é trabalho pendente listado na Parte XII.*
