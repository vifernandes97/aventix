// Aventix — schema de dados (CLAUDE.md secao 4).
// Modelagem generica multi-tenant-ready; tenant fixo 1 no MVP.
//
// NOTA sobre a trava anti-overbooking (secao 4.4 / 4.6):
// A exclusion constraint `EXCLUDE USING gist (resource_id WITH =, period WITH &&)`
// em `reservation_resources` e a extensao `btree_gist` NAO sao representaveis no
// DSL do Drizzle (0.45) nem geradas pelo drizzle-kit. Elas sao adicionadas via SQL
// customizado na migration (CREATE EXTENSION + ALTER TABLE ADD CONSTRAINT). Ver a
// migration gerada em /drizzle. Isso e esperado pelo CLAUDE.md ("adicione via SQL
// customizado na migration").

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  index,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// -- tstzrange: Postgres nao tem tipo nativo no Drizzle. period = [start, start+dur+buffer).
const tstzrange = customType<{ data: string }>({
  dataType() {
    return 'tstzrange';
  },
});

// helper: timestamptz (UTC no banco; conversao so nas bordas — secao 3).
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

// -- 4.1 enums --------------------------------------------------------------

export const reservationStatus = pgEnum('reservation_status', [
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
]);

export const paymentMethod = pgEnum('payment_method', ['pix', 'card']); // 'card' reservado pos go-live

export const participantRole = pgEnum('participant_role', ['operator', 'passenger']); // UI: Condutor / Garupa

export const priceMode = pgEnum('price_mode', ['per_resource']); // 'per_person' NAO implementar

// rev 6 — pagamento com sinal (secao 4.1)

// Como a experiencia e vendida: 100% no ato, ou sinal agora + saldo no dia.
export const paymentMode = pgEnum('payment_mode', ['full', 'deposit']);

// Papel de cada cobranca dentro da reserva.
// full = pagamento unico | deposit = sinal | balance = saldo cobrado no dia.
export const paymentKind = pgEnum('payment_kind', ['full', 'deposit', 'balance']);

// Estado de UMA cobranca (reservation_payments.state).
export const paymentState = pgEnum('payment_state', ['pending', 'paid', 'cancelled', 'refunded']);

// Estado financeiro AGREGADO da reserva (derivado de reservation_payments —
// nunca escrito na mao; so via recalcReservationPayment, secao 4.6).
export const reservationPaymentState = pgEnum('reservation_payment_state', [
  'pending',
  'partial',
  'settled',
]);

// rev 7 — configuracao financeira do tenant (secao 4-B.6)

// Modalidade da maquininha. A taxa da adquirente MUDA com a modalidade, e por
// isso ela e chave de tabela e nao um campo unico: um percentual so produziria
// numero errado com APARENCIA de certo, que e pior que numero obviamente errado.
//
// 'credit_installment' e uma modalidade SO, e nao uma por numero de parcelas.
// E simplificacao consciente: a adquirente costuma cobrar taxa crescente por
// parcela. A secao 4-B.6 lista tres modalidades, e e o que esta modelado — se a
// Fase D precisar da granularidade por parcela, e migration com coluna nova, nao
// reinterpretacao silenciosa desta.
export const cardMachineModality = pgEnum('card_machine_modality', [
  'debit',
  'credit',
  'credit_installment',
]);

