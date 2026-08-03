# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-03 (segunda sessão do dia)

## Onde estamos

**Fase 3 (interfaces), 3 de 8 tarefas de admin.** Fases 0 e 1 completas. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas atrasaram e travam a Fase 2 inteira, então as telas de admin que não dependem de pagamento vêm primeiro.

Tarefas de admin da Fase 3: **auth (pronta)**, **calendário — grade de visualização (pronta)**, **calendário — painel de detalhes e cancelamento (pronta)**, CRUD de experiências, CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada por link secreto.

O admin agora **escreve**: cancelar reserva é a primeira operação de escrita da interface, e ela passa por `setReservationStatus`.

## Pronto

**Fase 0 (completa)**
- Repo GitHub, Next.js 16 + TypeScript, Drizzle, Postgres local via Docker
- Deploy no VPS Hostinger via Easypanel: `aventix.com.br` no ar com HTTPS

**Fase 1 (completa)**
- `lib/db/schema.ts`: 13 tabelas, 8 enums, `btree_gist`, exclusion constraint anti-overbooking
- `lib/tenant.ts`: tenant + settings cacheadas (TTL 60s), acessores tipados booleano e numérico
- `lib/time.ts`: conversões America/Sao_Paulo, UTC, validação de data de calendário
- `lib/reservations.ts`: `setReservationStatus`, `recalcReservationPayment`, `findOrCreateCustomer`, `createReservation`
- `lib/availability.ts`: motor completo (exceções de agenda, buffer, blackouts, exclusividade, lead time)
- `lib/templates/` + `lib/seed.ts` + `scripts/seed.ts`: template de segmento do Quadri Club, seed idempotente
- `lib/jobs/expire-holds.ts` + `instrumentation.ts`: cron de expiração de hold, a cada minuto
- `app/api/reservations/route.ts` (POST) e `app/api/availability/route.ts` (GET)
- `tests/`: 30 casos em 6 arquivos, `tests/global-setup.ts` migrando e semeando sozinho

**Fase 3, tarefa 1: autenticação do admin (completa, `709cf4d`)**
- `lib/auth.ts` como fronteira única, `proxy.ts` protegendo `/admin/*` e `/api/admin/*`
- Telas de login e logout, `npm run auth:hash`, `tests/f-auth.test.ts` com 5 casos

**Fase 3, tarefa 2: calendário nativo, grade de visualização (completa, `0820dcf` + `70dfade`)**
- `lib/calendar.ts`: período em UMA query, sobreposição com `&&` sobre `tstzrange`, datas em ISO
- `app/api/admin/calendar/route.ts`: `from`/`to`/`view`, 400 tipado, teto de 62 dias, projeção de resumo no mês
- `app/(admin)/admin/page.tsx` + `_components/` com as três views em CSS Grid puro
- `scripts/seed-demo-reservations.ts` (`npm run db:seed:demo`): 6 reservas marcadas com `channel='demo'`

**Fase 3, tarefa 3: painel de detalhes e cancelamento (completa, `a59c340` + `ae43593` + `26a8831`)**
- `lib/reservation-detail.ts` + `GET /api/admin/reservations/{id}`: detalhe completo em UMA query, com os três conjuntos um-para-muitos em subconsultas escalares agregadas pelo Postgres. Módulo separado de `lib/calendar.ts` de propósito (contratos diferentes: período x reserva única)
- `POST /api/admin/reservations/{id}/cancel`: chama `setReservationStatus`, traduz os erros tipados em 404/409. Não reimplementa a máquina de estados, não dispara e-mail, não toca no dinheiro
- `_components/reservation-panel.tsx`: overlay lateral, detalhe sob demanda no clique, rótulos de `settings`, confirmação por digitar `CANCELAR`, fecha por X/clique fora/Esc, trava a rolagem do body enquanto aberto
- `day-view` e `week-view` chamam `onSelect(reservation.id)`; `router.refresh()` recarrega a grade depois do cancelamento

