# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-09

## Onde estamos

**Fase 3 (interfaces), 6 de 9 tarefas.** Fases 0 e 1 completas. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas travam a Fase 2 inteira, então as telas que não dependem de pagamento vêm primeiro.

Tarefas da Fase 3: **auth (pronta)**, **calendário — grade (pronta)**, **calendário — painel de detalhes e cancelamento (pronta)**, **CRUD de experiências (pronta)**, **formulário público (pronto, com termo real; pagamento em placeholder, aguardando Fase 2)**, **termo real (pronto, esta sessão)**, CRUD de recursos, horários e bloqueios, configurações, clientes sem faturas, agenda compartilhada.

O sistema **vende de ponta a ponta** com termo de verdade: um cliente entra em `aventix.com.br`, escolhe, preenche contato de emergência, lê e aceita o termo real (rolagem obrigatória), e a reserva nasce `pending_payment` com hold de 15 min. Falta cobrar (Fase 2).

## Pronto

**Fase 0 e 1 (completas)** — schema de 13 tabelas com exclusion constraint, tenant/settings, motor de disponibilidade, criação transacional, cron de expiração de hold, seed como template de segmento, `POST /api/reservations` e `GET /api/availability`.

**Fase 3, tarefas 1 a 3** — `lib/auth.ts` + `proxy.ts`; calendário nativo (dia/semana/mês) em UMA query; painel sobreposto de detalhe + cancelamento sobre `setReservationStatus`.

**Congelamento da venda (`fa8d213` + `9051eb3`)**
- Migration `0001`: `reservations.duration_minutes` e `buffer_minutes`, NOT NULL, com backfill
- `createReservation` grava o snapshot; `lib/calendar.ts` e `lib/reservation-detail.ts` passaram a ler dele em vez do JOIN com `experiences`

**Fase 3, tarefa 4: CRUD de experiências (`4b08d95`)**
- `lib/experiences.ts` + `GET|POST /api/admin/experiences` + `PATCH /{id}`, sem DELETE
- `app/(admin)/admin/experiencias/`: lista com inativas esmaecidas, form com preço em reais

**Fase 3, tarefa 5: formulário público (`cbc32ff` + `00dc154`)**
- `app/(public)/page.tsx` na raiz, wizard de 6 passos, mobile-first, estado 100% no cliente até o POST final
- `GET /api/experiences` público e `lib/resources.ts`

**Termo real e contato de emergência (`cbcfd20` + `fafca60`, esta sessão)**
- `lib/terms/quadriciclo-v1.ts`: `TERM_VERSION = '2026-08-01'` + `TERM_TEXT`, texto real do Quadri Club, versionado por arquivo (não por admin — decisão registrada em `docs/DECISOES.md`)
- Migration `0002`: `reservations.emergency_contact_name` e `emergency_contact_phone`, nullable de propósito
- `createReservation` exige `emergencyContact { name, phone }`, valida o nome e normaliza o telefone com `normalizePhone` (mesma regra do telefone do cliente)
- Passo 5 do wizard reescrito por completo: bloco de contato de emergência (nome + telefone, obrigatórios), bloco do termo com caixa de rolagem e checkbox 1 que só habilita após rolar até o fim, checkbox 2 opcional (uso de imagem)
- `GET /api/admin/reservations/{id}` e o painel de detalhe (`reservation-panel.tsx`) passaram a expor o contato de emergência ao dono, numa seção própria
- CLAUDE.md atualizado (seções 4.4, 7.1, 7.2, 10, 14): removida a menção a `/api/termo` e `/admin/termo/page.tsx`, que nunca existiram e não vão existir nesta arquitetura

## O que esta sessão fez

1. **Termo de responsabilidade real**, substituindo o placeholder (`version: 'PROVISORIO'`, um checkbox solto) pelo texto jurídico completo do Quadri Club, com rolagem obrigatória.
2. **Contato de emergência**, campo novo ponta a ponta: migration → `createReservation` → wizard → exposição no admin.
3. **CLAUDE.md corrigido** para parar de descrever uma tela de edição de termo que nunca foi construída (nem vai ser, por decisão desta sessão).
4. Dois commits, ambos com `git show --stat` conferido antes da mensagem, e pushed para `origin/main`: `cbcfd20` (backend: termo, migration, `createReservation`, exposição admin) e `fafca60` (passo 5 do wizard).

Verificado ao fim: `npx tsc --noEmit` limpo, `eslint` limpo, `npm test` com **34 passed**, `npm run db:generate` sem mudanças. Reserva real criada via `curl` contra `POST /api/reservations` e conferida por `psql` (`termo_version`, `emergency_contact_name/phone` gravados certos) e por leitura direta de `getReservationDetail()` (o que a rota do admin executa). Reservas de teste removidas do banco local ao final.

## PRÓXIMO PASSO

**Ainda pendente de sessões anteriores, não tocado nesta:** decidir a regra dos 18 anos para condutor (bloqueia nada, mas é decisão de negócio pendente e barata de resolver — ver Pendências) e seguir para o **CRUD de recursos** (tarefa 7 de 9).

O CRUD de recursos é pequeno e tem lar pronto: `lib/resources.ts` já existe com a leitura. Campos: nome, `capacity`, `active`. Mesma forma do CRUD de experiências (sem DELETE, desativar por `active=false`, 422 para corpo inválido). Atenção: o número de recursos ativos é o teto de `resourcesNeeded` no formulário público e o número de colunas do calendário, então desativar recurso com reserva futura ativa precisa ser pensado — a reserva aponta para o recurso em `reservation_resources`.

