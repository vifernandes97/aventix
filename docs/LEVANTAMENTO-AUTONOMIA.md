# Levantamento: o que o dono do tenant NÃO controla sozinho

> Levantamento de 2026-09-01. **Documento, não plano de implementação** — não
> propõe desenho de tela.
> Critério: toda informação cuja mudança hoje passa pelo dev.

## Achado que muda a pergunta

O levantamento começou para responder "o que falta ter tela". A resposta mais
importante não é sobre tela nenhuma:

**>>> A TELA QUE EXISTE É DESFEITA PELO SEED. <<<**

`seedTenant()` (`lib/seed.ts`) **reconcilia** experiências, não apenas as insere.
Preço, duração, buffer, `payment_mode`, `min_passenger_age` e `active` voltam ao
valor do template sempre que divergem:

```ts
const differs = (Object.keys(desired)).some((k) => current[k] !== desired[k]);
if (differs) await tx.update(experiences).set(desired).where(...);
```

O mesmo vale para `settings` (a armadilha das duas casas, CLAUDE.md seção 19), e
**não** vale para `payment_method_discounts`, que é insert-only de propósito.

**Exposição ativa hoje, não dívida futura:** o template tem
`paymentMode: 'full'` nas duas trilhas; produção está em `deposit`. **Rodar o
seed em produção desliga o sinal de 50% das duas trilhas**, sem erro e sem log.
O gatilho não é alguém querer mexer em experiências: é alguém rodar um seed por
qualquer outro motivo.

Consequência para este levantamento: **dar tela a alguma coisa não a torna
editável.** Enquanto o template for a casa definitiva, toda tela nova nasce com
a mesma falha silenciosa. Isso reordena a prioridade no fim do documento.

---

## Categoria (a) — hardcoded em código: exige deploy

| # | O quê | Onde | Quem consome | Como muda hoje | Frequência (palpite) | Risco |
|---|---|---|---|---|---|---|
| a1 | **Texto e versão do termo** | `lib/terms/quadriciclo-v2.ts` (`TERM_VERSION`, `TERM_TEXT`) | cliente final | arquivo novo + deploy | raríssima — 2x em 2 meses | 🔴 **VERMELHO** |
| a2 | **18 anos do condutor** | `lib/reservations.ts:597` (`cutoffDate18`) **e** `app/(public)/_components/types.ts:101` (`MIN_OPERATOR_AGE`) | cliente final (mensagem de erro) | deploy, **em dois lugares** | nunca | 🔴 **VERMELHO** |
| a3 | **Recursos do tenant** (quantos, nome, `capacity`) | `lib/templates/quadriciclo.ts:138-141` | cliente final (grade, teto de participantes) | deploy do template **ou** psql | baixa, mas acontece: comprar o 3º quadriciclo | 🟡 **AMARELO** |
| a4 | **Hold de 15 min** | `lib/reservations.ts:1053`, literal `interval '15 minutes'` | cliente final (contagem regressiva) | deploy | quase nunca — mas o cartão pode forçar | 🟡 **AMARELO** |
| a5 | **Granularidade da grade (30 min)** | `lib/availability.ts:34` (`SLOT_GRANULARITY_MINUTES`) | cliente final (quais horários existem) | deploy | quase nunca | 🟡 **AMARELO** |
| a6 | **Sinal de 50%** | `lib/experiences.ts:72` (`DEPOSIT_PERCENT`, escrita) e `lib/reservations.ts:54` (`DEFAULT_DEPOSIT_PERCENT`, leitura) | cliente final (valor cobrado) | deploy | nunca até aqui | 🟡 **AMARELO** |
| a7 | **Textos da UI pública** (títulos do wizard, as três telas de cartão, o aviso de PCI, a tela de confirmação) | `app/(public)/_components/steps.tsx`, `reserva/[id]/_components/status-view.tsx` | cliente final | deploy | média, enquanto o produto amadurece | 🟢 **VERDE** de conteúdo, ⚪ **não vale tela** |
| a8 | **Mensagens de erro das rotas públicas** | `app/api/reservations/route.ts`, `.../[id]/payment/route.ts`, `availability/route.ts` | cliente final | deploy | baixa | ⚪ **não vale tela** |
| a9 | **Teto da lista de reservas (100)** | `lib/reservation-list.ts:66` | dono | deploy | nunca | ⚪ **não vale tela** |
| a10 | **Fuso `America/Sao_Paulo`** | `lib/time.ts:16` | os dois | deploy | nunca — até o primeiro tenant fora de SP | 🔴 **VERMELHO** (plataforma, não dono) |
| a11 | **Identidade do tenant** (`SEED_TENANT_ID`, `_NAME`, `_SLUG`) | `lib/seed.ts:45-66` | cliente final (o slug é o endereço) | migration | nunca | 🔴 **VERMELHO** |
| a12 | **Parâmetros de infraestrutura** (`LOCK_NAMESPACE`, `CACHE_TTL_MS`, `SESSION_TTL_SECONDS`, `REQUEST_TIMEOUT_MS`, `MIN_AGE_MINUTES` da reconciliação, intervalos dos crons) | `lib/payments/balance-charge.ts:61`, `lib/tenant.ts:190`, `lib/auth.ts:61`, `lib/payments/asaas.ts:77`, `lib/jobs/reconcile-payments.ts:33`, `instrumentation.ts:151` | ninguém (só o sistema) | deploy | nunca | 🔴 **VERMELHO** (não é vocabulário do dono) |

