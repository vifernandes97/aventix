# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-24

## Onde estamos

**Dia do go-live original (24/08); o prazo corrente mencionado em conversa é
26/08.** O MVP está completo e em produção rodando em **sandbox** do Asaas. Nada
de código bloqueia a venda — o caminho crítico continua sendo credencial de
produção do Asaas e chave Pix, que dependem do cliente.

Esta sessão entregou **três frentes**, todas já em `main` e pushadas:
navegação em sidebar no admin, botão de mostrar/ocultar senha no login, e —
a mais importante — **validação de idade mínima do garupa**, que fechou um
buraco de segurança real, mais o mapa do ponto de encontro.

**O acúmulo não deployado cresceu.** Produção roda `469d66a`. A `main` está em
`32b3016`, e o próximo deploy carrega de uma vez: topologia nova de URL, tela
`/admin/agendamentos`, sidebar, toggle de senha, **migration 0004 e 0005**, e a
regra de idade.

## >>> DEPOIS DO PRÓXIMO DEPLOY, VERIFICAR À MÃO (obrigatório) <<<

O backfill da migration 0005 casa por **nome**. Se o nome em produção divergir
minimamente (espaço, acento, maiúscula), o `UPDATE` não casa, as duas
experiências ficam com `0`, e `0` significa **sem idade mínima**: a migration
passa, o boot passa, o sistema aceita criança de qualquer idade e **nada acusa
erro**. Falha surda.

```sql
SELECT id, name, min_passenger_age FROM experiences;
```

Esperado: `Trilha da Fazenda | 6` e `Trilha da Montanha | 12`. Qualquer `0`
significa que a regra **não está valendo**; o conserto é `UPDATE` manual com o
nome real, pelo protocolo da seção 19 (`psql -c` isolado, conferido em conexão
nova). Pelo dump conhecido os nomes batem, mas confirmar é barato demais para
não confirmar.

## >>> A URL a divulgar mudou (segue valendo) <<<

| URL | Produção HOJE | Depois do próximo deploy |
|---|---|---|
| `app.aventix.com.br/` | LP do Quadri Club | 307 para `/admin/login` |
| `app.aventix.com.br/agendamento/quadriclub` | 404 | LP do Quadri Club |

A URL do fluxo do ManyChat é `https://app.aventix.com.br/agendamento/quadriclub`.
Deploy e divulgação andam juntos: divulgar antes do deploy dá 404; deployar e
divulgar a raiz leva o cliente à tela de login do admin.

## Pronto

**Fases 0, 1 e 2**: schema, tenant e settings, motor de disponibilidade, criação
transacional, cron de hold, seed como template de segmento, `PaymentProvider`/
Asaas Pix, `reservation_payments`, webhook com as oito regras da seção 8, job de
reconciliação.

**Fase 3, tarefas 1 a 8**: auth + `proxy.ts`; calendário nativo em uma query;
painel sobreposto de detalhe e cancelamento; CRUD de experiências; formulário
público de 6 passos; termo com rolagem obrigatória e contato de emergência; tela
de status com polling; CRUDs operacionais de agenda. A 9ª (agenda compartilhada
`/agenda/[token]`) é corte acordado.

**Fase 4**: deploy em produção funcionando, apontando para o sandbox do Asaas.

**Etapa 1 da multi-tenancy**: coluna `tenants.slug`, LP resolvendo tenant no
banco, raiz virando login, barreira da Etapa 2.

**Acréscimos de 24/08**: `/admin/agendamentos` com busca; abertura do painel por
`?reserva=`; sidebar no desktop; toggle de senha no login; idade mínima do
garupa; mapa do ponto de encontro.

## O que esta sessão fez

Quatro blocos, todos verificados por execução e já em `main`.

1. **Pendências de git** (`c334ff7`, `9cb6667`): pushados dois commits locais e
   dois arquivos não rastreados. A skill `init-projeto` estava salva como **ZIP
   com extensão `.md`** (assinatura `PK`); extraída e commitada como texto.
