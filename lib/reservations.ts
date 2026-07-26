// Aventix — regras transacionais de reserva (CLAUDE.md secoes 4.6, 5 e 12).
//
// ESTE MODULO E A UNICA PORTA DE ENTRADA para mudar o estado de uma reserva.
// Motivo (secao 4.6): `reservation_resources.status` ESPELHA `reservations.status`
// e e o que o WHERE da exclusion constraint enxerga. Um UPDATE em `reservations`
// sem o UPDATE correspondente em `reservation_resources` deixa a vaga travada
// (ou libera vaga que deveria estar travada) — overbooking silencioso.

import { and, eq, sql } from 'drizzle-orm';

import { db } from './db/client';
import { reservationResources, reservations, reservationStatus } from './db/schema';
import { getTenantId } from './tenant';

/** Status de reserva, derivado do enum do Drizzle — nunca string solta. */
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];

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
