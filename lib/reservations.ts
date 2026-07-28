// Aventix — regras transacionais de reserva (CLAUDE.md secoes 4.6, 5 e 12).
//
// ESTE MODULO E A UNICA PORTA DE ENTRADA para mudar o estado de uma reserva.
// Motivo (secao 4.6): `reservation_resources.status` ESPELHA `reservations.status`
// e e o que o WHERE da exclusion constraint enxerga. Um UPDATE em `reservations`
// sem o UPDATE correspondente em `reservation_resources` deixa a vaga travada
// (ou libera vaga que deveria estar travada) — overbooking silencioso.

import { and, eq, getTableColumns, sql } from 'drizzle-orm';

import {
  ExperienceNotFoundError,
  InvalidResourcesNeededError,
  getAvailability,
} from './availability';
import { db } from './db/client';
import {
  customers,
  experiences,
  participants as participantsTable,
  reservationPayments,
  reservationPaymentState,
  reservationResources,
  reservations,
  reservationStatus,
  resources,
} from './db/schema';
import { getBooleanSetting, getTenantId } from './tenant';
import { todayLocalDate, utcToLocalDate } from './time';

/** Status de reserva, derivado do enum do Drizzle — nunca string solta. */
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];

/** Estado financeiro AGREGADO da reserva, derivado do enum do Drizzle. */
export type ReservationPaymentState = (typeof reservationPaymentState.enumValues)[number];

/**
 * Executor transacional do Drizzle. Extraido da assinatura de db.transaction
 * para nao depender dos genericos internos de PgTransaction.
 */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// -- erros -------------------------------------------------------------------

export class ReservationNotFoundError extends Error {
  readonly reservationId: string;

  constructor(reservationId: string, tenantId: number) {
    super(`Reserva ${reservationId} nao encontrada no tenant ${tenantId}.`);
    this.name = 'ReservationNotFoundError';
    this.reservationId = reservationId;
  }
}

export class InvalidPhoneError extends Error {
  readonly raw: string;
  readonly digits: string;

  constructor(raw: string, digits: string) {
    super(
      `Telefone invalido: ${JSON.stringify(raw)} -> ${digits.length} digito(s) ` +
        `(${JSON.stringify(digits)}). Esperado 10 (fixo: DDD + 8) ou 11 (celular: DDD + 9).`,
    );
    this.name = 'InvalidPhoneError';
    this.raw = raw;
    this.digits = digits;
  }
}

export class InvalidCustomerDataError extends Error {
  readonly field: string;

  constructor(field: string, reason: string) {
    super(`Dado invalido do cliente em '${field}': ${reason}.`);
    this.name = 'InvalidCustomerDataError';
    this.field = field;
  }
}

export class InvalidReservationTransitionError extends Error {
  readonly reservationId: string;
  readonly from: ReservationStatus;
  readonly to: ReservationStatus;

  constructor(reservationId: string, from: ReservationStatus, to: ReservationStatus) {
    super(
      `Transicao de status invalida para a reserva ${reservationId}: ` +
        `'${from}' -> '${to}'. Transicoes validas a partir de '${from}': ` +
        `${ALLOWED_TRANSITIONS[from].length > 0 ? ALLOWED_TRANSITIONS[from].map((s) => `'${s}'`).join(', ') : '(nenhuma — estado terminal)'}.`,
    );
    this.name = 'InvalidReservationTransitionError';
    this.reservationId = reservationId;
    this.from = from;
    this.to = to;
  }
}

// -- maquina de estados (secao 5.1) -----------------------------------------

/**
 * Transicoes permitidas. Tudo que nao esta aqui e invalido, INCLUSIVE
 * status -> mesmo status: no-op e rejeitado explicitamente, nunca engolido.
 * Quem precisa de idempotencia (webhook) checa o status antes de chamar.
 */
const ALLOWED_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  // hold ativo: paga (webhook), vence (cron) ou o dono cancela
  pending_payment: ['confirmed', 'expired', 'cancelled'],
  // confirmada: so o dono cancela (libera as vagas)
  confirmed: ['cancelled'],
  // PIX TARDIO (secao 5.1 / 8.3): quem chama e responsavel por checar vagas livres.
  // Esta funcao so executa a mudanca de estado.
  expired: ['confirmed'],
  // terminal
  cancelled: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// -- setReservationStatus ----------------------------------------------------

