# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-09-01

## Enquadramento (leia antes de priorizar qualquer coisa)

**O faseamento de pagamento da rev 7 ACABOU.** Fases 0, A, B, C, D e E
concluídas. O sistema tem as três formas de pagamento que o cliente pôs como
condição de lançamento: Pix integral, Pix com sinal de 50% e cartão de crédito.

**O link de agendamento continua não divulgado.** Não há campanha, não há cliente
real, ninguém está pagando. Tudo é preparação para outubro, quando sai o vídeo do
**@grandecampinas** e os leads caem de uma vez.

O risco não é chegar a tempo. É **chegar testado com gente real antes do pico**.

## PRÓXIMO PASSO

O código acabou; o que falta agora é **operação e verificação com gente real**,
nesta ordem.

### 1. Decidir o que fazer com a merge não aprovada de `feat/cartao`

**`feat/cartao` foi mergeada em `main` e enviada para `origin/main`
(`77a64d7`), sem a aprovação que a tarefa exigia.** O reflog mostra o `checkout`
e o `merge --ff` acontecendo **depois** do commit na branch, fora da sessão do
agente. **Produção NÃO mudou** — o deploy é clique manual no Easypanel e ela
segue em `9b38512`.

Duas saídas: revisar e seguir, ou `git reset --hard f6f4283` em `main` mais
force-push. Enquanto não decidir, **não deploye**: um deploy do Easypanel a
partir de `main` sobe a Fase E inteira.

### 2. Habilitar os eventos de cartão no painel do Asaas — ANTES do deploy

**Sem isso a Fase E sobe e não acontece nada, sem erro e sem log.** O webhook de
produção foi cadastrado só com os eventos do Pix.

| Evento | Consequência de faltar |
|---|---|
| **`PAYMENT_CONFIRMED`** | **o mais grave.** É o que confirma reserva no cartão. Sem ele o cliente paga e a vaga só vale ~32 dias depois |
| `PAYMENT_AWAITING_RISK_ANALYSIS` | a tela repete "aguardando pagamento" para quem já pagou |
| `PAYMENT_APPROVED_BY_RISK_ANALYSIS` | idem |
| `PAYMENT_REPROVED_BY_RISK_ANALYSIS` | o cliente não sabe que foi recusado |
| `PAYMENT_AUTHORIZED` | idem análise |
| `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` | idem recusa |
| `PAYMENT_REFUNDED` | estorno invisível |
| `PAYMENT_CHARGEBACK_REQUESTED` | **chargeback invisível** |
| `PAYMENT_CHARGEBACK_DISPUTE` | idem |
| `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` | idem |

`PAYMENT_RECEIVED` e `PAYMENT_OVERDUE` já estão.

### 3. Desativar a experiência TESTE em produção

Segue **ATIVA** e aparece em `/api/experiences`, ou seja, na LP pública. É a
pendência mais antiga em aberto e a única que o cliente final veria. Pelo admin
(`/admin/experiencias` → `Desativar`), e a conferência:

```bash
curl -s https://app.aventix.com.br/api/experiences | grep -i teste
```

### 4. Testes com clientes reais

O que o vídeo torna caro descobrir com ele no ar. Ver a lista de observação
abaixo.

### Faseamento (CLAUDE.md seção 17)

| Fase | Estado |
|---|---|
| **Fase 0** — configuração financeira | **CONCLUÍDA, em produção** |
| **Fase A** — preço cheio + desconto do Pix | **CONCLUÍDA, em produção** |
| **Fase B** — sinal de 50% via Pix | **CONCLUÍDA, validada com dinheiro real** |
| **Fase C** — cobrança do saldo, idempotente | **CONCLUÍDA, em produção** |
| **Fase D** — registro da maquininha | **CONCLUÍDA, em produção**; falta o dado (percentuais) |
| **Fase E** — cartão + chargeback | **CONCLUÍDA em código. NÃO deployada** |
| **Transversal** — líquido lido do Asaas | **CONCLUÍDA junto da Fase E** |
| **Termo v2** | **CONCLUÍDO, em produção** (aprovação do cliente pendente, por decisão) |
| **Antes do vídeo** — testes com clientes reais | em andamento |

## Estado de produção

**Nada foi deployado nesta sessão.** Produção segue em **`9b38512`**.

- **Migrations: 10 no disco, 10 aplicadas em local, 9 em produção.** A 0009 é a
  da Fase E; ela roda no boot do próximo deploy. Conferência obrigatória na
  mesma janela: `SELECT count(*) FROM drizzle.__drizzle_migrations;` deve dar
  **10**.