// -- 4.2 tenant e configuracao ---------------------------------------------

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(), // "Quadri Club"
  // Segmento da URL publica: /agendamento/{slug} (secao 2-B).
  //
  // UNIQUE porque e ENDERECO, nao rotulo: dois tenants com o mesmo slug fazem a
  // LP de um servir o outro, e o banco e o unico lugar que consegue garantir
  // isso sob concorrencia. NOT NULL porque tenant sem slug e tenant sem LP —
  // um estado que nao existe no produto.
  //
  // >>> A URL JA RESOLVE POR SLUG; getTenantId() AINDA NAO. <<<
  // Ver o comentario de Etapa 2 em lib/tenant.ts e a barreira em
  // tests/o-barreira-multi-tenant.test.ts antes de inserir um segundo tenant.
  slug: text('slug').notNull().unique(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// Key-value por tenant. tenant_id faz parte da PK (sem default no SQL da secao 4.2).
export const settings = pgTable(
  'settings',
  {
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// -- 4-B.6 configuracao financeira do tenant --------------------------------
//
// >>> POR QUE ISTO NAO MORA EM `settings` <<<
// seedTenant() SOBRESCREVE toda linha de settings cujo valor divirja do template
// (lib/seed.ts). O dono configuraria 7% de desconto no Pix, funcionaria por
// semanas, e o valor SUMIRIA no dia em que alguem rodasse o seed — sem erro e
// sem log, com o preco voltando sozinho ao do template. Tabela propria fica
// fora do alcance dessa reconciliacao (secao 4-B.6 e secao 19).
//
// A separacao tambem distingue o que a NEOSOLUTI define do que o DONO edita,
// hoje misturados em settings.
//
// >>> PERCENTUAL E BASIS POINT INTEIRO, NUNCA numeric NEM float <<<
// 7% = 700. 1 bp = 0,01%, que cobre taxa de adquirente do tipo 3,49% (349).
//
// `numeric` seria exato no banco, mas o node-postgres o entrega como STRING
// (para nao perder precisao), e a partir dai cada consumidor decide sozinho como
// transformar aquilo em conta. O primeiro que escrever `Number(taxa) * cents /
// 100` reintroduz exatamente o ponto flutuante binario que lib/payments/money.ts
// existe para impedir — e reintroduz de forma invisivel, porque o erro nao
// aparece no numero, aparece na serializacao (um centavo de diferenca entre o
// que o banco diz e o que o cliente paga).
//
// Com basis point a conta inteira fica em INTEIROS: Math.round(cents * bp /
// 10000). Para a maior venda plausivel, 34999 * 700 = 24.499.300 — folgado
// dentro do inteiro seguro do JS. Deterministico em qualquer maquina, hoje e em
// dois anos.
//
// CUSTO ASSUMIDO: um SELECT cru mostra `700`, que da para ler como 700%. A
// defesa e o nome da coluna, o CHECK de faixa e a tela, que sempre exibe
// percentual.
//
// A aritmetica pura vive em lib/basis-points.ts (modulo PURO, sem banco).

/**
 * Desconto por METODO de pagamento — afeta o PRECO QUE O CLIENTE PAGA.
 *
 * >>> NAO EXISTE TAXA SOMADA AO CLIENTE (secao 4-B.1) <<<
 * O cartao NAO fica mais caro; o Pix fica mais barato. A diferenca em reais e a
 * mesma, mas a leitura na tela nao e: acrescimo no cartao e percebido como
 * punicao, derruba conversao e esbarra na expectativa de que o preco anunciado e
 * o preco a pagar. Quem consumir esta tabela NUNCA calcula "cheio + taxa".
 *
 * AUSENCIA DE LINHA = 0% DE DESCONTO, e isso e deliberado: e o unico default
 * seguro. Configuracao faltando faz o cliente pagar o valor CHEIO — nunca um
 * desconto maior do que o dono autorizou. Ver getDiscountBasisPoints().
 */
export const paymentMethodDiscounts = pgTable(
  'payment_method_discounts',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    method: paymentMethod('method').notNull(),
    discountBasisPoints: integer('discount_basis_points').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    // Primeira coluna `updated_at` do schema, e ha motivo: e o primeiro VALOR
    // editado no lugar do qual decisao de dinheiro depende. A secao 4-B.7 gira
    // em torno de "a taxa muda com o tempo, o registro nao" — saber QUANDO a
    // configuracao mudou e o que permite conferir um registro antigo contra o
    // extrato sem adivinhar qual percentual valia naquele dia. Escrita
    // explicitamente na lib; nao ha trigger no banco (nenhuma tabela tem).
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // Chave natural. E o que torna "duplicar o desconto do Pix" impossivel por
    // construcao, e nao por disciplina de quem escreve a rota.
    unique('payment_method_discounts_tenant_method_key').on(t.tenantId, t.method),
    // Teto EXCLUSIVO em 10000: 100% de desconto zera o preco, e experiencia
    // gratuita nao e suportada no MVP (secao 4.6) — com total zero a cobranca
    // violaria `CHECK (amount_cents > 0)` e a venda cairia com 500.
    check(
      'payment_method_discounts_range_check',
      sql`${t.discountBasisPoints} >= 0 AND ${t.discountBasisPoints} < 10000`,
    ),
  ],
);

/**
 * Taxa da maquininha por modalidade — afeta QUANTO O TENANT RECEBE.
 * INVISIVEL ao cliente: nao entra em preco, so em valor liquido (secao 4-B.7).
 *
 * >>> AUSENCIA DE LINHA SIGNIFICA "NAO CONFIGURADO", NUNCA "0%" <<<
 * Esta e a diferenca que separa esta tabela da de descontos, e ela e a razao de
 * as duas terem APIs de forma diferente. Desconto ausente e benigno (o cliente
 * paga o cheio). Taxa ausente e DESCONHECIDA — e registrar um recebimento com
 * taxa chutada produz um liquido com aparencia de certo, que so seria desmentido
 * na conferencia com o extrato, semanas depois. Por isso a Fase D deve RECUSAR o
 * registro quando a modalidade nao tiver linha, em vez de assumir zero.
 *
 * Os percentuais reais do Quadri Club NAO chegaram e a tabela nasce VAZIA de
 * proposito — o seed nao a semeia. Ver lib/seed.ts.
 *
 * ESTA TABELA E CONFIGURACAO, NAO REGISTRO. Ela diz o que vale para o PROXIMO
 * recebimento. O valor bruto, a modalidade, o percentual aplicado e o liquido
 * sao CONGELADOS na linha do pagamento no instante do registro (secao 4-B.7), e
 * depois disso o sistema so LE. Editar uma taxa aqui nunca reescreve o passado —
 * se reescrevesse, a reserva de setembro passaria a mostrar outro liquido em
 * novembro, e a conferencia com o extrato quebraria sem nada acusar erro.
 */
export const cardMachineRates = pgTable(
  'card_machine_rates',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    modality: cardMachineModality('modality').notNull(),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('card_machine_rates_tenant_modality_key').on(t.tenantId, t.modality),
    // Teto INCLUSIVO em 10000 (100%), diferente do desconto: taxa de 100% e
    // comercialmente absurda mas nao quebra nada (liquido zero), enquanto
    // desconto de 100% quebra a venda. O teto existe para barrar digito extra
    // ('349' virando '3490'), nao para julgar o contrato da adquirente.
    check(
      'card_machine_rates_range_check',
      sql`${t.rateBasisPoints} >= 0 AND ${t.rateBasisPoints} <= 10000`,
    ),
  ],
);

// -- 4.3 catalogo -----------------------------------------------------------

export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(), // "Quad 1"
    capacity: integer('capacity').notNull().default(2), // pessoas por recurso
    active: boolean('active').notNull().default(true),
  },
  (t) => [check('resources_capacity_check', sql`${t.capacity} >= 1`)],
);

