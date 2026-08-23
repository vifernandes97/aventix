# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-23

## Onde estamos

**Go-live amanhã, 24/08.** O MVP está completo e em produção. Nada de código
bloqueia a venda; o caminho crítico continua sendo credencial de produção do
Asaas e chave Pix, que dependem do cliente.

**Mudança grande desta sessão: a topologia de URL mudou, e o código já está na
`main`.** A LP pública saiu da raiz e passou a viver em
`/agendamento/{slug}`; a raiz virou login da plataforma. Foi construído como
experimento em `feat/tenant-slug` e mergeado em `main` por fast-forward, com
push, ao fim da sessão. **Produção ainda NÃO recebeu esse deploy** e continua
servindo a LP na raiz.

Fase 3 em **8 de 9**. O 9º item é a agenda compartilhada por link secreto
(`/agenda/[token]`), corte já acordado.

## >>> ATENÇÃO ANTES DO GO-LIVE: a URL a divulgar mudou <<<

O ESTADO-ATUAL anterior dizia que `app.aventix.com.br/` era a URL que o cliente
divulgaria no ManyChat. **Isso deixou de valer no código que está na `main`.**

| URL | Produção HOJE (4 migrations) | Depois do próximo deploy |
|---|---|---|
| `app.aventix.com.br/` | LP do Quadri Club | 307 para `/admin/login` |
| `app.aventix.com.br/agendamento/quadriclub` | 404 | LP do Quadri Club |

Consequências, em ordem de urgência:

1. **A URL para o fluxo do ManyChat é `https://app.aventix.com.br/agendamento/quadriclub`.**
   Cliente que receber a raiz cai numa tela de login de admin. Não há link em
   produção apontando para a raiz hoje (o fluxo do ManyChat ainda não foi
   configurado), então não existe janela de quebra, mas o endereço a passar ao
   cliente é o novo.
2. **Deploy e divulgação precisam andar juntos.** Divulgar o endereço novo antes
   do deploy dá 404; deployar e divulgar a raiz dá tela de login.
3. **O próximo deploy aplica a migration 0004** (o boot roda `migrate`).
   Aditiva, e o backfill grava `slug='quadriclub'` no tenant 1.

## Pronto

**Fases 0, 1 e 2**: schema (13 tabelas mais exclusion constraint), tenant e
settings, motor de disponibilidade, criação transacional, cron de hold, seed
como template de segmento, `PaymentProvider`/Asaas Pix, `reservation_payments`,
webhook com as oito regras da seção 8, job de reconciliação.

**Fase 3, tarefas 1 a 8**: auth mais `proxy.ts`; calendário nativo em uma query;
painel sobreposto de detalhe e cancelamento; CRUD de experiências; formulário
público de 6 passos; termo com rolagem obrigatória e contato de emergência; tela
de status da reserva com polling; CRUDs operacionais de agenda.

**Fase 4**: deploy em produção funcionando, apontando para o **sandbox** do
Asaas.

**Etapa 1 da multi-tenancy (esta sessão, já na `main`)**: coluna `tenants.slug`,
LP resolvendo o tenant no banco, raiz virando login, barreira da Etapa 2.

## O que esta sessão fez

Metade **estrutural** da multi-tenancy. A URL passou a resolver o tenant de
verdade; o resto do sistema continua assumindo o tenant 1.

1. **Migration 0004, aditiva**: `tenants.slug` text NOT NULL UNIQUE. Editada à
   mão no padrão da 0001 (nullable, backfill, SET NOT NULL), porque o
   `ADD COLUMN NOT NULL` que o drizzle-kit gera aborta em tabela povoada. O
   backfill dá `tenant-{id}` a todos e `quadriclub` ao tenant 1, e denuncia sem
   abortar quem ficar com placeholder.