### Por que a3 é pior do que parece

Recursos são a única entidade **do catálogo** sem CRUD nenhum. `lib/resources.ts`
exporta apenas `listActiveResources()` — a seção 14 do CLAUDE.md a descreve como
"lar do CRUD de recursos", e esse CRUD **não existe**. O dono não consegue:
comprar um terceiro quadriciclo, tirar um de circulação para manutenção, ou
renomear. E `capacity` é o teto de participantes, então mexer nele tem efeito de
lotação — daí o amarelo e não o verde.

### Por que a4 e a5 são amarelos e não verdes

Nenhum dos dois é livre. Hold de 2 minutos derruba a conversão do Pix; hold de 2
horas segura vaga de graça. Granularidade de 7 minutos produz uma grade que
ninguém lê. **Editável dentro de uma faixa, com valores sugeridos, nunca campo
numérico aberto.**

---

## Categoria (b) — em `settings`, sem tela nenhuma

**Nenhuma das 15 chaves tem tela.** `/admin/configuracoes` e
`/api/admin/settings` não existem — a seção 14 do CLAUDE.md promete os dois.

Para mudar qualquer uma hoje: **psql em produção** (e o valor some no próximo
seed) **ou** deploy do template (e aí não é o dono quem muda).

| # | Chave | Quem consome | Frequência (palpite) | Risco |
|---|---|---|---|---|
| b1 | `business_name` | cliente final (cabeçalho de tudo) | quase nunca | 🟢 VERDE |
| b2 | `resource_label` / `resource_label_plural` | cliente final (20 e 11 usos) | quase nunca | 🟢 VERDE |
| b3 | `operator_label` / `passenger_label` | cliente final | quase nunca | 🟢 VERDE |
| b4 | `operator_document_label` (`'CNH'`) | cliente final | quase nunca | 🟢 VERDE |
| b5 | `meeting_point` — o texto oficial, 6 parágrafos | cliente final (tela de confirmação) | **alta** — é o texto vivo do negócio | 🟢 VERDE |
| b6 | `meeting_point_map_url` | cliente final | baixa | 🟢 VERDE, **com validação** |
| b7 | `what_to_bring` | cliente final | baixa | 🟢 VERDE |
| b8 | `reply_to_email` | cliente final | quase nunca | 🟢 VERDE |
| b9 | `support_whatsapp` | cliente final | **está VAZIA hoje** — o número nunca foi informado | 🟢 VERDE |
| b10 | `operator_document_required` | os dois (some o campo no wizard; valida no servidor) | quase nunca | 🟡 AMARELO |
| b11 | `min_lead_minutes` | cliente final (quais horários aparecem) | média — muda com a operação | 🟡 AMARELO |
| b12 | `single_experience_per_slot` | cliente final (disponibilidade) | quase nunca | 🟡 AMARELO |
| b13 | `deposit_policy_text` | **ninguém** | — | ⚪ órfã |

### As três amarelas, e por quê

- **b10 `operator_document_required`** — desligar significa **parar de coletar
  documento**. É decisão operacional legítima do dono (outro tenant pode não
  exigir), mas com consequência no dia do passeio. Editável **com aviso**, não em
  silêncio.