export type SetReservationStatusResult = {
  reservationId: string;
  previousStatus: ReservationStatus;
  status: ReservationStatus;
  /** linhas de reservation_resources sincronizadas (= resources_needed) */
  resourceRowsUpdated: number;
};

/**
 * Muda o status de uma reserva e sincroniza, na MESMA transacao, o status de
 * todas as suas linhas em `reservation_resources` (secao 4.6).
 *
 * @param tx  Executor transacional opcional. Passe SEMPRE que ja estiver dentro
 *            de uma transacao (criacao da reserva, webhook de pagamento, cron):
 *            abrir uma transacao aninhada aqui viraria savepoint e quebraria a
 *            atomicidade do bloco externo. Sem `tx`, a funcao abre a sua propria.
 *
 * @throws {ReservationNotFoundError} reserva inexistente (ou de outro tenant).
 * @throws {InvalidReservationTransitionError} transicao fora da maquina de estados.
 */
export async function setReservationStatus(
  reservationId: string,
  newStatus: ReservationStatus,
  tx?: Transaction,
): Promise<SetReservationStatusResult> {
  if (tx) return applyReservationStatus(tx, reservationId, newStatus);
  return db.transaction((ownTx) => applyReservationStatus(ownTx, reservationId, newStatus));
}

/**
 * Corpo unico da operacao. Recebe SEMPRE um executor transacional — nao existe
 * caminho alternativo sem transacao, justamente para nao duplicar a logica.
 */
async function applyReservationStatus(
  tx: Transaction,
  reservationId: string,
  newStatus: ReservationStatus,
): Promise<SetReservationStatusResult> {
  // 1. Trava a linha da reserva ate o fim da transacao.
  //    Sem FOR UPDATE, cron de expiracao e webhook de pagamento podem ler
  //    'pending_payment' ao mesmo tempo e um sobrescrever o outro (o Pix cai
  //    exatamente quando o hold vence). Com FOR UPDATE, o segundo espera o
  //    commit do primeiro e revalida contra o estado ja atualizado.
  const tenantId = getTenantId();

  const [current] = await tx
    .select({ id: reservations.id, status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.tenantId, tenantId)))
    .for('update');

  // 2. Reserva inexistente: lanca, nunca retorna null.
  if (!current) throw new ReservationNotFoundError(reservationId, tenantId);

  const previousStatus = current.status;

  // 3. Valida a transicao contra a maquina de estados (secao 5.1).
  if (!canTransition(previousStatus, newStatus)) {
    throw new InvalidReservationTransitionError(reservationId, previousStatus, newStatus);
  }

  // 4. reservations: status + o timestamp correspondente.
  //    'expired' nao tem coluna de timestamp — nao inventar.
  //    now() e o relogio do banco (fonte da verdade), nao o do processo Node.
  await tx
    .update(reservations)
    .set({
      status: newStatus,
      ...(newStatus === 'confirmed' ? { confirmedAt: sql`now()` } : {}),
      ...(newStatus === 'cancelled' ? { cancelledAt: sql`now()` } : {}),
    })
    .where(and(eq(reservations.id, reservationId), eq(reservations.tenantId, tenantId)));

  // 5. reservation_resources: espelha o status em TODAS as linhas da reserva.
  //    E o que a exclusion constraint enxerga — sair de
  //    pending_payment/confirmed aqui e o que efetivamente libera a vaga, e
  //    voltar para 'confirmed' (Pix tardio) e o que pode estourar a constraint
  //    se a vaga ja foi tomada. Nesse caso o Postgres aborta a transacao e o
  //    erro sobe para quem chamou (secao 8.3).
  const updatedResources = await tx
    .update(reservationResources)
    .set({ status: newStatus })
    .where(eq(reservationResources.reservationId, reservationId))
    .returning({ id: reservationResources.id });

  return {
    reservationId,
    previousStatus,
    status: newStatus,
    resourceRowsUpdated: updatedResources.length,
  };
}

// -- recalcReservationPayment ------------------------------------------------

export type RecalcReservationPaymentResult = {
  reservationId: string;
  amountPaidCents: number;
  previousPaymentState: ReservationPaymentState;
  paymentState: ReservationPaymentState;
  totalPriceCents: number;
  /** saldo em aberto: max(0, total - pago). Nunca negativo. */
  balanceCents: number;
};