## O que esta sessão fez

1. **Rota de detalhe** (`a59c340`): `lib/reservation-detail.ts` e `GET /api/admin/reservations/{id}`.
2. **Rota de cancelamento** (`ae43593`): `POST .../cancel` sobre `setReservationStatus`.
3. **Painel** (`26a8831`): overlay, confirmação digitada, wiring das duas views, trava de rolagem do body.
4. **CLAUDE.md** atualizado: seção 7.2 ganhou a rota de detalhe com a regra de dado sensível; a 11.1 ganhou o parágrafo do painel sobreposto; a árvore da 14 esclarece o papel da página `/admin/reservas/[id]`.

Verificado ao fim: `npx tsc --noEmit` limpo, `npm run lint` limpo, `npm test` com **30 passed**, `npm run db:generate` sem mudanças.

**Medições desta sessão, feitas no navegador e no psql:**
- Cancelamento de uma reserva de 2 quadris deixou `reservations.status = cancelled` com `cancelled_at`, as DUAS linhas de `reservation_resources` em `cancelled`, e o horário voltou: `/api/availability` para 2 recursos em 04/08 não oferecia 11:00 antes e passou a oferecer depois.
- Erros: já cancelada → 409; expirada pelo cron → 409; sem sessão → 401; inexistente e malformado → 404.
- Nenhum CPF ou CNH aparece no log do servidor. No código novo existem dois `console.*`, ambos `console.error` de catch.

## PRÓXIMO PASSO

**CRUD de experiências** (tarefa 4 de 8 da Fase 3). É a primeira tela de catálogo e a que o cliente mais precisa para confirmar os valores PROVISÓRIOS do template.

Pontos de atenção já conhecidos, todos no CLAUDE.md:
- Inclui `payment_mode` e o sinal (`deposit_percent` **ou** `deposit_fixed_cents`, exatamente um dos dois — há CHECK no schema).
- **Preço zero tem que ser recusado** pelo CRUD (seção 4.6): experiência gratuita não é suportada e produziria reserva presa em `pending` para sempre.
- Desativar é `active = false`, nunca apagar: reservas apontam para a experiência.

**Depois:** CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas em `public` (conferido nesta sessão)
- **Produção:** NUNCA migrou. Banco vazio. Primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration
- Esta sessão NÃO tocou o schema

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar. Catálogo semeado e conferido intacto ao fim da sessão (2 recursos ativos, 0 blackouts). As 6 reservas de demonstração foram recriadas no encerramento; a suíte de testes as apaga, então rode `npm run db:seed:demo` de novo antes de olhar a tela.

## Pendências e dívidas conhecidas

