# Estado atual — Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-07-27

## Onde estamos

**Fase 1 (Núcleo), 7 de 10 tarefas concluídas.** Go-live: 24/08/2026.

Todo o núcleo de agendamento em `lib/` está pronto e testado contra o banco. Falta expor pela API, semear dados e fechar a fase.

## Pronto

**Fase 0 — Fundação (completa)**
- Repo GitHub, Next.js 16 + TypeScript, Drizzle, Postgres local via Docker
- Deploy no VPS Hostinger via Easypanel: `aventix.com.br` no ar com HTTPS
- `/api/health` respondendo `{"ok":true,"db":"up"}` em local e produção

**Fase 1 — Núcleo (7 de 10)**
- `lib/db/schema.ts` — 13 tabelas, 8 enums, `btree_gist`, exclusion constraint anti-overbooking (testada funcionalmente: recusa sobreposição)
- `lib/tenant.ts` — `getTenantId`, settings cacheadas com TTL 60s, `getSetting`, `getBooleanSetting`, `getNumberSetting`, `invalidateSettingsCache`
- `lib/time.ts` — conversões America/Sao_Paulo ↔ UTC, validação de data de calendário
- `lib/reservations.ts` — `setReservationStatus`, `recalcReservationPayment`, `findOrCreateCustomer` + `normalizePhone`, `createReservation`
- `lib/availability.ts` — motor completo: precedência de `schedule_exceptions`, grade, buffer, blackouts, exclusividade de experiência, antecedência configurável
- `app/api/reservations/route.ts` — POST funcionando, validado via curl (201)

## Falta na Fase 1

1. **Seed como template de segmento** (`lib/templates/quadriciclo.ts`) — destrava o teste ponta a ponta; o banco está vazio hoje
2. **Rota `GET /api/availability`** — o motor está pronto, falta só expor (tarefa pequena)
3. **Cron de expiração de hold** (15 min)
4. **Testes de corrida** (suíte formal; corridas já foram validadas pontualmente)

## PRÓXIMO PASSO

**Seed do Quadri Club** — criar `lib/templates/quadriciclo.ts` no formato de template de segmento (CLAUDE.md seção 11-B) e aplicar ao tenant 1: settings reais, 2 quadriciclos (capacity 2), 2 experiências, sábado e domingo 08:00–18:00, `single_experience_per_slot=true`.

Depois dele: rota `GET /api/availability`, e então o teste ponta a ponta via curl (consultar horários → criar reserva → confirmar que a vaga sumiu da grade), que é o marco da Fase 1.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, contém o schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha
- **Produção:** NUNCA migrou. Banco vazio, sem tabelas. A primeira migration em produção entra no checklist de go-live
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration — o drizzle-kit não as gera

## Pendências e dívidas conhecidas

- **Pré-requisitos do Asaas (CLAUDE.md seção 18) travam a Fase 2 inteira** e dependem do cliente, não do código: conta aprovada com prova de vida, chave Pix cadastrada, API keys de produção e sandbox. Cobrar do Terra Trilha antes de começar a Fase 2
- **Conflito na seção 12:** o documento pede cron via `pg_cron`, mas `pg_cron` roda SQL dentro do Postgres e não consegue chamar `setReservationStatus`. Fazer o cron escrever SQL direto violaria a regra inviolável da seção 4.6. Escolher entre `node-cron` no processo Next ou agendador externo chamando rota protegida. A seção 12 precisará de ajuste
- **Sem proteção contra duplo clique** em `POST /api/reservations`: duas requisições idênticas criam duas reservas quando há recursos sobrando. Defesa natural é desabilitar o botão na Fase 3
- **Termo sem versão vigente:** não há tabela nem chave em settings guardando o texto e a versão atual do termo. O servidor valida presença, não que a versão seja a corrente. Resolver na Fase 3
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o problema de formato não-ISO. Duas já foram corrigidas (`holdExpiresAt`, `customer.createdAt`). Regra registrada na seção 3 do CLAUDE.md
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica como defesa; a correção de origem é validar no CRUD de horários (Fase 3)
- **Experiência gratuita** (`price_cents = 0`) não é suportada — registrado na seção 4.6

## Prazo

Go-live 24/08. Faltam as Fases 2 (pagamento), 3 (interfaces, a mais pesada) e 4 (integrações e hardening). Ritmo de ~2h/dia. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
