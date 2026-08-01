# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-01

## Onde estamos

**Fase 3 (interfaces), 1 de 8 tarefas de admin.** Fase 1 (Núcleo) completa. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas atrasaram e travam a Fase 2 inteira, então as telas de admin que não dependem de pagamento vêm primeiro.

Tarefas de admin da Fase 3, na ordem prevista: **auth (pronta)**, calendário nativo (fatiado em grade de visualização e depois painel de detalhes/cancelamento), CRUD de experiências, CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada por link secreto.

Esta sessão não avançou tarefa nova: foi recuperação de trabalho validado que um `rebase --abort` havia descartado.

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
- `tests/`: 30 casos em 6 arquivos, com `tests/global-setup.ts` migrando e semeando sozinho

**Fase 3, tarefa 1: autenticação do admin (completa, commit `709cf4d`)**
- `lib/auth.ts` como fronteira única, `proxy.ts` protegendo `/admin/*` e `/api/admin/*`
- Telas de login e placeholder do painel, rotas de login/logout, `npm run auth:hash`
- `tests/f-auth.test.ts`: 5 casos de política de rotas, verdes, sem tocar o banco

## O que esta sessão fez

Recuperação de `d037245`, commit que ficou órfão depois de um `rebase --abort` seguido de `pull`. O reflog mostrava o commit íntegro no object database, então a recuperação foi por `git cherry-pick` (aplicou limpo), não por reescrita à mão, para não arriscar produzir algo diferente do que já tinha sido validado.

Commitado e pushed (`origin/main` = `c60fa66`):
- `b7674e1` (cherry-pick): `tests/global-setup.ts` ligado no `vitest.config.ts`, `lib/seed.ts` com `seedTenant()` chamável, `assertCatalogSeeded` resolvendo experiências por nome a partir do template, testes 15 e 15b ancorados em `TEMPLATE_EXP.*.priceCents`
- `c60fa66`: valores do modo `deposit` em `e-cliente-pagamento` derivam de `DEPOSIT_PCT_FIXTURE` e `DEPOSIT_FIXED_FIXTURE` em vez de doze literais repetidos

Verificado: `npx tsc --noEmit` limpo; `docker compose down -v` seguido de `npm test` roda a partir de banco VAZIO, sem `db:seed` manual, imprimindo `[global-setup] catalogo semeado (19 registro(s) criado(s))`; segunda rodada dá placar idêntico com o setup em silêncio.

Placar das duas rodadas: `1 failed | 29 passed (30)`. A falha é a pendência de prioridade máxima abaixo.

## PRÓXIMO PASSO

**Decidir e aplicar o conserto do teste `10c` de `tests/c-disponibilidade.test.ts`**, que falha por hora do dia. Diagnóstico fechado, decisão em aberto (três opções na pendência abaixo). É trabalho pequeno e vem antes do calendário porque uma suíte que fica vermelha toda noite treina a equipe a ignorar vermelho, que foi exatamente como a suíte passou dias quebrada sem ninguém notar.

**Depois:** calendário nativo do admin, fatiado em duas tarefas conforme decisão de 28/07: primeiro a **grade de visualização** (CSS Grid puro, três views, eixo recurso, filtro por experiência via chips, rolagem horizontal para escala) e depois o **painel de detalhes + cancelamento**. Tela usada no celular, em campo: priorizar legibilidade e toque. Marcador de saldo e botões de cobrança dependem da Fase 2 e ficam para a costura final.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas em `public` (conferido nesta sessão)
- **Produção:** NUNCA migrou. Banco vazio. Primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar, **recriado do zero nesta sessão** (`down -v`). Catálogo: 1 tenant, 13 settings, 2 recursos, 2 experiências, 2 faixas de horário. Movimento vazio.

As experiências voltaram a ter **id 1 e 2** (Trilha da Montanha 90 min 32549c, Trilha da Fazenda 60 min 23249c, ambas `payment_mode = 'full'`). Isso deixou de importar: a suíte resolve experiência por nome a partir do template, não por id fixo.

## Pendências e dívidas conhecidas