- **`getDayGrid` duplica a precedência exceção-sobre-`operating_hours`** (seção 6) que já vive em `lib/availability.ts`. Se as duas cópias divergirem, a tela desenha horário que o motor não vende — não causa overbooking, causa tela mentindo. O lugar certo de unificar é quando o CRUD de horários entrar e virar o terceiro consumidor
- **Blocos não adjacentes continuam sem vínculo visual.** Reserva nos recursos 1 e 3, com o 2 livre, vira dois blocos separados (correto), e nada indica que são a mesma reserva. O que **deixou** de ser dívida: os dois blocos abrem a mesma reserva, agora medido contra dado real (recurso temporário + blackout no do meio forçaram a alocação 1 e 3; os dois blocos dispararam GET do mesmo id)
- **`instrumentation.ts` compila para Edge Runtime e falha lá:** `./lib/auth.ts:24 — 'node:crypto' is not supported in the Edge Runtime`, repetido a cada request em dev. Não derruba nada, mas polui o log a ponto de esconder erro de verdade. Ficou mais incômodo agora que há mais tela para depurar
- **`app/layout.tsx` ainda é o do `create-next-app`:** `lang="en"` e título "Create Next App". O título aparece na aba do dono, na tela mais usada do sistema
- **A âncora dos testes de lead time vence em junho de 2027.** Vencida, o bloco falha com instrução de trocar a data (não passa em silêncio)
- **Sem rate limiting no login.** `POST /api/admin/login` aceita tentativas ilimitadas. TODO no arquivo, previsto para o hardening da Fase 4
- **Sessão sem revogação.** Estado no cookie (iron-session). Cookie roubado vale até expirar, 8h. Aceito no MVP de usuário único
- **O cancelamento não tem teste automatizado.** A lógica de estado inteira é `setReservationStatus`, que a suíte já cobre; o que entrou é tradução HTTP, verificada por curl nesta sessão. Se a rota ganhar regra própria, o teste passa a ser necessário
- **A página `/admin/reservas/[id]` da seção 14 não existe.** O painel sobreposto cobre o uso do dia a dia; a página só faz falta para link direto (compartilhar uma reserva por mensagem). Não é bloqueio para o go-live
- **DEPENDÊNCIA DA FASE 2 (não é o próximo passo):** pré-requisitos do Asaas (CLAUDE.md seção 18) dependem do cliente e travam a Fase 2 inteira: conta aprovada com prova de vida, chave Pix cadastrada, API keys, webhook com token próprio, régua de notificações ajustada. Junto vem a decisão de negócio: **lançamento com pagamento integral ou com sinal?**
- **`reservations.payment_state` é `'pending'` em toda reserva**, inclusive nas confirmadas, porque nada marca cobrança como paga antes da Fase 2. O painel já exibe total, pago e em aberto lendo esses campos, então hoje ele mostra "Em aberto: R$ 650,98" numa reserva confirmada. É o dado correto do banco, não um defeito da tela, e se corrige sozinho quando o pagamento entrar
- **O painel não tem cobrança de saldo nem "Recebi por fora"** (seção 11.1). Dependem da Fase 2; o ponto de entrada está comentado no arquivo
- **11 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts` (`grep -n "PROVISORIO"`): `min_lead_minutes`, ponto de encontro, o que levar, política de sinal, nomes dos recursos, grade de horários, os dois `paymentMode` e o `reply_to_email`, que está como `contato@aventix.com.br` e aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **`ce3e4c6` tem mensagem que não bate com o conteúdo.** Já está em `origin`, nada a fazer além de saber
- **`app/` não usa o route group `(public)`** que a seção 14 especifica. Só o admin ganhou `(admin)`. A resolver quando o formulário público for construído
- **A exclusion constraint não é exercitada pela suíte.** Com `single_experience_per_slot=true` a criação serializa por advisory lock e o perdedor cai no recheck. Medido: 0 via constraint, 10 via recheck
- **Reserva expirada mantém `reservation_payments` em `pending`.** O job de reconciliação da Fase 2 vai encontrar essas linhas; o filtro da seção 8-B provavelmente precisa excluir `expired`, não só `cancelled`
- **Sem proteção contra duplo clique** em `POST /api/reservations`. Defesa natural é desabilitar o botão na tela
- **Termo sem versão vigente:** não há onde guardar texto e versão atual. O servidor valida presença, não que a versão seja a corrente
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o formato não-ISO. Regra na seção 3
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica; a correção de origem é validar no CRUD
- **Experiência gratuita** (`price_cents = 0`) não é suportada; seção 4.6
- **Cron em dev:** o timer guarda a versão do módulo carregada no boot. Editar `lib/jobs/expire-holds.ts` não muda o tick até reiniciar

## Prazo

Go-live 24/08. Faltam 5 tarefas de admin da Fase 3 mais o fluxo público, a Fase 2 (à espera do Asaas) e a Fase 4 (integrações e hardening). Ritmo de cerca de 2h/dia. Custo aceito da inversão: Fases 2 e 3 serão costuradas no fim. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