/**
 * Classificacao do estado financeiro agregado (secao 4.6).
 *
 * O `>=` do 'settled' e proposital: pagamento a maior (troco, valor digitado
 * errado no receiveInCash) e reserva quitada, nao um estado de erro. Quem
 * precisa tratar excedente olha amountPaidCents contra totalPriceCents.
 */
function classifyPaymentState(
  amountPaidCents: number,
  totalPriceCents: number,
): ReservationPaymentState {
  if (amountPaidCents === 0) return 'pending';
  if (amountPaidCents < totalPriceCents) return 'partial';
  return 'settled';
}

/**
 * Recalcula `amount_paid_cents` e `payment_state` da reserva a partir das linhas
 * de `reservation_payments` (secao 4.6). Funcao irma de setReservationStatus:
 * aquela governa a VAGA, esta governa o DINHEIRO.
 *
 * NAO altera `reservations.status`. Confirmar reserva e responsabilidade
 * exclusiva de setReservationStatus; o webhook chama as duas em sequencia
 * quando for o caso (secao 8.2, passo 6). Misturar as duas furaria a regra
 * inviolavel da secao 4.6.
 *
 * Idempotente por construcao: recalcula a partir da verdade (as linhas de
 * reservation_payments), nunca acumula sobre o valor anterior. Chamar duas
 * vezes seguidas sem mudanca nos pagamentos da exatamente o mesmo resultado.
 *
 * @param tx  Executor transacional opcional. Passe SEMPRE quando ja estiver
 *            dentro de uma transacao — o recalculo tem que acontecer na MESMA
 *            transacao em que o pagamento mudou de estado (secao 4.6).
 *
 * @throws {ReservationNotFoundError} reserva inexistente (ou de outro tenant).
 */
export async function recalcReservationPayment(
  reservationId: string,
  tx?: Transaction,
): Promise<RecalcReservationPaymentResult> {
  if (tx) return applyRecalcReservationPayment(tx, reservationId);
  return db.transaction((ownTx) => applyRecalcReservationPayment(ownTx, reservationId));
}

/**
 * Corpo unico da operacao. Recebe SEMPRE um executor transacional.
 */
async function applyRecalcReservationPayment(
  tx: Transaction,
  reservationId: string,
): Promise<RecalcReservationPaymentResult> {
  const tenantId = getTenantId();

  // 1. Trava a linha da reserva ate o fim da transacao.
  //    O webhook (secao 8.2) e o job de reconciliacao (secao 8-B) podem
  //    processar o mesmo pagamento ao mesmo tempo — o job existe justamente
  //    para cobrir quando o webhook falha, entao sobreposicao e esperada, nao
  //    acidente. Sem a trava, dois recalculos concorrentes gravariam valores
  //    inconsistentes. Note que a leitura da soma vem DEPOIS da trava.
  const [current] = await tx
    .select({
      id: reservations.id,
      totalPriceCents: reservations.totalPriceCents,
      paymentState: reservations.paymentState,
    })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.tenantId, tenantId)))
    .for('update');

  // 2. Reserva inexistente: lanca, nunca retorna null.
  if (!current) throw new ReservationNotFoundError(reservationId, tenantId);

  // 3. Soma no BANCO, nao no Node: nao ha razao para trazer as linhas so para
  //    somar. Somam apenas os pagamentos 'paid' — 'pending', 'cancelled' e
  //    'refunded' ficam de fora. Os tres kinds ('full', 'deposit', 'balance')
  //    contam igualmente quando pagos: dinheiro recebido e dinheiro recebido.
  //    coalesce cobre "nenhuma linha paga" -> 0, nunca null.
  //    O ::int evita o bigint que SUM() retorna (que o node-postgres entregaria
  //    como STRING) — centavos continuam inteiros de ponta a ponta, sem float.
  const [paid] = await tx
    .select({
      amountPaidCents: sql<number>`coalesce(sum(${reservationPayments.amountCents}), 0)::int`,
    })
    .from(reservationPayments)
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        eq(reservationPayments.state, 'paid'),
      ),
    );

  const amountPaidCents = paid.amountPaidCents;
  const totalPriceCents = current.totalPriceCents;
  const previousPaymentState = current.paymentState;

  // 4. Classifica contra o total da reserva (secao 4.6).
  const paymentState = classifyPaymentState(amountPaidCents, totalPriceCents);

  // 5. Grava o agregado. `status` NAO entra neste UPDATE — de proposito.
  await tx
    .update(reservations)
    .set({ amountPaidCents, paymentState })
    .where(and(eq(reservations.id, reservationId), eq(reservations.tenantId, tenantId)));

  return {
    reservationId,
    amountPaidCents,
    previousPaymentState,
    paymentState,
    totalPriceCents,
    // saldo em aberto do calendario do admin (secao 11.1) e do
    // GET /api/reservations/{id}/status (secao 7.1)
    balanceCents: Math.max(0, totalPriceCents - amountPaidCents),
  };
}

