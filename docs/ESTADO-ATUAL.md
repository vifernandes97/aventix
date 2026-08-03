# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-03

## Onde estamos

**Fase 3 (interfaces), 2 de 8 tarefas de admin.** Fases 0 e 1 completas. Go-live: 24/08/2026.

A ordem das fases está invertida por decisão de 28/07 (`docs/DECISOES.md`): os pré-requisitos do Asaas atrasaram e travam a Fase 2 inteira, então as telas de admin que não dependem de pagamento vêm primeiro.

Tarefas de admin da Fase 3: **auth (pronta)**, **calendário — grade de visualização (pronta)**, calendário — painel de detalhes e cancelamento, CRUD de experiências, CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada por link secreto.

A suíte deixou de depender do relógio da máquina. Não há mais teste que fique vermelho por hora do dia.

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
- `lib/calendar.ts`: período em UMA query (medido com `log_statement='all'`: 1 statement por chamada), sobreposição com `&&` sobre `tstzrange`, `EXISTS` no filtro para não perder linhas de recurso, datas em ISO
- `app/api/admin/calendar/route.ts`: `from`/`to`/`view`, 400 tipado, teto de 62 dias, projeção de resumo no mês (sem nome de cliente nem recursos)
- `app/(admin)/admin/page.tsx` substitui o placeholder; `_components/` com as três views em CSS Grid puro
- Dia com eixo de recurso, buffer hachurado, rolagem horizontal e bloco multi-recurso atravessando as colunas; semana com o eixo de recurso colapsado em etiqueta abreviada derivada do nome cadastrado; mês em resumo
- Filtro por experiência client-side, sem refetch, sem mexer na grade
- `scripts/seed-demo-reservations.ts` (`npm run db:seed:demo`): 6 reservas de demonstração via `createReservation`, marcadas com `channel='demo'`, que é por onde o script apaga o próprio rastro

## O que esta sessão fez

1. **Contrato de `GET /api/admin/calendar` na seção 11.1 do CLAUDE.md** (`62a2f99`), fechando a divergência doc-vs-doc que o `DECISOES.md` apontava.
2. **Lead time deixou de depender do relógio** (`5fe35ae`): os quatro casos (10a-10d) foram reancorados numa data fixa de 2027, com o lead derivado como delta. Medido com o relógio do processo deslocado — a versão antiga falha 1 caso às 20:00, 3 às 22:00 e 4 às 23:53; a nova passa em todos os deslocamentos testados (+0 a +1200 min).
3. **Calendário nativo, grade de visualização** (`0820dcf`), rota e tela, só leitura.
4. **Duas correções na view de dia** (`70dfade`): a régua de horários não encolhe mais com o filtro, e as divisórias de coluna passaram para cima dos blocos.

Verificado ao fim: `npx tsc --noEmit` limpo, `npm run lint` limpo, `npm test` com **30 passed** a partir de banco zerado.

## PRÓXIMO PASSO

**Calendário do admin — painel de detalhes e cancelamento** (tarefa 3 de 8 da Fase 3). É a metade de ESCRITA da tela que acabou de ser construída.

Pontos de entrada já marcados com `TODO` no código: o `onClick` do bloco em `_components/day-view.tsx` e em `_components/week-view.tsx`. O painel mostra participantes, documentos e composição, e cancela chamando `setReservationStatus` (nunca `UPDATE` direto, seção 4.6). Cancelar precisa de confirmação. O marcador de saldo e os botões **Cobrar saldo** / **Recebi por fora** dependem da Fase 2 e ficam para a costura final.

**Depois:** CRUD de experiências, CRUD de recursos, horários e bloqueios, configurações, termo, clientes sem faturas, agenda compartilhada.

## Migrations

- **Uma migration:** `drizzle/0000_oval_mandroid.sql` (colapsada, schema rev 6 completo)
- **Local:** aplicada. `drizzle.__drizzle_migrations` tem 1 linha, 13 tabelas em `public` (conferido nesta sessão)
- **Produção:** NUNCA migrou. Banco vazio. Primeira migration em produção entra no checklist de go-live
- `npm run db:generate` responde "No schema changes, nothing to migrate" (verificado no fim desta sessão)
- `btree_gist` e a exclusion constraint são SQL manual dentro da migration
- Esta sessão NÃO tocou o schema

## Banco local

Container `aventix-db-dev` (postgres:17-alpine) no ar. Catálogo semeado. As reservas de demonstração são apagadas pela suíte de testes (que zera movimento); rode `npm run db:seed:demo` de novo antes de olhar a tela.

## Pendências e dívidas conhecidas

