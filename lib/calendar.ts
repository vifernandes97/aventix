// Aventix — leitura do calendario do admin (CLAUDE.md secao 11.1).
//
// MODULO DE LEITURA. Nada aqui escreve no banco. O painel de detalhes e o
// cancelamento (que chamam setReservationStatus) sao a PROXIMA tarefa e nao
// passam por este arquivo.
//
// Contrato da secao 11.1: o periodo inteiro sai em UMA consulta, com reservas
// ativas + recursos alocados + cliente (so nome) + estado de pagamento. O front
// posiciona; nunca busca por reserva ou por recurso separadamente.
//
// SERVER-ONLY pelo mesmo motivo de tenant.ts e availability.ts: le do Postgres
// e resolve o tenant. Se um valor precisa chegar ao cliente, um Server Component
// passa como prop.

import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from './db/client';
import { getTenantId } from './tenant';
import { localToUtc, timeToMinutes, weekdayOf } from './time';

// ============================================================================
// Aritmetica de data de CALENDARIO
// ============================================================================
//
// Tudo aqui opera sobre 'YYYY-MM-DD' ancorado em UTC (`T00:00:00Z` + getUTC*),
// que e o mesmo padrao ja usado por `weekdayOf` em lib/time.ts.
//
// POR QUE NAO date-fns AQUI: as funcoes de calendario do date-fns (startOfWeek,
// addDays, startOfMonth) trabalham no fuso LOCAL DO PROCESSO. Uma data de
// calendario nao tem fuso — '2026-08-05' e a mesma segunda-feira em qualquer
// servidor — e misturar as duas nocoes faz o container em UTC e o notebook em
// America/Sao_Paulo calcularem semanas diferentes para a mesma URL. A conversao
// para INSTANTE (que precisa de fuso) acontece num lugar so, em localToUtc.
// date-fns-tz continua sendo quem faz essa parte, dentro de lib/time.ts.

