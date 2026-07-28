# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-07-28

## Onde estamos

**Fase 3 (interfaces), 1 de 8 tarefas de admin.** Fase 1 (Núcleo) completa, 10 de 10. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas atrasaram e travam a Fase 2 inteira, então as telas de admin que não dependem de pagamento vêm primeiro. A autenticação, porta de entrada de todas elas, ficou pronta nesta sessão.

Tarefas de admin da Fase 3, na ordem prevista: **auth (pronta)**, calendário nativo, CRUD de experiências, CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada por link secreto.

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
- `lib/templates/` + `scripts/seed.ts`: template de segmento do Quadri Club, seed idempotente
- `lib/jobs/expire-holds.ts` + `instrumentation.ts`: cron de expiração de hold, a cada minuto
- `app/api/reservations/route.ts` (POST) e `app/api/availability/route.ts` (GET)
- `tests/`: 25 casos em 5 arquivos. **ATENÇÃO: vermelhos hoje, ver pendências**

**Fase 3, tarefa 1: autenticação do admin (completa, commit `709cf4d`)**
- `lib/auth.ts`: fronteira única. `verifyCredentials`, `getCurrentUser`, `getUserFromRequest`, `createSession`, `destroySession`, `isProtectedPath`, `checkAuthConfig`. Nenhum consumidor lê cookie ou `.env` direto
- `proxy.ts`: protege `/admin/*` e `/api/admin/*`; libera login, `/api/webhooks/*` e as rotas públicas
- `app/(admin)/admin/login/page.tsx` (Client Component) e `app/(admin)/admin/page.tsx` (placeholder do painel)
- `app/api/admin/login/route.ts` e `app/api/admin/logout/route.ts`
- `scripts/hash-password.ts` + script `npm run auth:hash`
- `tests/f-auth.test.ts`: 5 casos de política de rotas, verdes (não tocam o banco)
- `.env.example` passou a ser versionado, com `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`

Dependências novas: `bcrypt`, `iron-session`, `@types/bcrypt` (dev).

## Como a auth foi verificada

Prova por curl contra `npm run dev`, com os 8 casos pedidos: `/admin` sem cookie devolve 307 para `/admin/login`; `/api/admin/*` sem cookie devolve 401 JSON; credencial errada devolve 401 com mensagem genérica idêntica para email errado e senha errada; credencial certa devolve 200 com `Set-Cookie` HttpOnly, SameSite lax, Max-Age 28800; `/admin` com cookie devolve 200; logout devolve 303 zerando o cookie e `/admin` volta a redirecionar.

O caso do webhook foi provado criando `app/api/webhooks/asaas/route.ts` temporário (GET e POST devolveram 200 sem cookie) e **apagando o arquivo em seguida**. Um 404 não provaria nada, porque poderia vir do proxy ou da rota inexistente.

Enumeração de usuário medida em 3 rodadas: email errado 0,258 / 0,255 / 0,253s; email certo com senha errada 0,255 / 0,255 / 0,256s. Indistinguível, porque `bcrypt.compare` roda mesmo quando o email já falhou.

## PRÓXIMO PASSO

**Consertar a suíte de testes da Fase 1, que está vermelha desde `ce3e4c6`.** Detalhe na primeira pendência abaixo. Vem antes do calendário porque toda tela nova da Fase 3 vai mexer em dados que só essa suíte protege, e construir sobre rede de segurança desligada é como o projeto perde tempo. É trabalho pequeno, com o diagnóstico já fechado.

**Depois:** calendário nativo do admin (CLAUDE.md seções 11.1 e 14), a segunda tarefa da Fase 3. Visão do dia com uma coluna por recurso ativo, blocos com cliente, experiência e status, buffers visíveis, seletor de data e faixa semanal. Tela usada no celular, em campo: priorizar legibilidade e toque. O marcador de saldo em aberto e os botões de cobrança dependem da Fase 2 e ficam para a costura final.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas em `public`
- **Produção:** NUNCA migrou. Banco vazio. Primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar. Catálogo: 1 tenant, 13 settings, 2 recursos, 2 experiências, 2 faixas de horário. Movimento vazio.

**As experiências têm id 3 e 4, não 1 e 2.** Trilha da Montanha (id 3, 90 min, 32549 centavos) e Trilha da Fazenda (id 4, 60 min, 23249). É a causa da suíte vermelha.

## Pendências e dívidas conhecidas

- **SUÍTE VERMELHA, prioridade máxima.** `npm test` dá `5 failed | 1 passed`, com os 25 casos da Fase 1 em *skipped* (não falhos) porque `assertCatalogSeeded` lança em `beforeAll`. Causa: `tests/helpers/db.ts:25-26` fixa `EXP_CURTA = 1` e `EXP_LONGA = 2`, mas o commit `ce3e4c6` renomeou as trilhas no template e o seed reconcilia por nome sem renomear, então elas nasceram como id 3 e 4. Complicação para um conserto mecânico: **as durações inverteram**, antes `EXP_CURTA` era 60 min e agora o id 3 tem 90 min, então trocar 1 por 3 e 2 por 4 inverte a semântica dos testes que dependem de duração. Decisão a tomar: manter ids fixos ou resolver a experiência por nome uma vez em `beforeAll`. Os comentários das linhas 25-26 também estão obsoletos
- **`ce3e4c6` tem mensagem que não bate com o conteúdo.** Diz "test: verificação de preço independente" e não toca `tests/`; o diff é 100% `lib/templates/quadriciclo.ts`, trocando nomes, durações e preços provisórios pelos reais. Quem procurar a confirmação dos preços pelo assunto do commit não acha. Já está em `origin`, nada a fazer além de saber
- **Sem rate limiting no login.** `POST /api/admin/login` aceita tentativas ilimitadas. O custo do bcrypt (cerca de 250ms) atrasa, mas não é defesa. Marcado como TODO no arquivo, previsto para o hardening da Fase 4
- **Sessão sem revogação.** O estado vive no cookie (iron-session), não no banco. Cookie roubado vale até expirar, 8h. A única forma de invalidar sessões abertas é trocar `SESSION_SECRET`, o que derruba todas de uma vez. Aceito no MVP de usuário único; some quando entrar o segundo usuário
- **DEPENDÊNCIA DA FASE 2 (não é o próximo passo):** pré-requisitos do Asaas (CLAUDE.md seção 18) dependem do cliente e travam a Fase 2 inteira: conta aprovada com prova de vida, chave Pix cadastrada, API keys de produção e sandbox, webhook com token próprio, régua de notificações ajustada. A Fase 2 é retomada quando as telas de admin estiverem prontas E a conta aprovada. Junto vem a decisão de negócio que muda o desenho dela: **lançamento com pagamento integral ou com sinal?** As duas experiências estão em `payment_mode: 'full'`; o modo `deposit` está implementado e testado, trocar são dois campos e rodar o seed
- **11 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts`, localizáveis por `grep -n "PROVISORIO"`. Nomes, durações e preços das trilhas já foram confirmados. Seguem provisórios: `min_lead_minutes`, ponto de encontro, o que levar, política de sinal, nomes dos recursos, grade de horários, os dois `paymentMode`, e o `reply_to_email`, que está como `contato@aventix.com.br` e aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **`app/` não usa o route group `(public)`** que a seção 14 especifica. A home e as rotas públicas estão na raiz de `app/`; só o admin ganhou `(admin)` nesta sessão. Divergência cosmética, sem efeito em URL, a resolver quando o formulário público for construído
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
