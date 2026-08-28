// Aventix — lista CONSULTAVEL de reservas para o admin (tela /admin/agendamentos).
//
// POR QUE ESTE MODULO EXISTE, separado de lib/calendar.ts e de
// lib/reservation-detail.ts:
//   - lib/calendar.ts responde "o que ocupa a grade deste PERIODO": so reservas
//     ATIVAS (pending_payment/confirmed), presas a uma janela [from,to], sem
//     telefone. Nao serve para procurar uma reserva pelo nome de quem ligou.
//   - lib/reservation-detail.ts responde "TUDO sobre UMA reserva", incluindo
//     CPF, documento e contato de emergencia. E o oposto do que uma LISTA pode
//     mostrar: a lista pinta varios clientes de uma vez, e um print dela nao
//     pode vazar dado sensivel de todo mundo.
//
// A unidade aqui e outra: MUITAS reservas, TODOS os status, filtradas por busca
// livre (nome ou telefone), status e periodo — para o cenario real da primeira
// semana, "cliente ligou, reservei pro sabado, esqueci o horario".
//
// >>> REGRA DE PRIVACIDADE DESTA LISTA <<<
// O SELECT abaixo NAO busca cpf, document_number nem contato de emergencia. A
// garantia e a mesma de lib/reservation-status.ts: campo que a query nao BUSCA
// nao tem como vazar num payload/HTML de listagem. Telefone e nome SAO exibidos
// de proposito — sao a ferramenta do dono para retornar a ligacao. Ao mexer
// aqui, nao acrescente JOIN com participants nem colunas sensiveis de customers.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts/calendar.ts: le do Postgres e
// resolve o tenant. Valor que precise chegar ao cliente sai por prop de um
// Server Component.

import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { addDays } from './calendar';
import { db } from './db/client';
import { isReservationId } from './reservation-detail';
import { getTenantId } from './tenant';
import { localToUtc } from './time';

// ============================================================================
// Status
// ============================================================================

/** Todos os status da reserva. A lista mostra os quatro, ao contrario da grade. */
export type ReservationStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';

const STATUSES: readonly ReservationStatus[] = [
  'pending_payment',
  'confirmed',
  'cancelled',
  'expired',
];

/** Valida o filtro de status vindo da URL. Desconhecido -> ignora (sem filtro). */
export function isReservationStatus(value: string): value is ReservationStatus {
  return (STATUSES as readonly string[]).includes(value);
}

// ============================================================================
// Busca e listagem
// ============================================================================

/**
 * Teto de linhas. Sem paginacao no MVP: bater o teto vira aviso "mostrando as
 * 100 mais recentes", e o dono refina a busca. Buscamos LIMIT+1 para saber, sem
 * um COUNT separado, se havia mais de 100.
 */
export const RESERVATION_LIST_LIMIT = 100;

export type ReservationListItem = {
  id: string;
  /** ISO 8601 (secao 3). A data/hora do passeio, em Sao Paulo, a tela formata. */
  startAt: string;
  status: ReservationStatus;
  experienceName: string;
  customerName: string;
  /** Exibido de proposito: e como o dono retorna a ligacao (secao 11.1). */
  customerPhone: string;
  totalPriceCents: number;
  /**
   * Estado financeiro AGREGADO (reservations.payment_state), derivado de
   * reservation_payments por recalcReservationPayment.
   *
   * >>> A LISTA ERA CEGA A ISTO ATE A FASE B <<<
   * Nao e detalhe cosmetico: uma reserva com sinal pago e `confirmed`, e a lista
   * mostrava so o status. O dono procurando "quem me deve" nao tinha como achar,
   * e a reserva aparecia igual a uma quitada.
   */
  paymentState: 'pending' | 'partial' | 'settled';
  amountPaidCents: number;
};

export type ReservationListResult = {
  items: ReservationListItem[];
  /** true quando havia MAIS de RESERVATION_LIST_LIMIT casando com o filtro. */
  limited: boolean;
};