export const experiences = pgTable(
  'experiences',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull().default(15),
    priceMode: priceMode('price_mode').notNull().default('per_resource'),
    priceCents: integer('price_cents').notNull(), // por recurso

    // rev 6: modo de pagamento por experiencia (secao 4.3).
    // Valor do sinal e SEMPRE calculado no servidor (secao 4.6):
    // deposit = round(total * deposit_percent/100) ou deposit_fixed_cents.
    paymentMode: paymentMode('payment_mode').notNull().default('full'),
    depositPercent: integer('deposit_percent'), // usado se payment_mode='deposit'
    depositFixedCents: integer('deposit_fixed_cents'), // alternativa ao percentual

    // Idade minima do GARUPA, em anos completos NA DATA DO PASSEIO.
    //
    // >>> POR EXPERIENCIA, NUNCA CONSTANTE DE CODIGO <<<
    // O cliente publicou 6 anos na Trilha da Fazenda e 12 na Trilha da Montanha:
    // a regra e do passeio, nao do tenant. Uma constante faria a proxima trilha
    // herdar o numero da anterior — errado e silencioso.
    //
    // NOT NULL DEFAULT 0, e `0` significa SEM IDADE MINIMA. Contraste com
    // emergency_contact_* (migration 0002), que nasceu nullable porque nao havia
    // valor retroativo possivel; aqui ha default com significado, entao a coluna
    // nunca precisa admitir null e nenhum consumidor precisa tratar ausencia.
    // A protecao contra "esqueci de configurar" mora no CRUD, que expoe o campo.
    minPassengerAge: integer('min_passenger_age').notNull().default(0),

    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check('experiences_duration_check', sql`${t.durationMinutes} > 0`),
    check('experiences_buffer_check', sql`${t.bufferMinutes} >= 0`),
    check('experiences_price_check', sql`${t.priceCents} >= 0`),
    // Teto de 120 barra digito extra ('60' virando '600') no CRUD, que criaria
    // uma experiencia que ninguem consegue comprar.
    check('experiences_min_passenger_age_check', sql`${t.minPassengerAge} BETWEEN 0 AND 120`),
    check('experiences_deposit_percent_check', sql`${t.depositPercent} BETWEEN 1 AND 99`),
    check('experiences_deposit_fixed_check', sql`${t.depositFixedCents} > 0`),
    // modo 'deposit' exige EXATAMENTE um dos dois (percentual XOR fixo)
    check(
      'experiences_deposit_mode_check',
      sql`${t.paymentMode} = 'full' OR (${t.depositPercent} IS NOT NULL) <> (${t.depositFixedCents} IS NOT NULL)`,
    ),
  ],
);

