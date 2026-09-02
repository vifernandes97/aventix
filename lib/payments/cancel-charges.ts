// Aventix — cancelamento da reserva COM as cobrancas pendentes do provedor
// (CLAUDE.md secoes 5.1, 7.2 e 15.12).
//
// ============================================================================
// >>> O BURACO QUE ESTE MODULO FECHA <<<
// Ate aqui, cancelar liberava a vaga e NAO tocava no Asaas. A cobranca
// continuava PAGAVEL: o cliente de uma reserva que nao existe mais recebia o QR
// no WhatsApp, pagava, e o dinheiro entrava na conta do tenant para um passeio
// cancelado — com estorno MANUAL depois (secao 8-C), taxa que nao volta, e a
// conversa constrangedora que vem junto.
//
// Era teorico ate a Fase C, e o comentario que ficou na rota dizia exatamente
// isso ("hoje nenhuma cobranca chega a existir la"). Deixou de ser verdade em
// duas etapas: a cobranca do valor devido nasce logo apos a criacao da reserva
// (`charge.ts`), e a do saldo passou a nascer sob demanda em 28/08
// (`balance-charge.ts`).
// ============================================================================
//
// >>> O CANCELAMENTO E LOCAL E SOBERANO. O PROVEDOR NAO PODE VETA-LO. <<<
// Provedor fora do ar NAO IMPEDE o dono de cancelar: a vaga precisa ser
// liberada mesmo que o Asaas nao responda. Mesma postura da Fase D
// (`receive-in-cash.ts`), e pela mesma razao — a falha do provedor deixa um
// trabalho manual de trinta segundos no painel dele, enquanto a falha do
// cancelamento local deixa um horario travado que ninguem consegue vender.
//
// >>> TENTA TODAS AS COBRANCAS, INDEPENDENTEMENTE, E SO DEPOIS RELATA. <<<
// Uma reserva pode ter DUAS cobrancas vivas (sinal e saldo). Abortar na
// primeira falha deixaria a segunda pagavel sem nem ter sido tentada — e uma
// cobranca cancelada e estritamente melhor que zero.
//
// ============================================================================
// >>> ESTE E O PRIMEIRO ESCRITOR DE `reservation_payments.state = 'cancelled'`
// DO PROJETO INTEIRO. <<<
// O valor existia no enum e nos tipos desde a rev 6 e nunca havia sido
// produzido por nenhum caminho de codigo — as linhas nasciam 'pending' e
// ficavam 'pending' para sempre numa reserva cancelada. Mesma situacao em que
// `received_in_cash` estava antes da Fase D.
// ============================================================================

