# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-04

## Onde estamos

**Fase 3 (interfaces), 5 de 9 tarefas.** Fases 0 e 1 completas. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas travam a Fase 2 inteira, então as telas que não dependem de pagamento vêm primeiro.

Tarefas da Fase 3: **auth (pronta)**, **calendário — grade (pronta)**, **calendário — painel de detalhes e cancelamento (pronta)**, **CRUD de experiências (pronta)**, **formulário público (pronta, com termo e pagamento em placeholder)**, CRUD de recursos, horários e bloqueios, configurações, termo real, clientes sem faturas, agenda compartilhada.

O sistema agora **vende de ponta a ponta**: um cliente entra em `aventix.com.br`, escolhe, preenche e a reserva nasce `pending_payment` com hold de 15 min. Falta cobrar (Fase 2).

## Pronto

**Fase 0 e 1 (completas)** — schema de 13 tabelas com exclusion constraint, tenant/settings, motor de disponibilidade, criação transacional, cron de expiração de hold, seed como template de segmento, `POST /api/reservations` e `GET /api/availability`.

**Fase 3, tarefas 1 a 3** — `lib/auth.ts` + `proxy.ts`; calendário nativo (dia/semana/mês) em UMA query; painel sobreposto de detalhe + cancelamento sobre `setReservationStatus`.

**Congelamento da venda (`fa8d213` + `9051eb3`)**
- Migration `0001`: `reservations.duration_minutes` e `buffer_minutes`, NOT NULL, com backfill
- `createReservation` grava o snapshot; `lib/calendar.ts` e `lib/reservation-detail.ts` passaram a ler dele em vez do JOIN com `experiences`
- `tests/g-congelamento.test.ts`: 4 casos, validados contra a versão antiga antes de entrar

**Fase 3, tarefa 4: CRUD de experiências (`4b08d95`)**
- `lib/experiences.ts` + `GET|POST /api/admin/experiences` + `PATCH /{id}`, sem DELETE
- `app/(admin)/admin/experiencias/`: lista com inativas esmaecidas, form com preço em reais, confirmação leve para desativar
- Validação no servidor: preço > 0, duração > 0, buffer >= 0, nome não vazio, `deposit` recusado com 422

**Fase 3, tarefa 5: formulário público (`cbc32ff` + `00dc154`)**
- `app/(public)/page.tsx` **na raiz** (paga a dívida do route group; removeu o placeholder do create-next-app)
- Wizard de 6 passos, mobile-first, estado 100% no cliente até o POST final
- `GET /api/experiences` público (só ativas, sem `active` nem `buffer_minutes`) e `lib/resources.ts`
- Todos os rótulos de `settings`, inclusive o rótulo do passo; o formulário deriva da configuração
- Termo e pagamento são **placeholder**, marcados no código

## O que esta sessão fez

1. **Congelamento de duração e buffer** — migration 0001 editada à mão (nullable → backfill → NOT NULL), backfill híbrido (`period` para o total, experiência para a divisão), com ramo degenerado e log de pós-condição.
2. **CRUD de experiências**, primeira tela que escreve catálogo.
3. **Formulário público de agendamento** ponta a ponta, com uma reserva real criada e conferida no banco.
4. **CLAUDE.md atualizado**: seção 4.4 (as duas colunas), 4.6 (invariante do snapshot), 7.2 (rotas do CRUD e o recorte do sinal), 14 (árvore com `reservation-detail.ts`, `experiences.ts`, `resources.ts`).
5. Corrigidos de carona: título da aba e `lang="pt-BR"`; `.claude/launch.json` no `.gitignore`.

Verificado ao fim: `npx tsc --noEmit` limpo, `npm run lint` limpo, `npm test` com **34 passed**, `npm run db:generate` sem mudanças.

## PRÓXIMO PASSO

**Decidir o que fazer com a regra dos 18 anos** (bloqueia nada, mas é decisão de negócio pendente e barata de resolver) e seguir para o **CRUD de recursos** (tarefa 6 de 9).

O CRUD de recursos é pequeno e tem lar pronto: `lib/resources.ts` já existe com a leitura. Campos: nome, `capacity`, `active`. Mesma forma do CRUD de experiências (sem DELETE, desativar por `active=false`, 422 para corpo inválido). Atenção: o número de recursos ativos é o teto de `resourcesNeeded` no formulário público e o número de colunas do calendário, então desativar recurso com reserva futura ativa precisa ser pensado — a reserva aponta para o recurso em `reservation_resources`.

**Depois:** horários e bloqueios, configurações, termo real, clientes, agenda compartilhada.

## Migrations

