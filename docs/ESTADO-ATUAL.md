# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-28

## Enquadramento (leia antes de priorizar qualquer coisa)

**O sistema está em produção, mas o link de agendamento ainda não foi divulgado.**
Não há campanha em curso e nenhuma pendência abaixo está causando dano agora.
Tudo é **preparação para outubro**, quando sai o vídeo do **@grandecampinas** e
os leads caem de uma vez.

O risco não é chegar a tempo — é **chegar testado com gente real antes do pico**.

## PRÓXIMO PASSO — Fase C: cobrança do saldo sob demanda, idempotente

O saldo já existe, já aparece nas três telas e já é cobrado presencialmente. O
que falta é o **botão que gera a cobrança online do saldo** no dia.

**A exigência que define a fase é a idempotência:** apertar duas vezes não pode
gerar duas cobranças. O dono vai usar isso no celular, em campo, com o cliente
esperando — o duplo toque não é hipótese, é o caso normal. A linha de `balance`
já existe em `reservation_payments` desde a criação da reserva, com
`external_reference` determinístico (`{uuid}:balance`), e é ela que dá a chave
natural para a idempotência.

### Entra junto: o reconciliador está poluindo o log, e vai piorar

**Descoberto em produção em 28/08, depois do fim de sessão.** A Fase B cria a
linha `kind='balance'` na reserva, mas a cobrança do saldo só nasce na Fase C.
Então existe linha de pagamento sem `asaas_payment_id`, e o job de reconciliação
a encontra a cada 10 minutos e loga:

```
[reconcile-payments] pagamento <uuid> (reserva <uuid>) sem id no provedor; nada a consultar
```

**Medido:** 7 linhas por ciclo com apenas 4 reservas de teste. Com 30 reservas
depois do vídeo do @grandecampinas, são 30 linhas a cada 10 minutos, **para
sempre**. Ruído constante faz parar de ler o log, e é olhando log que este
projeto pegou falha surda três vezes.

**O conserto:** o reconciliador ignora `kind='balance'` **sem** cobrança, porque
é estado esperado e não anomalia. Encaixa nesta fase porque é ela que passa a
criar essa cobrança.

**>>> NÃO SILENCIE `deposit` NEM `full` SEM ID. <<<** Esses **são** anomalia —
borda 9, a criação da cobrança falhou e a reserva nasceu sem QR. **Há 3 reservas
assim em produção agora**, de tentativas com valor abaixo do mínimo do Asaas.
Silenciar por "sem id" em vez de por `kind` apagaria o único sinal que existe
delas.

**Detalhe de implementação:** a query de `lib/jobs/reconcile-payments.ts` **não
seleciona `kind` hoje** — o filtro precisa desse campo. E o comentário do bloco
`if (!row.chargeId)` atribui a ausência só à borda 9; ele precisa passar a
conhecer as duas causas, senão o próximo a ler conclui que silenciar qualquer uma
é seguro.

**O silêncio do `balance` é permanente, não um remendo.** Mesmo depois da Fase C,
`balance` sem id continua significando "o dono ainda não cobrou" — o estado
normal da véspera. O que volta a ser assunto do job é `balance` **com** id.

### Faseamento (CLAUDE.md seção 17)

| Fase | Estado |
|---|---|
| **Fase 0** — configuração financeira | **CONCLUÍDA** |
| **Fase A** — preço cheio + desconto do Pix | **CONCLUÍDA, validada em produção** |
| **Fase B** — sinal de 50% via Pix | **CONCLUÍDA, validada em produção com dinheiro real** |
| **Fase C** — cobrança do saldo sob demanda, idempotente | **PRÓXIMA** |
| **Fase D** — registro manual da maquininha, líquido e taxa congelados | pendente |
| **Fase E** — cartão via `invoiceUrl` + chargeback | pendente |
| **Transversal** — líquido lido do Asaas | pendente |
| **Termo v2** — política de cancelamento + remarcação + política do sinal | pendente, **agora urgente** |
| **Antes do vídeo** — testes com clientes reais | em andamento |

## Estado de produção (VERIFICADO por SELECT, não relatado)

