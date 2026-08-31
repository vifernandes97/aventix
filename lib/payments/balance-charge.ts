// Aventix — cobranca do SALDO sob demanda (CLAUDE.md secao 17, Fase C).
//
// ============================================================================
// >>> A EXIGENCIA QUE DEFINE ESTA FASE E A IDEMPOTENCIA <<<
// Quem aperta "Cobrar saldo" e o dono, no celular, em campo, com o cliente na
// frente esperando o QR. O duplo toque NAO e hipotese de laboratorio: e o caso
// normal de um botao que demora um segundo para responder numa tela de celular
// sob sol. Duas cobrancas para o mesmo saldo significam cliente podendo pagar
// duas vezes, e estorno de Pix e MANUAL (secao 8-C), com taxa que nao volta.
//
// A idempotencia aqui tem TRES camadas, e nenhuma delas e redundante — cada
// uma cobre um buraco que as outras nao alcancam:
//
//   1. CAMINHO RAPIDO LOCAL — a linha ja tem `asaas_payment_id`? Entao a
//      cobranca existe: so rele o QR. Cobre o caso comum (o primeiro toque
//      terminou antes do segundo chegar) sem tocar em trava nenhuma.
//
//   2. TRAVA DE SERIALIZACAO — `pg_try_advisory_xact_lock` na linha do
//      pagamento. Cobre os dois toques SIMULTANEOS, em que ambos leem
//      `asaas_payment_id` nulo antes de qualquer um gravar. E `try_`, nao
//      bloqueante, de proposito: o segundo pedido volta na hora com "ja tem uma
//      em andamento" em vez de empilhar conexao esperando.
//
//   3. PERGUNTA AO PROVEDOR — antes de criar, procura pela referencia externa.
//      Cobre o unico buraco que trava local NENHUMA alcanca: o processo morrer
//      (deploy do Easypanel, container reiniciado, conexao caida) DEPOIS de o
//      Asaas criar a cobranca e ANTES de gravarmos o id. Nesse estado a linha
//      esta com id nulo e a cobranca existe la; sem esta camada, a proxima
//      tentativa criaria a segunda, e essa e a duplicata que mais dificil de
//      perceber, porque nasce de um deploy e nao de um clique.
// ============================================================================
//
// >>> ESTE MODULO SEGURA A TRAVA DURANTE A CHAMADA AO PROVEDOR, E O CABECALHO
// DE charge.ts PROIBE ISSO. A DIFERENCA E DELIBERADA. <<<
// Aquela proibicao protege o caminho PUBLICO de venda: uma transacao aberta
// esperando API externa la segura o advisory lock DO TENANT (que serializa o
// tenant inteiro quando o modo exclusivo esta ligado) e pode esgotar o pool sob
// carga — um provedor lento derrubaria o site de vendas. Aqui nada disso vale:
// a trava e chaveada NA LINHA DO PAGAMENTO, entao ela bloqueia exatamente e
// somente os outros toques no mesmo botao, que e o que queremos bloquear; e o
// chamador e o admin de login unico, nao o publico. O custo real e uma conexao
// do pool presa por, no pior caso, dois timeouts de 10s. O QR e buscado DEPOIS
// do commit justamente para nao ser o terceiro.

import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { customers, experiences, reservationPayments, reservations } from '../db/schema';
import { type Transaction } from '../reservations';
import { getTenantId } from '../tenant';
import { todayLocalDate } from '../time';
import { asaasProvider } from './asaas';

/**
 * Espaco de nomes da trava, para deixar a intencao explicita no log do Postgres.
 *
 * NAO COLIDE com o `pg_advisory_xact_lock(tenant_id)` de `createReservation`,
 * e a garantia e do proprio Postgres: a forma de DOIS inteiros e a forma de UM
 * bigint ocupam espacos de trava distintos, ainda que os bits coincidam.
 */
const LOCK_NAMESPACE = 4211;

/** Resultado de uma cobranca de saldo criada, adotada ou reaproveitada. */
export type BalanceChargeResult = {
  paymentId: string;
  amountCents: number;
  qrCodeBase64: string;
  copyPaste: string;
  /** ISO 8601 ou null — validade do QR */
  expiresAt: string | null;
  invoiceUrl: string | null;
  /**
   * Como a cobranca chegou aqui. O dono nao ve isto, mas o log e os testes
   * veem, e e o que prova que o segundo toque nao criou nada.
   */
  origin: 'created' | 'reused' | 'adopted';
};