- **b11 `min_lead_minutes`** — `"0"` significa aceitar reserva até a hora da
  saída. É válido e é uma escolha, mas o dono precisa entender que está abrindo
  mão do tempo de preparo. Faixa, com o significado do zero escrito na tela.
- **b12 `single_experience_per_slot`** — desligar dobra a capacidade aparente da
  agenda de um jeito que o dono não pediu. O efeito não é óbvio a partir do nome.
  Amarelo por **legibilidade**, não por risco jurídico.

### b5 merece nota própria

`meeting_point` é o item de maior frequência de mudança do levantamento inteiro:
é o texto que o cliente publica (check-in, documento, regras, acidentes,
remarcação). **Hoje mudar uma vírgula ali exige o dev.** O template diz "qualquer
alteração aqui passa pelo cliente" — e o cliente **é** o dono. A frase protege
contra o *dev* reescrever, não contra o dono.

Ressalva de implementação: as quebras de linha são conteúdo (`whitespace-pre-line`),
então o campo precisa ser textarea que as preserve, e não input de linha única.

---

## Categoria (c) — tabela própria com tela: o padrão que funciona

| O quê | Tela | Rotas | Observação |
|---|---|---|---|
| Experiências | `/admin/experiencias` | `GET/POST`, `PATCH /{id}` | **desfeita pelo seed** (ver o achado) |
| Grade semanal | `/admin/horarios` | `GET/POST`, `PUT/DELETE /{id}` | recusa faixas sobrepostas (409) |
| Exceções de agenda | `/admin/excecoes` | idem | 409 em data duplicada |
| Bloqueios | `/admin/bloqueios` | idem | horário local, sem fuso |
| Config. financeira | `/admin/financeiro` | `GET`, `PUT discounts/{method}`, `POST/PUT/DELETE card-machine-rates` | **insert-only no seed: sobrevive** |
| Reservas (leitura, cancelamento, cobrança de saldo, maquininha) | `/admin`, `/admin/agendamentos` | várias | não é configuração |

**O que esse padrão acerta, e vale copiar:** tabela própria (fora de `settings`),
validação no servidor com 422 para corpo inválido e 409 para conflito de estado,
sem DELETE onde há referência (experiências desativam, não apagam), e a tela
dizendo em voz alta o que a ação **não** faz (apagar grade não cancela reserva).

### Prometido na seção 14 e inexistente

Seis telas e cinco rotas que o CLAUDE.md descreve como se existissem:

- `/admin/clientes` e `GET /api/admin/customers` — o dono **não tem** lista de clientes nem histórico.
- `/admin/recursos` — sem CRUD de recursos (ver a3).
- `/admin/configuracoes` — a categoria (b) inteira depende dela.
- `/admin/compartilhar` — e a tabela `shared_calendar_links` **não tem um único
  consumidor fora do schema**. A agenda compartilhada por link secreto, item do
  MVP, não foi construída: nem a tabela é escrita, nem `app/(public)/agenda/[token]` existe.
- `/admin/integracao` — indicador de saúde do webhook (seção 8-B).
- `/admin/reservas/[id]` — detalhe como página; o painel sobreposto cobre o uso diário.

**Isto é divergência de documentação, não só ausência de feature.** A seção 14 é
lida como inventário.

---

## Idade e CNH: as três coisas são diferentes

| Regra | Natureza | Onde | Editável? |
|---|---|---|---|
| **Idade mínima do garupa** | 🛡️ **SEGURANÇA** — operação do dono | coluna `experiences.min_passenger_age` + CRUD (`idadeMinimaGarupa`, 0..120) | ✅ **JÁ É**, desde 24/08. Amarelo bem resolvido: faixa no CHECK do banco e no validador |
| **18 anos do condutor** | ⚖️ **HABILITAÇÃO LEGAL** | `cutoffDate18` + `MIN_OPERATOR_AGE` | 🔴 **NÃO** |
| **Exigir documento** (`operator_document_required`) | 🛡️ **OPERAÇÃO** | setting | 🟡 sim, com aviso |
| **Rótulo do documento** (`'CNH'`) | 🏷️ **RÓTULO** | setting | 🟢 sim |

### Por que os 18 anos são vermelhos

**Não é escolha comercial do Quadri Club.** É a idade em que a lei permite
habilitação, e o quadriciclo é conduzido por quem tem CNH — o próprio texto
oficial do cliente diz "CNH para pilotar (apresentar no dia)".