- Commit: **`b629a11`** (`main` = `origin/main`).
- **`experiences`**: Montanha e Fazenda em `payment_mode = 'deposit'`,
  `deposit_percent = 50`, `price_cents` **34999** e **24999** (os cheios).
- **`payment_method_discounts`**: `pix | 700`.
- **`settings`**: `meeting_point` com **876 caracteres e 10 quebras de linha**;
  `what_to_bring` **vazio de propósito**.
- **Migrations**: todas aplicadas.
- **Reserva com sinal validada com DINHEIRO REAL**: entrada e saldo somando o
  total exato, a tela mostrando a pendência, mapa e WhatsApp renderizando.

> **Divergência a conferir:** o fechamento desta sessão registrou "migrations
> 7/7", mas o disco tem **oito** arquivos (`0000` a `0007`) e o banco local tem
> **oito** linhas aplicadas. O mais provável é que "7" se refira ao número da
> última (`0007`). Como a Fase A depende das colunas da 0007 e ela funcionou em
> produção, a 0007 está aplicada lá. **Confira o número absoluto** antes de
> assumir: `SELECT count(*) FROM drizzle.__drizzle_migrations;` deve dar **8**.

## O que foi entregue nesta sessão

**Fase A** — a experiência guarda o **valor cheio** e o Pix desconta 7%. O preço
que o cliente paga **não mudou** (R$ 325,49 e R$ 232,49), só a origem. Migration
0007 congela `full_price_cents` e `discount_basis_points` na reserva. O desconto
incide sobre o **total**, e o wizard chama a **mesma** `applyDiscount` do
servidor.

**Fase B** — sinal de 50% via Pix, com `confirmed` + `partial`. Passo de escolha
no wizard com as duas opções lado a lado, `deposit` destravado no CRUD com o
percentual travado em 50, e **as três telas mostrando a pendência**.

**Texto oficial do cliente** publicado em `settings.meeting_point`, com o título
do bloco mudando para "Informações importantes".

## >>> CORREÇÃO DE PREMISSA: o texto do cliente NUNCA esteve publicado <<<

A documentação vinha afirmando que o texto oficial estava em produção desde
24/08. **Não estava.** O template tinha os placeholders marcados
`PROVISORIO — confirmar com o cliente`, e produção refletia isso
(`meeting_point` com **84 caracteres**).

O que subiu em 24/08 foi o **componente** que renderiza texto longo com quebras
preservadas. O **conteúdo** só entrou em 28/08. É a mesma classe de engano do
mapa: infraestrutura no ar tratada como funcionalidade entregue.

## >>> A ARMADILHA DO SEED MORDEU QUATRO VEZES NESTA SESSÃO <<<

Quatro `UPDATE` manuais em produção: os dois **preços**, o **`payment_mode`**, o
**`meeting_point`** e o **`what_to_bring`**. Nenhum acusaria falha se esquecido.

**Os dois de conteúdo são os que se esquece**, porque não têm sintoma técnico —
a tela renderiza perfeitamente com o texto velho. E o `what_to_bring` é o pior:
é um `UPDATE` que grava **string vazia**, então "não fiz" é indistinguível de
"não precisava fazer".

**`POST /api/admin/seed` deixou de ser conveniência.** Com quatro ocorrências
numa sessão só, o custo de não a ter passou o de construí-la. É candidata real a
entrar antes da Fase D.

**Conferir conteúdo exige contar as quebras, não só os caracteres:** o console
pode entregar o texto com os `\n` colapsados, e aí o tamanho confere e a tela
vira parede de texto.

## Pendências que NÃO podem se perder

**1. A experiência TESTE está ATIVA em produção.** Foi reativada na apresentação
de quarta e **aparece em `/api/experiences`**, ou seja, na LP pública. Precisa
ser desativada (`PATCH { ativo: false }` no admin, ou `UPDATE experiences SET
active = false`) **antes de o link ir para a LP**. Se o vídeo sair com ela no ar,
o cliente vê uma trilha que não existe.

**2. Duplicação de título na tela de confirmação.** O `<h2>` "Informações
importantes" repete a primeira linha do texto do cliente
(`📌 INFORMAÇÕES IMPORTANTES DO PASSEIO`). As duas metades estão travadas por
decisão: o título foi definido pelo dono do produto, o texto é do cliente e não
pode ser editado. **Decisão pendente:** omitir o `<h2>` (não custa nada em código
e não mexe no texto dele) ou pedir ao cliente para tirar a primeira linha.

