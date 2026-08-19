# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-19

## Onde estamos

**Deploy da Fase 4 concluído, rodando com sandbox.** O sistema está no ar em
**https://aventix.com.br**: código novo servido, banco de produção migrado
(4/4) e catálogo semeado. O ciclo do dinheiro funciona ponta a ponta tanto
local quanto em produção, em ambos os casos contra o **sandbox** do Asaas —
QR gerado, webhook recebido, reserva confirmando sozinha, sem dinheiro real
envolvido. Fase 3 continua em 6 de 9. Go-live: **24/08/2026** (faltam 5 dias).

As duas perguntas que o estado anterior deixou em aberto estão **respondidas**:
as migrations rodaram em produção e o catálogo persistiu. Detalhe de como em
"O que esta sessão fez".

## Pronto

**Fases 0 e 1** — schema (13 tabelas + exclusion constraint), tenant/settings,
motor de disponibilidade, criação transacional, cron de expiração de hold, seed
como template de segmento.

**Fase 2 completa** (fechada em 17/08) — `PaymentProvider`/Asaas Pix, modo
integral e sinal em código (sinal não vendável no CRUD), webhook com as oito
regras invioláveis da seção 8, job de reconciliação de 10 min e migration `0003`
com `customers.asaas_customer_id` e `reservation_payments.asaas_invoice_url`.

**Fase 3, tarefas 1 a 6** — auth + `proxy.ts`; calendário nativo (dia/semana/mês)
em uma query; painel sobreposto de detalhe e cancelamento; CRUD de experiências;
formulário público de 6 passos; termo real com rolagem obrigatória e contato de
emergência.

**Fase 4, deploy inicial** (19/08) — código em produção no domínio real,
migrations aplicadas pelo `instrumentation.ts` no boot, catálogo do Quadri Club
semeado, `GET /api/experiences` respondendo com as duas trilhas. Apontando para
sandbox do Asaas até as credenciais de produção chegarem.

## O que esta sessão fez

Deploy inicial em produção, do zero ao fluxo respondendo no domínio. Quatro
problemas descobertos e resolvidos no caminho, todos só observáveis em
produção:

1. **Path das migrations na imagem.** O `output: 'standalone'` do Next reescreve
   a raiz do que vai para o container, e os `.sql` precisam aterrissar onde o
   processo os enxerga como `/app/drizzle`. Foi a causa do `ENOENT` que o estado
   anterior registrou como mistério. **Atenção:** o `Dockerfile` da árvore
   continua com `COPY --from=builder /app/drizzle ./drizzle` (linha 35), sem
   alteração desde `799523d`, e o working tree está limpo — se algum ajuste de
   path foi de fato aplicado para destravar o deploy, ele **não está commitado
   neste repositório**. Conferir antes do próximo build, porque um deploy futuro
   partindo desta árvore pode reintroduzir o problema.
2. **`tsx` e `scripts/` descartados pelo standalone.** O critério do standalone é
   "o código em runtime importa isto?", e não `dependency` vs `devDependency` —
   por isso mover o `tsx` para `dependencies` (commit `511b4d5`) não resolveu:
   `node_modules/.bin/` não é preservado e `scripts/` não vai para a imagem.
   `npm run db:seed` não funciona em produção.
3. **Armadilha do console web do Easypanel** quebrando a semântica de `COMMIT`
   em SQL colado. Já registrada na **seção 19 do CLAUDE.md** nesta mesma sessão,
   com o protocolo de verificação.
4. **`tenants` faltou no dump inicial de seed.** O `pg_dump` explicitou só
   `-t settings -t resources -t experiences -t operating_hours`. Sem a linha do
   tenant, as demais entraram com `tenant_id = 1` órfão e `/api/experiences`
   respondia `[]` **sem erro nenhum** — a query filtrada por tenant simplesmente
   não achava nada. Achado por eliminação, depois de descartar cache, filtro e
   conexão errada. Corrigido criando o tenant explicitamente.

Verificado contra produção, não por relatório: `drizzle.__drizzle_migrations`
com as 4 linhas; catálogo com 1 tenant, 2 recursos, 2 experiências, 2 faixas de
`operating_hours` e 13 settings; e `curl` contra o domínio devolvendo as duas
trilhas —
`{"experiences":[{"id":2,"name":"Trilha da Fazenda","durationMinutes":60,"priceCents":23249,"paymentMode":"full"},{"id":1,"name":"Trilha da Montanha","durationMinutes":90,"priceCents":32549,"paymentMode":"full"}]}`.

Antes do deploy, ainda nesta sessão, o CLAUDE.md ganhou a **seção 19 —
Armadilhas de infraestrutura (Easypanel)** e o `DECISOES.md` a entrada que
aponta para ela (commit `7bc5174`).

## PRÓXIMO PASSO

**Tela de status da reserva com polling** —
`app/(public)/reserva/[id]/page.tsx` + `GET /api/reservations/{id}/status`
(seção 14). É o buraco visível do fluxo de venda, e agora o único bloqueio que
depende só de código: o cliente paga o Pix, a reserva confirma no banco pelo
webhook, e a tela dele continua dizendo "Falta pagar". O ponto de costura já
está comentado em `steps.tsx` (`StepDone`).