2. **Sidebar do admin** (`401e3d5`, PR #2): navegação vira sidebar vertical no
   desktop (recolhida/expandida, estado em **cookie** lido no servidor, sem
   flash); mobile inalterado. Novo `app/(admin)/admin/layout.tsx` só desloca o
   conteúdo; a página ativa continua vindo por **prop**, então as 6 telas não
   foram editadas. `/admin/login` fica sob o mesmo layout e é excluída pelo
   `:has()`.
3. **Toggle de senha no login** (`f0e62e0`, PR #3): botão com ícone dentro do
   campo, `aria-label`/`aria-pressed`, `tabIndex={-1}`. Um arquivo.
4. **Idade do garupa + mapa** (`32b3016`, branch `feat/idade-e-mapa`, mergeada
   por você em `main`):
   - coluna `experiences.min_passenger_age` (`NOT NULL DEFAULT 0`, CHECK
     `0..120`), **migration 0005 com backfill manual casando por nome**;
   - validação em `createReservation` (422, diz a idade exigida, não ecoa dado
     pessoal) e espelho no wizard; **fail-closed** sem `birthdate`;
   - `ageOnDate()` novo em `lib/time.ts` — aritmética de calendário pura, sem
     `Date`, para não reintroduzir a armadilha de UTC de 17/08;
   - campo exposto no CRUD (API + tela) e no catálogo público;
   - setting `meeting_point_map_url` (só a URL) + `lib/maps.ts` com **lista de
     permissão http(s)**, e componente com `loading="lazy"`, `referrerpolicy`,
     proporção responsiva e link de fallback;
   - `meeting_point` saiu do passo 1 do wizard e ganhou `whitespace-pre-line`
     onde é renderizado.

**Consertado de passagem:** `scripts/seed-demo-reservations.ts` estava quebrado
**desde 17/08** (0 de 6 reservas), falhando no CPF obrigatório. Medido antes de
mexer — não era regressão. Agora cria 6 de 6.

**Verificação:** 144 testes verdes (grupo R novo, 9 casos), build sem avisos
novos, lint limpo, `db:generate` sem drift, backfill conferido no banco. A tela
de confirmação foi aberta em navegador a 375px com o texto de sete blocos
semeado: quebras preservadas, `innerHTML` **sem nenhuma tag**, mapa real
renderizando, sem overflow horizontal. Login e passo 1 do wizard também
verificados em navegador.

## PRÓXIMO PASSO

1. **Decidir e executar o deploy pendente.** É a decisão que mais pesa: produção
   está cinco commits e duas migrations atrás, e agora o atraso inclui uma regra
   de **segurança** (idade do garupa) que só passa a valer depois do deploy.
2. **Logo após o deploy, rodar o `SELECT` de verificação do backfill** (bloco no
   topo deste documento). Não é opcional.
3. **Credencial de produção do Asaas** no Easypanel (`ASAAS_API_KEY`,
   `ASAAS_BASE_URL`). **SEM escape `\$`**; ler a seção 19 antes.
4. **Cadastrar o webhook de produção** em
   `https://app.aventix.com.br/api/webhooks/asaas`, exato, sem barra final.
5. **Confirmar a chave Pix do Quadri Club.**
6. **Preencher os textos provisórios** visíveis ao cliente (`meeting_point`,
   `what_to_bring`, `support_whatsapp`) em `lib/templates/quadriciclo.ts` — o
   texto longo real do cliente ainda **não** foi semeado; o template segue com o
   valor provisório de uma linha.

## Migrations

- **Seis no disco**: `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`, `0004_tenant_slug`,
  `0005_min_passenger_age` (nova nesta sessão).
- **Local**: as seis aplicadas (`drizzle.__drizzle_migrations` com 6 linhas).
- **Produção**: **quatro**. A 0004 e a 0005 sobem no próximo deploy, pelo
  `migrate` do boot.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- **A 0001, a 0004 e a 0005 estão editadas à mão** e precisam continuar assim se
  regeradas — na 0005 o que se perderia é o **backfill**, e a perda é silenciosa.

## Testes

`npm test`: **18 arquivos, 144 casos, todos passando** (era 17 e 135).

Grupo novo **R** (`tests/r-idade-garupa.test.ts`, 9 casos): idades diferentes por
experiência, recusa abaixo do mínimo com a idade na mensagem, aceite na idade
exata, **aceite de quem completa a idade entre a reserva e o passeio** (R4, que
afirma explicitamente que hoje a criança tem um ano a menos — é o teste que
quebra se alguém alinhar as duas regras de idade), mesma idade recusada numa
trilha e aceita na outra, reserva sem garupa não afetada, garupa sem data de
nascimento recusado, e os dois casos do mapa (setting vazia omite o bloco;
esquema perigoso recusado).

`tests/helpers/db.ts` ganhou `passengerBirthdate` (default adulto): sem isso os
testes que criam garupas passariam a falhar, já que o catálogo agora exige idade.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e reconciliado com o template
(inclusive `min_passenger_age` 12/6 e a URL do mapa). O `meeting_point` longo que
foi usado na verificação visual **foi revertido** pelo `db:seed`, para não deixar
valor à mão divergindo do template. Há 6 reservas de demonstração do
`db:seed:demo` no banco (movimento, zerado por `npm test`).

## Banco de produção

Migrado até a 0003 e semeado. Sem `slug` e sem `min_passenger_age`.
`support_whatsapp` continua não existindo lá; o código trata ausente como vazio.

## Deploy

`origin/main` = `main` local = **`32b3016`**. Produção roda **`469d66a`**.
Deploy segue manual (clique em Implantar no Easypanel). PRs #2 e #3 mergeados
por squash; a branch `feat/idade-e-mapa` foi mergeada direto por fast-forward,
sem PR.

## Pendências e dívidas conhecidas

**Da sessão de hoje**
- **`0` como sentinela** em `min_passenger_age`: a coluna diz "idade zero" para
  significar "regra ausente". Coluna anulável seria mais honesta. Anotado de
  propósito, sem ação; reabrir se a semântica confundir alguém.
- **Duas bases de data para idade** (condutor na reserva, garupa no passeio).
  Deliberado e registrado em `docs/DECISOES.md` e na seção 4.6 do CLAUDE.md.
  Parece bug para quem chega novo — não alinhar sem decisão própria.
- **Mapa só na tela de confirmação.** Não entrou no wizard (para não pôr iframe
  pesado no funil) nem no admin. `PublicLabels` não recebeu a chave.
- **Sidebar em `bg-white`**: o admin nunca foi adaptado a dark mode, então em
  dark mode do SO a sidebar fica clara, como o resto.

**Multi-tenancy pela metade (dívida criada de propósito em 23/08)**
- **Etapa 2 não foi feita.** `getTenantId()` devolve 1 fixo e governa todas as
  consultas. A barreira `assertResolvedTenantIsCurrent()` impede divergência em
  silêncio; a janela só fecha na Etapa 2.
- Critério de conclusão: poder **apagar** `assertResolvedTenantIsCurrent()` e
  `tests/o-barreira-multi-tenant.test.ts`.

**Bloqueiam dinheiro real (dependem do cliente)**
- Chave de API de produção do Asaas não gerada; produção roda em sandbox.
- Webhook de produção não cadastrado.
- Chave Pix do Quadri Club pendente. O nome no copia-e-cola é da conta sandbox.
- Valores provisórios em `lib/templates/quadriciclo.ts`, três visíveis ao
  cliente final.

**Verificação que não foi feita**
- **As telas do admin nunca foram renderizadas em navegador autenticado**
  (calendário, agendamentos, experiências, CRUDs, e a sidebar nova). `/admin/*`
  está atrás do login e só existe o hash da senha, não o texto. A sidebar teve o
  contrato de CSS provado por injeção no DOM, não com as telas reais.
- O passo 4 do wizard (onde a mensagem de idade aparece ao cliente) não foi
  exercitado em navegador; a regra foi provada por teste de integração.

**Fluxo de venda**
- E-mail cortado do go-live. A tela `confirmed` é a única confirmação ao cliente.
- Termo sem checagem de versão vigente no servidor.
- O termo **não** menciona a idade mínima do garupa; a regra aparece só no
  formulário e na recusa. Vale avaliar incluir no texto.
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
- `instrumentation.ts` compila para Edge Runtime e falha lá, emitindo 3 avisos no
  build. Pré-existente.
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
- Branches locais já mergeadas que podem ser apagadas: `feat/tenant-slug` e
  `feat/idade-e-mapa`.

## Prazo

Go-live corrente **26/08**. Risco técnico baixo do lado do código: 144 testes
verdes, produção no ar. O que pesa é operacional — o deploy pendente (que agora
carrega uma regra de segurança) e as credenciais do Asaas.
