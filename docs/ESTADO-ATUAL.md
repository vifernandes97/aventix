# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-24

## Onde estamos

**Dia do go-live (24/08).** O MVP está completo e em produção (rodando em
**sandbox** do Asaas). Nada de código bloqueia a venda; o caminho crítico segue
sendo credencial de produção do Asaas e chave Pix, que dependem do cliente.

**Esta sessão adicionou uma ferramenta operacional nova: a tela
`/admin/agendamentos`** — lista consultável de reservas com busca por nome ou
telefone. Motivação real da primeira semana: cliente liga dizendo "reservei pro
sábado, esqueci o horário", e sem busca o dono ficava rolando dias na agenda.
Código **commitado e pushado** para `origin/main` (`a7336fb`), mas **NÃO
deployado** — produção continua no código anterior.

**A mudança de topologia de URL da sessão de 23/08 (LP saiu da raiz para
`/agendamento/{slug}`, raiz virou login) continua na `main` e continua sem ir
para produção.** O próximo deploy carrega as duas coisas juntas: a topologia
nova e esta tela, mais a migration 0004.

Fase 3 estava em 8 de 9 (o 9º, agenda compartilhada `/agenda/[token]`, é corte
acordado). Esta tela é um acréscimo operacional além daquele plano.

## >>> ATENÇÃO ANTES DO GO-LIVE: a URL a divulgar mudou <<<

Segue valendo o alerta da sessão anterior. No código da `main`:

| URL | Produção HOJE (4 migrations) | Depois do próximo deploy |
|---|---|---|
| `app.aventix.com.br/` | LP do Quadri Club | 307 para `/admin/login` |
| `app.aventix.com.br/agendamento/quadriclub` | 404 | LP do Quadri Club |

1. **A URL do fluxo do ManyChat é `https://app.aventix.com.br/agendamento/quadriclub`.**
   Cliente que receber a raiz depois do deploy cai numa tela de login de admin.
2. **Deploy e divulgação andam juntos.** Divulgar o endereço novo antes do deploy
   dá 404; deployar e divulgar a raiz dá tela de login.
3. **O próximo deploy aplica a migration 0004** (o boot roda `migrate`). Aditiva;
   o backfill grava `slug='quadriclub'` no tenant 1.

## Pronto

**Fases 0, 1 e 2**: schema (13 tabelas + exclusion constraint), tenant e
settings, motor de disponibilidade, criação transacional, cron de hold, seed
como template de segmento, `PaymentProvider`/Asaas Pix, `reservation_payments`,
webhook com as oito regras da seção 8, job de reconciliação.

**Fase 3, tarefas 1 a 8**: auth + `proxy.ts`; calendário nativo em uma query;
painel sobreposto de detalhe e cancelamento; CRUD de experiências; formulário
público de 6 passos; termo com rolagem obrigatória e contato de emergência; tela
de status da reserva com polling; CRUDs operacionais de agenda.

**Fase 4**: deploy em produção funcionando, apontando para o **sandbox** do Asaas.

**Etapa 1 da multi-tenancy (23/08)**: coluna `tenants.slug`, LP resolvendo o
tenant no banco, raiz virando login, barreira da Etapa 2.

**Acréscimo desta sessão (24/08)**: tela `/admin/agendamentos` + abertura do
painel de detalhe por `?reserva=`.

## O que esta sessão fez

Uma tarefa fechada ponta a ponta, **somente leitura**, sem migration.

1. **`lib/reservation-list.ts`** (novo, SERVER-ONLY): `searchReservations` —
   query nova (a do calendário não servia: só status ativos, presa a período,
   sem telefone). Tudo resolvido no banco: busca ILIKE por nome **ou** telefone
   (com normalização por dígitos para telefone formatado), filtro por status e
   por período (data do passeio), ordem `start_at DESC`, `LIMIT 100+1` para
   detectar o teto. O SELECT **não busca** CPF, documento nem contato de
   emergência — é a garantia de privacidade da listagem, que mostra vários
   clientes de uma vez.
2. **`app/(admin)/admin/agendamentos/page.tsx`** (novo): Server Component lendo a
   lib direto (padrão da agenda). Form GET, estado da busca na URL. Cartões
   empilhados mobile-first, badge de status, valor, telefone como link `tel:`,
   aviso ao bater o teto de 100.
3. **Abertura do painel por `?reserva=id`** (opção escolhida entre três): o link
   do cartão leva ao dia no calendário e já abre o painel de detalhe existente.
   Parâmetro **aditivo** — o clique no bloco continua igual; ausente renderiza
   como antes sem tocar o banco; id malformado/inexistente/de outro tenant não
   abre painel nem mostra erro (o servidor valida via `resolveOpenReservationId`);
   fechar limpa o `reserva=` da URL. Tocou `page.tsx` e `calendar.tsx` do admin;
   `reservation-panel.tsx` **não** foi alterado.
4. **`admin-nav.tsx`**: link "Agendamentos".
5. **Docs**: CLAUDE.md seções 14, 11.1 e 16 atualizadas; uma entrada nova em
   `docs/DECISOES.md` (a escolha do `?reserva=` sobre as alternativas).

Verificado por execução: 135 testes verdes (grupo Q novo, 11 casos), build
limpo, lint limpo. As telas **não** foram renderizadas em navegador (ver
pendências).

## PRÓXIMO PASSO

O caminho crítico do go-live não mudou; esta sessão só somou uma tela a ele.