2. **LP em `app/(public)/agendamento/[slug]/page.tsx`**, com `findTenantBySlug`
   mais `notFound()`. `[slug]` dinâmico em vez da pasta literal que a seção 2-B
   previa: o argumento a favor da pasta era o 404 de graça, e a guarda entrega o
   mesmo 404 fazendo o slug resolver o tenant de verdade.
3. **Raiz virou login** (`redirect('/admin/login')`, 307). Não redireciona para
   agendamento: mandar a raiz para a LP de um tenant é o mesmo erro escondido
   atrás de um redirect.
4. **`SEED_TENANT_SLUG` em `lib/seed.ts`**, não no template. O template é dado
   de segmento e precisa ser reutilizável pelo próximo cliente do mesmo ramo; o
   slug é identidade de tenant.
5. **Barreira da Etapa 2**: `lib/tenant-slug.ts` com
   `assertResolvedTenantIsCurrent()`, que lança se a URL resolver um tenant
   diferente do que `getTenantId()` devolve.
6. **CLAUDE.md seção 2-B reescrita** e seção 14 atualizada; quatro entradas em
   `docs/DECISOES.md`.

Verificado por execução, não por leitura: a barreira foi exercitada inserindo um
tenant real no banco (falhou com a mensagem certa), e a LP do tenant 2 se recusa
a renderizar em vez de servir o Quadri Club.

## PRÓXIMO PASSO

1. **Decidir se produção vai receber este deploy antes do go-live.** As duas
   opções são defensáveis e a escolha é de negócio, não técnica:
   - **Deployar**: a URL do ManyChat nasce já correta e nunca precisa mudar.
     Custo: sobe no dia do go-live um código que rodou só em local.
   - **Não deployar**: produção segue exatamente como está hoje, testada, com a
     LP na raiz. Custo: a Etapa 1 espera, e o link do ManyChat muda depois.
2. **Credencial de produção do Asaas** no Easypanel (`ASAAS_API_KEY`,
   `ASAAS_BASE_URL`). **SEM escape `\$`**; ler a seção 19 antes.
3. **Cadastrar o webhook de produção** em
   `https://app.aventix.com.br/api/webhooks/asaas`, exato, sem barra final, com
   token próprio.
4. **Confirmar a chave Pix do Quadri Club.**
5. **Preencher os três textos provisórios** visíveis ao cliente
   (`meeting_point`, `what_to_bring`, `support_whatsapp`) em
   `lib/templates/quadriciclo.ts`.

## Migrations

- **Cinco no disco**: `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`, `0004_tenant_slug`.
- **Local**: as cinco aplicadas (`drizzle.__drizzle_migrations` com 5 linhas, a
  quinta em 23/08).
- **Produção**: **quatro**. A 0004 sobe no próximo deploy, pelo `migrate` do
  boot.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A 0001 e a 0004 estão editadas à mão e precisam continuar assim se forem
  regeradas.

## Testes

`npm test`: **16 arquivos, 124 casos, todos passando** (era 14 e 110).

Grupos novos: **O** (barreira de multi-tenancy) e **P** (rotas públicas: 200 na
LP, 404 no slug desconhecido, 307 e nunca 308 na raiz, e o `?canal=` continuando
a chegar ao wizard depois de `params` mudar de dono).

Os cinco fixtures que criam tenant vizinho (J a N) passaram a usar
`insertFixtureTenant()`, com slug obviamente de teste (`tenant-vizinho-j`). O
`NOT NULL` os quebraria; nome plausível confundiria quem lesse depois.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado (1 tenant com
`slug='quadriclub'`, 2 recursos, 2 experiências, 14 settings, 2 faixas de
horário). Uma reserva e um cliente de movimento residual.

O dado manual da sessão anterior (segunda dividida em duas faixas, exceção de
25/08, bloqueio de 05/09) foi apagado por `npm test`, como estava autorizado.

## Banco de produção