// -- findOrCreateCustomer ----------------------------------------------------

export type Customer = typeof customers.$inferSelect;

export type FindOrCreateCustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
  cpf?: string | null;
  birthdate?: string | null; // 'YYYY-MM-DD'
};

/**
 * Normaliza um telefone brasileiro para a forma canonica de digitos.
 *
 * >>> TODO acesso a `customers.phone` — leitura OU escrita, aqui ou em qualquer
 * >>> codigo futuro — tem que passar por esta funcao. <<<
 * O telefone e a chave de identificacao do cliente (UNIQUE (tenant_id, phone),
 * secao 4.4). Se a busca do admin consultar o que o usuario digitou sem
 * normalizar, ela nao acha o cliente gravado normalizado; e se uma reserva
 * gravar sem normalizar, a MESMA pessoa vira DOIS clientes e o historico se
 * parte — sem erro nenhum aparecendo.
 *
 * Regras:
 *  1. mantem so digitos;
 *  2. remove o prefixo '55' de pais APENAS quando o resultado tem 12 ou 13
 *     digitos. A checagem de comprimento nao e detalhe: 55 tambem e DDD valido
 *     (Santa Maria/RS), e (55) 9999-8888 -> '5599998888' (10 digitos) precisa
 *     sobreviver inteiro. Remover '55' incondicionalmente o transformaria em
 *     '99998888', um numero diferente;
 *  3. exige 10 digitos (fixo: DDD + 8) ou 11 (celular: DDD + 9);
 *  4. NAO tenta adivinhar o nono digito — 10 digitos pode ser um fixo legitimo.
 *
 * @throws {InvalidPhoneError} comprimento fora de 10/11 digitos.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');

  const withoutCountry =
    (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
      ? digits.slice(2)
      : digits;

  if (withoutCountry.length !== 10 && withoutCountry.length !== 11) {
    throw new InvalidPhoneError(raw, withoutCountry);
  }

  return withoutCountry;
}

/** trim + string vazia vira null (para o COALESCE preservar o valor gravado). */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Find-or-create de cliente por (tenant_id, phone) — secao 4.6 e caso de borda 17.
 *
 * Usa UPSERT (ON CONFLICT), nao SELECT-depois-INSERT: dois pedidos simultaneos
 * com o mesmo telefone passariam ambos por um SELECT sem encontrar nada e o
 * segundo INSERT estouraria no UNIQUE. O upsert resolve numa statement so,
 * atomicamente, sem tratamento de excecao.
 *
 * No conflito (cliente recorrente), `name` e sempre atualizado; `email`, `cpf` e
 * `birthdate` so sao sobrescritos quando vem valor — COALESCE com precedencia
 * do novo. Uma reserva que nao informou CPF NUNCA apaga o CPF ja cadastrado.
 *
 * @returns `created: true` se a linha foi inserida agora, `false` se ja existia.
 * @throws {InvalidPhoneError} telefone fora de 10/11 digitos.
 * @throws {InvalidCustomerDataError} nome vazio.
 */
export async function findOrCreateCustomer(
  data: FindOrCreateCustomerInput,
  tx?: Transaction,
): Promise<{ customer: Customer; created: boolean }> {
  if (tx) return applyFindOrCreateCustomer(tx, data);
  return db.transaction((ownTx) => applyFindOrCreateCustomer(ownTx, data));
}

/**
 * Corpo unico da operacao. Recebe SEMPRE um executor transacional.
 */