Oferecer um campo editável aqui é **oferecer ao dono a chance de criar exposição
jurídica para ele mesmo**, e num produto vendido por assinatura essa exposição
não fica só com ele. Um campo que aceita 16 num sábado movimentado não é
flexibilidade: é o sistema convidando para um problema que o dono só descobre
depois do acidente.

**A distinção operacional que sustenta isso:** a idade do garupa varia porque o
tenant decide quem ele leva como passageiro (6 na Fazenda, 12 na Montanha, e
outro tenant escolheria outros números). A idade do condutor não varia porque
não é o tenant quem decide.

### `operator_document_required` é sobre EXIGIR, não sobre HABILITAR

E as duas checagens são **independentes no código** — vale dizer porque a
suposição contrária é natural:

```
lib/reservations.ts:854   if (await getBooleanSetting('operator_document_required'))  → exige documento
lib/reservations.ts:687   const cutoff18 = cutoffDate18(todayLocalDate())             → exige 18 anos
```

**Desligar a coleta de documento NÃO afrouxa a idade.** Um tenant que não peça
documento continua recusando condutor de 17 anos. Está certo assim, e quem for
mexer não deve "simplificar" juntando as duas.

### A armadilha que já está documentada e continua valendo

As duas regras de idade usam **bases de data diferentes de propósito** (CLAUDE.md
seção 4.6): o condutor precisa de 18 na **data do agendamento**; o garupa precisa
da idade mínima na **data do passeio**. Ler lado a lado sugere descuido. **Não
alinhe.**

---

## Settings que ninguém renderiza

Uma só: **`deposit_policy_text`**. Existe no tipo, no template e no banco, com
valor marcado `PROVISORIO`, e `grep` não a encontra em componente nenhum.

Já está decidido (31/08): fica como **ponto de extensão não implementado**, e a
política que **vincula** o cliente mora no corpo do termo. **Este levantamento
não reabre isso** — registra que ela é a única órfã, e que quem for construir a
tela de configurações precisa decidir se a mostra (e a resposta provavelmente é
não, porque tela que expõe campo sem efeito ensina o dono a desconfiar da tela).

---

## Duplicações

| # | O que está duplicado | Onde | Consequência se divergirem |
|---|---|---|---|
| d1 | **O número 18** | `MIN_OPERATOR_AGE` (front) e `cutoffDate18` (servidor) | front e servidor discordarem sobre quem pode dirigir. Contraste: a idade do **garupa** tem fonte única (a experiência), lida pelos dois lados |
| d2 | **O número 50** | `DEPOSIT_PERCENT` (`experiences.ts`, escrita) e `DEFAULT_DEPOSIT_PERCENT` (`reservations.ts`, fallback de leitura) | a escrita gravar 50 e a leitura assumir outro valor. Hoje concordam por coincidência de digitação |
| d3 | **Todas as settings** | template ↔ banco | o seed sobrescreve o banco. **Por desenho** (seção 19), mas é a duplicação que mais custou a este projeto |
| d4 | **Todas as experiências** | template ↔ banco ↔ CRUD | **três** casas para o mesmo dado, e o seed vence as outras duas. É o achado do topo |
| d5 | **Precedência de grade** | `lib/availability.ts` e `lib/calendar.ts:getDayGrid` | já registrado como dívida; a venda e o calendário discordarem sobre que dia está aberto |

`SEED_PIX_DISCOUNT_BASIS_POINTS` **não** é duplicação: é semente, e a inserção é
insert-only justamente para não virar uma.

---

## Universal vs. por tenant

**Universal (é do produto Aventix, não do cliente):** os 18 anos do condutor, o
termo como mecanismo versionado, o modelo de dados, as regras de idempotência e
de webhook, o sinal de 50% (decisão de produto da rev 7), a granularidade da
grade, os parâmetros de infraestrutura.

**Por tenant, e já é:** experiências, grade, exceções, bloqueios, descontos por
método, taxas de maquininha, idade do garupa, e todas as 15 settings.

**Por tenant, e ainda NÃO é — a lista que importa:** recursos e sua capacidade,
o **texto** do termo (o mecanismo é universal, o conteúdo é do segmento — hoje
`quadriciclo-v2.ts` mistura os dois), o fuso, e o hold.