export const operatingHours = pgTable(
  'operating_hours',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    weekday: integer('weekday').notNull(), // 0=domingo
    opens: time('opens').notNull(),
    closes: time('closes').notNull(),
  },
  (t) => [
    check('operating_hours_weekday_check', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('operating_hours_range_check', sql`${t.closes} > ${t.opens}`),
  ],
);

export const blackouts = pgTable('blackouts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .default(1)
    .references(() => tenants.id),
  resourceId: integer('resource_id').references(() => resources.id), // NULL = todos os recursos
  period: tstzrange('period').notNull(),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// Excecoes a grade recorrente para uma data especifica. Cobre liberar
// (feriado em dia de semana: closed=false + horario) e bloquear (recesso:
// closed=true) numa unica peca. Precedencia sobre operating_hours (secao 6).
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    date: date('date').notNull(),
    opens: time('opens'), // NULL se closed=true
    closes: time('closes'), // NULL se closed=true
    closed: boolean('closed').notNull().default(false),
    reason: text('reason'), // "Recesso de fim de ano", "Feriado - abre"
  },
  (t) => [
    unique('schedule_exceptions_tenant_date_unique').on(t.tenantId, t.date),
    check(
      'schedule_exceptions_closed_check',
      sql`${t.closed} = true OR (${t.opens} IS NOT NULL AND ${t.closes} IS NOT NULL AND ${t.closes} > ${t.opens})`,
    ),
  ],
);