async function applyFindOrCreateCustomer(
  tx: Transaction,
  data: FindOrCreateCustomerInput,
): Promise<{ customer: Customer; created: boolean }> {
  const tenantId = getTenantId();

  const name = data.name?.trim();
  if (!name) throw new InvalidCustomerDataError('name', 'obrigatorio e nao pode ser vazio');

  // Normaliza ANTES do upsert: e o valor normalizado que vai para o UNIQUE.
  const phone = normalizePhone(data.phone);

  const email = blankToNull(data.email);
  const cpf = blankToNull(data.cpf);
  const birthdate = blankToNull(data.birthdate);

  // xmax = 0 distingue linha INSERIDA de linha ATUALIZADA no mesmo RETURNING:
  // numa insercao o xmax da tupla e zero; quando o DO UPDATE dispara, ele
  // carrega o id da transacao que a atualizou. Resolve sem SELECT extra e sem
  // janela de corrida entre a leitura e a escrita.
  const [row] = await tx
    .insert(customers)
    .values({ tenantId, name, phone, email, cpf, birthdate })
    .onConflictDoUpdate({
      target: [customers.tenantId, customers.phone],
      set: {
        name: sql`excluded.name`,
        // precedencia do novo valor; se veio null, preserva o gravado
        email: sql`coalesce(excluded.email, ${customers.email})`,
        cpf: sql`coalesce(excluded.cpf, ${customers.cpf})`,
        birthdate: sql`coalesce(excluded.birthdate, ${customers.birthdate})`,
        // created_at NAO entra: a data de cadastro do cliente nao se reescreve
      },
    })
    .returning({ ...getTableColumns(customers), created: sql<boolean>`(xmax = 0)` });

  const { created, ...customer } = row;

  // O schema usa timestamp mode:'string', entao o driver devolve o TEXTO CRU do
  // Postgres ("2026-07-27 23:09:14.518994-03"): espaco no lugar do T, offset sem
  // minutos, microssegundos de 6 digitos. O V8 tolera esse formato, outros
  // motores nao — e um Date invalido no cliente vira NaN silencioso. Todo
  // timestamp que sai de lib/ para a camada de API vai em ISO 8601.
  // (birthdate NAO entra aqui: e coluna `date`, ja sai como 'YYYY-MM-DD'.)
  return {
    customer: { ...customer, createdAt: new Date(customer.createdAt).toISOString() },
    created,
  };
}

// -- createReservation -------------------------------------------------------

export type ParticipantRoleValue = 'operator' | 'passenger';

export type CreateReservationInput = {
  experienceId: number;
  /** ISO/UTC — veio de getAvailability */
  startAt: string;
  resourcesNeeded: number;
  customer: FindOrCreateCustomerInput;
  participants: {
    name: string;
    birthdate?: string | null;
    role: ParticipantRoleValue;
    documentNumber?: string | null;
  }[];
  termo: { version: string; acceptedAt: string };
  channel?: string | null;
  /** capturados na rota — sao a prova juridica do aceite (secao 10) */
  acceptance?: { ip?: string | null; userAgent?: string | null };
};

export type CreateReservationResult = {
  reservationId: string;
  status: ReservationStatus;
  holdExpiresAt: string;
  paymentMode: PaymentMode;
  totalCents: number;
  /** o que o cliente paga AGORA: total no modo full, sinal no modo deposit */
  dueNowCents: number;
  balanceCents: number;
  allocatedResourceIds: number[];
};

export type PaymentMode = (typeof experiences.paymentMode.enumValues)[number];

/** Violacao de regra de composicao/termo — a rota mapeia para 422. */
export class InvalidCompositionError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Composicao invalida: ${reason}.`);
    this.name = 'InvalidCompositionError';
    this.reason = reason;
  }
}

/** Horario indisponivel, recursos insuficientes ou corrida perdida — a rota mapeia para 409. */
export class SlotUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Horario indisponivel: ${reason}.`);
    this.name = 'SlotUnavailableError';
    this.reason = reason;
  }
}

/** `exclusion_violation` do Postgres: outro cliente ganhou a corrida no recurso. */
function isExclusionViolation(error: unknown): boolean {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
    ?? (error as { code?: string })?.code;
  return code === '23P01';
}

/**
 * Sanitiza `channel` (origem da venda, secao 4.4). Vem de querystring publica
 * (`?canal=aventurando`), entao nao se confia no formato: lowercase, trim, so
 * [a-z0-9_-], no maximo 40 chars. Vazio depois disso vira null.
 */
function sanitizeChannel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return cleaned || null;
}

/**
 * Cria a reserva inteira numa unica transacao (secao 5.2): cliente, reserva,
 * alocacoes, participantes e cobrancas.
 *
 * @throws {ExperienceNotFoundError}     experiencia inexistente/inativa -> 404
 * @throws {InvalidResourcesNeededError} resourcesNeeded fora de 1..ativos -> 400
 * @throws {InvalidCompositionError}     operadores/capacidade/documento/termo -> 422
 * @throws {SlotUnavailableError}        slot fora da grade, sem recursos, corrida -> 409
 * @throws {InvalidPhoneError}           telefone do cliente malformado -> 400
 */