**Depois:** horários e bloqueios, configurações, clientes, agenda compartilhada.

## Migrations

- **Três migrations:** `drizzle/0000_oval_mandroid.sql`, `drizzle/0001_busy_tomorrow_man.sql`, `drizzle/0002_emergency_contact.sql`
- **Local:** as três aplicadas (`drizzle.__drizzle_migrations` tem 3 linhas, conferido nesta sessão)
- **Produção:** NUNCA migrou. Banco vazio. As três entram juntas no checklist de go-live; o backfill da 0001 e a 0002 nullable são no-op/seguras lá
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- A 0001 é **editada à mão** e precisa continuar assim se for regerada: o drizzle-kit emite `ADD COLUMN NOT NULL`, que aborta em tabela com linhas. A 0002 é gerada sem edição (`ADD COLUMN` simples, nullable)

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar. Catálogo semeado e intacto (2 recursos ativos capacity 2, 2 experiências ativas, `payment_mode='full'`). As 6 reservas de demonstração (`npm run db:seed:demo`) foram atualizadas nesta sessão para incluir `emergencyContact` — se ainda não foram re-semeadas depois da migration 0002, os campos de emergência delas estão `NULL` até rodar o seed de novo.

## Pendências e dívidas conhecidas

**Decisão de negócio pendente**
- **A regra dos 18 anos para condutor não existe no servidor.** `POST /api/reservations` com condutor de 13 anos responde **201**. A validação inline do formulário público é hoje a **única** barreira. Anotado em `app/(public)/_components/types.ts`
- **Lançamento com pagamento integral ou com sinal?** Trava o recorte do CRUD de experiências e a tela de pagamento

**Fase 2 (dependem do cliente)**
- Pré-requisitos do Asaas (CLAUDE.md seção 18): conta aprovada com prova de vida, chave Pix, API keys, webhook com token próprio, régua de notificações ajustada
- `reservations.payment_state` é `'pending'` em toda reserva, inclusive confirmadas, porque nada marca cobrança como paga antes da Fase 2
- O painel não tem cobrança de saldo nem "Recebi por fora"; ponto de entrada comentado no arquivo

**Formulário público**
- **Termo real, mas sem checagem de versão vigente no servidor.** `createReservation` valida só a PRESENÇA de `termo.version`/`acceptedAt`, não que a versão bata com `TERM_VERSION` atual. Um POST direto com `version: "qualquer coisa"` ainda passa
- **Telefone do contato de emergência reaproveita `normalizePhone()`**, então um erro 400 dele chega com a mesma mensagem genérica de um erro do telefone do cliente — sem distinguir de quem é (decisão registrada, baixo risco: o wizard nunca deixa o campo vazio chegar ao servidor)
- **Pagamento continua placeholder**: "Pix em breve" com id, valor e contador do hold. Sem QR falso. Pontos de costura da Fase 2 comentados
- **A grade não mostra horário insuficiente.** `GET /api/availability` não informa quantos recursos sobram num horário; horário que não comporta N simplesmente não aparece
- **Sem campo de CPF** no formulário. A rota aceita e o schema tem a coluna
- `app/(public)/reserva/[id]/page.tsx` e `agenda/[token]` da seção 14 ainda não existem

**Gerais**
- `getDayGrid` duplica a precedência exceção-sobre-`operating_hours` que já vive em `lib/availability.ts`. Unificar quando o CRUD de horários virar o terceiro consumidor
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto` não suportado), poluindo o log de dev a cada request
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`, `GET /api/experiences` e `POST /api/reservations` — todas públicas ou expostas. Hardening da Fase 4
- Sessão sem revogação (iron-session, 8h). Aceito no MVP de usuário único
- A âncora dos testes de lead time vence em junho de 2027; vencida, falha com instrução de trocar a data
- Cancelamento e CRUD de experiências não têm teste automatizado
- A página `/admin/reservas/[id]` da seção 14 não existe; o painel sobreposto cobre o dia a dia
- **14 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts` (`grep -n "PROVISORIO"`, recontado nesta sessão — a nota anterior dizia 11), incluindo `reply_to_email` como `contato@aventix.com.br`, que aparece ao cliente final onde a regra de marca manda aparecer o tenant
- A exclusion constraint não é exercitada pela suíte (com `single_experience_per_slot=true` o perdedor cai no recheck antes)
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor; a defesa é o botão desabilitado no formulário
- `mode:'string'` no schema: toda nova função que retorne `timestamptz` reintroduz o formato não-ISO (seção 3)
- `operating_hours` permite faixas sobrepostas no mesmo weekday; corrigir no CRUD de horários
- Experiência gratuita não é suportada (seção 4.6); o CRUD recusa
- Cron em dev: o timer guarda a versão do módulo carregada no boot

## Deploy

`main` está em `fafca60` e foi pushed. O Easypanel constrói a partir do repo — **se o build for automático, o formulário público com termo real está indo ao ar em `aventix.com.br`**, com pagamento em placeholder. Não foi verificado nesta sessão como o build está configurado lá.

## Prazo

Go-live 24/08. Faltam 3 tarefas de admin da Fase 3 (recursos, horários/bloqueios, configurações) mais clientes e agenda compartilhada, a Fase 2 inteira (à espera do Asaas) e a Fase 4. Ritmo de cerca de 2h/dia. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
