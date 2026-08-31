// Aventix — detalhe de UMA reserva para o painel do admin (CLAUDE.md secao 11.1).
//
// MODULO DE LEITURA. Nada aqui escreve. O cancelamento passa por
// setReservationStatus (lib/reservations.ts), que e a unica porta de escrita de
// status (secao 4.6) — a rota chama aquela funcao, nunca este arquivo.
//
// POR QUE NAO VIVE EM lib/calendar.ts: aquele modulo tem um contrato especifico
// — UMA query para o PERIODO inteiro, com o minimo por reserva (secao 11.1). Um
// detalhe completo por reserva la dentro convidaria alguem a chama-lo em loop,
// que e exatamente o N+1 que a secao 11.1 proibe. Aqui a unidade e outra: UMA
// reserva, sob demanda, quando o dono clica.
//
// >>> DADOS SENSIVEIS <<<
// Este e o unico modulo do projeto que devolve CPF, numero de documento E
// contato de emergencia (nome + telefone de terceiro) juntos.
// Duas regras que acompanham qualquer mudanca aqui:
//   1. o retorno vai no CORPO da resposta, nunca em query string ou URL;
//   2. nada deste retorno entra em log — nem em erro, nem em debug.
// A agenda compartilhada (secao 11.2) NAO usa este modulo e nunca deve usar.

import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from './db/client';
import { getTenantId } from './tenant';

// ============================================================================
// Tipos
// ============================================================================

/** Todos os status, nao so os ativos: o painel abre para reserva cancelada tambem. */
export type ReservationDetailStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';

export type DetailResource = { id: number; name: string };

export type DetailParticipant = {
  id: string;
  name: string;
  role: 'operator' | 'passenger';
  /** Documento do operador (CNH no Quadri Club). SENSIVEL — ver cabecalho. */
  documentNumber: string | null;
  /** Coluna `date`: sai 'YYYY-MM-DD' e NAO passa por new Date() (secao 3). */
  birthdate: string | null;
};

export type DetailPayment = {
  id: string;
  kind: 'full' | 'deposit' | 'balance';
  state: 'pending' | 'paid' | 'cancelled' | 'refunded';
  amountCents: number;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  /** ISO 8601 ou null */
  paidAt: string | null;
  receivedInCash: boolean;

  /**
   * Registro da maquininha (Fase D), CONGELADO no instante do recebimento
   * (secao 4-B.7). Estes campos sao LIDOS, nunca recalculados: a taxa vigente
   * hoje nao tem nada a dizer sobre um recebimento de setembro.
   *
   * Todos `null` em pagamento que nao passou pela maquininha. E
   * `netCents: null` COM `cardMachineModality` preenchida significa "a taxa
   * nao estava configurada no registro" — nao significa zero (secao 4-B.6).
   */
  cardMachineModality: 'debit' | 'credit' | 'credit_installment' | null;
  rateBasisPointsApplied: number | null;
  netCents: number | null;
  /** Quem DECLAROU o recebimento, e quando. Ver o cabecalho de receive-in-cash. */
  registeredBy: string | null;
  registeredAt: string | null;
};

export type ReservationDetail = {
  id: string;
  status: ReservationDetailStatus;
  /** ISO 8601 (secao 3) */
  startAt: string;
  /** ISO. start + duracao: o fim que o cliente enxerga, SEM buffer (secao 4.6). */
  endAt: string;
  durationMinutes: number;
  bufferMinutes: number;
  resourcesNeeded: number;
  totalPriceCents: number;
  /** ISO ou null. So faz sentido enquanto pending_payment. */
  holdExpiresAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  /** Origem da venda: null = direto; ex. 'aventurando' (secao 4.4). */
  channel: string | null;

  experience: { id: number; name: string };
  resources: DetailResource[];

  /**
   * Cliente COMPLETO — inclui CPF. E acesso do dono, atras do login, aos
   * proprios clientes. Nao confundir com o `customerName` do calendario
   * (secao 11.1) nem com a agenda compartilhada, que nao expoe nada disso.
   */
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    /** SENSIVEL — ver cabecalho. */
    cpf: string | null;
    birthdate: string | null;
  };

  participants: DetailParticipant[];

  /**
   * Quem acionar em caso de necessidade durante o passeio (passo 5 do
   * formulario publico). NULL nos dois campos junto: reserva anterior a esta
   * funcionalidade nunca capturou o dado (secao 4.6 — coluna nullable de
   * proposito). SENSIVEL — ver cabecalho.
   */
  emergencyContact: { name: string | null; phone: string | null };

  /**
   * Estado financeiro. Ate a Fase 2 existir, nenhuma cobranca e criada no Asaas
   * e `paymentState` fica 'pending' em TODA reserva, inclusive nas confirmadas.
   * As linhas de reservation_payments ja existem desde a criacao (secao 5.2
   * passo 3) — o que falta e alguem marca-las como pagas.
   */
  payment: {
    mode: 'full' | 'deposit';
    state: 'pending' | 'partial' | 'settled';
    amountPaidCents: number;
    /** max(0, total - pago). Nunca negativo. */
    balanceCents: number;
    rows: DetailPayment[];
  };
};