**Alternativa, se a prioridade for autonomia do dono no dia 1:** os CRUDs
operacionais que faltam — horários (`operating_hours`), bloqueios (`blackouts`)
e exceções de agenda (`schedule_exceptions`). Sem eles, qualquer mudança de
grade ou feriado no dia do lançamento passa pelo dev.

## Migrations

- **Quatro no disco:** `0000_oval_mandroid`, `0001_busy_tomorrow_man`,
  `0002_emergency_contact`, `0003_asaas_ids`.
- **Local:** as quatro aplicadas, `drizzle.__drizzle_migrations` com 4 linhas.
- **Produção:** as quatro aplicadas. Confirmado por consulta direta a
  `drizzle.__drizzle_migrations` no container de produção nesta sessão.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- A `0001` continua editada à mão e precisa continuar assim se for regerada.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e intacto (2 recursos
ativos, 2 experiências ativas em `payment_mode='full'`, 13 settings). Movimento
zerado — as tabelas de teste são limpas pelo próprio Vitest a cada rodada. As
6 reservas de demonstração (`npm run db:seed:demo`) não estão semeadas.

## Banco de produção

Migrado e semeado. Catálogo: 1 tenant (Quadri Club), 2 recursos, 2
experiências, 2 faixas de `operating_hours`, 13 settings. **Movimento zerado** —
nenhuma reserva real ainda. Hostname interno da rede Docker
(`approvee_aventix-db`, herança do nome antigo do serviço), não alcançável por
SSH clássico de fora; o acesso que funciona é o console de um container que já
está na rede.

## Pendências e dívidas conhecidas

**Deploy e produção**
- **Possível ajuste de path do `drizzle` não commitado.** Ver item 1 de "O que
  esta sessão fez". Primeira coisa a conferir antes do próximo build.
- **Sem CI/CD** — deploy é clique manual no Easypanel depois do `git push`.
  Aceito para o MVP, candidato à semana pós go-live.
- **Seed é operação manual em produção.** Se precisar re-semear (tenant novo,
  mudança de template), o caminho é o console do container do Postgres com
  `psql -c` isolado, statement por statement, seguindo o protocolo da seção 19
  do CLAUDE.md. Solução permanente é a rota `POST /api/admin/seed`, pós go-live.
- **Artefato solto `seed-producao.sql` na raiz do repo**, não commitado.
  Decidir se apaga ou arquiva fora do repo.
- Chave SSH do VPS não configurada; acesso por senha de root.

**Dependem do cliente (bloqueiam dinheiro real)**
- **Chave de API de produção do Asaas não gerada.** Enquanto isso, produção
  roda em **sandbox** — funcional para teste ponta a ponta, sem cobrar dinheiro
  real. Trocar `ASAAS_API_KEY` e `ASAAS_BASE_URL` no Easypanel quando chegar,
  com escape `\$`, sem mudar código.
- **Webhook de produção não cadastrado.** Depende da chave acima. URL definitiva
  `https://aventix.com.br/api/webhooks/asaas`, exata, sem barra final.
- **Chave Pix do Quadri Club pendente.** Sem ela o QR só é pagável até 23:59 do
  mesmo dia.
- **O nome no copia-e-cola é da conta sandbox** (`NEOSOLUTI COMERCIO E SERV`).
  Em produção precisa ser o Quadri Club.

**Fluxo de venda**
- **Tela de status/polling não existe.** O cliente paga e a tela dele não muda.
  É o PRÓXIMO PASSO.
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
  regra 6 não cobre 404 do provedor, que também é órfã; (d) a 8.3 não menciona
  que o registro do pagamento precisa sobreviver à colisão, o que exige
  savepoint; (e) 8-B pede o indicador de saúde, não construído.
- **Modo sinal (`deposit`) não é vendável:** o CRUD recusa com 422 e
  `receiveInCash` não foi implementado. Fora do MVP por decisão de 04/08.
- Os testes do webhook mockam `getCharge` (a borda de rede). O banco é real.

**Gerais**
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high) na
  árvore existente. Vale um `npm audit` em outra sessão.
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

`main` local está em `7bc5174` (docs da seção 19); o último commit de **código**
é `511b4d5`, e é dele que a imagem em produção deriva. O log de boot do
container confirmou as migrations aplicadas e os fail-fast de auth e de
pagamento passando. O site responde no domínio e `GET /api/experiences` devolve
as duas trilhas.

Para colocar dinheiro real no ar, quando o cliente destravar: (1) gerar a chave
de produção do Asaas e pôr no Easypanel com escape `\$`; (2) trocar
`ASAAS_BASE_URL` para a URL de produção; (3) cadastrar o webhook de produção
com token próprio apontando para `https://aventix.com.br/api/webhooks/asaas`;
(4) confirmar a chave Pix do Quadri Club na conta.

## Prazo

Go-live 24/08, 5 dias, ritmo de cerca de 2h/dia. **O deploy tirou o principal
risco técnico da mesa** — o que sobra de código é a tela de status e,
opcionalmente, os CRUDs operacionais. O caminho crítico agora é o cliente:
chaves de produção do Asaas e chave Pix. Candidatos a corte já acordados:
agenda compartilhada, lista de clientes com faturas, CRUD de recursos e tela de
configurações.
