# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-09-01

## Enquadramento (leia antes de priorizar qualquer coisa)

**O faseamento de pagamento da rev 7 ACABOU e está em produção.** Fases 0, A, B,
C, D e E concluídas: Pix integral, Pix com sinal de 50% e cartão de crédito.

**A área de trabalho agora é AUTONOMIA DO TENANT**, e o enquadramento mudou hoje:

> **O Quadri Club é o PRIMEIRO cliente, não O cliente.** Num produto vendido para
> outras empresas, **"o dev configura" é o que impede vender o segundo.** Telas
> de configuração deixaram de ser conveniência e viraram requisito de produto.

O link de agendamento continua não divulgado. Nada é urgente por cliente real;
tudo é preparação para outubro, quando sai o vídeo do **@grandecampinas**.

## Branch pronta, aguardando revisão (NÃO é pendência esquecida)

**`feat/seed-nao-sobrescreve` está COMPLETA e NÃO MERGEADA, por decisão do dono,
que vai revisar depois.** Um commit (`08ed115`), suíte verde, banco zerado
testado. **Não retomar como trabalho pela metade e não refazer.**

O que ela faz: `experiences` vira **insert-only** no seed (antes reconciliava, e
desfazia o que o dono editava no `/admin/experiencias`), e o seed passa a
**relatar** o que não corrige. **Ela fecha a AUT-4 e é infraestrutura das outras
três fases** — a regra "tela primeiro, insert-only junto" depende dela existir.

## PRÓXIMO PASSO — as quatro fases de autonomia

Cinco dos sete itens levantados são a **mesma peça técnica** (`settings`), então
uma tela resolve quatro de uma vez. Ordem executável:

| Fase | O que é | Estado |
|---|---|---|
| **AUT-1** | Termo de aceite editável, com **versionamento imutável** | a mais complexa — ver abaixo |
| **AUT-2** | `/admin/configuracoes`: telefone, o que levar, mapa, ponto de encontro | esforço baixo, autonomia máxima |
| **AUT-3** | CRUD de recursos (quadriciclos) | última entidade do catálogo sem tela |
| **AUT-4** | Idade mínima do garupa | **FECHADA** pela branch acima |

**Regra de ordem, inviolável nas quatro:** **tela primeiro, `insert-only` no seed
junto com ela, item a item — nunca antes.** Tirar a reconciliação de campo sem
tela deixa o valor sem caminho de conserto que não seja psql em produção.

### Por que a AUT-1 é a mais cara: é VERSIONAMENTO, não confiança

O problema não é o dono escrever besteira. É que `reservations.termo_version`
grava **qual versão** foi aceita, e nunca o corpo. **Se a tela editar o texto de
uma versão existente, quem aceitou antes passa a apontar para um texto que nunca
leu, e o registro jurídico vira ficção.**

**A tela precisa CRIAR VERSÃO NOVA a cada publicação.** Implica:

- o termo **sai de `lib/terms/` e vai para o banco**;
- **v1 e v2 migram**, preservando byte a byte o que já foi aceito;
- a **imutabilidade é imposta pelo BANCO**, não por disciplina de código;
- **o grupo X precisa ser repensado**: ele fixa o sha256 do v1 **do arquivo**, e
  com o texto no banco aquele hash deixa de ter o que proteger. A proteção
  equivalente passa a ser o teste de que versão publicada não pode ser alterada.

Isto reabre a decisão de 09/08 ("termo não tem editor no admin"), que previa a
própria condição de reabertura e a viu cumprida. Seção 10 do CLAUDE.md.

### Fora do escopo desta área, prioridade menor (já no board do dono)

Integração Asaas por tela e criação de tenant novo. **As duas dependem da Etapa 2**
(`getTenantId()` real, seção 2-B).

## Estado de produção

Produção está com a **Fase E deployada**, eventos de cartão e chargeback
habilitados no Asaas, e a experiência TESTE desativada.

- **Migrations: 10 no disco, 10 aplicadas em local, 10 em produção.**
- **`card_machine_rates` continua VAZIA** — estado esperado; os percentuais reais
  não chegaram. Registro de maquininha grava `net_cents = NULL` e aparece na
  contagem de `/admin/financeiro`.
- **3 reservas da borda 9** (cobrança nunca criada) continuam lá. O reconciliador
  ainda avisa, e é o único sinal que existe.
- **Duas cobranças de teste no sandbox** (`3aa77hmzw2yshk6r` da Fase C e
  `.../i/uwgiwc7t7e35bkad` da Fase E).
- **Nada a rodar em produção** por causa da branch: o seed não roda lá (o boot só
  migra, e `scripts/` nem entra na imagem standalone), e insert-only é
  estritamente mais seguro que o comportamento anterior.

## O que foi entregue nesta sessão

**Levantamento de autonomia** (`docs/LEVANTAMENTO-AUTONOMIA.md`): tudo que o dono
não controla sozinho, em três categorias, com classificação de risco por item. É
a base das quatro fases acima.

**Remendo do `payment_mode` no template.** O template dizia `full` nas duas
trilhas enquanto produção estava em `deposit` desde 28/08. Rodar o seed teria
desligado o sinal de 50%, sem erro e sem log.

**Seção 14 reconciliada com a realidade.** Nove itens fantasma marcados
`[NAO CONSTRUIDO]` (a lista inicial tinha seis; a auditoria dos 74 caminhos achou
mais três), e a direção inversa também: `/api/health` existia e não era citada.
`shared_calendar_links` ganhou bloco no schema dizendo que não tem um consumidor.

**Seed insert-only** (na branch). Ver acima.

## Três lições de método desta sessão