- **Duas migrations:** `drizzle/0000_oval_mandroid.sql` e `drizzle/0001_busy_tomorrow_man.sql`
- **Local:** as duas aplicadas (`drizzle.__drizzle_migrations` tem 2 linhas, conferido nesta sessão)
- **Produção:** NUNCA migrou. Banco vazio. As duas entram juntas no checklist de go-live; o backfill da 0001 será no-op lá
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- A 0001 é **editada à mão** e precisa continuar assim se for regerada: o drizzle-kit emite `ADD COLUMN NOT NULL`, que aborta em tabela com linhas

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar. Catálogo semeado e conferido intacto (2 recursos ativos capacity 2, 2 experiências ativas, `payment_mode='full'`). As 6 reservas de demonstração existem; a suíte de testes as apaga, então rode `npm run db:seed:demo` antes de olhar as telas.

## Pendências e dívidas conhecidas

**Decisão de negócio pendente**
- **A regra dos 18 anos para condutor não existe no servidor.** MEDIDO nesta sessão: `POST /api/reservations` com condutor de 13 anos respondeu **201**. A validação inline do formulário público é hoje a **única** barreira, e um POST direto a ignora. A regra também não está no CLAUDE.md. Se ela é real (conduzir quadriciclo exige CNH, que exige 18), o lugar é `createReservation` + seção 15, e o front volta a ser conveniência. Anotado em `app/(public)/_components/types.ts`
- **Lançamento com pagamento integral ou com sinal?** Trava o recorte do CRUD de experiências e a tela de pagamento

**Fase 2 (dependem do cliente)**
- Pré-requisitos do Asaas (CLAUDE.md seção 18): conta aprovada com prova de vida, chave Pix, API keys, webhook com token próprio, régua de notificações ajustada
- `reservations.payment_state` é `'pending'` em toda reserva, inclusive confirmadas, porque nada marca cobrança como paga antes da Fase 2. O painel exibe "em aberto" numa reserva confirmada; é o dado correto do banco
- Reserva expirada mantém `reservation_payments` em `pending`. O filtro do job de reconciliação (seção 8-B) provavelmente precisa excluir `expired`, não só `cancelled`
- O painel não tem cobrança de saldo nem "Recebi por fora"; ponto de entrada comentado no arquivo

**Formulário público**
- **Termo é placeholder**: um checkbox, envia `version: "PROVISORIO"`. A tarefa do Termo põe texto versionado com scroll-to-end. IP e user-agent **já** são capturados pela rota
- **Pagamento é placeholder**: "Pix em breve" com id, valor e contador do hold. Sem QR falso. Pontos de costura da Fase 2 comentados
- **A grade não mostra horário insuficiente.** `GET /api/availability` devolve `{ startAt, label }` e já filtra por `resourcesNeeded`; não informa quantos recursos sobram num horário, então horário que não comporta N simplesmente não aparece. Melhoria: o motor devolver `freeResources` por slot
- **Sem campo de CPF** no formulário. A rota aceita e o schema tem a coluna
- `app/(public)/reserva/[id]/page.tsx` e `agenda/[token]` da seção 14 ainda não existem

**Gerais**
- `getDayGrid` duplica a precedência exceção-sobre-`operating_hours` que já vive em `lib/availability.ts`. Unificar quando o CRUD de horários virar o terceiro consumidor
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto` não suportado), poluindo o log de dev a cada request
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`, `GET /api/experiences` e `POST /api/reservations` — todas públicas ou expostas. Hardening da Fase 4
- Sessão sem revogação (iron-session, 8h). Aceito no MVP de usuário único
- A âncora dos testes de lead time vence em junho de 2027; vencida, falha com instrução de trocar a data
- Cancelamento e CRUD de experiências não têm teste automatizado (a lógica de estado já é coberta; o que entrou é tradução HTTP, verificada por curl)
- A página `/admin/reservas/[id]` da seção 14 não existe; o painel sobreposto cobre o dia a dia
- **11 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts` (`grep -n "PROVISORIO"`), incluindo `reply_to_email` como `contato@aventix.com.br`, que aparece ao cliente final onde a regra de marca manda aparecer o tenant
- `ce3e4c6` tem mensagem que não bate com o conteúdo; já está em `origin`
- A exclusion constraint não é exercitada pela suíte (com `single_experience_per_slot=true` o perdedor cai no recheck antes)
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor; a defesa é o botão desabilitado no formulário
- Termo sem versão vigente: o servidor valida presença, não que a versão seja a corrente
- `mode:'string'` no schema: toda nova função que retorne `timestamptz` reintroduz o formato não-ISO (seção 3)
- `operating_hours` permite faixas sobrepostas no mesmo weekday; corrigir no CRUD de horários
- Experiência gratuita não é suportada (seção 4.6); o CRUD recusa
- Cron em dev: o timer guarda a versão do módulo carregada no boot

## Deploy

`main` está em `00dc154` e foi pushed. O Easypanel constrói a partir do repo — **se o build for automático, o formulário público está indo ao ar em `aventix.com.br`** com termo provisório e pagamento em placeholder. Não foi verificado nesta sessão como o build está configurado lá.

## Prazo

Go-live 24/08. Faltam 4 tarefas de admin da Fase 3, o termo real, a Fase 2 inteira (à espera do Asaas) e a Fase 4. Ritmo de cerca de 2h/dia. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
