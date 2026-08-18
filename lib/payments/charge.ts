// Aventix — criacao da cobranca de uma reserva recem-criada.
//
// Este e o passo 5 da secao 5.2: "FORA da transacao, cria as cobrancas no Asaas
// e grava os asaas_payment_id. Se a criacao da cobranca falhar, a reserva e
// marcada `expired` e a vaga liberada".
//
// >>> POR QUE FORA DA TRANSACAO, E POR QUE FORA DE createReservation <<<
// Transacao aberta esperando API externa segura travas de linha (inclusive o
// advisory lock do tenant, quando o modo exclusivo esta ligado) e pode esgotar o
// pool de conexoes sob carga — um provedor lento derrubaria o site inteiro, nao
// so o pagamento. Por isso `createReservation` commita e SO DEPOIS esta funcao
// roda, num caminho separado.
//
// Consequencia assumida: quem chama `createReservation` direto (a suite de
// testes, e um dia uma reserva lancada pelo dono no painel) NAO cria cobranca.
// Isso e proposital — mantem a suite hermetica, sem rede — e e a rota publica
// POST /api/reservations que costura os dois passos.

import { and, eq, ne } from 'drizzle-orm';

import { db } from '../db/client';
import { customers, experiences, reservationPayments, reservations } from '../db/schema';
import { setReservationStatus } from '../reservations';
import { asaasProvider } from './asaas';

/** Bloco `payment` do 201 de POST /api/reservations (secao 7.1). */
export type ReservationPaymentBlock = {
  method: 'pix';
  /** imagem do QR em base64, sem o prefixo `data:` */
  qrCodeBase64: string;
  copyPaste: string;
  /** ISO 8601 ou null — validade do QR, nao do hold da reserva */
  expiresAt: string | null;
};

/** Nao ha linha de cobranca "a pagar agora" para a reserva — reserva corrompida. */
export class ChargeableNotFoundError extends Error {
  constructor(reservationId: string) {
    super(`reserva ${reservationId} nao tem cobranca a pagar agora`);
    this.name = 'ChargeableNotFoundError';
  }
}

/**
 * Cria no provedor a cobranca DEVIDA AGORA da reserva e grava os ids.
 *
 * "Devida agora" = a linha `full` (modo full) ou `deposit` (modo deposit) —
 * `ne(kind, 'balance')`. A linha de `balance` NAO e cobrada aqui: ela vence no
 * dia do passeio e tem caminho proprio (secao 7.2, `GET .../balance`), fora
 * deste MVP. Como o CRUD de experiencias so aceita `payment_mode='full'`, hoje
 * nao existe reserva com linha de balance.
 *
 * @throws {ChargeableNotFoundError} reserva sem linha cobravel.
 * @throws {PaymentProviderConfigError|PaymentProviderAuthError|PaymentProviderNetworkError|PaymentProviderApiError}
 *         qualquer falha do provedor — a reserva JA foi expirada quando o erro sobe.
 */
export async function createChargeForReservation(
  reservationId: string,
): Promise<ReservationPaymentBlock> {
  const [row] = await db
    .select({
      paymentId: reservationPayments.id,
      amountCents: reservationPayments.amountCents,
      dueDate: reservationPayments.dueDate,
      externalReference: reservationPayments.externalReference,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      providerCustomerId: customers.asaasCustomerId,
      experienceName: experiences.name,
    })
    .from(reservationPayments)
    .innerJoin(reservations, eq(reservations.id, reservationPayments.reservationId))
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .innerJoin(experiences, eq(experiences.id, reservations.experienceId))
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        ne(reservationPayments.kind, 'balance'),
      ),
    );

  if (!row) throw new ChargeableNotFoundError(reservationId);

  try {
    const charge = await asaasProvider.createPixCharge({
      payer: {
        providerCustomerId: row.providerCustomerId,
        name: row.customerName,
        phone: row.customerPhone,
        email: row.customerEmail,
        // Referencia cruzada: o cliente do provedor aponta para o nosso.
        externalReference: row.customerId,

        // Grava o id do cliente do provedor NO INSTANTE em que ele passa a
        // existir, nao no fim do fluxo. Se a cobranca falhar logo abaixo, este
        // id continua valido e a proxima tentativa o reaproveita — sem isso,
        // cada falha deixaria um cliente orfao a mais na conta do tenant.
        onProviderCustomerCreated: async (providerCustomerId) => {
          await db
            .update(customers)
            .set({ asaasCustomerId: providerCustomerId })
            .where(eq(customers.id, row.customerId));
        },
      },
      amountCents: row.amountCents,
      dueDate: row.dueDate,
      externalReference: row.externalReference,
      description: `${row.experienceName} — reserva ${reservationId.slice(0, 8)}`,
    });

    await db
      .update(reservationPayments)
      .set({ asaasPaymentId: charge.chargeId, asaasInvoiceUrl: charge.invoiceUrl })
      .where(eq(reservationPayments.id, row.paymentId));

    return {
      method: 'pix',
      qrCodeBase64: charge.qrCodeBase64,
      copyPaste: charge.copyPaste,
      expiresAt: charge.expiresAt,
    };
  } catch (error) {
    // Caso de borda 9: reserva sem cobranca nao pode ficar de pe segurando
    // vaga. Expira e libera o horario para quem quiser comprar.
    //
    // setReservationStatus e o UNICO caminho de escrita de status (regra
    // inviolavel da secao 4.6) — nada de UPDATE direto aqui, mesmo sendo um
    // caminho de excecao: e justamente no caminho de excecao que a
    // dessincronizacao entre reservations e reservation_resources passaria
    // despercebida.
    try {
      await setReservationStatus(reservationId, 'expired');
    } catch (rollbackError) {
      // A falha do provedor e a que interessa ao chamador; esta so precisa ser
      // vista pelo dono, porque significa vaga travada ate o cron passar.
      console.error(
        `[payments] reserva ${reservationId}: falha ao expirar apos erro de cobranca`,
        rollbackError,
      );
    }

    throw error;
  }
}
