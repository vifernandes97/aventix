# Estado atual — Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-07-28

## Onde estamos

**Fase 1 (Núcleo) COMPLETA, 10 de 10 tarefas. Em curso: Fase 3 (interfaces), por inversão de ordem.** Go-live: 24/08/2026.

O núcleo funciona ponta a ponta pela API e está coberto por suíte automatizada verde.

**A ordem das fases foi invertida** (decisão de 28/07 em `docs/DECISOES.md`): os pré-requisitos do Asaas atrasaram e travam a Fase 2 inteira, então construímos primeiro as telas de **admin** da Fase 3 que não dependem de pagamento — auth, calendário nativo, CRUDs de catálogo, configurações, clientes (sem faturas), agenda compartilhada. A Fase 2 e o miolo do fluxo público de compra (tela de pagamento Pix, criação de cobrança) ficam para depois.

## Pronto

**Fase 0 — Fundação (completa)**
- Repo GitHub, Next.js 16 + TypeScript, Drizzle, Postgres local via Docker
- Deploy no VPS Hostinger via Easypanel: `aventix.com.br` no ar com HTTPS

**Fase 1 — Núcleo (completa)**
- `lib/db/schema.ts` — 13 tabelas, 8 enums, `btree_gist`, exclusion constraint anti-overbooking
- `lib/tenant.ts` — tenant + settings cacheadas (TTL 60s), acessores tipados booleano e numérico
- `lib/time.ts` — conversões America/Sao_Paulo ↔ UTC, validação de data de calendário
- `lib/reservations.ts` — `setReservationStatus`, `recalcReservationPayment`, `findOrCreateCustomer` + `normalizePhone`, `createReservation`
- `lib/availability.ts` — motor completo (exceções de agenda, buffer, blackouts, exclusividade, lead time)
- `lib/templates/` + `scripts/seed.ts` — template de segmento do Quadri Club, seed idempotente
- `lib/jobs/expire-holds.ts` + `instrumentation.ts` — cron de expiração de hold, node-cron, a cada minuto
- `app/api/reservations/route.ts` (POST) e `app/api/availability/route.ts` (GET)
- `tests/` — 25 casos em 5 arquivos, Vitest, contra o Postgres real. `npm test` VERDE

Dependências: `date-fns-tz`, `zod`, `server-only`, `node-cron`, `tsx` (dev), `vitest` (dev).

## Cobertura da suíte

Grupos A a E: corridas com barreira em 10 rodadas (zero double-booking), rollback total, grade desatualizada, exclusividade de experiência nos dois sentidos, adjacência de `[)` nas duas pontas, precedência de `schedule_exceptions`, blackout, buffer contra `closes`, lead time em 4 variações incluindo valor corrompido, composição (operadores, capacidade, documento), preço no servidor, find-or-create por telefone normalizado, modo deposit e `recalcReservationPayment`.

Isolamento: `fileParallelism: false` (os arquivos compartilham o mesmo banco), catálogo como pré-condição, movimento zerado em `beforeEach` e ao fim da suíte. Rodar `npm test` duas vezes seguidas dá placar idêntico.

## PRÓXIMO PASSO

**Fase 3 — autenticação do admin (porta de entrada das telas de admin).** CLAUDE.md seção 13: login único do dono, cookie httpOnly assinado, credencial em `.env`, `proxy.ts` (Next 16, export `proxy`, runtime Node) protegendo `/admin/*` e `/api/admin/*`. Sem provider externo.

É o primeiro passo porque toda tela de admin depende dele. Não toca o banco — credencial e segredo vivem no `.env` —, então não depende do Postgres local nem do Docker.

**Decisão de segurança pendente, a ser tomada ANTES da implementação:** como a senha é guardada e como o cookie é assinado.

Depois da auth, na ordem: calendário nativo do admin, CRUDs de catálogo (experiências, recursos, horários, bloqueios), configurações, termo, clientes (sem a parte de faturas), agenda compartilhada por link secreto.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas
- **Produção:** NUNCA migrou. Banco vazio. Primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate"
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration

## Banco local

Catálogo semeado e íntegro: 1 tenant, 13 settings, 2 recursos, 2 experiências, 2 faixas de horário. Movimento vazio. A suíte depende desse catálogo; se ele sumir, rode `npm run db:seed`.

## Pendências e dívidas conhecidas

- **DEPENDÊNCIA DA FASE 2 (não é o próximo passo):** os pré-requisitos do Asaas (CLAUDE.md seção 18) dependem do cliente e travam a Fase 2 inteira — conta aprovada com prova de vida, chave Pix cadastrada, API keys de produção e sandbox, webhook com token próprio, régua de notificações ajustada. **A Fase 2 é retomada quando as telas de admin estiverem prontas E a conta estiver aprovada.** Junto vem a decisão de negócio que muda o desenho dela: **lançamento com pagamento integral ou com sinal?** As duas experiências estão em `payment_mode: 'full'` no template; o modo `deposit` está implementado e testado, trocar são dois campos e rodar o seed
- **11 valores PROVISÓRIOS** no template, em `lib/templates/quadriciclo.ts`, localizáveis por `grep -n "PROVISORIO"`. Nomes e preços das trilhas já foram confirmados (Montanha 90min / R$ 325,49 Pix; Fazenda 60min / R$ 232,49 Pix). Seguem provisórios: `min_lead_minutes`, ponto de encontro, o que levar, política de sinal, nomes dos recursos, grade de horários, os dois `paymentMode`, e o `reply_to_email` — que está como `contato@aventix.com.br` e aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **A exclusion constraint não é exercitada pela suíte.** Com `single_experience_per_slot=true` (config do Quadri Club), a criação toma advisory lock e serializa as transações, então o perdedor da corrida sempre cai no recheck de disponibilidade. Medido na suíte: 0 via constraint, 10 via recheck. A constraint foi verificada manualmente com o flag desligado (11 de 12 perdedores caíam nela), mas não há teste automatizado dela. Cobrir exigiria um caso que desliga o flag, roda a corrida e restaura
- **Reserva expirada mantém `reservation_payments` em `pending`.** A seção 12 não pede o cancelamento na expiração. O job de reconciliação da Fase 2 vai encontrar essas linhas; o filtro da seção 8-B provavelmente precisa excluir `expired`, não só `cancelled`
- **Sem proteção contra duplo clique** em `POST /api/reservations`. Defesa natural é desabilitar o botão na Fase 3
- **Termo sem versão vigente:** não há onde guardar texto e versão atual. O servidor valida presença, não que a versão seja a corrente. Fase 3
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o formato não-ISO. Regra na seção 3
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica; a correção de origem é validar no CRUD (Fase 3)
- **`lib/reservations.ts` arrasta `availability.ts` e `tenant.ts`** para quem só quer `setReservationStatus`. Não incomoda dentro do Next; incomodaria se cron ou reconciliação rodassem como processo Node separado
- **Experiência gratuita** (`price_cents = 0`) não é suportada; seção 4.6
- **Cron em dev:** o timer guarda a versão do módulo carregada no boot. Editar `lib/jobs/expire-holds.ts` não muda o tick até reiniciar

## Prazo

Go-live 24/08. Faltam a Fase 3 (interfaces, a mais pesada — em curso, começando pelo admin), a Fase 2 (pagamento, à espera do Asaas) e a Fase 4 (integrações e hardening). Ritmo de ~2h/dia. **Custo aceito da inversão:** Fases 2 e 3 serão costuradas no fim em vez de sequenciais, com mais troca de contexto. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
