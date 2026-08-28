# Estado atual: Aventix

> Sobrescrito a cada sessão pelo `/fim-de-sessao`. Não acumular histórico aqui.
> Última atualização: 2026-08-28

## Enquadramento (leia antes de priorizar qualquer coisa)

**O sistema está em produção, mas NINGUÉM tem o link de agendamento.** Não existe
cliente real, ninguém está pagando, e **não há nenhuma lacuna ativa causando dano
agora**. Toda pendência listada mais abaixo é **preparação para outubro**, nunca
incidente em curso.

Isso importa para não distorcer prioridade. "O cliente paga e não recebe e-mail"
não é um fato do presente: é um item da lista de conferência antes de abrir. O
**único caminho crítico são as fases de pagamento** (A..E). O resto é checklist.

**Prazo:** sistema pronto em **setembro**; uso real no **início de outubro**, com
o vídeo do influenciador **@grandecampinas**, que despeja os leads de uma vez. O
risco não é chegar a tempo — é **chegar testado com gente real antes do pico**.

## PRÓXIMO PASSO — Fase A: preço por método + Pix integral com desconto

A Fase 0 está concluída e a configuração já existe no banco. A Fase A é ligar o
desconto ao preço, e ela tem **duas metades**, sendo a segunda a arriscada:

1. **Trocar os valores do template para os preços CHEIOS** — Montanha 34999,
   Fazenda 24999 (hoje o template guarda 32549 e 23249, que são os preços **já
   com desconto**, o inverso do que a seção 4-B manda).
2. **Aplicar o desconto na venda**, lendo `getDiscountBasisPoints('pix')` e
   usando `applyDiscount` de `lib/basis-points.ts`. **Reusar, não reimplementar.**

**>>> DUAS ARMADILHAS NESSA TROCA <<<**

- **`lib/templates/quadriciclo.ts:94-103` PROÍBE textualmente o que a Fase A tem
  que fazer.** O comentário diz `>>> priceCents É O PREÇO PIX. <<<` e "NÃO troque
  estes valores pelos de cartão". Ele está certo para a rev 6 e errado para a
  rev 7. Trocar os números sem reescrever o comentário deixa a próxima pessoa com
  um aviso mandando desfazer a correção.
- **O seed RECONCILIA preço por nome** (`lib/seed.ts`, faz UPDATE na divergência).
  Trocar o template muda o preço em produção no próximo seed. Isso precisa ser
  decisão consciente, não descoberta.

### Faseamento (CLAUDE.md seção 17)

| Fase | Estado |
|---|---|
| **Fase 0** — configuração financeira | **CONCLUÍDA em 28/08** |
| **Fase A** — preço por método + Pix integral com desconto | **PRÓXIMA** |
| **Fase B** — sinal de 50% via Pix (`confirmed` + `partial`) | pendente |
| **Fase C** — cobrança do saldo sob demanda, idempotente | pendente |
| **Fase D** — registro manual da maquininha, líquido e taxa congelados | pendente |
| **Fase E** — cartão via `invoiceUrl` + chargeback | pendente |
| **Transversal** — líquido lido do Asaas | pendente |
| **Termo v2** — política de cancelamento + regra de remarcação | pendente, em paralelo |
| **Antes do vídeo** — testes com clientes reais | pendente |

## Fase 0 — o que foi entregue (28/08)

Migration **0006**: `payment_method_discounts` e `card_machine_rates`, mais o enum
`card_machine_modality`. Saiu completa do gerador, **sem edição à mão** (ao
contrário da 0001, 0004 e 0005).

- `lib/basis-points.ts` — **módulo PURO** de aritmética de percentual.
- `lib/financial-config.ts` — domínio, server-only.
- `/api/admin/financial-config/*` — GET agregado, PUT de desconto por método,
  CRUD de taxas com 409 de duplicata.
- `/admin/financeiro` + link na `AdminNav`.
- `tests/s-config-financeira.test.ts` — grupo S, 28 casos.

### As três decisões de desenho que governam as Fases A..E

Estão na seção 4-B.6 do CLAUDE.md e em `docs/DECISOES.md`. Repetidas aqui porque
quem pegar a Fase A precisa das três antes de escrever a primeira linha:

1. **Percentual em BASIS POINTS inteiro, nunca `numeric` nem float.** `numeric`
   chega do driver como **string**, e o primeiro `Number(x) * cents / 100`
   reintroduz o float binário que o `money.ts` existe para impedir — de forma
   invisível, porque o erro aparece na serialização, não no número.