**3. A tela de confirmação com o texto NOVO ainda não foi vista em produção.** A
verificação em navegador desta sessão foi **local**, contra o banco de
desenvolvimento já semeado — lá o texto novo renderizou certo nas duas telas
(6 parágrafos, `pre-line`, sem HTML, sem rótulo órfão). Em **produção** ninguém
abriu ainda uma reserva confirmada depois do `UPDATE`. Conferir.

**4. O termo NÃO menciona a política do sinal, e agora isso é lacuna ativa.** As
duas trilhas vendem em `deposit` em produção, então já pode haver cliente pagando
sinal sem que o termo diga que ele **não é reembolsável**. A seção 10 prevê
`settings.deposit_policy_text` no termo quando a experiência for `deposit`; não
está implementado. **Entra no Termo v2 e subiu de prioridade.**

## Dívidas conhecidas

**Dependem do cliente**
- **Percentuais reais da maquininha por modalidade**: não enviados. Bloqueiam a
  Fase D. A tabela e a tela já os aceitam; vazia é o estado honesto.

**Do texto do cliente**
- **Termo v2** precisa resolver: política do sinal (item 4 acima) e a redação da
  remarcação. A frase proposta e ainda **não aprovada**: *"Remarcação. Você pode
  remarcar seu passeio até 48 horas antes do horário agendado, falando com a
  gente pelo WhatsApp — a remarcação não é feita pelo site. A nova data fica
  sujeita à disponibilidade. Valores já pagos não são devolvidos em caso de
  cancelamento."* O texto oficial vive fora do repositório.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- Etapa 2 não feita: `getTenantId()` devolve 1 fixo, com
  `assertResolvedTenantIsCurrent()` impedindo divergência silenciosa.
- Critério de conclusão: poder apagar aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Verificação que continua não feita**
- **As telas do admin nunca foram renderizadas em navegador autenticado.** Isso
  agora cobre a correção mais importante da Fase B: o rótulo "Saldo R$ X" no
  bloco da agenda e o selo em `/admin/agendamentos` estão provados por teste e
  por build, **não por olho**. `/admin/*` está atrás do login e só existe o hash
  da senha.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `receiveInCash` não implementado (Fase D).

**Dívida técnica registrada de propósito**
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`.

**Gerais**
- Sem CI/CD; deploy é clique manual no Easypanel.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá: **3 avisos no
  build** (`lib/payments/asaas.ts` com `node:crypto`, `lib/auth.ts` com
  `bcrypt`). Reconfirmados nesta sessão; nenhum novo.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo torna isto mais
  relevante do que era**.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
  **Reavaliar antes do vídeo**; é parente direto da idempotência da Fase C.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais já mergeadas, podem ser apagadas: `feat/tenant-slug`,
  `feat/idade-e-mapa`, `feat/config-financeira`, `feat/preco-por-metodo`,
  `feat/sinal-50`, `feat/texto-informacoes`.

## Testes

`npm test`: **21 arquivos, 199 casos, todos passando**.

- Grupo **T** (`t-preco-por-metodo.test.ts`, 13 casos): valores literais da seção
  4-B.2, e o **T2.4** com fixture de preço 33333 que separa "desconto sobre o
  total" de "unitário descontado × 2" — com 34999 os dois coincidem por acaso.
- Grupo **U** (`u-sinal.test.ts`, 14 casos): a divisão 16275/16274, o desconto
  **antes** da divisão, e **U1 e U4.2**, que não consertam nada e existem só para
  travar as duas barreiras que impedem o cron de expirar uma reserva já paga.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e reconciliado com o template:
preços cheios, `pix | 700`, `meeting_point` com o texto oficial (876 caracteres,
idêntico ao template), `what_to_bring` vazio. **`payment_mode` local está em
`full`** nas duas trilhas (foi revertido depois da verificação do wizard) —
diferente de produção, onde está `deposit`. Para exercitar o sinal localmente,
ligue e desligue à mão, como faz o helper `comSinal` do grupo U.
