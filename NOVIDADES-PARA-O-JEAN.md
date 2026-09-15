# O que mudou no sistema — 15 de setembro

> Resumo curto pro Jean. O manual completo continua sendo o
> `MANUAL-DO-SOFTWARE.md`; aqui está só o que é novo.

Tudo que mudou é sobre **cheque e pagamento**. Em uma frase: o sistema passou
a aceitar as coisas do jeito que elas acontecem de verdade — vários cheques,
várias contas, várias formas de pagar ao mesmo tempo.

---

## 1. Cheques: depositar em maço

**Antes:** um cheque por vez. Dez cheques, dez cliques.

**Agora:** na tela de Cheques tem o botão **"Montar maço"**. Ele lista tudo
que está na carteira ordenado pela data do *bom para*, você marca os que vão
pro banco, escolhe em qual banco, e manda todos de uma vez.

Tem um atalho: **"Marcar os X vencidos"** já seleciona os que passaram da
data.

> **Se algum cheque não puder ir, nada vai.** É de propósito. É melhor você
> tentar de novo do que metade ir e você não saber qual.

---

## 2. ⚠️ O card novo que você precisa olhar

Na tela de Cheques apareceu um quarto quadradinho: **"Depositado,
aguardando"**.

Ele mostra o dinheiro que **já foi pro banco mas você ainda não confirmou que
caiu**. Enquanto está ali, esse valor **não conta no seu caixa**.

**Por que isso importa:** se você esquecer de confirmar, aquele dinheiro fica
fora do saldo do sistema **pra sempre**, e o app vai mostrar menos dinheiro do
que você realmente tem — sem avisar.

**O que fazer:** de vez em quando olhe esse número. Se ele estiver parado há
muitos dias, é porque falta confirmar algum.

**Como confirmar:** logo abaixo aparecem os maços que você depositou, assim:

```
Depositado no Bradesco em 15/09 — 10 cheques — R$ 36.841,69
   ☑ 748 nº 1435 · R$ 2.950,00
   ☑ 756 nº 112  · R$ 3.297,00
   ☐ 041 nº 548  · R$ 5.000,00   ← esse não caiu
```

Você abre o extrato do banco, **tica o que caiu** e confirma. O que não caiu
você desmarca e resolve com o botão **"Voltou"**.

---

## 3. Pagar várias contas de uma vez

Na tela de **Contas a pagar** tem o botão **"Montar pagamento"**.

Você marca quantas contas quiser, marca quantos cheques quiser, e acrescenta
quantos valores em dinheiro/PIX/depósito precisar. Os dois casos funcionam:

- **3 contas de R$ 1.000 no total, pagas com um cheque de R$ 1.000**
- **1 conta de R$ 1.000, paga com um cheque de 600 e outro de 400**

A tela mostra três números o tempo todo: **quanto você deve · quanto está
pagando · o que sobra ou falta**.

> Se uma conta acabar sendo paga por dois meios diferentes, ela continua
> aparecendo como **uma linha só** na lista, com o valor cheio. Os pedaços
> aparecem embaixo, pequenos.

---

## 4. ⚠️ O sistema vai te perguntar coisas que antes não perguntava

Quando você pagar uma conta com um cheque que **não tem o valor exato da
conta**, o sistema agora para e pergunta.

**Cheque maior que a conta** → ele pergunta **quanto voltou de troco e em qual
conta esse dinheiro entrou**. Não dá pra pular.

**Cheque menor que a conta** → ele pergunta o que aconteceu, com dois botões:
- **"Ainda devo esse resto"** → o que falta vira uma conta nova, em aberto
- **"O fornecedor abateu"** → a conta passa a valer o cheque e acabou

**Por que ele pergunta:** antes ele aceitava calado, e o dinheiro da diferença
sumia do sistema. Já aconteceu de verdade.

> **Se você não tiver certeza da resposta, não chute — feche a tela e me
> pergunte.** Uma resposta errada aqui é difícil de achar depois.

---

## 5. Fechamento do posto: pode misturar tudo

Antes só cabia **um** valor em dinheiro no acerto. Agora você acrescenta
quantas linhas quiser.

Então o caso real funciona: **4 notas pagas com 3 cheques + R$ 200 de PIX +
R$ 50 em espécie**.

Você também pode continuar escolhendo **só algumas** das notas do posto —
paga 4 de 5 e deixa uma pra depois.

---

## 6. ⚠️ Se um cheque voltar do banco

Clique em **"Voltou"** normalmente. O sistema faz duas coisas sozinho:

- a dívida do comprador que te deu o cheque **volta a existir**;
- você **volta a dever** o valor do papel pra quem recebeu ele.

**A diferença que você vai notar:** se aquele cheque tinha pagado um **acerto
do posto** (várias notinhas juntas), as notinhas **continuam pagas** e aparece
uma **dívida nova** do valor do cheque, no saldo daquele posto. É assim mesmo
— o que você deve é o cheque, não as notinhas de novo.

> **Me avise quando isso acontecer.** Não existe botão de "desfazer" se
> clicar errado, e eu resolvo com você em dois minutos.

---

## 7. Alerta de cheque vencido: era um monte, virou um só

No painel, os alertas de "cheque passou do bom para" apareciam um pra cada
cheque — chegou a ter 18 linhas iguais. Agora é **uma linha só** com a
quantidade e o total, e ela leva direto pro "Montar maço".

---

## O que me mandar, pra eu melhorar o sistema

Não precisa explicar nada técnico. O que ajuda de verdade:

| Quando | O que mandar |
|---|---|
| **O sistema recusou** e você não entendeu a mensagem | Print da tela inteira. A mensagem tem o motivo escrito. |
| **Você teve que fazer a mesma coisa duas vezes** | Me conta o que era. Isso quase sempre é defeito meu, não seu. |
| **Um número parece errado** | Print + o que você esperava ver. Não precisa descobrir o porquê. |
| **Algo demorou demais ou travou** | Me diz o dia, mais ou menos a hora, e em qual tela. |
| **Um cheque voltou do banco** | Me avise sempre, mesmo que tudo tenha parecido certo. |

**A coisa mais útil de todas:** se em algum momento você pensar *"isso aqui
está mais difícil do que devia"*, me fala. Não precisa ter certeza nem
sugestão de conserto — a sensação já é a informação.

---

## Em resumo, o que vigiar nas próximas semanas

1. O card **"Depositado, aguardando"** — ele tem que esvaziar conforme os
   cheques compensam.
2. Conta paga com **dois meios** — confira se aparece como **uma linha** com
   o valor cheio.
3. Quando o sistema **perguntar sobre um cheque que não bate** — responda com
   calma, e me chame se tiver dúvida.
