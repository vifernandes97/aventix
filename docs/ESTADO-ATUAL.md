# Estado atual — Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-07-28

## Onde estamos

**Fase 1 (Núcleo), 9 de 10 tarefas concluídas.** Go-live: 24/08/2026.

O núcleo está completo e a reserva funciona ponta a ponta pela API: consultar grade, criar reserva, hold expirar sozinho e o horário voltar. Falta só a suíte de testes, que está bloqueada por uma decisão de arquitetura.

## Pronto

**Fase 0 — Fundação (completa)**
- Repo GitHub, Next.js 16 + TypeScript, Drizzle, Postgres local via Docker
- Deploy no VPS Hostinger via Easypanel: `aventix.com.br` no ar com HTTPS
- `/api/health` respondendo em local e produção

**Fase 1 — Núcleo (9 de 10)**
- `lib/db/schema.ts` — 13 tabelas, 8 enums, `btree_gist`, exclusion constraint anti-overbooking
- `lib/tenant.ts` — tenant + settings cacheadas (TTL 60s), acessores tipados booleano e numérico
- `lib/time.ts` — conversões America/Sao_Paulo ↔ UTC, validação de data de calendário
- `lib/reservations.ts` — `setReservationStatus`, `recalcReservationPayment`, `findOrCreateCustomer` + `normalizePhone`, `createReservation`
- `lib/availability.ts` — motor completo (exceções de agenda, buffer, blackouts, exclusividade, lead time)
- `lib/templates/` + `scripts/seed.ts` — template de segmento do Quadri Club, seed idempotente, `npm run db:seed`
- `lib/jobs/expire-holds.ts` + `instrumentation.ts` — cron de expiração de hold via node-cron, a cada minuto
- `app/api/reservations/route.ts` — POST, validado por curl
- `app/api/availability/route.ts` — GET, validado por curl

Dependências da fase: `date-fns-tz`, `zod`, `server-only`, `node-cron`, `tsx` (dev), `vitest` (dev).

## Em andamento: suíte de testes (BLOQUEADA)

Vitest 4.1.10 instalado, `vitest.config.ts` criado (ambiente node, alias `@`, setup carregando `.env`), scripts `test` e `test:watch` no package.json. Existe apenas `tests/smoke.test.ts`, que **falha**.

**O bloqueio:** `lib/tenant.ts` e `lib/availability.ts` declaram `import 'server-only'`, que lança em processo Node puro. O Vitest é Node puro, então o import quebra antes de qualquer teste rodar:

```
Error: This module cannot be imported from a Client Component module.
 ❯ Object.<anonymous> node_modules/server-only/index.js:1:7
Test Files  1 failed (1)      Tests  no tests
```

**ATENÇÃO:** `npm test` está VERMELHO na main. O commit `8f14f98` tem mensagem "suíte de regressão da Fase 1 (corridas + casos de borda)", mas contém só o andaime; os 18 casos de teste não foram escritos.

**Decisão pendente, a tomar antes de escrever a suíte.** Três opções levantadas:
1. Condition `react-server` na config do Vitest. Resolve como o Next, mas é global: qualquer pacote com export `react-server` (React inclusive) passa a resolver por outro caminho nos testes, afastando teste de produção. Incerto se a chave é `resolve.conditions` ou `ssr.resolve.conditions` no Vitest 4; não testado.
2. Alias de `server-only` para stub vazio só em teste. Cirúrgico, uma linha, cobre os dois módulos de uma vez. Custo: a suíte deixa de pegar import indevido em Client Component, que de todo modo é erro de build do Next.
3. Rodar os testes em subprocesso com `--conditions=react-server`. Descartada: mataria a ergonomia do `npm test`.

Inclinação registrada: opção 2, por ser a mudança mais estreita.

## Falta na Fase 1

1. **Decidir o tratamento do server-only no Vitest** (acima) e então escrever a suíte: 18 casos em 5 grupos (corridas, exclusividade de experiência, motor de disponibilidade, composição, cliente e pagamento).

## PRÓXIMO PASSO

**Escolher entre as opções 1 e 2 do bloqueio acima.** Feito isso, escrever a suíte em `tests/`, com catálogo semeado como pré-condição e limpeza das tabelas de movimento em cada teste. Nunca mockar o relógio do Node: o sistema usa `now()` do banco de propósito, então lead time e expiração se testam manipulando dados (`hold_expires_at` no passado, `start_at` explícito).

Com a suíte verde, a Fase 1 fecha e começa a Fase 2 (pagamento), que depende dos pré-requisitos do Asaas listados abaixo.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas no banco
- **Produção:** NUNCA migrou. Banco vazio. A primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate": repo e banco em acordo
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration; o drizzle-kit não as gera

## Banco local

Catálogo semeado e íntegro: 1 tenant, 13 settings, 2 recursos, 2 experiências, 2 faixas de horário. Tabelas de movimento vazias. Os testes futuros devem assumir o catálogo como pré-condição e nunca apagá-lo.

## Pendências e dívidas conhecidas

- **Pré-requisitos do Asaas (CLAUDE.md seção 18) travam a Fase 2 inteira** e dependem do cliente: conta aprovada com prova de vida, chave Pix cadastrada, API keys de produção e sandbox. Cobrar do Terra Trilha antes de começar a Fase 2
- **18 valores PROVISÓRIOS no template do Quadri Club**, todos em `lib/templates/quadriciclo.ts` e localizáveis por `grep -n "PROVISORIO"`. O de maior impacto: se o lançamento será com pagamento integral ou com sinal, decisão que também define a urgência da chave Pix. Ponto de atenção separado: `reply_to_email` está como `contato@aventix.com.br`, e esse endereço aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **Reserva expirada mantém `reservation_payments` em `pending`.** A seção 12 nova não pede mais o cancelamento das cobranças na expiração. O job de reconciliação da Fase 2 vai encontrar essas linhas; o filtro da seção 8-B provavelmente precisa excluir reservas `expired`, não só `cancelled`
- **Sem proteção contra duplo clique** em `POST /api/reservations`: duas requisições idênticas criam duas reservas quando há recursos sobrando. Defesa natural é desabilitar o botão na Fase 3
- **Termo sem versão vigente:** não há tabela nem chave em settings guardando texto e versão atual. O servidor valida presença, não que a versão seja a corrente. Resolver na Fase 3
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o formato não-ISO. Duas já corrigidas (`holdExpiresAt`, `customer.createdAt`). Regra na seção 3 do CLAUDE.md
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica como defesa; a correção de origem é validar no CRUD de horários (Fase 3)
- **`lib/reservations.ts` arrasta `availability.ts` e `tenant.ts`** para quem só quer `setReservationStatus`, porque `createReservation` mora no mesmo arquivo. Não incomoda dentro do Next. Passa a incomodar se o cron ou o job de reconciliação rodarem como processo Node separado
- **Experiência gratuita** (`price_cents = 0`) não é suportada; registrado na seção 4.6
- **Cron em dev:** o timer agendado guarda a versão do módulo carregada no boot. Editar `lib/jobs/expire-holds.ts` não muda o comportamento do tick até reiniciar o servidor

## Prazo

Go-live 24/08. Faltam as Fases 2 (pagamento), 3 (interfaces, a mais pesada) e 4 (integrações e hardening). Ritmo de ~2h/dia. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