export async function createReservation(
  input: CreateReservationInput,
  tx?: Transaction,
): Promise<CreateReservationResult> {
  // Validacoes que nao dependem do banco ficam FORA da transacao: nao ha por que
  // abrir transacao (e, no modo exclusivo, tomar advisory lock do tenant) para
  // recusar um corpo que ja da para reprovar aqui.
  const startInstant = new Date(input.startAt);
  if (Number.isNaN(startInstant.getTime())) {
    throw new InvalidCompositionError(`startAt invalido: ${JSON.stringify(input.startAt)}`);
  }

  // TODO(Fase 3): validar termo.version contra a versao VIGENTE do termo. Hoje
  // nao existe onde guarda-la (nem tabela, nem chave em settings), entao aqui so
  // se valida presenca/formato — a reserva registra o que o cliente aceitou.
  if (!input.termo?.version?.trim()) {
    throw new InvalidCompositionError('termo.version ausente');
  }
  const termoAcceptedAt = new Date(input.termo?.acceptedAt ?? '');
  if (Number.isNaN(termoAcceptedAt.getTime())) {
    throw new InvalidCompositionError(
      `termo.acceptedAt ausente ou invalido: ${JSON.stringify(input.termo?.acceptedAt)}`,
    );
  }

  if (!input.participants || input.participants.length === 0) {
    throw new InvalidCompositionError('nenhum participante informado');
  }

  const operators = input.participants.filter((p) => p.role === 'operator');
  if (operators.length < input.resourcesNeeded) {
    throw new InvalidCompositionError(
      `${operators.length} operador(es) para ${input.resourcesNeeded} recurso(s); ` +
        'cada recurso alugado precisa de ao menos um habilitado a operar',
    );
  }

  const channel = sanitizeChannel(input.channel);

  if (tx) return applyCreateReservation(tx, input, { startInstant, termoAcceptedAt, channel });
  return db.transaction((ownTx) =>
    applyCreateReservation(ownTx, input, { startInstant, termoAcceptedAt, channel }),
  );
}

type PreparedInput = {
  startInstant: Date;
  termoAcceptedAt: Date;
  channel: string | null;
};

/**
 * Corpo unico da operacao. Recebe SEMPRE um executor transacional.
 */