**1. O verde não prova o que afirma — e há duas formas de isso acontecer.**
A regra de 31/08 (mutação) cobria uma: teste que passa sem que a proteção exista.
Esta sessão expôs a **irmã**: `U3.2` afirmava testar "experiência sem sinal" e
**nunca estabelecia esse estado** — passava por **acidente de ordem de execução**,
dependendo de outro teste ter deixado o cenário montado. **Toda precondição de
catálogo se declara no próprio caso.**

**2. Documento que descreve sistema maior que o real produz especificação sobre
software imaginário.** Custou tempo três vezes em cinco dias. Daí a seção 14
auditada item a item.

**3. Aviso que sempre dispara vira fundo.** Foi o argumento contra transformar o
relato de divergências do seed em alarme: depois da primeira edição do dono,
divergência é o estado **normal e permanente**.

## Pendências que NÃO podem se perder

**1. `feat/seed-nao-sobrescreve` aguarda revisão do dono.** Pronta, não é dívida.

**2. Termo v2 em produção sem aprovação do cliente.** **Decisão do dono, não
pendência do agente:** produção é ambiente de homologação, o link não foi
divulgado, e a aprovação sai numa reunião. Está no board do Orbi.

**3. Cancelar reserva não cancela a cobrança de saldo no Asaas.** O cliente
cancelado ainda consegue pagar. **Destravada:** foi adiada para depois da Fase E
justamente porque o chargeback toca a mesma região, e agora o quadro está
completo.

**4. Percentuais da maquininha** não enviados pelo cliente.

## Dívidas conhecidas

**Verificação em navegador**
- Conferidas: agenda, painel de detalhe, financeiro, wizard público e as três
  telas de cartão (fatura, em análise, recusado).
- Sem conferência: experiências, horários, bloqueios, exceções, clientes e
  agendamentos.
- Método: cookie selado com `iron-session` a partir do `SESSION_SECRET` local,
  script temporário, apagado depois.

**Telas e rotas previstas que NÃO existem** (todas marcadas na seção 14)
- `/admin/clientes` + `GET /api/admin/customers`, `/admin/recursos`,
  `/admin/configuracoes`, `/admin/compartilhar`, `/admin/integracao`,
  `/admin/reservas/[id]`, `app/(public)/agenda/[token]`,
  `/api/shared/[token]/agenda`, `/api/admin/integration/health`.
- `shared_calendar_links` existe no schema **sem um único consumidor**: a agenda
  compartilhada por link secreto, item do MVP, nunca foi construída.

**Cartão (fora de escopo, decidido)**
- Parcelamento e antecipação de recebíveis. A cobrança é sempre à vista.
- Não há caminho para trocar o meio de pagamento de uma reserva já criada.

**Integração de pagamento**
- Indicador de saúde no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `findChargeByExternalReference`: o filtro do Asaas não foi medido isoladamente;
  a conferência defensiva é o que garante o resultado.
- Na adoção de cobrança órfã o `invoiceUrl` fica `null`. Sem impacto conhecido.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- Etapa 2 não feita: `getTenantId()` devolve 1 fixo, com
  `assertResolvedTenantIsCurrent()` impedindo divergência silenciosa.
- Critério de conclusão: poder apagar aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.
- **Bloqueia** os dois itens fora de escopo da autonomia.

**Ambiente de teste**
- O `.env` guarda o hash escapado (`\$`) para o Next, e o `dotenv` puro dos testes
  não expande. Grupo que teste rota autenticada precisa desfazer o escape no
  `process.env` antes da primeira chamada, como faz o grupo W.

**Gerais**
- Sem CI/CD; deploy é clique manual no Easypanel.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- 3 avisos de Edge Runtime no build, conhecidos e estáveis.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo torna isto mais
  relevante do que era**.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor.
  Precedente pronto na Fase C. Reavaliar antes do vídeo.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais mergeadas, podem ser apagadas: `feat/cartao`,
  `feat/maquininha`, `feat/tenant-slug`, `feat/idade-e-mapa`,
  `feat/config-financeira`, `feat/preco-por-metodo`, `feat/sinal-50`,
  `feat/texto-informacoes`.

## A observar nos testes com gente real (não são tarefas ainda)

**1. Quantas análises de risco do cartão passam de 15 minutos.** O hold corre
durante a análise; vencendo, o cron expira e cai no pagamento tardio (seção 8.3),
que já trata. **Não estendido de propósito:** mexer no cron sem saber a
frequência real é otimização às cegas.

**2. Se algum cliente procura como trocar de meio de pagamento** depois de o
cartão ser recusado. Não existe caminho, e a tela deixou de prometer um.

## Testes

`npm test`: **25 arquivos, 277 casos, todos passando** — inclusive **com o banco
zerado** (`docker compose down -v`), que semeia 21 registros e passa direto.

- Grupo **V** (Fase C) e **W** (Fase D) — validados por mutação.
- Grupo **X** (termo, 9 casos) — sha256 do v1 fixado. **Precisa ser repensado na
  AUT-1**, quando o texto sair do repositório.
- Grupo **Y** (Fase E, 23 casos) — **todos** validados por mutação (7 mutações).

## Banco local

Container `aventix-db-dev` no ar, **recriado do zero nesta sessão**. 10 migrations
no disco, 10 aplicadas; `npm run db:generate` responde "No schema changes".

Catálogo alinhado com produção: as duas trilhas em `deposit`, `deposit_percent`
50, idades 12 e 6, desconto Pix 700. Os helpers `comSinal` e `semSinal` agora
**restauram o valor que leram**, então a suíte não deixa catálogo sujo.
