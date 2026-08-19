# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-19

## Onde estamos

**Fase 2 concluída em sandbox.** **Fase 4 (deploy) em andamento:** entre a
sessão anterior e esta, o dono tentou popular o catálogo de produção pela
primeira vez direto pelo console web do Easypanel, o que só é possível se as
migrations já tinham rodado lá (as tabelas existiam para receber `INSERT`) —
indício forte de que o mistério do ENOENT `/app/drizzle` registrado na sessão
anterior se resolveu sozinho quando o Easypanel finalmente serviu a imagem
nova. **Isto não foi verificado por ferramenta nesta sessão**, é inferência a
partir do relato do dono; ver PRÓXIMO PASSO. A tentativa de seed esbarrou numa
armadilha nova do console web (ver abaixo), então o estado real do catálogo em
produção é incerto. Fase 3 continua em 6 de 9. Go-live: **24/08/2026** (faltam
5 dias).

O fluxo de compra ponta a ponta contra o sandbox segue funcionando: cliente
agenda, recebe QR Pix real, paga e a reserva confirma sozinha pelo webhook, com
o job de 10 min como rede se a fila cair.

## Pronto

**Fases 0 e 1** — schema (13 tabelas + exclusion constraint), tenant/settings,
motor de disponibilidade, criação transacional, cron de expiração de hold, seed
como template de segmento.

**Fase 3, tarefas 1 a 6** — auth + `proxy.ts`; calendário nativo (dia/semana/mês)
em uma query; painel sobreposto de detalhe e cancelamento; CRUD de experiências;
formulário público de 6 passos; termo real com rolagem obrigatória e contato de
emergência.

**Fase 2 completa** (fechada em 17/08) — `PaymentProvider`/Asaas Pix, modo
integral e sinal em código (sinal não vendável no CRUD), webhook com as oito
regras invioláveis da seção 8, job de reconciliação de 10 min e migration `0003`
com `customers.asaas_customer_id` e `reservation_payments.asaas_invoice_url`.

**Migrations no boot + `tsx` em dependencies** (fechado em 18/08, commits
`799523d` e `511b4d5`, ambos pushed) — ver sessão anterior para detalhe.

## O que esta sessão fez

Sessão só de documentação, nenhum código tocado. Registrada uma lição de
infraestrutura descoberta pelo dono ao tentar semear o catálogo em produção
pelo console web do Easypanel:

- **CLAUDE.md ganhou a seção 19 — "Armadilhas de infraestrutura (Easypanel)".**
  O console web (tanto `bash` quanto o `PostgreSQL Client` embutido) processa
  SQL colado (`psql -f` sobre um arquivo com várias statements) de um jeito
  que quebra a semântica de transação: `INSERT`/`COMMIT` reportam sucesso e
  até um `SELECT` na mesma sessão confirma os dados, mas a sessão morre antes
  de persistir de verdade — conexões novas veem as tabelas vazias. Só
  `psql -c` isolado (uma statement por chamada, autocommit implícito)
  persistiu de fato, provado por um `INSERT` de teste que persistiu e um
  segundo idêntico que falhou por `duplicate key`. A seção registra o
  protocolo de verificação (conexão nova depois de qualquer `psql -f`) e
  aponta a solução permanente pós go-live: rota `POST /api/admin/seed` que
  chama a função de seed do próprio código Next, eliminando SQL manual.
- **DECISOES.md ganhou a entrada de 2026-08-19** apontando para a seção 19 em
  vez de duplicar a regra.

Verificado ao fim: `npm run db:generate` responde "No schema changes, nothing
to migrate"; 4 migrations em disco e 4 linhas em
`drizzle.__drizzle_migrations` local, batendo.

Achado um artefato solto na raiz do repo, **não criado por esta sessão**:
`seed-producao.sql` (dump gerado durante a investigação de produção, 91
linhas, começa com `\restrict`), não commitado, não versionado. Não mexido
nesta sessão — decidir na próxima se apaga ou arquiva fora do repo.