async function applyCreateReservation(
  tx: Transaction,
  input: CreateReservationInput,
  prepared: PreparedInput,
): Promise<CreateReservationResult> {
  const tenantId = getTenantId();
  const { startInstant, termoAcceptedAt, channel } = prepared;
  const startIso = startInstant.toISOString();

  // -- 1. ADVISORY LOCK ------------------------------------------------------
  // PRIMEIRA statement da transacao quando o tenant opera em modo exclusivo
  // (secao 5). Serializa a secao critica por tenant e fecha a corrida que a
  // exclusion constraint NAO cobre: aquela enxerga conflito por RECURSO, e nao
  // entre EXPERIENCIAS diferentes. Solto no commit/rollback.
  const singleExperiencePerSlot = await getBooleanSetting('single_experience_per_slot');
  if (singleExperiencePerSlot) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId})`);
  }

  // -- experiencia (snapshot de preco e modo de pagamento) -------------------
  const [experience] = await tx
    .select({
      id: experiences.id,
      durationMinutes: experiences.durationMinutes,
      bufferMinutes: experiences.bufferMinutes,
      priceCents: experiences.priceCents,
      paymentMode: experiences.paymentMode,
      depositPercent: experiences.depositPercent,
      depositFixedCents: experiences.depositFixedCents,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.id, input.experienceId),
        eq(experiences.tenantId, tenantId),
        eq(experiences.active, true),
      ),
    );

  if (!experience) throw new ExperienceNotFoundError(input.experienceId, tenantId);

  const [{ activeResources }] = await tx
    .select({ activeResources: sql<number>`count(*)::int` })
    .from(resources)
    .where(and(eq(resources.tenantId, tenantId), eq(resources.active, true)));

  if (
    !Number.isInteger(input.resourcesNeeded) ||
    input.resourcesNeeded < 1 ||
    input.resourcesNeeded > activeResources
  ) {
    throw new InvalidResourcesNeededError(input.resourcesNeeded, activeResources);
  }

  // -- documento dos operadores (config do tenant, secao 1) ------------------
  if (await getBooleanSetting('operator_document_required')) {
    const missing = input.participants.filter(
      (p) => p.role === 'operator' && !p.documentNumber?.trim(),
    );
    if (missing.length > 0) {
      throw new InvalidCompositionError(
        `${missing.length} operador(es) sem numero de documento, exigido por este tenant`,
      );
    }
  }

  // -- 2. RECHECK DE DISPONIBILIDADE -----------------------------------------
  // Reusa o MOTOR, com o mesmo tx. Nao reimplementar: logica propria aqui
  // poderia divergir do motor — a grade mostraria horario que o POST recusa, ou
  // aceitaria um que a grade escondeu. De brinde, cobre lead time, blackouts,
  // excecoes de agenda e exclusividade de experiencia sem duplicar nada.
  const date = utcToLocalDate(startInstant);
  const availability = await getAvailability(
    { experienceId: input.experienceId, date, resourcesNeeded: input.resourcesNeeded },
    tx,
  );

  const offered = availability.slots.some(
    (slot) => new Date(slot.startAt).getTime() === startInstant.getTime(),
  );
  if (!offered) {
    throw new SlotUnavailableError(
      `${startIso} nao esta entre os horarios disponiveis de ${date} (dayState=${availability.dayState})`,
    );
  }

  // -- 3. SELECIONAR OS RECURSOS A ALOCAR ------------------------------------
  // Query da secao 6, agora DENTRO da transacao. Sobreposicao no operador && do
  // Postgres — nunca em JS (mesma regra do motor).
  const totalMinutes = experience.durationMinutes + experience.bufferMinutes;

  const allocatable = await tx.execute<{ id: number; capacity: number }>(sql`
    SELECT r.id, r.capacity
    FROM resources r
    WHERE r.tenant_id = ${tenantId}
      AND r.active
      AND NOT EXISTS (
        SELECT 1
        FROM reservation_resources rr
        WHERE rr.resource_id = r.id
          AND rr.status IN ('pending_payment', 'confirmed')
          AND rr.period && tstzrange(
            ${startIso}::timestamptz,
            ${startIso}::timestamptz + make_interval(mins => ${totalMinutes})
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM blackouts bl
        WHERE bl.tenant_id = ${tenantId}
          AND (bl.resource_id = r.id OR bl.resource_id IS NULL)
          AND bl.period && tstzrange(
            ${startIso}::timestamptz,
            ${startIso}::timestamptz + make_interval(mins => ${totalMinutes})
          )
      )
    ORDER BY r.id
    LIMIT ${input.resourcesNeeded}
  `);

  const allocated = allocatable.rows;
  if (allocated.length < input.resourcesNeeded) {
    // Caso de borda 2: ou aloca tudo, ou nada. Nunca reserva parcial.
    throw new SlotUnavailableError(
      `${allocated.length} recurso(s) livre(s) para ${input.resourcesNeeded} pedido(s)`,
    );
  }

  // -- composicao: participantes x capacidade REAL dos recursos alocados -----
  // Soma das capacities, nao capacity x resourcesNeeded: o schema permite
  // capacity diferente por recurso. No caso uniforme da o mesmo numero, e
  // continua correto quando houver um recurso de capacidade diferente.
  const totalCapacity = allocated.reduce((sum, r) => sum + Number(r.capacity), 0);
  if (input.participants.length > totalCapacity) {
    throw new InvalidCompositionError(
      `${input.participants.length} participantes para capacidade total ${totalCapacity}`,
    );
  }

  // -- 4. find-or-create do cliente ------------------------------------------
  const { customer } = await findOrCreateCustomer(input.customer, tx);

  // -- 5. PRECO NO SERVIDOR (secao 4.6) --------------------------------------
  // Inteiros de centavos de ponta a ponta. Nunca confie em valor do cliente.
  const totalCents = experience.priceCents * input.resourcesNeeded;

  let dueNowCents = totalCents;
  let balanceCents = 0;

  if (experience.paymentMode === 'deposit') {
    const rawDeposit =
      experience.depositFixedCents ??
      Math.round((totalCents * (experience.depositPercent ?? 0)) / 100);

    // Teto obrigatorio: sinal >= total vira total e NAO gera linha de balance.
    // Sem isso, um deposit_fixed_cents maior que o preco produziria balance <= 0
    // e o CHECK (amount_cents > 0) derrubaria a venda por erro de configuracao
    // da experiencia. O piso de 1 centavo cobre o percentual que arredonda p/ 0.
    dueNowCents = Math.min(Math.max(rawDeposit, 1), totalCents);
    balanceCents = totalCents - dueNowCents;
  }

  // -- 6. INSERTS ------------------------------------------------------------

  // a. reserva. hold_expires_at usa o relogio do BANCO, nao o do processo Node.
  const [reservation] = await tx
    .insert(reservations)
    .values({
      tenantId,
      customerId: customer.id,
      experienceId: experience.id,
      resourcesNeeded: input.resourcesNeeded,
      totalPriceCents: totalCents,
      startAt: startIso,
      channel,
      paymentMode: experience.paymentMode, // SNAPSHOT de como foi vendido
      termoVersion: input.termo.version.trim(),
      termoAcceptedAt: termoAcceptedAt.toISOString(),
      termoAcceptedIp: input.acceptance?.ip ?? null,
      termoAcceptedUserAgent: input.acceptance?.userAgent ?? null,
      status: 'pending_payment',
      holdExpiresAt: sql`now() + interval '15 minutes'`,
    })
    .returning({
      id: reservations.id,
      status: reservations.status,
      holdExpiresAt: reservations.holdExpiresAt,
    });

  // b. alocacoes. period INCLUI o buffer (secao 4.6); status espelha a reserva.
  try {
    await tx.insert(reservationResources).values(
      allocated.map((resource) => ({
        reservationId: reservation.id,
        resourceId: Number(resource.id),
        period: sql`tstzrange(
          ${startIso}::timestamptz,
          ${startIso}::timestamptz + make_interval(mins => ${totalMinutes})
        )`,
        status: 'pending_payment' as const,
      })),
    );
  } catch (error) {
    // 8. Caso de borda 1: outro cliente ganhou a corrida entre o SELECT e o
    // INSERT. A transacao inteira ja esta abortada; so traduzimos o erro.
    if (isExclusionViolation(error)) {
      throw new SlotUnavailableError('outro cliente reservou este horario primeiro');
    }
    throw error;
  }

  // c. participantes
  await tx.insert(participantsTable).values(
    input.participants.map((p) => ({
      reservationId: reservation.id,
      name: p.name.trim(),
      birthdate: p.birthdate?.trim() || null,
      role: p.role,
      documentNumber: p.documentNumber?.trim() || null,
    })),
  );

  // d. cobrancas (secao 5.2 passo 3). Nascem com asaas_payment_id NULL.
  //
  // FASE 2 entra AQUI (secao 5.2 passo 5): FORA desta transacao, criar as
  // cobrancas no Asaas e gravar os asaas_payment_id; falha na criacao marca a
  // reserva 'expired' e libera a vaga.
  //
  // due_date e `date`: "hoje" e "data do passeio" sao datas de CALENDARIO em
  // Sao Paulo. Uma reserva feita 23:50 em SP ja e o dia seguinte em UTC.
  const dueToday = todayLocalDate();
  const tripDate = date;

  const paymentRows = [
    {
      reservationId: reservation.id,
      kind: (experience.paymentMode === 'deposit' ? 'deposit' : 'full') as 'deposit' | 'full',
      amountCents: dueNowCents,
      dueDate: dueToday,
    },
    ...(balanceCents > 0
      ? [
          {
            reservationId: reservation.id,
            kind: 'balance' as const,
            amountCents: balanceCents,
            dueDate: tripDate,
          },
        ]
      : []),
  ];

  await tx.insert(reservationPayments).values(
    paymentRows.map((row) => ({
      ...row,
      method: 'pix' as const,
      state: 'pending' as const,
      // unico e deterministico (secao 4.6): reconcilia mesmo perdendo o id do Asaas
      externalReference: `${reservation.id}:${row.kind}`,
    })),
  );

  return {
    reservationId: reservation.id,
    status: reservation.status,
    // ISO 8601, nao o texto cru do Postgres que o mode:'string' devolve — a tela
    // de pagamento faz new Date(holdExpiresAt) para o contador de 15 minutos.
    holdExpiresAt: new Date(reservation.holdExpiresAt!).toISOString(),
    paymentMode: experience.paymentMode,
    totalCents,
    dueNowCents,
    balanceCents,
    allocatedResourceIds: allocated.map((r) => Number(r.id)),
  };
}