- **`getDayGrid` duplica a precedência exceção-sobre-`operating_hours`** (seção 6) que já vive em `lib/availability.ts`. Não foi extraída porque aquele arquivo estava fora do escopo da tarefa e não expõe helper para isso. Se as duas cópias divergirem, a tela desenha horário que o motor não vende — não causa overbooking, causa tela mentindo. O lugar certo de unificar é quando o CRUD de horários entrar e virar o terceiro consumidor
- **Blocos não adjacentes não têm vínculo visual.** Reserva nos recursos 1 e 3, com o 2 livre, vira dois blocos separados (correto), mas nada indica que são a mesma reserva. Quando o painel de detalhes entrar, clicar em qualquer um deve abrir a mesma reserva. Não exercitado contra dado real: o catálogo tem 2 recursos adjacentes, então a não-adjacência é inalcançável hoje
- **`instrumentation.ts` compila para Edge Runtime e falha lá:** `./lib/auth.ts:24 — 'node:crypto' is not supported in the Edge Runtime`, repetido a cada request em dev. Não derruba nada (o cron agenda normalmente), mas polui o log a ponto de esconder erro de verdade
- **`app/layout.tsx` ainda é o do `create-next-app`:** `lang="en"` e título "Create Next App". Deixou de ser cosmético — agora serve o calendário, que é a tela principal do dono
- **A âncora dos testes de lead time vence em junho de 2027.** Vencida, o bloco falha com instrução de trocar a data (não passa em silêncio). Se incomodar, mover para uma data mais distante é trocar uma constante
- **Sem rate limiting no login.** `POST /api/admin/login` aceita tentativas ilimitadas. TODO no arquivo, previsto para o hardening da Fase 4
- **Sessão sem revogação.** Estado no cookie (iron-session). Cookie roubado vale até expirar, 8h. Única forma de invalidar é trocar `SESSION_SECRET`. Aceito no MVP de usuário único
- **DEPENDÊNCIA DA FASE 2 (não é o próximo passo):** pré-requisitos do Asaas (CLAUDE.md seção 18) dependem do cliente e travam a Fase 2 inteira: conta aprovada com prova de vida, chave Pix cadastrada, API keys, webhook com token próprio, régua de notificações ajustada. Junto vem a decisão de negócio: **lançamento com pagamento integral ou com sinal?** As duas experiências estão em `payment_mode: 'full'`; o modo `deposit` está implementado e testado contra fixtures da suíte
- **`reservations.payment_state` é `'pending'` em toda reserva**, inclusive nas confirmadas, porque nada marca cobrança como paga antes da Fase 2. O calendário pinta por `status`; o marcador de saldo da seção 11.1 passa a ler `paymentState` quando o pagamento entrar. Não trate `confirmed` como dinheiro na conta
- **11 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts` (`grep -n "PROVISORIO"`): `min_lead_minutes`, ponto de encontro, o que levar, política de sinal, nomes dos recursos, grade de horários, os dois `paymentMode` e o `reply_to_email`, que está como `contato@aventix.com.br` e aparece para o cliente final, onde a regra de marca manda aparecer o tenant
- **`ce3e4c6` tem mensagem que não bate com o conteúdo.** Já está em `origin`, nada a fazer além de saber
- **`app/` não usa o route group `(public)`** que a seção 14 especifica. Só o admin ganhou `(admin)`. A resolver quando o formulário público for construído
- **A exclusion constraint não é exercitada pela suíte.** Com `single_experience_per_slot=true` a criação serializa por advisory lock e o perdedor cai no recheck. Medido: 0 via constraint, 10 via recheck. Verificada manualmente com o flag desligado
- **Reserva expirada mantém `reservation_payments` em `pending`.** O job de reconciliação da Fase 2 vai encontrar essas linhas; o filtro da seção 8-B provavelmente precisa excluir `expired`, não só `cancelled`
- **Sem proteção contra duplo clique** em `POST /api/reservations`. Defesa natural é desabilitar o botão na tela
- **Termo sem versão vigente:** não há onde guardar texto e versão atual. O servidor valida presença, não que a versão seja a corrente
- **`mode:'string'` no schema:** toda nova função que retorne `timestamptz` reintroduz o formato não-ISO. Regra na seção 3
- **`operating_hours` permite faixas sobrepostas** no mesmo weekday. O motor deduplica; a correção de origem é validar no CRUD
- **Experiência gratuita** (`price_cents = 0`) não é suportada; seção 4.6
- **Cron em dev:** o timer guarda a versão do módulo carregada no boot. Editar `lib/jobs/expire-holds.ts` não muda o tick até reiniciar

## Prazo

Go-live 24/08. Faltam 6 tarefas de admin da Fase 3 mais o fluxo público, a Fase 2 (à espera do Asaas) e a Fase 4 (integrações e hardening). Ritmo de cerca de 2h/dia. Custo aceito da inversão: Fases 2 e 3 serão costuradas no fim. Candidatos a corte se apertar: agenda compartilhada por link secreto, seed como template (virar seed simples).