## PRÓXIMO PASSO

**Confirmar o estado real do catálogo em produção antes de qualquer outra
coisa.** Duas perguntas em aberto, nesta ordem:

1. **As migrations rodaram em produção?** A tentativa de seed sugere que sim
   (as tabelas existiam), mas isso não foi confirmado por consulta direta
   nesta sessão. Verificar com uma conexão nova: `psql -U aventix -d aventix
   -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"` — espera-se `4`.
2. **O catálogo persistiu?** A sessão anterior de seed bateu na armadilha do
   console (seção 19 do CLAUDE.md): só o `INSERT` do tenant, feito como
   statement isolada, é confirmado como persistido. Os outros 18 inserts
   (recursos, experiências, settings) podem ou não ter sobrevivido. Verificar
   com conexão nova: `psql -U aventix -d aventix -c "SELECT count(*) FROM
   resources;"` (esperado 2), idem para `experiences` (2) e `settings` (13).
   Se qualquer contagem vier zero ou parcial, repetir o seed seguindo o
   protocolo da seção 19 (statement por statement via `psql -c`), nunca
   `psql -f` colado no console.

**Depois de confirmar isso:** o próximo passo de código continua sendo a
**tela de status da reserva com polling**
(`app/(public)/reserva/[id]/page.tsx` + `GET /api/reservations/{id}/status`,
seção 14). É o buraco visível do fluxo de venda: hoje o cliente paga o Pix, a
reserva confirma no banco, e a tela dele continua dizendo "Falta pagar". O
ponto de costura já está comentado em `steps.tsx` (`StepDone`).

## Migrations

- **Quatro no disco:** `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`.
- **Local:** as quatro aplicadas. `drizzle.__drizzle_migrations` com 4 linhas,
  conferido nesta sessão.
- **Produção:** provavelmente `4/4` (ver PRÓXIMO PASSO), mas não confirmado
  por ferramenta nesta sessão — só inferido do fato de o dono ter conseguido
  tentar um `INSERT` contra tabelas que precisam existir primeiro.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A `0001` continua editada à mão e precisa continuar assim se for regerada.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e intacto (2 recursos
ativos, 2 experiências ativas em `payment_mode='full'`, 13 settings). Movimento
zerado — as tabelas de teste são limpas pelo próprio Vitest a cada rodada. As
6 reservas de demonstração (`npm run db:seed:demo`) não estão semeadas.

## Pendências e dívidas conhecidas

**Deploy (novas nesta sessão)**
- **Estado do catálogo em produção incerto.** Ver PRÓXIMO PASSO. Bloqueadora
  número um da Fase 4 agora.
- **Artefato solto `seed-producao.sql` na raiz do repo**, não commitado.
  Decidir se apaga ou arquiva fora do repo.
- **Rota `POST /api/admin/seed` como saída permanente do SQL manual em
  produção** — registrada como tarefa pós go-live na seção 19 do CLAUDE.md,
  ainda sem lugar no board do Orbi (o dono precisa criar).

**Deploy (da sessão anterior, resolvida se a inferência acima se confirmar)**
- ~~Divergência não explicada entre local e Easypanel (ENOENT
  `/app/drizzle`).~~ Provavelmente resolvida — confirmar com o passo 1 do
  PRÓXIMO PASSO antes de riscar de vez.
- **Custo de imagem por causa do `tsx` em dep** aceito como trade-off (decisão
  de 18/08). Se apertar por tamanho, o caminho de saída é migrar `seed.ts`
  e `hash-password.ts` para JS puro ou pré-compilar no build.

**Fluxo de venda**
- **Tela de status/polling não existe.** O cliente paga e a tela dele não
  muda.
- **Termo sem checagem de versão vigente no servidor.** `createReservation`
  valida só a presença de `termo.version`, não que bata com `TERM_VERSION`.
- **A grade não mostra horário insuficiente.** `GET /api/availability` não
  informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