// ============================================================================
// Leitura
// ============================================================================

type Row = {
  id: string;
  status: ReservationDetailStatus;
  start_at: string;
  duration_minutes: number;
  buffer_minutes: number;
  resources_needed: number;
  total_price_cents: number;
  hold_expires_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  channel: string | null;
  payment_mode: 'full' | 'deposit';
  payment_state: 'pending' | 'partial' | 'settled';
  amount_paid_cents: number;
  experience_id: number;
  experience_name: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_cpf: string | null;
  customer_birthdate: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  resources: DetailResource[];
  participants: DetailParticipant[];
  payments: (Omit<DetailPayment, 'paidAt' | 'registeredAt'> & {
    paidAt: string | null;
    registeredAt: string | null;
  })[];
};

/**
 * Formato aceito de id. O painel monta a URL a partir do id que o proprio
 * calendario entregou, mas a rota e publica no sentido de que qualquer string
 * pode chegar nela — e `WHERE id = 'abc'` numa coluna uuid nao devolve zero
 * linhas: o Postgres ABORTA com 22P02 e a rota viraria 500. A checagem barata
 * aqui transforma isso em "nao encontrado".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReservationId(value: string): boolean {
  return UUID.test(value);
}

/**
 * Detalhe completo de uma reserva do tenant atual.
 *
 * @returns `null` quando a reserva nao existe OU pertence a outro tenant. Os
 *          dois casos sao deliberadamente indistinguiveis: a rota responde 404
 *          para ambos, e um 403 no segundo caso confirmaria a existencia do id
 *          para quem esta sondando.
 *
 * UMA query. Os tres conjuntos (recursos, participantes, pagamentos) vem em
 * subconsultas escalares agregadas pelo proprio Postgres, e nao por JOIN direto:
 * tres JOINs um-para-muitos no mesmo SELECT se multiplicariam entre si
 * (2 recursos x 3 participantes x 2 pagamentos = 12 linhas para uma reserva),
 * e o GROUP BY depois disso contaria valores repetidos.
 */