// -- 4.4 cliente, reserva, alocacao e participantes -------------------------

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    cpf: text('cpf'),
    birthdate: date('birthdate'),

    // Id do cliente no provedor de pagamento (cus_...). NULLABLE: cliente
    // anterior a esta coluna nao tem, e cliente novo so ganha o id quando a
    // primeira cobranca dele e criada. E gravado UMA vez e reutilizado —
    // o Asaas PERMITE cadastro duplicado, entao sem guardar o id cada reserva
    // criaria um cliente novo la.
    asaasCustomerId: text('asaas_customer_id'),

    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('customers_tenant_phone_unique').on(t.tenantId, t.phone), // find-or-create por telefone
    // Parcial: muitos clientes ainda sem id no provedor (NULL nao colide), mas
    // um mesmo cus_... nunca pode se vincular a dois clientes do Aventix.
    uniqueIndex('idx_customers_asaas')
      .on(t.asaasCustomerId)
      .where(sql`${t.asaasCustomerId} IS NOT NULL`),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: integer('tenant_id')
      .notNull()
      .default(1)
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    experienceId: integer('experience_id')
      .notNull()
      .references(() => experiences.id),

    resourcesNeeded: integer('resources_needed').notNull(), // escolha do cliente; teto validado no app
    // O que o cliente PAGA: total cheio menos o desconto do metodo (secao 4-B.1).
    // Calculado no servidor, congelado aqui (secao 4.6).
    totalPriceCents: integer('total_price_cents').notNull(),
    startAt: tstz('start_at').notNull(),

    // rev 7 / Fase A: como o preco vendido foi FORMADO (secao 4-B.1 e 4-B.7).
    //
    // >>> SEM ESTES DOIS, UMA RESERVA ANTIGA VIRA DADO INEXPLICAVEL <<<
    // O dono muda o desconto de 7% para 5% em novembro. A reserva de setembro
    // tem total 32549, que nao bate com o preco cheio (34999) nem com o
    // preco-Pix-de-hoje (33249). Ninguem consegue reconstruir de onde saiu
    // aquele numero, e a conferencia com o extrato trava numa reserva por vez.
    //
    // Com os dois, a linha se explica sozinha, sem depender do catalogo nem da
    // configuracao ATUAL, que e exatamente a propriedade que a secao 4-B.7
    // exige de todo registro de dinheiro:
    //     full_price_cents - round(full_price_cents * discount_bp / 10000)
    //       = total_price_cents
    //
    // POR QUE AQUI E NAO EM reservation_payments, apesar de a 4-B.7 falar em
    // "linha do pagamento": la o assunto e LIQUIDO RECEBIDO (bruto, modalidade,
    // taxa da adquirente) — o caso da maquininha, Fase D. Isto aqui e o PRECO
    // VENDIDO, que e atributo da venda. E, decisivo: no modo 'deposit' (Fase B)
    // a mesma venda tera DUAS linhas de pagamento, e guardar o percentual em
    // cada uma cria a chance de discordarem sobre um numero que e um so.
    //
    // NULLABLE pelo mesmo motivo de emergency_contact_* (migration 0002):
    // reserva anterior a esta funcionalidade nao tem o dado e NAO HA COMO
    // RETROAGIR — o desconto vigente na epoca nao foi registrado em lugar
    // nenhum. A migration 0007 NAO faz backfill de proposito: inventar 700 para
    // o passado seria fabricar um fato. Obrigatorios para reserva NOVA na
    // aplicacao (createReservation), nunca no banco.
    //
    // full_price_cents e o TOTAL cheio (preco por recurso x recursos), nao o
    // unitario: e sobre o total que o desconto incide (secao 4-B.2).
    fullPriceCents: integer('full_price_cents'),
    discountBasisPoints: integer('discount_basis_points'),

    // SNAPSHOT de como foi vendido, junto com total_price_cents e payment_mode:
    // os tres congelam na venda e NUNCA acompanham edicao do catalogo.
    //
    // POR QUE EXISTEM: sem eles, o calendario e o painel liam duracao e buffer do
    // JOIN com experiences, ou seja, do valor ATUAL. Editar a duracao de uma
    // trilha redesenhava retroativamente o tamanho dos blocos de reservas ja
    // vendidas — bloco de 09:00-13:00 sobre uma vaga que na verdade libera 10:45.
    // A vaga em si (reservation_resources.period) sempre foi congelada, entao o
    // defeito nunca produziu overbooking: produzia tela mentindo, nas duas
    // direcoes (dono recusando cliente num horario livre, ou grade oferecendo um
    // vao que o POST recusa com 409).
    //
    // Quem le duracao da EXPERIENCIA continua certo em availability.ts e no
    // calculo do period em createReservation: reserva NOVA usa a duracao vigente.
    durationMinutes: integer('duration_minutes').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull(),

    channel: text('channel'), // origem da venda: NULL = direto; ex. 'aventurando'

    // Contato de emergencia, capturado no passo 5 do formulario publico
    // (junto ao termo). Nullable de proposito: reserva anterior a esta
    // funcionalidade nao tem o dado e nao ha como retroagir (mesma licao da
    // migration 0001 sobre NOT NULL em tabela ja povoada). A obrigatoriedade
    // para reserva NOVA vive na camada de aplicacao (rota + createReservation),
    // nao aqui.
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),

    // rev 6: estado financeiro AGREGADO. As cobrancas em si vivem em
    // reservation_payments; estes dois campos sao DERIVADOS e so podem ser
    // escritos por recalcReservationPayment, na mesma transacao (secao 4.6).
    paymentMode: paymentMode('payment_mode').notNull(), // snapshot de como foi vendido; sem default
    amountPaidCents: integer('amount_paid_cents').notNull().default(0),
    paymentState: reservationPaymentState('payment_state').notNull().default('pending'),

    termoVersion: text('termo_version').notNull(),
    termoAcceptedAt: tstz('termo_accepted_at').notNull(),
    termoAcceptedIp: text('termo_accepted_ip'),
    termoAcceptedUserAgent: text('termo_accepted_user_agent'),

    status: reservationStatus('status').notNull().default('pending_payment'),
    holdExpiresAt: tstz('hold_expires_at'),

    createdAt: tstz('created_at').notNull().defaultNow(),
    confirmedAt: tstz('confirmed_at'),
    cancelledAt: tstz('cancelled_at'),
  },
  (t) => [
    check('reservations_resources_needed_check', sql`${t.resourcesNeeded} >= 1`),
    // Espelham os CHECKs de experiences: o snapshot nao pode ser menos rigoroso
    // que a origem de onde ele foi copiado.
    check('reservations_duration_minutes_check', sql`${t.durationMinutes} > 0`),
    check('reservations_buffer_minutes_check', sql`${t.bufferMinutes} >= 0`),
    index('idx_reservations_status_hold').on(t.status, t.holdExpiresAt),
    index('idx_reservations_start').on(t.tenantId, t.startAt),
    index('idx_reservations_customer').on(t.customerId),
  ],
);

