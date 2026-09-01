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
import type { CreatePixChargeParams } from './provider';

/**
 * Bloco `payment` do 201 de POST /api/reservations (secao 7.1).
 *
 * UNIAO DISCRIMINADA por `method`, e nao um objeto com tudo opcional. Os dois
 * meios nao tem campo em comum nenhum — o Pix entrega um QR e um copia-e-cola, o
 * cartao entrega um endereco — e um tipo frouxo faria a tela ter de adivinhar,
 * em runtime, qual metade esta preenchida.
 */
export type ReservationPaymentBlock =
  | {
      method: 'pix';
      /** imagem do QR em base64, sem o prefixo `data:` */
      qrCodeBase64: string;
      copyPaste: string;
      /** ISO 8601 ou null — validade do QR, nao do hold da reserva */
      expiresAt: string | null;
    }
  | {
      method: 'card';
      /** fatura do provedor: e para la que a tela manda o cliente (secao 4-B.8) */
      invoiceUrl: string;
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
 * dia do passeio e tem caminho proprio, o botao "Cobrar saldo" do painel
 * (secao 7.2 e 8-D, `lib/payments/balance-charge.ts`).
 *
 * O MEIO sai de `reservation_payments.method`, que a criacao gravou a partir da
 * escolha do cliente: Pix devolve QR, cartao devolve a fatura do provedor.
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
      // O meio de pagamento e ESCOLHA DO CLIENTE, gravada na linha por
      // createReservation (secao 4-B.4). Lido daqui e nao da experiencia: a
      // experiencia diz o que e OFERECIDO, a linha diz o que foi COBRADO.
      method: reservationPayments.method,
      dueDate: reservationPayments.dueDate,
      externalReference: reservationPayments.externalReference,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      customerCpf: customers.cpf,
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
    const params: CreatePixChargeParams = {
      payer: {
        providerCustomerId: row.providerCustomerId,
        name: row.customerName,
        phone: row.customerPhone,
        email: row.customerEmail,
        // `customers.cpf` ja existe no schema e ja e aceito por
        // POST /api/reservations — o formulario publico e que nao o coleta.
        // Sem ele o Asaas recusa a COBRANCA (nao o cadastro): ver `taxId` em
        // provider.ts. Nenhum campo novo foi criado aqui.
        taxId: row.customerCpf,
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
    };

    // >>> UM `if`, DOIS CAMINHOS, E O RESTO IDENTICO. <<<
    // O que muda entre Pix e cartao e so o metodo do provedor e o que volta dele.
    // Cliente, valor, vencimento, referencia externa e descricao sao os mesmos —
    // e precisam ser, porque e a `external_reference` que reconcilia a cobranca
    // quando o id se perde (secao 4.6), independentemente do meio.
    if (row.method === 'card') {
      const charge = await asaasProvider.createCardCharge(params);

      await db
        .update(reservationPayments)
        .set({ asaasPaymentId: charge.chargeId, asaasInvoiceUrl: charge.invoiceUrl })
        .where(eq(reservationPayments.id, row.paymentId));

      return { method: 'card', invoiceUrl: charge.invoiceUrl };
    }

    const charge = await asaasProvider.createPixCharge(params);

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