export async function getReservationDetail(reservationId: string): Promise<ReservationDetail | null> {
  if (!isReservationId(reservationId)) return null;

  const tenantId = getTenantId();

  const { rows } = await db.execute<Row>(sql`
    SELECT
      r.id::text                AS id,
      r.status::text            AS status,
      r.start_at                AS start_at,
      -- DA RESERVA, nunca da experiencia: snapshot da venda (ver lib/db/schema.ts).
      r.duration_minutes        AS duration_minutes,
      r.buffer_minutes          AS buffer_minutes,
      r.resources_needed        AS resources_needed,
      r.total_price_cents       AS total_price_cents,
      r.hold_expires_at         AS hold_expires_at,
      r.created_at              AS created_at,
      r.confirmed_at            AS confirmed_at,
      r.cancelled_at            AS cancelled_at,
      r.channel                 AS channel,
      r.payment_mode::text      AS payment_mode,
      r.payment_state::text     AS payment_state,
      r.amount_paid_cents       AS amount_paid_cents,
      e.id                      AS experience_id,
      e.name                    AS experience_name,
      c.id::text                AS customer_id,
      c.name                    AS customer_name,
      c.phone                   AS customer_phone,
      c.email                   AS customer_email,
      c.cpf                     AS customer_cpf,
      c.birthdate::text         AS customer_birthdate,
      r.emergency_contact_name  AS emergency_contact_name,
      r.emergency_contact_phone AS emergency_contact_phone,

      (
        SELECT coalesce(
          json_agg(json_build_object('id', res.id, 'name', res.name) ORDER BY res.id),
          '[]'::json
        )
        FROM reservation_resources rr
        JOIN resources res ON res.id = rr.resource_id
        WHERE rr.reservation_id = r.id
      ) AS resources,

      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'id', p.id::text,
              'name', p.name,
              'role', p.role::text,
              'documentNumber', p.document_number,
              'birthdate', p.birthdate::text
            )
            -- role e enum ('operator','passenger'): a ordem do TIPO ja poe os
            -- operadores primeiro, que e a leitura util no dia (quem dirige, e
            -- de quem se confere o documento).
            ORDER BY p.role, p.name
          ),
          '[]'::json
        )
        FROM participants p
        WHERE p.reservation_id = r.id
      ) AS participants,

      (
        SELECT coalesce(
          json_agg(
            json_build_object(
              'id', rp.id::text,
              'kind', rp.kind::text,
              'state', rp.state::text,
              'amountCents', rp.amount_cents,
              'dueDate', rp.due_date::text,
              'paidAt', rp.paid_at,
              'receivedInCash', rp.received_in_cash,
              'cardMachineModality', rp.card_machine_modality::text,
              'rateBasisPointsApplied', rp.rate_basis_points_applied,
              'netCents', rp.net_cents,
              'registeredBy', rp.registered_by,
              'registeredAt', rp.registered_at
            )
            -- enum payment_kind: full, deposit, balance — sinal antes do saldo.
            ORDER BY rp.kind, rp.created_at
          ),
          '[]'::json
        )
        FROM reservation_payments rp
        WHERE rp.reservation_id = r.id
      ) AS payments

    FROM reservations r
    JOIN experiences e ON e.id = r.experience_id
    JOIN customers   c ON c.id = r.customer_id
    WHERE r.id = ${reservationId}::uuid
      AND r.tenant_id = ${tenantId}
  `);

  const row = rows[0];
  if (!row) return null;

  // O driver devolve o TEXTO CRU do Postgres para timestamptz (mode:'string').
  // Toda saida de lib/ para a API vai em ISO 8601 (secao 3) — o V8 tolera o
  // formato cru, outros motores devolvem NaN e o sintoma so aparece no
  // navegador do cliente. Colunas `date` (birthdate, due_date) ja saem
  // 'YYYY-MM-DD' e NAO passam por new Date().
  const iso = (value: string | null): string | null =>
    value === null ? null : new Date(value).toISOString();

  const startMs = new Date(row.start_at).getTime();

  return {
    id: row.id,
    status: row.status,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + row.duration_minutes * 60_000).toISOString(),
    durationMinutes: row.duration_minutes,
    bufferMinutes: row.buffer_minutes,
    resourcesNeeded: row.resources_needed,
    totalPriceCents: row.total_price_cents,
    holdExpiresAt: iso(row.hold_expires_at),
    createdAt: iso(row.created_at)!,
    confirmedAt: iso(row.confirmed_at),
    cancelledAt: iso(row.cancelled_at),
    channel: row.channel,
    experience: { id: row.experience_id, name: row.experience_name },
    resources: row.resources,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
      cpf: row.customer_cpf,
      birthdate: row.customer_birthdate,
    },
    participants: row.participants,
    emergencyContact: {
      name: row.emergency_contact_name,
      phone: row.emergency_contact_phone,
    },
    payment: {
      mode: row.payment_mode,
      state: row.payment_state,
      amountPaidCents: row.amount_paid_cents,
      balanceCents: Math.max(0, row.total_price_cents - row.amount_paid_cents),
      rows: row.payments.map((p) => ({
      ...p,
      paidAt: iso(p.paidAt),
      registeredAt: iso(p.registeredAt),
    })),
    },
  };
}