/**
 * Escapa os curingas do ILIKE. `%` e `_` digitados na busca sao dado, nao
 * padrao: sem escapar, um `%` no nome pesquisado casaria com tudo. A barra
 * invertida e o escape padrao do LIKE no Postgres, entao nao precisa de
 * clausula ESCAPE.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type Row = {
  id: string;
  start_at: string;
  status: ReservationStatus;
  total_price_cents: number;
  payment_state: 'pending' | 'partial' | 'settled';
  amount_paid_cents: number;
  experience_name: string;
  customer_name: string;
  customer_phone: string;
};

/**
 * Reservas do tenant atual que casam com os filtros, mais recentes primeiro.
 *
 * Tudo e resolvido no BANCO (secao da tarefa): a busca por nome/telefone e ILIKE
 * (ignora maiuscula/minuscula), o status e o periodo viram WHERE, e a ordenacao
 * e o limite sao SQL. O navegador nunca filtra a lista.
 *
 * Periodo (`from`/`to`) filtra pela data do PASSEIO (`start_at`), nao pela de
 * criacao: o dono pensa "reserva de sabado", nao "reserva cadastrada sabado".
 * Ambos sao datas de calendario de Sao Paulo e viram instante na borda, como em
 * lib/calendar.ts — `to` e inclusivo, entao o limite superior e o 00:00 do dia
 * SEGUINTE.
 */
export async function searchReservations(params: {
  query?: string;
  status?: ReservationStatus;
  /**
   * "So quem tem saldo em aberto".
   *
   * >>> FILTRO A PARTE, e NAO um valor a mais na lista de status <<<
   * "Quem me deve" nao e um `reservation_status`: e a combinacao de `confirmed`
   * com `partial`. Enfia-lo na mesma lista misturaria duas dimensoes num controle
   * so e tornaria impossivel pedir "confirmadas E com saldo" — que e exatamente a
   * pergunta que o dono faz na vespera do passeio.
   */
  onlyWithBalance?: boolean;
  /** 'YYYY-MM-DD' local de Sao Paulo, inclusivo. */
  from?: string;
  /** 'YYYY-MM-DD' local de Sao Paulo, inclusivo. */
  to?: string;
}): Promise<ReservationListResult> {
  const conditions: SQL[] = [sql`r.tenant_id = ${getTenantId()}`];

  const raw = params.query?.trim();
  if (raw) {
    const like = `%${escapeLike(raw)}%`;
    // Telefone e guardado so com digitos (ver createReservation). Se o dono
    // digitar o numero formatado — "(19) 99999" —, o ILIKE cru nao casaria; um
    // segundo padrao so com os digitos da busca resgata esse caso, sem afetar a
    // busca por nome.
    const digits = raw.replace(/\D/g, '');
    conditions.push(
      digits
        ? sql`(c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.phone ILIKE ${`%${digits}%`})`
        : sql`(c.name ILIKE ${like} OR c.phone ILIKE ${like})`,
    );
  }

  if (params.status) {
    conditions.push(sql`r.status = ${params.status}::reservation_status`);
  }

  if (params.onlyWithBalance) {
    // Reserva CANCELADA ou EXPIRADA com sinal pago nao entra: o dinheiro dela e
    // caso de estorno manual (secao 8-C), nao de cobranca no dia. Quem procura
    // "quem me deve" quer quem vai aparecer para o passeio.
    conditions.push(sql`r.status IN ('pending_payment','confirmed')`);
    // >>> `> 0` E PARTE DA DEFINICAO, nao um detalhe <<<
    // "Saldo em aberto" e PAGOU PARTE e ainda deve. Uma reserva onde ninguem
    // pagou nada nao tem saldo: tem o preco inteiro em aberto, e ja se anuncia
    // como "Aguardando pagamento". Incluir as duas no mesmo filtro misturaria de
    // novo as dimensoes que separar o controle foi feito para separar.
    // Espelha exatamente o `temSaldo` da tela — as duas condicoes precisam
    // concordar, senao o filtro devolve linha sem selo (ou vice-versa).
    conditions.push(sql`r.amount_paid_cents > 0`);
    conditions.push(sql`r.amount_paid_cents < r.total_price_cents`);
  }

  if (params.from) {
    conditions.push(sql`r.start_at >= ${localToUtc(params.from, '00:00').toISOString()}::timestamptz`);
  }
  if (params.to) {
    conditions.push(
      sql`r.start_at < ${localToUtc(addDays(params.to, 1), '00:00').toISOString()}::timestamptz`,
    );
  }

  const { rows } = await db.execute<Row>(sql`
    SELECT
      r.id::text          AS id,
      r.start_at          AS start_at,
      r.status::text      AS status,
      r.total_price_cents AS total_price_cents,
      r.payment_state::text AS payment_state,
      r.amount_paid_cents AS amount_paid_cents,
      e.name              AS experience_name,
      c.name              AS customer_name,
      c.phone             AS customer_phone
    FROM reservations r
    JOIN experiences e ON e.id = r.experience_id
    JOIN customers   c ON c.id = r.customer_id
    WHERE ${sql.join(conditions, sql` AND `)}
    -- Mais recente primeiro; id como desempate estavel entre reservas do mesmo
    -- instante (import em lote, mesma trilha e horario).
    ORDER BY r.start_at DESC, r.id DESC
    LIMIT ${RESERVATION_LIST_LIMIT + 1}
  `);

  const limited = rows.length > RESERVATION_LIST_LIMIT;
  const page = limited ? rows.slice(0, RESERVATION_LIST_LIMIT) : rows;

  return {
    // O driver devolve o TEXTO CRU do Postgres para timestamptz (mode:'string').
    // Toda saida de lib/ vai em ISO 8601 (secao 3): o V8 tolera o cru, outros
    // motores devolvem NaN e o sintoma so aparece no navegador do cliente.
    items: page.map((row) => ({
      id: row.id,
      startAt: new Date(row.start_at).toISOString(),
      status: row.status,
      experienceName: row.experience_name,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      totalPriceCents: row.total_price_cents,
      paymentState: row.payment_state,
      amountPaidCents: row.amount_paid_cents,
    })),
    limited,
  };
}