// -- erros tipados -----------------------------------------------------------
//
// A rota traduz cada um em HTTP. Erro de negocio NAO e string solta: a tela
// precisa distinguir "quitado" de "sem saldo" de "reserva cancelada" para dizer
// a coisa certa ao dono, que esta com o cliente na frente.

/** Reserva inexistente, id malformado ou de OUTRO tenant. Rota: 404. */
export class BalanceReservationNotFoundError extends Error {
  constructor(reservationId: string) {
    super(`reserva ${reservationId} nao encontrada`);
    this.name = 'BalanceReservationNotFoundError';
  }
}

/** Motivos pelos quais nao ha saldo a cobrar AGORA. Vira `code` no corpo. */
export type BalanceNotChargeableReason =
  /** reserva cancelada ou expirada — cobrar seria vender o que nao existe */
  | 'reserva_inativa'
  /** o pagamento devido (sinal/integral) ainda nao caiu; nao e hora do saldo */
  | 'sinal_pendente'
  /** modo `full`, ou sinal >= total: nunca houve linha de saldo */
  | 'sem_saldo'
  /** o saldo ja foi pago (online ou por fora) */
  | 'saldo_quitado';

export class BalanceNotChargeableError extends Error {
  readonly reason: BalanceNotChargeableReason;

  constructor(reason: BalanceNotChargeableReason, detail: string) {
    super(detail);
    this.name = 'BalanceNotChargeableError';
    this.reason = reason;
  }
}

/**
 * A cobranca EXISTE, mas o QR nao pode ser lido agora. Rota: 502.
 *
 * >>> ISTO NAO E "O PROVEDOR RECUSOU A COBRANCA". <<< A distincao foi paga
 * caro: MEDIDO em 31/08 contra o sandbox, duas leituras concorrentes do mesmo
 * QR fazem o Asaas responder 400 com "Um erro desconhecido foi encontrado".
 * Sem este tipo, aquilo subia como `PaymentProviderApiError` e a rota o
 * traduzia em "o provedor recusou a cobranca" — mensagem falsa em dois pontos
 * ao mesmo tempo: nada foi recusado, e a cobranca esta la, valida. O dono leria
 * "recusou", com o cliente na frente, e refaria uma cobranca que ja existe.
 *
 * Carrega o `invoiceUrl` porque ele e a saida imediata: a fatura do provedor
 * mostra o mesmo Pix e nao depende desta chamada.
 */
export class BalanceQrUnavailableError extends Error {
  readonly invoiceUrl: string | null;

  constructor(invoiceUrl: string | null, options?: { cause?: unknown }) {
    super('a cobranca do saldo existe, mas o QR nao pode ser lido agora', options);
    this.name = 'BalanceQrUnavailableError';
    this.invoiceUrl = invoiceUrl;
  }
}

/** Outro pedido esta criando a cobranca AGORA. Rota: 409. E o duplo toque. */
export class BalanceChargeInProgressError extends Error {
  constructor(reservationId: string) {
    super(`ja existe uma cobranca de saldo sendo criada para a reserva ${reservationId}`);
    this.name = 'BalanceChargeInProgressError';
  }
}

// -- leitura ------------------------------------------------------------------

type BalanceRow = {
  paymentId: string;
  chargeId: string | null;
  invoiceUrl: string | null;
  amountCents: number;
  dueDate: string;
  externalReference: string;
  paymentState: 'pending' | 'paid' | 'cancelled' | 'refunded';
  reservationStatus: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
  experienceName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerCpf: string | null;
  providerCustomerId: string | null;
};

/**
 * Linha de saldo da reserva, com o que a criacao da cobranca precisa.
 *
 * Filtra por tenant: reserva de outro tenant e indistinguivel de inexistente,
 * mesma regra da rota de detalhe (um 403 confirmaria o id a quem sonda).
 */
async function loadBalanceRow(reservationId: string): Promise<BalanceRow | null> {
  const tenantId = getTenantId();

  const [row] = await db
    .select({
      paymentId: reservationPayments.id,
      chargeId: reservationPayments.asaasPaymentId,
      invoiceUrl: reservationPayments.asaasInvoiceUrl,
      amountCents: reservationPayments.amountCents,
      dueDate: reservationPayments.dueDate,
      externalReference: reservationPayments.externalReference,
      paymentState: reservationPayments.state,
      reservationStatus: reservations.status,
      experienceName: experiences.name,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      customerCpf: customers.cpf,
      providerCustomerId: customers.asaasCustomerId,
    })
    .from(reservationPayments)
    .innerJoin(reservations, eq(reservations.id, reservationPayments.reservationId))
    .innerJoin(experiences, eq(experiences.id, reservations.experienceId))
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        eq(reservationPayments.kind, 'balance'),
        eq(reservations.tenantId, tenantId),
      ),
    );

  return (row as BalanceRow | undefined) ?? null;
}