2. **Duas tabelas, não uma.** Desconto é política de preço; taxa é fato do
   contrato com a adquirente, e é a que vai precisar de validade/versão.
3. **Ausência significa coisas diferentes.** Desconto ausente = **0%** (o cliente
   paga o cheio, *fail-safe*). Taxa ausente = **`NULL`, JAMAIS 0%** — taxa zero é
   mentira que faz o líquido parecer igual ao bruto. A Fase D **recusa** o
   registro quando não há taxa; `getCardMachineRate` retorna `| null` para o
   compilador obrigar a decisão.

**`lib/basis-points.ts` é o módulo de aritmética. As Fases A..E REUSAM, não
reimplementam.** Uma segunda implementação "só para exibir" é como as duas metades
divergem.

## >>> ARMADILHA QUE CUSTOU QUATRO DIAS: o seed NUNCA roda em produção <<<

O `instrumentation.ts` do boot aplica **apenas migrations**. Semear é
`scripts/seed.ts`, e o build standalone **descarta `scripts/` da imagem**. Não há
caminho automático que aplique o template em produção.

Configuração nova entra no template, funciona local, passa nos testes, sobe no
deploy e **não chega ao banco** — sem erro e sem log, porque o código trata chave
ausente **omitindo o bloco**, que é o comportamento correto. A defesa que impede a
tela de quebrar é a mesma coisa que torna a falha silenciosa.

**Sintoma real:** `meeting_point_map_url` nunca foi semeada. O mapa subiu no
deploy de 24/08 e **nunca apareceu em produção**. Ficou quatro dias assim,
descoberto **por acaso** em 28/08.

**REGRA:** todo deploy que introduza setting ou tabela de configuração exige
conferência por `SELECT` **no banco de produção**, na mesma janela do deploy.
Migration aplicada **não** significa dado semeado.

**Caminho definitivo, agora com prioridade real:** a rota `POST /api/admin/seed`,
protegida por sessão, chamando `seedTenant()` de dentro do Next. Enquanto não
existir, a conferência manual é a única rede.

## Estado de produção (VERIFICADO por SELECT em 28/08, não relatado)

- Commit em produção: **`d287739`** (`main` = `origin/main`).
- **Migration 0006 aplicada**; 15 tabelas, incluindo `payment_method_discounts` e
  `card_machine_rates`.
- `payment_method_discounts` = **`pix | 700`**, semeado **à mão**.
- `card_machine_rates` **VAZIA** — nasce assim de propósito.
- `settings` = **15**, com `support_whatsapp` e `meeting_point_map_url` semeados
  **à mão neste deploy** (é a armadilha acima em ação).

## Migrations

- **Sete no disco**, de `0000_oval_mandroid` a `0006_awesome_anita_blake`.
- **Local:** as sete aplicadas (`drizzle.__drizzle_migrations` com 7 linhas).
- **Produção:** as sete aplicadas, verificado por SELECT.
- `npm run db:generate` responde "No schema changes, nothing to migrate".
- **A 0001, a 0004 e a 0005 estão editadas à mão** e precisam continuar assim se
  regeradas — na 0005 o que se perde é o **backfill**, silenciosamente. **A 0006
  não** foi editada e pode ser regerada sem perda.

## Testes

`npm test`: **19 arquivos, 172 casos, todos passando** (eram 18/144).

Grupo **S** (`tests/s-config-financeira.test.ts`, 28 casos): aritmética
(34999 a 7% = 32549, idêntico em 1000 execuções), isolamento entre tenants na
**leitura e na escrita**, 422 de percentual inválido, 409 de modalidade duplicada
com a `UNIQUE` do banco como segunda barreira, e **S5.2**, que prova a promessa da
seção 4-B.6: desconto alterado pelo dono sobrevive a dois `seedTenant()` seguidos.

Grupo **R** segue cobrindo idade do garupa e mapa; o caso **R4** continua sendo o
que trava o "conserto" errado de alinhar as duas regras de idade.

## Banco local

Container `aventix-db-dev` no ar. Catálogo semeado e reconciliado com o template.
**15 settings**, todas preenchidas — `support_whatsapp` = `5519999015663`, a
última que faltava. `payment_method_discounts` com `pix | 700`;
`card_machine_rates` vazia.

## Deploy

`main` = `origin/main` = **`d287739`**, com a Fase 0 mergeada. Deploy segue manual
(clique em Implantar no Easypanel); sem CI/CD.

## Pendências e dívidas conhecidas

