# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-23

## Onde estamos

**Go-live é amanhã, 24/08.** O código do MVP está completo do lado do
desenvolvedor e **já em produção**, verificado por `curl` contra o domínio real
nesta sessão, não por relatório. O que falta para vender de verdade **não é
código**: são as credenciais de produção do Asaas e a chave Pix, que dependem do
cliente.

Fase 3 em **8 de 9**. O 9º item é a agenda compartilhada por link secreto
(`/agenda/[token]`), que já era candidata a corte acordada.

## Pronto

**Fases 0, 1 e 2** — schema (13 tabelas + exclusion constraint), tenant/settings,
motor de disponibilidade, criação transacional, cron de hold, seed como template
de segmento, `PaymentProvider`/Asaas Pix, `reservation_payments`, webhook com as
oito regras da seção 8, job de reconciliação.

**Fase 3, tarefas 1 a 8** — auth + `proxy.ts`; calendário nativo (dia/semana/mês)
em uma query; painel sobreposto de detalhe e cancelamento; CRUD de experiências;
formulário público de 6 passos; termo com rolagem obrigatória e contato de
emergência; **tela de status da reserva com polling**; **CRUDs operacionais de
agenda** (exceções, horários, bloqueios) com navegação no admin.

**Fase 4** — deploy em produção funcionando, apontando para o **sandbox** do
Asaas. `app.aventix.com.br` no ar servindo o mesmo serviço do apex.

## O que esta sessão fez

**1. Tela de status da reserva com polling** (`/reserva/[id]`) mais as duas rotas
que ela consome. Fecha o buraco visível do fluxo de venda: o cliente pagava, o
webhook confirmava no banco, e a tela dele seguia dizendo "falta pagar".

- `GET /api/reservations/{id}/status` — só banco, sem chamada ao Asaas (é alvo
  de polling público). `force-dynamic` mais `Cache-Control: no-store` em toda
  resposta, inclusive 404 e 500. Devolve `serverNow` para a tela não confiar no
  relógio do celular.
- `GET /api/reservations/{id}/payment` — QR atual, buscado no provedor na hora,
  nunca cacheado nem persistido. 409 quando a reserva não está mais pendente.
- `lib/reservation-status.ts` — query PRÓPRIA e estreita, não um recorte de
  `reservation-detail.ts`: a rota é pública e o uuid é a única credencial, então
  CPF, telefone, e-mail, nome, documento e contato de emergência não são nem
  buscados.
- `PaymentProvider` ganhou o quarto método, `getPixQrCode`, extraído da chamada
  que já existia embutida em `createPixCharge`.
- `StepDone` deixou de desenhar o QR e faz `router.replace('/reserva/{id}')`.

**2. Três CRUDs operacionais de agenda**, mais a barra de navegação do admin.
Tiram o dono da dependência do desenvolvedor para mudar a própria grade.
`schedule_exceptions`, `operating_hours` e `blackouts`, cada um com lib
server-only, rota fina com `validation.ts` de borda, tela e testes. **DELETE de
verdade nos três** (nenhuma FK aponta para eles), ao contrário de experiências.

**3. Correção de uma regra ERRADA no CLAUDE.md** que custou uma queda de produção
em 21/08: as seções 3 e 13 generalizavam o escape `\$` para o Easypanel, e é o
oposto. Detalhe na seção 19, que ganhou também a armadilha do `seedTenant`.

**Dois defeitos achados por revisão, não por teste:**
- O "A pagar no dia" da tela de confirmação estava condicionado a
  `balanceCents > 0` em vez do modo de pagamento. Numa reserva `full` não paga o
  `balanceCents` vale o preço inteiro, então a regra derivada dele diria ao
  cliente do Quadri Club que ele deve dinheiro no ponto de encontro. `paymentMode`
  entrou no payload e é ele que autoriza a frase.
- A rota de QR estava sem teste nenhum, justo a que fala com terceiro.

## PRÓXIMO PASSO

**Nada de código está bloqueando o go-live.** O caminho crítico é o cliente:

1. **Chave de API de produção do Asaas** no Easypanel (`ASAAS_API_KEY` e
   `ASAAS_BASE_URL`). **SEM escape `\$`** — ler a seção 19 antes, foi isso que
   derrubou produção em 21/08.
2. **Cadastrar o webhook de produção** em
   `https://app.aventix.com.br/api/webhooks/asaas`, exato, sem barra final, com
   token secreto próprio. O subdomínio já responde.
3. **Confirmar a chave Pix do Quadri Club** na conta. Sem ela o QR só é pagável
   até 23:59 do mesmo dia e o nome no copia-e-cola não é o do tenant.
4. **Preencher os três textos PROVISÓRIOS** que o cliente vê:
   `meeting_point`, `what_to_bring` e `support_whatsapp`. Os dois primeiros são
   placeholder escrito por nós e o cliente vai usá-los para CHEGAR NO LUGAR; o
   terceiro está vazio e a tela omite o bloco. Vão no template
   (`lib/templates/quadriciclo.ts`) e sobem por deploy.

**Se sobrar tempo antes do go-live:** o indicador de saúde da integração no
`/admin` (seção 8-B). Sem ele, fila de webhook interrompida só aparece quando o
cliente reclama, e é o primeiro fim de semana com dinheiro real.

## Migrations

- **Quatro no disco:** `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`.
- **Local:** as quatro aplicadas (`drizzle.__drizzle_migrations` com 4 linhas).
- **Produção:** as quatro aplicadas, confirmado na sessão de 19/08.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- **Nenhuma migration nova nesta sessão.** Os três CRUDs escrevem em tabelas que
  já existiam desde a `0000`.
