# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-17

## Onde estamos

**Fase 2 concluída em sandbox.** Fases 0 e 1 completas; Fase 3 com 6 de 9 tarefas.
Go-live: **24/08/2026** (faltam 7 dias).

A ordem das fases está invertida por decisão de 28/07: os pré-requisitos do Asaas
travavam a Fase 2, então as telas de admin vieram primeiro. O Asaas destravou
nesta sessão e a Fase 2 foi fechada inteira.

**O ciclo do dinheiro fecha de ponta a ponta contra o sandbox:** o cliente
agenda, recebe QR Code Pix real, paga, e a reserva confirma sozinha pelo
webhook. Se a fila do webhook cair, o job de 10 minutos confirma por conta
própria. Verificado com entrega REAL do Asaas (`User-Agent: Asaas_Hmlg/3.0`).

## Pronto

**Fases 0 e 1** — schema (13 tabelas + exclusion constraint), tenant/settings,
motor de disponibilidade, criação transacional, cron de expiração de hold, seed
como template de segmento.

**Fase 3, tarefas 1 a 6** — auth + `proxy.ts`; calendário nativo (dia/semana/mês)
em uma query; painel sobreposto de detalhe e cancelamento; CRUD de experiências;
formulário público de 6 passos; termo real com rolagem obrigatória e contato de
emergência.

**Fase 2 completa (esta sessão)**
- `lib/payments/provider.ts` — contrato genérico, três métodos. Nada fora de
  `asaas.ts` fala "asaas"; status usa o enum `payment_state`.
- `lib/payments/asaas.ts` — única implementação: cobrança, QR, consulta,
  cancelamento, verificação do token do webhook. Timeout de 10s justificado.
- `lib/payments/money.ts` — centavos para reais sem ponto flutuante.
- `lib/payments/charge.ts` — cria a cobrança FORA da transação (seção 5.2 passo
  5); falha expira a reserva e libera a vaga.
- `lib/payments/process.ts` — FUNÇÃO ÚNICA usada pelo webhook e pela
  reconciliação, como a seção 8-B exige.
- `app/api/webhooks/asaas/route.ts` — as oito regras invioláveis da seção 8.1.
- `lib/jobs/reconcile-payments.ts` + cron de 10 min em `instrumentation.ts`.
- Migration `0003`: `customers.asaas_customer_id` (+ índice único parcial) e
  `reservation_payments.asaas_invoice_url`.
- Passo 6 do wizard com QR real, copia-e-cola e botão copiar.

**CPF no formulário público (esta sessão)** — `lib/cpf.ts`, módulo puro
compartilhado entre front e servidor, com validação de dígito verificador.
Obrigatório porque o Asaas recusa criar cobrança sem CPF do pagador. Sem
migration: a coluna já existia.

**Maioridade do condutor no servidor (esta sessão)** — `createReservation` exige
18 anos completos na data do agendamento e recusa operador sem data de
nascimento. Fecha a divergência registrada em 04/08.

## O que esta sessão fez

Seis commits, todos pushed (`main` = `origin/main` em `8b0975e`):

1. `fdd8ee1` maioridade do condutor no servidor + `reply_to_email` do tenant
2. `d1e0344` correção de fuso no teste de maioridade
3. `eef16b7` PaymentProvider + cobrança Pix (Fase 2, 1/2)
4. `9c7858f` CPF do responsável no wizard
5. `6a67696` webhook + reconciliação (Fase 2, 2/2)
6. `8b0975e` documentação

Verificado ao fim: `npx tsc --noEmit` limpo, `eslint` limpo, `npm test` com
**55 passed** (9 arquivos), `npm run db:generate` sem mudanças. Cada commit foi
construído com a árvore no estado dele e passa isoladamente (35, 39, 44, 55).

## PRÓXIMO PASSO

**Tela de status da reserva com polling** — `app/(public)/reserva/[id]/page.tsx`
e `GET /api/reservations/{id}/status`, ambos previstos na seção 14 e ainda
inexistentes.

É o buraco visível do fluxo de venda: hoje o cliente paga o Pix, a reserva
confirma no banco, e a tela dele continua dizendo "Falta pagar". O ponto de
costura já está comentado em `steps.tsx` (`StepDone`). É pequeno e fecha a
experiência de compra, que é o que precisa estar de pé no go-live.

**Depois, e provavelmente antes das telas de admin que faltam:** o checklist de
produção da Fase 4 (ver Deploy abaixo), porque ele depende do cliente e tem
prazo. As tarefas restantes da Fase 3 (recursos, horários e bloqueios,
configurações, clientes, agenda compartilhada) são as candidatas naturais a
corte se apertar, e o `docs/CONTEXTO-NEGOCIO.md` já registra quais o cliente
aceita adiar.

## Migrations