**Ponto que o segundo cliente vai expor:** o termo é por **segmento**, não por
tenant. Dois tenants de quadriciclo compartilham o texto; um tenant de bote
precisa de arquivo próprio. Hoje o nome do arquivo diz "quadriciclo" e nada no
código liga tenant a termo — a escolha é um import fixo no wizard. **Isso não é
problema hoje e é bloqueio no dia do segundo segmento.**

---

## O que eu faria primeiro, e por quê

Ordenado por **autonomia ganha ÷ esforço**, com a exposição ativa na frente.

### 1. Parar o seed de sobrescrever o que o dono edita — antes de qualquer tela

**Não é tela, é a precondição de todas elas.** Hoje `/admin/experiencias` já
permite editar preço e sinal, e o seed desfaz. Construir a tela de configurações
sem resolver isto multiplica a falha em vez de resolvê-la.

O padrão certo **já existe no repositório**: `payment_method_discounts` é
insert-only, e o comentário em `lib/seed.ts:80-88` explica exatamente por quê.
A correção é aplicar esse mesmo critério a experiências e settings — semear o
valor inicial, nunca reconciliar.

Isso exige uma decisão que **não é minha**: hoje o template é a "casa
definitiva", e essa regra existe por um motivo real (a seção 19 nasceu de valores
que sumiam). Trocá-la significa aceitar que **o banco passa a ser a verdade** e o
template vira só semente. É a decisão certa para um produto multi-tenant, e
precisa ser tomada explicitamente, não por efeito colateral.

**Esforço: baixo.** **Autonomia ganha: nenhuma diretamente — e sem ela toda a
autonomia seguinte é falsa.**

### 2. `/admin/configuracoes` — as nove settings verdes

Nove chaves, um formulário, zero regra de negócio nova. Cobre `business_name`,
os quatro rótulos, `meeting_point` (o texto de maior frequência de mudança do
levantamento), `meeting_point_map_url`, `what_to_bring`, `reply_to_email` e
`support_whatsapp` — que **está vazia e precisa do número do cliente**.

**Esforço: baixo** (uma rota de upsert, o padrão de `discounts/{method}` já
resolvido). **Autonomia ganha: a maior de todas** — é o texto que o cliente final
lê, e é o que hoje mais me chama.

Deixar as três amarelas (b10, b11, b12) **para uma segunda leva**, com aviso
explicando o efeito. Misturar as duas levas faz a tela nascer perigosa.

### 3. CRUD de recursos

O dono não consegue comprar um terceiro quadriciclo nem tirar um para
manutenção. É a última entidade do catálogo sem tela, e o padrão a seguir já está
estabelecido em quatro CRUDs. **Sem DELETE** — `reservation_resources` referencia
recursos, então desativar, como as experiências.

**Esforço: baixo-médio.** **Autonomia ganha: alta**, e é a única da lista que
destrava crescimento físico do negócio.

### 4. `/admin/clientes` e o indicador de saúde da integração

Os dois são **leitura**, sem risco de o dono quebrar nada, e os dois são
prometidos na seção 14. O de clientes é o que o dono pede primeiro quando começa
a operar de verdade; o de saúde é o que evita descobrir a fila de webhook parada
pela reclamação do cliente — e o vídeo de outubro torna isso mais provável.

**Esforço: médio.** **Autonomia ganha: média** (é visibilidade, não edição).

### 5. Reconciliar o CLAUDE.md seção 14 com a realidade

Seis telas e cinco rotas descritas como se existissem. **A seção é lida como
inventário**, e este levantamento existe em parte porque ela mente. Não é
trabalho de produto: é meia hora que impede o próximo levantamento.

### O que eu NÃO faria

- **Tela para o termo.** Decidido, e o argumento continua de pé.
- **Tela para os 18 anos.** Ver a seção de idade.
- **Tela para textos da UI e mensagens de erro** (a7, a8). São produto, não
  conteúdo do tenant. Externalizá-los cria uma camada de tradução que ninguém
  mantém, e o ganho é o dono poder mudar palavras que ele não pediu para mudar.
- **Tela para hold e granularidade** (a4, a5) **agora.** São amarelos legítimos,
  mas ninguém pediu e o dado que justificaria a faixa (quanto tempo a análise de
  risco do cartão demora) chega em outubro.
- **Editor de `deposit_policy_text`.** Campo sem efeito ensina a desconfiar da tela.
