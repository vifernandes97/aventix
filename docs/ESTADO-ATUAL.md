# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-18

## Onde estamos

**Fase 2 concluída em sandbox** (fechada na sessão anterior). **Fase 4 (deploy)
iniciada:** o caminho de aplicar as quatro migrations dentro do container está
implementado e provado localmente, mas a primeira tentativa de subir a Fase 2
para o Easypanel falhou com sintoma que os artefatos do repositório não
explicam — investigação aberta, ver Deploy abaixo. Fase 3 continua em 6 de 9.
Go-live: **24/08/2026** (faltam 6 dias).

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

## O que esta sessão fez

Dois commits em `main`, ambos pushed:

1. `799523d` **migrations no boot** pelo `instrumentation.ts` (opção 1 das três
   investigadas, decisão registrada em `DECISOES.md`). Roda ANTES dos fail-fast
   de auth/Asaas e dos crons. Falha DERRUBA o processo (`process.exit(1)`),
   diferente dos outros dois fail-fast, que avisam e seguem — servir com schema
   incerto corromperia dados. Guarda por promise memoizada no `globalThis`, não
   boolean, porque o migrator do drizzle 0.45.2 não usa advisory lock e dois
   `register()` concorrentes precisam compartilhar a mesma execução. Dockerfile
   ganhou `COPY --from=builder /app/drizzle ./drizzle` no estágio runner — o
   trace do standalone deixa os `.sql` de fora, então a pasta é copiada
   explicitamente com os quatro `.sql` e o `meta/_journal.json`. Provado
   localmente contra a imagem real: build sem cache produz `/app/drizzle` com
   os 9 arquivos; boot da imagem em banco vazio aplica as 4 migrations e cria
   as 13 tabelas + `btree_gist` + a exclusion constraint; falha com
   `DATABASE_URL` inválido derruba com exit 1 e banner claro; segundo boot é
   no-op.
2. `511b4d5` **`tsx` movido para `dependencies`** para que `npm run db:seed`
   funcione no container do Easypanel. Como devDependency o binário sumia do
   runtime da imagem — o standalone do Next só carrega as deps runtime, mesmo
   os scripts do `package.json` intactos falhavam com "tsx: not found".
   Trade-off registrado no `DECISOES.md`: aumenta o tamanho da imagem, mas seed
   em produção é operação real, não só de dev.

Verificado ao fim: `npx tsc --noEmit` limpo, `npm test` **55 passed** (9
arquivos), `npm run db:generate` sem mudanças, `npm run db:seed` reconcilia o
catálogo (13/2/2/2 "sem mudança").

## PRÓXIMO PASSO

**Fechar o mistério do Easypanel antes de mais qualquer código.** O log do
container em produção mostrou `ENOENT: no such file or directory, scandir
'/app/drizzle'` depois do commit `799523d` — o que é incompatível com o build
`--no-cache` desta árvore, que produz uma imagem com `/app/drizzle` populado.
Duas hipóteses testáveis do lado do painel, ambas fora do que o repo controla:
(a) a imagem em execução é anterior a `799523d`, seja por cache de camada ou
por o container do runtime não ter sido recriado sobre a imagem nova; (b) o
contexto de build no Easypanel difere do repo, com `.dockerignore` de serviço,
`Dockerfile` alternativo ou subdiretório errado. Dado empírico útil, se
disponível: o log completo do build no Easypanel (a linha
`COPY --from=builder … /app/drizzle ./drizzle` aparece?) e o SHA da imagem que
o container está de fato executando. Sem esses dois dados, mexer no Dockerfile
é chute.

**Depois disso, e assumindo que a Fase 2 de fato entrou:** o próximo passo de
código é o mesmo que já estava — a **tela de status da reserva com polling**
(`app/(public)/reserva/[id]/page.tsx` + `GET /api/reservations/{id}/status`,
seção 14). É o buraco visível do fluxo de venda: hoje o cliente paga o Pix, a
reserva confirma no banco, e a tela dele continua dizendo "Falta pagar". O
ponto de costura já está comentado em `steps.tsx` (`StepDone`).

## Migrations

- **Quatro no disco:** `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`.
- **Local:** as quatro aplicadas. `drizzle.__drizzle_migrations` com 4 linhas,
  conferido nesta sessão.
- **Produção:** ainda **incerto**. O caminho de aplicar existe (via
  `instrumentation.ts`), foi provado contra a imagem local, e o commit está em
  `origin/main`. Se o Easypanel de fato serviu a imagem nova, o banco de
  produção deve estar em `4/4`. O ENOENT do log sugere que não serviu; o passo
  acima é descobrir se sim ou não.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A `0001` continua editada à mão e precisa continuar assim se for regerada.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e intacto (2 recursos
ativos, 2 experiências ativas em `payment_mode='full'`, 13 settings). Movimento
zerado — as tabelas de teste são limpas pelo próprio Vitest a cada rodada. As
6 reservas de demonstração (`npm run db:seed:demo`) não estão semeadas.

## Pendências e dívidas conhecidas

**Deploy (novas nesta sessão)**
- **Divergência não explicada entre local e Easypanel.** Ver PRÓXIMO PASSO. É a
  bloqueadora número um da Fase 4.
- **Custo de imagem por causa do `tsx` em dep** aceito como trade-off (decisão
  desta sessão). Se apertar por tamanho, o caminho de saída é migrar `seed.ts`
  e `hash-password.ts` para JS puro ou pré-compilar no build.

**Fluxo de venda**
- **Tela de status/polling não existe** (fica pra depois de resolver o
  Easypanel). O cliente paga e a tela dele não muda.
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
- **Cinco divergências entre a seção 8 e o que foi medido**, levantadas na
  sessão anterior e ainda não resolvidas: (a) 8.2 lista dois eventos, mas o
  webhook assina três e o Pix entrega `PAYMENT_CONFIRMED` junto; (b) 8-C diz
  "sinaliza estorno pendente na reserva", sugerindo campo, e a implementação
  usa estado derivado; (c) a regra 6 não cobre 404 do provedor, que também é
  órfã; (d) a 8.3 não menciona que o registro do pagamento precisa sobreviver à
  colisão, o que exige savepoint; (e) 8-B pede o indicador de saúde, não
  construído.
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
- `npm install` desta sessão reportou 10 vulnerabilidades (4 moderate, 6 high)
  na árvore existente. Não relacionadas ao movimento do `tsx` — nada foi
  introduzido, só que passou a aparecer com a reinstalação. Vale um `npm audit`
  em outra sessão.
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

`main` está em `511b4d5` e foi pushed. Os dois commits desta sessão vieram para
destravar o Easypanel: `799523d` faz o container migrar sozinho no boot e
`511b4d5` faz o `db:seed` funcionar quando o Easypanel abrir um terminal no
container para popular o tenant.

Sequência esperada de produção, quando o Easypanel de fato subir a imagem
nova: (1) o boot roda as 4 migrations em cima do banco vazio de produção; (2)
`npm run db:seed` num terminal do container popula o tenant do Quadri Club;
(3) antes de vender, gerar a chave de produção do Asaas (com escape do `$`),
cadastrar o webhook de produção com token próprio e confirmar a chave Pix do
Quadri Club.

## Prazo

Go-live 24/08, 6 dias, ritmo de cerca de 2h/dia. O fluxo de compra funciona
ponta a ponta em sandbox. O que falta para lançar é: destravar o Easypanel,
construir a tela de status, resolver as pendências do cliente. Candidatos a
corte já acordados com o cliente: agenda compartilhada, lista de clientes com
faturas, CRUD de recursos e tela de configurações.
