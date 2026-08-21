// Aventix — estado PUBLICO de uma reserva, para a tela de acompanhamento
// (CLAUDE.md secoes 7.1 e 14: /reserva/[id] + GET /api/reservations/{id}/status).
//
// MODULO DE LEITURA. Nada aqui escreve. Confirmar reserva e trabalho do webhook
// e da reconciliacao, sempre via setReservationStatus (secao 4.6).
//
// ============================================================================
// >>> POR QUE NAO REUSA lib/reservation-detail.ts <<<
// Aquele modulo e a visao do DONO, atras de sessao, e devolve de proposito CPF,
// numero de documento e contato de emergencia. Esta visao e do CLIENTE, sem
// sessao nenhuma: a credencial e o uuid da propria URL, que circula por
// WhatsApp, historico de navegador e print de tela.
//
// Chamar getReservationDetail aqui e filtrar campos depois seria a mesma coisa
// "com um passo a mais" — e o passo a mais e exatamente onde o vazamento nasce:
// um campo novo la dentro (o proximo `customer.*`) entraria neste payload
// sozinho, sem ninguem editar este arquivo. Por isso a query e OUTRA, escrita
// estreita, e nao um recorte da query do admin.
//
// >>> A LISTA DO QUE NUNCA PODE SAIR DAQUI <<<
// nome do cliente, telefone, e-mail, CPF, nome/documento de participante,
// contato de emergencia. Nenhum deles esta no SELECT abaixo, e e assim que a
// regra se sustenta: nao ha o que filtrar porque nao ha o que buscar.
// O teste `tests/j-status-reserva.test.ts` reafirma isso contra o payload real.
// ============================================================================

import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from './db/client';
import { isReservationId } from './reservation-detail';
import { getTenantId } from './tenant';

// ============================================================================
// Tipos
// ============================================================================

export type PublicReservationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';

/** Estado do pagamento DEVIDO (o `full` ou o `deposit`), nao do saldo. */
export type DuePaymentState = 'pending' | 'paid' | 'cancelled' | 'refunded';

export type PublicReservationView = {
  status: PublicReservationStatus;
  /**
   * Estado da cobranca que DECIDE a reserva: `full` no modo integral, `deposit`
   * no modo sinal. O `balance` (saldo do dia) tem ciclo proprio e NUNCA muda o
   * status da reserva (secao 5.3) — por isso nao entra aqui.
   *
   * `null` so no caso degenerado de reserva sem linha de pagamento devida, que
   * a criacao nao produz (secao 5.2 passo 3). Tipado assim para a tela nao
   * quebrar se um dia produzir.
   */
  paymentState: DuePaymentState | null;
  amountPaidCents: number;
  /** max(0, total - pago). Nunca negativo. */
  balanceCents: number;
  /** ISO 8601 ou null. So faz sentido enquanto pending_payment. */
  holdExpiresAt: string | null;
  /**
   * AGORA segundo o BANCO, em ISO 8601.
   *
   * Existe porque o relogio do celular do cliente pode estar errado — e num
   * aparelho adiantado a contagem regressiva marcaria "expirada" com a reserva
   * viva, ou o contrario. A tela calcula o tempo restante pela DIFERENCA entre
   * holdExpiresAt e este campo, nunca por Date.now() local.
   */
  serverNow: string;
  experienceName: string;
  /** ISO 8601 (secao 3) */
  startAt: string;
  /** Snapshot da venda, da RESERVA e nao da experiencia (secao 4.6). */
  durationMinutes: number;
};

/**
 * A cobranca devida, para a rota que busca o QR no provedor. NAO e payload de
 * resposta: e insumo interno, e o `chargeId` nunca chega ao navegador.
 */
export type DueCharge = {
  reservationStatus: PublicReservationStatus;
  /** id da cobranca no provedor; `null` se a criacao falhou ou nao aconteceu. */
  chargeId: string | null;
  state: DuePaymentState;
  amountCents: number;
};

// ============================================================================
// Leitura
// ============================================================================

/**
 * Subconsulta da cobranca DEVIDA. `kind IN ('full','deposit')` cobre os dois
 * modos de venda com uma expressao so: uma reserva tem um ou outro, nunca os
 * dois (secao 5.2 passo 3). O `balance` fica de fora de proposito.
 */
const DUE_PAYMENT = sql`
  SELECT rp.id, rp.state, rp.amount_cents, rp.asaas_payment_id
  FROM reservation_payments rp
  WHERE rp.reservation_id = r.id
    AND rp.kind IN ('full', 'deposit')
  ORDER BY rp.created_at
  LIMIT 1
`;