import { and, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { reservationPayments } from '../db/schema';
import {
  type ReservationStatus,
  type Transaction,
  setReservationStatus,
} from '../reservations';
import { asaasProvider } from './asaas';

/**
 * Uma cobranca que existia no provedor e precisa ser cancelada la.
 *
 * So entram linhas com `asaas_payment_id` — linha sem id nao tem o que cancelar
 * (o caso rotineiro e o `balance` que o dono nunca chegou a cobrar).
 */
type LiveCharge = {
  paymentId: string;
  chargeId: string;
};

export type CancelReservationResult = {
  reservationId: string;
  previousStatus: ReservationStatus;
  status: ReservationStatus;
  /** linhas de reservation_resources sincronizadas = vagas liberadas */
  resourceRowsUpdated: number;
  /** linhas de reservation_payments que sairam de 'pending' */
  paymentsCancelled: number;
  /** cobrancas que o provedor confirmou canceladas */
  providerCancelled: number;
  /**
   * Cobrancas que o provedor NAO cancelou. **A tela e obrigada a avisar em voz
   * alta quando isto for > 0**: elas continuam pagaveis, e o dono e o unico que
   * pode consertar, no painel do Asaas.
   */
  providerFailed: number;
};

/**
 * Cancela a reserva, libera as vagas e cancela no provedor TODA cobranca
 * pendente dela.
 *
 * A escrita local (status + vagas + linhas de pagamento) acontece numa UNICA
 * transacao; as chamadas ao provedor vem DEPOIS do commit.
 *
 * @throws {ReservationNotFoundError} inexistente, de outro tenant
 * @throws {InvalidReservationTransitionError} ja cancelada, ou expirada
 *
 * As duas vem de `setReservationStatus` e sobem intactas: a maquina de estados
 * mora la e este modulo nao a reimplementa (a rota traduz as duas em HTTP).
 */
export async function cancelReservationAndCharges(
  reservationId: string,
): Promise<CancelReservationResult> {
  // -- 1. escrita local, transacao unica -------------------------------------
  //
  // >>> A MESMA TRANSACAO DO setReservationStatus, DE PROPOSITO. <<<
  // Nao ha instante em que a reserva esteja cancelada e as linhas de pagamento
  // ainda digam 'pending' — e o mesmo cuidado que a secao 4.6 exige do par
  // reservations/reservation_resources, um nivel adiante. Como
  // `setReservationStatus` aceita `tx`, nada aqui fura a regra inviolavel de
  // que todo caminho de escrita de status passa por ela.
  const { status, live } = await db.transaction(async (tx) => {
    const status = await setReservationStatus(reservationId, 'cancelled', tx);
    const live = await cancelPendingPaymentRows(tx, reservationId);
    return { status, live };
  });

  // -- 2. provedor, DEPOIS do commit -----------------------------------------
  //
  // Fora da transacao pela regra de sempre: transacao aberta esperando API
  // externa segura travas de linha e pode esgotar o pool. E depois, nunca
  // antes, pelo mesmo argumento da Fase D — falhar aqui deixa a vaga
  // corretamente liberada e uma cobranca a cancelar a mao, enquanto a ordem
  // inversa poderia matar a cobranca de uma reserva que continuou de pe.
  const provider = await cancelAtProvider(reservationId, live.charges);

  return {
    reservationId,
    previousStatus: status.previousStatus,
    status: status.status,
    resourceRowsUpdated: status.resourceRowsUpdated,
    paymentsCancelled: live.rowsCancelled,
    ...provider,
  };
}

/**
 * Marca 'cancelled' TODA linha de pagamento que estava 'pending' e devolve as
 * que tinham cobranca no provedor.
 *
 * >>> O PREDICADO E `state = 'pending'`, E ELE E A REGRA INTEIRA. <<<
 * Nao ha ramificacao por `kind`, e nao deve haver. O que precisa ser cancelado
 * nao e "o saldo": e toda cobranca que o cliente ainda conseguiria pagar.
 * Ramificar por kind seria escrever a mesma regra de forma fragil, e ela ja
 * erra hoje — dependendo do estado, o que esta vivo e a cobranca do valor
 * integral, ou a do sinal, ou a do saldo, ou nenhuma:
 *
 *   pending_payment (full ou deposit) -> a cobranca do DEVIDO esta viva; a de
 *                                        saldo sequer existe (nasce sob demanda)
 *   confirmed + partial               -> o sinal esta PAGO e nao se toca; o
 *                                        saldo esta vivo SE o dono o cobrou
 *   confirmed + settled               -> nada vivo
 *
 * `state = 'pending'` cobre os tres sem enumera-los, e EXCLUI POR CONSTRUCAO o
 * que nao pode ser tocado:
 *
 *   'paid'     -> cobranca paga nunca e cancelada. A politica do tenant e NAO
 *                 DEVOLVER (secao 4-C) e estorno e manual (8-C); nao e o Asaas
 *                 recusando, e o sistema nao pedindo.
 *   'refunded' -> estorno/chargeback ja resolvido no provedor (secao 4-B.9).
 *
 * O filtro por tenant nao se repete aqui porque `setReservationStatus` ja o
 * aplicou, com FOR UPDATE, na mesma transacao: se aquela chamada passou, esta
 * reserva e deste tenant.
 *
 * >>> `charge_stage` NAO E TOCADO, e isso e deliberado. <<< Ele e vocabulario
 * de EXIBICAO escrito por `processCharge` a partir de uma LEITURA do provedor
 * (secao 4-B.9). Grava-lo aqui inventaria um estagio que nao lemos — e, quando
 * o cancelamento no provedor falhasse, afirmaria 'cancelado' sobre uma cobranca
 * que continua pagavel. Quem precisa saber que a linha morreu le `state`.
 */
async function cancelPendingPaymentRows(
  tx: Transaction,
  reservationId: string,
): Promise<{ rowsCancelled: number; charges: LiveCharge[] }> {
  const rows = await tx
    .update(reservationPayments)
    .set({ state: 'cancelled' })
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        eq(reservationPayments.state, 'pending'),
      ),
    )
    .returning({
      paymentId: reservationPayments.id,
      chargeId: reservationPayments.asaasPaymentId,
    });

  const charges: LiveCharge[] = rows
    .filter((row): row is { paymentId: string; chargeId: string } => row.chargeId !== null)
    .map(({ paymentId, chargeId }) => ({ paymentId, chargeId }));

  return { rowsCancelled: rows.length, charges };
}

/**
 * Cancela no provedor, uma a uma, sem deixar uma falha contaminar as outras.
 *
 * NUNCA relanca. O cancelamento local ja aconteceu e ja foi commitado quando
 * esta funcao roda; derrubar a operacao aqui faria o dono repetir um
 * cancelamento que ja teve efeito — e a segunda tentativa responderia 409, o
 * que se le como "deu errado" quando na verdade deu certo das duas vezes.
 *
 * >>> POR QUE NAO HA RETENTATIVA AUTOMATICA <<<
 * A opcao obvia seria deixar o job de reconciliacao tentar depois. Ela foi
 * descartada: `reconcilePayments` exclui reservas `cancelled` da varredura POR
 * DECISAO EXPLICITA (secao 8-B), justamente para nao consultar para sempre
 * cobranca de reserva que nao existe mais. Reintroduzi-las ali desfaria aquela
 * regra, e uma fila propria seria tabela + migration + cron para um evento raro
 * cujo conserto manual leva trinta segundos. O que substitui a retentativa e a
 * VISIBILIDADE: `providerFailed` sobe para a tela, que avisa o dono enquanto
 * ele ainda esta olhando para a reserva que acabou de cancelar.
 */
async function cancelAtProvider(
  reservationId: string,
  charges: readonly LiveCharge[],
): Promise<{ providerCancelled: number; providerFailed: number }> {
  let providerCancelled = 0;
  let providerFailed = 0;

  // Sequencial, nao em paralelo: sao no maximo duas cobrancas, e o Asaas ja
  // respondeu 400 a duas chamadas concorrentes sobre a mesma reserva (a medicao
  // da Fase C, secao 8-D). Nao ha ganho de latencia que justifique reencostar
  // naquele comportamento.
  for (const { paymentId, chargeId } of charges) {
    try {
      await asaasProvider.cancelCharge(chargeId);
      providerCancelled += 1;
    } catch (error) {
      providerFailed += 1;
      console.error(
        `[cancel-charges] reserva ${reservationId}: a reserva foi cancelada e a vaga liberada, ` +
          `mas a cobranca ${chargeId} (pagamento ${paymentId}) NAO foi cancelada no provedor. ` +
          'O cliente ainda consegue paga-la. Cancele no painel do Asaas.',
        error,
      );
    }
  }

  return { providerCancelled, providerFailed };
}