/** 'YYYY-MM-DD' + n dias (n pode ser negativo). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Domingo da semana da data. Semana comeca no DOMINGO, como operating_hours.weekday (0=domingo). */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** Primeiro dia do mes da data. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Ultimo dia do mes da data. */
export function endOfMonth(date: string): string {
  const d = new Date(`${startOfMonth(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Lista inclusiva de datas de `from` ate `to`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ============================================================================
// Views
// ============================================================================

export type CalendarView = 'day' | 'week' | 'month';

export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month'];

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/**
 * Periodo coberto por uma view ancorada em `date`.
 *
 * `month` estende ate a semana inteira nas duas pontas: a grade do mes desenha
 * semanas completas, e sem isso os dias de emenda (fim do mes anterior, comeco
 * do seguinte) apareceriam vazios mesmo tendo reserva.
 */
export function periodForView(view: CalendarView, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') return { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) };
  return {
    from: startOfWeek(startOfMonth(date)),
    to: addDays(startOfWeek(endOfMonth(date)), 6),
  };
}

/** Passo de navegacao anterior/proximo, na unidade da view. */
export function shiftPeriod(view: CalendarView, date: string, direction: -1 | 1): string {
  if (view === 'day') return addDays(date, direction);
  if (view === 'week') return addDays(date, 7 * direction);
  const d = new Date(`${startOfMonth(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + direction);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Tipos do payload
// ============================================================================

/** Status que o calendario exibe. expired/cancelled NUNCA saem daqui (secao 11.1). */
export type CalendarStatus = 'pending_payment' | 'confirmed';

export type CalendarResourceRef = { id: number; name: string };

/** Resumo — o que a view de MES precisa: horario + trilha + status. */
export type CalendarReservationSummary = {
  id: string;
  /** ISO 8601 (secao 3) */
  startAt: string;
  status: CalendarStatus;
  /**
   * Estado financeiro AGREGADO da reserva (reservations.payment_state), derivado
   * de reservation_payments por recalcReservationPayment.
   *
   * NAO e sinonimo de `status`: ate a Fase 2 existir, nenhuma cobranca e criada e
   * este campo fica 'pending' em toda reserva, inclusive nas confirmadas. Quem
   * pinta a tela HOJE e o `status`; o marcador de saldo em aberto da secao 11.1
   * passa a ler daqui quando o pagamento entrar.
   */
  paymentState: 'pending' | 'partial' | 'settled';
  experience: { id: number; name: string };
};

/** Detalhe — o que as views de DIA e SEMANA precisam para desenhar o bloco. */
export type CalendarReservationDetail = CalendarReservationSummary & {
  /** ISO. start + duracao: e o fim que o cliente enxerga, SEM buffer (secao 4.6). */
  endAt: string;
  /** ISO. start + duracao + buffer: o que a vaga realmente ocupa. */
  bufferEndAt: string;
  durationMinutes: number;
  bufferMinutes: number;
  resourcesNeeded: number;
  /** Uma reserva pode ocupar N recursos. */
  resources: CalendarResourceRef[];
  /** UNICO dado pessoal exposto. Sem telefone, documento, e-mail (secao 11.2). */
  customerName: string;
  totalPriceCents: number;
  amountPaidCents: number;
};

// ============================================================================
// A consulta do periodo — UMA para tudo (secao 11.1)
// ============================================================================

type Row = {
  id: string;
  start_at: string;
  status: CalendarStatus;
  payment_state: 'pending' | 'partial' | 'settled';
  amount_paid_cents: number;
  total_price_cents: number;
  resources_needed: number;
  experience_id: number;
  experience_name: string;
  duration_minutes: number;
  buffer_minutes: number;
  customer_name: string;
  resources: CalendarResourceRef[];
};

/**
 * Reservas ATIVAS que tocam o periodo [from, to], ambos inclusivos e em datas de
 * calendario de Sao Paulo.
 *
 * UMA query: reserva + experiencia + cliente + os N recursos alocados, com os
 * recursos agregados em JSON pelo proprio Postgres. A alternativa obvia — trazer
 * as reservas e depois buscar os recursos de cada uma — e exatamente o N+1 que a
 * secao 11.1 proibe.
 */
export async function getCalendarReservations(params: {
  from: string;
  to: string;
}): Promise<CalendarReservationDetail[]> {
  const tenantId = getTenantId();

  // Janela em INSTANTES: do 00:00 de `from` ao 00:00 do dia seguinte a `to`.
  // `to` e inclusivo, entao o limite superior e o dia seguinte — tstzrange usa
  // limites [) e um passeio que comeca 23:30 do ultimo dia precisa entrar.
  const fromUtc = localToUtc(params.from, '00:00').toISOString();
  const toUtc = localToUtc(addDays(params.to, 1), '00:00').toISOString();

  const { rows } = await db.execute<Row>(sql`
    SELECT
      r.id::text                AS id,
      r.start_at                AS start_at,
      r.status::text            AS status,
      r.payment_state::text     AS payment_state,
      r.amount_paid_cents       AS amount_paid_cents,
      r.total_price_cents       AS total_price_cents,
      r.resources_needed        AS resources_needed,
      e.id                      AS experience_id,
      e.name                    AS experience_name,
      e.duration_minutes        AS duration_minutes,
      e.buffer_minutes          AS buffer_minutes,
      c.name                    AS customer_name,
      coalesce(
        json_agg(json_build_object('id', res.id, 'name', res.name) ORDER BY res.id)
          FILTER (WHERE res.id IS NOT NULL),
        '[]'::json
      )                         AS resources
    FROM reservations r
    JOIN experiences e ON e.id = r.experience_id
    JOIN customers   c ON c.id = r.customer_id
    -- LEFT: reserva sem alocacao e dado corrompido, mas some-la da tela seria a
    -- pior reacao possivel — e justamente ela que o dono precisa enxergar.
    LEFT JOIN reservation_resources rr  ON rr.reservation_id = r.id
    LEFT JOIN resources             res ON res.id = rr.resource_id
    WHERE r.tenant_id = ${tenantId}
      -- Secao 11.1: so reserva ATIVA. expired/cancelled liberaram a vaga e nao
      -- ocupam lugar na grade.
      AND r.status IN ('pending_payment', 'confirmed')
      -- Sobreposicao SEMPRE em SQL, com && sobre tstzrange (decisao de 27/07):
      -- os limites sao [), entao um passeio que termina 09:00 nao entra numa
      -- janela que comeca 09:00. Reimplementar isso em JS abre espaco para um
      -- <= no lugar de <.
      --
      -- EXISTS em vez de filtrar no proprio JOIN: o filtro no join descartaria
      -- as LINHAS de recurso fora da janela e a reserva apareceria com menos
      -- recursos do que realmente ocupa.
      AND EXISTS (
        SELECT 1 FROM reservation_resources rr2
        WHERE rr2.reservation_id = r.id
          AND rr2.period && tstzrange(${fromUtc}::timestamptz, ${toUtc}::timestamptz)
      )
    GROUP BY r.id, e.id, c.id
    ORDER BY r.start_at, r.id
  `);

  return rows.map((row) => {
    // O driver devolve o TEXTO CRU do Postgres para timestamptz (schema usa
    // mode:'string'). Converter para ISO 8601 e obrigatorio na saida de lib/
    // (secao 3): o V8 tolera o formato cru, outros motores devolvem NaN, e o
    // sintoma so aparece no navegador do cliente.
    const startMs = new Date(row.start_at).getTime();
    const endMs = startMs + row.duration_minutes * 60_000;

    return {
      id: row.id,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      bufferEndAt: new Date(endMs + row.buffer_minutes * 60_000).toISOString(),
      status: row.status,
      paymentState: row.payment_state,
      durationMinutes: row.duration_minutes,
      bufferMinutes: row.buffer_minutes,
      resourcesNeeded: row.resources_needed,
      resources: row.resources,
      customerName: row.customer_name,
      totalPriceCents: row.total_price_cents,
      amountPaidCents: row.amount_paid_cents,
      experience: { id: row.experience_id, name: row.experience_name },
    };
  });
}

/** Projecao de mes: horario + trilha + status, sem dado pessoal nem recursos (secao 11.1). */
export function toSummary(r: CalendarReservationDetail): CalendarReservationSummary {
  return {
    id: r.id,
    startAt: r.startAt,
    status: r.status,
    paymentState: r.paymentState,
    experience: r.experience,
  };
}

// ============================================================================
// Catalogo para desenhar a grade
// ============================================================================
//
// Estas leituras NAO fazem parte da "uma query do periodo": sao o esqueleto da
// tela (quais colunas existem, onde o dia comeca e termina), nao o movimento.
// Sao consultas de catalogo, pequenas e cacheaveis.

/** Recursos ativos, na ordem das colunas da view de dia. */
export async function getActiveResources(): Promise<CalendarResourceRef[]> {
  const { rows } = await db.execute<CalendarResourceRef>(sql`
    SELECT id, name FROM resources
    WHERE tenant_id = ${getTenantId()} AND active
    ORDER BY id
  `);
  return rows;
}

/** Experiencias ativas, para os chips de filtro. */
export async function getActiveExperiences(): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.execute<{ id: number; name: string }>(sql`
    SELECT id, name FROM experiences
    WHERE tenant_id = ${getTenantId()} AND active
    ORDER BY duration_minutes, id
  `);
  return rows;
}

export type DayGrid = {
  /** Faixas de funcionamento do dia, em minutos desde 00:00. Vazio = fechado. */
  ranges: { opensMinutes: number; closesMinutes: number }[];
  /** De onde a grade veio — a tela usa para explicar um dia vazio. */
  source: 'exception' | 'weekday' | 'closed_exception' | 'closed_weekday';
};

/**
 * Grade de funcionamento de UMA data, com a precedencia da secao 6:
 * schedule_exceptions vence operating_hours.
 *
 * DIVIDA CONHECIDA: esta precedencia agora existe em dois lugares — aqui e no
 * passo 1 de lib/availability.ts. Nao foi extraida porque availability.ts nao
 * expoe helper para ela e esta tarefa nao pode toca-lo. As duas copias precisam
 * andar juntas; o lugar certo de unificar e quando o CRUD de horarios da Fase 3
 * entrar e um terceiro consumidor aparecer.
 *
 * Consequencia de divergirem: a grade DESENHADA mostraria horario que o motor de
 * disponibilidade nao vende (ou esconderia horario que ele vende). Nao produz
 * overbooking — a trava e a exclusion constraint —, produz tela mentindo.
 */
export async function getDayGrid(date: string): Promise<DayGrid> {
  const tenantId = getTenantId();

  const { rows: exceptions } = await db.execute<{
    opens: string | null;
    closes: string | null;
    closed: boolean;
  }>(sql`
    SELECT opens::text AS opens, closes::text AS closes, closed
    FROM schedule_exceptions
    WHERE tenant_id = ${tenantId} AND date = ${date}
  `);

  const exception = exceptions[0];
  if (exception) {
    if (exception.closed) return { ranges: [], source: 'closed_exception' };
    return {
      ranges: [
        {
          opensMinutes: timeToMinutes(exception.opens!),
          closesMinutes: timeToMinutes(exception.closes!),
        },
      ],
      source: 'exception',
    };
  }

  const { rows: hours } = await db.execute<{ opens: string; closes: string }>(sql`
    SELECT opens::text AS opens, closes::text AS closes
    FROM operating_hours
    WHERE tenant_id = ${tenantId} AND weekday = ${weekdayOf(date)}
    ORDER BY opens
  `);

  if (hours.length === 0) return { ranges: [], source: 'closed_weekday' };

  return {
    ranges: hours.map((h) => ({
      opensMinutes: timeToMinutes(h.opens),
      closesMinutes: timeToMinutes(h.closes),
    })),
    source: 'weekday',
  };
}