type StatusRow = {
  status: PublicReservationStatus;
  payment_state: DuePaymentState | null;
  amount_paid_cents: number;
  total_price_cents: number;
  hold_expires_at: string | null;
  server_now: string;
  experience_name: string;
  start_at: string;
  duration_minutes: number;
};

/**
 * Estado publico da reserva do tenant atual.
 *
 * @returns `null` quando a reserva nao existe, tem id malformado OU pertence a
 *          outro tenant. Os tres casos sao deliberadamente indistinguiveis: a
 *          rota responde 404 para todos. Um 403 no caso do outro tenant
 *          confirmaria a existencia do id para quem esta sondando, e um id fora
 *          do formato uuid ABORTA a query com 22P02 (viraria 500) se nao fosse
 *          barrado antes — por isso `isReservationId` vem primeiro.
 *
 * SEM CHAMADA AO PROVEDOR DE PAGAMENTO, nem aqui nem na rota. E o alvo de um
 * polling publico: consultar o Asaas a cada 4 segundos por aba aberta seria
 * abuso de servico de terceiro em cima de uma rota que qualquer um alcanca. O
 * banco ja e a fonte da verdade do estado da reserva (secao 2), o webhook o
 * mantem em dia e o job de reconciliacao de 10 min e a rede de seguranca (8-B).
 */
export async function getPublicReservationStatus(
  reservationId: string,
): Promise<PublicReservationView | null> {
  if (!isReservationId(reservationId)) return null;

  const tenantId = getTenantId();

  const { rows } = await db.execute<StatusRow>(sql`
    SELECT
      r.status::text          AS status,
      (SELECT d.state::text FROM (${DUE_PAYMENT}) d) AS payment_state,
      r.amount_paid_cents     AS amount_paid_cents,
      r.total_price_cents     AS total_price_cents,
      r.hold_expires_at       AS hold_expires_at,
      now()                   AS server_now,
      e.name                  AS experience_name,
      r.start_at              AS start_at,
      -- DA RESERVA, nunca da experiencia: snapshot da venda (secao 4.6). Uma
      -- edicao de catalogo nao pode redesenhar o comprovante de quem ja comprou.
      r.duration_minutes      AS duration_minutes
    FROM reservations r
    JOIN experiences e ON e.id = r.experience_id
    WHERE r.id = ${reservationId}::uuid
      AND r.tenant_id = ${tenantId}
  `);

  const row = rows[0];
  if (!row) return null;

  // O driver devolve o TEXTO CRU do Postgres para timestamptz (mode:'string').
  // Toda saida de lib/ para a API vai em ISO 8601 (secao 3): o V8 tolera o
  // formato cru, outros motores devolvem NaN, e o sintoma so apareceria no
  // navegador do cliente — que aqui e justamente quem consome.
  const iso = (value: string | null): string | null =>
    value === null ? null : new Date(value).toISOString();

  return {
    status: row.status,
    paymentState: row.payment_state,
    amountPaidCents: row.amount_paid_cents,
    balanceCents: Math.max(0, row.total_price_cents - row.amount_paid_cents),
    holdExpiresAt: iso(row.hold_expires_at),
    serverNow: iso(row.server_now)!,
    experienceName: row.experience_name,
    startAt: iso(row.start_at)!,
    durationMinutes: row.duration_minutes,
  };
}

type DueChargeRow = {
  reservation_status: PublicReservationStatus;
  asaas_payment_id: string | null;
  state: DuePaymentState;
  amount_cents: number;
};

/**
 * A cobranca devida de uma reserva, para GET /api/reservations/{id}/payment.
 *
 * Devolve o status da RESERVA junto de proposito: a rota precisa dos dois para
 * decidir entre 404 (nao existe), 409 (existe mas nao esta mais pendente) e
 * 200, e busca-los separadamente abriria uma janela entre as duas leituras.
 *
 * @returns `null` nas mesmas tres condicoes de getPublicReservationStatus, e
 *          tambem quando a reserva nao tem cobranca devida registrada.
 */
export async function getDueCharge(reservationId: string): Promise<DueCharge | null> {
  if (!isReservationId(reservationId)) return null;

  const tenantId = getTenantId();

  const { rows } = await db.execute<DueChargeRow>(sql`
    SELECT
      r.status::text  AS reservation_status,
      d.asaas_payment_id,
      d.state::text   AS state,
      d.amount_cents  AS amount_cents
    FROM reservations r
    JOIN LATERAL (${DUE_PAYMENT}) d ON true
    WHERE r.id = ${reservationId}::uuid
      AND r.tenant_id = ${tenantId}
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    reservationStatus: row.reservation_status,
    chargeId: row.asaas_payment_id,
    state: row.state,
    amountCents: row.amount_cents,
  };
}