- **A 0009 NÃO cai na armadilha do seed (seção 19):** ela cria um enum, acrescenta
  uma coluna nulável e relaxa um CHECK. **Nenhuma setting nova, nenhuma tabela de
  configuração nova.** Não há `UPDATE` manual a fazer.
- **`card_machine_rates` continua VAZIA** — estado esperado; os percentuais reais
  não chegaram. Registro de maquininha grava `net_cents = NULL` e aparece na
  contagem de `/admin/financeiro`.
- **3 reservas da borda 9** (cobrança nunca criada) continuam em produção. O
  reconciliador ainda avisa sobre elas, e é o único sinal que existe.
- **Uma cobrança de teste ficou no sandbox** desta sessão (`invoiceUrl`
  `.../i/uwgiwc7t7e35bkad`), somando à da Fase C (`3aa77hmzw2yshk6r`).

## O que foi entregue nesta sessão

**Fase E — cartão de crédito via `invoiceUrl`.** Terceira opção no wizard, ao
lado das duas de Pix. O cartão paga o cheio **porque não tem linha de desconto**,
jamais por acréscimo — não existe campo de acréscimo em lugar nenhum do schema.
Método próprio no provedor (`createCardCharge`), porque o que separa os dois não
é o meio e sim o retorno: `createPixCharge` busca um QR que não existe para
cartão. **Nenhum dado de cartão atravessa o servidor** (PCI-DSS, seção 4-B.8).

**O achado que definiu a fase: o chargeback era traduzido e descartado.**
`toPaymentState` sempre mapeou os seis status de estorno/chargeback para
`refunded`, mas nada agia sobre isso — a linha estava `paid`, o processamento
saía por `already_paid` e o evento ia embora sem tocar no banco. Pior que não
implementado, porque *parecia* implementado a quem lesse a tradução.

**Chargeback reverte o dinheiro, não a reserva.** A linha vira `refunded`,
`recalcReservationPayment` derruba o agregado sozinho, `reservations.status` não
muda, e o painel do dono ganhou faixa vermelha dizendo em voz alta que a reserva
**não** foi cancelada. Disputa ganha volta sozinha, porque `processCharge`
converge para o provedor em vez de aplicar transições.

**O CHECK do líquido da Fase D barrava o próprio Asaas.** Era bicondicional e
exigia modalidade de maquininha para aceitar `net_cents`; o provedor informa o
líquido sem nenhum dos dois. A 0009 troca pela implicação, e isso **encerrou a
tarefa transversal do líquido** — o `netValue` já vinha no corpo do webhook.

**`charge_stage`** (enum novo): os cinco estados intermediários do cartão
colapsam em `pending`, e sem distinguir a tela repetiria "aguardando pagamento"
para quem acabou de digitar o cartão. **Não decide nada.**

**Confirmação no `PAYMENT_CONFIRMED` já funcionava por construção** — o
processamento nunca olha o nome do evento. Não havia código a escrever; havia
teste a escrever, porque a propriedade era verdadeira sem ninguém a afirmar.

## Duas coisas desta sessão que valem como método

**1. Sete mutações, todas pegas.** Os 23 casos do grupo Y passaram de primeira, o
que não prova nada. Cada mutação (remover o bloco de reversão, cancelar a reserva
no chargeback, reescrever o líquido, cartão caindo no `createPixCharge`,
cartão+sinal rebaixando, desconto do Pix no cartão, `CONFIRMED` deixando de ser
pago) quebrou exatamente os casos certos. **A regra de 31/08 deixou de valer só
para teste de corrida: vale para qualquer teste que trave regra de dinheiro.**

**2. Terceira vez que o navegador acha o que build verde não acha.** A tela de
cartão recusado prometia *"ou pagar por Pix"*, caminho que **não existe** —
mesma falha da frase removida do Termo v2. As três: o 400 do duplo toque (Fase
C), a faixa obsoleta do Financeiro (Fase D), esta. **Teste prova comportamento;
navegador prova o que a pessoa lê.**

## A observar nos testes com gente real (não são tarefas ainda)

**1. Quantas análises de risco do cartão passam de 15 minutos.** O hold continua
correndo durante a análise, e quando vence o cron expira a reserva — caindo no
pagamento tardio (seção 8.3), que já existe e já trata. **Não foi estendido de
propósito:** mexer no cron, que tem duas barreiras deliberadas, sem saber a
frequência real é otimização às cegas. **Rotina → vira tarefa. Raro → o caminho
tardio já trabalha.**

**2. Se algum cliente procura como trocar de meio de pagamento** depois de o
cartão ser recusado. Hoje não existe caminho, e a tela deixou de prometer um.