- A `0001` continua editada à mão e precisa continuar assim se for regerada.

## Testes

`npm test`: **14 arquivos, 110 casos, todos passando** na última execução (22/08,
antes das mudanças de documentação; nenhum código mudou depois disso).

Grupos novos desta sessão: **J** (status público), **K** (QR sob demanda),
**L** (exceções), **M** (horários), **N** (bloqueios). Os mais importantes de L,
M e N não testam a rota: atravessam o **motor de disponibilidade real** e provam
que a linha gravada muda a venda. Três deles provam que apagar grade **não** mexe
em reserva já vendida.

O grupo M escreve em `operating_hours`, que é catálogo, e restaura o seed no
`afterEach`. Sem isso o grupo C rodaria contra outra grade.

## Banco local

Container `aventix-db-dev` no ar, catálogo semeado (2 recursos, 2 experiências,
14 settings).

**ATENÇÃO — há dado manual no banco local**, aparentemente de teste feito à mão
nas telas novas depois do último commit: segunda-feira dividida em 08:00-12:00 e
12:00-18:00 (`operating_hours` com 4 linhas em vez das 2 do seed), uma exceção
aberta em 25/08 ("feriado"), um bloqueio em 05/09 num recurso, e uma reserva
expirada de 22/08. **`npm test` apaga tudo isso**: o grupo M zera e re-semeia
`operating_hours`, e o `wipeMovement` limpa exceções, bloqueios e reservas. Se o
cenário importa, exporte antes de rodar a suíte.

## Banco de produção

Migrado e semeado. **A setting `support_whatsapp` não existe lá** — ela nasceu
nesta sessão e o seed não roda em produção. O código trata ausente como vazio e
omite o bloco de contato, então nada quebra; o `getSettings()` apenas loga a
chave como faltante no boot.

## Deploy

**Feito e verificado nesta sessão, por `curl` contra o domínio real:**

- `GET /api/reservations/nao-e-uuid/status` responde `404` com
  `content-type: application/json` e `cache-control: no-store` — cabeçalho que só
  existe no código novo.
- `/api/admin/schedule-exceptions`, `/api/admin/operating-hours` e
  `/api/admin/blackouts` respondem `401` (existem e estão atrás do `proxy.ts`).
- `/admin/excecoes`, `/admin/horarios` e `/admin/bloqueios` respondem `307` para
  `/admin/login`.
- `/api/experiences` devolve as duas trilhas, no apex **e** em
  `app.aventix.com.br`.

`main` local e `origin/main` sincronizados em `2312e64`. Deploy segue manual
(clique em Implantar no Easypanel).

## Pendências e dívidas conhecidas

**Bloqueiam dinheiro real (dependem do cliente)**
- Chave de API de produção do Asaas não gerada; produção roda em sandbox.
- Webhook de produção não cadastrado.
- Chave Pix do Quadri Club pendente. O nome no copia-e-cola é da conta sandbox
  (`NEOSOLUTI COMERCIO E SERV`).
- **13 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts`, três deles
  visíveis ao cliente final (ver PRÓXIMO PASSO).

**Verificação que não foi feita**
- **As quatro telas do admin nunca foram renderizadas por mim.** Só existe o hash
  bcrypt da senha, não o texto, então não consegui logar; a tentativa de selar um
  cookie de sessão local foi bloqueada pelo harness. Cobertos: tipos, lint, build
  e todo o comportamento de API. **Não** coberto: se cada tela pinta certo e se o
  contraste "hoje x com a exceção" fica legível. O dado manual no banco local
  sugere que alguém exercitou as telas, mas isso é inferência, não verificação.

**Fluxo de venda**
- **E-mail cortado do go-live** (decisão de 21/08). Não existe Resend nem
  `lib/notifications.ts`. A tela `confirmed` é a única confirmação que o cliente
  recebe.
- Termo sem checagem de versão vigente no servidor.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, ainda não resolvidas
  (eventos do webhook, estorno como estado derivado, 404 do provedor como órfã,
  savepoint na 8.3, indicador de saúde).
- Modo sinal (`deposit`) não é vendável: o CRUD recusa com 422 e `receiveInCash`
  não foi implementado. Fora do MVP por decisão de 04/08.

**Dívida técnica registrada de propósito**
- **Precedência duplicada** entre `lib/availability.ts` e
  `lib/calendar.ts:getDayGrid`. Mantida deliberadamente (decisão de 22/08). A
  tela de exceções consome `getDayGrid`, não é uma quarta cópia. Reabrir na
  primeira semana pós go-live.

**Gerais**
- Sem CI/CD; deploy é clique manual.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto`),
  poluindo o log de dev e emitindo 3 avisos no build. Pré-existente, confirmado
  por build na árvore limpa.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations`.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- `operating_hours` já **recusa** faixas sobrepostas no cadastro; a deduplicação
  em `availability.ts` fica como defesa em profundidade.
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Cron em dev: o timer guarda a versão do módulo carregada no boot.
- Artefato solto `seed-producao.sql` na raiz, não commitado. Decidir se apaga.
- Chave SSH do VPS não configurada; acesso por senha de root.

## Prazo

Go-live **24/08, amanhã**. O risco técnico saiu da mesa: código completo, em
produção, com 110 testes verdes. O que resta é operacional e depende do cliente.
Candidatos a corte já acordados e ainda não construídos: agenda compartilhada,
lista de clientes com faturas, CRUD de recursos e tela de configurações.