- **TESTE `10c` VERMELHO POR HORA DO DIA, prioridade máxima.** `tests/c-disponibilidade.test.ts:188` falha quando rodado depois das 19:30. Mecânica: `EXP.curta` dura 60 min e a grade do teste fecha 23:30, então o último slot possível começa 22:30; com `min_lead_minutes` 180 o corte é `agora + 3h`, e passadas as 19:30 nenhum slot sobrevive. `primeiroSlot()` devolve `null` e `toBeGreaterThanOrEqual(null)` estoura com `received "object"`. O mesmo mecanismo derruba `10b` e `10d` depois das 20:30. É pré-existente, não foi introduzido nesta sessão, e o commit original passou porque foi rodado às 16:50. Conserto NÃO aplicado por ser decisão de design, com a regra do projeto proibindo mockar relógio e a grade não atravessando meia-noite. Opções levantadas: (a) `closes` para 23:59, que só move a fronteira para 19:59; (b) semear grade para hoje e amanhã e consultar a data onde o corte cai, que perto da meia-noite degenera a asserção do "30 min antes"; (c) o teste calcular o último início viável e só afirmar quando o cenário for construível, honesto e sem flake, ao custo de não exercitar nada tarde da noite. Recomendação registrada: (c), com log quando o cenário não for construível, para não virar teste que passa sem testar
- **`docs/DECISOES.md` afirma algo que o CLAUDE.md não reflete.** A entrada "Views do calendário" diz que o contrato de dados de `GET /api/admin/calendar` foi "registrado na seção 11.1 do CLAUDE.md", mas a seção 11.1 atual não contém contrato de dados nenhum, só a descrição visual da tela. Provável perda do mesmo `rebase --abort`. Resolver antes de construir o calendário, que é justamente quem consome esse contrato. O texto do contrato não foi reconstruído aqui porque seria invenção, não recuperação
- **Sem rate limiting no login.** `POST /api/admin/login` aceita tentativas ilimitadas. O custo do bcrypt (cerca de 250ms) atrasa, mas não é defesa. TODO no arquivo, previsto para o hardening da Fase 4
- **Sessão sem revogação.** O estado vive no cookie (iron-session), não no banco. Cookie roubado vale até expirar, 8h. Única forma de invalidar sessões abertas é trocar `SESSION_SECRET`. Aceito no MVP de usuário único
- **DEPENDÊNCIA DA FASE 2 (não é o próximo passo):** pré-requisitos do Asaas (CLAUDE.md seção 18) dependem do cliente e travam a Fase 2 inteira: conta aprovada com prova de vida, chave Pix cadastrada, API keys de produção e sandbox, webhook com token próprio, régua de notificações ajustada. Junto vem a decisão de negócio que muda o desenho dela: **lançamento com pagamento integral ou com sinal?** As duas experiências estão em `payment_mode: 'full'`; o modo `deposit` está implementado e testado (contra fixtures da própria suíte, já que o catálogo real não tem experiência `deposit`), trocar são dois campos e rodar o seed
- **11 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts`, localizáveis por `grep -n "PROVISORIO"`. Nomes, durações e preços das trilhas já foram confirmados. Seguem provisórios: `min_lead_minutes`, ponto de encontro, o que levar, política de sinal, nomes dos recursos, grade de horários, os dois `paymentMode`, e o `reply_to_email`, que está como `contato@aventix.com.br` e aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **`ce3e4c6` tem mensagem que não bate com o conteúdo.** Diz "test: verificação de preço independente" e não toca `tests/`; o diff é 100% `lib/templates/quadriciclo.ts`. Já está em `origin`, nada a fazer além de saber
- **`app/` não usa o route group `(public)`** que a seção 14 especifica. A home e as rotas públicas estão na raiz de `app/`; só o admin ganhou `(admin)`. Divergência cosmética, a resolver quando o formulário público for construído
- **Layout raiz ainda é o do `create-next-app`:** `lang="en"` e título "Create Next App" em `app/layout.tsx`, servindo telas em português. Corrigir junto com a primeira tela de verdade
- **A exclusion constraint não é exercitada pela suíte.** Com `single_experience_per_slot=true` a criação toma advisory lock e serializa, então o perdedor sempre cai no recheck. Medido: 0 via constraint, 10 via recheck. Verificada manualmente com o flag desligado
- **Reserva expirada mantém `reservation_payments` em `pending`.** O job de reconciliação da Fase 2 vai encontrar essas linhas; o filtro da seção 8-B provavelmente precisa excluir `expired`, não só `cancelled`
- **Sem proteção contra duplo clique** em `POST /api/reservations`. Defesa natural é desabilitar o botão na tela
- **Termo sem versão vigente:** não há onde guardar texto e versão atual. O servidor valida presença, não que a versão seja a corrente
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o formato não-ISO. Regra na seção 3
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica; a correção de origem é validar no CRUD
- **`lib/reservations.ts` arrasta `availability.ts` e `tenant.ts`** para quem só quer `setReservationStatus`. Não incomoda dentro do Next
- **Experiência gratuita** (`price_cents = 0`) não é suportada; seção 4.6
- **Cron em dev:** o timer guarda a versão do módulo carregada no boot. Editar `lib/jobs/expire-holds.ts` não muda o tick até reiniciar

## Prazo

Go-live 24/08. Faltam a Fase 3 (a mais pesada, 7 tarefas de admin restantes mais o fluxo público), a Fase 2 (à espera do Asaas) e a Fase 4 (integrações e hardening). Ritmo de cerca de 2h/dia. Custo aceito da inversão: Fases 2 e 3 serão costuradas no fim em vez de sequenciais. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