// ============================================================================
// Abertura do painel de detalhe por URL (?reserva=id no calendario)
// ============================================================================

/**
 * A reserva existe e pertence ao tenant atual?
 *
 * Guarda o mesmo contrato de lib/reservation-detail.ts: id fora do formato uuid
 * NAO vai ao banco (evita o 22P02 de `WHERE id = 'abc'::uuid`, que abortaria a
 * query), e reserva de OUTRO tenant e indistinguivel de inexistente — as duas
 * respondem `false`.
 */
export async function reservationExists(reservationId: string): Promise<boolean> {
  if (!isReservationId(reservationId)) return false;

  const { rows } = await db.execute(sql`
    SELECT 1 FROM reservations
    WHERE id = ${reservationId}::uuid AND tenant_id = ${getTenantId()}
    LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * Resolve o `?reserva=` da URL do calendario no id que DEVE abrir o painel, ou
 * `null` para nao abrir nada.
 *
 * E a guarda que mantem o parametro ADITIVO e seguro (requisitos da tarefa):
 *   - ausente        -> null: o calendario renderiza igual ao de hoje, sem tocar
 *                       o banco (nenhuma query extra).
 *   - malformado     -> null: reservationExists barra pelo formato, nao lanca.
 *   - inexistente    -> null.
 *   - de outro tenant-> null.
 * Nesses quatro casos a pagina abre normal, SEM painel e SEM erro na cara do
 * dono. So um id existente do proprio tenant abre o painel.
 */
export async function resolveOpenReservationId(
  raw: string | undefined | null,
): Promise<string | null> {
  if (!raw) return null;
  return (await reservationExists(raw)) ? raw : null;
}