/**
 * Estado do saldo para exibicao, SEM criar nada.
 *
 * Alimenta o GET da rota de saldo: o painel precisa saber se ha saldo, quanto,
 * e se ja existe cobranca — antes e independentemente de o dono apertar o
 * botao. Uma leitura que criasse cobranca seria uma cobranca nascida de abrir
 * uma tela.
 */
export async function getBalanceState(reservationId: string): Promise<{
  amountCents: number;
  state: 'pending' | 'paid' | 'cancelled' | 'refunded';
  /**
   * Id da cobranca no provedor, ou null.
   *
   * >>> NAO ATRAVESSA A BORDA HTTP. <<< E insumo interno (a rota o usa para
   * pedir o QR) e a mesma regra da rota publica de pagamento vale aqui: expor
   * o id da a quem tiver a resposta uma referencia utilizavel contra a conta do
   * tenant no provedor. O corpo carrega `hasCharge`, que e o que a tela precisa.
   */
  chargeId: string | null;
  invoiceUrl: string | null;
  chargeable: true | { reason: BalanceNotChargeableReason; detail: string };
} | null> {
  if (!isUuid(reservationId)) return null;

  const row = await loadBalanceRow(reservationId);
  if (!row) {
    // Sem linha de saldo: pode ser reserva inexistente OU reserva `full`. Quem
    // chama distingue, porque a rota ja carregou o detalhe.
    return null;
  }

  let chargeable: true | { reason: BalanceNotChargeableReason; detail: string } = true;
  try {
    assertChargeable(row);
  } catch (error) {
    if (error instanceof BalanceNotChargeableError) {
      chargeable = { reason: error.reason, detail: error.message };
    } else throw error;
  }

  return {
    amountCents: row.amountCents,
    state: row.paymentState,
    chargeId: row.chargeId,
    invoiceUrl: row.invoiceUrl,
    chargeable,
  };
}

// -- regras -------------------------------------------------------------------

/** Formato de uuid. Ver o mesmo comentario em lib/reservation-detail.ts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * As quatro razoes para nao cobrar o saldo agora. Ponto UNICO — o GET e o POST
 * chamam esta mesma funcao, e e o que impede a tela de oferecer um botao que a
 * rota vai recusar.
 */
function assertChargeable(row: BalanceRow): void {
  if (row.reservationStatus === 'cancelled' || row.reservationStatus === 'expired') {
    throw new BalanceNotChargeableError(
      'reserva_inativa',
      `a reserva esta ${row.reservationStatus === 'cancelled' ? 'cancelada' : 'expirada'}`,
    );
  }

  // Saldo pressupoe sinal pago: e a combinacao `confirmed` + `partial` da secao
  // 4-B.3. Reserva ainda `pending_payment` tem o SINAL em aberto, e o que o
  // cliente precisa pagar e aquele — o QR do sinal a tela publica ja oferece.
  // Cobrar o saldo aqui poria dois QR na mao do cliente, e o que ele pagasse
  // primeiro nao confirmaria a reserva.
  if (row.reservationStatus !== 'confirmed') {
    throw new BalanceNotChargeableError(
      'sinal_pendente',
      'a reserva ainda aguarda o pagamento do sinal; o saldo so e cobravel depois que ela confirma',
    );
  }

  if (row.paymentState === 'paid') {
    throw new BalanceNotChargeableError('saldo_quitado', 'o saldo desta reserva ja foi pago');
  }

  if (row.paymentState !== 'pending') {
    throw new BalanceNotChargeableError(
      'sem_saldo',
      `a linha de saldo esta ${row.paymentState} e nao e cobravel`,
    );
  }
}

/**
 * Vencimento a mandar ao provedor.
 *
 * A linha guarda a data do PASSEIO, que e quando o saldo passou a ser devido —
 * fato da venda, e por isso NAO e reescrita aqui. Mas o Asaas recusa cobranca
 * com vencimento no passado, e o dono pode estar cobrando um saldo atrasado.
 * Entao o provedor recebe `max(vencimento, hoje)` e a linha fica como esta:
 * mudar `due_date` reescreveria quando a divida nasceu.
 *
 * `todayLocalDate()` da o hoje de Sao Paulo, e e o certo: MEDIDO em 17/08 que o
 * Asaas opera no fuso de Brasilia (secao 18) — mandar data em UTC depois das
 * 21h faz o dia virar e a cobranca nascer vencida.
 */