- Erro do telefone do contato de emergência chega com mensagem genérica, sem
  distinguir de quem é o telefone.

**Integração de pagamento**
- **Indicador de saúde da integração no `/admin` não construído** (seção 8-B).
  Sem ele, fila interrompida só aparece quando o cliente reclama.
- **Cinco divergências entre a seção 8 e o que foi medido**, ainda não
  resolvidas: (a) 8.2 lista dois eventos, mas o webhook assina três e o Pix
  entrega `PAYMENT_CONFIRMED` junto; (b) 8-C diz "sinaliza estorno pendente na
  reserva", sugerindo campo, e a implementação usa estado derivado; (c) a
  regra 6 não cobre 404 do provedor, que também é órfã; (d) a 8.3 não
  menciona que o registro do pagamento precisa sobreviver à colisão, o que
  exige savepoint; (e) 8-B pede o indicador de saúde, não construído.
- **Modo sinal (`deposit`) não é vendável:** o CRUD recusa com 422 e
  `receiveInCash` não foi implementado. Fora do MVP por decisão de 04/08.
- Os testes do webhook mockam `getCharge` (a borda de rede). O banco é real.

**Produção (Fase 4, depende do cliente)**
- **Chave de API de produção não gerada.** Sem ela o boot avisa e nenhuma
  reserva se completa.
- **`ASAAS_API_KEY` precisa de escape `\$` também no Easypanel**, que injeta
  env em runtime. Sem isso a chave chega vazia.
- **Webhook de produção não cadastrado.** O que existe aponta para o ngrok, é
  do sandbox e a URL muda a cada reinício do túnel.
- **Chave Pix do Quadri Club pendente** (tarefas no board do cliente). Sem ela
  o QR só é pagável até 23:59 do mesmo dia.
- **O nome no copia-e-cola é da conta sandbox** (`NEOSOLUTI COMERCIO E SERV`).
  Em produção precisa ser o Quadri Club.
- Chave SSH do VPS não configurada; acesso por senha de root.

**Gerais**
- `npm install` da sessão de 18/08 reportou 10 vulnerabilidades (4 moderate, 6
  high) na árvore existente. Vale um `npm audit` em outra sessão.
- `instrumentation.ts` compila para Edge Runtime e falha lá (`node:crypto`),
  poluindo o log de dev a cada request.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations`.
- Sessão sem revogação (iron-session, 8h). Aceito no MVP de usuário único.
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- **13 valores PROVISÓRIOS** em `lib/templates/quadriciclo.ts`.
- `getDayGrid` duplica a precedência exceção-sobre-`operating_hours` que já vive
  em `lib/availability.ts`.
- Blocos não adjacentes da mesma reserva não têm vínculo visual entre si.
- `operating_hours` permite faixas sobrepostas no mesmo weekday.
- Experiência gratuita não é suportada; o CRUD recusa preço zero.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Cron em dev: o timer guarda a versão do módulo carregada no boot.

## Deploy

`main` está em `5dca8b0` (pushed) mais as duas edições de documentação desta
sessão, ainda não commitadas — ver passo 4 do ritual. Nenhum código novo desde
`511b4d5`.

Sequência esperada de produção: (1) confirmar que as 4 migrations rodaram
(PRÓXIMO PASSO, passo 1); (2) confirmar ou refazer o seed do catálogo seguindo
o protocolo seguro da seção 19 do CLAUDE.md (passo 2); (3) antes de vender,
gerar a chave de produção do Asaas (com escape do `$`), cadastrar o webhook de
produção com token próprio e confirmar a chave Pix do Quadri Club.

## Prazo

Go-live 24/08, 5 dias, ritmo de cerca de 2h/dia. O fluxo de compra funciona
ponta a ponta em sandbox. O que falta para lançar é: confirmar o estado real
de produção (migrations + catálogo), construir a tela de status, resolver as
pendências do cliente. Candidatos a corte já acordados com o cliente: agenda
compartilhada, lista de clientes com faturas, CRUD de recursos e tela de
configurações.