1. **Decidir se produção recebe o deploy pendente antes/no go-live.** Agora esse
   deploy carrega junto: (a) a topologia nova de URL, (b) a migration 0004, (c)
   a tela `/admin/agendamentos`. As duas opções continuam defensáveis (URL do
   ManyChat nasce correta vs. produção segue testada como está).
2. **Credencial de produção do Asaas** no Easypanel (`ASAAS_API_KEY`,
   `ASAAS_BASE_URL`). **SEM escape `\$`**; ler a seção 19 antes.
3. **Cadastrar o webhook de produção** em
   `https://app.aventix.com.br/api/webhooks/asaas`, exato, sem barra final, token
   próprio.
4. **Confirmar a chave Pix do Quadri Club.**
5. **Preencher os três textos provisórios** visíveis ao cliente
   (`meeting_point`, `what_to_bring`, `support_whatsapp`) em
   `lib/templates/quadriciclo.ts`.

## Migrations

- **Cinco no disco**: `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`, `0004_tenant_slug`. **Esta sessão
  não adicionou nenhuma** (tarefa só de leitura).
- **Local**: as cinco aplicadas (`drizzle.__drizzle_migrations` com 5 linhas).
- **Produção**: **quatro**. A 0004 sobe no próximo deploy, pelo `migrate` do boot.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A 0001 e a 0004 estão editadas à mão e precisam continuar assim se regeradas.

## Testes

`npm test`: **17 arquivos, 135 casos, todos passando** (era 16 e 124).

Grupo novo **Q** (`tests/q-agendamentos.test.ts`, 11 casos): ordem desc, busca por
nome case-insensitive, busca por telefone (inclusive formatado), filtro de
status, filtro de período, isolamento de tenant, teto de 100, o teste de
privacidade procurando os **valores reais** (CPF, documento, contato de
emergência) no resultado serializado, e a guarda do `?reserva=` (ausente /
inválido / de outro tenant não abre; existente abre).

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado (1 tenant `slug='quadriclub'`,
2 recursos, 2 experiências, 14 settings, 2 faixas de horário). O movimento é
zerado por `npm test`; sem dado manual residual relevante.

## Banco de produção

Migrado até a 0003 e semeado. Sem a coluna `slug` ainda. `support_whatsapp`
continua não existindo lá; o código trata ausente como vazio e omite o bloco de
contato.

## Deploy

`origin/main` avançou para **`a7336fb`** (esta sessão fez push, que também levou
o commit de docs `df8147e` da sessão anterior, antes local sem push). **Nada foi
deployado**: produção roda o código de `469d66a` (último deploy), em sandbox.
Deploy segue manual (clique em Implantar no Easypanel).

## Pendências e dívidas conhecidas

**Arquivo solto com dado de produção (mitigado nesta sessão)**
- **`backup-antes-slug.sql` e `seed-producao.sql` na raiz** são `pg_dump` de
  produção com dado pessoal dentro. O `.gitignore` passou a ignorar `*.sql`
  **exceto `drizzle/*.sql`** (as migrations continuam rastreadas), então um
  `git add -A` distraído não os manda mais para o GitHub — confirmado com
  `git check-ignore`. **Ainda não removidos do disco:** os arquivos seguem na
  raiz do repo local; decidir se apaga ou move para fora do repo.

**Multi-tenancy pela metade (dívida criada de propósito em 23/08)**
- **Etapa 2 não foi feita.** `getTenantId()` devolve 1 fixo e governa todas as
  consultas de negócio — inclusive `searchReservations` e `reservationExists`
  desta sessão, que são só mais consumidores do mesmo id fixo, sem risco novo
  além do já existente. A barreira `assertResolvedTenantIsCurrent()` impede
  divergência em silêncio; a janela só fecha na Etapa 2.
- Critério de conclusão: poder **apagar** `assertResolvedTenantIsCurrent()` e
  `tests/o-barreira-multi-tenant.test.ts`.

**Bloqueiam dinheiro real (dependem do cliente)**
- Chave de API de produção do Asaas não gerada; produção roda em sandbox.
- Webhook de produção não cadastrado.
- Chave Pix do Quadri Club pendente. O nome no copia-e-cola é da conta sandbox
  (`NEOSOLUTI COMERCIO E SERV`).
- 13 valores provisórios em `lib/templates/quadriciclo.ts`, três visíveis ao
  cliente final.

**Verificação que não foi feita**
- **As telas do admin nunca foram renderizadas em navegador**, e a nova
  `/admin/agendamentos` entra na mesma conta. `/admin/*` está atrás do login e só
  existe o hash da senha, não o texto. Cobertos: tipos, lint, build e
  comportamento de lib/API. Não coberto: se cada tela pinta certo.
- A LP nova foi verificada por `curl` e pelo HTML servido, mas não foi aberta num
  navegador.

**Fluxo de venda**
- E-mail cortado do go-live. A tela `confirmed` é a única confirmação ao cliente.
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
  `process.exit`), emitindo 3 avisos no build. Pré-existente; a nova tela apenas
  entra no rastro de import de `lib/auth.ts`, sem somar aviso.
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
- A branch `feat/tenant-slug` pode continuar existindo local, apontando para
  commit já mergeado. Pode ser apagada.

## Prazo

Go-live **24/08, hoje**. Risco técnico baixo: código completo, 135 testes verdes,
produção no ar. A decisão aberta que mais pesa continua sendo se o deploy
pendente (topologia + tela nova + migration 0004) entra em produção antes do
go-live ou espera.