function dueDateForProvider(rowDueDate: string): string {
  const today = todayLocalDate();
  return rowDueDate < today ? today : rowDueDate;
}

// -- trava --------------------------------------------------------------------

/**
 * Roda `fn` com a trava de saldo DESTA reserva tomada, dentro de uma transacao.
 *
 * `pg_try_advisory_xact_lock`, nao `pg_advisory_xact_lock`: NAO bloqueia
 * esperando. O segundo pedido volta na hora com `BalanceChargeInProgressError`,
 * porque quem esta do outro lado e um dono que ja apertou o botao de novo — uma
 * fila de conexoes esperando so adiaria o mesmo resultado gastando pool.
 *
 * A trava solta sozinha no commit ou no rollback, inclusive quando `fn` lanca.
 *
 * Ponto UNICO onde a trava e tomada. Duas copias desta chamada divergiriam
 * sobre qual espaco de nomes usar, e travas em espacos diferentes nao se veem —
 * o que produziria uma protecao que parece existir e nao existe.
 */
async function withBalanceLock<T>(
  paymentId: string,
  reservationId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, hashtext(${paymentId})) AS locked`,
    );

    if (!rows[0]?.locked) throw new BalanceChargeInProgressError(reservationId);

    return fn(tx);
  });
}

// -- escrita ------------------------------------------------------------------

/**
 * Cria (ou reaproveita) a cobranca Pix do saldo de uma reserva.
 *
 * IDEMPOTENTE por construcao — ver as tres camadas no cabecalho do arquivo.
 * Chamar duas, dez ou mil vezes produz UMA cobranca no provedor.
 *
 * @throws {BalanceReservationNotFoundError} reserva inexistente/outro tenant/id malformado
 * @throws {BalanceNotChargeableError} ha reserva, mas o saldo nao e cobravel agora
 * @throws {BalanceChargeInProgressError} outro pedido esta criando a cobranca neste instante
 * @throws {PaymentProviderConfigError|PaymentProviderAuthError|PaymentProviderNetworkError|PaymentProviderApiError}
 */
export async function chargeReservationBalance(
  reservationId: string,
): Promise<BalanceChargeResult> {
  if (!isUuid(reservationId)) throw new BalanceReservationNotFoundError(reservationId);

  const row = await loadBalanceRow(reservationId);
  if (!row) {
    // Nao da para distinguir daqui "reserva nao existe" de "reserva e `full`".
    // Quem chama (a rota) ja sabe qual dos dois, porque carrega o detalhe.
    throw new BalanceReservationNotFoundError(reservationId);
  }

  assertChargeable(row);

  // -- camada 1: caminho rapido ------------------------------------------
  // A cobranca ja existe: nada a criar, so reler o QR atual — que NUNCA e
  // persistido porque expira (secao 7.2).
  //
  // >>> MAS PASSA PELA MESMA TRAVA, e isso NAO e excesso de zelo. <<<
  // MEDIDO em 31/08 contra o sandbox: dois toques simultaneos caindo os dois
  // aqui disparam duas leituras concorrentes do mesmo QR, e o Asaas responde
  // 400 numa delas. Nenhuma cobranca e duplicada — o estrago e so a mensagem
  // de erro —, mas a mensagem chega ao dono em campo, com o cliente na frente.
  //
  // Com a trava aqui, a invariante do modulo fica mais simples de enunciar e de
  // confiar: UMA operacao de saldo em voo por reserva, sempre, criando ou
  // relendo. A alternativa (travar so a criacao) e mais barata e obriga quem
  // ler este arquivo depois a raciocinar sobre qual metade esta protegida.
  if (row.chargeId) {
    const chargeId = row.chargeId;
    const qr = await withBalanceLock(row.paymentId, reservationId, async () => {
      try {
        return await asaasProvider.getPixQrCode(chargeId);
      } catch (error) {
        throw new BalanceQrUnavailableError(row.invoiceUrl, { cause: error });
      }
    });

    return {
      paymentId: row.paymentId,
      amountCents: row.amountCents,
      ...qr,
      invoiceUrl: row.invoiceUrl,
      origin: 'reused',
    };
  }

  // -- camadas 2 e 3: criar sob trava ------------------------------------
  const created = await withBalanceLock(row.paymentId, reservationId, async (tx) => {
    // Rele DENTRO da trava. O pedido que a segurava antes pode ter acabado de
    // gravar o id — nesse caso nao ha nada a criar, e sair por aqui evita a
    // consulta ao provedor da camada 3.
    const [fresh] = await tx
      .select({
        chargeId: reservationPayments.asaasPaymentId,
        invoiceUrl: reservationPayments.asaasInvoiceUrl,
      })
      .from(reservationPayments)
      .where(eq(reservationPayments.id, row.paymentId));

    if (fresh?.chargeId) {
      return { chargeId: fresh.chargeId, invoiceUrl: fresh.invoiceUrl, origin: 'reused' as const };
    }

    // -- camada 3: o provedor ja tem esta cobranca? ----------------------
    // >>> FALHA AQUI E FAIL-CLOSED: NAO CRIA. <<<
    // Se a pergunta nao pode ser feita (rede, credencial), nao da para saber se
    // ja existe cobranca — e criar assumindo que nao existe e exatamente o
    // risco que esta camada foi posta para eliminar. Das duas falhas possiveis,
    // "o dono tenta de novo em dez segundos" custa muito menos que "o cliente
    // recebe dois QR e paga os dois". O erro do provedor sobe como esta e a
    // rota o traduz.
    const existing = await asaasProvider.findChargeByExternalReference(row.externalReference);

    if (existing) {
      // A cobranca nasceu numa tentativa anterior que morreu antes de gravar o
      // id. Adota em vez de criar a segunda.
      console.warn(
        `[balance-charge] cobranca ${existing.chargeId} ja existia no provedor para ` +
          `${row.externalReference} sem id gravado; adotando em vez de criar outra`,
      );
      await tx
        .update(reservationPayments)
        .set({ asaasPaymentId: existing.chargeId })
        .where(eq(reservationPayments.id, row.paymentId));

      return { chargeId: existing.chargeId, invoiceUrl: null, origin: 'adopted' as const };
    }

    const charge = await asaasProvider.createPixCharge({
      payer: {
        providerCustomerId: row.providerCustomerId,
        name: row.customerName,
        phone: row.customerPhone,
        email: row.customerEmail,
        taxId: row.customerCpf,
        externalReference: row.customerId,
        onProviderCustomerCreated: async (providerCustomerId) => {
          // Mesma razao de charge.ts: grava o id do cliente no instante em que
          // ele passa a existir. Aqui e quase teorico — quem tem saldo ja pagou
          // o sinal, entao o cliente ja existe no provedor —, mas "quase" nao e
          // criterio para deixar um vazamento de cliente orfao no caminho.
          //
          // >>> `db`, NAO `tx`, e a diferenca importa. <<< Se a criacao da
          // cobranca falhar logo abaixo, a transacao inteira volta atras — e
          // com `tx` o id do cliente voltaria junto, apagando o registro de um
          // cliente que EXISTE de verdade no provedor. A proxima tentativa
          // criaria outro, e cada falha deixaria mais um orfao na conta do
          // tenant. Conexao separada e o que faz este registro sobreviver ao
          // rollback, que e exatamente o ponto do gancho.
          await db
            .update(customers)
            .set({ asaasCustomerId: providerCustomerId })
            .where(eq(customers.id, row.customerId));
        },
      },
      amountCents: row.amountCents,
      dueDate: dueDateForProvider(row.dueDate),
      externalReference: row.externalReference,
      description: `${row.experienceName} — saldo da reserva ${reservationId.slice(0, 8)}`,
    });

    await tx
      .update(reservationPayments)
      .set({ asaasPaymentId: charge.chargeId, asaasInvoiceUrl: charge.invoiceUrl })
      .where(eq(reservationPayments.id, row.paymentId));

    return {
      chargeId: charge.chargeId,
      invoiceUrl: charge.invoiceUrl,
      origin: 'created' as const,
      qr: { qrCodeBase64: charge.qrCodeBase64, copyPaste: charge.copyPaste, expiresAt: charge.expiresAt },
    };
  });

  // O QR da criacao ja veio junto; nos outros caminhos e uma chamada a mais,
  // feita DEPOIS do commit para nao segurar a trava durante ela.
  const qr =
    'qr' in created && created.qr
      ? created.qr
      : await asaasProvider.getPixQrCode(created.chargeId);

  return {
    paymentId: row.paymentId,
    amountCents: row.amountCents,
    ...qr,
    invoiceUrl: created.invoiceUrl,
    origin: created.origin,
  };
}