**Bloqueiam a Fase D (dependem do cliente)**
- **Percentuais reais da maquininha por modalidade** (débito, crédito à vista,
  crédito parcelado): **não enviados**. A tabela e a tela já os aceitam; a tabela
  fica vazia até chegarem. Não inventar.

**Aberto no texto do cliente**
- **Contradição do reagendamento**: o texto oficial promete remarcação com 48h de
  antecedência mas **não diz como**. Redação proposta e **ainda não aprovada**:
  *"Remarcação. Você pode remarcar seu passeio até 48 horas antes do horário
  agendado, falando com a gente pelo WhatsApp — a remarcação não é feita pelo
  site. A nova data fica sujeita à disponibilidade. Valores já pagos não são
  devolvidos em caso de cancelamento."* O texto oficial **não está no
  repositório** (vive no site/ManyChat do cliente); entra no Termo v2.

**Do redesenho de 25/08**
- **`experiences.deposit_percent` / `deposit_fixed_cents` divergem da regra nova.**
  As colunas são por experiência; a regra fixa o sinal em **50%**. A Fase B decide
  se somem, viram default ou passam a ser ignoradas.
- **Chargeback** não tem estado na máquina de estados (seção 5). Fase E.
- **A tela do CRUD de experiências precisa mostrar cheio e com desconto.** Com o
  valor cheio cadastrado, o dono digita 349,99 achando que é o que recebe. Entra
  junto com a Fase A.

**Multi-tenancy pela metade (dívida de propósito, 23/08)**
- **Etapa 2 não feita.** `getTenantId()` devolve 1 fixo. A barreira
  `assertResolvedTenantIsCurrent()` impede divergência em silêncio.
- Critério de conclusão: poder **apagar** aquela função e
  `tests/o-barreira-multi-tenant.test.ts`.

**Verificação que continua não feita**
- **As telas do admin nunca foram renderizadas em navegador autenticado** —
  calendário, agendamentos, experiências, CRUDs, sidebar e agora **`/admin/financeiro`**.
  `/admin/*` está atrás do login e só existe o hash da senha. O build prova que
  compilam e estão roteadas; nada além disso.
- O passo 4 do wizard (mensagem de idade) nunca foi exercitado em navegador.

**Fluxo de venda (checklist de outubro, não lacuna ativa)**
- E-mail cortado do go-live; a tela `confirmed` é a única confirmação ao cliente.
- Termo sem checagem de versão vigente no servidor; o termo **não** menciona a
  idade mínima do garupa.
- `GET /api/availability` não informa quantos recursos sobram num horário.
- Sem proteção contra duplo clique em `POST /api/reservations` no servidor —
  **reavaliar antes do vídeo**, que é evento de pico.

**Integração de pagamento**
- Indicador de saúde da integração no `/admin` não construído (seção 8-B).
- Cinco divergências entre a seção 8 e o que foi medido, não resolvidas.
- `receiveInCash` não implementado (Fase D, agora com líquido e taxa).

**Dívida técnica registrada de propósito**
- Precedência duplicada entre `lib/availability.ts` e `lib/calendar.ts:getDayGrid`
  (22/08). O adiamento do lançamento abriu janela para pagá-la.

**Gerais**
- **`POST /api/admin/seed` não existe** — e agora é o conserto de uma classe
  inteira de falha, não conveniência (ver a armadilha acima).
- Sem CI/CD; deploy é clique manual.
- `npm install` de 18/08 reportou 10 vulnerabilidades (4 moderate, 6 high).
- `instrumentation.ts` compila para Edge Runtime e falha lá: **3 avisos no build**
  (`lib/payments/asaas.ts` com `node:crypto`, `lib/auth.ts` com `bcrypt`).
  Confirmado em 28/08 que continuam sendo esses três, nenhum novo.
- Sem rate limiting em `POST /api/admin/login`, `GET /api/availability`,
  `GET /api/experiences` e `POST /api/reservations` — **o vídeo de outubro torna
  isto mais relevante do que era**.
- Sessão sem revogação (iron-session, 8h).
- A âncora dos testes de lead time vence em junho de 2027.
- Cancelamento e CRUD de experiências não têm teste automatizado.
- `app/(public)/agenda/[token]` e `/admin/reservas/[id]` da seção 14 não existem.
- `mode:'string'` no schema: toda nova função que retorne `timestamptz`
  reintroduz o formato não-ISO.
- Chave SSH do VPS não configurada; acesso por senha de root.
- Branches locais já mergeadas, podem ser apagadas: `feat/tenant-slug`,
  `feat/idade-e-mapa`, `feat/admin-sidebar`, `feat/config-financeira`.