Migrado até a 0003 e semeado. Sem a coluna `slug` ainda. A setting
`support_whatsapp` continua não existindo lá; o código trata ausente como vazio
e omite o bloco de contato.

## Deploy

`main` e `origin/main` sincronizados em `f817f11`. **Nada foi deployado nesta
sessão**; produção roda o código de `469d66a`. Deploy segue manual (clique em
Implantar no Easypanel).

## Pendências e dívidas conhecidas

**Arquivo solto com dado de produção (novo, e é o mais sensível da lista)**
- **`backup-antes-slug.sql` na raiz, não rastreado e NÃO coberto pelo
  `.gitignore`.** É um `pg_dump` de **produção** (o tenant dentro nasceu em
  19/08, que bate com produção e não com o local), com 1 cliente, 2 reservas e 2
  participantes. Um `git add -A` distraído o manda para o GitHub com dado
  pessoal dentro. Mesma situação de `seed-producao.sql`, que já estava solto.
  Decidir entre apagar, mover para fora do repo ou acrescentar `*.sql` de dump
  ao `.gitignore`.

**Multi-tenancy pela metade (dívida criada de propósito nesta sessão)**
- **Etapa 2 não foi feita.** `getTenantId()` devolve 1 fixo e governa todas as
  consultas de negócio. Com dois tenants, a URL do segundo renderiza a página
  certa servindo os dados do primeiro. A barreira impede isso de acontecer em
  silêncio, mas a janela só fecha na Etapa 2.
- `lib/jobs/expire-holds.ts` (cron de 1 min) é o **único** chamador de
  `getTenantId()` sem requisição HTTP, e é o que a Etapa 2 vai ter que resolver
  iterando tenants. `reconcile-payments.ts` não usa tenant; os dois scripts de
  seed declaram o id localmente.
- Critério de conclusão da Etapa 2: poder **apagar**
  `assertResolvedTenantIsCurrent()` e `tests/o-barreira-multi-tenant.test.ts`.

**Bloqueiam dinheiro real (dependem do cliente)**
- Chave de API de produção do Asaas não gerada; produção roda em sandbox.
- Webhook de produção não cadastrado.
- Chave Pix do Quadri Club pendente. O nome no copia-e-cola é da conta sandbox
  (`NEOSOLUTI COMERCIO E SERV`).
- 13 valores provisórios em `lib/templates/quadriciclo.ts`, três visíveis ao
  cliente final.

**Verificação que não foi feita**
- **As telas do admin nunca foram renderizadas por mim.** Só existe o hash da
  senha, não o texto. Cobertos: tipos, lint, build e comportamento de API. Não
  coberto: se cada tela pinta certo.
- A LP nova foi verificada por `curl` (200, 404, 307 com `location` certo) e
  pelo HTML servido (wizard, duas trilhas, `<title>` do tenant), mas **não foi
  aberta num navegador**.

**Fluxo de venda**
- E-mail cortado do go-live. A tela `confirmed` é a única confirmação que o
  cliente recebe.
- Termo sem checagem de versão vigente no servidor.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- Modo sinal (`deposit`) não é vendável: o CRUD recusa com 422 e `receiveInCash`
  não foi implementado.

**Dívida técnica registrada de propósito**
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`
  (decisão de 22/08). Reabrir na primeira semana pós go-live.

**Gerais**
- Sem CI/CD; deploy é clique manual.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto`,
  `process.exit`), emitindo 3 avisos no build. Pré-existente.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations`.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Cron em dev: o timer guarda a versão do módulo carregada no boot.
- Chave SSH do VPS não configurada; acesso por senha de root.
- A branch `feat/tenant-slug` continua existindo local, apontando para o mesmo
  commit da `main`. Pode ser apagada.

## Prazo

Go-live **24/08, amanhã**. Risco técnico baixo: código completo, 124 testes
verdes, produção no ar. A decisão aberta que mais pesa é se a mudança de
topologia entra em produção antes do go-live ou espera.
