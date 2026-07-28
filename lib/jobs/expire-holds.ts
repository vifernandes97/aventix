// Aventix — expiracao de hold (CLAUDE.md secao 12).
//
// Reserva `pending_payment` cujo `hold_expires_at` venceu vira `expired`,
// liberando os recursos: ao sair de pending_payment/confirmed, as linhas de
// `reservation_resources` deixam a clausula WHERE da exclusion constraint e o
// horario volta a aparecer na grade.
//
// A mudanca de status passa OBRIGATORIAMENTE por setReservationStatus (regra
// inviolavel da secao 4.6). Um `UPDATE reservations SET status` aqui furaria a
// trava de FOR UPDATE e a sincronizacao com reservation_resources — o cron e o
// webhook de pagamento disputam exatamente estas linhas, no minuto exato em que
// o Pix cai junto com o vencimento do hold.
//
// A logica vive em lib/ (e nao dentro do agendador) para ser testavel isolada e
// reusavel: o job de reconciliacao da Fase 2 (secao 8-B) vai ser vizinho deste.
//
// NAO dispara e-mail nem qualquer efeito colateral: so expira. Notificacoes sao
// Fase 4.

import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { reservations } from '../db/schema';
import { InvalidReservationTransitionError, setReservationStatus } from '../reservations';
import { getTenantId } from '../tenant';

export type ExpireHoldsResult = {
  expiredCount: number;
  reservationIds: string[];
};

/**
 * Expira todos os holds vencidos do tenant atual.
 *
 * Idempotente: sem holds vencidos, e no-op e devolve contagem zero.
 * Uma reserva que falhe nao impede as outras — o erro e logado e o laco segue.
 */
export async function expireHolds(): Promise<ExpireHoldsResult> {
  const tenantId = getTenantId();

  // Relogio do BANCO, nao o do processo Node: um container com clock adiantado
  // expiraria holds ainda validos. Casa com o indice idx_reservations_status_hold
  // (status, hold_expires_at), que existe para esta query.
  // hold_expires_at NULL nunca entra: `NULL < now()` e NULL, nao verdadeiro —
  // reserva sem hold nao expira por tempo.
  const due = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.status, 'pending_payment'),
        lt(reservations.holdExpiresAt, sql`now()`),
      ),
    );

  const reservationIds: string[] = [];

  for (const { id } of due) {
    try {
      // Sem tx: setReservationStatus abre a propria transacao, entao cada
      // reserva expira isolada. Uma falha nao arrasta as demais.
      await setReservationStatus(id, 'expired');
      reservationIds.push(id);
    } catch (error) {
      if (error instanceof InvalidReservationTransitionError) {
        // Corrida ESPERADA, nao falha: entre o SELECT e o FOR UPDATE, o webhook
        // confirmou o pagamento. setReservationStatus recusou confirmed ->
        // expired e a reserva paga sobreviveu, que e o comportamento correto.
        console.info(
          `[expire-holds] reserva ${id} mudou de estado antes da expiracao ` +
            `(${error.from} -> ${error.to} recusado); ignorando`,
        );
        continue;
      }

      console.error(`[expire-holds] falha ao expirar a reserva ${id}:`, error);
    }
  }

  return { expiredCount: reservationIds.length, reservationIds };
}