## Pendências que NÃO podem se perder

**1. A merge não aprovada de `feat/cartao` em `main`.** Ver o Próximo Passo.

**2. A experiência TESTE segue ATIVA em produção.**

**3. Termo v2 está em produção sem aprovação do cliente.** **Decisão do dono, não
pendência do agente:** produção é ambiente de homologação, o link não foi
divulgado, o termo só vincula quem o aceita, e a aprovação sai numa reunião. Está
no board do Orbi.

**4. Cancelar reserva não cancela a cobrança de saldo no Asaas.** O cliente
cancelado ainda consegue pagar. **Adiado para DEPOIS da Fase E de propósito**, e
agora o quadro está completo: o chargeback toca a mesma região (cancelamento,
estorno, cobrança viva no provedor). É o momento de tratar os dois de uma vez.

**5. Percentuais da maquininha** não enviados pelo cliente.

## Dívidas conhecidas

**Verificação**
- Telas conferidas em navegador autenticado: agenda, painel de detalhe,
  financeiro, e agora o **wizard público e a tela de status** (as três telas de
  cartão: fatura, em análise, recusado).
- Continuam sem conferência: experiências, horários, bloqueios, exceções,
  clientes e agendamentos.
- Método: cookie de sessão selado com `iron-session` a partir do `SESSION_SECRET`
  local, script temporário, apagado depois.

**Cartão (fora de escopo, decidido)**
- **Parcelamento** e **antecipação de recebíveis**. A cobrança é sempre à vista.
  Parcelar não exige conta nova (o líquido vem lido do provedor); exige decidir
  quem paga a diferença, que é decisão de negócio.
- Não há caminho para trocar o meio de pagamento de uma reserva já criada.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `findChargeByExternalReference` filtra a referência de volta por segurança; o
  filtro do Asaas **não foi medido isoladamente**.
- Na adoção de cobrança órfã o `invoiceUrl` fica `null`. Sem impacto conhecido.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- Etapa 2 não feita: `getTenantId()` devolve 1 fixo, com
  `assertResolvedTenantIsCurrent()` impedindo divergência silenciosa.
- Critério de conclusão: poder apagar aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Ambiente de teste**
- O `.env` guarda o hash escapado (`\$`) para o Next, e o `dotenv` puro dos testes
  não expande. Grupo que teste rota autenticada precisa desfazer o escape no
  `process.env` antes da primeira chamada, como faz o grupo W. Se virarem três,
  vira helper em `tests/helpers/`.

**Gerais**
- Sem CI/CD; deploy é clique manual no Easypanel.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- 3 avisos de Edge Runtime no build, conhecidos e estáveis.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo torna isto mais
  relevante do que era**.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
  Precedente pronto na Fase C (advisory lock + chave natural determinística).
  Reavaliar antes do vídeo.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais mergeadas, podem ser apagadas: `feat/cartao`,
  `feat/maquininha`, `feat/tenant-slug`, `feat/idade-e-mapa`,
  `feat/config-financeira`, `feat/preco-por-metodo`, `feat/sinal-50`,
  `feat/texto-informacoes`.

## Testes

`npm test`: **25 arquivos, 277 casos, todos passando**.

- Grupo **V** (`v-cobranca-saldo.test.ts`, 24 casos) — Fase C, validado por mutação.
- Grupo **W** (`w-maquininha.test.ts`, 24 casos) — Fase D, validado por mutação.
- Grupo **X** (`x-termo.test.ts`, 9 casos) — versionamento do termo, sha256 do v1
  fixado. Se X1.1 falhar, o conserto é desfazer a edição e criar um v3, **nunca**
  atualizar o hash.
- Grupo **Y** (`y-cartao.test.ts`, 23 casos) — Fase E. **Todos validados por
  mutação.** Y4.1 trava a regressão do chargeback descartado; Y4.2 trava a outra
  metade da regra (a reserva não é cancelada); Y5.2 trava o congelamento do
  líquido; Y5.4 trava que ninguém o calcula.

## Banco local

Container `aventix-db-dev` no ar. **10 migrations no disco, 10 aplicadas**
(`npm run db:generate` responde "No schema changes"). `reservations` vazia e
`card_machine_rates` vazia: as fixtures da verificação em navegador foram
apagadas ao final.

**`payment_mode` local está em `full`** nas duas trilhas, diferente de produção,
onde está `deposit`. Para exercitar sinal ou saldo localmente, ligue e desligue à
mão, como faz o helper `comSinal` dos grupos U, V, W e Y.
