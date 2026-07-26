// Aventix — regras transacionais de reserva (CLAUDE.md secoes 4.6, 5 e 12).
//
// ESTE MODULO E A UNICA PORTA DE ENTRADA para mudar o estado de uma reserva.
// Motivo (secao 4.6): `reservation_resources.status` ESPELHA `reservations.status`
// e e o que o WHERE da exclusion constraint enxerga. Um UPDATE em `reservations`
// sem o UPDATE correspondente em `reservation_resources` deixa a vaga travada
// (ou libera vaga que deveria estar travada) — overbooking silencioso.

import { and, eq, getTableColumns, sql } from 'drizzle-orm';

import { db } from './db/client';
import {
  customers,
  reservationPayments,
  reservationPaymentState,
  reservationResources,
  reservations,
  reservationStatus,
} from './db/schema';
import { getTenantId } from './tenant';

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
  return { customer, created };
}