- **Quatro no disco:** `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`.
- **Local:** as quatro aplicadas (`drizzle.__drizzle_migrations` com 4 linhas,
  conferido nesta sessão).
- **Produção: NUNCA migrou. Banco vazio.** As quatro entram juntas no deploy.
  A `0003` é `ADD COLUMN` nullable mais índice parcial, segura em tabela com
  linhas.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A `0001` é **editada à mão** e precisa continuar assim se for regerada: o
  drizzle-kit emite `ADD COLUMN NOT NULL`, que aborta em tabela com linhas.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e intacto (2 recursos ativos,
2 experiências ativas em `payment_mode='full'`, 13 settings). **Movimento
zerado** — as reservas de teste desta sessão foram removidas. As 6 reservas de
demonstração (`npm run db:seed:demo`) não estão semeadas.

## Pendências e dívidas conhecidas

**Fluxo de venda**
- **Tela de status/polling não existe** (é o próximo passo). O cliente paga e a
  tela dele não muda.
- **Termo sem checagem de versão vigente no servidor.** `createReservation`
  valida só a presença de `termo.version`, não que bata com `TERM_VERSION`.
- **A grade não mostra horário insuficiente.** `GET /api/availability` não
  informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
- Erro do telefone do contato de emergência chega com mensagem genérica, sem
  distinguir de quem é o telefone.

**Integração de pagamento**
- **Indicador de saúde da integração no `/admin` não construído** (seção 8-B).
  Sem ele, fila interrompida só aparece quando o cliente reclama.
- **Cinco divergências entre a seção 8 e o que foi medido**, levantadas e ainda
  não resolvidas: (a) 8.2 lista dois eventos, mas o webhook assina três e o Pix
  entrega `PAYMENT_CONFIRMED` junto; (b) 8-C diz "sinaliza estorno pendente na
  reserva", sugerindo campo, e a implementação usa estado derivado; (c) a regra
  6 não cobre 404 do provedor, que também é órfã; (d) a 8.3 não menciona que o
  registro do pagamento precisa sobreviver à colisão, o que exige savepoint;
  (e) 8-B pede o indicador de saúde, não construído.
- **Modo sinal (`deposit`) não é vendável:** o CRUD recusa com 422 e
  `receiveInCash` não foi implementado. Fora do MVP por decisão de 04/08.
- Os testes do webhook mockam `getCharge` (a borda de rede). O banco é real.

**Produção (Fase 4, depende do cliente)**
- **Chave de API de produção não gerada.** Sem ela o boot avisa e nenhuma
  reserva se completa.
- **`ASAAS_API_KEY` precisa de escape `\$` também no Easypanel**, que injeta env
  em runtime. Sem isso a chave chega vazia.
- **Webhook de produção não cadastrado.** O que existe aponta para o ngrok, é do
  sandbox e a URL muda a cada reinício do túnel.
- **Chave Pix do Quadri Club pendente** (tarefas no board do cliente). Sem ela o
  QR só é pagável até 23:59 do mesmo dia.
- **O nome no copia-e-cola é da conta sandbox** (`NEOSOLUTI COMERCIO E SERV`).
  Em produção precisa ser o Quadri Club.
- Chave SSH do VPS não configurada; acesso por senha de root.

**Gerais**
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto`),
  poluindo o log de dev a cada request.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations`.
- Sessão sem revogação (iron-session, 8h). Aceito no MVP de usuário único.
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- **13 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts` (era 14; o
  `reply_to_email` foi confirmado nesta sessão).
- `getDayGrid` duplica a precedência exceção-sobre-`operating_hours` que já vive
  em `lib/availability.ts`.
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si.
- `operating_hours` permite faixas sobrepostas no mesmo weekday.
- Experiência gratuita não é suportada; o CRUD recusa preço zero.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Cron em dev: o timer guarda a versão do módulo carregada no boot.

## Deploy

`main` está em `8b0975e` e foi pushed. O Easypanel constrói a partir do repo.
**Se o build for automático, a Fase 2 está indo ao ar sem credencial para
cobrar** — o site sobe, o boot avisa que o pagamento está mal configurado, e
qualquer tentativa de reserva falha ao gerar a cobrança e expira sozinha.

Antes de vender em produção: rodar as quatro migrations, gerar a chave de
produção (com escape do `$`), cadastrar o webhook de produção com token próprio
e confirmar a chave Pix do Quadri Club.

## Prazo

Go-live 24/08, 7 dias, ritmo de cerca de 2h/dia. O fluxo de compra funciona
ponta a ponta em sandbox; o que falta para lançar é a tela de status, o
checklist de produção e as pendências do cliente. Candidatos a corte, já
acordados com o cliente: agenda compartilhada, lista de clientes com faturas,
CRUD de recursos e tela de configurações.