// A trava anti-overbooking vive AQUI (exclusion constraint adicionada via SQL na migration).
// period = [start_at, start_at + duration + buffer). status ESPELHA reservations.status.
export const reservationResources = pgTable('reservation_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  resourceId: integer('resource_id')
    .notNull()
    .references(() => resources.id),
  period: tstzrange('period').notNull(),
  status: reservationStatus('status').notNull(),
});

export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id')
    .notNull()
    .references(() => reservations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  birthdate: date('birthdate'),
  role: participantRole('role').notNull(), // operator | passenger
  documentNumber: text('document_number'), // exigido p/ operator conforme settings (validacao no servidor)
});

// -- 4.5 pagamentos da reserva (rev 6) --------------------------------------
//
// Uma reserva tem 1 pagamento (modo 'full') ou 2 (modo 'deposit': sinal + saldo).
// O 'balance' tem ciclo proprio e NUNCA afeta reservations.status (secao 5.3):
// a reserva confirma com o sinal pago; saldo em aberto nao bloqueia nem libera vaga.
export const reservationPayments = pgTable(
  'reservation_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    kind: paymentKind('kind').notNull(), // full | deposit | balance
    amountCents: integer('amount_cents').notNull(), // calculado no servidor (secao 4.6)
    method: paymentMethod('method').notNull().default('pix'),
    state: paymentState('state').notNull().default('pending'),

    asaasPaymentId: text('asaas_payment_id'), // id da cobranca no Asaas (pay_...)
    // Link da fatura no provedor, persistido na CRIACAO da cobranca (secao 7.1:
    // a tela de clientes linka para ela sem chamar o Asaas ao vivo).
    asaasInvoiceUrl: text('asaas_invoice_url'),
    // "{reservation_id}:{kind}" — unico e deterministico. E o que permite
    // reconciliar mesmo se o asaas_payment_id se perder (secao 4.6 / 8-B).
    externalReference: text('external_reference').notNull(),
    dueDate: date('due_date').notNull(),
    paidAt: tstz('paid_at'),
    receivedInCash: boolean('received_in_cash').notNull().default(false), // maquininha/dinheiro

    // -- REGISTRO DA MAQUININHA (Fase D, migration 0008) -------------------
    //
    // >>> CONGELADOS NO REGISTRO. O SISTEMA SO LE, NUNCA RECALCULA. <<<
    // Regra da secao 4-B.7, e ela e a razao de estas colunas existirem em vez
    // de o liquido ser derivado de card_machine_rates na hora de exibir. Taxa
    // muda com o tempo; registro de dinheiro NAO pode mudar junto. Em setembro
    // registra R$ 150 a 5% e mostra R$ 142,50; em novembro a operadora reajusta
    // para 6%, o dono atualiza a tela, e a reserva de SETEMBRO passaria a
    // mostrar R$ 141,00 — o passado mudando sozinho, e a conferencia com o
    // extrato quebrando sem nada acusar erro.
    //
    // TODAS NULAVEIS, SEM BACKFILL: pagamento anterior a esta funcionalidade
    // nao tem o dado, e inventa-lo seria fabricar um fato. Mesma regra que
    // guiou emergency_contact_* (0002) e full_price_cents (0007).
    //
    // So se aplica ao que NAO passa pelo provedor. Para o que passa, o liquido
    // e LIDO do Asaas (secao 4-B.7), nunca calculado.
    cardMachineModality: cardMachineModality('card_machine_modality'),
    // Percentual EFETIVAMENTE aplicado, em basis points (secao 4-B.6).
    // Copia do valor vigente no instante do registro, nao referencia a
    // card_machine_rates — uma FK reintroduziria o passado mutavel.
    rateBasisPointsApplied: integer('rate_basis_points_applied'),
    // >>> NULL = "NAO SEI", JAMAIS 0. <<< 0 significaria "nao teve taxa", e
    // essa mentira faria o liquido parecer igual ao bruto. NULL acontece
    // quando a modalidade nao tinha taxa configurada no momento do registro
    // (decisao de 31/08, que reverte a de 28/08 — ver docs/DECISOES.md).
    netCents: integer('net_cents'),

    // -- RASTRO (Fase D) ----------------------------------------------------
    // Esta e a UNICA operacao do sistema em que alguem declara ter recebido
    // dinheiro SEM prova externa: nao ha webhook, nao ha confirmacao de
    // terceiro. Sem rastro, uma divergencia de dinheiro entre o dev e o cliente
    // nao tem como ser reconstituida.
    // Distinto de paid_at, que e QUANDO o dinheiro entrou; isto e quando e por
    // quem foi DECLARADO.
    registeredBy: text('registered_by'),
    registeredAt: tstz('registered_at'),

    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('reservation_payments_amount_check', sql`${t.amountCents} > 0`),
    // Coerencia do registro manual: liquido so existe se houve percentual
    // aplicado, e percentual so existe se houve modalidade. O caminho
    // "modalidade sem taxa configurada" e VALIDO e para nos dois nulos, que e
    // exatamente o "nao sei" que a coluna precisa poder expressar.
    check(
      'reservation_payments_card_machine_check',
      sql`(${t.rateBasisPointsApplied} IS NULL) = (${t.netCents} IS NULL)
          AND (${t.rateBasisPointsApplied} IS NULL OR ${t.cardMachineModality} IS NOT NULL)`,
    ),
    check(
      'reservation_payments_rate_applied_range_check',
      sql`${t.rateBasisPointsApplied} IS NULL
          OR (${t.rateBasisPointsApplied} >= 0 AND ${t.rateBasisPointsApplied} <= 10000)`,
    ),
    // idempotencia do webhook no banco (secao 8.2)
    uniqueIndex('idx_rp_asaas')
      .on(t.asaasPaymentId)
      .where(sql`${t.asaasPaymentId} IS NOT NULL`),
    uniqueIndex('idx_rp_extref').on(t.externalReference),
    index('idx_rp_reservation').on(t.reservationId),
    // varredura do job de reconciliacao a cada 10 min (secao 8-B)
    index('idx_rp_open')
      .on(t.state, t.dueDate)
      .where(sql`${t.state} = 'pending'`),
  ],
);

// -- agenda compartilhada (parceiros — secao 11.2) --------------------------

export const sharedCalendarLinks = pgTable('shared_calendar_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: integer('tenant_id')
    .notNull()
    .default(1)
    .references(() => tenants.id),
  label: text('label').notNull(), // "Aventurando"
  token: text('token').notNull().unique(), // nanoid >= 32 chars
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
  revokedAt: tstz('revoked_at'),
});
